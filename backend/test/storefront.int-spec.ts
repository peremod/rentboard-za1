import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestApp, resetDatabase, resetRateLimits, signUp, signUpAdmin, TestContext,
} from './support/test-app';

/**
 * The storefront, and the one public surface the visibility rule never reached.
 *
 * ── What is already checked, so this file does not re-check it
 *
 * `scripts/storefront-drive.mjs` is a GOOD drive — around thirty assertions,
 * every subject created through the real endpoints rather than staged with
 * SQL, which is the defect `notices-drive.mjs` was retired for (§97). It
 * covers the slug being minted on first read and staying stable, OFF by
 * default, unpublished and never-existed both answering 404 with the same
 * body, publishing, unpublishing taking the page down again, collisions
 * across three landlords with the same name, a draft room staying off the
 * page, the count matching the list, no email on it, every badge carrying its
 * basis, no verified badge for an unverified landlord, 403 to a tenant, 401
 * to a stranger, and the sitemap entry at priority 0.6.
 *
 * ⚠️ **And nothing runs it.** `scripts/smoke-test.sh:4092` points at it for
 * the cases it does not duplicate — "checked properly in
 * scripts/storefront-drive.mjs" — and it is in no workflow. Which makes
 * storefront the sixth domain §6 describes wrongly, in a new way: the
 * coverage exists, it is good, and it is dead. It is added to CI in the same
 * commit as this file; what follows is what it still could not see.
 *
 * ── 🔴 What nothing checked: the room URL of a landlord nobody should see
 *
 * `PUBLIC_USER` (`common/prisma/account-visibility.ts`) exists because this
 * rule was written three times and the copies disagreed. Its own doc names
 * what must go dark when an account is paused by its owner, suspended by an
 * admin or ended: "their public page, their storefront and their rooms."
 *
 * Measured here before it was fixed, with a landlord suspended by an admin:
 *
 *     board            0 rooms          ✅
 *     sitemap          room gone        ✅
 *     sitemap          storefront gone  ✅
 *     GET /storefronts/:slug   404      ✅
 *     GET /rooms/:id           200      🔴  full listing, to nobody at all
 *
 * The three that held do so by accident. Suspending or deactivating an
 * account pauses every `active` room, so the board and the sitemap filter on
 * `status` and never have to ask about the person — exactly the incidental
 * correctness `PUBLIC_USER` was introduced to replace. `findOne` refused a
 * `deleted` room and a `draft` one and asked nothing about the landlord.
 *
 * It is the link that makes it matter. A room reaches people on WhatsApp, so
 * the URL is the thing that outlives the board — and a suspension for a
 * suspected scam took the listing off the board and left it live exactly
 * where the link pointed.
 */
describe('Storefront and the public visibility of a landlord', () => {
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

  /** A landlord with one published room and a published storefront. */
  async function landlordOnTheBoard() {
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

    // The slug is minted on first read, not at registration, so publishing
    // the storefront needs this call first — the service refuses otherwise.
    const settings = await ctx.http().get('/api/landlord/storefront')
      .set(auth(landlord.token)).expect(200);
    await ctx.http().patch('/api/landlord/storefront').set(auth(landlord.token))
      .send({ bio: 'I have let rooms in this yard for eleven years.', storefrontLive: true })
      .expect(200);

    return { landlord, roomId: room.body.id as string, slug: settings.body.slug as string };
  }

  /** Every public surface at once, so a fix to one cannot hide a gap in another. */
  async function publicSurfaces(roomId: string, slug: string) {
    const board = await ctx.http().get('/api/rooms').expect(200);
    const detail = await ctx.http().get(`/api/rooms/${roomId}`);
    const storefront = await ctx.http().get(`/api/storefronts/${slug}`);
    const sitemap = await ctx.http().get('/sitemap.xml').expect(200);
    const items = board.body.items ?? board.body.data ?? board.body;
    return {
      onBoard: (items as { id: string }[]).some((r) => r.id === roomId),
      detail: detail.status,
      storefront: storefront.status,
      roomInSitemap: sitemap.text.includes(roomId),
      storefrontInSitemap: sitemap.text.includes(`/landlords/${slug}`),
    };
  }

  it('shows all four surfaces while the account is in good standing', async () => {
    const { roomId, slug } = await landlordOnTheBoard();

    // The baseline, and not a formality: every assertion below is "this went
    // dark", which passes on a page that was never lit.
    expect(await publicSurfaces(roomId, slug)).toEqual({
      onBoard: true,
      detail: 200,
      storefront: 200,
      roomInSitemap: true,
      storefrontInSitemap: true,
    });
  });

  it('takes every public surface dark when an admin suspends the landlord', async () => {
    const { landlord, roomId, slug } = await landlordOnTheBoard();
    const admin = await signUpAdmin(ctx);

    await ctx.http().patch(`/api/admin/users/${landlord.userId}/active`)
      .set(auth(admin.token))
      .send({ isActive: false, reason: 'Reported as a deposit scam, ticket 918.' })
      .expect(200);

    /**
     * All four together. The detail page is the one that answered 200 before
     * the fix in `findOne`; asserting the set rather than that one line means
     * a later change that fixes the URL and breaks the sitemap is still
     * caught here.
     */
    expect(await publicSurfaces(roomId, slug)).toEqual({
      onBoard: false,
      detail: 404,
      storefront: 404,
      roomInSitemap: false,
      storefrontInSitemap: false,
    });
  });

  it('takes them dark when the landlord pauses their own account, and brings them back', async () => {
    const { landlord, roomId, slug } = await landlordOnTheBoard();

    await ctx.http().post('/api/account/deactivate').set(auth(landlord.token)).send({}).expect(200);

    const dark = await publicSurfaces(roomId, slug);
    // "A pause that leaves your shop window lit is not a pause" —
    // account-visibility.ts.
    expect(dark.detail, 'a paused landlord\'s room still answered at its URL').toBe(404);
    expect(dark.storefront).toBe(404);
    expect(dark.onBoard).toBe(false);
    expect(dark.roomInSitemap).toBe(false);
    expect(dark.storefrontInSitemap).toBe(false);

    /**
     * ⚠️ And the other half, which is what keeps the control from being a
     * trapdoor: the owner can still reach their own room while paused. They
     * have to be able to, or there is no way back.
     */
    await ctx.http().get(`/api/rooms/${roomId}`).set(auth(landlord.token)).expect(200);

    await ctx.http().post('/api/account/reactivate').set(auth(landlord.token)).send({}).expect(200);
    const back = await publicSurfaces(roomId, slug);
    // The storefront comes back because deactivation never touched
    // `storefrontLive`. The ROOM stays off the board on purpose — it was
    // paused on the way out and republishing it unasked would advertise a
    // room that may have been let in the meantime.
    expect(back.storefront).toBe(200);
    expect(back.storefrontInSitemap).toBe(true);
    expect(back.onBoard, 'reactivating republished a room nobody asked it to').toBe(false);
  });

  it('refuses the room of a closed account, to everyone', async () => {
    const { landlord, roomId, slug } = await landlordOnTheBoard();

    await ctx.http().delete('/api/account')
      .set(auth(landlord.token))
      // The word DELETE, typed, and the box ticked. 'CLOSE' is the ADMIN route's
      // word; this is the owner ending their own account.
      .send({ password: 'TestPass123', confirm: 'DELETE', understood: true })
      .expect(200);

    const gone = await publicSurfaces(roomId, slug);
    expect(gone.detail).toBe(404);
    expect(gone.storefront).toBe(404);
    expect(gone.roomInSitemap).toBe(false);
    expect(gone.storefrontInSitemap).toBe(false);
  });

  it('answers the same for a suspended landlord as for a room that never existed', async () => {
    const { landlord, roomId } = await landlordOnTheBoard();
    const admin = await signUpAdmin(ctx);

    await ctx.http().patch(`/api/admin/users/${landlord.userId}/active`)
      .set(auth(admin.token))
      .send({ isActive: false, reason: 'Reported as a deposit scam, ticket 918.' })
      .expect(200);

    const hidden = await ctx.http().get(`/api/rooms/${roomId}`).expect(404);
    const invented = await ctx.http()
      .get(`/api/rooms/${'3f2b1a44-0000-4000-8000-000000000000'}`).expect(404);

    /**
     * Indistinguishable, for the same reason the storefront's two 404s are:
     * a refusal that says "this one is hidden" tells a stranger the room is
     * real and its landlord was suspended. The storefront's smoke assertion
     * compares those two bodies already; nothing compared the room's.
     *
     * ⚠️ Not a string equality — this route names the id in the message, and
     * the ids differ by construction. What matters is that each body says
     * ONLY the id the caller themselves supplied, which tells them nothing
     * they did not already know. Written as a template so a message that
     * gained a reason ("landlord suspended") fails here.
     */
    const invented_id = '3f2b1a44-0000-4000-8000-000000000000';
    expect(hidden.body.message).toBe(`Room ${roomId} not found`);
    expect(invented.body.message).toBe(`Room ${invented_id} not found`);
  });

  describe('the response time on the trust page', () => {
    /**
     * An application answered a known number of hours after it arrived.
     *
     * The timestamps are written directly because the API cannot be asked to
     * have answered something yesterday — the FIGURE is what is under test,
     * not how a row gets its `viewedAt`, which the smoke suite drives.
     */
    async function answeredApplication(roomId: string, hours: number) {
      const tenant = await signUp(ctx, 'TENANT');
      const app = await ctx.http().post('/api/applications').set(auth(tenant.token)).send({
        roomId, coverNote: 'I would like to apply for this room, thank you.',
      }).expect(201);
      const createdAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await ctx.prisma.application.update({
        where: { id: app.body.id },
        data: { createdAt, viewedAt: new Date(createdAt.getTime() + hours * 3_600_000) },
      });
      return app.body.id as string;
    }

    it('quotes nothing from two answered applications, and a figure from three', async () => {
      const { roomId, slug } = await landlordOnTheBoard();

      await answeredApplication(roomId, 2);
      await answeredApplication(roomId, 4);

      /**
       * ⚠️ TWO is the boundary that matters, and the existing checks miss it.
       * Both the smoke assertion and the drive read the figure off a brand-new
       * landlord with ZERO applications, where deleting the rule entirely
       * still leaves `typicalResponseHours` falsy. At two answered
       * applications the rule is the only thing returning null.
       */
      const two = await ctx.http().get(`/api/storefronts/${slug}`).expect(200);
      expect(two.body.responseFrom).toBe(2);
      expect(two.body.typicalResponseHours, 'a response time was quoted from two replies').toBeNull();
      expect(two.body.badges.map((b: { id: string }) => b.id)).not.toContain('replies_fast');

      await answeredApplication(roomId, 6);
      const three = await ctx.http().get(`/api/storefronts/${slug}`).expect(200);
      expect(three.body.responseFrom).toBe(3);
      // 2, 4, 6 -> the middle one. A figure, not null: the rule has to stop
      // withholding as well as start.
      expect(three.body.typicalResponseHours).toBe(4);
      expect(three.body.badges.map((b: { id: string }) => b.id)).toContain('replies_fast');
    });

    it('is the median, so one forgotten application does not define them', async () => {
      const { roomId, slug } = await landlordOnTheBoard();

      await answeredApplication(roomId, 1);
      await answeredApplication(roomId, 2);
      await answeredApplication(roomId, 3);
      // Left over a long weekend. The mean of 1, 2, 3 and 600 is over 150
      // hours; the median is 2.5.
      await answeredApplication(roomId, 600);

      const res = await ctx.http().get(`/api/storefronts/${slug}`).expect(200);
      expect(res.body.responseFrom).toBe(4);
      expect(res.body.typicalResponseHours, 'the figure is a mean, not a median').toBe(2.5);
      // …and the badge still holds, because the habit is what it describes.
      expect(res.body.badges.map((b: { id: string }) => b.id)).toContain('replies_fast');
    });

    it('withholds the fast-reply badge from a landlord who is not fast', async () => {
      const { roomId, slug } = await landlordOnTheBoard();

      for (const h of [30, 40, 50]) await answeredApplication(roomId, h);

      const res = await ctx.http().get(`/api/storefronts/${slug}`).expect(200);
      // The figure is published — a reader can weigh 40 hours.
      expect(res.body.typicalResponseHours).toBe(40);
      // The BADGE is not. "Usually replies in 40 hours" is not a badge, it is
      // a warning, and a trust page that awards one is worse than silent.
      expect(res.body.badges.map((b: { id: string }) => b.id)).not.toContain('replies_fast');
    });
  });

  it('keeps a let room off the public page, as well as a draft', async () => {
    const { landlord, roomId, slug } = await landlordOnTheBoard();

    // The drive's own header claims "drafts and let rooms do not" appear and
    // then only creates a draft. A let room is the case that happens to every
    // successful listing.
    await ctx.prisma.room.update({ where: { id: roomId }, data: { status: 'let' } });

    const res = await ctx.http().get(`/api/storefronts/${slug}`).expect(200);
    expect(res.body.rooms).toEqual([]);
    expect(res.body.roomsAvailable).toBe(0);
    // The multi-room badge counts live listings, so it must not survive
    // either — it reads "N rooms available".
    expect(res.body.badges.map((b: { id: string }) => b.id)).not.toContain('multi_room');

    // ⚠️ And the landlord is still reachable: a page that empties itself when
    // every room is let is not the same as one that 404s.
    expect(res.body.slug).toBe(slug);
    await ctx.http().get(`/api/rooms/${roomId}`).set(auth(landlord.token)).expect(200);
  });
});
