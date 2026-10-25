import { describe, it, expect, vi } from 'vitest';
import { TenantInboxService, TENANT_INBOX_KINDS } from './tenant-inbox.service';
import { LandlordInboxService, LANDLORD_INBOX_KINDS } from '../landlord-inbox/landlord-inbox.service';

/**
 * Two dashboards, one shape, and the bug that took both down.
 *
 * Each inbox fans out to seven independent queries and merges the results.
 * They used `Promise.all`, which rejects on the FIRST rejection — so one bad
 * row in any one section answered the whole endpoint with a 500, and both
 * dashboards call their inbox on load. The screen became a "Server error"
 * dialog with nothing behind it; reported from a phone on 25 October, once per
 * role, and `GET /api/tenant-inbox (500)` only because the dialog had just been
 * taught to quote the call.
 *
 * ⚠️ These tests exist because the real failure could NOT be reproduced here.
 * Every one of the thirteen calls each dashboard makes answers 200 against a
 * local database, through every state that could be built: an application, a
 * shortlisting, an unread message, a viewing fifteen days gone with no outcome,
 * an acceptance with and without a tenancy. Whatever row production holds, this
 * container does not have it — so what is tested is not that one specific row,
 * which would be a test written to the shape of a guess, but the PROPERTY that
 * makes the specific row survivable: a section that throws costs its own items
 * and nothing else.
 *
 * The second test is the NaN count: `viewing_elapsed` was in both kind unions
 * and in neither counts object, because both were written out by hand and cast
 * with `as Record<InboxKind, number>` — and a cast is where type checking
 * stops. `counts.viewing_elapsed++` incremented `undefined`, so the API
 * answered `null` for it to every user who had one.
 */

/** A prisma double where one named model's `findMany` throws and the rest answer empty. */
function prismaWith(broken: string | null) {
  const model = (name: string) => ({
    findMany: vi.fn(async () => {
      if (name === broken) throw new Error(`simulated failure in ${name}`);
      return [];
    }),
    findUnique: vi.fn(async () => {
      if (name === broken) throw new Error(`simulated failure in ${name}`);
      return null;
    }),
    count: vi.fn(async () => 0),
  });
  return {
    application: model('application'),
    roomViewing: model('roomViewing'),
    tenancy: model('tenancy'),
    tenantProfile: model('tenantProfile'),
    room: model('room'),
    rentPeriod: model('rentPeriod'),
    user: model('user'),
    survey: model('survey'),
    surveyResponse: model('surveyResponse'),
    surveyDismissal: model('surveyDismissal'),
  } as never;
}

const surveysStub = { inboxItem: vi.fn(async () => null) } as never;
const leaseStub = { upcoming: vi.fn(async () => []) } as never;

describe('the tenant inbox survives one broken section', () => {
  it('answers rather than throwing when a section fails', async () => {
    const service = new TenantInboxService(prismaWith('roomViewing'), surveysStub);

    const result = await service.inbox('tenant-1');

    expect(result.items).toEqual([]);
    expect(result.partial).toBe(true);
  });

  it('is not partial when every section answers', async () => {
    const service = new TenantInboxService(prismaWith(null), surveysStub);

    const result = await service.inbox('tenant-1');

    expect(result.partial).toBe(false);
  });

  it('counts every kind it can emit, so none of them answers null', async () => {
    const service = new TenantInboxService(prismaWith(null), surveysStub);

    const { counts } = await service.inbox('tenant-1');

    // Every declared kind is present AND is a number. `viewing_elapsed` was
    // missing, which made it NaN, which JSON renders as null.
    for (const kind of TENANT_INBOX_KINDS) {
      expect(counts[kind], `counts.${kind}`).toBe(0);
    }
    expect(Object.keys(counts).sort()).toEqual([...TENANT_INBOX_KINDS].sort());
  });
});

describe('the landlord inbox survives one broken section', () => {
  it('answers rather than throwing when a section fails', async () => {
    const service = new LandlordInboxService(prismaWith('application'), leaseStub, surveysStub);

    const result = await service.inbox('landlord-1');

    expect(result.partial).toBe(true);
  });

  it('counts every kind it can emit, so none of them answers null', async () => {
    const service = new LandlordInboxService(prismaWith(null), leaseStub, surveysStub);

    const { counts } = await service.inbox('landlord-1');

    for (const kind of LANDLORD_INBOX_KINDS) {
      expect(counts[kind], `counts.${kind}`).toBe(0);
    }
    expect(Object.keys(counts).sort()).toEqual([...LANDLORD_INBOX_KINDS].sort());
  });
});
