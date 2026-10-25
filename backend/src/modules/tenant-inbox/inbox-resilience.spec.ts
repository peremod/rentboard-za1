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

/**
 * The 500 itself, which was never a row — §91.
 *
 * `messageItems()` asks for applications that HAVE an unread message, and for
 * each one the unread messages. Prisma loads a to-many relation with a SEPARATE
 * query, so that one `findMany` is four SELECTs with the messages one last, and
 * anything setting `readAt` in between leaves a matched row with an EMPTY list.
 * `r.messages[0].createdAt` was a TypeError, which is a 500, on an endpoint the
 * dashboard calls on load.
 *
 * ⚠️ This double is NOT the evidence that Prisma can produce that row — it
 * cannot be. `scripts/inbox-race-drive.mjs` drives the real service against a
 * real Postgres with the real concurrent write and measured 19 of 30 attempts
 * failing before the fix, 0 of 40 after. This is the fast version of the same
 * property, so CI holds the line without a database.
 */
describe('the tenant inbox and a message list emptied mid-query', () => {
  /** One application that matched the outer filter, whose inner list came back empty. */
  function prismaWithRacedMessages() {
    const base = prismaWith(null) as unknown as Record<string, { findMany: unknown }>;
    return {
      ...base,
      application: {
        ...base.application,
        findMany: vi.fn(async () => [
          {
            id: 'app-1',
            status: 'pending',
            decidedAt: null,
            createdAt: new Date(),
            room: {
              id: 'room-1',
              title: 'Back room in Yeoville',
              locationDisplay: 'Yeoville',
              status: 'active',
              landlord: { fullName: 'A Landlord' },
            },
            tenancy: null,
            // The race: matched on "has an unread message", then had none.
            messages: [],
          },
        ]),
      },
    } as never;
  }

  it('does not throw when the unread messages were read mid-query', async () => {
    const service = new TenantInboxService(prismaWithRacedMessages(), surveysStub);

    const result = await service.inbox('tenant-1');

    // Not partial: nothing failed. A caught TypeError would make it true, which
    // is what this asserts against — the per-section catch from §89 would
    // otherwise hide the defect behind a merely-degraded response.
    expect(result.partial).toBe(false);
  });

  it('emits no message item for a conversation with nothing unread in it', async () => {
    const service = new TenantInboxService(prismaWithRacedMessages(), surveysStub);

    const { items, counts } = await service.inbox('tenant-1');

    // Skipped, not defaulted. `?? new Date()` would invent "1 unread message,
    // sent today" for a thread they had just finished reading.
    expect(items.filter((i) => i.kind === 'message_unread')).toEqual([]);
    expect(counts.message_unread).toBe(0);
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
