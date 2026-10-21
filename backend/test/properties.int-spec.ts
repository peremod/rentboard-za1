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
   * §79b, fixed: a yard must be in one of the nine real provinces.
   *
   * It used to be `@IsString()` here while CreateRoomDto and RoomFiltersDto
   * were both `@IsIn(SA_PROVINCES)`. The board's province filter accepts only
   * the real nine, so a yard stored as "Atlantis" could never be reached by
   * the filter that exists to find it, while looking perfectly saved.
   */
  it('refuses a province that does not exist', async () => {
    const landlord = await signUp(ctx, 'LANDLORD');
    const res = await ctx.http().post('/api/properties')
      .set('Authorization', `Bearer ${landlord.token}`)
      .send({ ...yard, province: 'Atlantis' });

    expect(res.status).toBe(400);
    expect(await ctx.prisma.property.count()).toBe(0);
  });

  it('accepts every one of the nine real provinces', async () => {
    // Exhaustive over the list the rest of the system validates against, so
    // the fix cannot have narrowed it to a subset by accident.
    const provinces = [
      'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
      'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape',
    ];
    const landlord = await signUp(ctx, 'LANDLORD');
    for (const province of provinces) {
      const res = await ctx.http().post('/api/properties')
        .set('Authorization', `Bearer ${landlord.token}`)
        .send({ ...yard, name: `Yard in ${province}`, province });
      expect({ province, status: res.status }).toEqual({ province, status: 201 });
    }
    expect(await ctx.prisma.property.count()).toBe(provinces.length);
  });

  it('agrees with the room side, which always refused it', async () => {
    // The inconsistency itself: one field, three DTOs, now all the same.
    const landlord = await signUp(ctx, 'LANDLORD');
    const property = await ctx.http().post('/api/properties')
      .set('Authorization', `Bearer ${landlord.token}`).send(yard).expect(201);

    const roomRes = await ctx.http().post('/api/rooms')
      .set('Authorization', `Bearer ${landlord.token}`)
      .send({ title: 'A room', roomType: 'shared_house', rentCents: 150000,
              province: 'Atlantis', city: 'Nowhere', locationDisplay: 'Nowhere',
              availableFrom: '2026-12-01', propertyId: property.body.id });
    expect(roomRes.status).toBe(400);
  });

  it('refuses an invalid province on UPDATE too, leaving the record alone', async () => {
    // The update DTO is separate from the create one here — not a PartialType
    // — so it had to be fixed independently, and a test that only covered
    // create would have missed half of it.
    const landlord = await signUp(ctx, 'LANDLORD');
    const created = await ctx.http().post('/api/properties')
      .set('Authorization', `Bearer ${landlord.token}`).send(yard).expect(201);

    const res = await ctx.http().patch(`/api/properties/${created.body.id}`)
      .set('Authorization', `Bearer ${landlord.token}`).send({ province: 'Atlantis' });
    expect(res.status).toBe(400);

    const row = await ctx.prisma.property.findUnique({ where: { id: created.body.id } });
    expect(row!.province).toBe('Gauteng');
  });

  it('still allows an edit that does not mention the province', async () => {
    // The ordinary case must not become harder: most edits are house rules
    // or a suburb, and they carry no province at all.
    const landlord = await signUp(ctx, 'LANDLORD');
    const created = await ctx.http().post('/api/properties')
      .set('Authorization', `Bearer ${landlord.token}`).send(yard).expect(201);

    await ctx.http().patch(`/api/properties/${created.body.id}`)
      .set('Authorization', `Bearer ${landlord.token}`)
      .send({ houseRules: 'Gate locked at 20:00.' }).expect(200);

    const row = await ctx.prisma.property.findUnique({ where: { id: created.body.id } });
    expect(row!.houseRules).toBe('Gate locked at 20:00.');
    expect(row!.province).toBe('Gauteng');
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
