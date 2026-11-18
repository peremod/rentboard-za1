import { ChangeDetectionStrategy, Component, inject, input, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '@env/environment';
import { RoomsService } from '../../../core/services/rooms.service';
import { SeoService } from '../../../core/services/seo.service';
import { LocationPage, PublishedLocation } from '../../../core/models/room.model';
import { RoomCard } from '../../../shared/components/room-card/room-card';
import { Loading } from '../../../shared/components/loading/loading';
import { PluralPipe } from '../../../shared/pipes/plural.pipe';

/**
 * A province landing page — "Rooms to rent in Gauteng" (GEO/local SEO).
 *
 * ⚠️ This page exists only when the province is at or above the inventory gate
 * (backend rooms/locations.ts). The gate is enforced on the SERVER — the API
 * answers 404 for a province below the line — and this component turns that 404
 * into a real page-level 404 via the `mastande-status` marker server.ts reads.
 * The one thing this page must never be is a 200 that says "no rooms here yet":
 * that is the thin, soft-404 landing page the whole gate exists to prevent. So
 * a gated-out location is `noIndex` AND carries the 404 status, exactly as a
 * removed room does.
 *
 * The listings come from the same API the board uses, filtered to the province,
 * so this page and the board filtered to that province can never disagree.
 */
@Component({
  selector: 'app-location',
  standalone: true,
  imports: [RouterLink, RoomCard, Loading, PluralPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="legal-page">
      <div class="legal-container">
        @if (page(); as p) {
          <nav class="loc-back"><a routerLink="/">← All rooms</a></nav>
          <header class="legal-header">
            <h1>Rooms to rent in {{ p.province }}</h1>
            <p class="loc-sub">
              {{ p.total }} {{ p.total | plural: 'room' }} available now in {{ p.province }},
              posted directly by landlords — no estate agent, and free to apply.
            </p>
          </header>

          <div class="room-grid">
            @for (room of p.data; track room.id; let i = $index) {
              <app-room-card [room]="room" [isFirstCard]="i === 0"/>
            }
          </div>

          <!-- Internal linking: a crawlable path from each province board to the
               others that currently have a page. One edge per published
               location, so the location pages form a connected set a crawler
               (and a person) can walk, rather than nine islands reachable only
               from the sitemap. -->
          @if (others().length) {
            <nav class="loc-others" aria-label="Rooms in other provinces">
              <h2>Rooms in other provinces</h2>
              <ul>
                @for (o of others(); track o.slug) {
                  <li><a [routerLink]="['/rooms/in', o.slug]">Rooms in {{ o.province }}</a></li>
                }
              </ul>
            </nav>
          }
        } @else if (notFound()) {
          <!-- Below the inventory gate, or not a province at all. A real 404,
               not a 200 "nothing here" — server.ts reads this marker. -->
          <meta name="mastande-status" content="404"/>
          <header class="legal-header"><h1>No rooms listed there yet</h1></header>
          <p>
            There are no rooms to rent in that area on Mastande just now — new rooms are
            posted every day. <a routerLink="/">Browse every available room</a>.
          </p>
          @if (others().length) {
            <nav class="loc-others" aria-label="Provinces with rooms available">
              <h2>Provinces with rooms available now</h2>
              <ul>
                @for (o of others(); track o.slug) {
                  <li><a [routerLink]="['/rooms/in', o.slug]">Rooms in {{ o.province }}</a></li>
                }
              </ul>
            </nav>
          }
        } @else if (loadFailed()) {
          <!-- 503, not 404: the province may well have rooms, we could not ask.
               A 503 holds the URL in the index; a 404 would deindex it on one
               bad minute for the API. Same reasoning as room-detail. -->
          <meta name="mastande-status" content="503"/>
          <p>
            These rooms could not be loaded just now — that is our side.
            <a routerLink="/">Back to all rooms</a>, or try again in a moment.
          </p>
        } @else {
          <app-loading/>
        }
      </div>
    </section>
  `,
  styles: [`
    /* On-scale spacing only (.25/.5/.75/1/1.25/1.5/2/2.5/3rem); radius via tokens. */
    .loc-back { margin-bottom: 1rem; font-size: .9rem; }
    .loc-sub { color: var(--ink2); max-width: 60ch; }
    .loc-others { margin-top: 3rem; }
    .loc-others h2 { font-size: 1.25rem; margin-bottom: 1rem; }
    .loc-others ul { list-style: none; padding: 0; margin: 0;
                     display: flex; flex-wrap: wrap; gap: .75rem; }
    .loc-others a { display: inline-block; padding: .5rem 1rem;
                    border: 1px solid var(--border); border-radius: var(--r-full);
                    color: var(--ink); text-decoration: none; }
    .loc-others a:hover { border-color: var(--terra); color: var(--terra-deep); }
  `],
})
export class Location implements OnInit {
  /** The province slug, bound from the route param ':location'. */
  readonly location = input.required<string>();

  private readonly roomsService = inject(RoomsService);
  private readonly seo = inject(SeoService);

  readonly page = signal<LocationPage | null>(null);
  readonly notFound = signal(false);
  /** The API could not be reached at all — a 5xx, not a missing page. */
  readonly loadFailed = signal(false);
  /** Other published provinces, for the internal-linking block. */
  readonly others = signal<PublishedLocation[]>([]);

  ngOnInit() {
    const slug = this.location();

    // The sibling-province links. A failure here must never break the page —
    // it only costs the cross-links, so it is swallowed.
    this.roomsService.getLocations().subscribe({
      next: (list) => this.others.set(list.filter((l) => l.slug !== slug)),
      error: () => this.others.set([]),
    });

    this.roomsService.getLocation(slug).subscribe({
      next: (p) => {
        this.page.set(p);
        this.applySeo(p);
      },
      error: (err: { status?: number }) => {
        this.seo.setJsonLd('location', null);
        this.seo.setJsonLd('breadcrumb', null);

        if (err?.status === 404 || err?.status === 410) {
          this.notFound.set(true);
          this.seo.apply({
            title: 'No rooms listed there yet — Mastande',
            description:
              'No rooms are listed in that area on Mastande yet. Browse rooms to rent across South Africa, direct from landlords with no agent fees.',
            noIndex: true,
          });
          return;
        }

        this.loadFailed.set(true);
        this.seo.apply({
          title: 'Rooms temporarily unavailable — Mastande',
          description: 'These rooms could not be loaded. Please try again in a moment.',
          noIndex: true,
        });
      },
    });
  }

  /**
   * A province board is a CollectionPage whose main entity is the ItemList of
   * rooms on show, plus the Home → Province breadcrumb that matches the visible
   * trail. The description carries the province name, so each of the nine pages
   * has its own, not a copy of the board's.
   */
  private applySeo(p: LocationPage) {
    const title = `Rooms to Rent in ${p.province} — Direct from Landlords, No Agent Fees | Mastande`;
    const description =
      `Browse ${p.total} ${p.total === 1 ? 'room' : 'rooms'} to rent in ${p.province}, South Africa, ` +
      `posted directly by landlords. Apply free — no estate agent, no application fees.`;

    this.seo.apply({
      title,
      description: description.slice(0, 158),
      path: `/rooms/in/${p.slug}`,
      // One language: the chrome is translated, the listings are not, so this
      // page must not claim ten alternates for the same rooms — same call as
      // the room and storefront pages.
      alternates: false,
    });

    this.seo.setJsonLd('location', {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `Rooms to rent in ${p.province}`,
      description: description.slice(0, 158),
      url: `${environment.siteUrl}/rooms/in/${p.slug}`,
      inLanguage: 'en-ZA',
      about: {
        '@type': 'AdministrativeArea',
        name: p.province,
        containedInPlace: { '@type': 'Country', name: 'South Africa' },
      },
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: p.total,
        itemListElement: p.data.map((room, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: `${environment.siteUrl}/rooms/${room.id}`,
          name: room.title,
        })),
      },
    });

    this.seo.setJsonLd('breadcrumb', {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${environment.siteUrl}/` },
        {
          '@type': 'ListItem',
          position: 2,
          name: `Rooms in ${p.province}`,
          item: `${environment.siteUrl}/rooms/in/${p.slug}`,
        },
      ],
    });
  }
}
