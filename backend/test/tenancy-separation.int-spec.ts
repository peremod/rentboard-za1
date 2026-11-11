import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestApp, resetDatabase, resetRateLimits, createLetting, signUp, TestContext,
} from './support/test-app';

/**
 * Two tenancies, and nothing of one leaking into the other.
 *
 * ── The gap this closes
 *
 * The data-integrity brief asks for two things about tenancy history. The
 * first — that ending a tenancy does not destroy the record — is covered:
 * `rent-records.int-spec.ts` writes rent against a FINISHED tenancy on
 * purpose, and `account-lifecycle.int-spec.ts` keeps the other party's
 * conversation, review and rent history when an account is closed.
 *
 * The second was not covered at all: that records belonging to SEPARATE
 * tenancies do not become mixed when the same tenant or the same landlord is
 * in several. The one existing test that looks like it (`is idempotent about
 * opening a tenancy`) is about two acceptances of ONE application, which is a
 * different question.
 *
 * ── Why it matters here specifically
 *
 * `RentPeriod` is keyed `@@unique([tenancyId, periodStart])` — so the schema
 * is right, and that is exactly what makes the application the thing worth
 * testing. Every leak of this kind comes from a QUERY keyed on something
 * other than the tenancy: on the room, on the tenant, on the landlord. The
 * schema cannot stop that, and a unique constraint that is never violated
 * proves nothing about what a handler returns.
 *
 * The product has already shipped one bug of this exact family, this month:
 * checklist row 133, where the landlord's screen read the TENANCY's status to
 * decide whether an APPLICATION was still open, so a tenant who had been let
 * a room, moved out, and applied again appeared nowhere at all. That is the
 * same mistake one level up — a question answered by the wrong row.
 *
 * ⚠️ The hardest case is the one the suite had no fixture for: the same tenant
 * and the same room, twice, sequentially. There every id except the tenancy's
 * is identical, so a handler keyed on room or tenant looks correct until the
 * day somebody is let the same back room a second time — which in a market of
 * single back rooms is a normal Tuesday, not an edge case.
 */
describe('Separate tenancies stay separate', () => {
  let ctx: TestContext;

  beforeAll(async () => { ctx = await createTestApp(); });
  afterAll(async () => { await ctx?.close(); });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    await resetRateLimits(ctx);
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const monthOf = (offset: number) => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1))
      .toISOString().slice(0, 10);
  };

  const mark = (tenancyId: string, token: string, periodStart: string, status = 'paid') =>
    ctx.http().patch(`/api/properties/rent/${tenancyId}/mark`)
      .set(auth(token)).send({ periodStart, status });

  const ledger = (tenancyId: string, token: string) =>
    ctx.http().get(`/api/properties/rent/${tenancyId}`).set(auth(token));

  /** A room on a landlord's existing yard, published and ready to apply to. */
  async function extraRoom(landlordToken: string, propertyId: string, title: string, rentCents: number) {
    const room = await ctx.http().post('/api/rooms').set(auth(landlordToken)).send({
      title,
      description:
        'A private back room with its own entrance and a separate gate key. ' +
        'Shared kitchen and outside tap. Close to the taxi rank and the clinic.',
      roomType: 'shared_house',
      rentCents,
      province: 'Gauteng',
      city: 'Johannesburg',
      locationDisplay: 'Tembisa, Johannesburg',
      availableFrom: '2026-06-01',
      propertyId,
    }).expect(201);
    await ctx.http().patch(`/api/rooms/${room.body.id}`).set(auth(landlordToken))
      .send({ heroImagePath: '/integration-test-placeholder.jpg' }).expect(200);
    await ctx.http().post(`/api/rooms/${room.body.id}/publish`)
      .set(auth(landlordToken)).send({}).expect(200);
    return room.body.id as string;
  }

  /**
   * Apply, accept, and wait for the tenancy.
   *
   * ⚠️ POLLED, like `createLetting`: `accept()` opens the tenancy
   * fire-and-forget so that a failure to open one cannot fail the
   * acceptance, so the row lands shortly AFTER the response.
   */
  async function letRoom(roomId: string, tenantToken: string, landlordToken: string) {
    const application = await ctx.http().post('/api/applications').set(auth(tenantToken)).send({
      roomId, coverNote: 'I would like to apply for this room, thank you.',
    }).expect(201);
    await ctx.http().post(`/api/applications/${application.body.id}/accept`)
      .set(auth(landlordToken)).send({}).expect(200);

    let tenancy = null as any;
    for (let i = 0; i < 50 && !tenancy; i++) {
      tenancy = await ctx.prisma.tenancy.findUnique({
        where: { applicationId: application.body.id },
      });
      if (!tenancy) await new Promise((r) => setTimeout(r, 40));
    }
    if (!tenancy) throw new Error('no tenancy opened');

    await ctx.http().post(`/api/tenancies/${tenancy.id}/confirm-start`)
      .set(auth(landlordToken)).send({}).expect(200);
    return { tenancy, applicationId: application.body.id as string };
  }

  describe('one tenant, two rooms from the same landlord', () => {
    it('keeps each rent ledger to its own tenancy', async () => {
      const first = await createLetting(ctx, 350000);
      await ctx.http().post(`/api/tenancies/${first.tenancy.id}/confirm-start`)
        .set(auth(first.landlord.token)).send({}).expect(200);

      // The SAME tenant, a second room on the same yard.
      const secondRoomId = await extraRoom(
        first.landlord.token, first.propertyId, 'The other back room', 420000);
      const second = await letRoom(secondRoomId, first.tenant.token, first.landlord.token);

      expect(second.tenancy.id).not.toBe(first.tenancy.id);

      await mark(first.tenancy.id, first.landlord.token, monthOf(0), 'paid').expect(200);
      await mark(second.tenancy.id, first.landlord.token, monthOf(0), 'unpaid').expect(200);

      // One row each, in the database, keyed by tenancy.
      const rows = await ctx.prisma.rentPeriod.findMany({
        where: { tenancyId: { in: [first.tenancy.id, second.tenancy.id] } },
        select: { tenancyId: true, status: true, amountCents: true },
      });
      expect(rows.length, `rent rows: ${JSON.stringify(rows)}`).toBe(2);

      /**
       * ⚠️ And the AMOUNTS have to differ, which is what makes this test able
       * to fail. Two rows with identical figures would look correct whichever
       * tenancy each belonged to; 3500 against 4200 cannot be confused.
       */
      const a = rows.find((r) => r.tenancyId === first.tenancy.id)!;
      const b = rows.find((r) => r.tenancyId === second.tenancy.id)!;
      expect(a.status).toBe('paid');
      expect(a.amountCents).toBe(350000);
      expect(b.status).toBe('unpaid');
      expect(b.amountCents).toBe(420000);

      // And over HTTP, which is where a query keyed on the tenant would leak.
      const ledgerA = await ledger(first.tenancy.id, first.landlord.token).expect(200);
      const ledgerB = await ledger(second.tenancy.id, first.landlord.token).expect(200);
      const periodsOf = (body: any) => body.periods ?? body.rentPeriods ?? body;
      expect(periodsOf(ledgerA.body).length, 'the first ledger carried the second tenancy\'s rent').toBe(1);
      expect(periodsOf(ledgerB.body).length, 'the second ledger carried the first tenancy\'s rent').toBe(1);
      expect(periodsOf(ledgerA.body)[0].amountCents).toBe(350000);
      expect(periodsOf(ledgerB.body)[0].amountCents).toBe(420000);
    });

    it('ending one leaves the other active and its history intact', async () => {
      const first = await createLetting(ctx, 350000);
      await ctx.http().post(`/api/tenancies/${first.tenancy.id}/confirm-start`)
        .set(auth(first.landlord.token)).send({}).expect(200);
      const secondRoomId = await extraRoom(
        first.landlord.token, first.propertyId, 'The other back room', 420000);
      const second = await letRoom(secondRoomId, first.tenant.token, first.landlord.token);

      await mark(first.tenancy.id, first.landlord.token, monthOf(0), 'paid').expect(200);
      await mark(second.tenancy.id, first.landlord.token, monthOf(0), 'paid').expect(200);

      await ctx.http().post(`/api/tenancies/${first.tenancy.id}/end`)
        .set(auth(first.landlord.token))
        .send({ reason: 'The tenant moved to the bigger room.' }).expect(200);

      const ended = await ctx.prisma.tenancy.findUniqueOrThrow({ where: { id: first.tenancy.id } });
      const live = await ctx.prisma.tenancy.findUniqueOrThrow({ where: { id: second.tenancy.id } });
      expect(ended.status).toBe('ended');
      expect(live.status, 'ending one tenancy changed the other\'s status').toBe('active');
      // `endDate`, not `endedAt` — the field name was checked against the
      // schema after the first version of this assertion read `undefined`
      // and so could have passed on any field that does not exist.
      expect(ended.endDate, 'the ended tenancy was not stamped').toBeTruthy();
      expect(live.endDate, 'ending one tenancy stamped the other').toBeNull();
      expect(live.reviewsCloseAt, 'ending one opened the other\'s review window').toBeNull();

      /**
       * The brief's first half, at the point where it is most likely to go
       * wrong: both ledgers survive an ending, and the ENDED one keeps its
       * row. A cascade written against the tenant rather than the tenancy
       * would take both.
       */
      const rows = await ctx.prisma.rentPeriod.findMany({
        where: { tenancyId: { in: [first.tenancy.id, second.tenancy.id] } },
        select: { tenancyId: true },
      });
      expect(rows.filter((r) => r.tenancyId === first.tenancy.id).length,
        'the ended tenancy lost its rent history').toBe(1);
      expect(rows.filter((r) => r.tenancyId === second.tenancy.id).length,
        'the live tenancy lost its rent history').toBe(1);
    });
  });

  describe('the same tenant and the same room, twice', () => {
    /**
     * 🔴 The case where every id but the tenancy's is identical.
     *
     * Let, ended, relisted, applied for again, accepted again. This is the
     * sequence behind checklist row 133, and the only thing distinguishing
     * the two lettings in any query is `tenancyId`.
     */
    async function twiceLet() {
      const f = await createLetting(ctx, 350000);
      await ctx.http().post(`/api/tenancies/${f.tenancy.id}/confirm-start`)
        .set(auth(f.landlord.token)).send({}).expect(200);
      await mark(f.tenancy.id, f.landlord.token, monthOf(0), 'paid').expect(200);
      await ctx.http().post(`/api/tenancies/${f.tenancy.id}/end`)
        .set(auth(f.landlord.token))
        .send({ reason: 'Moved back to the Eastern Cape for a year.' }).expect(200);

      // Back on the board, same room.
      await ctx.http().post(`/api/rooms/${f.roomId}/relist`)
        .set(auth(f.landlord.token)).send({ availableFrom: '2026-09-01' }).expect(200);

      const again = await letRoom(f.roomId, f.tenant.token, f.landlord.token);
      return { f, again };
    }

    it('opens a second, distinct tenancy on the same room for the same tenant', async () => {
      const { f, again } = await twiceLet();

      expect(again.tenancy.id).not.toBe(f.tenancy.id);
      expect(again.tenancy.roomId).toBe(f.tenancy.roomId);
      expect(again.tenancy.tenantId).toBe(f.tenancy.tenantId);
      // Two tenancies on one room is correct here; two ACTIVE ones never is.
      const all = await ctx.prisma.tenancy.findMany({ where: { roomId: f.roomId } });
      expect(all.length).toBe(2);
      expect(all.filter((t) => t.status === 'active').length,
        'the same room is let twice at once').toBe(1);
    });

    it('does not carry the first letting\'s rent into the second', async () => {
      const { f, again } = await twiceLet();

      // Nothing has been marked against the new tenancy yet.
      const fresh = await ctx.prisma.rentPeriod.findMany({ where: { tenancyId: again.tenancy.id } });
      expect(fresh, `the new letting started with rent on it: ${JSON.stringify(fresh)}`).toEqual([]);

      const old = await ctx.prisma.rentPeriod.findMany({ where: { tenancyId: f.tenancy.id } });
      expect(old.length, 'the first letting lost its rent history on relisting').toBe(1);

      const freshLedger = await ledger(again.tenancy.id, f.landlord.token).expect(200);
      const periods = freshLedger.body.periods ?? freshLedger.body.rentPeriods ?? freshLedger.body;
      expect(periods.length,
        'the new ledger showed the previous letting\'s months').toBe(0);
    });

    it('lets the same month be marked once per letting, not once per room', async () => {
      const { f, again } = await twiceLet();

      /**
       * ⚠️ The same `periodStart` on both. `@@unique([tenancyId,
       * periodStart])` permits it; a constraint keyed on the room would not,
       * and a handler that looked the period up by room would quietly update
       * the OLD letting's row instead of creating one.
       */
      await mark(again.tenancy.id, f.landlord.token, monthOf(0), 'unpaid').expect(200);

      const rows = await ctx.prisma.rentPeriod.findMany({
        where: { tenancy: { roomId: f.roomId } },
        select: { tenancyId: true, status: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.length, `one row per letting expected: ${JSON.stringify(rows)}`).toBe(2);
      expect(rows.find((r) => r.tenancyId === f.tenancy.id)!.status,
        'marking the new letting overwrote the old one').toBe('paid');
      expect(rows.find((r) => r.tenancyId === again.tenancy.id)!.status).toBe('unpaid');
    });
  });

  describe('one landlord, two tenants', () => {
    it('refuses each tenant the other\'s ledger', async () => {
      const first = await createLetting(ctx, 350000);
      await ctx.http().post(`/api/tenancies/${first.tenancy.id}/confirm-start`)
        .set(auth(first.landlord.token)).send({}).expect(200);
      const secondRoomId = await extraRoom(
        first.landlord.token, first.propertyId, 'The other back room', 420000);
      const otherTenant = await signUp(ctx, 'TENANT');
      const second = await letRoom(secondRoomId, otherTenant.token, first.landlord.token);

      await mark(first.tenancy.id, first.landlord.token, monthOf(0), 'paid').expect(200);
      await mark(second.tenancy.id, first.landlord.token, monthOf(0), 'paid').expect(200);

      // Each tenant sees their own.
      await ledger(first.tenancy.id, first.tenant.token).expect(200);
      await ledger(second.tenancy.id, otherTenant.token).expect(200);

      /**
       * And not the other's. Asserted as a set rather than a single status so
       * that a 200 carrying somebody else's rent fails here — the refusal is
       * the point, but a 404 that leaked a body would pass a status check.
       */
      const crossed = await ledger(second.tenancy.id, first.tenant.token);
      expect([403, 404], `a tenant read another tenant's ledger: ${crossed.status}`)
        .toContain(crossed.status);
      expect(JSON.stringify(crossed.body)).not.toContain('420000');

      const other = await ledger(first.tenancy.id, otherTenant.token);
      expect([403, 404]).toContain(other.status);
      expect(JSON.stringify(other.body)).not.toContain('350000');
    });

    it('keeps the landlord\'s two ledgers apart', async () => {
      const first = await createLetting(ctx, 350000);
      await ctx.http().post(`/api/tenancies/${first.tenancy.id}/confirm-start`)
        .set(auth(first.landlord.token)).send({}).expect(200);
      const secondRoomId = await extraRoom(
        first.landlord.token, first.propertyId, 'The other back room', 420000);
      const otherTenant = await signUp(ctx, 'TENANT');
      const second = await letRoom(secondRoomId, otherTenant.token, first.landlord.token);

      await mark(first.tenancy.id, first.landlord.token, monthOf(0), 'paid').expect(200);
      await mark(second.tenancy.id, first.landlord.token, monthOf(0), 'unpaid').expect(200);

      const a = await ledger(first.tenancy.id, first.landlord.token).expect(200);
      const b = await ledger(second.tenancy.id, first.landlord.token).expect(200);
      const periodsOf = (body: any) => body.periods ?? body.rentPeriods ?? body;
      expect(periodsOf(a.body).map((p: any) => p.amountCents)).toEqual([350000]);
      expect(periodsOf(b.body).map((p: any) => p.amountCents)).toEqual([420000]);
    });
  });
});
