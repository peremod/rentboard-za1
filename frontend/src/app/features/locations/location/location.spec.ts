import { describe, it, expect } from 'vitest';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { Location } from './location';
import type { LocationPage, PublishedLocation } from '../../../core/models/room.model';

/**
 * The gate, as the page experiences it. The pure threshold lives in the
 * backend (rooms/locations.spec.ts); what this covers is the half that belongs
 * to the component and nothing else can see:
 *
 *   - a 404 from the API becomes notFound() + a noIndex page, which is what
 *     renders the <meta name="mastande-status" content="404"> marker server.ts
 *     reads. The one thing a gated-out province must NOT be is a 200.
 *   - a 5xx becomes loadFailed() (a 503 marker), never a 404 — one bad minute
 *     for the API must not ask Google to deindex a real province board.
 *   - a 200 sets the page and emits a CollectionPage + ItemList + breadcrumb.
 *   - the sibling-province links never include the province you are on.
 *
 * Rendered-template coverage (that the marker is actually bound) is the
 * seo-drive's job against a running server; this exercises the method the way
 * room-detail.spec exercises apply().
 */
describe('Location — the inventory gate, from the page side', () => {
  const make = (
    getLocation: () => unknown,
    getLocations: () => unknown,
    slug = 'gauteng',
  ) => {
    const c = Object.create(Location.prototype) as Record<string, unknown>;
    c['location'] = () => slug;
    c['page'] = signal<LocationPage | null>(null);
    c['notFound'] = signal(false);
    c['loadFailed'] = signal(false);
    c['others'] = signal<PublishedLocation[]>([]);
    const seoCalls: Record<string, unknown> = { jsonLd: {} as Record<string, unknown> };
    c['seo'] = {
      apply: (opts: unknown) => { seoCalls['apply'] = opts; },
      setJsonLd: (id: string, data: unknown) => {
        (seoCalls['jsonLd'] as Record<string, unknown>)[id] = data;
      },
    };
    c['roomsService'] = { getLocation, getLocations };
    return { c: c as Record<string, unknown> & { ngOnInit: () => void }, seoCalls };
  };

  const page = (over: Partial<LocationPage> = {}): LocationPage => ({
    slug: 'gauteng', province: 'Gauteng', count: 5, total: 5, page: 1, limit: 24,
    hasMore: false, verifiedLandlords: 0,
    data: [
      { id: 'r1', title: 'Room one' } as never,
      { id: 'r2', title: 'Room two' } as never,
    ],
    ...over,
  });

  it('a gated-out province (404) becomes a noIndex not-found, never a 200', () => {
    const { c, seoCalls } = make(
      () => throwError(() => ({ status: 404 })),
      () => of([]),
    );
    c.ngOnInit();
    expect((c['notFound'] as () => boolean)()).toBe(true);
    expect((c['loadFailed'] as () => boolean)()).toBe(false);
    expect((c['page'] as () => unknown)()).toBeNull();
    expect((seoCalls['apply'] as { noIndex?: boolean }).noIndex).toBe(true);
    // The trail to a province that is not there must be cleared, not left over.
    expect((seoCalls['jsonLd'] as Record<string, unknown>)['location']).toBeNull();
  });

  it('a server error (5xx) becomes loadFailed, NOT notFound — a 503, not a deindex', () => {
    const { c } = make(
      () => throwError(() => ({ status: 500 })),
      () => of([]),
    );
    c.ngOnInit();
    expect((c['loadFailed'] as () => boolean)()).toBe(true);
    expect((c['notFound'] as () => boolean)()).toBe(false);
  });

  it('a published province renders and emits CollectionPage + ItemList + breadcrumb', () => {
    const { c, seoCalls } = make(() => of(page()), () => of([]));
    c.ngOnInit();
    expect((c['page'] as () => LocationPage | null)()).not.toBeNull();

    const apply = seoCalls['apply'] as { title: string; path: string; alternates: boolean };
    expect(apply.title).toContain('Gauteng');
    expect(apply.path).toBe('/rooms/in/gauteng');
    expect(apply.alternates).toBe(false); // one language — no false hreflang cluster

    const jsonLd = seoCalls['jsonLd'] as Record<string, any>;
    expect(jsonLd['location']['@type']).toBe('CollectionPage');
    expect(jsonLd['location'].mainEntity['@type']).toBe('ItemList');
    expect(jsonLd['location'].mainEntity.numberOfItems).toBe(5);
    expect(jsonLd['location'].mainEntity.itemListElement).toHaveLength(2);
    expect(jsonLd['location'].mainEntity.itemListElement[0].position).toBe(1);
    // Breadcrumb matches the visible trail: Home → this province.
    expect(jsonLd['breadcrumb'].itemListElement.map((i: any) => i.name))
      .toEqual(['Home', 'Rooms in Gauteng']);
  });

  it('the sibling-province links never include the province you are on', () => {
    const others: PublishedLocation[] = [
      { slug: 'gauteng', province: 'Gauteng', count: 9 },
      { slug: 'western-cape', province: 'Western Cape', count: 4 },
    ];
    const { c } = make(() => of(page()), () => of(others), 'gauteng');
    c.ngOnInit();
    expect((c['others'] as () => PublishedLocation[])().map((o) => o.slug))
      .toEqual(['western-cape']);
  });
});
