import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp, resetDatabase, resetRateLimits, signUp, TestContext } from './support/test-app';

/**
 * Referrals — the abuse guards, which nothing asserted.
 *
 * ── What is already checked
 *
 * `scripts/smoke-test.sh` §29 covers the happy path and the access rules: a
 * landlord gets a code, it validates publicly, the validate response leaks no
 * ownerId or email, a signup with the code is recorded as pending, an unknown
 * code is rejected, /referrals/mine needs auth, a tenant cannot read admin
 * stats and an admin can. §100 drove the full chain end to end.
 *
 * ── What its own header said, and what it checked
 *
 * ⚠️ That section opens: "The assertions that matter are the abuse guards:
 * self-referral, double referral, and rewarding a signup that never did
 * anything." NONE OF THE THREE IS ASSERTED. The nearest is
 * `pending >= 1`, which proves the signup landed — not that it stayed
 * unrewarded. A header naming the checks a section does not make is the same
 * defect as a check that cannot see its subject; it just reads as coverage
 * from further away.
 *
 * ── And two of those guards cannot fire
 *
 * ⚠️ `recordSignup(refereeId, code)` has exactly two callers,
 * auth.service.ts:103 and phone-signup.service.ts:420, and both pass the id
 * of a user created moments earlier in the same method. So:
 *
 *   if (code.ownerId === refereeId) return null;            // self-referral
 *   const existing = await …findUnique({ where: { refereeId } });  // one per person
 *
 * compare a brand-new id against a pre-existing owner, and against a table
 * that cannot yet hold a row for it. Neither condition is reachable through
 * the only paths that call this. They are defensive rather than broken, and
 * they are not the guards the header claims are checked.
 *
 * ⚠️ The abuse they are named for is NOT stopped: one person registering a
 * SECOND account and using their own code is two different user ids, which no
 * id comparison can see. Detecting that needs identity, and identity is a
 * product decision — recorded in docs/OUTSTANDING.md rather than invented here.
 *
 * ── So this file asserts the guards that CAN fire
 *
 * Every one is a property of the CODE rather than of the referee, which is
 * exactly why they are reachable where the other two are not.
 */
describe('Referrals — the guards that can actually fire', () => {
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

  /** A landlord with a real code, issued through the real endpoint. */
  async function referrerWithCode() {
    const landlord = await signUp(ctx, 'LANDLORD');
    const res = await ctx.http().get('/api/referrals/mine').set(auth(landlord.token)).expect(200);
    return { landlord, code: res.body.code as string };
  }

  /**
   * Registration always answers 201 — "a bad code must not stop someone
   * joining" — so every assertion below reads the referral TABLE. The reply
   * is identical whether the code was honoured or dropped.
   */
  const SETTLE_MS = 2000;

  /**
   * ⚠️ `expected` is not decoration, and getting it wrong made one of these
   * cases unable to fail.
   *
   * recordSignup is fire-and-forget — auth.service.ts calls it with
   * `.catch(() => {})` and does not await — so the row lands shortly AFTER
   * the 201. The first version of this helper polled `if (count) break`,
   * which is already true once ANY referral exists. So in the maximum-uses
   * case the second registration returned instantly, the assertion read the
   * table before the second write could land, and the test passed with the
   * maxUses guard deleted. It was measuring my own polling, not the guard.
   *
   * So: wait until the count REACHES what this registration should produce.
   * And when it should produce nothing, wait the whole window rather than
   * returning early — a row that is never going to appear is indistinguishable
   * from one that has not appeared yet, unless you give it the same time.
   */
  async function registerWith(code: string | undefined, email: string, expected: number) {
    const res = await ctx.http().post('/api/auth/register').send({
      email, password: 'TestPass123', fullName: 'Referred Person', role: 'TENANT',
      ...(code ? { referralCode: code } : {}),
    }).expect(201);

    const deadline = Date.now() + SETTLE_MS;
    while (Date.now() < deadline) {
      if (expected > 0 && (await ctx.prisma.referral.count()) >= expected) break;
      await new Promise((r) => setTimeout(r, 40));
    }
    return res;
  }

  it('⚠️ never rewards a signup that did nothing', async () => {
    // The third guard the header names, and the one with money behind it:
    // "Signups are not rewarded on their own — that is how referral schemes
    // fill with dormant accounts."
    const { landlord, code } = await referrerWithCode();
    await registerWith(code, `referred-${Date.now()}@test.invalid`, 1);

    const [referral] = await ctx.prisma.referral.findMany();
    expect(referral.status).toBe('pending');
    // 'none', not null: ReferralReward is an enum defaulting to `none`, and
    // the only other value is `free_verification`. Asserted against the enum
    // rather than a guess — the first draft of this line expected null and
    // was wrong about the product, not the other way round.
    expect(referral.reward).toBe('none');
    expect(referral.qualifyingAction).toBeNull();

    const mine = await ctx.http().get('/api/referrals/mine').set(auth(landlord.token)).expect(200);
    expect(mine.body.summary.pending).toBe(1);
    expect(mine.body.summary.qualified).toBe(0);
    expect(mine.body.summary.freeVerificationsAvailable).toBe(0);
  });

  it('records nothing for an expired code, and still registers the person', async () => {
    const { code } = await referrerWithCode();
    await ctx.prisma.referralCode.update({
      where: { code }, data: { expiresAt: new Date('2020-01-01') },
    });

    await registerWith(code, `expired-${Date.now()}@test.invalid`, 0);
    expect(await ctx.prisma.referral.count()).toBe(0);
    // The person is still in: a bad code must never cost somebody an account.
    expect(await ctx.prisma.user.count({ where: { email: { contains: 'expired-' } } })).toBe(1);
  });

  it('records nothing once a code has reached its maximum uses', async () => {
    const { code } = await referrerWithCode();
    await ctx.prisma.referralCode.update({ where: { code }, data: { maxUses: 1 } });

    await registerWith(code, `first-${Date.now()}@test.invalid`, 1);
    expect(await ctx.prisma.referral.count()).toBe(1);

    await registerWith(code, `second-${Date.now()}@test.invalid`, 0);
    expect(await ctx.prisma.referral.count()).toBe(1);   // still one
  });

  it('records nothing for a deactivated code', async () => {
    const { code } = await referrerWithCode();
    await ctx.prisma.referralCode.update({ where: { code }, data: { isActive: false } });

    await registerWith(code, `inactive-${Date.now()}@test.invalid`, 0);
    expect(await ctx.prisma.referral.count()).toBe(0);
  });

  it('records nothing for a code that does not exist', async () => {
    await registerWith('NONSENSE-XX', `unknown-${Date.now()}@test.invalid`, 0);
    expect(await ctx.prisma.referral.count()).toBe(0);
  });

  it('counts a use only when one is recorded', async () => {
    // useCount drives maxUses, so a code that increments on a REFUSED signup
    // would exhaust itself without referring anybody.
    const { code } = await referrerWithCode();
    await ctx.prisma.referralCode.update({ where: { code }, data: { isActive: false } });
    await registerWith(code, `nocount-${Date.now()}@test.invalid`, 0);

    const after = await ctx.prisma.referralCode.findUnique({ where: { code } });
    expect(after!.useCount).toBe(0);
  });
});
