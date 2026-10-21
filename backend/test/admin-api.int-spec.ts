import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp, resetDatabase, resetRateLimits, signUp, signUpAdmin, type TestContext } from './support/test-app';

/**
 * Administrative operations — Steps 2, 3 and 5 for the moderation surface.
 *
 * ⚠️ This is the most dangerous surface in the product: 61 of the 236 routes
 * are admin-only, and what they do is suspend people, end accounts and read
 * private records. `api-contract.int-spec.ts` already proves that every one
 * of them refuses an ordinary account; this file proves the ones that matter
 * do the right thing WHEN an admin calls them — and that the effects reach
 * the database rather than just the response.
 */
describe('admin operations API', () => {
  let ctx: TestContext;
  let admin: { token: string; userId: string; email: string };

  beforeAll(async () => { ctx = await createTestApp(); }, 60_000);
  afterAll(async () => { await ctx?.close(); });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    await resetRateLimits(ctx);
    admin = await signUpAdmin(ctx);
  });

  async function landlordWithLiveRoom() {
    const landlord = await signUp(ctx, 'LANDLORD');
    const property = await ctx.http().post('/api/properties').set(auth(landlord.token)).send({
      name: 'Ext 7 back rooms', city: 'Johannesburg', province: 'Gauteng', suburb: 'Tembisa',
    }).expect(201);
    const room = await ctx.http().post('/api/rooms').set(auth(landlord.token)).send({
      title: 'Back room with its own entrance',
      description: 'A private back room with its own entrance and a separate gate key. '
        + 'Shared kitchen and outside tap. Close to the taxi rank and the clinic.',
      roomType: 'shared_house', rentCents: 350000, province: 'Gauteng', city: 'Johannesburg',
      locationDisplay: 'Tembisa, Johannesburg', availableFrom: '2026-06-01', propertyId: property.body.id,
    }).expect(201);
    await ctx.http().patch(`/api/rooms/${room.body.id}`).set(auth(landlord.token))
      .send({ heroImagePath: '/integration-test-placeholder.jpg' }).expect(200);
    await ctx.http().post(`/api/rooms/${room.body.id}/publish`).set(auth(landlord.token)).send({}).expect(200);
    return { landlord, roomId: room.body.id as string };
  }

  // ── Step 2: the operations work ───────────────────────────────────────────

  it('reads the platform counts, and they are counts of real rows', async () => {
    await landlordWithLiveRoom();
    const res = await ctx.http().get('/api/admin/stats').set(auth(admin.token)).expect(200);

    /**
     * ⚠️ Compared against the DATABASE, not merely "is a number" — a stats
     * endpoint returning zeros for everything passes a shape assertion, and
     * one returning the wrong table's count passes "greater than zero".
     *
     * My first version did neither: it scanned the TOP-LEVEL values for a
     * number, and this response nests them under `users` and `rooms`, so it
     * found none and failed against a perfectly correct payload. A check that
     * does not know the shape of what it reads cannot judge it.
     */
    const users = await ctx.prisma.user.count();
    const activeRooms = await ctx.prisma.room.count({ where: { status: 'active' } });

    expect(res.body.users.total, JSON.stringify(res.body)).toBe(users);
    expect(res.body.rooms.active).toBe(activeRooms);
    expect(users).toBeGreaterThan(0);
    expect(activeRooms).toBeGreaterThan(0);

    // And it must move with the data rather than being computed once.
    await landlordWithLiveRoom();
    const again = await ctx.http().get('/api/admin/stats').set(auth(admin.token)).expect(200);
    expect(again.body.rooms.active).toBe(activeRooms + 1);
    expect(again.body.users.total).toBe(users + 1);
  });

  it('finds an account by email, and does not hand out its password hash', async () => {
    const tenant = await signUp(ctx, 'TENANT');
    const res = await ctx.http().get(`/api/admin/users?search=${encodeURIComponent(tenant.email)}`)
      .set(auth(admin.token)).expect(200);

    const blob = JSON.stringify(res.body);
    expect(blob).toContain(tenant.email);
    // An admin screen has no use for the hash, and a leaked one is offline
    // cracking material for every account that shares the password.
    expect(blob).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('suspends a landlord, takes their listings off the board, and restores them', async () => {
    const { landlord, roomId } = await landlordWithLiveRoom();

    const suspend = await ctx.http().patch(`/api/admin/users/${landlord.userId}/active`)
      .set(auth(admin.token)).send({ isActive: false, reason: 'Reported for a deposit scam.' });
    expect(suspend.status).toBe(200);

    const row = await ctx.prisma.user.findUnique({ where: { id: landlord.userId } });
    expect(row!.isActive).toBe(false);
    // The listings must come down with the account: leaving them up is the
    // suspension doing half its job in public.
    expect((await ctx.prisma.room.findUnique({ where: { id: roomId } }))!.status).toBe('paused');

    const board = await ctx.http().get('/api/rooms').expect(200);
    expect(board.body.data.map((r: any) => r.id)).not.toContain(roomId);

    // And a suspended account cannot sign in or use a token it already holds.
    const login = await ctx.http().post('/api/auth/login')
      .send({ email: landlord.email, password: 'TestPass123' });
    expect([400, 401, 403]).toContain(login.status);
    const withOldToken = await ctx.http().get('/api/rooms/my-rooms').set(auth(landlord.token));
    expect([401, 403]).toContain(withOldToken.status);

    const restore = await ctx.http().patch(`/api/admin/users/${landlord.userId}/active`)
      .set(auth(admin.token)).send({ isActive: true });
    expect(restore.status).toBe(200);
    expect((await ctx.prisma.user.findUnique({ where: { id: landlord.userId } }))!.isActive).toBe(true);

    // ⚠️ The rooms stay PAUSED, deliberately — the same rule as reactivating
    // your own account. One may have been let in the meantime, and
    // republishing on the landlord's behalf advertises a room nobody checked.
    expect((await ctx.prisma.room.findUnique({ where: { id: roomId } }))!.status).toBe('paused');
  });

  it('previews what ending an account would erase, without erasing anything', async () => {
    const { landlord } = await landlordWithLiveRoom();
    const res = await ctx.http().get(`/api/admin/users/${landlord.userId}/closure-preview`)
      .set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toMatch(/\w/);

    const row = await ctx.prisma.user.findUnique({ where: { id: landlord.userId } });
    expect(row!.deletedAt, 'a preview must not end the account').toBeNull();
    expect(row!.email).toBe(landlord.email);
  });

  // ── Step 3: invalid requests ──────────────────────────────────────────────

  it('refuses a suspension with no reason, and leaves the account active', async () => {
    const tenant = await signUp(ctx, 'TENANT');
    const res = await ctx.http().patch(`/api/admin/users/${tenant.userId}/active`)
      .set(auth(admin.token)).send({ isActive: false });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/reason/i);
    expect((await ctx.prisma.user.findUnique({ where: { id: tenant.userId } }))!.isActive).toBe(true);
  });

  for (const [name, body] of [
    ['isActive as a string', { isActive: 'false', reason: 'x' }],
    ['no isActive at all', { reason: 'x' }],
    ['an unexpected field', { isActive: false, reason: 'x', deleteEverything: true }],
    ['a reason past 300 characters', { isActive: false, reason: 'x'.repeat(301) }],
  ] as [string, Record<string, unknown>][]) {
    it(`refuses a suspension with ${name}`, async () => {
      const tenant = await signUp(ctx, 'TENANT');
      const res = await ctx.http().patch(`/api/admin/users/${tenant.userId}/active`)
        .set(auth(admin.token)).send(body);
      expect(res.status, `${name} -> ${res.status}`).toBe(400);
      expect((await ctx.prisma.user.findUnique({ where: { id: tenant.userId } }))!.isActive).toBe(true);
    });
  }

  it('answers 400 or 404 for a user id that is not a uuid', async () => {
    const res = await ctx.http().patch('/api/admin/users/not-a-uuid/active')
      .set(auth(admin.token)).send({ isActive: false, reason: 'x' });
    expect([400, 404]).toContain(res.status);
  });

  it('answers 404 for a well-formed id that is nobody', async () => {
    const res = await ctx.http().patch('/api/admin/users/00000000-0000-4000-8000-000000000000/active')
      .set(auth(admin.token)).send({ isActive: false, reason: 'x' });
    expect(res.status).toBe(404);
  });

  // ── Step 5: the limits on admin power itself ──────────────────────────────

  it('refuses to suspend another ADMIN from this screen', async () => {
    /**
     * ⚠️ The rule exists so that one compromised admin session cannot lock
     * the others out — the service says to use the database directly, which
     * means a person at a keyboard rather than a button on a support screen.
     */
    const other = await signUpAdmin(ctx);
    const res = await ctx.http().patch(`/api/admin/users/${other.userId}/active`)
      .set(auth(admin.token)).send({ isActive: false, reason: 'Disagreement.' });
    expect(res.status).toBe(400);
    expect((await ctx.prisma.user.findUnique({ where: { id: other.userId } }))!.isActive).toBe(true);
  });

  it('refuses an admin ending their own account from the admin screen', async () => {
    const res = await ctx.http().delete(`/api/admin/users/${admin.userId}`)
      .set(auth(admin.token)).send({ reason: 'Clearing out my own account for a test.' });
    expect([400, 403]).toContain(res.status);
    expect((await ctx.prisma.user.findUnique({ where: { id: admin.userId } }))!.deletedAt).toBeNull();
  });

  it('refuses an ordinary account every admin operation used in this file', async () => {
    // The sweep in api-contract covers all 61 routes; this is the same claim
    // made concretely against the ones with real effects, with the DATABASE
    // checked afterwards rather than only the status code.
    const tenant = await signUp(ctx, 'TENANT');
    const victim = await signUp(ctx, 'LANDLORD');

    const attempts: [string, () => any][] = [
      ['stats', () => ctx.http().get('/api/admin/stats').set(auth(tenant.token))],
      ['user search', () => ctx.http().get('/api/admin/users?search=a').set(auth(tenant.token))],
      ['user detail', () => ctx.http().get(`/api/admin/users/${victim.userId}`).set(auth(tenant.token))],
      ['suspend', () => ctx.http().patch(`/api/admin/users/${victim.userId}/active`).set(auth(tenant.token)).send({ isActive: false, reason: 'x' })],
      ['closure preview', () => ctx.http().get(`/api/admin/users/${victim.userId}/closure-preview`).set(auth(tenant.token))],
      ['end account', () => ctx.http().delete(`/api/admin/users/${victim.userId}`).set(auth(tenant.token)).send({ reason: 'x'.repeat(20) })],
      ['storage drain', () => ctx.http().post('/api/admin/storage/drain').set(auth(tenant.token)).send({})],
    ];

    for (const [label, make] of attempts) {
      const res = await make();
      expect([401, 403], `${label} -> ${res.status}`).toContain(res.status);
    }

    const row = await ctx.prisma.user.findUnique({ where: { id: victim.userId } });
    expect(row!.isActive).toBe(true);
    expect(row!.deletedAt).toBeNull();
    expect(row!.email).toBe(victim.email);
  });

  it('does not let a tenant promote themselves to ADMIN through the profile', async () => {
    // ⚠️ The escalation that would make every other check in this file
    // pointless. forbidNonWhitelisted should refuse it outright; what must
    // never happen is the role actually changing.
    const tenant = await signUp(ctx, 'TENANT');
    for (const body of [{ role: 'ADMIN' }, { isActive: true, role: 'ADMIN' }]) {
      const res = await ctx.http().patch('/api/users/me').set(auth(tenant.token)).send(body);
      expect([400, 403, 404], `${JSON.stringify(body)} -> ${res.status}`).toContain(res.status);
    }
    expect((await ctx.prisma.user.findUnique({ where: { id: tenant.userId } }))!.role).toBe('TENANT');
  });
});
