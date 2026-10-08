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
  const periodId = dbQuery(
    `SELECT id FROM rent_periods WHERE "tenancyId" = '${tenancyId}' ` +
      `AND "periodStart" = date_trunc('month', now() - interval '2 months')`,
  );
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
