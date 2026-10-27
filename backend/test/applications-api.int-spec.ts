import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp, resetDatabase, resetRateLimits, signUp, type TestContext } from './support/test-app';

/**
 * The application lifecycle over HTTP — Steps 2, 3 and 5 for this domain.
 *
 * An application is the moment this product does its job: a person asks for a
 * room and a landlord answers. Everything here asserts the state change as
 * well as the status code, because a 200 that moved nothing and a 400 that
 * moved something are both invisible to a test that reads only the response.
 */
describe('applications API', () => {
  let ctx: TestContext;
  let landlord: { token: string; userId: string; email: string };
  let tenant: { token: string; userId: string; email: string };
  let roomId: string;

  beforeAll(async () => { ctx = await createTestApp(); }, 60_000);
  afterAll(async () => { await ctx?.close(); });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    await resetRateLimits(ctx);
    landlord = await signUp(ctx, 'LANDLORD');
    tenant = await signUp(ctx, 'TENANT');
    roomId = await publishedRoom(landlord.token);
  });

  async function publishedRoom(token: string) {
    const property = await ctx.http().post('/api/properties').set(auth(token)).send({
      name: 'Ext 7 back rooms', city: 'Johannesburg', province: 'Gauteng', suburb: 'Tembisa',
    }).expect(201);
    const room = await ctx.http().post('/api/rooms').set(auth(token)).send({
      title: 'Back room with its own entrance',
      description: 'A private back room with its own entrance and a separate gate key. '
        + 'Shared kitchen and outside tap. Close to the taxi rank and the clinic.',
      roomType: 'shared_house', rentCents: 350000, province: 'Gauteng', city: 'Johannesburg',
      locationDisplay: 'Tembisa, Johannesburg', availableFrom: '2026-06-01',
      propertyId: property.body.id,
    }).expect(201);
    await ctx.http().patch(`/api/rooms/${room.body.id}`).set(auth(token))
      .send({ heroImagePath: '/integration-test-placeholder.jpg' }).expect(200);
    await ctx.http().post(`/api/rooms/${room.body.id}/publish`).set(auth(token)).send({}).expect(200);
    return room.body.id as string;
  }

  const apply = (token = tenant.token, body: Record<string, unknown> = {}) =>
    ctx.http().post('/api/applications').set(auth(token))
      .send({ roomId, coverNote: 'I would like to apply for this room, thank you.', ...body });

  const statusOf = async (id: string) =>
    (await ctx.prisma.application.findUnique({ where: { id } }))?.status;

  /**
   * Wait for the work `accept` deliberately does not await.
   *
   * ⚠️ Not politeness — without it the next test's TRUNCATE deadlocks against
   * the in-flight write, and the failure surfaces as
   * `40P01 deadlock detected` inside resetDatabase, which reads like a broken
   * harness rather than an unsettled one. `accept` opens the tenancy with
   * `createFromApplication(...).catch(...)`, never awaited, so that a failure
   * to open one cannot fail the acceptance; `createLetting` in the support
   * file polls for the same reason.
   */
  async function settle(applicationId: string) {
    for (let i = 0; i < 50; i++) {
      const t = await ctx.prisma.tenancy.findUnique({ where: { applicationId } });
      if (t) return t;
      await new Promise((r) => setTimeout(r, 40));
    }
    return null;
  }

  // ── Step 2: the valid path ────────────────────────────────────────────────

  it('accepts an application and files it as pending', async () => {
    const res = await apply();
    expect(res.status).toBe(201);
    expect(await statusOf(res.body.id)).toBe('pending');

    const mine = await ctx.http().get('/api/applications/mine').set(auth(tenant.token)).expect(200);
    expect((mine.body.data ?? mine.body).map((a: any) => a.id)).toContain(res.body.id);

    const inbox = await ctx.http().get('/api/applications/inbox').set(auth(landlord.token)).expect(200);
    expect(JSON.stringify(inbox.body)).toContain(res.body.id);
  });

  it('walks viewed → shortlisted → accepted, and opens a tenancy', async () => {
    const id = (await apply()).body.id;
    const act = async (path: string, body: Record<string, unknown> = {}) => {
      const res = await ctx.http().post(`/api/applications/${id}/${path}`).set(auth(landlord.token)).send(body);
      expect([200, 201], `${path} -> ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
    };

    await act('view');       expect(await statusOf(id)).toBe('viewed');
    await act('shortlist');  expect(await statusOf(id)).toBe('shortlisted');
    await act('accept');     expect(await statusOf(id)).toBe('accepted');

    // ⚠️ Polled: accept opens the tenancy with a deliberate fire-and-forget so
    // that failing to open one cannot fail the acceptance. Reading it straight
    // away would pass or fail by timing.
    let tenancy = null as any;
    for (let i = 0; i < 50 && !tenancy; i++) {
      tenancy = await ctx.prisma.tenancy.findUnique({ where: { applicationId: id } });
      if (!tenancy) await new Promise((r) => setTimeout(r, 40));
    }
    expect(tenancy, 'accepting must open a tenancy').toBeTruthy();
    expect((await ctx.prisma.room.findUnique({ where: { id: roomId } }))!.status).toBe('let');
  });

  it('lets the tenant withdraw, and the room stays on the board', async () => {
    const id = (await apply()).body.id;
    const res = await ctx.http().post(`/api/applications/${id}/withdraw`).set(auth(tenant.token)).send({});
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(await statusOf(id)).toBe('withdrawn');
    expect((await ctx.prisma.room.findUnique({ where: { id: roomId } }))!.status).toBe('active');
  });

  it('lets the landlord reject with a reason, and records it', async () => {
    const id = (await apply()).body.id;
    const res = await ctx.http().post(`/api/applications/${id}/reject`).set(auth(landlord.token))
      .send({ reason: 'already_let' });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(await statusOf(id)).toBe('rejected');
    const row = await ctx.prisma.application.findUnique({ where: { id } });
    expect(row!.decidedAt).toBeTruthy();
  });

  // ── Step 3: duplicates and invalid requests ───────────────────────────────

  it('refuses a second application for the same room, and keeps one row', async () => {
    const first = await apply();
    expect(first.status).toBe(201);

    const second = await apply();
    expect(second.status, 'a duplicate must be refused').toBe(409);
    expect(await ctx.prisma.application.count()).toBe(1);
  });

  it('refuses a landlord applying to their own listing', async () => {
    const res = await ctx.http().post('/api/applications').set(auth(landlord.token))
      .send({ roomId, coverNote: 'I would like to apply for my own room, thank you.' });
    expect([400, 403]).toContain(res.status);
    expect(await ctx.prisma.application.count()).toBe(0);
  });

  it('refuses an application to a room that is not accepting them', async () => {
    await ctx.http().post(`/api/rooms/${roomId}/pause`).set(auth(landlord.token)).send({}).expect(200);
    const res = await apply();
    expect(res.status).toBe(400);
    expect(await ctx.prisma.application.count()).toBe(0);
  });

  for (const [name, body, expected] of [
    ['a roomId that is not a uuid', { roomId: 'not-a-uuid' }, 400],
    ['a roomId that does not exist', { roomId: '00000000-0000-4000-8000-000000000000' }, 404],
    ['an unexpected field', { message: 'wrong field name' }, 400],
    ['a cover note of 100kb', { coverNote: 'x'.repeat(100_000) }, 400],
  ] as [string, Record<string, unknown>, number][]) {
    it(`refuses an application with ${name}, and writes nothing`, async () => {
      const payload: Record<string, unknown> = { roomId, coverNote: 'I would like to apply, thank you.', ...body };
      if (body.coverNote === undefined && 'coverNote' in body) delete payload.coverNote;
      const res = await ctx.http().post('/api/applications').set(auth(tenant.token)).send(payload);
      expect(res.status, `${name} -> ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`).toBe(expected);
      expect(await ctx.prisma.application.count(), `${name} wrote a row`).toBe(0);
    });
  }

  it('ACCEPTS an application with no cover note, and that is the policy', async () => {
    /**
     * ⚠️ Not an oversight — `coverNote` is `@IsOptional()` and must stay so.
     * "Free to apply, always" is the position this product is built on, and a
     * compulsory cover letter is a barrier dressed as a form field: the person
     * it stops is the one applying from a cheap phone with a borrowed data
     * bundle, not the one with time to write.
     *
     * My first version of this test demanded a 400 here. It would have been a
     * test enforcing a rule the product deliberately does not have — which is
     * worse than no test, because the next person reads it as the rule.
     */
    const res = await ctx.http().post('/api/applications').set(auth(tenant.token)).send({ roomId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await statusOf(res.body.id)).toBe('pending');

    // A one-word note is equally fine; the only limit is the top one.
    await ctx.http().post(`/api/applications/${res.body.id}/withdraw`).set(auth(tenant.token)).send({});
    const short = await ctx.http().post('/api/applications').set(auth(tenant.token))
      .send({ roomId, coverNote: 'Please' });
    expect([201, 409]).toContain(short.status);
  });

  it('refuses a cover note past the 1000-character limit, and writes nothing', async () => {
    const res = await ctx.http().post('/api/applications').set(auth(tenant.token))
      .send({ roomId, coverNote: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
    expect(await ctx.prisma.application.count()).toBe(0);
  });

  it('refuses a decision on an application already decided', async () => {
    const id = (await apply()).body.id;
    await ctx.http().post(`/api/applications/${id}/reject`).set(auth(landlord.token))
      .send({ reason: 'already_let' }).expect(200);

    for (const path of ['accept', 'shortlist', 'reject']) {
      const res = await ctx.http().post(`/api/applications/${id}/${path}`).set(auth(landlord.token))
        .send(path === 'reject' ? { reason: 'already_let' } : {});
      expect(res.status, `${path} after reject -> ${res.status}`).toBe(400);
    }
    expect(await statusOf(id)).toBe('rejected');
  });

  it('refuses a second withdrawal', async () => {
    const id = (await apply()).body.id;
    // 201, not 200 — withdraw carries no @HttpCode, so Nest's POST default
    // stands. Asserted as the pair rather than guessed, the same way the
    // publish/accept contracts are.
    const first = await ctx.http().post(`/api/applications/${id}/withdraw`).set(auth(tenant.token)).send({});
    expect([200, 201]).toContain(first.status);
    const again = await ctx.http().post(`/api/applications/${id}/withdraw`).set(auth(tenant.token)).send({});
    expect(again.status).toBe(400);
    expect(await statusOf(id)).toBe('withdrawn');
  });

  // ── Step 5: enforcement ───────────────────────────────────────────────────

  it('refuses a stranger every decision on somebody else\'s application', async () => {
    const id = (await apply()).body.id;
    const stranger = await signUp(ctx, 'LANDLORD');
    const otherTenant = await signUp(ctx, 'TENANT');

    const attempts: [string, string, () => any][] = [
      ['stranger landlord accepts', 'accepted', () => ctx.http().post(`/api/applications/${id}/accept`).set(auth(stranger.token)).send({})],
      ['stranger landlord shortlists', 'shortlisted', () => ctx.http().post(`/api/applications/${id}/shortlist`).set(auth(stranger.token)).send({})],
      ['stranger landlord rejects', 'rejected', () => ctx.http().post(`/api/applications/${id}/reject`).set(auth(stranger.token)).send({ reason: 'already_let' })],
      ['another tenant withdraws it', 'withdrawn', () => ctx.http().post(`/api/applications/${id}/withdraw`).set(auth(otherTenant.token)).send({})],
      ['the applicant accepts their own', 'accepted', () => ctx.http().post(`/api/applications/${id}/accept`).set(auth(tenant.token)).send({})],
    ];

    for (const [label, , make] of attempts) {
      const res = await make();
      expect([400, 401, 403, 404], `${label} -> ${res.status}`).toContain(res.status);
    }
    expect(await statusOf(id), 'nothing may have moved it').toBe('pending');
  });

  it('keeps one tenant\'s application out of another tenant\'s list', async () => {
    const id = (await apply()).body.id;
    const other = await signUp(ctx, 'TENANT');
    const mine = await ctx.http().get('/api/applications/mine').set(auth(other.token)).expect(200);
    expect(JSON.stringify(mine.body)).not.toContain(id);
  });

  it('refuses a stranger the applicant list for a room they do not own', async () => {
    await apply();
    const stranger = await signUp(ctx, 'LANDLORD');
    const res = await ctx.http().get(`/api/applications/room/${roomId}`).set(auth(stranger.token));
    expect([401, 403, 404]).toContain(res.status);
  });

  it('refuses a message into a thread the caller is not part of', async () => {
    const id = (await apply()).body.id;
    const stranger = await signUp(ctx, 'TENANT');

    const post = await ctx.http().post(`/api/applications/${id}/messages`).set(auth(stranger.token))
      .send({ body: 'Let me in' });
    expect([401, 403, 404]).toContain(post.status);

    const read = await ctx.http().get(`/api/applications/${id}/messages`).set(auth(stranger.token));
    expect([401, 403, 404]).toContain(read.status);

    expect(await ctx.prisma.message.count()).toBe(0);
  });
  // ── A decision must not be walked back by a later write (§100) ───────────

  /**
   * ⚠️ WHAT THESE DO AND DO NOT CHECK, because the first version of them was
   * decoration.
   *
   * They assert the INVARIANT — a decided application never goes back to
   * `viewed` or `shortlisted`. They do NOT reproduce the race that motivated
   * the fix, and that was measured rather than assumed: written as two
   * concurrent requests under `Promise.all`, they passed with the conditional
   * write removed AND with the precondition removed as well. In one process
   * `accept` does far more work than `markViewed` — a transaction, a room
   * claim, notices — so it reliably finishes last and its own claim then
   * legitimately moves the row on from `viewed`. The losing ordering never
   * occurs, so the assertion could not fail. A test that passes with the whole
   * guard deleted is worse than no test.
   *
   * Reproducing it needs separate processes, the way
   * `scripts/double-let-drive.mjs` does it. The conditional writes in
   * `markViewed` and `shortlist` therefore rest on the same reasoning as the
   * rest of §§95-96 plus `check-then-write-lint`, which does fail on them —
   * NOT on a drive. Said plainly here rather than implied by a green tick.
   */
  it('does not walk an acceptance back to viewed', async () => {
    const created = await apply();
    const id = created.body.id as string;

    await ctx.http().post(`/api/applications/${id}/accept`).set(auth(landlord.token)).send({}).expect(200);
    expect(await settle(id), 'the acceptance left no tenancy').toBeTruthy();

    // Opening the applicant again after deciding must not move the row.
    await ctx.http().post(`/api/applications/${id}/view`).set(auth(landlord.token)).send({});
    expect(await statusOf(id)).toBe('accepted');
  });

  it('does not walk an acceptance back to shortlisted', async () => {
    const created = await apply();
    const id = created.body.id as string;

    await ctx.http().post(`/api/applications/${id}/accept`).set(auth(landlord.token)).send({}).expect(200);
    expect(await settle(id), 'the acceptance left no tenancy').toBeTruthy();

    const res = await ctx.http().post(`/api/applications/${id}/shortlist`)
      .set(auth(landlord.token)).send({});
    expect(res.status).toBe(400);
    expect(await statusOf(id)).toBe('accepted');
  });
});
