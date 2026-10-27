import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestApp, resetDatabase, resetRateLimits, signUp, signUpAdmin, TestContext,
} from './support/test-app';

/**
 * Board advertising — the review gate, and what reaches the public payload.
 *
 * ── What was already covered, so this file does not repeat it
 *
 * `scripts/smoke-test.sh` drives this domain in CI and drives it well: the
 * public endpoints answer, a landlord and a tenant are refused every admin
 * route, an admin creates an advertiser and a campaign and approves it, the
 * approved campaign is then served, a Gauteng campaign is NOT served on a
 * Western Cape page, a suburb campaign stays in its suburb, `targetUrl` is
 * absent from the public payload, a house ad does not outrank a paid campaign,
 * and the click endpoint's Location header points at the site rather than the
 * API. `docs/API-TESTING.md` §6 listed ads among the domains with "refusal
 * coverage only", and that was out of date.
 *
 * ── What nothing covered
 *
 * Every one of those serving assertions runs AFTER the campaign is approved.
 * Nothing asserted the negative — that a creative which has not been through
 * review cannot reach the board — and that is the control with teeth here.
 * `reviewCampaign`'s own comment says why: "a scam ad on a rental platform,
 * seen by people about to pay deposits to strangers, does far more damage than
 * the placement earns".
 *
 * It could. `PATCH /campaigns/:id/status` is the pause/resume control and it
 * wrote `status` unconditionally, so it was a second door onto the board that
 * went around the review step entirely (§99).
 */
describe('Ads — nothing reaches the board unreviewed', () => {
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

  /** An advertiser and a campaign, through the real admin endpoints. */
  async function pendingCampaign(headline = 'Fibre at your new place') {
    const admin = await signUpAdmin(ctx);
    const advertiser = await ctx.http().post('/api/ads/advertisers').set(auth(admin.token)).send({
      companyName: 'Probe Fibre', contactName: 'Thandi Sales',
      contactEmail: 'sales@probe.invalid', contactPhone: '0820000000',
      notes: 'Introduced by the agency. Invoice reference 4471.',
    }).expect(201);

    const campaign = await ctx.http().post('/api/ads/campaigns').set(auth(admin.token)).send({
      advertiserId: advertiser.body.id,
      name: 'Gauteng sidebar flight',
      placement: 'board_sidebar',
      headline,
      targetUrl: 'https://advertiser.invalid/landing',
      province: 'Gauteng',
      startsAt: new Date(Date.now() - 86_400_000).toISOString(),
      endsAt: '2099-01-01',
      monthlyRateCents: 250_000,
    }).expect(201);

    // Not a formality: the whole file rests on this being the created state.
    expect(campaign.body.status).toBe('pending_review');
    expect(campaign.body.approvedAt ?? null).toBeNull();

    return { admin, advertiserId: advertiser.body.id as string, id: campaign.body.id as string };
  }

  const board = () =>
    ctx.http().get('/api/ads?placement=board_sidebar&province=Gauteng&limit=20').expect(200);

  // ── The review gate ───────────────────────────────────────────────────
  it('does not serve a creative that has not been reviewed', async () => {
    const { id } = await pendingCampaign();
    const served = await board();
    expect(served.body.map((a: any) => a.id)).not.toContain(id);
  });

  it('refuses to activate a creative that has never been approved', async () => {
    const { admin, id } = await pendingCampaign('SEND A DEPOSIT TO THIS NUMBER');

    /**
     * ⚠️ The defect this file was written for. This answered 200, put the
     * creative on the public board, and left approvedById and approvedAt NULL,
     * so nothing recorded who had done it.
     */
    const res = await ctx.http().patch(`/api/ads/campaigns/${id}/status`)
      .set(auth(admin.token)).send({ status: 'active' }).expect(400);
    expect(res.body.message).toMatch(/not been approved/i);

    const served = await board();
    expect(
      served.body.map((a: any) => a.headline),
      'an unreviewed creative reached the public board',
    ).not.toContain('SEND A DEPOSIT TO THIS NUMBER');

    const row = await ctx.prisma.adCampaign.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('pending_review');
    expect(row.approvedAt).toBeNull();
  });

  it('refuses to activate a creative an admin rejected', async () => {
    const { admin, id } = await pendingCampaign('SEND A DEPOSIT TO THIS NUMBER');

    await ctx.http().patch(`/api/ads/campaigns/${id}/review`)
      .set(auth(admin.token)).send({ status: 'rejected', rejectionReason: 'Obvious deposit scam' })
      .expect(200);

    const res = await ctx.http().patch(`/api/ads/campaigns/${id}/status`)
      .set(auth(admin.token)).send({ status: 'active' }).expect(400);
    // The refusal names the rejection, so the way back is review and not a
    // second attempt at this route.
    expect(res.body.message).toMatch(/rejected/i);

    const served = await board();
    expect(served.body.map((a: any) => a.id)).not.toContain(id);

    const row = await ctx.prisma.adCampaign.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('rejected');
    // Rejected AND active was the state this used to reach: the reason stayed
    // written on a row that was live.
    expect(row.rejectionReason).toBe('Obvious deposit scam');
  });

  it('serves it once approved, and pausing then resuming still works', async () => {
    const { admin, id } = await pendingCampaign();

    await ctx.http().patch(`/api/ads/campaigns/${id}/review`)
      .set(auth(admin.token)).send({ status: 'approved' }).expect(200);

    expect((await board()).body.map((a: any) => a.id)).toContain(id);

    await ctx.http().patch(`/api/ads/campaigns/${id}/status`)
      .set(auth(admin.token)).send({ status: 'paused' }).expect(200);
    expect((await board()).body.map((a: any) => a.id)).not.toContain(id);

    /**
     * ⚠️ The regression the gate could easily have caused. A paused campaign
     * HAS been approved, so resuming it must still work — a fix that locked
     * activation to the review endpoint alone would have taken the
     * pause/resume control away from every live campaign.
     */
    await ctx.http().patch(`/api/ads/campaigns/${id}/status`)
      .set(auth(admin.token)).send({ status: 'active' }).expect(200);
    expect((await board()).body.map((a: any) => a.id)).toContain(id);
  });

  it('lets an admin end a campaign whatever state it is in', async () => {
    // Stopping an ad must never be blocked: that is the control you reach for
    // when a live creative turns out to be a problem.
    const { admin, id } = await pendingCampaign();
    await ctx.http().patch(`/api/ads/campaigns/${id}/status`)
      .set(auth(admin.token)).send({ status: 'ended' }).expect(200);
    expect((await ctx.prisma.adCampaign.findUniqueOrThrow({ where: { id } })).status).toBe('ended');
  });

  it('validates the status body instead of handing it to the database', async () => {
    const { admin, id } = await pendingCampaign();

    // Was a 500: the string went to Prisma and violated the enum.
    const junk = await ctx.http().patch(`/api/ads/campaigns/${id}/status`)
      .set(auth(admin.token)).send({ status: 'not-a-real-status' }).expect(400);
    expect(String(junk.body.message)).toMatch(/active, paused, ended/);

    // Was a 200 that changed nothing, which is not an honest answer to a
    // request that said nothing.
    await ctx.http().patch(`/api/ads/campaigns/${id}/status`)
      .set(auth(admin.token)).send({}).expect(400);

    // A real AdStatus that is not one of the three this route offers.
    await ctx.http().patch(`/api/ads/campaigns/${id}/status`)
      .set(auth(admin.token)).send({ status: 'pending_review' }).expect(400);
  });

  // ── The public payload ────────────────────────────────────────────────
  it('tells the public the advertiser\'s name and nothing else about them', async () => {
    const { admin, id } = await pendingCampaign();
    await ctx.http().patch(`/api/ads/campaigns/${id}/review`)
      .set(auth(admin.token)).send({ status: 'approved' }).expect(200);

    const served = await board();
    const ad = served.body.find((a: any) => a.id === id);
    expect(ad).toBeTruthy();

    expect(ad.advertiser).toBe('Probe Fibre');
    // The whole serialised ad, so a field added by a careless spread shows up
    // here rather than in production.
    const text = JSON.stringify(ad);
    for (const secret of ['sales@probe.invalid', '0820000000', 'Invoice reference 4471']) {
      expect(text, `the public payload leaked ${secret}`).not.toContain(secret);
    }
    // "the destination is not exposed until the click happens"
    expect(Object.keys(ad)).not.toContain('targetUrl');
    expect(ad.clickUrl).toBe(`/api/ads/${id}/click`);
  });

  // ── The impression beacon ─────────────────────────────────────────────
  it('counts an impression only for a campaign that is actually running', async () => {
    const { admin, id } = await pendingCampaign();

    /**
     * ⚠️ Public and unauthenticated by design — it is a beacon from the board.
     * It had no status filter, which `recordClick` already had, so five
     * anonymous posts put 5 impressions on a campaign still in review.
     * Flat monthly pricing means that costs a REPORT rather than an invoice,
     * but /campaigns/:id/stats is what an advertiser is shown.
     */
    for (let i = 0; i < 3; i++) {
      await ctx.http().post('/api/ads/impressions').send({ campaignIds: [id] }).expect(204);
    }
    await new Promise((r) => setTimeout(r, 300));
    expect((await ctx.prisma.adCampaign.findUniqueOrThrow({ where: { id } })).impressions).toBe(0);

    await ctx.http().patch(`/api/ads/campaigns/${id}/review`)
      .set(auth(admin.token)).send({ status: 'approved' }).expect(200);

    for (let i = 0; i < 3; i++) {
      await ctx.http().post('/api/ads/impressions').send({ campaignIds: [id] }).expect(204);
    }
    await new Promise((r) => setTimeout(r, 300));
    expect((await ctx.prisma.adCampaign.findUniqueOrThrow({ where: { id } })).impressions).toBe(3);
  });

  it('bounds the beacon body instead of trusting the body parser', async () => {
    // A declared ceiling on the route, rather than the request size limit
    // happening to refuse a very large array.
    const many = Array.from({ length: 50 }, () => '00000000-0000-4000-8000-000000000000');
    await ctx.http().post('/api/ads/impressions').send({ campaignIds: many }).expect(400);
    await ctx.http().post('/api/ads/impressions').send({ campaignIds: ['not-a-uuid'] }).expect(400);
    await ctx.http().post('/api/ads/impressions').send({}).expect(400);

    /**
     * ⚠️ A uuid that is NOT version 4 is still a uuid, and must be accepted.
     *
     * This assertion exists because the first version of the DTO said
     * `IsUUID('4')`. The seeded demo campaigns carry deterministic ids like
     * the one below — version 0 — so every impression from a board showing a
     * demo ad came back 400. The cases above all used a v4-shaped placeholder
     * and passed; `scripts/smoke-test.sh` caught it, because it posts the id
     * of a real seeded campaign. An accepted body answers 204 whether or not
     * the id matches a row, since the beacon is deliberately indifferent.
     */
    await ctx.http().post('/api/ads/impressions')
      .send({ campaignIds: ['00000000-0000-0000-0000-0000000000b1'] }).expect(204);
  });

  it('keeps the counters aggregate, with no row that could name a viewer', async () => {
    /**
     * The schema's own claim: "Aggregate counters only. Deliberately not
     * per-user rows — knowing which tenant saw which ad is information we have
     * no need for, and s.10 minimality says do not collect it." Asserted the
     * same way view-counting does it (§98), because a column that does not
     * exist cannot store a viewer.
     */
    const cols = await ctx.prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ad_campaigns'
    `;
    const names = cols.map((c) => c.column_name);
    expect(names).toContain('impressions');
    expect(names).toContain('clicks');
    for (const forbidden of ['viewerId', 'userId', 'viewer_id', 'user_id', 'sessionId', 'ipAddress']) {
      expect(names, `ad_campaigns gained ${forbidden}`).not.toContain(forbidden);
    }

    /**
     * And no sibling table holds per-view rows either.
     *
     * ⚠️ `~ '^ad_'` and not `LIKE 'ad_%'`: in LIKE, `_` is a single-character
     * wildcard, so `'ad_%'` also matches `advertisers`. The first version of
     * this assertion failed on that and the fix is the pattern, not the
     * expectation — widening the expected list to include `advertisers` would
     * have left a check that no longer said what it means.
     */
    const tables = await ctx.prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name ~ '^ad_'
    `;
    expect(tables.map((t) => t.table_name).sort()).toEqual(['ad_campaigns', 'ad_enquiries']);
  });

  it('refuses an ordinary account the status control', async () => {
    const { admin, id } = await pendingCampaign();
    await ctx.http().patch(`/api/ads/campaigns/${id}/review`)
      .set(auth(admin.token)).send({ status: 'approved' }).expect(200);

    const landlord = await signUp(ctx, 'LANDLORD');
    await ctx.http().patch(`/api/ads/campaigns/${id}/status`)
      .set(auth(landlord.token)).send({ status: 'ended' }).expect(403);
    await ctx.http().patch(`/api/ads/campaigns/${id}/status`)
      .send({ status: 'ended' }).expect(401);

    expect((await ctx.prisma.adCampaign.findUniqueOrThrow({ where: { id } })).status).toBe('active');
  });
});
