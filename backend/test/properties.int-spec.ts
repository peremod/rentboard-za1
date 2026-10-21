import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestApp, resetDatabase, signUp, assertTestDatabase, TestContext,
} from './support/test-app';

/**
 * Phase 1: creating and updating a property (a "yard").
 *
 * Every request below goes over HTTP through the real guard chain, so when a
 * test says a tenant may not edit a landlord's yard, the thing that refused
 * is the application's own authorization, not the test's idea of it.
 */
describe('Properties — create and update', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx?.close();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.outbox.emails.length = 0;
  });

  const yard = {
    name: 'Ext 7 back rooms',
    suburb: 'Tembisa',
    city: 'Johannesburg',
    province: 'Gauteng',
    houseRules: 'Gate locked at 21:00.',
    sharedAmenities: ['Shared kitchen', 'Outside tap'],
    currentHousemates: 4,
  };

  // ── The harness itself ──────────────────────────────────────────────────
  it('refuses to run against a database that is not named for testing', () => {
    // The guard is the reason this suite is safe to run at all: it truncates
    // every table. Asserted here so it cannot be quietly removed.
    expect(() => assertTestDatabase('postgresql://u:p@localhost:5432/rentboard_dev'))
      .toThrow(/must contain "test"/);
    expect(() => assertTestDatabase('postgresql://u:p@ep-x.neon.tech/mastande_test'))
      .toThrow(/remote host/);
    expect(assertTestDatabase('postgresql://u:p@localhost:5432/mastande_integration_test'))
      .toBe('mastande_integration_test');
  });

  // ── Authentication ──────────────────────────────────────────────────────
  it('rejects an unauthenticated create with 401', async () => {
    const res = await ctx.http().post('/api/properties').send(yard);
    expect(res.status).toBe(401);
    expect(await ctx.prisma.property.count()).toBe(0);
  });

  it('rejects a malformed token with 401', async () => {
    const res = await ctx.http().post('/api/properties')
      .set('Authorization', 'Bearer not-a-real-token').send(yard);
    expect(res.status).toBe(401);
  });

  // ── Authorization ───────────────────────────────────────────────────────
  it('refuses a TENANT, who may not own a yard', async () => {
    const tenant = await signUp(ctx, 'TENANT');
    const res = await ctx.http().post('/api/properties')
      .set('Authorization', `Bearer ${tenant.token}`).send(yard);
    expect(res.status).toBe(403);
    expect(await ctx.prisma.property.count()).toBe(0);
  });

  // ── The happy path, asserted in the database ────────────────────────────
  it('creates a yard and persists every field', async () => {
    const landlord = await signUp(ctx, 'LANDLORD');
    const res = await ctx.http().post('/api/properties')
      .set('Authorization', `Bearer ${landlord.token}`).send(yard);

    expect(res.status).toBe(201);
    const row = await ctx.prisma.property.findFirst();
    expect(row).toMatchObject({
      name: yard.name,
      city: yard.city,
      province: yard.province,
      currentHousemates: 4,
    });
    expect(row!.sharedAmenities).toEqual(yard.sharedAmenities);
  });

  it('attaches the yard to the landlord who created it, not to anyone else', async () => {
    const landlord = await signUp(ctx, 'LANDLORD');
    const other = await signUp(ctx, 'LANDLORD');
    await ctx.http().post('/api/properties')
      .set('Authorization', `Bearer ${landlord.token}`).send(yard).expect(201);

    const row = await ctx.prisma.property.findFirst({ select: { landlordId: true } });
    const owner = await ctx.prisma.user.findUnique({ where: { email: landlord.email } });
    const stranger = await ctx.prisma.user.findUnique({ where: { email: other.email } });
    expect(row!.landlordId).toBe(owner!.id);
    expect(row!.landlordId).not.toBe(stranger!.id);
  });

  // ── Invalid input ───────────────────────────────────────────────────────
  it.each([
    ['a missing name', { ...yard, name: undefined }],
    ['a name of one character', { ...yard, name: 'x' }],
    ['a negative housemate count', { ...yard, currentHousemates: -1 }],
    ['an unexpected field', { ...yard, isAdmin: true }],
  ])('rejects %s with 400 and writes nothing', async (_label, body) => {
    const landlord = await signUp(ctx, 'LANDLORD');
    const res = await ctx.http().post('/api/properties')
      .set('Authorization', `Bearer ${landlord.token}`).send(body as any);
    expect(res.status).toBe(400);
    expect(await ctx.prisma.property.count()).toBe(0);
  });

  /**
   * 🔴 DEFECT, RECORDED NOT FIXED — a yard may be created in a province that
   * does not exist.
   *
   * `PropertyDto.province` is `@IsString() @MinLength(2) @MaxLength(120)`,
   * while `CreateRoomDto.province` and `RoomFiltersDto.province` are both
   * `@IsIn(SA_PROVINCES)`. Three handlings of one field, two of which agree.
   *
   * The consequence is not cosmetic: the board's province filter only accepts
   * the nine real provinces, so a yard stored as "Atlantis" can never be
   * reached by the filter that exists to find it. It is findable by nothing
   * and visible in nothing, while looking saved.
   *
   * This test asserts what the code DOES, because changing a validation rule
   * to make a test pass is not a test engineer's call to make. The fix is one
   * decorator, and the question that goes with it is what to do about any
   * yard already stored with a province outside the list — making the DTO
   * strict would start refusing updates to those records.
   */
  it('🔴 accepts a province that does not exist, unlike rooms (known defect)', async () => {
    const landlord = await signUp(ctx, 'LANDLORD');
    const res = await ctx.http().post('/api/properties')
      .set('Authorization', `Bearer ${landlord.token}`)
      .send({ ...yard, province: 'Atlantis' });

    expect(res.status).toBe(201);
    const row = await ctx.prisma.property.findFirst();
    expect(row!.province).toBe('Atlantis');

    // The same value on the room side is refused — the inconsistency itself.
    const roomRes = await ctx.http().post('/api/rooms')
      .set('Authorization', `Bearer ${landlord.token}`)
      .send({ title: 'A room', roomType: 'shared_house', rentCents: 150000,
              province: 'Atlantis', city: 'Nowhere', locationDisplay: 'Nowhere',
              availableFrom: '2026-12-01', propertyId: row!.id });
    expect(roomRes.status).toBe(400);
  });

  // ── Update, and who may do it ───────────────────────────────────────────
  async function createYard() {
    const landlord = await signUp(ctx, 'LANDLORD');
    const res = await ctx.http().post('/api/properties')
      .set('Authorization', `Bearer ${landlord.token}`).send(yard).expect(201);
    return { landlord, id: res.body.id as string };
  }

  it('updates a yard the landlord owns', async () => {
    const { landlord, id } = await createYard();
    const res = await ctx.http().patch(`/api/properties/${id}`)
      .set('Authorization', `Bearer ${landlord.token}`)
      .send({ houseRules: 'No visitors after 22:00.' });

    expect(res.status).toBe(200);
    const row = await ctx.prisma.property.findUnique({ where: { id } });
    expect(row!.houseRules).toBe('No visitors after 22:00.');
    // The untouched fields survive a partial update.
    expect(row!.name).toBe(yard.name);
  });

  it("refuses another landlord's update, and leaves the record unchanged", async () => {
    const { id } = await createYard();
    const intruder = await signUp(ctx, 'LANDLORD');

    const res = await ctx.http().patch(`/api/properties/${id}`)
      .set('Authorization', `Bearer ${intruder.token}`)
      .send({ houseRules: 'I now own this yard.' });

    expect([403, 404]).toContain(res.status);
    const row = await ctx.prisma.property.findUnique({ where: { id } });
    expect(row!.houseRules).toBe(yard.houseRules);
  });

  it('returns 404 for a yard that does not exist', async () => {
    const landlord = await signUp(ctx, 'LANDLORD');
    const res = await ctx.http()
      .patch('/api/properties/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${landlord.token}`).send({ houseRules: 'x' });
    expect([403, 404]).toContain(res.status);
  });

  // ── Failure handling ────────────────────────────────────────────────────
  it('leaves no partial record when an update is invalid', async () => {
    const { landlord, id } = await createYard();
    const before = await ctx.prisma.property.findUnique({ where: { id } });

    await ctx.http().patch(`/api/properties/${id}`)
      .set('Authorization', `Bearer ${landlord.token}`)
      .send({ currentHousemates: 9999, houseRules: 'should not be saved' })
      .expect(400);

    const after = await ctx.prisma.property.findUnique({ where: { id } });
    expect(after).toEqual(before);
  });

  it('does not reach any external service while doing ordinary work', async () => {
    // The doubles record instead of sending. Nothing in this workflow should
    // email, upload, message or charge anybody — and if that changes, this
    // says so rather than a real address finding out.
    const { landlord, id } = await createYard();
    await ctx.http().patch(`/api/properties/${id}`)
      .set('Authorization', `Bearer ${landlord.token}`).send({ suburb: 'Ivory Park' }).expect(200);

    expect(ctx.outbox.uploads).toHaveLength(0);
    expect(ctx.outbox.whatsapps).toHaveLength(0);
    expect(ctx.outbox.payments).toHaveLength(0);
  });

  // ── Isolation between tests ─────────────────────────────────────────────
  it('starts from an empty database, so no test depends on another', async () => {
    expect(await ctx.prisma.property.count()).toBe(0);
    expect(await ctx.prisma.user.count()).toBe(0);
  });
});
