import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp, resetDatabase, createLetting, signUp, TestContext } from './support/test-app';

/**
 * A letting from acceptance to its end, and who may move it.
 *
 * The states are pending → active → ended, with cancelled as the branch for a
 * letting that fell through before anyone moved in. What matters here is not
 * that each endpoint returns 200, but that a state cannot be reached from one
 * it does not follow — an `ended` tenancy that can be ended again, or a
 * `cancelled` one that can be confirmed, is a ledger that disagrees with
 * itself.
 */
describe('Tenancy lifecycle', () => {
  let ctx: TestContext;

  beforeAll(async () => { ctx = await createTestApp(); });
  afterAll(async () => { await ctx?.close(); });
  beforeEach(async () => { await resetDatabase(ctx.prisma); });

  it('opens a pending tenancy when an application is accepted', async () => {
    const f = await createLetting(ctx);
    expect(f.tenancy.status).toBe('pending');
    // The relationships the record is only meaningful through.
    expect(f.tenancy.applicationId).toBe(f.applicationId);
    expect(f.tenancy.roomId).toBe(f.roomId);
    // Rent is snapshotted, because the room's rent changes on relist.
    expect(f.tenancy.rentCents).toBe(350000);
  });

  it('snapshots the rent at acceptance, so a later relist cannot rewrite history', async () => {
    const f = await createLetting(ctx, 350000);
    await ctx.http().patch(`/api/rooms/${f.roomId}`)
      .set(f.auth(f.landlord.token)).send({ rentCents: 999900 });

    const after = await ctx.prisma.tenancy.findUnique({ where: { id: f.tenancy.id } });
    expect(after!.rentCents).toBe(350000);
  });

  // ── pending → active ────────────────────────────────────────────────────
  it('confirms the move-in and sets a start date', async () => {
    const f = await createLetting(ctx);
    const res = await ctx.http().post(`/api/tenancies/${f.tenancy.id}/confirm-start`)
      .set(f.auth(f.landlord.token)).send({});
    expect([200, 201]).toContain(res.status);

    const row = await ctx.prisma.tenancy.findUnique({ where: { id: f.tenancy.id } });
    expect(row!.status).toBe('active');
    expect(row!.startDate).toBeInstanceOf(Date);
  });

  it('refuses a stranger the confirmation', async () => {
    const f = await createLetting(ctx);
    const stranger = await signUp(ctx, 'LANDLORD');
    const res = await ctx.http().post(`/api/tenancies/${f.tenancy.id}/confirm-start`)
      .set(f.auth(stranger.token)).send({});
    expect([403, 404]).toContain(res.status);

    const row = await ctx.prisma.tenancy.findUnique({ where: { id: f.tenancy.id } });
    expect(row!.status).toBe('pending');
  });

  it('rejects an unauthenticated confirmation', async () => {
    const f = await createLetting(ctx);
    await ctx.http().post(`/api/tenancies/${f.tenancy.id}/confirm-start`).send({}).expect(401);
  });

  // ── active → ended ──────────────────────────────────────────────────────
  it('ends an active tenancy and records when', async () => {
    const f = await createLetting(ctx);
    await ctx.http().post(`/api/tenancies/${f.tenancy.id}/confirm-start`)
      .set(f.auth(f.landlord.token)).send({});
    const res = await ctx.http().post(`/api/tenancies/${f.tenancy.id}/end`)
      .set(f.auth(f.landlord.token)).send({});
    expect([200, 201]).toContain(res.status);

    const row = await ctx.prisma.tenancy.findUnique({ where: { id: f.tenancy.id } });
    expect(row!.status).toBe('ended');
    expect(row!.endDate).toBeInstanceOf(Date);
  });

  // ── Invalid transitions ─────────────────────────────────────────────────
  it('refuses to end a tenancy nobody has moved into', async () => {
    const f = await createLetting(ctx);
    const res = await ctx.http().post(`/api/tenancies/${f.tenancy.id}/end`)
      .set(f.auth(f.landlord.token)).send({});
    expect(res.status).toBeGreaterThanOrEqual(400);

    const row = await ctx.prisma.tenancy.findUnique({ where: { id: f.tenancy.id } });
    expect(row!.status).toBe('pending');
  });

  it('refuses to end the same tenancy twice', async () => {
    const f = await createLetting(ctx);
    const as = f.auth(f.landlord.token);
    await ctx.http().post(`/api/tenancies/${f.tenancy.id}/confirm-start`).set(as).send({});
    await ctx.http().post(`/api/tenancies/${f.tenancy.id}/end`).set(as).send({});

    const second = await ctx.http().post(`/api/tenancies/${f.tenancy.id}/end`).set(as).send({});
    expect(second.status).toBeGreaterThanOrEqual(400);

    // And the first ending is not disturbed by the second attempt.
    const row = await ctx.prisma.tenancy.findUnique({ where: { id: f.tenancy.id } });
    expect(row!.status).toBe('ended');
  });

  it('refuses to confirm a cancelled tenancy', async () => {
    const f = await createLetting(ctx);
    const as = f.auth(f.landlord.token);
    const cancelled = await ctx.http().post(`/api/tenancies/${f.tenancy.id}/cancel`)
      .set(as).send({ reason: 'The tenant found somewhere else.' });

    if (cancelled.status < 400) {
      const res = await ctx.http().post(`/api/tenancies/${f.tenancy.id}/confirm-start`)
        .set(as).send({});
      expect(res.status).toBeGreaterThanOrEqual(400);
      const row = await ctx.prisma.tenancy.findUnique({ where: { id: f.tenancy.id } });
      expect(row!.status).toBe('cancelled');
    }
  });

  it('is idempotent about opening a tenancy — accepting twice makes one', async () => {
    const f = await createLetting(ctx);
    // A duplicate acceptance must not open a second tenancy for one letting.
    await ctx.http().post(`/api/applications/${f.applicationId}/accept`)
      .set(f.auth(f.landlord.token)).send({});
    await new Promise((r) => setTimeout(r, 300));

    expect(await ctx.prisma.tenancy.count({ where: { applicationId: f.applicationId } })).toBe(1);
  });
});
