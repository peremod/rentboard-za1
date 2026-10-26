import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestApp, resetDatabase, resetRateLimits, signUp, createLetting,
  assertTestDatabase, TestContext,
} from './support/test-app';

/**
 * Notices — the channel that works when there is no email address.
 *
 * ── Why this file exists
 *
 * `docs/API-TESTING.md` §6 listed notices among eight domains with "refusal
 * coverage only": the 236-route sweep calls all four notice routes with a
 * sample UUID and asserts a signed-out caller gets 401. That is a real check
 * and it is the only one there was — nothing asserted that a notice a person
 * is sent can be read back by them.
 *
 * Which is exactly the bug this codebase already shipped. `NoticeRouter` wrote
 * `Notice` rows from v1.85.0 as "the channel that cannot fail for reasons
 * outside our control", and until Phase 7g **nothing could read them**: a
 * phone-only landlord's "you have a new applicant" went into a table, WhatsApp
 * refused it outside the 24-hour window, and the person was told nothing by
 * any channel. CLAUDE.md lists it as "a notice channel nobody could read",
 * beside the `documentDeletedAt` that deleted nothing and the `Message.readAt`
 * nobody wrote.
 *
 * ⚠️ So no test here inserts a Notice with Prisma. Every notice read below was
 * written by the application, as a side effect of a real action taken over
 * HTTP, because a fixture that writes the row by hand asserts the test's idea
 * of the channel and would have passed in full on the version where the read
 * did not exist.
 */
describe('Notices — written by the app, read by their owner', () => {
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
    ctx.outbox.emails.length = 0;
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('refuses to run against a database that is not named for testing', () => {
    expect(() => assertTestDatabase('postgresql://u:p@host:5432/mastande')).toThrow();
  });

  // ── The write and the read meet ────────────────────────────────────────
  it('delivers a notice the landlord can actually read back', async () => {
    const { landlord } = await createLetting(ctx);

    const res = await ctx.http().get('/api/notices').set(auth(landlord.token)).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const kinds = res.body.map((n: any) => n.kind);
    expect(kinds, `landlord notices: ${JSON.stringify(kinds)}`).toContain('new_application');

    const applied = res.body.find((n: any) => n.kind === 'new_application');
    // The title carries the tenant's name and the room, because a notice that
    // says only "new application" sends the person hunting for which room.
    expect(applied.title).toMatch(/applied for/i);
    // Never absolute: the Notice model's own comment requires an in-app path,
    // and an absolute URL here would be an open redirect on a tap.
    expect(applied.link.startsWith('/')).toBe(true);
    expect(applied.readAt ?? null).toBeNull();
  });

  it('delivers one to the tenant too, so both sides of the same letting are told', async () => {
    const { tenant } = await createLetting(ctx);

    const res = await ctx.http().get('/api/notices').set(auth(tenant.token)).expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    // Whatever the acceptance is called, the tenant must not be reading the
    // landlord's copy of events.
    const titles = res.body.map((n: any) => n.title).join(' | ');
    expect(titles).not.toMatch(/applied for/i);
  });

  // ── Scoping: the WHERE clause, not a check after loading ───────────────
  it('does not show one person another person\'s notices', async () => {
    const { landlord, tenant } = await createLetting(ctx);
    const stranger = await signUp(ctx, 'TENANT');

    const mine = await ctx.http().get('/api/notices').set(auth(landlord.token)).expect(200);
    const theirs = await ctx.http().get('/api/notices').set(auth(tenant.token)).expect(200);
    const none = await ctx.http().get('/api/notices').set(auth(stranger.token)).expect(200);

    expect(mine.body.length).toBeGreaterThan(0);
    expect(theirs.body.length).toBeGreaterThan(0);
    // A third party in the same database sees an empty list, not a 403: there
    // is nothing of theirs to show.
    expect(none.body).toEqual([]);

    const mineIds = new Set(mine.body.map((n: any) => n.id));
    const overlap = theirs.body.filter((n: any) => mineIds.has(n.id));
    expect(overlap, `${overlap.length} notice(s) served to both parties`).toEqual([]);
  });

  // ── The nav badge ─────────────────────────────────────────────────────
  it('serves an unread count that agrees with the full list, not with itself', async () => {
    const { landlord } = await createLetting(ctx);

    const badge = await ctx.http().get('/api/notices/unread').set(auth(landlord.token)).expect(200);
    const all = await ctx.http().get('/api/notices').set(auth(landlord.token)).expect(200);

    /**
     * ⚠️ Compared against the OTHER endpoint, deliberately.
     *
     * The first version of this test asserted `count === items.length`, and
     * falsifying it is what exposed that as a tautology: the controller
     * computes the count FROM that array, so the two can never disagree and
     * the assertion could not fail. It was one more control that only looks
     * like a control — the thing CLAUDE.md says this codebase keeps shipping.
     *
     * The count is worth checking against something it is not derived from:
     * the unread rows the full list shows. A filter that drifts between the
     * two endpoints — the badge counting read notices, or the list hiding
     * unread ones — is then visible here.
     */
    const unreadInFullList = all.body.filter((n: any) => n.readAt === null);
    expect(badge.body.count).toBe(unreadInFullList.length);
    expect(badge.body.count).toBeGreaterThan(0);
    expect(badge.body.items.every((n: any) => n.readAt === null)).toBe(true);

    const badgeIds = [...badge.body.items.map((n: any) => n.id)].sort();
    const listIds = [...unreadInFullList.map((n: any) => n.id)].sort();
    expect(badgeIds).toEqual(listIds);

    /**
     * ⚠️ Known limit, asserted nowhere because it is not what this test is
     * about: `unread()` takes 50 and the count is that array's length, so a
     * person with more than 50 unread notices is shown "50". Recorded in
     * docs/OUTSTANDING.md rather than left as a surprise.
     */
  });

  it('drops the unread count when one is marked read, and leaves the notice readable', async () => {
    const { landlord } = await createLetting(ctx);

    const before = await ctx.http().get('/api/notices/unread').set(auth(landlord.token)).expect(200);
    const target = before.body.items[0];

    const marked = await ctx.http().patch(`/api/notices/${target.id}/read`)
      .set(auth(landlord.token)).send({}).expect(200);
    expect(marked.body.updated).toBe(1);

    const after = await ctx.http().get('/api/notices/unread').set(auth(landlord.token)).expect(200);
    expect(after.body.count).toBe(before.body.count - 1);
    expect(after.body.items.map((n: any) => n.id)).not.toContain(target.id);

    // Read is not deleted. /account/notices says "this screen is the record",
    // so the row must still be served by the full list, now with a timestamp.
    const all = await ctx.http().get('/api/notices').set(auth(landlord.token)).expect(200);
    const still = all.body.find((n: any) => n.id === target.id);
    expect(still, 'the notice vanished from the record once read').toBeTruthy();
    expect(still.readAt).not.toBeNull();

    // Marking it again is a no-op, not an error: a second tap on a slow phone
    // must not read as a failure.
    const again = await ctx.http().patch(`/api/notices/${target.id}/read`)
      .set(auth(landlord.token)).send({}).expect(200);
    expect(again.body.updated).toBe(0);
  });

  // ── The claim the controller makes about itself ────────────────────────
  it('answers a mark-read on somebody else\'s notice as a miss, not a refusal', async () => {
    const { landlord, tenant } = await createLetting(ctx);

    const victim = await ctx.http().get('/api/notices/unread')
      .set(auth(landlord.token)).expect(200);
    const target = victim.body.items[0];

    /**
     * ⚠️ 200 with `updated: 0`, and that is the point rather than sloppiness.
     * The controller's own comment says the endpoint "cannot be used to
     * discover that a notice exists", which only holds if an id belonging to
     * someone else answers exactly as an id belonging to nobody does. A 404
     * here would confirm the opposite — that this id is real — one id at a
     * time.
     */
    const theft = await ctx.http().patch(`/api/notices/${target.id}/read`)
      .set(auth(tenant.token)).send({}).expect(200);
    expect(theft.body.updated).toBe(0);

    const invented = await ctx.http()
      .patch('/api/notices/00000000-0000-4000-8000-000000000000/read')
      .set(auth(tenant.token)).send({}).expect(200);
    expect(invented.body.updated).toBe(0);
    // Indistinguishable: same status, same body.
    expect(theft.body).toEqual(invented.body);

    // And the owner's notice is untouched — the miss did not mark it.
    const after = await ctx.http().get('/api/notices/unread')
      .set(auth(landlord.token)).expect(200);
    expect(after.body.items.map((n: any) => n.id)).toContain(target.id);
  });

  it('marks everything read for the caller and nothing for anyone else', async () => {
    const { landlord, tenant } = await createLetting(ctx);

    const theirsBefore = await ctx.http().get('/api/notices/unread')
      .set(auth(tenant.token)).expect(200);
    expect(theirsBefore.body.count).toBeGreaterThan(0);

    const res = await ctx.http().post('/api/notices/read-all')
      .set(auth(landlord.token)).send({}).expect(200);
    expect(res.body.updated).toBeGreaterThan(0);

    const mineAfter = await ctx.http().get('/api/notices/unread')
      .set(auth(landlord.token)).expect(200);
    expect(mineAfter.body.count).toBe(0);
    expect(mineAfter.body.items).toEqual([]);

    const theirsAfter = await ctx.http().get('/api/notices/unread')
      .set(auth(tenant.token)).expect(200);
    expect(theirsAfter.body.count).toBe(theirsBefore.body.count);
  });

  // ── Ordering and the cap ──────────────────────────────────────────────
  it('serves notices newest first, so the cap drops the oldest and not the newest', async () => {
    /**
     * ⚠️ `all()` takes 100 and `unread()` takes 50. A cap with the wrong sort
     * order is the quiet version of this bug: the rows are all there, the
     * endpoint answers 200, and the person's most recent notice is the one
     * missing. Asserted on the ordering rather than by writing 101 notices,
     * which would be a slow test of the same property.
     */
    const { landlord, tenant, applicationId } = await createLetting(ctx);

    /**
     * ⚠️ A SECOND notice for the SAME landlord, and it has to come from a
     * different action. The first version of this test called createLetting
     * twice, which builds a second landlord — the first one still had one
     * notice and the assertion failed on its own fixture. A message from the
     * tenant notifies the landlord through the same router, so this is one
     * person with two notices written minutes apart by two unrelated events,
     * which is the shape the ordering claim is about.
     */
    await ctx.http().post(`/api/applications/${applicationId}/messages`)
      .set(auth(tenant.token)).send({ body: 'Good day, may I come and see the room on Saturday?' })
      .expect(201);

    const res = await ctx.http().get('/api/notices').set(auth(landlord.token)).expect(200);
    expect(res.body.length).toBeGreaterThan(1);

    const times = res.body.map((n: any) => new Date(n.createdAt).getTime());
    const sorted = [...times].sort((a, b) => b - a);
    expect(times, 'notices are not newest-first').toEqual(sorted);
  });
});
