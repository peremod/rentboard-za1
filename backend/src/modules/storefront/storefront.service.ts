import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isPlausibleSlug, slugify, uniqueSlug } from './slug';

/** A badge the platform awards from usage, never self-declared — Phase 5h. */
export interface Badge {
  /** Machine name, so the screen can pick an icon without parsing the label. */
  id: 'since' | 'verified' | 'tenants_placed' | 'replies_fast' | 'multi_room';
  label: string;
  /** Why they have it, in one line. A badge nobody can explain is a gimmick. */
  basis: string;
}

/** Whole months between two dates, floored. */
function monthsBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()));
}

/**
 * The public landlord storefront — Phase 5b, with 5h's badges on it.
 *
 * ── It lives at /landlords/:slug, not /landlord/:slug
 *
 * The brief asks for `/landlord/[slug]`, and that route cannot work. `/landlord`
 * is the authed portal: it sits behind `authGuard` and `landlordGuard`, and it
 * carries `seo: { noIndex: true }`. A public page underneath it would be
 * unreachable to visitors, told not to be indexed — the opposite of the point —
 * and `dashboard`, `yard`, `verification` and `services` would all be valid
 * slugs shadowing real screens. So the storefront is a separate public
 * top-level route, plural.
 *
 * ── Every number on the page is FROM something
 *
 * Years active is from `createdAt`. Rooms is what is live now. Tenants placed is
 * completed tenancies. Response time is application-to-first-action, which is
 * the only timestamp pair that records the landlord actually doing something.
 * Nothing is averaged from fewer than three observations, because a page whose
 * purpose is trust should not be the place a single fast reply becomes "replies
 * within an hour".
 *
 * ── Nothing here is a claim the landlord made
 *
 * The badges are computed. `bio` and `companyName` are the landlord's own words
 * and are shown as such. There is no field a landlord can set that reads as a
 * platform endorsement, because the whole value of the verified badge is that it
 * is not self-service.
 */
@Injectable()
export class StorefrontService {
  constructor(private prisma: PrismaService) {}

  /**
   * The landlord's own storefront settings, for the editing screen.
   *
   * Creates the slug on first read rather than at registration: a slug is a
   * public URL, and minting one for every landlord who ever signs up would put a
   * page in the sitemap for people who never asked for one. `storefrontLive`
   * stays false until they turn it on.
   */
  async mine(userId: string) {
    const profile = await this.prisma.landlordProfile.findUnique({
      where: { userId },
      select: {
        slug: true, bio: true, logoPath: true, storefrontLive: true,
        companyName: true, idVerified: true,
      },
    });
    if (!profile) throw new NotFoundException('No landlord profile');

    if (profile.slug) return profile;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });
    const slug = await this.mintSlug(profile.companyName || user?.fullName || 'landlord');
    const updated = await this.prisma.landlordProfile.update({
      where: { userId },
      data: { slug },
      select: {
        slug: true, bio: true, logoPath: true, storefrontLive: true,
        companyName: true, idVerified: true,
      },
    });
    return updated;
  }

  /**
   * A slug nobody has.
   *
   * Reads the taken set for slugs sharing the base rather than the whole table:
   * "thabo-mokoena" only ever collides with "thabo-mokoena*", and pulling every
   * slug in the system to answer that gets slower forever.
   */
  private async mintSlug(name: string): Promise<string> {
    const base = slugify(name) || 'landlord';
    const rows = await this.prisma.landlordProfile.findMany({
      where: { slug: { startsWith: base } },
      select: { slug: true },
    });
    const taken = new Set(rows.map((r) => r.slug!).filter(Boolean));
    return uniqueSlug(name, taken);
  }

  /**
   * Update the landlord's own storefront.
   *
   * The slug is deliberately NOT editable here. It is in the sitemap and in
   * whatever anyone has shared; letting it change would 404 every link that ever
   * pointed at the page, and the landlord who renamed it would be the last to
   * find out. A rename needs a redirect table, which is a bigger thing than
   * Phase 5b.
   */
  async updateMine(userId: string, dto: { bio?: string; logoPath?: string | null; storefrontLive?: boolean }) {
    const profile = await this.prisma.landlordProfile.findUnique({
      where: { userId },
      select: { slug: true },
    });
    if (!profile) throw new NotFoundException('No landlord profile');
    // Going live needs a URL to go live at.
    if (dto.storefrontLive && !profile.slug) {
      throw new BadRequestException('Open your storefront page once before publishing it, so it has an address.');
    }
    return this.prisma.landlordProfile.update({
      where: { userId },
      data: {
        bio: dto.bio === undefined ? undefined : dto.bio.trim() || null,
        logoPath: dto.logoPath === undefined ? undefined : dto.logoPath || null,
        storefrontLive: dto.storefrontLive,
      },
      select: {
        slug: true, bio: true, logoPath: true, storefrontLive: true,
        companyName: true, idVerified: true,
      },
    });
  }

  /**
   * The public page. 404s for anything not deliberately published.
   *
   * A slug that does not exist, a storefront switched off, and a suspended
   * account all answer the same way — 404, not 403. A distinguishable refusal
   * would let anyone enumerate which landlords exist and which are hidden, and
   * "this page is switched off" is information about a person.
   */
  async publicBySlug(slug: string) {
    // Rejected before touching the database: an implausible slug cannot exist,
    // and a bare pattern check keeps junk traffic off the query.
    if (!isPlausibleSlug(slug)) throw new NotFoundException('No such storefront');

    const profile = await this.prisma.landlordProfile.findFirst({
      where: { slug, storefrontLive: true, user: { isActive: true } },
      select: {
        slug: true, bio: true, logoPath: true, companyName: true,
        idVerified: true, rating: true, ratingCount: true,
        user: { select: { id: true, fullName: true, createdAt: true } },
      },
    });
    if (!profile) throw new NotFoundException('No such storefront');

    const landlordId = profile.user.id;
    const [rooms, tenancies, responses] = await Promise.all([
      this.prisma.room.findMany({
        where: { landlordId, status: 'active' },
        select: {
          id: true, title: true, rentCents: true, locationDisplay: true,
          heroImagePath: true, publishedAt: true,
        },
        orderBy: { publishedAt: 'desc' },
        take: 50,
      }),
      this.prisma.tenancy.count({ where: { landlordId, status: { in: ['active', 'ended'] } } }),
      // The only timestamp pair that records the landlord DOING something:
      // an application arriving, and them first opening or deciding it.
      this.prisma.application.findMany({
        where: { room: { landlordId }, OR: [{ viewedAt: { not: null } }, { decidedAt: { not: null } }] },
        select: { createdAt: true, viewedAt: true, decidedAt: true },
        take: 200,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const responseHours = this.medianResponseHours(responses);
    const now = new Date();

    return {
      slug: profile.slug,
      /** The landlord's business name if they gave one, else their own name. */
      displayName: profile.companyName || profile.user.fullName,
      bio: profile.bio,
      logoPath: profile.logoPath,
      verified: profile.idVerified,
      rating: profile.rating,
      ratingCount: profile.ratingCount,
      memberSince: profile.user.createdAt,
      monthsActive: monthsBetween(profile.user.createdAt, now),
      roomsAvailable: rooms.length,
      tenantsPlaced: tenancies,
      /** Median, not mean: one forgotten application should not define them. */
      typicalResponseHours: responseHours,
      /** How many answered applications that is from, so a reader can weigh it. */
      responseFrom: responses.length,
      rooms,
      badges: this.badges({
        createdAt: profile.user.createdAt,
        verified: profile.idVerified,
        tenantsPlaced: tenancies,
        roomsAvailable: rooms.length,
        responseHours,
        responseFrom: responses.length,
      }),
    };
  }

  /**
   * Typical time to a first response, in hours.
   *
   * The MEDIAN, because one application left over a long weekend drags a mean
   * into uselessness — and this figure sits on a page a tenant uses to decide
   * whether to bother applying. Null below three answered applications: two fast
   * replies are not a habit.
   */
  private medianResponseHours(
    rows: { createdAt: Date; viewedAt: Date | null; decidedAt: Date | null }[],
  ): number | null {
    const hours = rows
      .map((r) => {
        // Whichever came first. A landlord who decided without opening the
        // detail still responded, and the earlier of the two is the response.
        const times = [r.viewedAt, r.decidedAt].filter(Boolean).map((d) => d!.getTime());
        if (!times.length) return null;
        return (Math.min(...times) - r.createdAt.getTime()) / 3_600_000;
      })
      .filter((h): h is number => h !== null && h >= 0)
      .sort((a, b) => a - b);

    if (hours.length < 3) return null;
    const mid = Math.floor(hours.length / 2);
    const median = hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2;
    return Math.round(median * 10) / 10;
  }

  /**
   * Phase 5h — a short, meaningful set, each one earned and explainable.
   *
   * Deliberately NOT an achievements system. Every badge here is awarded from
   * data the landlord cannot set, and every one carries its own `basis` string
   * so the page can say why rather than showing a shiny thing that means
   * nothing. Thresholds are low but not trivial: a badge everybody has says
   * nothing, and one nobody can reach is decoration.
   */
  private badges(d: {
    createdAt: Date; verified: boolean; tenantsPlaced: number;
    roomsAvailable: number; responseHours: number | null; responseFrom: number;
  }): Badge[] {
    const out: Badge[] = [];
    const year = d.createdAt.getFullYear();

    out.push({
      id: 'since',
      label: `On Mastande since ${year}`,
      basis: 'From when this account was created.',
    });

    if (d.verified) {
      out.push({
        id: 'verified',
        label: 'Verified landlord',
        basis: 'An admin checked their identity document against their account.',
      });
    }

    if (d.tenantsPlaced >= 1) {
      out.push({
        id: 'tenants_placed',
        label: `${d.tenantsPlaced} ${d.tenantsPlaced === 1 ? 'tenancy' : 'tenancies'} through Mastande`,
        basis: 'Applications accepted here that became a tenancy.',
      });
    }

    // Only where there is enough behind it to be a habit rather than a run of
    // luck, and only when it is genuinely fast — "usually replies in 40 hours"
    // is not a badge, it is a warning.
    if (d.responseHours !== null && d.responseHours <= 24 && d.responseFrom >= 3) {
      out.push({
        id: 'replies_fast',
        label: 'Usually replies within a day',
        basis: `Median of ${d.responseFrom} applications they have answered.`,
      });
    }

    if (d.roomsAvailable >= 3) {
      out.push({
        id: 'multi_room',
        label: `${d.roomsAvailable} rooms available`,
        basis: 'Live listings on the board right now.',
      });
    }

    return out;
  }

  /** Every published storefront, for the sitemap. Slug and freshness only. */
  async allPublicSlugs() {
    return this.prisma.landlordProfile.findMany({
      where: { storefrontLive: true, slug: { not: null }, user: { isActive: true } },
      select: { slug: true, user: { select: { updatedAt: true } } },
      take: 20000,
    });
  }
}
