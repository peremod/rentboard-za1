#!/usr/bin/env node
/**
 * The messages screen, and knowing a message arrived — Phase 8e.
 *
 * Three things the owner reported, which turned out to be three different bugs:
 *
 *   1. "the description of the room is not moving to the next line" —
 *      `:where(button)` sets `white-space: nowrap`, right for a button holding a
 *      short label and wrong for one used as a ROW. white-space inherits, so
 *      every piece of text in the row was on one line. At 360px the room title
 *      wanted 502px in a 300px column and the preview 993px, and the document
 *      was 1012px wide in a 360px viewport.
 *   2. "the send button is not properly laid out" — a consequence of 1: the
 *      composer sits on a page that scrolls sideways.
 *   3. "there's no notification that says I have a new message in the
 *      dashboard" — the landlord inbox had five kinds and none of them was a
 *      message.
 *
 * ⚠️ The overflow is INVISIBLE to a bounding-box sweep. Every element's
 * `getBoundingClientRect()` sat inside the viewport; the overflow only shows as
 * `scrollWidth > clientWidth`. A check that measures boxes would have passed
 * all the way through, which is why this one walks the tree comparing those two.
 *
 * Needs the API on :3000, the app on :4200, and a DATABASE_URL.
 */
import { chromium } from '@playwright/test';
import { apiCall, registerUser, signIn, PASSWORD, dbQuery } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
const WEB = process.env.WEB ?? 'http://localhost:4200';
const WIDTHS = [360, 390, 768, 1280];

let pass = 0;
const failures = [];
const ok = (m) => { pass++; console.log('  ✅ ' + m); };
const bad = (m) => { failures.push(m); console.log('  ❌ ' + m); };
const check = (c, m) => (c ? ok(m) : bad(m));

const S = Date.now();
const landlord = await registerUser(API, 'LANDLORD', S);
const tenant = await registerUser(API, 'TENANT', S + 1);
for (const u of [landlord, tenant]) {
  await apiCall(API, 'POST', '/api/users/me/walkthrough-seen', {}, u.token);
}

const room = await apiCall(API, 'POST', '/api/rooms', {
  roomType: 'shared_house',
  // Long on purpose: a short title wraps by accident and proves nothing.
  title: 'Spacious back room with its own private entrance and shared outside tap',
  description: 'A clean room in a shared house, close to transport and the shops. Available now.',
  rentCents: 250000, province: 'Gauteng', city: 'Pretoria',
  locationDisplay: 'Arcadia, Pretoria',
  availableFrom: new Date().toISOString().slice(0, 10),
}, landlord.token);
dbQuery(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id='${room.body.id}'`);

const application = await apiCall(API, 'POST', '/api/applications',
  { roomId: room.body.id, coverNote: 'I can move in on the first of the month.' }, tenant.token);
const APP = application.body.id;

await apiCall(API, 'POST', `/api/applications/${APP}/messages`, {
  body: 'Good day, I saw your listing and I would like to know if the room is still '
      + 'available and whether the rent includes the water and the electricity for the month.',
}, tenant.token);

const browser = await chromium.launch();

// ── 1. The row wraps, and the page does not scroll sideways ────────────────
console.log('\n── 1. Text that has to wrap ────────────────────────────────');

for (const width of WIDTHS) {
  const page = await signIn(browser, WEB, landlord.email, PASSWORD, { width, height: 900 });
  await page.goto(`${WEB}/account/messages`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  if (await page.locator('.cookie-notice__ok').count()) {
    await page.locator('.cookie-notice__ok').click();
    await page.waitForTimeout(400);
  }

  const m = await page.evaluate(() => {
    const d = document.documentElement;
    const list = document.querySelector('.msg-list');
    const over = [];
    const walk = (el) => {
      if (el.scrollWidth > el.clientWidth + 1) {
        over.push(`${el.tagName}.${(el.className || '').toString().slice(0, 24)} ${el.scrollWidth}>${el.clientWidth}`);
      }
      for (const c of el.children) walk(c);
    };
    if (list) walk(list);
    const title = document.querySelector('.msg-row__room');
    return {
      doc: d.scrollWidth, vw: d.clientWidth, over,
      hasRow: !!list,
      titleWhiteSpace: title ? getComputedStyle(title).whiteSpace : null,
    };
  });

  check(m.hasRow, `${width}px: the conversation is listed`);
  check(m.doc <= m.vw + 1, `${width}px: no horizontal page scroll (${m.doc} in ${m.vw})`);
  check(
    m.over.length === 0,
    m.over.length === 0
      ? `${width}px: nothing in the row overflows its own box`
      : `${width}px: ${m.over.length} overflowing — ${m.over.join(', ')}`,
  );
  check(
    m.titleWhiteSpace === 'normal',
    `${width}px: the room title may wrap (white-space: ${m.titleWhiteSpace})`,
  );
  await page.context().close();
}

// ── 2. The composer ────────────────────────────────────────────────────────
console.log('\n── 2. The send button ──────────────────────────────────────');

const page = await signIn(browser, WEB, landlord.email, PASSWORD, { width: 360, height: 900 });
await page.goto(`${WEB}/account/messages`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
if (await page.locator('.cookie-notice__ok').count()) {
  await page.locator('.cookie-notice__ok').click();
  await page.waitForTimeout(400);
}
await page.locator('.msg-row__head').first().click();
await page.waitForTimeout(1600);

const composer = await page.evaluate(() => {
  const c = document.querySelector('.thread__composer');
  if (!c) return null;
  const R = (e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) }; };
  return {
    box: R(c), input: R(c.querySelector('input')), button: R(c.querySelector('button')),
    vw: document.documentElement.clientWidth,
    doc: document.documentElement.scrollWidth,
  };
});
check(!!composer, 'the composer is on the thread');
if (composer) {
  check(composer.doc <= composer.vw + 1, `…on a page that does not scroll sideways (${composer.doc} in ${composer.vw})`);
  check(composer.button.h >= 44, `…Send clears 44px (${composer.button.h}px)`);
  check(composer.input.h >= 44, `…and so does the box you type in (${composer.input.h}px)`);
  check(
    composer.button.right <= composer.vw + 1,
    `…and Send is on screen, not past the edge (right ${composer.button.right} of ${composer.vw})`,
  );
}

// ── 3. The dashboard says a message is waiting ─────────────────────────────
console.log('\n── 3. Knowing it arrived ───────────────────────────────────');

/**
 * ⚠️ A SECOND conversation, because section 2 already read the first one.
 *
 * Opening a thread marks the other side's messages read — which is correct, and
 * is what section 2 does when it clicks the row to reach the composer. Checking
 * the unread count afterwards found zero and reported the feature missing when
 * the feature was working. The first run of this drive failed five checks for
 * that reason, and its last check ("opening it clears the badge") passed
 * VACUOUSLY, because the count was already zero before it did anything.
 *
 * So this section owns its own conversation, asserts the count is up BEFORE
 * opening it, and only then asserts it goes down.
 */
const tenant2 = await registerUser(API, 'TENANT', S + 2);
await apiCall(API, 'POST', '/api/users/me/walkthrough-seen', {}, tenant2.token);
const application2 = await apiCall(API, 'POST', '/api/applications',
  { roomId: room.body.id, coverNote: 'Is the room still open? I can view this week.' }, tenant2.token);
const APP2 = application2.body.id;
await apiCall(API, 'POST', `/api/applications/${APP2}/messages`,
  { body: 'Good afternoon, is the room still available and may I come and see it on Saturday?' },
  tenant2.token);

const dash = await apiCall(API, 'GET', '/api/landlord/inbox', null, landlord.token);
const items = dash.body?.items ?? [];
const msgItems = items.filter((i) => i.kind === 'unread_message');
check(msgItems.length === 1, `the landlord inbox carries an unread_message item (${msgItems.length})`);
check(
  msgItems[0]?.actionPath === '/account/messages',
  `…pointing at the messages screen (${msgItems[0]?.actionPath})`,
);
check(
  (dash.body?.counts?.unread_message ?? 0) === 1,
  `…and it is counted (${dash.body?.counts?.unread_message})`,
);

const dashPage = await signIn(browser, WEB, landlord.email, PASSWORD, { width: 390, height: 900 });
await dashPage.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
await dashPage.waitForTimeout(2400);
if (await dashPage.locator('.cookie-notice__ok').count()) {
  await dashPage.locator('.cookie-notice__ok').click();
  await dashPage.waitForTimeout(400);
}
const shown = ((await dashPage.locator('app-landlord-inbox').textContent().catch(() => '')) ?? '');
check(/sent you a message/i.test(shown), 'the dashboard says it in words, not only a dot');
check(/Read and reply/i.test(shown), '…with something to press that goes there');

/**
 * ⚠️ And it has to CLEAR. A badge that never goes down is the defect this
 * repository keeps producing — `Message.readAt` sat unwritten from the day
 * messaging shipped, and a count built on it then would have shown every
 * message ever sent, for ever.
 */
/**
 * ⚠️ Only meaningful if it was UP first.
 *
 * "It is zero after reading" is trivially true when the feature does not exist:
 * falsifying this drive by deleting the producer left five checks red and this
 * one green, over a count that was zero before and after. A check that cannot
 * distinguish "cleared" from "never there" is not checking the clearing.
 */
if (msgItems.length !== 1) {
  bad('cannot test that the badge CLEARS — it was never up (see the failures above)');
} else {
  await apiCall(API, 'GET', `/api/applications/${APP2}/messages`, null, landlord.token);
  await new Promise((r) => setTimeout(r, 900));
  const after = await apiCall(API, 'GET', '/api/landlord/inbox', null, landlord.token);
  const stillUnread = (after.body?.items ?? []).filter((i) => i.kind === 'unread_message').length;
  check(
    stillUnread === 0,
    stillUnread === 0
      ? 'opening the conversation clears it — the count goes down, not only up'
      : `the badge did not clear (${stillUnread} still unread after reading)`,
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
