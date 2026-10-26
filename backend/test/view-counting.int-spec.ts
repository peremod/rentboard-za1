import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestApp, resetDatabase, resetRateLimits, signUp, TestContext,
} from './support/test-app';

/**
 * Counting views without learning who viewed — Phase 7d, POPIA s.10.
 *
 * ── What is already checked, so this file does not re-check it
 *
 * `scripts/smoke-test.sh` drives the behaviour in CI and does it well: every
 * room carries a weekly figure including 0, a landlord opening their OWN room
 * does not count ("a landlord refreshing their listing to see how it looks
 * being reported back as interest is a lie about demand"), and somebody else
 * opening it counts as exactly one.
 *
 * ── What nothing checked
 *
 * CLAUDE.md states the privacy constraint as a design decision: `room_view_days`
 * "stores a count per day and no viewer identity for exactly this reason
 * (s.10, minimality)". That guarantee rested entirely on the shape of the
 * schema. A guarantee with no check is this codebase's recurring defect, and
 * the smoke assertions above cannot see it — they read a weekly TOTAL, which
 * is identical whether the table holds one row per day or one row per viewer
 * per day.
 *
 * So the two assertions here are about shape rather than arithmetic:
 *
 *   1. The table's columns are exactly roomId, day and count. A column that
 *      does not exist cannot store a viewer, which is a far stronger
 *      guarantee than a policy about what we write into one.
 *   2. Two DIFFERENT people viewing one room on one day leave ONE row. That
 *      is the same claim proven from the outside: per-viewer granularity would
 *      show up as a row each, and the weekly total would be identical.
 */
describe('View counting — a count per day, and no viewer', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx?.close();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    await resetRateLimits(ctx);
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** A published room, through the real endpoints. */
  async function publishedRoom() {
    const landlord = await signUp(ctx, 'LANDLORD');
    const property = await ctx.http().post('/api/properties').set(auth(landlord.token)).send({
      name: 'Ext 7 back rooms', city: 'Johannesburg', province: 'Gauteng', suburb: 'Tembisa',
    }).expect(201);
    const room = await ctx.http().post('/api/rooms').set(auth(landlord.token)).send({
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
    await ctx.http().patch(`/api/rooms/${room.body.id}`).set(auth(landlord.token))
      .send({ heroImagePath: '/integration-test-placeholder.jpg' }).expect(200);
    await ctx.http().post(`/api/rooms/${room.body.id}/publish`)
      .set(auth(landlord.token)).send({}).expect(200);
    return { landlord, roomId: room.body.id as string };
  }

  /**
   * ⚠️ POLLED. The two counters are written fire-and-forget — the service's
   * own comment says "a failed count must never stop somebody seeing a room" —
   * so the rows appear shortly AFTER the response. Reading them immediately
   * would pass or fail by timing.
   */
  async function viewRows(roomId: string, expected: number) {
    let rows: { roomId: string; day: Date; count: number }[] = [];
    for (let i = 0; i < 50; i++) {
      rows = await ctx.prisma.roomViewDay.findMany({ where: { roomId } });
      const total = rows.reduce((n, r) => n + r.count, 0);
      if (total >= expected) break;
      await new Promise((r) => setTimeout(r, 40));
    }
    return rows;
  }

  it('keeps no column that could hold a viewer', async () => {
    const cols = await ctx.prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'room_view_days'
    `;
    const names = cols.map((c) => c.column_name).sort();

    /**
     * Exact, not a subset. `toContain` would pass happily on a table that had
     * gained a `viewerId`, which is the only failure this test exists to
     * catch.
     */
    expect(names).toEqual(['count', 'day', 'roomId']);
  });

  it('leaves one row for two different people viewing on the same day', async () => {
    const { roomId } = await publishedRoom();
    const first = await signUp(ctx, 'TENANT');
    const second = await signUp(ctx, 'TENANT');

    await ctx.http().get(`/api/rooms/${roomId}`).set(auth(first.token)).expect(200);
    await ctx.http().get(`/api/rooms/${roomId}`).set(auth(second.token)).expect(200);

    const rows = await viewRows(roomId, 2);

    // One row — per-viewer granularity would be two, and the weekly total the
    // dashboard reads would be 2 either way.
    expect(rows.length, `rows: ${JSON.stringify(rows)}`).toBe(1);
    expect(rows[0].count).toBe(2);
  });

  it('counts a signed-out visitor without recording anything about them', async () => {
    const { roomId } = await publishedRoom();

    // No Authorization header at all: the room detail route takes optional
    // auth, so this is how most views on a public board actually arrive.
    await ctx.http().get(`/api/rooms/${roomId}`).expect(200);

    const rows = await viewRows(roomId, 1);
    expect(rows.length).toBe(1);
    expect(rows[0].count).toBe(1);
    // Nothing to assert about identity because there is nowhere to put it —
    // which is the point of the first test in this file.
  });

  it('does not count the landlord opening their own room', async () => {
    const { landlord, roomId } = await publishedRoom();

    await ctx.http().get(`/api/rooms/${roomId}`).set(auth(landlord.token)).expect(200);
    // Give the fire-and-forget write the same chance to land as the ones
    // above, so a pass here is "it did not happen" and not "it had not
    // happened yet".
    await new Promise((r) => setTimeout(r, 600));

    const rows = await ctx.prisma.roomViewDay.findMany({ where: { roomId } });
    expect(rows, `the landlord's own look was counted: ${JSON.stringify(rows)}`).toEqual([]);
  });
});
