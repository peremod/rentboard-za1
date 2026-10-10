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
 *
 * ⚠️ **Restart the API before each run.** This file has grown to eleven
 * sections and registers roughly 35 accounts, against a limit of 60 registers
 * per hour counted IN MEMORY (`/auth/register`). One run is comfortably inside
 * it; two back to back are not, and the second fails with
 *
 *     Error: register LANDLORD hit the rate limit (429)
 *
 * which reads like an auth bug and is not. `pkill -f 'node dist/main\.js'`
 * then start it again, and the counters are gone. CLAUDE.md records the same
 * trap for the suite as a whole; this drive is now large enough to hit it on
 * its own.
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
  return { landlord, tenant, roomId, applicationId, roomTitle: `Back room ${stamp}` };
}

/**
 * The tenancy a given application opened — polled, never read once.
 *
 * ⚠️ `ApplicationsService.accept` opens the tenancy FIRE-AND-FORGET:
 * `this.tenancies.createFromApplication(...).catch(...)`, deliberately not
 * awaited so a failure there cannot fail the acceptance. The row therefore
 * does not reliably exist when accept returns.
 *
 * Section 1 read it with a bare query and intermittently saw `''` — reported
 * as "accepting opens a tenancy, and it starts 'pending' (got '')", which
 * reads exactly like a broken accept flow and is not one. Later sections got
 * away with it only because a page load and a two-second wait sat in between.
 * An id read too early also produces URLs like `/api/properties/rent//mark`
 * and a row of 404s that look nothing like the thing under test.
 *
 * A flaky check is worse than a missing one: it teaches whoever runs this to
 * disbelieve a red line.
 */
async function tenancyFor(applicationId) {
  for (let i = 0; i < 40; i++) {
    const id = dbQuery(`SELECT id FROM tenancies WHERE "applicationId" = '${applicationId}'`);
    if (id) return id;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no tenancy was ever opened for application ${applicationId}`);
}

const browser = await chromium.launch();

// ── 1. The landlord side ───────────────────────────────────────────────────
console.log('\n── 1. The landlord confirms the move-in ────────────────────');

const a = await lettingReadyToStart(Date.now());

await tenancyFor(a.applicationId);
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

// ── 6. What the TENANT's dashboard says, before and after ────────────────
//
// ⚠️ An Application stays `accepted` for good. The move-in is a Tenancy, and
// nothing on the tenant's dashboard had ever read one. So after agreeing a
// date, moving in and confirming it, a tenant still saw, at the very top of
// "Needs you" and at urgency -2000:
//
//     "You have been accepted — talk to the landlord about moving in"
//
// and, below it, the room filed under "Your applications" with the standing
// subtitle "Live — you're waiting on the landlord". Three statements, all
// false, about the place they were sitting in. Reported in exactly those
// terms: "shouldn't that message be removed because I have already spoken to
// the landlord and moved in?"
//
// The pending case is checked as well as the active one, because "drop the row
// when a tenancy exists" would be the easy wrong fix: while nobody has
// confirmed the move there IS something to do, and it is not "talk to the
// landlord" — it is "say which day you moved in".
console.log('\n── 6. The tenant dashboard reads the tenancy, not the application ──');

{
  // A fresh letting, left PENDING: section 1's was confirmed.
  const p6 = await lettingReadyToStart(Date.now() + 600);
  const tp = await signIn(browser, WEB, p6.tenant.email, PASSWORD, { width: 390, height: 1000 });
  await tp.goto(`${WEB}/tenant/dashboard`, { waitUntil: 'domcontentloaded' });
  await tp.waitForTimeout(2600);

  const pendingInbox = ((await tp.locator('#needs-you').textContent().catch(() => '')) ?? '')
    .replace(/\s+/g, ' ');
  // ⚠️ Accepting OPENS a tenancy in the same transaction, so "accepted with no
  // tenancy" is a state this product never reaches. A first version of this
  // fix gave that state its own inbox kind and its own row, and this check
  // found it: the row it asserted could not exist, and the kind was a branch
  // nothing would ever run. One row, carrying both outstanding things.
  /you have been accepted/i.test(pendingInbox)
    ? ok('a fresh acceptance still leads the list — silence here costs somebody the room')
    : bad(`pending inbox reads: ${pendingInbox.slice(0, 180)}`);
  /record the day you move in|which day the move happened/i.test(pendingInbox)
    ? ok('…and the same row names the step that finishes it, rather than only "talk to the landlord"')
    : bad(`the acceptance row does not mention recording the move: ${pendingInbox.slice(0, 220)}`);
  (pendingInbox.match(/you have been accepted/gi) ?? []).length === 1
    ? ok('…once, not as two rows about one letting')
    : bad('one letting produced more than one acceptance row');

  // The row must reach the panel that answers it.
  const confirmRow = tp.locator('#needs-you a, #needs-you button').filter({ hasText: /Confirm the move/i });
  (await confirmRow.count()) === 1
    ? ok('…and it carries one action')
    : bad(`${await confirmRow.count()} "Confirm the move" actions in the tenant inbox`);
  if (await confirmRow.count()) {
    await confirmRow.first().click();
    await tp.waitForTimeout(1500);
    const landed = await tp.evaluate(() => {
      const el = document.getElementById('moving-in-out');
      return { hash: location.hash, exists: !!el, top: el ? Math.round(el.getBoundingClientRect().top) : null };
    });
    landed.exists && landed.hash === '#moving-in-out'
      ? ok(`…which lands on the move-in panel (${landed.hash}, ${landed.top}px from the top of the window)`)
      : bad(`"Confirm the move" went to ${JSON.stringify(landed)} — the panel it names has no anchor`);
  }

  // Now confirm it from the tenant's own side and re-read the screen.
  const confirmed = await apiCall(API, 'POST',
    `/api/tenancies/${await tenancyFor(p6.applicationId)}/confirm-start`,
    { startDate: new Date().toISOString().slice(0, 10) }, p6.tenant.token);
  check(confirmed.status === 200 || confirmed.status === 201,
    `the tenant confirms their own move-in (${confirmed.status})`);

  await tp.goto(`${WEB}/tenant/dashboard`, { waitUntil: 'domcontentloaded' });
  await tp.waitForTimeout(2600);

  const after = await tp.evaluate(() => {
    const txt = (sel) => (document.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return {
      needsYou: txt('#needs-you'),
      needsYouExists: !!document.querySelector('#needs-you'),
      applications: txt('#your-applications'),
      live: txt('#where-you-live'),
      liveExists: !!document.querySelector('#where-you-live'),
    };
  });

  !/you have been accepted/i.test(after.needsYou)
    ? ok('once they have moved in, "You have been accepted" is gone from Needs you')
    : bad(`Needs you still says it after move-in: ${after.needsYou.slice(0, 180)}`);
  !/record the day you move in/i.test(after.needsYou)
    ? ok('…and so is the instruction to record the move, because it is answered')
    : bad('the row survives its own answer');

  after.liveExists
    ? ok('the room appears under "Where you live now"')
    : bad('nothing on the dashboard says where this tenant actually lives');
  /moved in/i.test(after.live)
    ? ok('…with the date they moved in')
    : bad(`the live section reads: ${after.live.slice(0, 160)}`);

  // ⚠️ The ROOM, not a phrase.
  //
  // This check first asked only whether the words "you're waiting on the
  // landlord" were gone, and it passed with the defect reintroduced — because
  // the hardcoded sentence had by then been replaced by a derived one that
  // says something else about the same wrong list. A check on the copy cannot
  // see a room in the wrong section. So it asks the question that matters:
  // is the room they live in still filed under applications.
  !after.applications.includes(p6.roomTitle)
    ? ok(`…and "${p6.roomTitle}" is no longer filed under "Your applications"`)
    : bad(`"Your applications" still lists the room they live in: ${after.applications.slice(0, 200)}`);
  after.live.includes(p6.roomTitle)
    ? ok('…it is under "Where you live now" instead')
    : bad(`"Where you live now" does not name the room: ${after.live.slice(0, 160)}`);
  !/you're waiting on the landlord|you are waiting on the landlord/i.test(after.applications)
    ? ok('…and nothing there claims they are waiting on a landlord')
    : bad(`"Your applications" still reads: ${after.applications.slice(0, 200)}`);

  await tp.close();
}


// ── 7. The rent ledger and the end of a letting — Phase A ────────────────
//
// ⚠️ Why this section exists at all.
//
// Everything above this line proves a transition HAPPENS. Section 3 ends a
// tenancy and asserts the column reads 'ended'. That was the whole of this
// drive's coverage of moving out, and by the standard this repo sets for
// itself — "change it, drive it, then reintroduce the bug and confirm the
// check fails" — it could not fail on any of the following, all of which were
// true of the shipped product:
//
//   · `mark()` refused `cancelled` and NOTHING else, so a landlord could
//     record rent against a tenancy that finished two years ago, against a
//     month before the tenant moved in, or against next March. `upsert`
//     created the row, with `amountCents` snapshotted off a tenancy that was
//     not running;
//   · `dispute()` checked the period's own status and never the tenancy's;
//   · `history()` answered a bare array, so the tenant's rent screen could not
//     tell a finished letting from a running one and rendered both the same.
//
// ── The shape of the fix, because it is not "freeze it when it ends"
//
// The invariant is NOT "the tenancy is active". It is that a rent period
// belongs to the months the tenancy actually covered — which is as true of a
// finished letting as a live one. Refusing every write on an `ended` tenancy
// would break the most ordinary thing in this product: a tenant moves out on
// the 30th owing that month, and the landlord records it on the 5th.
//
// So the checks below come in pairs, and the SECOND half of each pair is the
// one that matters. Anybody can make a guard that refuses everything.
console.log('\n── 7. What the rent ledger accepts once the letting is over ──');

{
  /** The first of a month, `offset` months from this one, as the DTO wants it. */
  const month = (offset) => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1))
      .toISOString().slice(0, 10);
  };
  const markAs = (tenancyId, token, periodStart, status = 'unpaid') =>
    apiCall(API, 'PATCH', `/api/properties/rent/${tenancyId}/mark`, { periodStart, status }, token);

  const r = await lettingReadyToStart(Date.now() + 4000);
  const tenancyId = await tenancyFor(r.applicationId);

  // ── 7a. A tenancy nobody has confirmed holds no rent record ─────────────
  //
  // The tenant's rent screen has said exactly this since it shipped — "Your
  // move-in is not confirmed yet, so there is no rent record" — while the API
  // accepted the write. The screen was right and alone.
  const onPending = await markAs(tenancyId, r.landlord.token, month(0));
  check(
    onPending.status === 400,
    `a pending tenancy refuses a rent mark (${onPending.status}, want 400)`,
  );
  /confirm the move-in|has not started/i.test(JSON.stringify(onPending.body))
    ? ok('…and names the step that opens it, rather than refusing blankly')
    : bad(`the refusal does not mention the move-in: ${JSON.stringify(onPending.body).slice(0, 180)}`);

  // Start it, then backdate so each edge of the window can be tested on its
  // own. The API refuses a start date more than a day ahead, so the move-in is
  // confirmed for today and moved afterwards — the date is what is under test
  // here, not the endpoint that sets it.
  await apiCall(API, 'POST', `/api/tenancies/${tenancyId}/confirm-start`,
    { startDate: new Date().toISOString().slice(0, 10) }, r.landlord.token);
  dbQuery(`UPDATE tenancies SET "startDate" = now() - interval '5 months' WHERE id = '${tenancyId}'`);

  // ── 7b. While it runs: inside the window yes, outside it no ─────────────
  const inside = await markAs(tenancyId, r.landlord.token, month(-3));
  check(inside.status === 200, `a month the tenant lived there is accepted (${inside.status})`);

  const beforeMoveIn = await markAs(tenancyId, r.landlord.token, month(-6));
  check(
    beforeMoveIn.status === 400,
    `a month BEFORE the move-in is refused (${beforeMoveIn.status}, want 400)`,
  );
  /before the tenant moved in/i.test(JSON.stringify(beforeMoveIn.body))
    ? ok('…and says so')
    : bad(`wrong reason: ${JSON.stringify(beforeMoveIn.body).slice(0, 160)}`);

  const future = await markAs(tenancyId, r.landlord.token, month(+1));
  check(future.status === 400, `a month that has not started is refused (${future.status}, want 400)`);
  // Rent is due at the start of a month, so the CURRENT month must stay
  // writable — a guard that refused it would stop a landlord recording the
  // rent they are owed right now.
  const thisMonth = await markAs(tenancyId, r.landlord.token, month(0));
  check(thisMonth.status === 200, `…but the current month is still writable (${thisMonth.status})`);

  // ── 7c. End it, two months back ─────────────────────────────────────────
  const ended = await apiCall(API, 'POST', `/api/tenancies/${tenancyId}/end`,
    { endDate: month(-2) }, r.landlord.token);
  check(ended.status === 200 || ended.status === 201, `the letting ends (${ended.status})`);

  const afterMoveOut = await markAs(tenancyId, r.landlord.token, month(-1));
  check(
    afterMoveOut.status === 400,
    `a month AFTER the move-out is refused (${afterMoveOut.status}, want 400)`,
  );
  /after the tenancy ended/i.test(JSON.stringify(afterMoveOut.body))
    ? ok('…and says so, rather than blaming the date')
    : bad(`wrong reason: ${JSON.stringify(afterMoveOut.body).slice(0, 160)}`);

  // ⚠️ THE CHECK THIS SECTION EXISTS FOR.
  //
  // The letting is over and a month the tenant genuinely lived there is still
  // correctable. If this goes red, the guard above has become a freeze, and
  // the landlord who needs to record an unpaid final month cannot.
  const stillCorrectable = await markAs(tenancyId, r.landlord.token, month(-3), 'paid');
  check(
    stillCorrectable.status === 200,
    `…while a month inside the finished letting is STILL correctable (${stillCorrectable.status}) ` +
      `— the guard is a window, not a freeze`,
  );

  // ── 7d. The ledger says what it is ──────────────────────────────────────
  const ledger = await apiCall(API, 'GET', `/api/properties/rent/${tenancyId}`, null, r.tenant.token);
  check(ledger.status === 200, `either party can read the ledger (${ledger.status})`);
  check(
    !!ledger.body?.tenancy && Array.isArray(ledger.body?.periods),
    'it answers { tenancy, periods }, not a bare array',
  );
  check(
    ledger.body?.tenancy?.status === 'ended',
    `…and the state travels with it (status='${ledger.body?.tenancy?.status}', want 'ended')`,
  );
  check(
    !!ledger.body?.tenancy?.endDate,
    '…with the date it ended, so a screen can say when rather than guess',
  );

  // ── 7e. The tenant's answer OUTLIVES the letting, deliberately ──────────
  //
  // This is the one place where "it is over, so lock it" would do real harm.
  // The most consequential mark a tenant ever receives is the final month,
  // entered after they moved out, and `TenancyFlag.unpaid_rent` can be raised
  // off it. Taking their answer away at that moment leaves the landlord's
  // unverified word as the only record.
  const lastUnpaid = await markAs(tenancyId, r.landlord.token, month(-2), 'unpaid');
  check(lastUnpaid.status === 200, `the landlord marks the final month unpaid (${lastUnpaid.status})`);
  /**
   * ⚠️ The month comes from JS, not from `date_trunc(now())`.
   *
   * `periodStart` is a `timestamp` normalised to UTC midnight; `now()` is
   * `timestamptz`, so `date_trunc('month', now() - interval '2 months')`
   * truncates in the SESSION's timezone. On a non-UTC session that lands on a
   * different instant and the equality misses, `periodId` comes back empty,
   * and the dispute below is sent to `/rent/period//dispute` — a 404 that
   * reads as a product bug. It passed here only because this container runs
   * UTC. `month(-2)` is already the right value, computed the same way the
   * API normalises it.
   */
  const periodId = dbQuery(
    `SELECT id FROM rent_periods WHERE "tenancyId" = '${tenancyId}' ` +
      `AND "periodStart" = '${month(-2)}T00:00:00.000Z'`,
  );
  if (!periodId) {
    bad(`no rent period found for ${month(-2)} — the dispute check below cannot run`);
  }
  const answered = await apiCall(API, 'PATCH', `/api/properties/rent/period/${periodId}/dispute`,
    { note: 'Paid on the 3rd by EFT.' }, r.tenant.token);
  check(
    answered.status === 200,
    `…and the tenant can still answer it after moving out (${answered.status}) — never locked`,
  );

  // ── 7f. A letting that fell through holds nothing at all ────────────────
  const f = await lettingReadyToStart(Date.now() + 5000);
  const fTenancy = await tenancyFor(f.applicationId);
  await apiCall(API, 'POST', `/api/tenancies/${fTenancy}/cancel`, {}, f.landlord.token);
  const onCancelled = await markAs(fTenancy, f.landlord.token, month(0));
  check(
    onCancelled.status === 400,
    `a cancelled letting refuses a rent mark (${onCancelled.status}, want 400)`,
  );
}

console.log('\n── What section 7 does NOT prove ────────────────────────────');
console.log('  ⚠️  Nothing here reads the rent SCREEN. It proves the API refuses');
console.log('      what it should and accepts what it must; it does not prove the');
console.log('      tenant\'s rent page has stopped presenting an ended tenancy as a');
console.log('      current one. That is Phase D, and it needs its own checks.');
console.log('  ⚠️  A tenant still cannot give notice. The OpenAPI summary that said');
console.log('      they could is corrected, not the guard — docs/OUTSTANDING.md §30.');



// ── 8. The archive, and notice from either side — Phase B ────────────────
//
// Three columns landed in this phase, and the thing worth proving about a new
// column is not that it exists — it is that something WRITES it. This
// codebase's recurring defect is the other way round: a `MAX_ATTEMPTS` nothing
// read, a `documentDeletedAt` that deleted nothing, a `Message.readAt` nobody
// wrote. Each check below is a write.
console.log('\n── 8. archivedAt, and notice from either side ───────────────');

{
  const month = (offset) => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1))
      .toISOString().slice(0, 10);
  };

  // ── 8a. A letting that fell through is archived at once ───────────────
  //
  // ⚠️ `cancelled` never gets a reviewsCloseAt (section 4 asserts that), and
  // the nightly pass waits for one — so if `cancel()` did not archive in the
  // same update, a cancelled tenancy would sit unarchived forever: finished,
  // but never reading as finished.
  const c8 = await lettingReadyToStart(Date.now() + 6000);
  const cancelledId = await tenancyFor(c8.applicationId);
  await apiCall(API, 'POST', `/api/tenancies/${cancelledId}/cancel`, {}, c8.landlord.token);
  const cancelledArchived = dbQuery(
    `SELECT "archivedAt" IS NOT NULL FROM tenancies WHERE id = '${cancelledId}'`,
  );
  check(
    cancelledArchived === 't',
    `a letting that fell through is archived in the same breath (got '${cancelledArchived}')`,
  );

  // ── 8b. An ended letting is NOT archived while reviews are open ───────
  const e8 = await lettingReadyToStart(Date.now() + 7000);
  const endedId = await tenancyFor(e8.applicationId);
  await apiCall(API, 'POST', `/api/tenancies/${endedId}/confirm-start`,
    { startDate: new Date().toISOString().slice(0, 10) }, e8.landlord.token);
  await apiCall(API, 'POST', `/api/tenancies/${endedId}/end`, {}, e8.landlord.token);

  check(
    dbQuery(`SELECT "archivedAt" IS NULL FROM tenancies WHERE id = '${endedId}'`) === 't',
    'an ended letting is NOT archived while its review window is open — the two are different states',
  );
  check(
    dbQuery(`SELECT "reviewsCloseAt" > now() FROM tenancies WHERE id = '${endedId}'`) === 't',
    '…which is exactly the 30 days both parties still have to act in',
  );

  // ── 8c. …and IS archived once that window closes ──────────────────────
  //
  // The window is moved into the past rather than waited out, and the nightly
  // pass is then triggered through its own endpoint. Faking `archivedAt`
  // directly would prove nothing about the job that sets it.
  dbQuery(`UPDATE tenancies SET "reviewsCloseAt" = now() - interval '1 day' WHERE id = '${endedId}'`);

  /**
   * An admin, promoted in SQL and signed in again so the token carries the
   * role — the pattern admin-closure-drive established.
   *
   * The pass is admin-only because it PUBLISHES ratings, which is not a button
   * for a landlord with an opinion about a tenant's review. And it has an
   * operator route at all because a cron nobody can trigger cannot be driven,
   * checked after a deploy, or re-run when it fails — the same reason
   * `POST /properties/rent/run-reminders` exists.
   */
  const admin = await registerUser(API, 'TENANT', Date.now() + 7500);
  dbQuery(`UPDATE users SET role = 'ADMIN' WHERE id = '${admin.id}'`);
  const adminLogin = await apiCall(API, 'POST', '/api/auth/login',
    { email: admin.email, password: PASSWORD });
  const adminToken = adminLogin.body?.accessToken;
  check(!!adminToken, `an admin can sign in to run the pass (${adminLogin.status})`);

  const swept = await apiCall(API, 'POST', '/api/reviews/release-closed', {}, adminToken);
  check(swept.status === 200, `the nightly pass can be triggered by an operator (${swept.status})`);
  check(
    typeof swept.body?.archived === 'number',
    `…and reports what it did (${JSON.stringify(swept.body)}) rather than answering nothing`,
  );
  check(
    dbQuery(`SELECT "archivedAt" IS NOT NULL FROM tenancies WHERE id = '${endedId}'`) === 't',
    'once the review window has closed, the pass archives it',
  );

  // ⚠️ Not a landlord's button. It publishes ratings.
  const landlordTriedToSweep = await apiCall(API, 'POST', '/api/reviews/release-closed', {}, e8.landlord.token);
  check(
    landlordTriedToSweep.status === 403,
    `…and a landlord cannot run it (${landlordTriedToSweep.status}, want 403)`,
  );

  // ── 8d. Notice: the tenant can now give it ────────────────────────────
  //
  // ⚠️ This is the check for a capability the API DOCUMENTED and refused. The
  // route said "by either side" while the service called assertLandlordOwns,
  // so a tenant got a 403 on their own home. It needed one column first:
  // noticeGivenById is who notice is attributed to, not who entered it, so
  // there was no safe rule for who may withdraw.
  const n8 = await lettingReadyToStart(Date.now() + 8000);
  const noticeId = await tenancyFor(n8.applicationId);
  await apiCall(API, 'POST', `/api/tenancies/${noticeId}/confirm-start`,
    { startDate: new Date().toISOString().slice(0, 10) }, n8.landlord.token);

  const tenantGave = await apiCall(API, 'POST', `/api/tenancies/${noticeId}/notice`,
    { givenBy: 'tenant' }, n8.tenant.token);
  // Exactly 200, not "200 or 201". The loose version is what let this route
  // answer 201 while its own withdraw answered 200 — every other lifecycle
  // route here carries @HttpCode(OK), and a tolerant check cannot see a
  // response code drifting from its siblings.
  check(
    tenantGave.status === 200,
    `a TENANT can give notice on their own home (${tenantGave.status}, want 200)`,
  );
  check(
    dbQuery(`SELECT "noticeRecordedById" = '${n8.tenant.id ?? ''}' FROM tenancies WHERE id = '${noticeId}'`) === 't'
      || dbQuery(`SELECT "noticeRecordedById" IS NOT NULL FROM tenancies WHERE id = '${noticeId}'`) === 't',
    '…and who ENTERED it is recorded, not just who it is about',
  );

  // ⚠️ The landlord must NOT be able to clear it. Withdrawing resets a
  // countdown that frees a room; a landlord who could undo a tenant's notice
  // could keep them on the books.
  const landlordTriedToClear = await apiCall(API, 'POST',
    `/api/tenancies/${noticeId}/notice/withdraw`, {}, n8.landlord.token);
  check(
    landlordTriedToClear.status === 403,
    `the landlord cannot withdraw the tenant's notice (${landlordTriedToClear.status}, want 403)`,
  );
  check(
    dbQuery(`SELECT "noticeGivenAt" IS NOT NULL FROM tenancies WHERE id = '${noticeId}'`) === 't',
    '…and the notice is still standing after that attempt',
  );

  const tenantCleared = await apiCall(API, 'POST',
    `/api/tenancies/${noticeId}/notice/withdraw`, {}, n8.tenant.token);
  check(
    tenantCleared.status === 200,
    `…while the tenant who gave it can withdraw it (${tenantCleared.status})`,
  );

  // ── 8e. A tenant cannot claim they were served notice ─────────────────
  const fake = await apiCall(API, 'POST', `/api/tenancies/${noticeId}/notice`,
    { givenBy: 'landlord' }, n8.tenant.token);
  check(
    fake.status === 400,
    `a tenant cannot record that the LANDLORD gave notice (${fake.status}, want 400)`,
  );

  // ── 8f. A report can be tied to the letting it is about ──────────────
  const reported = await apiCall(API, 'POST', '/api/reports', {
    roomId: n8.roomId,
    tenancyId: noticeId,
    // ⚠️ `misleading_details`, not `room_not_as_described`. The latter is a
    // TenancyFlagReason, not a ReportReason — two enums covering overlapping
    // ground with different members, which is its own small trap.
    reason: 'misleading_details',
    details: 'The damp in the back wall was never dealt with while I lived there.',
  }, n8.tenant.token);
  check(
    reported.status === 201 || reported.status === 200,
    `a party to a letting can file a report against it (${reported.status})`,
  );
  check(
    dbQuery(`SELECT "tenancyId" = '${noticeId}' FROM reports WHERE id = '${reported.body?.id ?? ''}'`) === 't',
    '…and the complaint is stored against that tenancy, not just the room',
  );

  // ⚠️ A stranger must not be able to pin a complaint to somebody else's
  // letting — both parties read that record in their archive.
  const stranger = await registerUser(API, 'TENANT', Date.now() + 9000);
  const strangerTried = await apiCall(API, 'POST', '/api/reports', {
    roomId: n8.roomId,
    tenancyId: noticeId,
    reason: 'misleading_details',
    details: 'Nothing to do with me, I was never anywhere near this room at all.',
  }, stranger.token);
  check(
    strangerTried.status === 403,
    `somebody who was not in a letting cannot attach a report to it (${strangerTried.status}, want 403)`,
  );
}

console.log('\n── What section 8 does NOT prove ────────────────────────────');
console.log('  ⚠️  No screen reads archivedAt yet. The column is written and');
console.log('      nothing renders it — the archive view is Phase F. Until then');
console.log('      this is a column with one writer and no readers, which is');
console.log('      half of the defect this repo keeps producing.');
console.log('  ⚠️  Report.tenancyId is NOT backfilled and never will be.');
console.log('      Historical reports stay null; the archive has to say so.');



// ── 9. What ending a letting actually does — Phase C ─────────────────────
//
// ⚠️ Before this phase, `end()` wrote four columns on one row and that was the
// entire effect of a tenancy ending. Nothing downstream read them:
//
//   · the room stayed `let` indefinitely — off the public board, out of the
//     sitemap, with nothing telling the landlord to relist;
//   · a letting that FELL THROUGH did the same, for a room nobody ever moved
//     into;
//   · 32 Notice.kind values existed and not one was for a letting starting or
//     ending. The biggest event in the lifecycle logged a console line and
//     produced nothing a person could read.
//
// Each check below reads a row that something now has to write.
console.log('\n── 9. Ending a letting reaches the room and the people ──────');

{
  const noticesFor = (userId, kind) =>
    dbQuery(
      `SELECT count(*) FROM notices WHERE "userId" = '${userId}'` +
        (kind ? ` AND kind = '${kind}'` : ''),
    );
  const noticeBody = (userId, kind) =>
    dbQuery(
      `SELECT title || ' :: ' || coalesce(body,'') FROM notices ` +
        `WHERE "userId" = '${userId}' AND kind = '${kind}' ORDER BY "createdAt" DESC LIMIT 1`,
    );
  const roomStatus = (roomId) => dbQuery(`SELECT status FROM rooms WHERE id = '${roomId}'`);

  // ── 9a. A letting that fell through frees the room at once ────────────
  //
  // Not a relist: there is nothing to archive, because autoRejectOthers
  // rejected the other applicants when this one was accepted and they stay
  // rejected — which is what actually happened. This is the shape of undoLet.
  const f9 = await lettingReadyToStart(Date.now() + 10000);
  check(
    roomStatus(f9.roomId) === 'let',
    `accepting marks the room let (got '${roomStatus(f9.roomId)}')`,
  );
  const f9Tenancy = await tenancyFor(f9.applicationId);
  await apiCall(API, 'POST', `/api/tenancies/${f9Tenancy}/cancel`, {}, f9.landlord.token);
  check(
    roomStatus(f9.roomId) === 'active',
    `…and a letting that fell through puts it straight back on the board (got '${roomStatus(f9.roomId)}')`,
  );

  // ── 9b. Ending an active letting tells BOTH parties ───────────────────
  const e9 = await lettingReadyToStart(Date.now() + 11000);
  const e9Tenancy = await tenancyFor(e9.applicationId);
  await apiCall(API, 'POST', `/api/tenancies/${e9Tenancy}/confirm-start`,
    { startDate: new Date().toISOString().slice(0, 10) }, e9.landlord.token);

  const beforeTenant = Number(noticesFor(e9.tenant.id, 'tenancy_ended') || 0);
  await apiCall(API, 'POST', `/api/tenancies/${e9Tenancy}/end`, {}, e9.landlord.token);
  // The announcement is awaited inside end(), but give the row a moment.
  await new Promise((r) => setTimeout(r, 1200));

  check(
    Number(noticesFor(e9.tenant.id, 'tenancy_ended') || 0) === beforeTenant + 1,
    'the TENANT is told their letting is recorded as ended',
  );
  check(
    Number(noticesFor(e9.landlord.id, 'tenancy_ended') || 0) >= 1,
    '…and so is the landlord',
  );

  // ⚠️ The words, not just the row. A review window is 30 days and a notice
  // that does not mention it is a notice that costs somebody their review.
  const tBody = noticeBody(e9.tenant.id, 'tenancy_ended');
  check(/30 days/i.test(tBody), `…and the tenant's names the review window ("${tBody.slice(0, 70)}…")`);
  // It must not tell them they did something they did not do. The landlord
  // ended this one.
  //
  // ⚠️ The `tBody` guard is not decoration. Without it this check passes when
  // there is NO notice at all — the empty string does not match the phrase —
  // so disabling the announcement entirely made it go green. Measured: with
  // the announcement reverted it was one of three checks still passing, for
  // exactly the wrong reason. A negative assertion has to prove the thing it
  // is reading exists.
  check(
    !!tBody && !/you marked this as ended/i.test(tBody),
    'the tenant is not told THEY ended it when the landlord did',
  );
  const lBody = noticeBody(e9.landlord.id, 'tenancy_ended');
  check(
    /you marked this as ended/i.test(lBody),
    `…while the landlord, who did, is told so ("${lBody.slice(0, 60)}…")`,
  );

  // ── 9c. The room is NOT auto-relisted, and the landlord is prompted ───
  //
  // ⚠️ Both halves matter. Auto-relisting republishes old photos at an old
  // price the day somebody moves out, and relist() archives every open
  // application — destructive, and not asked for. But a room going quietly
  // invisible is not an option either, which is exactly what used to happen.
  check(
    roomStatus(e9.roomId) === 'let',
    `ending a letting does NOT silently republish the room (got '${roomStatus(e9.roomId)}')`,
  );
  check(
    Number(noticesFor(e9.landlord.id, 'room_needs_relisting') || 0) === 1,
    '…the landlord is prompted instead, once',
  );
  const prompt = noticeBody(e9.landlord.id, 'room_needs_relisting');
  check(
    /nobody can find it|not listed/i.test(prompt),
    `…and the prompt says what the consequence is ("${prompt.slice(0, 70)}…")`,
  );
  const promptLink = dbQuery(
    `SELECT link FROM notices WHERE "userId" = '${e9.landlord.id}' ` +
      `AND kind = 'room_needs_relisting' ORDER BY "createdAt" DESC LIMIT 1`,
  );
  check(
    !!promptLink && promptLink.startsWith('/landlord/'),
    `…and lands somewhere in the portal ("${promptLink}")`,
  );

  // ── 9d. The prompt is not sent for a room the landlord has moved on ───
  //
  // A landlord who has already relisted, paused or removed the room has said
  // something more recent than the stale `let`.
  const p9 = await lettingReadyToStart(Date.now() + 12000);
  const p9Tenancy = await tenancyFor(p9.applicationId);
  await apiCall(API, 'POST', `/api/tenancies/${p9Tenancy}/confirm-start`,
    { startDate: new Date().toISOString().slice(0, 10) }, p9.landlord.token);
  dbQuery(`UPDATE rooms SET status='paused' WHERE id = '${p9.roomId}'`);
  await apiCall(API, 'POST', `/api/tenancies/${p9Tenancy}/end`, {}, p9.landlord.token);
  await new Promise((r) => setTimeout(r, 1200));
  check(
    Number(noticesFor(p9.landlord.id, 'room_needs_relisting') || 0) === 0,
    'a room the landlord has already paused draws no relisting prompt',
  );
  check(
    roomStatus(p9.roomId) === 'paused',
    '…and their own choice is left alone',
  );
  // The ending itself is still announced — that is about the people, not the room.
  check(
    Number(noticesFor(p9.tenant.id, 'tenancy_ended') || 0) === 1,
    '…while the tenant is still told the letting ended',
  );
}

console.log('\n── What section 9 does NOT prove ────────────────────────────');
console.log('  ⚠️  No EMAIL goes out. deliver() writes an in-app notice and');
console.log('      nothing else, so anybody who does not sign in within the');
console.log('      30-day review window misses it. Named in OUTSTANDING §33,');
console.log('      not implied away.');
console.log('  ⚠️  Nothing here reads the landlord DASHBOARD. The notice row');
console.log('      exists; whether the relisting prompt appears as a task is');
console.log('      Phase E.');



// ── 10. The tenant's screens, once a letting is over — Phase D ───────────
//
// ⚠️ This is the defect the owner actually reported, and the first phase where
// the fix is visible on a screen. Two separate lies, in opposite directions:
//
//   · the RENT screen looped over active, ended and pending tenancies with no
//     branch on which, so a letting that finished two years ago rendered
//     identically to the room somebody lives in — same heading, same
//     present-tense "R3 000/mo", same banner asking them to correct this
//     month, same paperwork offered as current;
//   · the DASHBOARD excluded only `active` from "Your applications", so an
//     ENDED tenancy fell back into that list and the derived note counted an
//     acceptance as waiting on the tenant: "The landlord has moved on this
//     one — it is waiting on you", about a room they left six months ago.
//     Meanwhile it vanished from "Where you live now". Moving out moved the
//     room BACKWARDS through their own dashboard.
//
// Every check below reads rendered text, not a filter. A check on the filter
// would have passed before Phase D as easily as after it.
console.log('\n── 10. Current and past, on the tenant screens ──────────────');

{
  const month = (offset) => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1))
      .toISOString().slice(0, 10);
  };

  // A tenant with TWO lettings: one they live in, one they have left. Both at
  // once, because the bug was that the screen could not tell them apart —
  // checking either alone would miss it.
  const liveLet = await lettingReadyToStart(Date.now() + 13000);
  const liveTenancy = await tenancyFor(liveLet.applicationId);
  await apiCall(API, 'POST', `/api/tenancies/${liveTenancy}/confirm-start`,
    { startDate: new Date().toISOString().slice(0, 10) }, liveLet.landlord.token);
  await apiCall(API, 'PATCH', `/api/properties/rent/${liveTenancy}/mark`,
    { periodStart: month(0), status: 'unpaid' }, liveLet.landlord.token);

  // The same tenant, a second room, finished. Re-using the tenant is the
  // point: one person, two lettings, and the screen has to separate them.
  const pastRoom = await apiCall(API, 'POST', '/api/rooms', {
    roomType: 'shared_house', title: `Old room ${Date.now()}`,
    description: 'A clean back room on a quiet street, with its own entrance and a shared tap.',
    rentCents: 180000, province: 'Gauteng', city: 'Pretoria',
    locationDisplay: 'Sunnyside, Pretoria',
    availableFrom: new Date().toISOString().slice(0, 10),
  }, liveLet.landlord.token);
  const pastRoomId = pastRoom.body?.id;
  dbQuery(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${pastRoomId}'`);
  const pastApp = await apiCall(API, 'POST', '/api/applications',
    { roomId: pastRoomId, coverNote: 'I can move in on the first of the month.' }, liveLet.tenant.token);
  await apiCall(API, 'POST', `/api/applications/${pastApp.body.id}/accept`, {}, liveLet.landlord.token);
  const pastTenancy = await tenancyFor(pastApp.body.id);
  await apiCall(API, 'POST', `/api/tenancies/${pastTenancy}/confirm-start`,
    { startDate: new Date().toISOString().slice(0, 10) }, liveLet.landlord.token);
  // Backdate so the ledger has months inside the letting, then end it.
  dbQuery(`UPDATE tenancies SET "startDate" = now() - interval '4 months' WHERE id = '${pastTenancy}'`);
  // ⚠️ `unpaid`, not `paid`. A month already marked paid has nothing to
  // dispute — `canDispute` says so — and this check exists for the realistic
  // case: the final month marked unpaid AFTER the tenant has gone, which is
  // the mark `TenancyFlag.unpaid_rent` can rest on.
  await apiCall(API, 'PATCH', `/api/properties/rent/${pastTenancy}/mark`,
    { periodStart: month(-3), status: 'unpaid' }, liveLet.landlord.token);
  await apiCall(API, 'POST', `/api/tenancies/${pastTenancy}/end`,
    { endDate: month(-1) }, liveLet.landlord.token);

  const page = await signIn(browser, WEB, liveLet.tenant.email, PASSWORD, { width: 390, height: 1200 });
  await page.goto(`${WEB}/tenant/rent`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  if (await page.locator('.cookie-notice__ok').count()) {
    await page.locator('.cookie-notice__ok').click();
    await page.waitForTimeout(400);
  }

  const txt = (sel) => page.locator(sel).first().textContent().then((t) => (t ?? '').replace(/\s+/g, ' ').trim(), () => '');

  // ── 10a. The two are separate sections ────────────────────────────────
  check(
    (await page.locator('#past-lettings').count()) === 1,
    'the rent screen has a section for rooms the tenant has left',
  );
  const pastText = await txt('#past-lettings');
  check(
    pastText.includes('Old room'),
    `…and the finished letting is in it ("${pastText.slice(0, 60)}…")`,
  );

  // ── 10b. The finished letting is in the PAST TENSE ────────────────────
  //
  // ⚠️ The specific words, because this is what was reported. A date range and
  // "rent was" instead of a live "/mo" figure.
  check(/Past letting/i.test(pastText), '…marked as a past letting, in as many words');
  check(/Lived there/i.test(pastText), '…and says when they lived there, not that they live there');
  check(/Rent was/i.test(pastText), '…with "rent was", not a present-tense monthly figure');
  // The live room still carries the present-tense figure. Both halves matter:
  // a blanket removal of "/mo" would pass a check on the past section alone.
  const whole = await txt('app-tenant-rent, main');
  check(
    /\/mo/.test(whole),
    'the room they LIVE in still shows its monthly rent',
  );
  // ⚠️ `pastText &&` is the guard, and it is the third time this exact shape
  // has bitten in this file. A negative assertion over text that does not
  // exist passes: with the past section removed entirely, `pastText` is '' and
  // matches no pattern, so this went GREEN with the defect fully
  // reintroduced. Every negative check here now proves its subject exists
  // first.
  check(
    !!pastText && !/\/mo/.test(pastText),
    '…and the finished one does not',
  );

  // ── 10c. The ledger survives, which is the point ──────────────────────
  //
  // Losing the record would be the easy wrong fix, and the owner asked for the
  // opposite in as many words: previous payments must not disappear.
  check(
    /paid|unpaid|part paid|not being chased/i.test(pastText),
    'the rent ledger for the finished letting is still there',
  );
  const pastAnswerButtons = await page.locator("#past-lettings button:has-text(\"I've paid this\")").count();
  check(
    pastAnswerButtons >= 1,
    `…and the answer button with it (${pastAnswerButtons}) — a final month marked unpaid after ` +
      'somebody moves out is the mark that matters most',
  );

  // ── 10d. The dashboard no longer says it is waiting on them ───────────
  await page.goto(`${WEB}/tenant/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const apps = await txt('#your-applications');
  check(
    !apps.includes('Old room'),
    `a finished letting is not filed under "Your applications" ("${apps.slice(0, 80)}…")`,
  );
  check(
    !/waiting on you|moved on this one/i.test(apps),
    '…and nothing there says a room they have left is waiting on them',
  );
  check(
    (await page.locator('#where-you-live').count()) === 1,
    'the room they live in is still under "Where you live now"',
  );
  const liveText = await txt('#where-you-live');
  check(
    !!liveText && !liveText.includes('Old room'),
    '…and the one they left is not',
  );

  // ── 10e. …but it has not vanished either ──────────────────────────────
  //
  // Excluding it from both lists left it in NEITHER, which is how a room
  // somebody used to live in disappears without trace. One line, with the way
  // there on it.
  check(
    (await page.locator('#past-lettings-pointer').count()) === 1,
    'the dashboard still says they have a past letting',
  );
  const pointer = await txt('#past-lettings-pointer');
  check(
    /past letting/i.test(pointer) && /kept/i.test(pointer),
    `…and that the record is kept ("${pointer.slice(0, 70)}…")`,
  );
  const pointerHref = await page.locator('#past-lettings-pointer a').first().getAttribute('href').catch(() => null);
  check(
    !!pointerHref && pointerHref.includes('/tenant/rent'),
    `…with a link to it ("${pointerHref}")`,
  );

  // ── 10f. At the widths this market actually uses ──────────────────────
  //
  // Mandatory per CLAUDE.md for anything touching cards or sections, and the
  // reason it is mandatory is that every assertion in mobile-drive.mjs is a
  // bug that reached production and was found by a person on their phone.
  await page.goto(`${WEB}/tenant/rent`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 1200 });
    await page.waitForTimeout(500);

    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    check(
      overflow.scroll <= overflow.client + 1,
      `${width}px: the rent screen does not scroll sideways (${overflow.scroll} in ${overflow.client})`,
    );

    // Every control in the past section, not a row of them.
    const small = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('#past-lettings button, #past-lettings a, #past-lettings input')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.height < 44) out.push(`${(el.textContent || 'control').trim().slice(0, 20)} ${Math.round(r.height)}px`);
      }
      return out;
    });
    check(
      small.length === 0,
      small.length === 0
        ? `${width}px: every control in the past section clears 44px`
        : `${width}px: ${small.length} under target — ${small.join(', ')}`,
    );
  }

  await page.close();
}

console.log('\n── What section 10 does NOT prove ───────────────────────────');
console.log('  ⚠️  The LANDLORD still has no past-tenant view at all. Their');
console.log('      side loses the tenant, the dates and the ledger the moment');
console.log('      a letting ends — properties.service filters to pending and');
console.log('      active. That is Phase E, and it is the opposite failure to');
console.log('      the one fixed here.');
console.log('  ⚠️  No archive SCREEN exists. The rent record is on the rent');
console.log('      screen because that is where it has always been; reviews,');
console.log('      documents and problems per tenancy are Phase F.');



// ── 11. The landlord's side of a finished letting — Phase E ──────────────
//
// ⚠️ The mirror image of section 10, failing the opposite way. Where the
// tenant screen said too much about a finished letting, the landlord screen
// said nothing at all:
//
//   · `properties.service` asked for tenancies `['pending','active']` and that
//     was the ONLY place a landlord could see a tenancy, so the moment a
//     letting ended they lost the tenant, the dates, the rent paid and the
//     ledger. A search across both codebases for "past tenant", "former
//     tenant" or "tenancy history" returned nothing but review copy and the
//     PAIA manual — which tells the public this platform holds "tenancy
//     history and rent records";
//   · the room stayed `let` with nobody in it, and the status chip said "let",
//     which is the opposite of help. The Phase C notice fires once; a notice
//     read and not acted on is gone;
//   · Reserved had a route, an API write, a tailored application refusal, a
//     board badge and five occupancy counts — and no button anywhere.
console.log('\n── 11. Past tenants, empty rooms and Reserved ───────────────');

{
  // A property with a room, a finished letting on it, and the room left `let`.
  const e11 = await lettingReadyToStart(Date.now() + 14000);
  const prop = await apiCall(API, 'POST', '/api/properties',
    { name: `Ext 9 rooms ${Date.now()}`, suburb: 'Arcadia', city: 'Pretoria', province: 'Gauteng' },
    e11.landlord.token);
  const propertyId = prop.body?.id;
  dbQuery(`UPDATE rooms SET "propertyId" = '${propertyId}' WHERE id = '${e11.roomId}'`);

  const t11 = await tenancyFor(e11.applicationId);
  await apiCall(API, 'POST', `/api/tenancies/${t11}/confirm-start`,
    { startDate: new Date().toISOString().slice(0, 10) }, e11.landlord.token);
  await apiCall(API, 'POST', `/api/tenancies/${t11}/end`, {}, e11.landlord.token);
  await new Promise((r) => setTimeout(r, 1000));

  // ── 11a. The API carries the past letting and names the empty room ────
  const dash = await apiCall(API, 'GET', '/api/properties/dashboard', null, e11.landlord.token);
  const allRooms = [
    ...(dash.body?.properties ?? []).flatMap((g) => g.rooms ?? []),
    ...((dash.body?.ungrouped?.rooms) ?? []),
  ];
  const room11 = allRooms.find((r) => r.id === e11.roomId);
  check(!!room11, 'the property dashboard still carries the room after the letting ended');
  check(
    (room11?.pastTenancies ?? []).length === 1,
    `…with the finished letting on it (${(room11?.pastTenancies ?? []).length} past)`,
  );
  check(
    (room11?.tenancies ?? []).length === 0,
    '…and nobody listed as living there',
  );
  check(
    room11?.pastTenancies?.[0]?.tenant?.fullName === 'Drive Tenant',
    `…naming who it was ("${room11?.pastTenancies?.[0]?.tenant?.fullName}")`,
  );
  check(
    !!room11?.pastTenancies?.[0]?.endDate,
    '…and when they left, which is what makes it a record rather than a name',
  );
  check(
    (dash.body?.totals?.vacantButListedAsLet ?? 0) >= 1,
    `…and the totals count the room as empty-but-listed-as-let (${dash.body?.totals?.vacantButListedAsLet})`,
  );

  // ── 11b. The inbox keeps asking, because a notice does not ────────────
  const inbox = await apiCall(API, 'GET', '/api/landlord/inbox', null, e11.landlord.token);
  const vacantItems = (inbox.body?.items ?? []).filter((i) => i.kind === 'room_vacant');
  check(
    vacantItems.length === 1,
    `the inbox carries one "room is empty" task (${vacantItems.length})`,
  );
  check(
    /empty and not listed/i.test(vacantItems[0]?.title ?? ''),
    `…saying so plainly ("${vacantItems[0]?.title ?? ''}")`,
  );
  check(
    /nobody can find it/i.test(vacantItems[0]?.detail ?? ''),
    '…and naming the consequence, not just the state',
  );
  check(
    (vacantItems[0]?.actionPath ?? '').startsWith('/landlord/'),
    `…with somewhere to go about it ("${vacantItems[0]?.actionPath}")`,
  );
  check(
    (inbox.body?.counts?.room_vacant ?? 0) === 1,
    'and it is counted per kind, like every other row',
  );

  // ── 11c. A room the landlord has paused draws no such task ────────────
  //
  // `pause()` exists so a landlord can stop enquiries without the destructive
  // alternative. Nagging them about a room they deliberately took down would
  // make the list something people stop reading.
  dbQuery(`UPDATE rooms SET status='paused' WHERE id = '${e11.roomId}'`);
  const pausedInbox = await apiCall(API, 'GET', '/api/landlord/inbox', null, e11.landlord.token);
  const afterPause = (pausedInbox.body?.items ?? []).filter((i) => i.kind === 'room_vacant').length;
  /**
   * ⚠️ Compared against BEFORE, not asserted as zero on its own.
   *
   * "Nothing is in the list" is also true when the feature does not exist, so
   * the bare version passed with the whole task reverted — the fourth time
   * this shape has bitten in this file. The claim is that pausing REMOVES it,
   * and that needs the row to have been there a moment ago.
   */
  check(
    vacantItems.length === 1 && afterPause === 0,
    `a room the landlord paused draws no "empty room" task ` +
      `(${vacantItems.length} before pausing, ${afterPause} after)`,
  );
  dbQuery(`UPDATE rooms SET status='let' WHERE id = '${e11.roomId}'`);

  // ── 11d. On screen: the past tenant, the marker, and the way back ─────
  const page = await signIn(browser, WEB, e11.landlord.email, PASSWORD, { width: 390, height: 1200 });
  await page.goto(`${WEB}/landlord/properties/${propertyId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  if (await page.locator('.cookie-notice__ok').count()) {
    await page.locator('.cookie-notice__ok').click();
    await page.waitForTimeout(400);
  }
  const txt = (sel) => page.locator(sel).first().textContent()
    .then((t) => (t ?? '').replace(/\s+/g, ' ').trim(), () => '');

  const vacantBlock = await txt('.yard-room__vacant');
  check(
    !!vacantBlock && /empty and not listed/i.test(vacantBlock),
    `the room is marked empty on the property screen ("${vacantBlock.slice(0, 60)}…")`,
  );
  check(
    (await page.locator('.yard-room__vacant .link-btn').count()) === 1,
    '…and carries the action, not just the complaint',
  );

  // Previous tenants are COLLAPSED until asked for.
  check(
    (await page.locator('.yard-past .link-btn').count()) >= 1,
    'the room offers its previous tenants',
  );
  check(
    (await page.locator('.yard-past__item').count()) === 0,
    '…collapsed, so a room on its fourth tenant does not open with four closed records',
  );
  /**
   * ⚠️ Guarded. Clicking a control that is not there throws
   * `locator.click: Timeout 30000ms exceeded` and kills the whole run — so
   * with the past-tenants feature reverted this section reported nine
   * failures and then DIED, taking sections 11e and 11f with it and leaving
   * the summary unprintable.
   *
   * A drive that dies mid-run cannot tell you the full picture, which is the
   * same defect as OUTSTANDING §28. Every click in this file that depends on
   * the thing under test now checks first and reports rather than throwing.
   */
  if (await page.locator('.yard-past .link-btn').count()) {
    await page.locator('.yard-past .link-btn').first().click();
    await page.waitForTimeout(800);
    const pastItem = await txt('.yard-past__item');
    check(
      !!pastItem && pastItem.includes('Drive Tenant'),
      `…and opens to name them ("${pastItem.slice(0, 70)}…")`,
    );
    check(
      !!pastItem && /a month/i.test(pastItem),
      '…with what they paid, which is the record a landlord came for',
    );
    // The review window is the one time-limited thing about a finished letting.
    check(
      (await page.locator('.yard-past__review').count()) === 1,
      '…and flags that they can still be reviewed',
    );
  } else {
    bad('no previous-tenants control to open — the three checks under it could not run');
  }

  // ── 11e. Reserved, which had no button at all ─────────────────────────
  const r11 = await lettingReadyToStart(Date.now() + 15000);
  dbQuery(`UPDATE rooms SET "propertyId" = '${propertyId}', status='active' WHERE id = '${r11.roomId}'`);
  // The room belongs to a different landlord in that fixture, so move it.
  dbQuery(`UPDATE rooms SET "landlordId" = (SELECT "landlordId" FROM rooms WHERE id = '${e11.roomId}') WHERE id = '${r11.roomId}'`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const reserveBtn = page.locator('.link-btn', { hasText: /Reserve for someone/i });
  check(
    (await reserveBtn.count()) >= 1,
    `an active room offers "Reserve for someone" (${await reserveBtn.count()}) — it had no button anywhere`,
  );
  if (await reserveBtn.count()) {
    await reserveBtn.first().click();
    await page.waitForTimeout(600);
    // The dialog explains what it costs before doing it.
    const dialogText = await txt('app-dialog, .dialog, [role=dialog]');
    check(
      /no new applications/i.test(dialogText),
      `…and says what it does first ("${dialogText.slice(0, 70)}…")`,
    );
    const confirm = page.locator('[role=dialog] button, app-dialog button').filter({ hasText: /Confirm|Hold it|Yes|OK/i });
    if (await confirm.count()) {
      await confirm.first().click();
      await page.waitForTimeout(2200);
      const status = dbQuery(`SELECT status FROM rooms WHERE id = '${r11.roomId}'`);
      check(status === 'reserved', `…and reserving it writes the status (got '${status}')`);
    } else {
      bad('the reserve dialog had no confirm button');
    }
  }

  // ── 11f. At the widths a landlord actually holds ──────────────────────
  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 1200 });
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    check(
      overflow.scroll <= overflow.client + 1,
      `${width}px: the property screen does not scroll sideways (${overflow.scroll} in ${overflow.client})`,
    );
    const small = await page.evaluate(() => {
      const out = [];
      const sel = '.yard-room__vacant button, .yard-room__vacant a, .yard-past button, .yard-past a, .yard-room__reserved button';
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.height < 44) out.push(`${(el.textContent || 'control').trim().slice(0, 22)} ${Math.round(r.height)}px`);
      }
      return out;
    });
    check(
      small.length === 0,
      small.length === 0
        ? `${width}px: every new control clears 44px`
        : `${width}px: ${small.length} under target — ${small.join(', ')}`,
    );
  }

  await page.close();
}

console.log('\n── What section 11 does NOT prove ───────────────────────────');
console.log('  ⚠️  Six past lettings per room is the API cap, and nothing here');
console.log('      creates a seventh. A room on its tenth tenant shows the six');
console.log('      most recent and the screen does not say so — the full record');
console.log('      is the archive view, Phase F.');
console.log('  ⚠️  Nothing reads reviews, problems or viewings per tenancy. The');
console.log('      past-tenant row carries dates, rent and paperwork only.');


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
