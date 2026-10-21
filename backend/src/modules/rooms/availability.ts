/**
 * When a room is free, as a filter — the date half of the board's search.
 *
 * Extracted from RoomsService on 21 October so it can be tested. Both
 * functions were `private` methods there, which made the one rule in this
 * codebase that is a whole day wrong in both directions when it breaks the
 * one rule nothing could assert. Behaviour is unchanged: the bodies and their
 * reasoning moved across verbatim, and the service calls these.
 */

/**
 * The last instant of a South African day, as a UTC Date.
 *
 * ⚠️ This is a whole day of difference, twice over, and it is why the
 * comparison is not `new Date(dateString)`.
 *
 * `availableFrom` is stored from a date-only string, so it lands at midnight
 * UTC — 02:00 in Johannesburg. A tenant asking for 1 December means "any
 * time on the 1st, where I live". Comparing against midnight would drop a
 * room whose own availability date IS the 1st in any timezone west of us,
 * and a naive local-midnight comparison on a browser set to another zone
 * would drop or add a day depending on where the person happens to be.
 *
 * SAST has no daylight saving, so a fixed +02:00 is correct all year —
 * unlike the server's own locale, which is UTC. `ViewingsService.describe`
 * pins Africa/Johannesburg for the same reason: a time described two hours
 * out is somebody standing at a gate alone.
 */
export function endOfDaySast(dateOnly: string): Date | null {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(dateOnly)?.[0];
  if (!day) return null;
  const at = new Date(`${day}T23:59:59.999+02:00`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Fourteen days, the window "available now" means. */
export const AVAILABLE_NOW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The availability half of the where-clause, or nothing.
 *
 * Returns `{}` when no date filter is set, so the spread adds no key at all
 * — an `availableFrom: undefined` would be a Prisma filter on undefined
 * rather than no filter.
 *
 * `now` is injectable so a test can assert the fortnight without waiting a
 * fortnight; production never passes it.
 */
export function availabilityClause(
  availableNow?: boolean,
  moveIn?: string,
  moveInTo?: string,
  now: number = Date.now(),
): Record<string, unknown> {
  const bounds: Date[] = [];

  if (availableNow) bounds.push(new Date(now + AVAILABLE_NOW_WINDOW_MS));

  if (moveIn) {
    const from = endOfDaySast(moveIn);
    const to = moveInTo ? endOfDaySast(moveInTo) : null;
    if (from) {
      /**
       * ⚠️ The window's FAR end is the bound, not its start.
       *
       * Somebody flexible between the 1st and the 31st will take a room that
       * frees up on the 15th — and also one free today. The thing that
       * disqualifies a room is becoming free AFTER the last day they can
       * move. A clause of `gte: start` would have excluded every room
       * already standing empty, which is most of what they want to see.
       *
       * A window that ends before it begins is ignored rather than refused:
       * it is a typo in a date box, and an empty board with an error on it
       * teaches people the filter is broken.
       */
      bounds.push(to && to >= from ? to : from);
    }
  }

  if (!bounds.length) return {};
  // The tightest bound wins when more than one is set: somebody who ticked
  // "available now" AND typed a date in January means both, and the stricter
  // of the two is what both of them are true of.
  const tightest = bounds.reduce((a, b) => (a < b ? a : b));
  return { availableFrom: { lte: tightest } };
}
