import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { LostNumberService } from './lost-number.service';

/**
 * Two admins deciding one account recovery at the same moment — §95's shape on
 * the one decision in this codebase that hands over an account.
 *
 * `approve()` checked `status !== 'open'` and then wrote unconditionally;
 * `refuse()` checked `status === 'recovered'` and did the same. Both checks are
 * reads, so two admins acting together both passed them and the last write won:
 * an approval could overwrite a deliberate refusal and leave a live recovery
 * code on a request somebody had decided against.
 *
 * ⚠️ **This cannot be driven end to end here, and that is why these tests
 * exist.** `approve()` refuses with a 503 while `WHATSAPP_ENABLED` is false —
 * which it is, and stays, until the business can carry the per-message cost —
 * so the smoke suite's lost-number section asserts the authorisation surface
 * and the queue and never reaches the decision itself. 626 smoke assertions
 * pass without touching either branch below.
 *
 * So what is asserted is the thing the compare-and-swap is for: when the claim
 * is LOST, nothing is handed over and nothing is sent.
 */

/**
 * A prisma double that models the RACE, not just a decided row.
 *
 * ⚠️ The first version of this returned the already-decided status from the
 * very first read, so the method's own `status !== 'open'` check threw and
 * every test passed — with the compare-and-swap in place AND with it removed.
 * Falsified by restoring the unconditional write: 5 passed. A test that cannot
 * tell whether the fix is there is not testing the fix.
 *
 * The real shape is that the read sees `open` — that is the whole point, both
 * admins see an open request — and the CLAIM is what loses. So the first read
 * answers `open`, and the re-read after a failed claim answers what the winner
 * left behind.
 */
function prismaWith(claimed: number, lostTo = 'refused') {
  let reads = 0;
  return {
    accountRecovery: {
      findUnique: vi.fn(async () => ({
        id: 'rec-1',
        userId: 'user-1',
        newPhone: '+27820000000',
        // Open on the way in. Whatever the winner wrote, on the way back.
        status: reads++ === 0 ? 'open' : lostTo,
        idSeenAt: new Date(),
      })),
      updateMany: vi.fn(async () => ({ count: claimed })),
      update: vi.fn(async () => ({})),
    },
    user: { findFirst: vi.fn(async () => null) },
  } as never;
}

const whatsappOn = { isEnabled: () => true, sendOtp: vi.fn(async () => undefined) };
const noticeStub = { toUser: vi.fn(async () => undefined), deliver: vi.fn(async () => undefined) } as never;
const configStub = { get: vi.fn(() => 'test-secret-minimum-32-characters-long-ok') } as never;

describe('two admins approving one recovery at the same moment', () => {
  it('refuses the lost claim, and sends no code', async () => {
    const whatsapp = { ...whatsappOn, sendOtp: vi.fn(async () => undefined) };
    const service = new LostNumberService(prismaWith(0, 'refused'), whatsapp as never, noticeStub, configStub);

    await expect(service.approve('admin-2', 'rec-1')).rejects.toBeInstanceOf(BadRequestException);

    // The point of claiming BEFORE sending: a decision that has been overtaken
    // must not still put a live code on somebody's handset.
    expect(whatsapp.sendOtp).not.toHaveBeenCalled();
  });

  it('says which state it lost to, rather than a generic refusal', async () => {
    const service = new LostNumberService(prismaWith(0, 'refused'), whatsappOn as never, noticeStub, configStub);

    await expect(service.approve('admin-2', 'rec-1')).rejects.toThrow(/already refused/i);
  });

  it('lets the winner through', async () => {
    const whatsapp = { ...whatsappOn, sendOtp: vi.fn(async () => undefined) };
    const service = new LostNumberService(prismaWith(1), whatsapp as never, noticeStub, configStub);

    await expect(service.approve('admin-1', 'rec-1')).resolves.toBeDefined();
    expect(whatsapp.sendOtp).toHaveBeenCalledTimes(1);
  });
});

describe('a refusal arriving after the hand-over', () => {
  it('is refused rather than writing over an account that has already moved', async () => {
    const service = new LostNumberService(prismaWith(0, 'recovered'), whatsappOn as never, noticeStub, configStub);

    await expect(service.refuse('admin-1', 'rec-1', 'The story did not hold up.'))
      .rejects.toThrow(/already been handed over/i);
  });

  it('refuses an open request normally', async () => {
    const service = new LostNumberService(prismaWith(1), whatsappOn as never, noticeStub, configStub);

    await expect(service.refuse('admin-1', 'rec-1', 'The story did not hold up.'))
      .resolves.toMatchObject({ status: 'refused' });
  });
});
