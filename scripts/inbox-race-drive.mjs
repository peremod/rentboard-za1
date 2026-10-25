#!/usr/bin/env node
/**
 * The tenant dashboard's "Server error", driven against a real database.
 *
 * ── What it is
 *
 * `GET /api/tenant-inbox` answered 500 in production, reported from a phone on
 * 25 October, and §89 fixed the BLAST RADIUS without finding the cause: every
 * state buildable by hand answered 200, so the failing row stayed unidentified
 * and the item stayed open.
 *
 * It was never a row. It is a race, and it needs two things happening at once —
 * which is exactly what no static fixture can be.
 *
 * ── The mechanism
 *
 * `messageItems()` asks for applications that HAVE an unread message, and for
 * each one the unread messages themselves:
 *
 *     where:  { messages: { some: { senderId: { not: tenantId }, readAt: null } } }
 *     select: { messages: { where: { senderId: { not: tenantId }, readAt: null } } }
 *
 * Those read like one question asked twice. They are not. Prisma loads a
 * to-many relation with a SEPARATE query — this one findMany is four SELECTs,
 * and the messages SELECT is the last of them:
 *
 *     SELECT ... FROM applications WHERE (...)      <- the row matches here
 *     SELECT ... FROM rooms        WHERE id IN (..)
 *     SELECT ... FROM users        WHERE id IN (..)
 *     SELECT ... FROM messages     WHERE readAt IS NULL AND ...   <- empty here
 *
 * Anything that sets `readAt` between the first and the last leaves a row the
 * outer query matched with an EMPTY message list. The code then read
 * `r.messages[0].createdAt` unconditionally — a TypeError, which is a 500, for
 * a dashboard that calls this endpoint on load.
 *
 * ⚠️ And the window is not narrow, because `messages.service.ts` fires the
 * mark-read WITHOUT awaiting it (`.catch(() => {})`, deliberately, so a
 * failure there cannot stop somebody reading their messages). Opening a thread
 * and landing on the dashboard is all it takes.
 *
 * ── Why a drive and not only a unit test
 *
 * There is a unit test too (`inbox-resilience.spec.ts`), and it is the one CI
 * runs: it feeds the service a row whose message list is empty and asserts it
 * does not throw. But a double cannot show that PRISMA can produce that row,
 * which is the whole claim. This drives the real service against a real
 * Postgres with a real concurrent write, and it fails if the race is open.
 *
 *   node scripts/inbox-race-drive.mjs            # needs a seeded local database
 */
import { PrismaClient } from '../backend/node_modules/@prisma/client/default.js';
import { TenantInboxService } from '../backend/dist/modules/tenant-inbox/tenant-inbox.service.js';
import { randomUUID } from 'node:crypto';

const ATTEMPTS = Number(process.env.ATTEMPTS ?? 30);

const prisma = new PrismaClient();
const surveys = { inboxItem: async () => null };
const service = new TenantInboxService(prisma, surveys);

const tag = randomUUID().slice(0, 8);
let tenant, landlord, app;

/** Keep the service's own log off the output; a caught section is expected pre-fix. */
const quiet = { log: () => {}, error: () => {}, warn: () => {}, debug: () => {}, verbose: () => {} };
if (service.logger) Object.assign(service.logger, quiet);

try {
  tenant = await prisma.user.create({
    data: { email: `race-t-${tag}@m.test`, passwordHash: 'x', role: 'TENANT', fullName: 'Race Tenant' },
  });
  landlord = await prisma.user.create({
    data: { email: `race-l-${tag}@m.test`, passwordHash: 'x', role: 'LANDLORD', fullName: 'Race Landlord' },
  });
  const room = await prisma.room.findFirst({ where: { status: 'active' } });
  if (!room) {
    console.log('\n⚠️  no active room in this database — seed it first (npm run seed in backend/).');
    process.exit(2);
  }
  app = await prisma.application.create({
    data: { tenantId: tenant.id, roomId: room.id, status: 'pending' },
  });
  await prisma.message.create({
    data: { applicationId: app.id, senderId: landlord.id, body: 'hello', channel: 'in_app' },
  });

  console.log('\n── The tenant inbox under a concurrent mark-as-read ────────');
  console.log(`  ${ATTEMPTS} attempts, driving TenantInboxService.inbox() itself.`);

  let partial = 0;
  let raced = 0;
  let served = 0;
  for (let i = 0; i < ATTEMPTS; i++) {
    // Back to unread, so every attempt starts from the state that matches.
    await prisma.message.updateMany({ where: { applicationId: app.id }, data: { readAt: null } });

    // Exactly what opening a thread does: fired, not awaited.
    const inFlight = prisma.message
      .updateMany({
        where: { applicationId: app.id, senderId: { not: tenant.id }, readAt: null },
        data: { readAt: new Date() },
      })
      .catch(() => {});

    const result = await service.inbox(tenant.id);
    if (result.partial) partial++;

    /**
     * ⚠️ Did the race actually fire this round?
     *
     * Without this the drive passes VACUOUSLY: if the update always landed
     * after the messages SELECT, every attempt would serve the message item,
     * nothing would be partial, and the run would report success having never
     * exercised the thing it exists for. That is the shape of every dead check
     * this codebase has found — a green tick over nothing.
     *
     * An attempt that raced produces no `message_unread` item: the list was
     * empty by the time it was read, so the row is skipped (after the fix) or
     * the section threw (before it). An attempt that did not race serves the
     * item normally. Both are legitimate outcomes of a race; a run of only the
     * second proves nothing, so it is reported as inconclusive, not as a pass.
     */
    if (result.items.some((i) => i.kind === 'message_unread')) served++;
    else raced++;

    await inFlight;
  }

  console.log(`  the mark-read landed mid-query (the race fired): ${raced} / ${ATTEMPTS}`);
  console.log(`  it landed after the read, item served as normal:  ${served} / ${ATTEMPTS}`);
  console.log(`  attempts whose response came back partial:        ${partial} / ${ATTEMPTS}`);

  if (raced === 0) {
    console.log('\n  ⚠️  INCONCLUSIVE — the race never fired in any attempt, so this run');
    console.log('     did not exercise the defect and 0 failures means nothing. The write');
    console.log('     landed after the messages SELECT every time. Raise ATTEMPTS, or this');
    console.log('     machine is too slow for the window to open.');
    console.log('══════════════════════════════════════════════════════════\n');
    process.exitCode = 2;
  } else if (partial > 0) {
    console.log('\n  ❌ the messages section is still throwing under the race.');
    console.log('     Before §91 this was a 500 for the whole endpoint; the per-section');
    console.log('     catch turned it into a missing section, which is better and is');
    console.log('     still wrong. A row whose unread messages were read while the');
    console.log('     query was in flight is not news — skip it.');
    console.log('════════════════════════════════════════════════════════════\n');
    process.exitCode = 1;
  } else {
    console.log('\n  ✅ no section failed: a message list emptied mid-query costs its own');
    console.log('     row and nothing else.');
    console.log('════════════════════════════════════════════════════════════\n');
  }
} finally {
  if (app) {
    await prisma.message.deleteMany({ where: { applicationId: app.id } });
    await prisma.application.delete({ where: { id: app.id } }).catch(() => {});
  }
  const ids = [tenant?.id, landlord?.id].filter(Boolean);
  if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
}
