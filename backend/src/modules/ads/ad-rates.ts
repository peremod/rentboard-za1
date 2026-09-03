/**
 * Rate card.
 *
 * The problem this solves: a campaign is priced per placement, but a national
 * sidebar appears on every search while a Sandton one appears on a fraction of
 * them. Charging both R2,500 means the national buyer gets perhaps ten times
 * the impressions for the same money, and the suburb buyer is overpaying badly.
 *
 * Rates scale with reach, but NOT linearly. A suburb campaign reaches maybe 3%
 * of traffic and pays 12% of the national rate — four times the price per
 * impression. That premium is the point: those impressions are worth more,
 * because a storage company shown to people moving into Sandton converts far
 * better than the same ad shown nationally.
 *
 * There is also a floor. Reviewing a creative, invoicing and reporting cost the
 * same whether a campaign is national or one suburb, so below a certain rate a
 * placement costs more to administer than it earns.
 */

export type AdPlacementKey = 'board_sidebar' | 'board_inline' | 'room_detail';
export type TargetLevel = 'national' | 'province' | 'city' | 'suburb';

/** Monthly rate in ZAR cents for a nationally targeted campaign. */
export const BASE_RATES_CENTS: Record<AdPlacementKey, number> = {
  board_sidebar: 250000, // R2,500 — one slot, on screen for the whole search
  board_inline: 400000,  // R4,000 — repeats every sixth room card
  room_detail: 300000,   // R3,000 — strongest intent, fewer page views
};

/**
 * Share of the national rate. Each is well above the share of traffic that
 * targeting actually reaches, which is where the precision premium sits.
 */
export const TARGET_MULTIPLIERS: Record<TargetLevel, number> = {
  national: 1,
  province: 0.5,
  city: 0.28,
  suburb: 0.15,
};

/**
 * Below this, reviewing, invoicing and reporting cost more than the placement
 * earns. Set at R450 rather than R600: a higher floor flattened all three
 * placements to the same suburb price, which erased the reason to choose one
 * over another.
 */
export const MINIMUM_MONTHLY_CENTS = 45000; // R450

/** The narrowest targeting set is what the buyer is actually paying for. */
export function targetLevel(targeting: {
  suburbSlug?: string | null;
  city?: string | null;
  province?: string | null;
}): TargetLevel {
  if (targeting.suburbSlug) return 'suburb';
  if (targeting.city) return 'city';
  if (targeting.province) return 'province';
  return 'national';
}

export function suggestedRateCents(
  placement: AdPlacementKey,
  targeting: { suburbSlug?: string | null; city?: string | null; province?: string | null },
): number {
  const base = BASE_RATES_CENTS[placement] ?? BASE_RATES_CENTS.board_sidebar;
  const level = targetLevel(targeting);
  const scaled = Math.round(base * TARGET_MULTIPLIERS[level]);

  // Rounded to the nearest R50 so the rate card reads like a price rather than
  // a calculation.
  const rounded = Math.round(scaled / 5000) * 5000;
  return Math.max(rounded, MINIMUM_MONTHLY_CENTS);
}

/** Full card, for the Advertise page and the admin form. */
export function rateCard() {
  const placements: AdPlacementKey[] = ['board_sidebar', 'board_inline', 'room_detail'];
  const levels: TargetLevel[] = ['national', 'province', 'city', 'suburb'];

  return placements.map((placement) => ({
    placement,
    rates: levels.map((level) => ({
      level,
      monthlyCents: suggestedRateCents(placement, {
        suburbSlug: level === 'suburb' ? 'x' : null,
        city: level === 'city' ? 'x' : null,
        province: level === 'province' ? 'x' : null,
      }),
    })),
  }));
}
