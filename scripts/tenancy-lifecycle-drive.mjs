#!/usr/bin/env node
/**
 * Moving in and moving out — Phase 8c.
 *
 * ── What this has to prove
 *
 * `confirm-start`, `cancel` and `end` have existed since Phase 4 and nothing
 * called them. So the thing to prove is not that the endpoints work — they
 * always did — but that a PERSON can now reach them, and that reaching them
 * unblocks what depended on them:
 *
 *   · a tenancy becomes `active`, which is the condition rent reminders select
 *     on (`rent.service.ts`: `tenancy: { status: 'active' }`);
 *   · ending it opens reviews;
 *   · a letting that fell through closes without producing a review.
 *
 * It is driven from BOTH sides, because either party may confirm, and a panel
 * that works for a landlord and renders nothing for a tenant would be half a
 * feature that passes a one-sided check.
 *
 * Needs the API on :3000, the app on :4200, and a DATABASE_URL.
 */
import { chromium } from '@playwright/test';
import { apiCall, registerUser, signIn, PASSWORD, dbQuery } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
const WEB = process.env.WEB ?? 'http://localhost:4200';

let pass = 0;
const failures = [];
const ok = (m) => { pass++; console.log('  ✅ ' + m); };
const bad = (m) => { failures.push(m); console.log('  ❌ ' + m); };
const check = (c, m) => (c ? ok(m) : bad(m));

/** A landlord with a room, and a tenant whose application has been accepted. */
async function lettingReadyToStart(stamp) {
  const landlord = await registerUser(API, 'LANDLORD', stamp);
  const tenant = await registerUser(API, 'TENANT', stamp + 1);
  for (const u of [landlord, tenant]) {
    await apiCall(API, 'POST', '/api/users/me/walkthrough-seen', {}, u.token);
  }

  const room = await apiCall(API, 'POST', '/api/rooms', {
    roomType: 'shared_house', title: `Back room ${stamp}`,
    description: 'A clean back room on a quiet street, with its own entrance and a shared tap.',
    rentCents: 250000, province: 'Gauteng', city: 'Pretoria',
    locationDisplay: 'Arcadia, Pretoria',
    availableFrom: new Date().toISOString().slice(0, 10),
  }, landlord.token);
  const roomId = room.body?.id;
  if (!roomId) {
    throw new Error(`could not create a room: ${room.status} ${JSON.stringify(room.body).slice(0, 200)}`);
  }

  // Publishing is a wizard step, not a field on the room DTO — the same shortcut
  // viewings-drive takes, for the same reason: this drive is about what happens
  // AFTER an application is accepted.
  dbQuery(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${roomId}'`);

  const app = await apiCall(API, 'POST', '/api/applications',
    { roomId, coverNote: 'I can move in on the first of the month.' }, tenant.token);
  const applicationId = app.body?.id;
  if (!applicationId) {
    throw new Error(`could not apply: ${app.status} ${JSON.stringify(app.body).slice(0, 200)}`);
  }

  const accepted = await apiCall(API, 'POST', `/api/applications/${applicationId}/accept`, {}, landlord.token);
  if (accepted.status >= 300) {
    throw new Error(`could not accept the application: ${accepted.status} ${JSON.stringify(accepted.body).slice(0, 200)}`);
  }
  return { landlord, tenant, roomId, applicationId };
}

const browser = await chromium.launch();

// ── 1. The landlord side ───────────────────────────────────────────────────
console.log('\n── 1. The landlord confirms the move-in ────────────────────');

const a = await lettingReadyToStart(Date.now());

let status = dbQuery(`SELECT status FROM tenancies WHERE "applicationId" = '${a.applicationId}'`);
check(status === 'pending', `accepting opens a tenancy, and it starts 'pending' (got '${status}')`);

const llPage = await signIn(browser, WEB, a.landlord.email, PASSWORD, { width: 390, height: 900 });
await llPage.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
await llPage.waitForTimeout(2200);
if (await llPage.locator('.cookie-notice__ok').count()) {
  await llPage.locator('.cookie-notice__ok').click();
  await llPage.waitForTimeout(400);
}

const panel = llPage.locator('app-tenancy-lifecycle .tl__card');
/**
 * ⚠️ Stop here if the panel is not on the page, rather than reading from it.
 *
 * Falsifying this drive by removing the mount made it fail the right check and
 * then die on a 30-second `textContent` timeout, which is the crash-instead-of-
 * report fault this repository keeps producing. Everything below reads from a
 * panel that has to exist; if it does not, that IS the finding — it is the
 * state the product shipped in — and it should be said once, plainly.
 */
if ((await panel.count()) !== 1) {
  bad('the landlord is NOT asked about it on their dashboard — this is the shipped defect:');
  bad('  …so no tenancy can become active, no rent reminder can fire, no review can open');
  await browser.close();
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  ❌ ${failures.length} failed, ${pass} passed.`);
  failures.forEach((f) => console.log(`     ${f}`));
  console.log('═══════════════════════════════════════════════════════\n');
  process.exit(1);
}
ok('the landlord is asked about it on their dashboard');

const asked = ((await llPage.locator('.tl__ask').first().textContent()) ?? '').trim();
check(
  /has the tenant moved in/i.test(asked),
  `…in the landlord's words ("${asked.slice(0, 60)}")`,
);

// ⚠️ The API refuses a start date more than a day ahead. The form must not
// offer one, or the product argues with itself.
const maxAttr = await llPage.locator('.tl__field input[type="date"]').first().getAttribute('max');
check(
  maxAttr === new Date().toISOString().slice(0, 10),
  `…and the date picker cannot offer a future move-in (max=${maxAttr})`,
);

const confirmBtn = llPage.locator('.tl__actions button', { hasText: 'moved in' }).first();
const box = await confirmBtn.boundingBox();
check(!!box && Math.round(box.height) >= 44, `…the confirm button clears 44px (${box ? Math.round(box.height) : 0}px)`);

await confirmBtn.click();
await llPage.waitForTimeout(2000);

status = dbQuery(`SELECT status FROM tenancies WHERE "applicationId" = '${a.applicationId}'`);
check(status === 'active', `…pressing it makes the tenancy ACTIVE (got '${status}')`);

const started = dbQuery(`SELECT "startDate" IS NOT NULL FROM tenancies WHERE "applicationId" = '${a.applicationId}'`);
check(started === 't', '…with a start date, which is the lease start');

/**
 * ⚠️ The point of the whole phase. `rent.service.ts` selects
 * `tenancy: { status: 'active' }` — with every tenancy stuck on `pending`, no
 * rent reminder could ever fire for anybody.
 */
const reachable = dbQuery(
  `SELECT count(*) FROM tenancies WHERE "applicationId" = '${a.applicationId}' AND status = 'active'`,
);
check(reachable === '1', '…so the rent reminder query can now see it at all');

// ── 2. The tenant side ─────────────────────────────────────────────────────
console.log('\n── 2. The tenant can confirm too ───────────────────────────');

const b = await lettingReadyToStart(Date.now() + 1000);
const tnPage = await signIn(browser, WEB, b.tenant.email, PASSWORD, { width: 390, height: 900 });
await tnPage.goto(`${WEB}/tenant/dashboard`, { waitUntil: 'domcontentloaded' });
await tnPage.waitForTimeout(2200);
if (await tnPage.locator('.cookie-notice__ok').count()) {
  await tnPage.locator('.cookie-notice__ok').click();
  await tnPage.waitForTimeout(400);
}

check(
  (await tnPage.locator('app-tenancy-lifecycle .tl__card').count()) === 1,
  'the tenant is asked about the same letting, on their own dashboard',
);
const tAsked = ((await tnPage.locator('.tl__ask').first().textContent()) ?? '').trim();
check(
  /have you moved in/i.test(tAsked),
  `…in the tenant's words ("${tAsked.slice(0, 60)}")`,
);

await tnPage.locator('.tl__actions button', { hasText: 'I moved in' }).first().click();
await tnPage.waitForTimeout(2000);
status = dbQuery(`SELECT status FROM tenancies WHERE "applicationId" = '${b.applicationId}'`);
check(status === 'active', `…and the tenant's confirmation counts the same (got '${status}')`);

// ── 3. Ending it opens reviews ─────────────────────────────────────────────
console.log('\n── 3. Moving out ───────────────────────────────────────────');

await llPage.reload({ waitUntil: 'domcontentloaded' });
await llPage.waitForTimeout(2200);
const activeAsk = ((await llPage.locator('.tl__ask').first().textContent()) ?? '').trim();
check(/living here since/i.test(activeAsk), `an active letting says since when ("${activeAsk.slice(0, 50)}")`);

const endMin = await llPage.locator('.tl__field input[type="date"]').first().getAttribute('min');
check(!!endMin, `…and a move-out cannot be dated before the move-in (min=${endMin})`);

await llPage.locator('.tl__actions button', { hasText: 'moved out' }).first().click();
await llPage.waitForTimeout(2000);

status = dbQuery(`SELECT status FROM tenancies WHERE "applicationId" = '${a.applicationId}'`);
check(status === 'ended', `…ending it records 'ended' (got '${status}')`);

const reviewsOpen = dbQuery(
  `SELECT "reviewsCloseAt" > now() FROM tenancies WHERE "applicationId" = '${a.applicationId}'`,
);
check(reviewsOpen === 't', '…and opens the review window, which nothing could reach before');

check(
  (await llPage.locator('app-tenancy-lifecycle .tl__card').count()) === 0,
  '…and it drops off the list, because nothing is waiting on anybody now',
);

// ── 4. A letting that fell through ─────────────────────────────────────────
console.log('\n── 4. When it falls through ────────────────────────────────');

const c = await lettingReadyToStart(Date.now() + 2000);
const cPage = await signIn(browser, WEB, c.landlord.email, PASSWORD, { width: 390, height: 900 });
await cPage.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
await cPage.waitForTimeout(2200);
if (await cPage.locator('.cookie-notice__ok').count()) {
  await cPage.locator('.cookie-notice__ok').click();
  await cPage.waitForTimeout(400);
}
await cPage.locator('.tl__actions button', { hasText: 'fell through' }).first().click();
await cPage.waitForTimeout(2000);

status = dbQuery(`SELECT status FROM tenancies WHERE "applicationId" = '${c.applicationId}'`);
check(status === 'cancelled', `"It fell through" records 'cancelled' (got '${status}')`);

const noReviews = dbQuery(
  `SELECT "reviewsCloseAt" IS NULL FROM tenancies WHERE "applicationId" = '${c.applicationId}'`,
);
check(noReviews === 't', '…and opens NO review window, because nobody lived there');

// ── 5. At the widths a landlord actually holds ─────────────────────────────
console.log('\n── 5. 360 / 390 / 768 / 1280 ───────────────────────────────');

const d = await lettingReadyToStart(Date.now() + 3000);
const wPage = await signIn(browser, WEB, d.landlord.email, PASSWORD, { width: 360, height: 900 });
await wPage.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
await wPage.waitForTimeout(2200);
if (await wPage.locator('.cookie-notice__ok').count()) {
  await wPage.locator('.cookie-notice__ok').click();
  await wPage.waitForTimeout(400);
}

for (const width of [360, 390, 768, 1280]) {
  await wPage.setViewportSize({ width, height: 900 });
  await wPage.waitForTimeout(600);

  const overflow = await wPage.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  check(
    overflow.scroll <= overflow.client + 1,
    `${width}px: no horizontal page scroll (${overflow.scroll} in ${overflow.client})`,
  );

  /**
   * Every control on the panel, not a row of them. "Measured the row somebody
   * thought to list" is how 29 inputs and 11 buttons shipped under target in
   * this codebase; the sweep is the lesson from that.
   */
  const small = await wPage.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll(
      'app-tenancy-lifecycle button, app-tenancy-lifecycle input',
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.height < 44) out.push(`${(el.textContent || el.getAttribute('type') || 'control').trim().slice(0, 22)} ${Math.round(r.height)}px`);
    }
    return out;
  });
  check(
    small.length === 0,
    small.length === 0
      ? `${width}px: every control on the panel clears 44px`
      : `${width}px: ${small.length} under target — ${small.join(', ')}`,
  );
}

await browser.close();

console.log('\n═══════════════════════════════════════════════════════');
if (failures.length) {
  console.log(`  ❌ ${failures.length} failed, ${pass} passed.`);
  failures.forEach((f) => console.log(`     ${f}`));
  console.log('═══════════════════════════════════════════════════════\n');
  process.exit(1);
}
console.log(`  ✅ ${pass} checks passed.`);
console.log('═══════════════════════════════════════════════════════\n');
