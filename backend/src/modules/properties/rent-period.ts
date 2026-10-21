import { BadRequestException } from '@nestjs/common';

/**
 * Which month a rent record belongs to, and whether it may be written at all.
 *
 * Extracted from RentService on 21 October so it can be tested. Both were
 * `private` methods there and neither touched the database — they decide,
 * from a tenancy's own dates, whether a month is part of the letting. That is
 * the rule that stops a landlord recording rent for a month the tenant did
 * not live there, and nothing could assert it.
 *
 * Behaviour unchanged: bodies and reasoning moved verbatim, and RentService
 * calls these. BadRequestException is kept rather than swapped for a plain
 * Error, because the HTTP status it produces is part of the behaviour the
 * API promises — a test that accepted any throw would not notice it becoming
 * a 500.
 */

/**
 * The first instant of the month a date falls in, in UTC.
 *
 * Normalised because the unique constraint is on [tenancyId, periodStart]:
 * two rows for "September" differing by a timezone offset would defeat it,
 * and a landlord would end up with two Septembers disagreeing about whether
 * rent arrived.
 */
export function monthStart(date: string | Date): Date {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('That is not a valid date.');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Whether a month may be written against this tenancy at all.
 *
 * ── Why this is a window and not a status check
 *
 * `mark()` refused `cancelled` and nothing else. So on a tenancy that had
 * ENDED a landlord could still mark months, and on any tenancy they could
 * mark a month before the tenant moved in, a month after they moved out, or
 * next March — `upsert` would happily create the row, with `amountCents`
 * snapshotted from a tenancy that was not running.
 *
 * The invariant is not "the tenancy is active". It is **a rent period
 * belongs to the months the tenancy actually covered**, which is true of a
 * finished letting as much as a live one. That distinction matters, because
 * refusing every write on an `ended` tenancy would break the most ordinary
 * thing there is: a tenant moves out on the 30th owing that month, and the
 * landlord records it on the 5th. Freezing the ledger at the moment of
 * move-out would make the record wrong in the one case it is most needed.
 *
 * So: the months of the letting stay writable; everything outside them does
 * not.
 *
 * `now` is injectable so "that month has not started yet" can be tested
 * against a fixed clock instead of whatever month the suite happens to run
 * in; production never passes it.
 */
export function assertRentWindow(
  tenancy: { status: string; startDate: Date | null; endDate: Date | null },
  periodStart: Date,
  now: Date = new Date(),
): void {
  if (tenancy.status === 'cancelled') {
    throw new BadRequestException('That tenancy was cancelled — there is no rent to record.');
  }
  // `pending` means nobody has confirmed the move-in, so there is no month
  // to be in arrears on. The tenant's rent screen has always said exactly
  // this — "Your move-in is not confirmed yet, so there is no rent record" —
  // while the API accepted the write anyway.
  if (tenancy.status === 'pending' || !tenancy.startDate) {
    throw new BadRequestException(
      'This tenancy has not started yet. Confirm the move-in first, then the rent record opens.',
    );
  }

  const firstMonth = monthStart(tenancy.startDate);
  if (periodStart < firstMonth) {
    throw new BadRequestException(
      'That month is before the tenant moved in, so it is not part of this tenancy.',
    );
  }

  // Not the future. Rent is due at the start of a month, so the CURRENT
  // month is fair game; the one after it has not begun.
  const thisMonth = monthStart(now);
  if (periodStart > thisMonth) {
    throw new BadRequestException('That month has not started yet.');
  }

  if (tenancy.endDate) {
    const lastMonth = monthStart(tenancy.endDate);
    if (periodStart > lastMonth) {
      throw new BadRequestException(
        'That month is after the tenancy ended, so it is not part of this tenancy.',
      );
    }
  }
}
