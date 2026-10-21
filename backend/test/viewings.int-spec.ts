import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp, resetDatabase, createLetting, signUp, TestContext } from './support/test-app';

/**
 * Viewing invitations: a landlord proposing a time, a tenant answering, and
 * what the record says afterwards.
 *
 * ⚠️ The address is the thing being protected here. A viewing is how somebody
 * is told where to come, so who may create one, answer one and see one is the
 * whole point — not whether the endpoint returns 200.
 */
describe('Viewing invitations', () => {
  let ctx: TestContext;

  beforeAll(async () => { ctx = await createTestApp(); });
  afterAll(async () => { await ctx?.close(); });
  beforeEach(async () => { await resetDatabase(ctx.prisma); ctx.outbox.emails.length = 0; });

  /** A letting whose application is still open, which is when viewings happen. */
  async function applied() {
    const f = await createLetting(ctx);
    return f;
  }

  const soon = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  const invite = (f: any, token: string, body: Record<string, unknown> = {}) =>
    ctx.http().post(`/api/applications/${f.applicationId}/viewings`)
      .set(f.auth(token))
      .send({ startsAt: soon(), meetingPlace: 'At the blue gate on Vilakazi Street', ...body });

  // ── Creating an invitation ──────────────────────────────────────────────
  it('lets the landlord invite an applicant, and records the arrangement', async () => {
    const f = await applied();
    const res = await invite(f, f.landlord.token);
    expect([200, 201]).toContain(res.status);

    const row = await ctx.prisma.roomViewing.findFirst({ where: { applicationId: f.applicationId } });
    expect(row).toBeTruthy();
    expect(row!.meetingPlace).toBe('At the blue gate on Vilakazi Street');
  });

  it('refuses an unauthenticated invitation', async () => {
    const f = await applied();
    await ctx.http().post(`/api/applications/${f.applicationId}/viewings`)
      .send({ startsAt: soon(), meetingPlace: 'Anywhere' }).expect(401);
    expect(await ctx.prisma.roomViewing.count()).toBe(0);
  });

  it('refuses the TENANT the right to invite themselves', async () => {
    // The landlord decides when somebody comes to their home.
    const f = await applied();
    const res = await invite(f, f.tenant.token);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await ctx.prisma.roomViewing.count()).toBe(0);
  });

  it("refuses a stranger the right to invite to someone else's room", async () => {
    const f = await applied();
    const stranger = await signUp(ctx, 'LANDLORD');
    const res = await invite(f, stranger.token);
    expect([403, 404]).toContain(res.status);
    expect(await ctx.prisma.roomViewing.count()).toBe(0);
  });

  it.each([
    ['no meeting place', { meetingPlace: undefined }],
    ['a meeting place of one character', { meetingPlace: 'x' }],
    ['a start time that is not a date', { startsAt: 'tomorrow-ish' }],
    ['an unexpected field', { address: '1423 Vilakazi Street' }],
  ])('rejects %s with 400 and writes nothing', async (_label, body) => {
    const f = await applied();
    const res = await invite(f, f.landlord.token, body);
    expect(res.status).toBe(400);
    expect(await ctx.prisma.roomViewing.count()).toBe(0);
  });

  // ── Answering it ────────────────────────────────────────────────────────
  async function invited() {
    const f = await applied();
    const res = await invite(f, f.landlord.token);
    const viewing = await ctx.prisma.roomViewing.findFirst({
      where: { applicationId: f.applicationId },
    });
    return { f, viewing: viewing!, inviteStatus: res.status };
  }

  it('lets the tenant accept, and the record says so', async () => {
    const { f, viewing } = await invited();
    const res = await ctx.http().post(`/api/applications/viewings/${viewing.id}/respond`)
      .set(f.auth(f.tenant.token)).send({ accept: true });
    expect([200, 201]).toContain(res.status);

    const after = await ctx.prisma.roomViewing.findUnique({ where: { id: viewing.id } });
    expect(after!.status).not.toBe('proposed');
  });

  it('lets the tenant decline with a reason', async () => {
    const { f, viewing } = await invited();
    const res = await ctx.http().post(`/api/applications/viewings/${viewing.id}/respond`)
      .set(f.auth(f.tenant.token))
      .send({ accept: false, declineReason: 'I am working that afternoon.' });
    expect([200, 201]).toContain(res.status);

    const after = await ctx.prisma.roomViewing.findUnique({ where: { id: viewing.id } });
    expect(after!.status).not.toBe('accepted');
  });

  it('refuses a different tenant the right to answer', async () => {
    const { f, viewing } = await invited();
    const stranger = await signUp(ctx, 'TENANT');
    const res = await ctx.http().post(`/api/applications/viewings/${viewing.id}/respond`)
      .set(f.auth(stranger.token)).send({ accept: true });
    expect([403, 404]).toContain(res.status);

    const after = await ctx.prisma.roomViewing.findUnique({ where: { id: viewing.id } });
    expect(after!.status).toBe(viewing.status);
  });

  it('refuses the LANDLORD the right to answer on the tenant’s behalf', async () => {
    // Accepting for somebody is how a no-show becomes the tenant's fault.
    const { f, viewing } = await invited();
    const res = await ctx.http().post(`/api/applications/viewings/${viewing.id}/respond`)
      .set(f.auth(f.landlord.token)).send({ accept: true });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  // ── Cancelling and outcomes ─────────────────────────────────────────────
  it('lets the landlord cancel an arrangement', async () => {
    const { f, viewing } = await invited();
    const res = await ctx.http().post(`/api/applications/viewings/${viewing.id}/cancel`)
      .set(f.auth(f.landlord.token)).send({});
    expect([200, 201]).toContain(res.status);

    const after = await ctx.prisma.roomViewing.findUnique({ where: { id: viewing.id } });
    expect(after!.status).toBe('cancelled');
  });

  /**
   * Recording an outcome has two preconditions, and the first version of this
   * test honoured neither — it sent `happened` for a viewing nobody had
   * accepted, three days before it was due, and read the resulting 400 as the
   * enum being wrong. The rules are real and worth asserting rather than
   * working around:
   *
   *   · the viewing must have been ACCEPTED — there is no outcome to an
   *     arrangement nobody agreed to;
   *   · its time must have PASSED — "what happened" is not a question you
   *     can answer about Thursday on Monday.
   */
  it('refuses an outcome for a viewing nobody accepted', async () => {
    const { f, viewing } = await invited(); // still 'proposed'
    const res = await ctx.http().post(`/api/applications/viewings/${viewing.id}/outcome`)
      .set(f.auth(f.landlord.token)).send({ outcome: 'happened' });
    expect(res.status).toBe(400);
  });

  it('refuses an outcome for a viewing that has not happened yet', async () => {
    const { f, viewing } = await invited();
    await ctx.http().post(`/api/applications/viewings/${viewing.id}/respond`)
      .set(f.auth(f.tenant.token)).send({ accept: true });

    const res = await ctx.http().post(`/api/applications/viewings/${viewing.id}/outcome`)
      .set(f.auth(f.landlord.token)).send({ outcome: 'happened' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/happen|yet|future/i);
  });

  it('records the outcome once the viewing is accepted and its time has passed', async () => {
    const { f, viewing } = await invited();
    await ctx.http().post(`/api/applications/viewings/${viewing.id}/respond`)
      .set(f.auth(f.tenant.token)).send({ accept: true });

    // Move the arrangement into the past. Done in the database because the
    // API will not accept an invitation for a time already gone — which is
    // itself correct, and is why this cannot be set up over HTTP alone.
    await ctx.prisma.roomViewing.update({
      where: { id: viewing.id },
      data: { startsAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const bad = await ctx.http().post(`/api/applications/viewings/${viewing.id}/outcome`)
      .set(f.auth(f.landlord.token)).send({ outcome: 'went_quite_well' });
    expect(bad.status).toBe(400);

    const good = await ctx.http().post(`/api/applications/viewings/${viewing.id}/outcome`)
      .set(f.auth(f.landlord.token)).send({ outcome: 'happened' });
    expect([200, 201]).toContain(good.status);
  });

  it('refuses a second outcome for the same viewing', async () => {
    const { f, viewing } = await invited();
    await ctx.http().post(`/api/applications/viewings/${viewing.id}/respond`)
      .set(f.auth(f.tenant.token)).send({ accept: true });
    await ctx.prisma.roomViewing.update({
      where: { id: viewing.id },
      data: { startsAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    await ctx.http().post(`/api/applications/viewings/${viewing.id}/outcome`)
      .set(f.auth(f.landlord.token)).send({ outcome: 'happened' });

    const second = await ctx.http().post(`/api/applications/viewings/${viewing.id}/outcome`)
      .set(f.auth(f.landlord.token)).send({ outcome: 'no_answer' });
    expect(second.status).toBe(400);
  });

  it('answers 4xx rather than 5xx for a viewing that does not exist', async () => {
    const f = await applied();
    const res = await ctx.http()
      .post('/api/applications/viewings/00000000-0000-0000-0000-000000000000/respond')
      .set(f.auth(f.tenant.token)).send({ accept: true });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('reaches no external service beyond the notification it is meant to send', async () => {
    const f = await applied();
    ctx.outbox.whatsapps.length = 0;
    ctx.outbox.payments.length = 0;
    await invite(f, f.landlord.token);

    // WhatsApp is switched off in production, so a viewing invitation must
    // not depend on it; nothing here is a paid send.
    expect(ctx.outbox.whatsapps).toHaveLength(0);
    expect(ctx.outbox.payments).toHaveLength(0);
  });
});
