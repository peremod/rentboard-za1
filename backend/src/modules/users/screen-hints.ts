/**
 * The screens that carry a first-use hint.
 *
 * ⚠️ An allowlist, not free text, and that is a size limit as much as a
 * spelling check. `hintsSeen` is an unbounded `text[]` on the account: an
 * endpoint that accepted any string would let a signed-in client push rows into
 * it until the row stopped fitting, and the account that broke would be the
 * attacker's own — which is exactly the kind of thing nobody notices until a
 * real person's account is the one that will not load.
 *
 * It is also the list the UI is checked against: a hint whose key is not here
 * cannot be dismissed, so `scripts/hints-drive.mjs` asserts every key used in a
 * template appears below. A hint that cannot be put away is worse than no hint.
 */
export const SCREEN_HINTS = [
  'landlord-dashboard',
  'landlord-properties',
  'landlord-property',
  'landlord-applicants',
  'landlord-rooms-new',
  'landlord-verification',
  'messages',
  'tenant-dashboard',
  'tenant-rent',
] as const;

export type ScreenHintKey = (typeof SCREEN_HINTS)[number];

export const isScreenHint = (k: string): k is ScreenHintKey =>
  (SCREEN_HINTS as readonly string[]).includes(k);
