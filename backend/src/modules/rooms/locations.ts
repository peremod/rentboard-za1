/**
 * Location landing pages — the gate, and the slug ⇆ province mapping.
 *
 * A location page ("Rooms to rent in Gauteng") is a deliberate SEO/GEO surface:
 * one indexable URL per province, carrying that province's live listings. The
 * single rule that governs whether such a page may EXIST is here, in one place,
 * read by three callers that must never disagree:
 *
 *   1. the public API (`GET /rooms/locations[/:slug]`) — what it will serve,
 *   2. the sitemap (seo.controller) — what it will advertise to crawlers,
 *   3. the page's own 404 (location component) — which is driven by (1).
 *
 * ⚠️ The whole point of the gate is that an EMPTY or near-empty landing page is
 * worse than no page. "Rooms to rent in Northern Cape" with one tired listing —
 * or none — is thin content: it competes with the real pages for crawl budget,
 * earns a soft-404 / low-quality signal against the whole site, and sends a
 * searcher to a dead end. So a province gets a page only once it carries at
 * least `LOCATION_PAGE_MIN_ROOMS` active listings, and loses it again the moment
 * it drops below. Nothing publishes a page the inventory cannot fill.
 *
 * Scope: provinces. Nine fixed entities, no slug collisions, stable URLs
 * forever, and every one a real South African search term. City/suburb pages
 * are the natural next increment and reuse this exact shape — a second
 * `by: ['city', 'province']` groupBy behind the same threshold and the same
 * `{ slug, label, count }` contract — but cities collide across provinces and
 * their slugs are not stable, so they are a data extension to design on its own,
 * not part of this first cut.
 */

/** The nine South African provinces, in the one canonical spelling the room
 *  rows use. Kept in step with SA_PROVINCES in room-filters.dto.ts and the
 *  frontend model; the spec asserts the two lists are identical so a province
 *  renamed in one place cannot silently diverge here. */
export const PROVINCES = [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
  'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape',
] as const;

export type Province = (typeof PROVINCES)[number];

/**
 * The gate. A province needs at least this many ACTIVE listings before its
 * landing page may be served, sitemapped or indexed.
 *
 * Three is the floor, not a target: it is the smallest board slice that still
 * reads as a real choice rather than a stub, and it keeps the launch map honest
 * — a province with one or two rooms simply has no page yet, which is the truth.
 * Raise it as inventory grows; nothing but this constant has to change, and the
 * drive proves a province sitting one below the line is excluded.
 */
export const LOCATION_PAGE_MIN_ROOMS = 3;

/**
 * Province → URL slug. Pure string transform: lowercase, spaces to hyphens.
 * "KwaZulu-Natal" already carries its hyphen, so it lowercases to
 * "kwazulu-natal" with no special-casing; "North West" → "north-west".
 */
export function provinceSlug(province: string): string {
  return province.toLowerCase().replace(/\s+/g, '-');
}

/** slug → the canonical province spelling, or null if the slug names no
 *  province. Built from PROVINCES so it cannot drift from provinceSlug(). */
const SLUG_TO_PROVINCE: ReadonlyMap<string, Province> = new Map(
  PROVINCES.map((p) => [provinceSlug(p), p] as const),
);

export function provinceFromSlug(slug: string): Province | null {
  return SLUG_TO_PROVINCE.get(slug) ?? null;
}

/** A published location, as the API and the sitemap both see it. */
export interface PublishedLocation {
  slug: string;
  province: Province;
  count: number;
}

/**
 * Turn raw per-province active-room counts into the published set: provinces at
 * or above the gate, highest inventory first. Pure, so the gate can be tested
 * without a database — the service hands it the groupBy result and nothing
 * else decides what publishes.
 */
export function publishedFromCounts(
  counts: ReadonlyArray<{ province: string | null; count: number }>,
): PublishedLocation[] {
  return counts
    .filter((c): c is { province: Province; count: number } =>
      c.province != null &&
      c.count >= LOCATION_PAGE_MIN_ROOMS &&
      SLUG_TO_PROVINCE.has(provinceSlug(c.province)),
    )
    .map((c) => ({ slug: provinceSlug(c.province), province: c.province, count: c.count }))
    .sort((a, b) => b.count - a.count || a.province.localeCompare(b.province));
}
