import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Resolves what someone typed into a place in the hierarchy.
 *
 * The point is that "Sandton" and "Johannesburg" are not the same thing but
 * are related: an ad bought for Sandton should show on Sandton pages only,
 * while a tenant searching Sandton should still see nearby Johannesburg rooms.
 * String comparison cannot express that; this can.
 */
@Injectable()
export class PlacesService {
  constructor(private prisma: PrismaService) {}

  private normalise(input: string) {
    return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  /**
   * Best match for a free-text location, with its ancestry.
   *
   * Exact slug first, then alias, then a prefix match — in that order, so
   * "Cape Town" does not resolve to "Cape Town Central" when both exist.
   */
  async resolve(input: string) {
    const term = this.normalise(input);
    if (term.length < 2) return null;

    const exact = await this.prisma.place.findUnique({ where: { slug: term } });
    if (exact) return this.withAncestry(exact);

    const byAlias = await this.prisma.place.findFirst({ where: { aliases: { has: term } } });
    if (byAlias) return this.withAncestry(byAlias);

    // Suburb slugs are city-prefixed, so a bare "sandton" needs a contains
    // match rather than startsWith.
    const partial = await this.prisma.place.findFirst({
      where: {
        OR: [
          { slug: { startsWith: term } },
          { slug: { endsWith: `-${term}` } },
          { name: { equals: input.trim(), mode: 'insensitive' } },
        ],
      },
      // Prefer the broader match: someone typing "cape" means the city.
      orderBy: [{ type: 'asc' }],
    });

    return partial ? this.withAncestry(partial) : null;
  }

  /**
   * The filter a search should use.
   *
   * A suburb widens to its city, because a board that returns only rooms
   * tagged with that exact suburb would look empty — landlords mostly tag the
   * city. A city stays a city.
   */
  async searchScope(input: string) {
    const place = await this.resolve(input);
    if (!place) return { city: input.trim(), province: undefined as string | undefined };

    return place.type === 'suburb'
      ? { city: place.city ?? undefined, province: place.province, matchedSuburb: place.name }
      : place.type === 'city'
        ? { city: place.name, province: place.province }
        : { city: undefined, province: place.province };
  }

  /** Suggestions for the search box, including suburbs. */
  async suggest(query: string, limit = 8) {
    const term = query.trim();
    if (term.length < 2) return [];

    const places = await this.prisma.place.findMany({
      where: {
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { aliases: { has: this.normalise(term) } },
        ],
      },
      // Cities before suburbs: the broader match is usually what was meant.
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      take: limit,
    });

    return places.map((p) => ({
      slug: p.slug,
      name: p.name,
      type: p.type,
      city: p.city,
      province: p.province,
      label: p.type === 'suburb' ? `${p.name}, ${p.city}` : `${p.name}, ${p.province}`,
    }));
  }

  private async withAncestry(place: { id: string; slug: string; name: string; type: string; city: string | null; province: string; parentId: string | null }) {
    return {
      slug: place.slug,
      name: place.name,
      type: place.type,
      city: place.city,
      province: place.province,
    };
  }
}
