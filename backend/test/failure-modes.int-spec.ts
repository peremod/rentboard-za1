import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp, resetDatabase, createLetting, TestContext } from './support/test-app';

/**
 * What happens when things go wrong: duplicates, rollbacks, and records that
 * must move together or not at all.
 */
describe('Failure modes', () => {
  let ctx: TestContext;

  beforeAll(async () => { ctx = await createTestApp(); });
  afterAll(async () => { await ctx?.close(); });
  beforeEach(async () => { await resetDatabase(ctx.prisma); });

  // ── Rollback, observed rather than assumed ──────────────────────────────
  it('rolls back every statement in a transaction when one fails', async () => {
    const f = await createLetting(ctx);
    const before = await ctx.prisma.room.findUnique({ where: { id: f.roomId } });

    await expect(
      ctx.prisma.$transaction(async (tx) => {
        await tx.room.update({ where: { id: f.roomId }, data: { title: 'Changed inside a tx' } });
        // Inside the same transaction, something fails. Everything above it
        // must be undone — this is the guarantee 32 call sites rely on and
        // that nothing in this repository asserted.
        await tx.room.update({
          where: { id: '00000000-0000-0000-0000-000000000000' },
          data: { title: 'no such room' },
        });
      }),
    ).rejects.toThrow();

    const after = await ctx.prisma.room.findUnique({ where: { id: f.roomId } });
    expect(after!.title).toBe(before!.title);
  });

  it('commits the whole transaction when nothing fails', async () => {
    // The other half: a rollback test that passes because nothing ever
    // commits would be worthless.
    const f = await createLetting(ctx);
    await ctx.prisma.$transaction(async (tx) => {
      await tx.room.update({ where: { id: f.roomId }, data: { title: 'Committed' } });
      await tx.property.update({ where: { id: f.propertyId }, data: { suburb: 'Ivory Park' } });
    });

    expect((await ctx.prisma.room.findUnique({ where: { id: f.roomId } }))!.title).toBe('Committed');
    expect((await ctx.prisma.property.findUnique({ where: { id: f.propertyId } }))!.suburb)
      .toBe('Ivory Park');
  });

  // ── Related records move together ───────────────────────────────────────
  it('cancelling a letting moves the tenancy, the application and the room as one', async () => {
    const f = await createLetting(ctx);
    const res = await ctx.http().post(`/api/tenancies/${f.tenancy.id}/cancel`)
      .set(f.auth(f.landlord.token)).send({ reason: 'The tenant found somewhere else.' });
    expect(res.status).toBeLessThan(400);

    const [tenancy, application, room] = await Promise.all([
      ctx.prisma.tenancy.findUnique({ where: { id: f.tenancy.id } }),
      ctx.prisma.application.findUnique({ where: { id: f.applicationId } }),
      ctx.prisma.room.findUnique({ where: { id: f.roomId } }),
    ]);

    // Three records, one outcome. If any of these were written outside the
    // transaction, a failure part-way would leave a cancelled tenancy whose
    // room is still let, or a let room with no tenancy — the inconsistent
    // state this assertion exists to rule out.
    expect(tenancy!.status).toBe('cancelled');
    expect(application!.archivedAt).toBeInstanceOf(Date);
    expect(room!.status).toBe('active');
    expect(room!.letAt).toBeNull();
  });

  // ── Duplicate submission ────────────────────────────────────────────────
  it('refuses a second application to the same room, leaving exactly one', async () => {
    const f = await createLetting(ctx);
    const second = await ctx.http().post('/api/applications')
      .set(f.auth(f.tenant.token))
      .send({ roomId: f.roomId, coverNote: 'Applying again by accident.' });

    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(await ctx.prisma.application.count({
      where: { roomId: f.roomId, tenantId: f.tenancy.tenantId },
    })).toBe(1);
  });

  it('a duplicate rent mark updates rather than duplicating', async () => {
    const f = await createLetting(ctx);
    await ctx.http().post(`/api/tenancies/${f.tenancy.id}/confirm-start`)
      .set(f.auth(f.landlord.token)).send({});
    const d = new Date();
    const month = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);

    await Promise.all([
      ctx.http().patch(`/api/properties/rent/${f.tenancy.id}/mark`)
        .set(f.auth(f.landlord.token)).send({ periodStart: month, status: 'paid' }),
      ctx.http().patch(`/api/properties/rent/${f.tenancy.id}/mark`)
        .set(f.auth(f.landlord.token)).send({ periodStart: month, status: 'unpaid' }),
    ]);

    // Two writes racing for one month. Whichever lands last, there must be
    // one row: the unique constraint is the ledger's only defence against
    // two Septembers disagreeing.
    expect(await ctx.prisma.rentPeriod.count({ where: { tenancyId: f.tenancy.id } })).toBe(1);
  });

  // ── Missing and malformed records ───────────────────────────────────────
  it.each([
    ['a well-formed id that matches nothing', '00000000-0000-0000-0000-000000000000'],
    ['an id that is not a uuid', 'not-a-uuid'],
  ])('handles %s without a 500', async (_label, id) => {
    const f = await createLetting(ctx);
    const res = await ctx.http().post(`/api/tenancies/${id}/confirm-start`)
      .set(f.auth(f.landlord.token)).send({});
    // A 4xx is the application saying no. A 5xx is the application falling
    // over, which is what this rules out.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  /**
   * Undoing an acceptance must take the tenancy with it — §79a, now fixed.
   *
   * Before the fix the undo restored the application and the room and left
   * the tenancy behind, and that leftover was not an inert row: confirm-start
   * on it returned 200, the tenancy went active, the room stayed on the
   * public board, and another tenant could apply. A room let and advertised
   * at the same time.
   */
  it('removes the tenancy when an acceptance is undone', async () => {
    const f = await createLetting(ctx);
    const undo = await ctx.http().post(`/api/applications/${f.applicationId}/undo-accept`)
      .set(f.auth(f.landlord.token)).send({});
    expect(undo.status).toBeLessThan(400);

    // The three records move together, or the undo is not an undo.
    const application = await ctx.prisma.application.findUnique({ where: { id: f.applicationId } });
    const room = await ctx.prisma.room.findUnique({ where: { id: f.roomId } });
    expect(application!.status).not.toBe('accepted');
    expect(room!.status).toBe('active');
    expect(await ctx.prisma.tenancy.count({ where: { applicationId: f.applicationId } })).toBe(0);
  });

  it('cannot confirm a move-in for an acceptance that was undone', async () => {
    // The assertion that made §79a serious rather than cosmetic.
    const f = await createLetting(ctx);
    await ctx.http().post(`/api/applications/${f.applicationId}/undo-accept`)
      .set(f.auth(f.landlord.token)).send({}).expect(200);

    const confirm = await ctx.http().post(`/api/tenancies/${f.tenancy.id}/confirm-start`)
      .set(f.auth(f.landlord.token)).send({});
    expect(confirm.status).toBeGreaterThanOrEqual(400);
    expect(await ctx.prisma.tenancy.count()).toBe(0);
  });

  /**
   * ⚠️ The case that decided DELETE over CANCEL.
   *
   * `createFromApplication` returns any existing tenancy for an application
   * rather than opening a new one. A tenancy left behind as `cancelled`
   * would therefore be handed straight back here, and the room would be let
   * against a cancelled record. This asserts the opposite: accepting again
   * opens a fresh, pending tenancy.
   */
  it('opens a fresh pending tenancy when the same applicant is accepted again', async () => {
    const f = await createLetting(ctx);
    await ctx.http().post(`/api/applications/${f.applicationId}/undo-accept`)
      .set(f.auth(f.landlord.token)).send({}).expect(200);

    await ctx.http().post(`/api/applications/${f.applicationId}/accept`)
      .set(f.auth(f.landlord.token)).send({}).expect(200);

    let reopened = null as any;
    for (let i = 0; i < 50 && !reopened; i++) {
      reopened = await ctx.prisma.tenancy.findUnique({
        where: { applicationId: f.applicationId },
      });
      if (!reopened) await new Promise((r) => setTimeout(r, 40));
    }
    expect(reopened).toBeTruthy();
    expect(reopened.status).toBe('pending');
    expect(reopened.id).not.toBe(f.tenancy.id); // a new record, not the old one
    expect(await ctx.prisma.tenancy.count()).toBe(1);
  });

  it('does not delete a tenancy somebody has already moved into', async () => {
    // The delete is scoped to `pending`. A confirmed letting must survive any
    // later undo attempt — and the undo should refuse outright by then.
    const f = await createLetting(ctx);
    await ctx.http().post(`/api/tenancies/${f.tenancy.id}/confirm-start`)
      .set(f.auth(f.landlord.token)).send({});

    await ctx.http().post(`/api/applications/${f.applicationId}/undo-accept`)
      .set(f.auth(f.landlord.token)).send({});

    const row = await ctx.prisma.tenancy.findUnique({ where: { id: f.tenancy.id } });
    expect(row).toBeTruthy();
    expect(row!.status).toBe('active');
  });
});
