import { describe, it, expect } from 'vitest';
import { endOfDaySast, availabilityClause, AVAILABLE_NOW_WINDOW_MS } from './availability';

/**
 * The date rule behind "when can you move in".
 *
 * This is the one rule in the codebase that is wrong by a WHOLE DAY in both
 * directions when it breaks, and until it was extracted nothing could assert
 * it. `availableFrom` is stored at midnight UTC — 02:00 in Johannesburg — so
 * a naive comparison drops a room whose availability date is the very day
 * somebody asked for.
 */
describe('endOfDaySast', () => {
  it('returns the last instant of the South African day, not the UTC one', () => {
    const at = endOfDaySast('2026-12-01')!;
    // 23:59:59.999 +02:00 is 21:59:59.999 UTC on the same date.
    expect(at.toISOString()).toBe('2026-12-01T21:59:59.999Z');
  });

  it('includes a room whose availableFrom is midnight UTC on that very day', () => {
    // The defect this rule exists to prevent: a room free "on the 1st" is
    // stored as 2026-12-01T00:00:00Z, and must satisfy a 1 December search.
    const storedAvailableFrom = new Date('2026-12-01T00:00:00.000Z');
    expect(storedAvailableFrom <= endOfDaySast('2026-12-01')!).toBe(true);
  });

  it('excludes a room that only frees up the next day', () => {
    const nextDay = new Date('2026-12-02T00:00:00.000Z');
    expect(nextDay <= endOfDaySast('2026-12-01')!).toBe(false);
  });

  it('accepts a full ISO timestamp by reading only its date part', () => {
    expect(endOfDaySast('2026-12-01T15:30:00Z')!.toISOString())
      .toBe('2026-12-01T21:59:59.999Z');
  });

  it.each([
    ['empty', ''],
    ['not a date', 'next tuesday'],
    ['wrong order', '01-12-2026'],
    ['truncated', '2026-12'],
  ])('returns null for %s input', (_label, input) => {
    expect(endOfDaySast(input)).toBeNull();
  });

  /**
   * ⚠️ DOCUMENTS A REAL BEHAVIOUR, and not the one I expected.
   *
   * I wrote this first as `expect(endOfDaySast('2026-02-31')).toBeNull()` and
   * it failed. JavaScript's Date does not reject a day that does not exist in
   * its month — it rolls over. So 31 February becomes 3 March, and 29
   * February in a non-leap year becomes 1 March. Only overflow past month 12
   * or day 31 is NaN, because that cannot be parsed at all.
   *
   * The test asserts what the code does rather than what I assumed, because a
   * suite that encodes a wish is worse than none. Whether the rollover should
   * be refused is a product question, raised in the report rather than
   * decided here: nothing may change a business rule to make a test pass.
   */
  it('rolls an impossible day over into the next month (JS Date semantics)', () => {
    expect(endOfDaySast('2026-02-31')!.toISOString()).toBe('2026-03-03T21:59:59.999Z');
    // 2026 is not a leap year.
    expect(endOfDaySast('2026-02-29')!.toISOString()).toBe('2026-03-01T21:59:59.999Z');
  });

  it.each([
    ['month 13', '2026-13-01'],
    ['day 32', '2026-12-32'],
  ])('returns null when %s cannot be parsed at all', (_label, input) => {
    expect(endOfDaySast(input)).toBeNull();
  });

  it('handles a leap day', () => {
    expect(endOfDaySast('2028-02-29')!.toISOString()).toBe('2028-02-29T21:59:59.999Z');
  });
});

describe('availabilityClause', () => {
  // A fixed clock, so "available now" is assertable without waiting.
  const NOW = Date.parse('2026-10-21T08:00:00.000Z');

  it('adds no key at all when nothing was asked for', () => {
    // Not `{ availableFrom: undefined }` — Prisma would read that as a filter
    // on undefined rather than as no filter.
    expect(availabilityClause(undefined, undefined, undefined, NOW)).toEqual({});
    expect(Object.keys(availabilityClause(false, '', '', NOW))).toHaveLength(0);
  });

  it('bounds "available now" to a fortnight from now', () => {
    const clause = availabilityClause(true, undefined, undefined, NOW) as any;
    expect(clause.availableFrom.lte.getTime()).toBe(NOW + AVAILABLE_NOW_WINDOW_MS);
  });

  it('bounds a single date to the end of that SAST day', () => {
    const clause = availabilityClause(false, '2026-12-01', undefined, NOW) as any;
    expect(clause.availableFrom.lte.toISOString()).toBe('2026-12-01T21:59:59.999Z');
  });

  it('uses the FAR end of a window, so empty rooms are not excluded', () => {
    // Somebody flexible across December will take a room free on the 15th and
    // one free today. Bounding on the window's start would hide every room
    // already standing empty — most of what they want to see.
    const clause = availabilityClause(false, '2026-12-01', '2026-12-31', NOW) as any;
    expect(clause.availableFrom.lte.toISOString()).toBe('2026-12-31T21:59:59.999Z');
  });

  it('ignores a window that ends before it begins, rather than refusing it', () => {
    // A typo in a date box. An empty board with an error on it teaches people
    // the filter is broken.
    const clause = availabilityClause(false, '2026-12-01', '2026-11-01', NOW) as any;
    expect(clause.availableFrom.lte.toISOString()).toBe('2026-12-01T21:59:59.999Z');
  });

  it('takes the tightest bound when both a chip and a date are set', () => {
    // "Available now" (a fortnight out) is tighter than a date in December.
    const clause = availabilityClause(true, '2026-12-01', undefined, NOW) as any;
    expect(clause.availableFrom.lte.getTime()).toBe(NOW + AVAILABLE_NOW_WINDOW_MS);
  });

  it('takes the date when the date is the tighter of the two', () => {
    // A date three days out beats the fortnight.
    const clause = availabilityClause(true, '2026-10-23', undefined, NOW) as any;
    expect(clause.availableFrom.lte.toISOString()).toBe('2026-10-23T21:59:59.999Z');
  });

  it('ignores an unparseable date instead of filtering on nothing', () => {
    expect(availabilityClause(false, 'whenever', undefined, NOW)).toEqual({});
  });

  it('ignores moveInTo when moveIn is absent', () => {
    expect(availabilityClause(false, undefined, '2026-12-31', NOW)).toEqual({});
  });
});
