import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp, resetDatabase, createLetting, signUp, TestContext } from './support/test-app';

/**
 * The rent ledger: which months may be written, by whom, and what is stored.
 *
 * ⚠️ This platform does NOT hold rent. These are the landlord's own records
 * of money that moved between two people elsewhere, which is exactly why they
 * have to be right — nobody can reconcile them against a statement here.
 *
 * The window rule itself is unit-tested in rent-period.spec.ts against a
 * fixed clock. What is tested HERE is different and cannot be faked: that the
 * rule is actually reached over HTTP, by the right people only, and that what
 * it allows is what lands in the database.
 */
describe('Rent records', () => {
  let ctx: TestContext;

  beforeAll(async () => { ctx = await createTestApp(); });
  afterAll(async () => { await ctx?.close(); });
  beforeEach(async () => { await resetDatabase(ctx.prisma); });

  /** confirm-start sets startDate to now, so the current month is the only writable one. */
  const monthOf = (offset: number) => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1))
      .toISOString().slice(0, 10);
  };

  async function activeLetting() {
    const f = await createLetting(ctx, 350000);
    await ctx.http().post(`/api/tenancies/${f.tenancy.id}/confirm-start`)
      .set(f.auth(f.landlord.token)).send({});
    return f;
  }

  const mark = (f: any, token: string, periodStart: string, status = 'paid') =>
    ctx.http().patch(`/api/properties/rent/${f.tenancy.id}/mark`)
      .set(f.auth(token)).send({ periodStart, status });

  // ── The happy path, asserted in the database ────────────────────────────
  it('records the current month as paid, snapshotting the amount', async () => {
    const f = await activeLetting();
    const res = await mark(f, f.landlord.token, monthOf(0));
    expect(res.status).toBe(200);

    const period = await ctx.prisma.rentPeriod.findFirst({
      where: { tenancyId: f.tenancy.id },
    });
    expect(period).toBeTruthy();
    expect(period!.status).toBe('paid');
    // The amount comes from the tenancy, not from the room, and not from the
    // request — a landlord cannot write an arbitrary figure into the ledger.
    expect(period!.amountCents).toBe(350000);
    expect(period!.periodStart.toISOString().slice(0, 7)).toBe(monthOf(0).slice(0, 7));
  });

  it.each(['paid', 'partial', 'waived', 'unpaid'])('accepts the %s status', async (status) => {
    const f = await activeLetting();
    expect((await mark(f, f.landlord.token, monthOf(0), status)).status).toBe(200);
    const period = await ctx.prisma.rentPeriod.findFirst({ where: { tenancyId: f.tenancy.id } });
    expect(period!.status).toBe(status);
  });

  it('is idempotent — marking the same month twice updates one row', async () => {
    const f = await activeLetting();
    await mark(f, f.landlord.token, monthOf(0), 'unpaid');
    await mark(f, f.landlord.token, monthOf(0), 'paid');

    const rows = await ctx.prisma.rentPeriod.findMany({ where: { tenancyId: f.tenancy.id } });
    // The unique constraint is on [tenancyId, periodStart]: two rows for one
    // month would be a ledger disagreeing with itself about whether rent came.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('paid');
  });

  it('normalises any day of the month to the first', async () => {
    const f = await activeLetting();
    const mid = monthOf(0).replace(/-01$/, '-17');
    await mark(f, f.landlord.token, mid);
    const period = await ctx.prisma.rentPeriod.findFirst({ where: { tenancyId: f.tenancy.id } });
    expect(period!.periodStart.toISOString()).toBe(`${monthOf(0)}T00:00:00.000Z`);
  });

  // ── The window rule, reached over HTTP ──────────────────────────────────
  it('refuses a month before the tenant moved in, and writes nothing', async () => {
    const f = await activeLetting();
    const res = await mark(f, f.landlord.token, monthOf(-1));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/before the tenant moved in/i);
    expect(await ctx.prisma.rentPeriod.count()).toBe(0);
  });

  it('refuses a month that has not started yet', async () => {
    const f = await activeLetting();
    const res = await mark(f, f.landlord.token, monthOf(1));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/has not started yet/i);
    expect(await ctx.prisma.rentPeriod.count()).toBe(0);
  });

  it('refuses a tenancy nobody has confirmed — there is no month to owe', async () => {
    const f = await createLetting(ctx); // still pending
    const res = await mark(f, f.landlord.token, monthOf(0));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not started yet|confirm the move-in/i);
    expect(await ctx.prisma.rentPeriod.count()).toBe(0);
  });

  it('still records against a FINISHED tenancy, which is the point of the rule', async () => {
    // A tenant moves out owing the month; the landlord records it afterwards.
    // Freezing the ledger at move-out would make it wrong when it matters most.
    const f = await activeLetting();
    await ctx.http().post(`/api/tenancies/${f.tenancy.id}/end`)
      .set(f.auth(f.landlord.token)).send({});

    const res = await mark(f, f.landlord.token, monthOf(0));
    expect(res.status).toBe(200);
    expect(await ctx.prisma.rentPeriod.count()).toBe(1);
  });

  // ── Authorization ───────────────────────────────────────────────────────
  it('refuses the TENANT the right to mark their own rent paid', async () => {
    const f = await activeLetting();
    const res = await mark(f, f.tenant.token, monthOf(0));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await ctx.prisma.rentPeriod.count()).toBe(0);
  });

  it("refuses another landlord the ledger of a letting that is not theirs", async () => {
    const f = await activeLetting();
    const intruder = await signUp(ctx, 'LANDLORD');
    const res = await mark(f, intruder.token, monthOf(0));
    expect([403, 404]).toContain(res.status);
    expect(await ctx.prisma.rentPeriod.count()).toBe(0);
  });

  it('rejects an unauthenticated write', async () => {
    const f = await activeLetting();
    await ctx.http().patch(`/api/properties/rent/${f.tenancy.id}/mark`)
      .send({ periodStart: monthOf(0), status: 'paid' }).expect(401);
    expect(await ctx.prisma.rentPeriod.count()).toBe(0);
  });

  // ── Invalid input ───────────────────────────────────────────────────────
  it.each([
    ['an unknown status', { periodStart: 'MONTH', status: 'settled' }],
    ['no status', { periodStart: 'MONTH' }],
    ['a non-date period', { periodStart: 'last month', status: 'paid' }],
    ['an unexpected field', { periodStart: 'MONTH', status: 'paid', amountCents: 1 }],
  ])('rejects %s with 400 and writes nothing', async (_label, body) => {
    const f = await activeLetting();
    const payload = JSON.parse(JSON.stringify(body).replace('MONTH', monthOf(0)));
    const res = await ctx.http().patch(`/api/properties/rent/${f.tenancy.id}/mark`)
      .set(f.auth(f.landlord.token)).send(payload);
    expect(res.status).toBe(400);
    expect(await ctx.prisma.rentPeriod.count()).toBe(0);
  });

  it('returns 400 or 404 for a tenancy that does not exist', async () => {
    const f = await activeLetting();
    const res = await ctx.http()
      .patch('/api/properties/rent/00000000-0000-0000-0000-000000000000/mark')
      .set(f.auth(f.landlord.token)).send({ periodStart: monthOf(0), status: 'paid' });
    expect([400, 403, 404]).toContain(res.status);
  });

  // ── The tenant's right to disagree ──────────────────────────────────────
  it('lets the tenant dispute a period, and keeps the landlord’s figure', async () => {
    const f = await activeLetting();
    await mark(f, f.landlord.token, monthOf(0), 'unpaid');
    const period = await ctx.prisma.rentPeriod.findFirst({ where: { tenancyId: f.tenancy.id } });

    const res = await ctx.http().patch(`/api/properties/rent/period/${period!.id}/dispute`)
      .set(f.auth(f.tenant.token)).send({ note: 'Paid on the 3rd by EFT.' });
    expect(res.status).toBe(200);

    const after = await ctx.prisma.rentPeriod.findUnique({ where: { id: period!.id } });
    // A dispute records disagreement; it does not silently flip the status.
    expect(after!.status).toBe('unpaid');
    expect(await ctx.prisma.rentPeriod.count()).toBe(1);
  });

  it('refuses a stranger the dispute', async () => {
    const f = await activeLetting();
    await mark(f, f.landlord.token, monthOf(0), 'unpaid');
    const period = await ctx.prisma.rentPeriod.findFirst({ where: { tenancyId: f.tenancy.id } });
    const stranger = await signUp(ctx, 'TENANT');

    const res = await ctx.http().patch(`/api/properties/rent/period/${period!.id}/dispute`)
      .set(f.auth(stranger.token)).send({ note: 'Not mine but I object.' });
    expect([403, 404]).toContain(res.status);
  });

  // ── No money, no messages ───────────────────────────────────────────────
  it('charges nobody and sends no WhatsApp while recording rent', async () => {
    const f = await activeLetting();
    ctx.outbox.payments.length = 0;
    ctx.outbox.whatsapps.length = 0;
    await mark(f, f.landlord.token, monthOf(0));

    expect(ctx.outbox.payments).toHaveLength(0);
    expect(ctx.outbox.whatsapps).toHaveLength(0);
  });
});
