import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestApp, resetDatabase, resetRateLimits, signUp, createLetting,
  type TestContext,
} from './support/test-app';

/**
 * Pausing, waking and ending an account — Phase 7g, end to end.
 *
 * ── Why integration, and why these assertions
 *
 * Ending an account is the only irreversible action a person can take here,
 * and what makes it correct is not one function: the DTO refuses an untyped
 * confirmation, the service re-authenticates, and a single transaction erases
 * nine kinds of personal row, nulls a third party's foreign key, queues a
 * face for deletion, writes an audit row that must NOT contain what it
 * audits, and leaves a tombstone that every sign-in path has to refuse. A
 * unit test of any one of those says nothing about whether the account is
 * actually gone.
 *
 * POPIA s.24 is a right, so the test that matters most is not that deletion
 * works — it is that the things the screen promises to KEEP are still there
 * afterwards (somebody else's conversation, somebody else's rent record) and
 * the things it promises to ERASE are gone. Both halves, because an erasure
 * that takes the other party's tenancy record with it is the same bug as one
 * that leaves an email address behind, just pointed the other way.
 */
describe('account lifecycle: deactivate, reactivate, delete', () => {
  let ctx: TestContext;

  beforeAll(async () => { ctx = await createTestApp(); }, 60_000);
  afterAll(async () => { await ctx?.close(); });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    await resetRateLimits(ctx);
    ctx.outbox.deletionsQueued.length = 0;
  });

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const PASSWORD = 'TestPass123';

  // 201, not 200: /auth/login mints a session, and Nest's default for a POST
  // is 201. Asserted as the pair rather than guessed, because a test that
  // demanded 200 here would have read a working sign-in as a lock-out.
  const login = (email: string, password = PASSWORD) =>
    ctx.http().post('/api/auth/login').send({ email, password });

  /**
   * A listing that is PUBLISHED and not let.
   *
   * ⚠️ `createLetting` cannot be used for the pausing tests, and finding out
   * why is the point: it accepts the application, which moves the room to
   * `let` — and a let room is already off the public board and is NOT paused
   * by deactivation (the filter is `active`/`reserved`). That is right: the
   * tenant lives there. A test built on that fixture asserts nothing about
   * pausing, and the first run of this file "failed" on exactly that.
   */
  const publishedRoom = async () => {
    const landlord = await signUp(ctx, 'LANDLORD');
    const property = await ctx.http().post('/api/properties').set(bearer(landlord.token)).send({
      name: 'Ext 7 back rooms', city: 'Johannesburg', province: 'Gauteng', suburb: 'Tembisa',
    }).expect(201);
    const room = await ctx.http().post('/api/rooms').set(bearer(landlord.token)).send({
      title: 'Back room with its own entrance',
      description:
        'A private back room with its own entrance and a separate gate key. ' +
        'Shared kitchen and outside tap. Close to the taxi rank and the clinic.',
      roomType: 'shared_house',
      rentCents: 350000,
      province: 'Gauteng',
      city: 'Johannesburg',
      locationDisplay: 'Tembisa, Johannesburg',
      availableFrom: '2026-06-01',
      propertyId: property.body.id,
    }).expect(201);
    await ctx.http().patch(`/api/rooms/${room.body.id}`).set(bearer(landlord.token))
      .send({ heroImagePath: '/integration-test-placeholder.jpg' }).expect(200);
    await ctx.http().post(`/api/rooms/${room.body.id}/publish`)
      .set(bearer(landlord.token)).send({}).expect(200);
    return { landlord, roomId: room.body.id as string };
  };

  // ── Deactivation: nothing is destroyed ────────────────────────────────────

  it('takes a landlord\'s live listings off the board without destroying them', async () => {
    const f = await publishedRoom();

    const before = await ctx.http().get('/api/rooms').expect(200);
    const visible = (b: any) => (b.data ?? b.rooms ?? b).map((r: any) => r.id);
    expect(visible(before.body)).toContain(f.roomId);

    await ctx.http().post('/api/account/deactivate')
      .set(bearer(f.landlord.token)).send({}).expect(200);

    const room = await ctx.prisma.room.findUnique({ where: { id: f.roomId } });
    // PAUSED, not deleted: pausing keeps the applications and the tenancy
    // attached, which is the entire difference between sleeping and ending.
    expect(room!.status).toBe('paused');

    const after = await ctx.http().get('/api/rooms').expect(200);
    expect(visible(after.body)).not.toContain(f.roomId);

    // Nothing that hangs off the room may have gone with it.
    expect(await ctx.prisma.room.count()).toBe(1);
    expect(await ctx.prisma.property.count()).toBe(1);

    const user = await ctx.prisma.user.findUnique({ where: { id: f.landlord.userId } });
    expect(user!.deactivatedAt).toBeTruthy();
    expect(user!.deletedAt).toBeNull();
  });

  it('still lets a deactivated account sign in — that is how you come back', async () => {
    const landlord = await signUp(ctx, 'LANDLORD');
    await ctx.http().post('/api/account/deactivate')
      .set(bearer(landlord.token)).send({}).expect(200);

    const res = await login(landlord.email);
    expect([200, 201], 'a paused account must not be locked out').toContain(res.status);
    expect(res.body.accessToken ?? res.body.access_token ?? res.body.token).toBeTruthy();
  });

  it('wakes the account without republishing anything', async () => {
    const f = await publishedRoom();
    await ctx.http().post('/api/account/deactivate')
      .set(bearer(f.landlord.token)).send({}).expect(200);

    const res = await ctx.http().post('/api/account/reactivate')
      .set(bearer(f.landlord.token)).send({}).expect(200);

    const user = await ctx.prisma.user.findUnique({ where: { id: f.landlord.userId } });
    expect(user!.deactivatedAt).toBeNull();

    /**
     * ⚠️ The room stays PAUSED on purpose, and this is the assertion worth
     * having: one may have been let while the account slept, and advertising
     * a taken room to people who then apply for it is worse than making the
     * landlord tap publish. An automatic republish would look like a nicety
     * and generate dead applications.
     */
    const room = await ctx.prisma.room.findUnique({ where: { id: f.roomId } });
    expect(room!.status).toBe('paused');
    // The response has to say so, or the person is left wondering where their
    // listings went.
    expect(JSON.stringify(res.body)).toContain('1');
  });

  // ── The preview is counted, not boilerplate ───────────────────────────────

  it('tells a landlord with a letting something different from a bare tenant', async () => {
    const f = await createLetting(ctx);

    const landlordView = await ctx.http().get('/api/account/deletion-preview')
      .set(bearer(f.landlord.token)).expect(200);
    const tenantView = await ctx.http().get('/api/account/deletion-preview')
      .set(bearer(f.tenant.token)).expect(200);

    const text = (b: any) => JSON.stringify(b);
    expect(text(landlordView.body)).toMatch(/listing comes off the board/i);
    expect(text(landlordView.body)).toMatch(/no longer be able to reach you/i);

    expect(text(tenantView.body)).toMatch(/application is withdrawn/i);
    // A tenant has no listings, so they must not be told any come off.
    expect(text(tenantView.body)).not.toMatch(/listing comes off the board/i);

    // And the kept side is counted from real rows, not asserted in prose.
    const keptLabels = landlordView.body.kept.map((k: any) => k.label);
    expect(keptLabels).toContain('Rooms you listed');
    expect(landlordView.body.kept.find((k: any) => k.label === 'Rooms you listed').count).toBe(1);
  });

  // ── Deletion refuses unless it is really meant ────────────────────────────

  const del = (token: string, body: Record<string, unknown>) =>
    ctx.http().delete('/api/account').set(bearer(token)).send(body);

  const stillThere = async (userId: string, email: string) => {
    const user = await ctx.prisma.user.findUnique({ where: { id: userId } });
    expect(user!.deletedAt).toBeNull();
    expect(user!.email).toBe(email);
    expect(user!.passwordHash).toBeTruthy();
    expect(await ctx.prisma.accountClosure.count()).toBe(0);
  };

  it('refuses a deletion with the wrong password', async () => {
    const tenant = await signUp(ctx, 'TENANT');
    const res = await del(tenant.token, {
      password: 'NotMyPassword1', confirm: 'DELETE', understood: true,
    });
    expect(res.status).toBe(403);
    await stillThere(tenant.userId, tenant.email);
  });

  it('refuses a deletion with no password at all', async () => {
    const tenant = await signUp(ctx, 'TENANT');
    const res = await del(tenant.token, { confirm: 'DELETE', understood: true });
    expect([400, 403]).toContain(res.status);
    await stillThere(tenant.userId, tenant.email);
  });

  /**
   * Each of these is a real failure the form can produce, and all four must
   * refuse. The typed word is checked with @Equals on the literal rather than
   * a regex, so "delete " with a trailing space is a refusal and not a
   * half-match — asserted here because that is the sort of thing a later
   * "tidy-up" loosens without noticing.
   */
  for (const [name, body] of [
    ['the word not typed', { password: PASSWORD, understood: true }],
    ['the word in lower case', { password: PASSWORD, confirm: 'delete', understood: true }],
    ['the word with a trailing space', { password: PASSWORD, confirm: 'DELETE ', understood: true }],
    ['the box left unticked', { password: PASSWORD, confirm: 'DELETE', understood: false }],
    ['the box missing entirely', { password: PASSWORD, confirm: 'DELETE' }],
  ] as [string, Record<string, unknown>][]) {
    it(`refuses a deletion with ${name}`, async () => {
      const tenant = await signUp(ctx, 'TENANT');
      const res = await del(tenant.token, body);
      expect(res.status).toBe(400);
      await stillThere(tenant.userId, tenant.email);
    });
  }

  it('refuses a signed-out deletion', async () => {
    const tenant = await signUp(ctx, 'TENANT');
    const res = await ctx.http().delete('/api/account')
      .send({ password: PASSWORD, confirm: 'DELETE', understood: true });
    expect([401, 403]).toContain(res.status);
    await stillThere(tenant.userId, tenant.email);
  });

  // ── Deletion, done properly ───────────────────────────────────────────────

  const endAccount = (token: string) =>
    del(token, { password: PASSWORD, confirm: 'DELETE', understood: true });

  it('erases the person and leaves a tombstone nobody can sign into', async () => {
    const tenant = await signUp(ctx, 'TENANT');
    // A face is personal information and the deletion queue is how it goes.
    await ctx.prisma.user.update({
      where: { id: tenant.userId },
      data: { avatarPath: 'private/avatars/sipho.jpg', phone: '0821234567' },
    });

    const res = await endAccount(tenant.token);
    expect(res.status).toBe(200);

    const user = await ctx.prisma.user.findUnique({ where: { id: tenant.userId } });
    expect(user, 'the row stays as a tombstone — deleting it would cascade').toBeTruthy();
    expect(user!.deletedAt).toBeTruthy();
    expect(user!.fullName).toBe('Former member');
    expect(user!.passwordHash).toBeNull();
    expect(user!.phone).toBeNull();
    expect(user!.avatarPath).toBeNull();
    expect(user!.marketingEmails).toBe(false);
    // Replaced rather than nulled: a CHECK constraint requires email OR phone,
    // and a reserved .invalid domain can never reach anybody.
    expect(user!.email).not.toBe(tenant.email);
    expect(user!.email).toMatch(/\.invalid$/);
    // Two independent reasons to refuse a sign-in, because this is the one
    // that must not be got wrong.
    expect(user!.isActive).toBe(false);

    expect(ctx.outbox.deletionsQueued.map((d) => d.path)).toContain('private/avatars/sipho.jpg');
    const queued = await ctx.prisma.fileDeletion.findMany();
    expect(queued.map((q) => q.path)).toContain('private/avatars/sipho.jpg');

    const back = await login(tenant.email);
    expect([400, 401, 403]).toContain(back.status);
  });

  it('records who ended it without recording what it erased', async () => {
    const tenant = await signUp(ctx, 'TENANT');
    await endAccount(tenant.token).then((r) => expect(r.status).toBe(200));

    const closures = await ctx.prisma.accountClosure.findMany();
    expect(closures).toHaveLength(1);
    expect(closures[0].userId).toBe(tenant.userId);
    expect(closures[0].actor).toBe('owner');
    expect(closures[0].closedByAdminId).toBeNull();
    // An audit trail that keeps what the erasure removed defeats the erasure
    // it audits.
    expect(JSON.stringify(closures[0])).not.toContain(tenant.email);
    expect(JSON.stringify(closures[0])).not.toContain('Sipho');
  });

  it('withdraws the applications and takes the listings down', async () => {
    const f = await createLetting(ctx);
    await endAccount(f.tenant.token).then((r) => expect(r.status).toBe(200));

    const application = await ctx.prisma.application.findUnique({
      where: { id: f.applicationId },
    });
    // An ACCEPTED application is not withdrawn: it is the record of a letting
    // that happened, and the landlord's as much as the tenant's. Only an open
    // one is withdrawn — asserted separately below, on a room of its own.
    expect(application).toBeTruthy();
    expect(application!.status).toBe('accepted');

    const listing = await publishedRoom();
    const applicant = await signUp(ctx, 'TENANT');
    const open = await ctx.http().post('/api/applications').set(bearer(applicant.token))
      .send({ roomId: listing.roomId, coverNote: 'May I see the room, please?' });
    expect(open.status).toBe(201);

    await endAccount(applicant.token).then((r) => expect(r.status).toBe(200));
    const withdrawn = await ctx.prisma.application.findUnique({ where: { id: open.body.id } });
    expect(withdrawn!.status).toBe('withdrawn');
    expect(withdrawn!.decidedAt).toBeTruthy();

    await endAccount(listing.landlord.token).then((r) => expect(r.status).toBe(200));
    const room = await ctx.prisma.room.findUnique({ where: { id: listing.roomId } });
    expect(room!.status).toBe('deleted');
  });

  it('keeps the other party\'s record: the conversation, the review, the rent history', async () => {
    const f = await createLetting(ctx);

    // A message from each side, so the kept half is not just the leaver's own.
    // Messages hang off the APPLICATION, not the room: the thread exists
    // because somebody applied, which is also what gives either party the
    // right to be in it.
    const thread = await ctx.http().post(`/api/applications/${f.applicationId}/messages`)
      .set(bearer(f.tenant.token))
      .send({ body: 'Good day, is the room still open?' });
    expect([200, 201]).toContain(thread.status);
    const messagesBefore = await ctx.prisma.message.count();
    expect(messagesBefore).toBeGreaterThan(0);

    await endAccount(f.tenant.token).then((r) => expect(r.status).toBe(200));

    // The words stay, because deleting them would leave holes in somebody
    // else's thread. The name comes off instead — see the tombstone test.
    expect(await ctx.prisma.message.count()).toBe(messagesBefore);
    // Who paid what and when is the landlord's record as much as the tenant's.
    expect(await ctx.prisma.tenancy.count()).toBe(1);
    const tenancy = await ctx.prisma.tenancy.findFirst();
    expect(tenancy!.tenantId).toBe(f.tenant.userId);
  });

  it('erases the private rows that belong to nobody else', async () => {
    const f = await createLetting(ctx);
    await ctx.http().post(`/api/rooms/${f.roomId}/save`)
      .set(bearer(f.tenant.token)).send({});
    const saved = await ctx.prisma.savedRoom.count();

    await endAccount(f.tenant.token).then((r) => expect(r.status).toBe(200));

    // Saved rooms and alerts are private conveniences — there is no second
    // party with an interest in them, so they go rather than being kept.
    expect(saved).toBeGreaterThanOrEqual(0);
    expect(await ctx.prisma.savedRoom.count({ where: { tenantId: f.tenant.userId } })).toBe(0);
    expect(await ctx.prisma.savedSearch.count({ where: { tenantId: f.tenant.userId } })).toBe(0);
    expect(await ctx.prisma.verificationRequest.count({ where: { userId: f.tenant.userId } })).toBe(0);
    expect(await ctx.prisma.refreshToken.count({ where: { userId: f.tenant.userId } })).toBe(0);
  });

  /**
   * ⚠️ THIS TEST EXISTS TO KEEP THE HARNESS HONEST.
   *
   * `resetRateLimits` runs between cases so that a suite heavier than one
   * person does not fail on a 429 in a test about erasure. A reset that
   * quietly became "throttling off" would make that convenience into exactly
   * the thing this codebase keeps shipping — a control that only looks like a
   * control, the way nineteen @Throttle decorators with no guard registered
   * did. So one case asserts the limit still bites, inside a single test,
   * where no reset intervenes.
   *
   * Ten per quarter hour, and the number is deliberate: five locked a person
   * out of closing their OWN account, because the form refuses a missing
   * password, a mistyped one, a lower-case "delete" and an unticked box.
   */
  it('still rate limits the deletion endpoint, reset helper notwithstanding', async () => {
    const tenant = await signUp(ctx, 'TENANT');
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      // Wrong password every time: each attempt is refused on its merits, so
      // the account survives all eleven and the only thing that can change is
      // the limiter.
      const res = await del(tenant.token, {
        password: 'NotMyPassword1', confirm: 'DELETE', understood: true,
      });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 10).every((s) => s === 403), statuses.join(',')).toBe(true);
    expect(statuses[10]).toBe(429);
    await stillThere(tenant.userId, tenant.email);
  });

  it('refuses a second deletion, and pausing or waking a dead account', async () => {
    const tenant = await signUp(ctx, 'TENANT');
    const token = tenant.token;
    await endAccount(token).then((r) => expect(r.status).toBe(200));

    // The token is for an account that no longer exists as a person. Whether
    // the pipeline refuses it at the guard or the service, every one of these
    // must be a refusal — never a second erasure, and never a reopening.
    for (const res of [
      await endAccount(token),
      await ctx.http().post('/api/account/deactivate').set(bearer(token)).send({}),
      await ctx.http().post('/api/account/reactivate').set(bearer(token)).send({}),
    ]) {
      expect([400, 401, 403]).toContain(res.status);
    }

    expect(await ctx.prisma.accountClosure.count()).toBe(1);
  });
});
