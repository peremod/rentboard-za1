/**
 * Mastande's own adverts — the single definition of their copy.
 *
 * Two jobs. An empty slot is wasted space, so unsold inventory promotes the
 * site instead of showing nothing. And a permanently running nationwide
 * campaign gives the reach analysis a baseline — without one there is nothing
 * to compare a suburb campaign against, and the rate card cannot be checked.
 *
 * They never displace a paid placement: house ads are ranked after every paid
 * campaign regardless of targeting.
 *
 * ── Why this is a module of its own ─────────────────────────────────────────
 *
 * Both prisma/seed.ts and prisma/seed-house-ads.ts write these rows, and the
 * obvious way to share them — importing from seed.ts — does not work: seed.ts
 * calls main() at the top level, so importing it runs the entire seed and then
 * exits 1 on missing admin credentials. Duplicating the copy instead would
 * recreate the exact bug the re-seed script exists to fix, which is that
 * production still says "New to RentBoard?" because one copy of this text went
 * unrun since the rename. So: one file, no side effects, imported by both.
 */

// Fixed, valid UUIDs so the seed is idempotent. 'ad' and 'b0' are hex; a
// readable-but-invalid id like '...house1' fails at insert.
export const HOUSE_ADVERTISER_ID = '00000000-0000-0000-0000-0000000000b0';

export const HOUSE_ADVERTISER = {
  id: HOUSE_ADVERTISER_ID,
  companyName: 'Mastande',
  contactName: 'Mastande',
  contactEmail: 'hello@umastande.co.za',
  notes: 'House ads. Not a paying advertiser — do not invoice.',
};

export const HOUSE_ADS = [
  {
    id: '00000000-0000-0000-0000-0000000000b1',
    name: '[HOUSE] How it works — sidebar',
    placement: 'board_sidebar' as const,
    headline: 'New to Mastande?',
    body: 'No agents, no application fees. See how renting direct from landlords works.',
    ctaLabel: 'How it works',
    targetUrl: '/how-it-works',
  },
  {
    id: '00000000-0000-0000-0000-0000000000b2',
    name: '[HOUSE] List a room — in-grid',
    placement: 'board_inline' as const,
    headline: 'Have a room to let?',
    body: 'Listing is free, and always will be. No commission, no agent in the middle.',
    ctaLabel: 'List a room free',
    targetUrl: '/auth/register',
  },
  {
    id: '00000000-0000-0000-0000-0000000000b3',
    name: '[HOUSE] Safety — room detail',
    placement: 'room_detail' as const,
    headline: 'Before you pay a deposit',
    body: 'View the room in person, insist on a written lease, and never pay before you see it.',
    ctaLabel: 'Read the guidance',
    targetUrl: '/how-it-works',
  },
];

/** The full row an advert becomes. Nationwide, free, and never displacing a paid slot. */
export function houseAdRow(ad: (typeof HOUSE_ADS)[number]) {
  const now = new Date();
  return {
    ...ad,
    advertiserId: HOUSE_ADVERTISER_ID,
    // Nationwide on purpose: this is the baseline every targeted campaign is
    // measured against.
    province: null,
    city: null,
    suburbSlug: null,
    startsAt: now,
    endsAt: new Date('2099-01-01'),
    monthlyRateCents: 0,
    status: 'active' as const,
    approvedAt: now,
    isHouseAd: true,
  };
}
