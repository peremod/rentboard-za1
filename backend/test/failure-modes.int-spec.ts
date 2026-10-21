import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp, resetDatabase, createLetting, signUp, TestContext } from './support/test-app';

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
   * 🔴 DEFECT FOUND, RECORDED NOT FIXED — undoing an acceptance leaves the
   * tenancy behind.
   *
   * `undoAccept` runs a transaction that puts the application back to
   * `shortlisted`, reinstates the applicants that acceptance rejected, and
   * returns the room to the board. It does not touch the tenancy, which
   * `accept` opened. So afterwards there is a `pending` tenancy pointing at
   * an application that is no longer accepted, for a room that is back on
   * the board and can be let to somebody else.
   *
   * The test below asserts what the code DOES, and then establishes how far
   * the inconsistency goes, because "an extra row" and "two live tenancies
   * for one room" are very different findings and only measurement tells
   * them apart. Fixing it means adding the tenancy to that transaction —
   * a one-line change to a business flow, which is not a test engineer's
   * call to make alone.
   */
  it('🔴 leaves the tenancy pending after an acceptance is undone (known defect)', async () => {
    const f = await createLetting(ctx);
    const undo = await ctx.http().post(`/api/applications/${f.applicationId}/undo-accept`)
      .set(f.auth(f.landlord.token)).send({});
    expect(undo.status).toBeLessThan(400);

    // The application and the room were put back…
    const application = await ctx.prisma.application.findUnique({ where: { id: f.applicationId } });
    const room = await ctx.prisma.room.findUnique({ where: { id: f.roomId } });
    expect(application!.status).not.toBe('accepted');
    expect(room!.status).toBe('active');

    // …and the tenancy was not.
    const tenancy = await ctx.prisma.tenancy.findUnique({ where: { id: f.tenancy.id } });
    expect(tenancy!.status).toBe('pending');

    // How far does it go? If the move-in can still be confirmed, the room is
    // simultaneously on the board and let — which is the serious reading.
    const confirm = await ctx.http().post(`/api/tenancies/${f.tenancy.id}/confirm-start`)
      .set(f.auth(f.landlord.token)).send({});
    const after = await ctx.prisma.tenancy.findUnique({ where: { id: f.tenancy.id } });
    const roomAfter = await ctx.prisma.room.findUnique({ where: { id: f.roomId } });

    /**
     * 🔴 Measured, and it is the serious reading: the move-in CAN still be
     * confirmed. The room is then let and publicly advertised at the same
     * time, and another tenant can apply to it.
     */
    expect(confirm.status).toBe(200);
    expect(after!.status).toBe('active');
    expect(roomAfter!.status).toBe('active');

    // On the public board, so a tenant searching sees a room that is taken.
    const board = await ctx.http().get('/api/rooms');
    expect(board.body.total).toBe(1);

    // And can apply to it. A second acceptance would open a second tenancy
    // for one room — two people told they have the same back room.
    const other = await signUp(ctx, 'TENANT');
    const application2 = await ctx.http().post('/api/applications')
      .set(f.auth(other.token))
      .send({ roomId: f.roomId, coverNote: 'Is this still available?' });
    expect(application2.status).toBe(201);
  });
});
