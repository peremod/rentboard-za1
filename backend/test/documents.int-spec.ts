import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestApp, resetDatabase, signUp, signUpAdmin, type TestContext,
} from './support/test-app';

/**
 * Private documents, end to end: upload reference → admin review → deletion.
 *
 * ── Why this boundary, and why these assertions
 *
 * CLAUDE.md states the POPIA position as "documents stay private, are deleted
 * per the existing retention pattern, and ONLY OUTCOMES PERSIST". Every
 * assertion below is one half of that sentence, and the reason they are
 * integration tests rather than unit tests is that nothing about this promise
 * lives in one function: the path is stored by the service, withheld by two
 * different response shapes, signed by the storage edge, cleared inside a
 * transaction, queued for deletion in a second table, and drained after the
 * commit. A unit test of any one of those passes while the promise is broken.
 *
 * ⚠️ This repository has already shipped the broken version. `documentPath`
 * was once returned raw to the admin screen (so no reviewer could open a
 * document at all), and `documentDeletedAt` was a column that deleted
 * nothing — the trail said the bytes were gone while they sat in storage
 * indefinitely. Both read as working features. So the tests here assert the
 * EFFECT (a committed file_deletions row, a cleared column, a signed URL that
 * carries an expiry) and never the wording of a response.
 */
describe('private documents: submission, review and deletion', () => {
  let ctx: TestContext;

  beforeAll(async () => { ctx = await createTestApp(); }, 60_000);
  afterAll(async () => { await ctx?.close(); });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.outbox.deletionsQueued.length = 0;
    ctx.outbox.deletionPasses.length = 0;
    ctx.outbox.signedUrls.length = 0;
  });

  const DOC = 'private/verification/bank-statement-aug.jpg';

  const submit = (token: string, body: Record<string, unknown>) =>
    ctx.http().post('/api/verification').set({ Authorization: `Bearer ${token}` }).send(body);

  const asTenantWithDocument = async () => {
    const tenant = await signUp(ctx, 'TENANT');
    const res = await submit(tenant.token, { type: 'bank_statement', documentPath: DOC });
    expect([200, 201]).toContain(res.status);
    return { tenant, res };
  };

  // ── Submission ────────────────────────────────────────────────────────────

  it('stores the document path but never echoes it back to the submitter', async () => {
    const { res } = await asTenantWithDocument();

    // The submitter knows their own path — they uploaded it — but the response
    // shape is the one the admin screen reuses, and a shape that carries the
    // path is one copy-paste away from leaking it. `hasDocument` is the whole
    // contract.
    expect(res.body.hasDocument).toBe(true);
    expect(res.body.documentPath).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(DOC);

    const row = await ctx.prisma.verificationRequest.findFirst();
    expect(row!.documentPath).toBe(DOC);
    expect(row!.status).toBe('pending');
  });

  it('keeps the path out of the submitter\'s own list', async () => {
    const { tenant } = await asTenantWithDocument();
    const res = await ctx.http().get('/api/verification/mine')
      .set({ Authorization: `Bearer ${tenant.token}` }).expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].hasDocument).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(DOC);
  });

  it('refuses a document on a check that is a phone call, not a file', async () => {
    const tenant = await signUp(ctx, 'TENANT');
    const res = await submit(tenant.token, {
      type: 'landlord_reference',
      documentPath: DOC,
      reference: { refereeName: 'Mrs Dlamini', refereePhone: '0821234567' },
    });
    expect(res.status).toBe(400);
    // Nothing collected is the POPIA-preferable failure: a path accepted and
    // ignored is still a path stored.
    expect(await ctx.prisma.verificationRequest.count()).toBe(0);
  });

  it('refuses a check that belongs to the other side of the market', async () => {
    const tenant = await signUp(ctx, 'TENANT');
    const res = await submit(tenant.token, { type: 'proof_of_ownership', documentPath: DOC });
    expect(res.status).toBe(400);
    expect(await ctx.prisma.verificationRequest.count()).toBe(0);
  });

  it('holds a landlord identity check out of the queue until the fee is paid', async () => {
    const landlord = await signUp(ctx, 'LANDLORD');
    const res = await submit(landlord.token, { type: 'identity', documentPath: DOC });
    expect([200, 201]).toContain(res.status);

    const row = await ctx.prisma.verificationRequest.findFirst();
    expect(row!.status).toBe('pending_payment');

    // Not merely a different status: an unpaid request must not appear to an
    // admin, or the fee is advisory.
    const admin = await signUpAdmin(ctx);
    const queue = await ctx.http().get('/api/verification/pending')
      .set({ Authorization: `Bearer ${admin.token}` }).expect(200);
    expect(queue.body).toHaveLength(0);
  });

  it('charges a tenant nothing for any check, in any of the income types', async () => {
    // Free to apply, always (CLAUDE.md). A tenant proving they are poor enough
    // to need a room must never hit a paywall, so this asserts the status
    // across every income proof rather than one of them.
    for (const type of ['sassa_grant', 'employer_confirmation', 'bank_statement']) {
      await resetDatabase(ctx.prisma);
      const tenant = await signUp(ctx, 'TENANT');
      const res = await submit(tenant.token, { type, documentPath: DOC });
      expect([200, 201]).toContain(res.status);
      const row = await ctx.prisma.verificationRequest.findFirst();
      expect(row!.status, `${type} must go straight to review`).toBe('pending');
    }
  });

  // ── Download ──────────────────────────────────────────────────────────────

  it('hands the admin queue a signed, expiring URL and not the stored path', async () => {
    await asTenantWithDocument();
    const admin = await signUpAdmin(ctx);

    const queue = await ctx.http().get('/api/verification/pending')
      .set({ Authorization: `Bearer ${admin.token}` }).expect(200);

    expect(queue.body).toHaveLength(1);
    const entry = queue.body[0];
    expect(entry.hasDocument).toBe(true);
    expect(entry.documentPath).toBeUndefined();
    expect(entry.documentUrl).toBeTruthy();
    // The raw path must not be the thing the screen links to — that is the
    // exact shipped bug: a relative path resolved against the app's own origin.
    expect(entry.documentUrl).not.toBe(DOC);

    // And the URL must be short-lived, asked for with an expiry rather than
    // minted forever.
    expect(ctx.outbox.signedUrls).toHaveLength(1);
    expect(ctx.outbox.signedUrls[0].path).toBe(DOC);
    expect(ctx.outbox.signedUrls[0].validForSeconds).toBeGreaterThan(0);
    expect(ctx.outbox.signedUrls[0].validForSeconds).toBeLessThanOrEqual(60 * 60);
  });

  it('refuses an ordinary account the review queue', async () => {
    const { tenant } = await asTenantWithDocument();
    const landlord = await signUp(ctx, 'LANDLORD');

    for (const token of [tenant.token, landlord.token]) {
      const res = await ctx.http().get('/api/verification/pending')
        .set({ Authorization: `Bearer ${token}` });
      expect([401, 403]).toContain(res.status);
    }
    const anon = await ctx.http().get('/api/verification/pending');
    expect([401, 403]).toContain(anon.status);

    // No signed URL may be minted on a refused request. A guard that rejects
    // after the service has already signed the document is not a guard.
    expect(ctx.outbox.signedUrls).toHaveLength(0);
  });

  it('keeps one person\'s audit trail away from another', async () => {
    const { tenant } = await asTenantWithDocument();
    const row = await ctx.prisma.verificationRequest.findFirst();
    const stranger = await signUp(ctx, 'TENANT');

    const theirs = await ctx.http().get(`/api/verification/mine/${row!.id}/history`)
      .set({ Authorization: `Bearer ${tenant.token}` }).expect(200);
    expect(theirs.body.length).toBeGreaterThan(0);

    const res = await ctx.http().get(`/api/verification/mine/${row!.id}/history`)
      .set({ Authorization: `Bearer ${stranger.token}` });
    expect([401, 403, 404]).toContain(res.status);
  });

  // ── Review deletes the bytes, either way ──────────────────────────────────

  const review = (token: string, id: string, body: Record<string, unknown>) =>
    ctx.http().patch(`/api/verification/${id}/review`)
      .set({ Authorization: `Bearer ${token}` }).send(body);

  for (const decision of ['approved', 'rejected'] as const) {
    it(`deletes the document when a request is ${decision}`, async () => {
      await asTenantWithDocument();
      const admin = await signUpAdmin(ctx);
      const row = await ctx.prisma.verificationRequest.findFirst();

      const res = await review(admin.token, row!.id, {
        status: decision,
        reviewNote: decision === 'rejected' ? 'The screenshot is cropped past the balance.' : undefined,
      });
      expect(res.status).toBe(200);

      const after = await ctx.prisma.verificationRequest.findUnique({ where: { id: row!.id } });
      expect(after!.status).toBe(decision);
      // Only the outcome persists.
      expect(after!.documentPath).toBeNull();
      expect(after!.documentWithdrawnAt).toBeTruthy();

      // Durable, so a storage outage cannot quietly turn "deleted" into
      // "forgotten" — this row is the whole retention guarantee.
      const queued = await ctx.prisma.fileDeletion.findMany();
      expect(queued).toHaveLength(1);
      expect(queued[0].path).toBe(DOC);
      expect(queued[0].verificationRequestId).toBe(row!.id);

      // And asked for immediately, because the screen promises "as soon as
      // someone has looked at it", not "within the hour".
      expect(ctx.outbox.deletionPasses).toHaveLength(1);
    });
  }

  it('refuses a rejection with no reason, and deletes nothing', async () => {
    await asTenantWithDocument();
    const admin = await signUpAdmin(ctx);
    const row = await ctx.prisma.verificationRequest.findFirst();

    const res = await review(admin.token, row!.id, { status: 'rejected' });
    expect(res.status).toBe(400);

    // The whole decision must be atomic: a refused review that had already
    // cleared the path would destroy the document and leave the request
    // pending, un-reviewable forever.
    const after = await ctx.prisma.verificationRequest.findUnique({ where: { id: row!.id } });
    expect(after!.documentPath).toBe(DOC);
    expect(after!.status).toBe('pending');
    expect(await ctx.prisma.fileDeletion.count()).toBe(0);
    expect(ctx.outbox.deletionPasses).toHaveLength(0);
  });

  it('refuses an ordinary account the right to decide, and deletes nothing', async () => {
    const { tenant } = await asTenantWithDocument();
    const row = await ctx.prisma.verificationRequest.findFirst();

    const res = await review(tenant.token, row!.id, { status: 'approved' });
    expect([401, 403]).toContain(res.status);

    const after = await ctx.prisma.verificationRequest.findUnique({ where: { id: row!.id } });
    expect(after!.status).toBe('pending');
    expect(after!.documentPath).toBe(DOC);
    expect(await ctx.prisma.fileDeletion.count()).toBe(0);
  });

  it('refuses a second decision on a request already reviewed', async () => {
    await asTenantWithDocument();
    const admin = await signUpAdmin(ctx);
    const row = await ctx.prisma.verificationRequest.findFirst();

    await review(admin.token, row!.id, { status: 'approved' }).then((r) => expect(r.status).toBe(200));
    const again = await review(admin.token, row!.id, {
      status: 'rejected', reviewNote: 'Changed my mind.',
    });
    expect(again.status).toBe(400);

    const after = await ctx.prisma.verificationRequest.findUnique({ where: { id: row!.id } });
    expect(after!.status).toBe('approved');
    expect(await ctx.prisma.fileDeletion.count()).toBe(1);
  });

  // ── What survives: the outcome, and nothing else ──────────────────────────

  it('publishes the outcome of an approved check and nothing private with it', async () => {
    const { tenant } = await asTenantWithDocument();
    const admin = await signUpAdmin(ctx);
    const row = await ctx.prisma.verificationRequest.findFirst();
    await review(admin.token, row!.id, { status: 'approved' }).then((r) => expect(r.status).toBe(200));

    const res = await ctx.http().get(`/api/verification/badge/${tenant.userId}`)
      .set({ Authorization: `Bearer ${admin.token}` }).expect(200);

    expect(res.body.checks.map((c: any) => c.type)).toEqual(['bank_statement']);
    expect(res.body.checks[0].confirmedAt).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain(DOC);
  });

  it('never publishes a rejection, nor the note written about it', async () => {
    // A landlord reading "income proof: rejected" would be screening on a
    // private failure. PEPUDA aside, it is not what the badge is for.
    const { tenant } = await asTenantWithDocument();
    const admin = await signUpAdmin(ctx);
    const row = await ctx.prisma.verificationRequest.findFirst();
    const note = 'Statement belongs to somebody else.';
    await review(admin.token, row!.id, { status: 'rejected', reviewNote: note })
      .then((r) => expect(r.status).toBe(200));

    const landlord = await signUp(ctx, 'LANDLORD');
    const res = await ctx.http().get(`/api/verification/badge/${tenant.userId}`)
      .set({ Authorization: `Bearer ${landlord.token}` }).expect(200);

    expect(res.body.checks).toHaveLength(0);
    expect(res.body.hasPassport).toBe(false);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(note);
    expect(body).not.toContain('rejected');
  });

  it('grants a passport only on identity AND an income proof, never on one', async () => {
    const tenant = await signUp(ctx, 'TENANT');
    const admin = await signUpAdmin(ctx);

    const approve = async (type: string) => {
      const r = await submit(tenant.token, { type, documentPath: `${DOC}#${type}` });
      expect([200, 201]).toContain(r.status);
      const req = await ctx.prisma.verificationRequest.findFirst({
        where: { userId: tenant.userId, type: type as any, status: 'pending' },
      });
      await review(admin.token, req!.id, { status: 'approved' }).then((x) => expect(x.status).toBe(200));
    };

    await approve('identity');
    let badge = await ctx.http().get(`/api/verification/badge/${tenant.userId}`)
      .set({ Authorization: `Bearer ${tenant.token}` }).expect(200);
    expect(badge.body.idVerified).toBe(true);
    expect(badge.body.hasPassport, 'identity alone is not a passport').toBe(false);

    await approve('bank_statement');
    badge = await ctx.http().get(`/api/verification/badge/${tenant.userId}`)
      .set({ Authorization: `Bearer ${tenant.token}` }).expect(200);
    expect(badge.body.hasPassport).toBe(true);

    // Both documents gone, both deletions recorded.
    const paths = (await ctx.prisma.verificationRequest.findMany()).map((r) => r.documentPath);
    expect(paths).toEqual([null, null]);
    expect(await ctx.prisma.fileDeletion.count()).toBe(2);
  });
});
