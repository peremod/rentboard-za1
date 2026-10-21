import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp, resetDatabase, createLetting, signUp, TestContext } from './support/test-app';

/**
 * Reviews, and reporting a listing.
 *
 * ⚠️ A review is a claim about a real person that outlives the letting, so
 * who may write one — and when — matters more than the endpoint working.
 * The rules are: you were party to the tenancy, it has ENDED, and you write
 * one of each kind, once.
 */
describe('Reviews and reports', () => {
  let ctx: TestContext;

  beforeAll(async () => { ctx = await createTestApp(); });
  afterAll(async () => { await ctx?.close(); });
  beforeEach(async () => { await resetDatabase(ctx.prisma); });

  /** A letting taken all the way to `ended`, which is when reviews open. */
  async function endedLetting() {
    const f = await createLetting(ctx);
    const as = f.auth(f.landlord.token);
    await ctx.http().post(`/api/tenancies/${f.tenancy.id}/confirm-start`).set(as).send({});
    await ctx.http().post(`/api/tenancies/${f.tenancy.id}/end`).set(as).send({});
    return f;
  }

  const review = (f: any, token: string, body: Record<string, unknown> = {}) =>
    ctx.http().post('/api/reviews').set(f.auth(token)).send({
      tenancyId: f.tenancy.id,
      type: 'landlord',
      rating: 4,
      comment: 'The gate was fixed quickly and the rent never changed without notice.',
      ...body,
    });

  // ── When a review may be written ────────────────────────────────────────
  it('refuses a review while the tenancy is still running', async () => {
    const f = await createLetting(ctx);
    await ctx.http().post(`/api/tenancies/${f.tenancy.id}/confirm-start`)
      .set(f.auth(f.landlord.token)).send({});

    const res = await review(f, f.tenant.token);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/has ended/i);
    expect(await ctx.prisma.review.count()).toBe(0);
  });

  it('accepts one from the tenant once the tenancy has ended', async () => {
    const f = await endedLetting();
    const res = await review(f, f.tenant.token);
    expect([200, 201]).toContain(res.status);

    const row = await ctx.prisma.review.findFirst();
    expect(row).toBeTruthy();
    expect(row!.rating).toBe(4);
    expect(row!.tenancyId).toBe(f.tenancy.id);
  });

  it('refuses a second review of the same kind', async () => {
    const f = await endedLetting();
    await review(f, f.tenant.token);
    const second = await review(f, f.tenant.token, { rating: 1, comment: 'Changed my mind entirely about this place.' });

    expect(second.status).toBe(400);
    expect(await ctx.prisma.review.count()).toBe(1);
    // And the first is untouched — a refused duplicate must not overwrite.
    expect((await ctx.prisma.review.findFirst())!.rating).toBe(4);
  });

  // ── Who may write one ───────────────────────────────────────────────────
  it('refuses somebody who was not part of the tenancy', async () => {
    const f = await endedLetting();
    const stranger = await signUp(ctx, 'TENANT');
    const res = await review(f, stranger.token);
    expect([403, 404]).toContain(res.status);
    expect(await ctx.prisma.review.count()).toBe(0);
  });

  it('refuses an unauthenticated review', async () => {
    const f = await endedLetting();
    await ctx.http().post('/api/reviews')
      .send({ tenancyId: f.tenancy.id, type: 'landlord', rating: 5, comment: 'x'.repeat(40) })
      .expect(401);
    expect(await ctx.prisma.review.count()).toBe(0);
  });

  // ── Invalid input ───────────────────────────────────────────────────────
  it.each([
    ['a rating of 0', { rating: 0 }],
    ['a rating of 6', { rating: 6 }],
    ['a fractional rating', { rating: 4.5 }],
    ['an unknown type', { type: 'neighbour' }],
    ['a tenancy id that is not a uuid', { tenancyId: 'not-a-uuid' }],
    ['an unexpected field', { verified: true }],
  ])('rejects %s with 400 and writes nothing', async (_label, body) => {
    const f = await endedLetting();
    const res = await review(f, f.tenant.token, body);
    expect(res.status).toBe(400);
    expect(await ctx.prisma.review.count()).toBe(0);
  });

  it('accepts the boundary ratings, 1 and 5', async () => {
    for (const rating of [1, 5]) {
      await resetDatabase(ctx.prisma);
      const f = await endedLetting();
      const res = await review(f, f.tenant.token, { rating });
      expect({ rating, status: res.status }).toEqual({ rating, status: 201 });
    }
  });

  // ── Reporting a listing ─────────────────────────────────────────────────
  const report = (f: any, token: string, body: Record<string, unknown> = {}) =>
    ctx.http().post('/api/reports').set(f.auth(token)).send({
      roomId: f.roomId,
      reason: 'upfront_payment_demanded',
      details: 'I was asked to pay a R500 viewing fee before being given the address.',
      ...body,
    });

  it('lets a tenant report a listing, and stores it unresolved', async () => {
    const f = await createLetting(ctx);
    const res = await report(f, f.tenant.token);
    expect([200, 201]).toContain(res.status);

    const row = await ctx.prisma.report.findFirst();
    expect(row).toBeTruthy();
    expect(row!.reason).toBe('upfront_payment_demanded');
    // A report is an allegation until an admin reads it. It must not arrive
    // already resolved, or the queue it exists to populate stays empty.
    // The admin queue is driven by `status`; `reviewedAt`/`reviewedById` are
    // stamped only when somebody acts (there is no `resolvedAt` column —
    // asserting on one passes vacuously as `undefined`).
    expect(row!.status).toBe('open');
    expect(row!.reviewedAt).toBeNull();
    expect(row!.reviewedById).toBeNull();
    expect(row!.resolutionNote).toBeNull();
  });

  /**
   * ⚠️ ACCEPTS a signed-out report, and that is deliberate — I wrote this
   * test the other way round first and it was wrong.
   *
   * The controller uses OptionalJwtAuthGuard and says why: "requiring an
   * account to report a scam suppresses exactly the reports worth having".
   * The person best placed to report a listing demanding an upfront fee is
   * often somebody who never signed up. Rate limiting carries the load
   * instead — twenty an hour per IP, because mobile carriers here put very
   * large numbers of subscribers behind one address.
   */
  it('accepts a report from somebody with no account', async () => {
    const f = await createLetting(ctx);
    const res = await ctx.http().post('/api/reports').send({
      roomId: f.roomId,
      reason: 'upfront_payment_demanded',
      details: 'They wanted R500 before telling me the address. I have the messages.',
      contactEmail: 'passer-by@test.invalid',
    });
    expect(res.status).toBe(201);
    expect(await ctx.prisma.report.count()).toBe(1);
  });

  it('still refuses a report with too little detail to investigate', async () => {
    const f = await createLetting(ctx);
    const res = await ctx.http().post('/api/reports')
      .send({ roomId: f.roomId, reason: 'other', details: 'bad' });
    expect(res.status).toBe(400);
    expect(await ctx.prisma.report.count()).toBe(0);
  });

  it('rejects a reason outside the allowed set', async () => {
    const f = await createLetting(ctx);
    const res = await report(f, f.tenant.token, { reason: 'i_just_do_not_like_it' });
    expect(res.status).toBe(400);
    expect(await ctx.prisma.report.count()).toBe(0);
  });

  it('refuses an ordinary user the moderation queue', async () => {
    // Reading other people's reports is an admin power. A tenant who can
    // list them can see who reported whom.
    const f = await createLetting(ctx);
    const res = await ctx.http().get('/api/reports').set(f.auth(f.tenant.token));
    expect([401, 403]).toContain(res.status);
  });

  it('refuses an ordinary user the right to resolve a report', async () => {
    const f = await createLetting(ctx);
    await report(f, f.tenant.token);
    const row = await ctx.prisma.report.findFirst();

    const res = await ctx.http().patch(`/api/reports/${row!.id}/resolve`)
      .set(f.auth(f.tenant.token)).send({ outcome: 'dismissed', note: 'Nothing to see.' });
    expect([400, 401, 403]).toContain(res.status);

    const after = await ctx.prisma.report.findUnique({ where: { id: row!.id } });
    expect(after!.status).toBe('open');
    expect(after!.reviewedAt).toBeNull();
    expect(after!.reviewedById).toBeNull();
  });
});
