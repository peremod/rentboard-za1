import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp, resetDatabase, resetRateLimits, TestContext } from './support/test-app';
import { SAFE_SEGMENTS, TRACKED_EVENTS } from '../src/modules/analytics/analytics.service';

/**
 * UX analytics — what is NOT stored, asserted against the table.
 *
 * ── What is already checked, so this file does not re-check it
 *
 * `scripts/smoke-test.sh` §32 runs in CI and covers the access rules properly:
 * a tenant cannot read funnels, a landlord cannot read content signals, an
 * admin can read both, the funnels payload carries listingFunnel, applyFunnel
 * and featureUse, and no object in that payload has a userId, sessionId or ip.
 *
 * ── What nothing could check
 *
 * Two of its assertions cannot see their own subject, and both for the same
 * reason — POST /analytics/event answers 204 whatever it does with the body:
 *
 *   "event accepted anonymously (204)"
 *   "unknown event silently ignored, not stored"
 *
 * A stored event and a dropped one are indistinguishable from the response.
 * Delete the allowlist check in record() and both still pass. That is this
 * codebase's recurring defect — §97's notices drive, §98's view counting —
 * and the fix is the same: read the row, not the reply.
 *
 * The POPIA assertion has the same shape one layer down. It inspects the
 * funnels OUTPUT, so a column holding an identifier would satisfy it as long
 * as the aggregate query did not select that column. §98 made exactly this
 * point about `room_view_days`: "a weekly total is identical whether the table
 * holds one row per day or one per viewer per day."
 *
 * ── What this found
 *
 * ⚠️ There is no DTO on that endpoint. The body is an inline TypeScript type,
 * which erases at runtime, so the only guard on `segment` was
 * `segment.length <= 24` — on a PUBLIC, UNAUTHENTICATED endpoint, writing to
 * a column the schema describes as "Never anything that could identify a
 * person". Reproduced against the real API with no credentials:
 *
 *   POST {"event":"wizard.started","segment":"0821234567"} → 204
 *   select … from ux_counters → wizard.started | 0821234567 | 1
 *
 * `record()` takes an allowlist now. These cases are what holds it there.
 */
describe('UX analytics — a count, and nobody attached to it', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx?.close();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    await resetRateLimits(ctx);
  });

  /** The endpoint takes no credentials, which is half the point of it. */
  const report = (body: unknown) =>
    ctx.http().post('/api/analytics/event').send(body as object);

  const rows = () => ctx.prisma.uxCounter.findMany({ orderBy: { event: 'asc' } });

  it('keeps no column that could hold a person', async () => {
    const cols = await ctx.prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ux_counters'
    `;
    // toEqual, not toContain: the claim is that these are the ONLY columns.
    // A new one holding a userId would slip straight past a containment check.
    expect(cols.map((c) => c.column_name).sort())
      .toEqual(['count', 'day', 'event', 'id', 'segment']);
  });

  it('stores an allowlisted event as one row carrying only its dimensions', async () => {
    await report({ event: 'wizard.started', segment: 'mobile' }).expect(204);

    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].event).toBe('wizard.started');
    expect(all[0].segment).toBe('mobile');
    expect(all[0].count).toBe(1);
  });

  it('⚠️ stores NOTHING for an event that is not on the allowlist', async () => {
    // The assertion smoke cannot make: it reads the 204, which is identical.
    await report({ event: 'totally.made.up', segment: 'mobile' }).expect(204);
    await report({ event: '', segment: 'mobile' }).expect(204);
    expect(await rows()).toHaveLength(0);
  });

  it('⚠️ never stores a segment it was not expecting — the identifier does not land', async () => {
    // Each of these is something a public caller could post today. The column
    // is documented as "Never anything that could identify a person", and
    // until record() took an allowlist, every one of them was stored verbatim.
    const identifiers = ['0821234567', 'thabo@example.com', '9001015800087', 'Thabo M'];
    for (const segment of identifiers) {
      await report({ event: 'wizard.started', segment }).expect(204);
    }

    const all = await rows();
    for (const row of all) {
      expect(SAFE_SEGMENTS as readonly string[]).toContain(row.segment);
    }
    // And specifically: not one of them is in the table, anywhere.
    const stored = await ctx.prisma.uxCounter.findMany({ where: { segment: { in: identifiers } } });
    expect(stored).toHaveLength(0);
  });

  it('⚠️ counts a repeat rather than keeping a row per caller', async () => {
    // Per-caller rows would be a journey, not a count. The totals are
    // identical either way, which is why this is asserted on the ROWS.
    for (let i = 0; i < 3; i++) {
      await report({ event: 'room.viewed', segment: 'desktop' }).expect(204);
    }
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].count).toBe(3);
  });

  it('cannot record a time of day, because the column is a DATE', async () => {
    /**
     * ⚠️ This asserted the stored VALUE first — post an event, read the row
     * back, expect midnight — and it could not fail. Commenting out
     * `day.setUTCHours(0, 0, 0, 0)` in record() left all seven cases green,
     * because a Postgres `date` column truncates the time on write whatever
     * the service hands it. The test was measuring Postgres.
     *
     * "An exact timestamp plus a rare event is identifying" is the schema's
     * own reasoning, and the COLUMN TYPE is what keeps it. So that is what is
     * asserted. Change it to `timestamp` and this goes red; the service's
     * truncation is belt-and-braces on top.
     */
    const [col] = await ctx.prisma.$queryRaw<{ data_type: string }[]>`
      SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ux_counters' AND column_name = 'day'
    `;
    expect(col.data_type).toBe('date');
  });

  it('accepts every event the frontend is allowed to send', async () => {
    // A guard that silently dropped a real event would skew a funnel and
    // nothing would say so. The allowlist is exported, so this cannot drift.
    for (const event of TRACKED_EVENTS) {
      await report({ event, segment: 'mobile' }).expect(204);
    }
    expect(await rows()).toHaveLength(TRACKED_EVENTS.length);
  });
});
