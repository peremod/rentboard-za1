import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { monthStart, assertRentWindow } from './rent-period';

/**
 * Which months a landlord may record rent against.
 *
 * ⚠️ This is a LEDGER rule, not a convenience. Before it existed a landlord
 * could record rent for a month the tenant did not live there, on a tenancy
 * that had ended, or for next March — and `upsert` would create the row with
 * an amount snapshotted from a tenancy that was not running.
 *
 * Nothing here touches money custody: the platform does not hold rent. These
 * are the landlord's own records, which is exactly why they must be right.
 */

/** A tenancy that ran from June 2026 and is still running. */
const running = {
  status: 'active',
  startDate: new Date('2026-06-15T00:00:00.000Z'),
  endDate: null as Date | null,
};
/** "Now", fixed, so the suite does not change behaviour with the calendar. */
const NOW = new Date('2026-10-21T08:00:00.000Z');
const month = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('monthStart', () => {
  it('normalises any day of a month to its first instant in UTC', () => {
    expect(monthStart('2026-09-17T14:22:05.500Z').toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('is idempotent — the first of the month maps to itself', () => {
    const first = monthStart('2026-09-01');
    expect(monthStart(first).toISOString()).toBe(first.toISOString());
  });

  it('accepts a Date as readily as a string', () => {
    expect(monthStart(new Date('2026-09-17')).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('keeps two spellings of the same month identical', () => {
    // The unique constraint is on [tenancyId, periodStart]. Two rows for
    // September differing by a timezone offset would defeat it, and a
    // landlord would get two Septembers disagreeing about whether rent came.
    expect(monthStart('2026-09-30T23:00:00.000Z').getTime())
      .toBe(monthStart('2026-09-01T00:00:00.000Z').getTime());
  });

  it('rejects an unparseable date with a 400, not a crash', () => {
    expect(() => monthStart('not a date')).toThrow(BadRequestException);
    // The status matters: a 500 here would read as the server being broken
    // rather than the input being wrong.
    expect(() => monthStart('')).toThrow(BadRequestException);
  });
});

describe('assertRentWindow', () => {
  it('allows the month the tenant moved in', () => {
    expect(() => assertRentWindow(running, month('2026-06-01'), NOW)).not.toThrow();
  });

  it('allows the current month', () => {
    expect(() => assertRentWindow(running, month('2026-10-01'), NOW)).not.toThrow();
  });

  it('refuses a month before the tenant moved in', () => {
    expect(() => assertRentWindow(running, month('2026-05-01'), NOW))
      .toThrow(/before the tenant moved in/);
  });

  it('refuses a month that has not started yet', () => {
    expect(() => assertRentWindow(running, month('2026-11-01'), NOW))
      .toThrow(/has not started yet/);
  });

  it('refuses a cancelled tenancy outright', () => {
    expect(() => assertRentWindow({ ...running, status: 'cancelled' }, month('2026-07-01'), NOW))
      .toThrow(/was cancelled/);
  });

  it('refuses a pending tenancy, which the tenant screen already said', () => {
    expect(() => assertRentWindow({ ...running, status: 'pending' }, month('2026-07-01'), NOW))
      .toThrow(/has not started yet. Confirm the move-in/);
  });

  it('refuses a tenancy with no start date even when active', () => {
    expect(() => assertRentWindow({ ...running, startDate: null }, month('2026-07-01'), NOW))
      .toThrow(/Confirm the move-in/);
  });

  /**
   * The case the rule exists for. A tenant moves out on 30 September owing
   * that month; the landlord records it on 5 October. Freezing the ledger at
   * move-out would make the record wrong in the one case it matters most.
   */
  it('still allows recording against a FINISHED tenancy, within its months', () => {
    const ended = { status: 'ended', startDate: running.startDate, endDate: month('2026-09-30') };
    expect(() => assertRentWindow(ended, month('2026-09-01'), NOW)).not.toThrow();
  });

  it('refuses a month after the tenancy ended', () => {
    const ended = { status: 'ended', startDate: running.startDate, endDate: month('2026-09-30') };
    expect(() => assertRentWindow(ended, month('2026-10-01'), NOW))
      .toThrow(/after the tenancy ended/);
  });

  // ── Boundaries, each one exactly on the edge ──────────────────────────
  it('allows the first month of the letting but not the one before it', () => {
    expect(() => assertRentWindow(running, month('2026-06-01'), NOW)).not.toThrow();
    expect(() => assertRentWindow(running, month('2026-05-01'), NOW)).toThrow();
  });

  it('allows the final month of the letting but not the one after it', () => {
    const ended = { status: 'ended', startDate: running.startDate, endDate: month('2026-09-15') };
    // The END month itself is writable — the tenant lived part of it.
    expect(() => assertRentWindow(ended, month('2026-09-01'), NOW)).not.toThrow();
    expect(() => assertRentWindow(ended, month('2026-10-01'), NOW)).toThrow();
  });

  it('treats the current month as the latest writable one, not the next', () => {
    const now = new Date('2026-10-01T00:00:00.000Z'); // the very first instant
    expect(() => assertRentWindow(running, month('2026-10-01'), now)).not.toThrow();
    expect(() => assertRentWindow(running, month('2026-11-01'), now)).toThrow(/has not started/);
  });

  it('checks status before dates, so a cancelled future month names cancellation', () => {
    // Error precedence is behaviour: the landlord should be told the tenancy
    // was cancelled, not that the month has not started.
    expect(() => assertRentWindow({ ...running, status: 'cancelled' }, month('2027-01-01'), NOW))
      .toThrow(/was cancelled/);
  });
});
