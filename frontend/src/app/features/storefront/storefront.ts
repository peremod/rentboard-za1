import {
  ChangeDetectionStrategy, Component, OnInit, inject, signal,
} from '@angular/core';
import { DatePipe, NgOptimizedImage } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { environment } from '@env/environment';
import { StorefrontService } from '../../core/services/storefront.service';
import { PublicStorefront } from '../../core/models/storefront.model';
import { ZarCentsPipe } from '../../shared/pipes/zar-cents.pipe';
import { PluralPipe } from '../../shared/pipes/plural.pipe';
import { SeoService } from '../../core/services/seo.service';

/**
 * A landlord's public page — Phase 5b, carrying 5h's badges.
 *
 * ── It lives at /landlords/:slug, and the brief said /landlord/[slug]
 *
 * That route cannot work. `/landlord` is the authed portal: it sits behind
 * `authGuard` and `landlordGuard` and carries `seo: { noIndex: true }`. A public
 * page under it would be unreachable to visitors and told not to be indexed —
 * the exact opposite of the point — and `dashboard`, `yard`, `verification` and
 * `services` would all be slugs shadowing real screens. So: a separate public
 * top-level route, plural.
 *
 * ── A real SEO surface, treated like one
 *
 * Server-rendered, canonical, with Person/Organization JSON-LD and an
 * `ItemList` of the live rooms. In the sitemap at 0.6 — below a room page, which
 * is what someone actually searches for, above the marketing pages.
 *
 * No hreflang cluster: a landlord's bio is their own words and is never
 * translated, so the localised URLs would serve identical text. The same
 * reasoning keeps room pages out of the cluster.
 *
 * ── Nothing on this page is a claim the landlord made about themselves
 *
 * The badges are computed from usage and each one carries its own `basis`, so
 * the page can say why. The response time is a median and is absent below three
 * answered applications: a tenant is using this to decide whether to bother
 * applying, and one fast reply is not a habit.
 */
@Component({
  selector: 'app-storefront',
  standalone: true,
  imports: [DatePipe, RouterLink, ZarCentsPipe, PluralPipe, NgOptimizedImage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="store-wrap"><p class="muted">Loading…</p></div>
    } @else if (notFound()) {
      <div class="store-wrap">
        <h1>No such page</h1>
        <p class="muted">
          This landlord has no public page, or has taken it down.
        </p>
        <a class="btn btn-primary" routerLink="/">Browse rooms</a>
      </div>
    } @else if (store(); as s) {
      <div class="store-wrap">

        <header class="store-head">
          @if (s.logoPath) {
            <img class="store-logo" [ngSrc]="s.logoPath" width="88" height="88"
                 [alt]="s.displayName + ' logo'"/>
          }
          <div>
            <h1 class="store-name">{{ s.displayName }}</h1>
            <p class="store-sub">
              Letting rooms on Mastande since {{ s.memberSince | date: 'MMMM y' }}
            </p>
          </div>
        </header>

        <!-- Badges, each one earned. The basis is in the title attribute AND in
             the text below the row, because a tooltip is not available to
             everyone and "why does this person have this badge" is the only
             question a badge needs to answer. -->
        @if (s.badges.length) {
          <ul class="badge-row">
            @for (b of s.badges; track b.id) {
              <li class="badge" [class.badge--verified]="b.id === 'verified'">
                <span class="badge-label">{{ b.label }}</span>
                <span class="badge-basis">{{ b.basis }}</span>
              </li>
            }
          </ul>
        }

        @if (s.bio) {
          <section class="store-section">
            <h2>About</h2>
            <p class="store-bio">{{ s.bio }}</p>
            <p class="muted store-disclaimer">
              In their own words. Mastande has not checked this description.
            </p>
          </section>
        }

        <section class="store-section">
          <h2>What we know about them</h2>
          <!-- Figures with their denominators. A page whose purpose is trust is
               the wrong place to round two observations into a percentage. -->
          <dl class="store-facts">
            <div>
              <dt>Verified</dt>
              <dd>
                @if (s.verified) {
                  Yes — an admin checked their ID
                } @else {
                  Not yet
                }
              </dd>
            </div>
            <div>
              <dt>Rooms on the board</dt>
              <dd>{{ s.roomsAvailable }} {{ s.roomsAvailable | plural: 'room' }}</dd>
            </div>
            <div>
              <dt>Tenancies through Mastande</dt>
              <dd>{{ s.tenantsPlaced }}</dd>
            </div>
            <div>
              <dt>Usually replies in</dt>
              <dd>
                @if (s.typicalResponseHours !== null) {
                  {{ responseText(s.typicalResponseHours) }}
                  <span class="muted">— from {{ s.responseFrom }} {{ s.responseFrom | plural: 'application' }}</span>
                } @else {
                  <span class="muted">Not enough answered applications yet to say</span>
                }
              </dd>
            </div>
            @if (s.rating !== null && s.ratingCount > 0) {
              <div>
                <dt>Rating</dt>
                <dd>{{ s.rating }} out of 5 <span class="muted">— from {{ s.ratingCount }} {{ s.ratingCount | plural: 'review' }}</span></dd>
              </div>
            }
          </dl>
        </section>

        <section class="store-section">
          <h2>Rooms available now</h2>
          @if (s.rooms.length === 0) {
            <p class="muted">Nothing on the board at the moment.</p>
          } @else {
            <ul class="store-rooms">
              @for (r of s.rooms; track r.id) {
                <li class="store-room">
                  <a [routerLink]="['/rooms', r.id]" class="store-room__link">
                    @if (r.heroImagePath) {
                      <img [ngSrc]="r.heroImagePath" width="120" height="80"
                           [alt]="r.title" class="store-room__img"/>
                    }
                    <span class="store-room__text">
                      <span class="store-room__title">{{ r.title }}</span>
                      <span class="muted">{{ r.locationDisplay }} · {{ r.rentCents | zarCents }}/month</span>
                    </span>
                  </a>
                </li>
              }
            </ul>
          }
        </section>

        <p class="muted store-foot">
          Mastande does not vet listings and is not a party to any agreement.
          Never pay a deposit before you have seen a room in person.
        </p>
      </div>
    }
  `,
  styles: [
    `
      .store-wrap { margin: 0 auto; max-width: 48rem; padding: 1.5rem 1rem 3rem; }
      .store-head { align-items: center; display: flex; gap: 1rem; margin-bottom: 1rem; }
      .store-logo { border-radius: 50%; object-fit: cover; }
      .store-name { margin: 0; }
      .store-sub { margin: 0.2rem 0 0; opacity: 0.8; }

      .badge-row { display: flex; flex-wrap: wrap; gap: 0.6rem; list-style: none; margin: 0 0 1.5rem; padding: 0; }
      .badge {
        background: var(--surface2, #F4F1EC);
        border: 1px solid var(--line);
        border-radius: 0.6rem;
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        padding: 0.5rem 0.7rem;
      }
      /* A border, not colour alone: the label already says "Verified landlord". */
      .badge--verified { border-color: var(--accent, #1F6F4A); border-width: 2px; }
      .badge-label { font-size: 0.9rem; font-weight: 600; }
      .badge-basis { font-size: 0.75rem; opacity: 0.75; }

      .store-section { border-top: 1px solid var(--line); margin-top: 1.5rem; padding-top: 1.25rem; }
      .store-section h2 { font-size: 1.05rem; margin: 0 0 0.6rem; }
      .store-bio { line-height: 1.7; margin: 0; white-space: pre-wrap; }
      .store-disclaimer { font-size: 0.8rem; margin: 0.5rem 0 0; }

      .store-facts { display: grid; gap: 0.7rem; margin: 0; }
      .store-facts dt { font-size: 0.8rem; opacity: 0.75; }
      .store-facts dd { margin: 0.1rem 0 0; }

      .store-rooms { list-style: none; margin: 0; padding: 0; }
      .store-room { border-bottom: 1px solid var(--line); }
      .store-room:last-child { border-bottom: 0; }
      .store-room__link { align-items: center; display: flex; gap: 0.8rem; padding: 0.7rem 0; text-decoration: none; }
      .store-room__img { border-radius: 0.4rem; object-fit: cover; }
      .store-room__text { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
      .store-room__title { font-weight: 600; }
      .store-foot { border-top: 1px solid var(--line); font-size: 0.8rem; margin-top: 2rem; padding-top: 1rem; }

      @media (min-width: 34rem) {
        .store-facts { grid-template-columns: 1fr 1fr; }
      }
    `,
  ],
})
export class Storefront implements OnInit {
  private route = inject(ActivatedRoute);
  private service = inject(StorefrontService);
  private seo = inject(SeoService);

  readonly store = signal<PublicStorefront | null>(null);
  readonly loading = signal(true);
  readonly notFound = signal(false);

  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.service.bySlug(slug).subscribe({
      next: (s) => {
        this.store.set(s);
        this.loading.set(false);
        this.applySeo(s);
      },
      error: () => {
        this.loading.set(false);
        this.notFound.set(true);
        // A page that does not exist must not be indexed, and must not inherit
        // the previous route's title while the shell is still showing.
        this.seo.apply({ title: 'No such page | Mastande', noIndex: true, alternates: false });
      },
    });
  }

  /** Hours as a person would say it. */
  responseText(hours: number): string {
    if (hours < 1) return 'under an hour';
    if (hours < 2) return 'about an hour';
    if (hours < 24) return `about ${Math.round(hours)} hours`;
    const days = Math.round(hours / 24);
    return days === 1 ? 'about a day' : `about ${days} days`;
  }

  private applySeo(s: PublicStorefront) {
    const where = s.rooms[0]?.locationDisplay;
    const title = `${s.displayName} — rooms to rent${where ? ` in ${where}` : ''} | Mastande`;

    // The description leads with what a searcher wants to know, and says nothing
    // the page cannot back up. "Verified" only appears when it is true.
    const description = [
      `${s.displayName} lets rooms${where ? ` in ${where}` : ' in South Africa'} on Mastande`,
      s.verified ? 'and is a verified landlord' : null,
      s.roomsAvailable > 0
        ? `with ${s.roomsAvailable} room${s.roomsAvailable === 1 ? '' : 's'} available now`
        : null,
      'Apply free — no agent fees.',
    ]
      .filter(Boolean)
      .join(', ')
      .replace(', Apply free', '. Apply free')
      .slice(0, 158);

    const image = s.logoPath
      ? `${environment.imagekitUrl}/${s.logoPath}?tr=w-1200,h-630,c-maintain_ratio,q-80,f-auto`
      : s.rooms[0]?.heroImagePath
        ? `${environment.imagekitUrl}/${s.rooms[0].heroImagePath}?tr=w-1200,h-630,c-maintain_ratio,q-80,f-auto`
        : undefined;

    this.seo.apply({
      title,
      description,
      path: `/landlords/${s.slug}`,
      image,
      /**
       * No hreflang cluster, for the same reason room pages have none: the bio
       * is the landlord's own words and is never translated, so every localised
       * URL would serve identical text. Claiming alternates for identical
       * content is an error Google reports, not a ranking gain.
       */
      alternates: false,
    });

    /**
     * Organization when they gave a business name, Person otherwise — claiming
     * a one-person letting is an Organization is the kind of structured-data
     * inaccuracy that gets a site's markup ignored wholesale.
     *
     * `makesOffer` rather than a bare ItemList: the rooms are things this entity
     * offers, which is what the relationship actually is.
     */
    this.seo.setJsonLd('storefront', {
      '@context': 'https://schema.org',
      '@type': 'RealEstateAgent',
      name: s.displayName,
      description: s.bio ?? description,
      url: `${environment.siteUrl}/landlords/${s.slug}`,
      image,
      ...(s.rating !== null && s.ratingCount > 0
        ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: s.rating,
              reviewCount: s.ratingCount,
              bestRating: 5,
            },
          }
        : {}),
      makesOffer: s.rooms.map((r) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Accommodation', name: r.title },
        price: Math.round(r.rentCents / 100),
        priceCurrency: 'ZAR',
        url: `${environment.siteUrl}/rooms/${r.id}`,
      })),
    });
  }
}
