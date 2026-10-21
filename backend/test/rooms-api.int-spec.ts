import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp, resetDatabase, resetRateLimits, signUp, type TestContext } from './support/test-app';

/**
 * Room management over HTTP: create, edit, publish, and every status move.
 *
 * Steps 2 and 3 of the API brief for this domain — valid requests produce the
 * expected response AND the expected state change, invalid ones are refused
 * and write nothing.
 *
 * ⚠️ Every refusal asserts the DATABASE as well as the status code. A 400
 * that still wrote the row is the shape of bug this repository keeps finding,
 * and a test that stops at the status code cannot see it.
 */
describe('room management API', () => {
  let ctx: TestContext;
  let landlord: { token: string; userId: string; email: string };
  let propertyId: string;

  beforeAll(async () => { ctx = await createTestApp(); }, 60_000);
  afterAll(async () => { await ctx?.close(); });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    await resetRateLimits(ctx);
    landlord = await signUp(ctx, 'LANDLORD');
    const property = await ctx.http().post('/api/properties').set(auth(landlord.token)).send({
      name: 'Ext 7 back rooms', city: 'Johannesburg', province: 'Gauteng', suburb: 'Tembisa',
    }).expect(201);
    propertyId = property.body.id;
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const DESCRIPTION =
    'A private back room with its own entrance and a separate gate key. ' +
    'Shared kitchen and outside tap. Close to the taxi rank and the clinic.';

  const validRoom = (over: Record<string, unknown> = {}) => ({
    title: 'Back room with its own entrance',
    description: DESCRIPTION,
    roomType: 'shared_house',
    rentCents: 350000,
    province: 'Gauteng',
    city: 'Johannesburg',
    locationDisplay: 'Tembisa, Johannesburg',
    availableFrom: '2026-06-01',
    propertyId,
    ...over,
  });

  const createRoom = async (over: Record<string, unknown> = {}) => {
    const res = await ctx.http().post('/api/rooms').set(auth(landlord.token)).send(validRoom(over));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };

  const publish = async (id: string) => {
    await ctx.http().patch(`/api/rooms/${id}`).set(auth(landlord.token))
      .send({ heroImagePath: '/integration-test-placeholder.jpg' }).expect(200);
    await ctx.http().post(`/api/rooms/${id}/publish`).set(auth(landlord.token)).send({}).expect(200);
    return id;
  };

  const statusOf = async (id: string) =>
    (await ctx.prisma.room.findUnique({ where: { id } }))?.status;

  // ── Step 2: valid requests ────────────────────────────────────────────────

  it('creates a room as a DRAFT, invisible to the board', async () => {
    const id = await createRoom();
    expect(await statusOf(id)).toBe('draft');

    // A draft must not reach the public board: it has no photo and nobody has
    // said it is ready.
    const board = await ctx.http().get('/api/rooms').expect(200);
    expect(board.body.data.map((r: any) => r.id)).not.toContain(id);
  });

  it('publishes a complete room and puts it on the board', async () => {
    const id = await publish(await createRoom());
    expect(await statusOf(id)).toBe('active');

    const row = await ctx.prisma.room.findUnique({ where: { id } });
    expect(row!.publishedAt, 'publishedAt is what the board sorts on').toBeTruthy();

    const board = await ctx.http().get('/api/rooms').expect(200);
    expect(board.body.data.map((r: any) => r.id)).toContain(id);
  });

  it('walks the whole status lifecycle and lands where it started', async () => {
    const id = await publish(await createRoom());
    const move = async (path: string, body: Record<string, unknown> = {}) => {
      const res = await ctx.http().post(`/api/rooms/${id}/${path}`).set(auth(landlord.token)).send(body);
      expect([200, 201], `${path} -> ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
    };

    await move('reserve');   expect(await statusOf(id)).toBe('reserved');
    await move('unreserve'); expect(await statusOf(id)).toBe('active');
    await move('pause');     expect(await statusOf(id)).toBe('paused');
    await move('unpause');   expect(await statusOf(id)).toBe('active');
    await move('let');       expect(await statusOf(id)).toBe('let');
    // Within the undo window, which has only just opened.
    await move('undo-let');  expect(await statusOf(id)).toBe('active');
  });

  it('relists a let room and clears the let stamp', async () => {
    const id = await publish(await createRoom());
    await ctx.http().post(`/api/rooms/${id}/let`).set(auth(landlord.token)).send({}).expect(200);

    const res = await ctx.http().post(`/api/rooms/${id}/relist`).set(auth(landlord.token))
      .send({ rentCents: 360000 });
    expect([200, 201]).toContain(res.status);

    const row = await ctx.prisma.room.findUnique({ where: { id } });
    expect(row!.status).toBe('active');
    expect(row!.rentCents).toBe(360000);
  });

  it('lists only this landlord\'s rooms under my-rooms', async () => {
    const mine = await createRoom();
    const other = await signUp(ctx, 'LANDLORD');
    const theirProperty = await ctx.http().post('/api/properties').set(auth(other.token))
      .send({ name: 'Other yard', city: 'Pretoria', province: 'Gauteng', suburb: 'Soshanguve' }).expect(201);
    await ctx.http().post('/api/rooms').set(auth(other.token))
      .send({ ...validRoom(), propertyId: theirProperty.body.id }).expect(201);

    const res = await ctx.http().get('/api/rooms/my-rooms').set(auth(landlord.token)).expect(200);
    const ids = (res.body.data ?? res.body).map((r: any) => r.id);
    expect(ids).toContain(mine);
    expect(ids).toHaveLength(1);
  });

  // ── Step 3: invalid requests ──────────────────────────────────────────────

  it('refuses to publish without a cover photo, and leaves it a draft', async () => {
    const id = await createRoom();
    const res = await ctx.http().post(`/api/rooms/${id}/publish`).set(auth(landlord.token)).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cover photo/i);
    expect(await statusOf(id), 'a refused publish must not change the status').toBe('draft');
  });

  it('refuses to publish a description under 50 characters', async () => {
    const id = await createRoom({ description: 'Nice room.' });
    await ctx.http().patch(`/api/rooms/${id}`).set(auth(landlord.token))
      .send({ heroImagePath: '/integration-test-placeholder.jpg' }).expect(200);

    const res = await ctx.http().post(`/api/rooms/${id}/publish`).set(auth(landlord.token)).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/50 characters/i);
    expect(await statusOf(id)).toBe('draft');
  });

  for (const [name, patch] of [
    ['no title', { title: undefined }],
    ['an empty title', { title: '' }],
    ['a rent that is not a number', { rentCents: 'three hundred rand' }],
    ['a negative rent', { rentCents: -1 }],
    ['a province that does not exist', { province: 'Atlantis' }],
    ['a room type outside the set', { roomType: 'castle' }],
    ['a date that is not a date', { availableFrom: 'next Thursday-ish' }],
    ['a propertyId that is not a uuid', { propertyId: 'not-a-uuid' }],
    ['an unexpected field', { isFeatured: true }],
  ] as [string, Record<string, unknown>][]) {
    it(`refuses a room with ${name}, and writes nothing`, async () => {
      const body = validRoom(patch);
      if (patch.title === undefined && 'title' in patch) delete (body as any).title;
      const res = await ctx.http().post('/api/rooms').set(auth(landlord.token)).send(body);
      expect(res.status, `${name} -> ${res.status}`).toBe(400);
      expect(await ctx.prisma.room.count(), `${name} wrote a row`).toBe(0);
    });
  }

  it('refuses a title longer than the column allows, and writes nothing', async () => {
    const res = await ctx.http().post('/api/rooms').set(auth(landlord.token))
      .send(validRoom({ title: 'x'.repeat(5000) }));
    expect(res.status).toBe(400);
    expect(await ctx.prisma.room.count()).toBe(0);
  });

  it('refuses a status move that the current status does not allow', async () => {
    const id = await createRoom(); // draft
    for (const [path, expected] of [['pause', 400], ['reserve', 400], ['undo-let', 400]] as [string, number][]) {
      const res = await ctx.http().post(`/api/rooms/${id}/${path}`).set(auth(landlord.token)).send({});
      expect(res.status, `${path} from draft -> ${res.status}`).toBe(expected);
      expect(await statusOf(id)).toBe('draft');
    }
  });

  it('refuses to unpause a room that is not paused', async () => {
    const id = await publish(await createRoom());
    const res = await ctx.http().post(`/api/rooms/${id}/unpause`).set(auth(landlord.token)).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not paused/i);
    expect(await statusOf(id)).toBe('active');
  });

  it('answers 400 or 404 for a room id that is not a uuid', async () => {
    const res = await ctx.http().get('/api/rooms/not-a-uuid');
    expect([400, 404]).toContain(res.status);
  });

  it('answers 404 for a well-formed id that is not a room', async () => {
    const res = await ctx.http().get('/api/rooms/00000000-0000-4000-8000-000000000000');
    expect([404]).toContain(res.status);
  });

  // ── Step 5: backend enforcement ───────────────────────────────────────────

  it('refuses a TENANT a listing on somebody else\'s property', async () => {
    /**
     * ⚠️ NOT a 403, and the reason matters. `ListerGuard` admits a TENANT on
     * purpose — Phase 6 Option A, where a sub-lessor may list the room they
     * are letting out, and the guard's own comment says so: "a guard says who
     * may try; the WHERE clause says whose rows they get." The refusal comes
     * from the service, which checks the property belongs to the caller.
     *
     * So the assertion is on the EFFECT — refused, nothing written — rather
     * than on a status code I expected before reading the guard. My first
     * version demanded 401/403 and would have failed a correct app.
     */
    const tenant = await signUp(ctx, 'TENANT');
    const res = await ctx.http().post('/api/rooms').set(auth(tenant.token)).send(validRoom());
    expect([400, 401, 403], `tenant -> ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
    expect(await ctx.prisma.room.count()).toBe(0);
  });

  it('refuses one landlord the right to touch another landlord\'s room', async () => {
    const id = await publish(await createRoom());
    const stranger = await signUp(ctx, 'LANDLORD');

    // Every write on the room, not a sample: a guard that covers four of five
    // routes is the hole this sweep exists to find.
    const writes: [string, () => any][] = [
      // ⚠️ A VALID title. 'Mine now' is 8 characters and the DTO demands 10,
      // so an earlier version of this test got its 400 from validation and
      // never reached the ownership check at all — it would have passed with
      // ownership wide open. Every body below is valid for exactly that
      // reason: the only thing left to refuse the request is who is asking.
      ['edit', () => ctx.http().patch(`/api/rooms/${id}`).set(auth(stranger.token)).send({ title: 'This room belongs to me now' })],
      ['publish', () => ctx.http().post(`/api/rooms/${id}/publish`).set(auth(stranger.token)).send({})],
      ['pause', () => ctx.http().post(`/api/rooms/${id}/pause`).set(auth(stranger.token)).send({})],
      ['reserve', () => ctx.http().post(`/api/rooms/${id}/reserve`).set(auth(stranger.token)).send({})],
      ['let', () => ctx.http().post(`/api/rooms/${id}/let`).set(auth(stranger.token)).send({})],
      ['relist', () => ctx.http().post(`/api/rooms/${id}/relist`).set(auth(stranger.token)).send({ rentCents: 400000 })],
      ['photos', () => ctx.http().patch(`/api/rooms/${id}/photos`).set(auth(stranger.token)).send({ paths: ['/integration-test-placeholder.jpg'] })],
      ['soft delete', () => ctx.http().post(`/api/rooms/${id}/remove`).set(auth(stranger.token)).send({})],
      ['delete', () => ctx.http().delete(`/api/rooms/${id}`).set(auth(stranger.token))],
      ['permanent delete', () => ctx.http().delete(`/api/rooms/${id}/permanent`).set(auth(stranger.token))],
    ];

    for (const [label, make] of writes) {
      const res = await make();
      expect([401, 403, 404], `${label} -> ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
    }

    const row = await ctx.prisma.room.findUnique({ where: { id } });
    expect(row!.title).toBe('Back room with its own entrance');
    expect(row!.status).toBe('active');
  });

  it('does not let a client set its own status or owner through create or edit', async () => {
    // ⚠️ The mass-assignment case. forbidNonWhitelisted should refuse these
    // outright; what must never happen is a room that arrives already
    // published, or belonging to somebody else.
    const stranger = await signUp(ctx, 'LANDLORD');
    const sneaky = await ctx.http().post('/api/rooms').set(auth(landlord.token))
      .send(validRoom({ status: 'active', landlordId: stranger.userId, publishedAt: new Date().toISOString() }));
    expect(sneaky.status).toBe(400);
    expect(await ctx.prisma.room.count()).toBe(0);

    const id = await createRoom();
    const edit = await ctx.http().patch(`/api/rooms/${id}`).set(auth(landlord.token))
      .send({ status: 'active', landlordId: stranger.userId });
    expect(edit.status).toBe(400);

    const row = await ctx.prisma.room.findUnique({ where: { id } });
    expect(row!.status).toBe('draft');
    expect(row!.landlordId).toBe(landlord.userId);
  });
});
