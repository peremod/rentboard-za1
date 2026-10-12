#!/usr/bin/env node
/**
 * The borders that were never drawn — measured on real screens, at four widths.
 *
 * ── Why this exists
 *
 * `scripts/token-lint.mjs` found `var(--line)` used fourteen times across nine
 * components and defined nowhere. An unresolved custom property is not a CSS
 * error: the declaration is dropped, every longhand of the shorthand becomes
 * `unset`, and `border-style` falls back to its initial value of `none`.
 * Measured in Chromium rather than read off the spec:
 *
 *     border-bottom: 1px solid var(--line)   →  style "none",  width "0px"
 *     border-bottom: 1px solid var(--border) →  style "solid", width "1px"
 *
 * So fourteen separators did not exist. The storefront's room list ran as one
 * unbroken column, the lease panel had no rule above its sections, the
 * landlord's private notes had no left bar marking them off, and every task
 * row touched the next. Nothing could see it: `ng build` succeeds because an
 * unknown custom property is valid CSS, `tsc` never reads a `styles:` block,
 * and `css-coverage-audit.mjs` asks whether a CLASS has a rule — not whether
 * the rule's values resolve.
 *
 * The gate now catches the dangling reference statically, before a build. This
 * drive is the other half: that the border is actually PAINTED on the screen a
 * person opens, and that adding it back did not push anything off the right
 * edge of a 360px phone.
 *
 * ── Why these two screens
 *
 * Twelve of the fourteen are `border-top` or `border-bottom` — a hairline that
 * changes height and cannot cause horizontal overflow. Two change width:
 * `.badge` on the storefront (`border: 1px`, +2px) and `.notes-body` under a
 * landlord's private notes (`border-left: 3px`). Both are driven here, with a
 * `border-bottom` case on each screen for the painted-at-all claim.
 *
 * ⚠️ The notes panel is CLOSED by default, and a panel nothing opens is a panel
 * no check has ever measured — the same hole `yard-layout-drive` was written
 * for. It is clicked open before anything is read, and the drive fails if the
 * element is missing rather than passing over an empty selector. Five vacuous
 * passes have shipped in this repo from exactly that.
 *
 * Needs the API on :3000 and a development build served on :4200.
 *
 *   node scripts/token-render-drive.mjs
 */
import { chromium } from '@playwright/test';
import { apiCall, registerUser, signIn, PASSWORD } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
const WEB = process.env.WEB ?? 'http://localhost:4200';
const WIDTHS = [360, 390, 768, 1280];

/** --border, the token all fourteen now point at. */
const BORDER = 'rgb(224, 213, 196)';

let pass = 0;
const failures = [];
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { failures.push(m); console.log(`  ❌ ${m}`); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

// ── Fixture: a landlord with a live storefront, a room, and an applicant ──
const landlord = await registerUser(API, 'LANDLORD');
const T = landlord.token;
await apiCall(API, 'POST', '/api/users/me/walkthrough-seen', {}, T);

const room = await apiCall(API, 'POST', '/api/rooms', {
  roomType: 'shared_house',
  title: 'Vilakazi back room, own entrance',
  rentCents: 250000,
  province: 'Gauteng',
  city: 'Johannesburg',
  locationDisplay: 'Soweto',
  availableFrom: new Date(Date.now() + 864e5).toISOString(),
  housematesCount: 2,
  billsIncluded: true,
  description: 'A clean single room in a quiet Soweto yard with a shared kitchen, an outside tap and a gate locked at night.',
}, T);
const roomId = room.body?.id;
if (!roomId) { console.error('no room:', JSON.stringify(room).slice(0, 300)); process.exit(2); }
await apiCall(API, 'PATCH', `/api/rooms/${roomId}/photos`, { paths: ['rooms/demo/cover.jpg'] }, T);
await apiCall(API, 'POST', `/api/rooms/${roomId}/publish`, {}, T);

const store = await apiCall(API, 'GET', '/api/landlord/storefront', undefined, T);
const slug = store.body?.slug;
if (!slug) { console.error('no storefront slug:', JSON.stringify(store).slice(0, 300)); process.exit(2); }
// ⚠️ `displayName` is not on UpdateStorefrontDto and the API answers 400
// "property displayName should not exist" — the name comes from the account.
// The first version of this drive sent it, ignored the 400, and then measured
// a "No such page" screen at four widths.
const live = await apiCall(API, 'PATCH', '/api/landlord/storefront', {
  bio: 'Four back rooms behind my own house in Soweto. I meet every person who applies.',
  storefrontLive: true,
}, T);
if (live.status >= 300) {
  console.error('storefront would not publish:', JSON.stringify(live).slice(0, 300));
  process.exit(2);
}

const tenant = await registerUser(API, 'TENANT');
const app = await apiCall(API, 'POST', '/api/applications', {
  roomId,
  coverNote: 'Good day. I work in Braamfontein and I am looking for a quiet room from the first.',
}, tenant.token);
if (app.status >= 300) { console.error('no application:', JSON.stringify(app).slice(0, 300)); process.exit(2); }
/**
 * TWO notes, not one.
 *
 * ⚠️ `.note:last-child` drops the rule — correctly, so a single note does not
 * draw a line under itself at the bottom of the panel. With one note the
 * drive measured `none 0px` and reported a failure that was the stylesheet
 * working as intended. The separator only exists BETWEEN notes, so there have
 * to be two of them for there to be anything to measure.
 */
for (const body of [
  'Phoned on Tuesday, polite, asked about the gate time. Wants to view on Saturday.',
  'Came to look on Saturday. Asked sensible questions about the water and the gate.',
]) {
  const note = await apiCall(API, 'POST', `/api/landlord/notes/tenant/${tenant.id}`, { body }, T);
  if (note.status >= 300) { console.error('no note:', JSON.stringify(note).slice(0, 300)); process.exit(2); }
}

const browser = await chromium.launch();

/** Computed border on the first match of `sel`, or null if nothing matches. */
const borderOf = (page, sel, side) =>
  page.$eval(`${sel} >> nth=0`, (el, s) => {
    const c = getComputedStyle(el);
    return {
      style: c.getPropertyValue(`border-${s}-style`),
      width: c.getPropertyValue(`border-${s}-width`),
      color: c.getPropertyValue(`border-${s}-color`),
    };
  }, side).catch(() => null);

/**
 * Every measurement for one screen at one width.
 *
 * `cases` is [selector, side, label]. A selector that matches nothing is a
 * FAILURE, not a skip: the whole point is that these elements render.
 */
async function measure(page, width, screen, cases) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(250);

  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  check(
    overflow.scrollW <= overflow.clientW + 1,
    `${screen} @${width}: no horizontal page scroll (${overflow.scrollW} vs ${overflow.clientW})`,
  );

  for (const [sel, side, label] of cases) {
    const b = await borderOf(page, sel, side);
    if (!b) { bad(`${screen} @${width}: ${sel} is not on the screen at all — nothing measured`); continue; }
    const painted = b.style === 'solid' && parseFloat(b.width) >= 1;
    check(painted, `${screen} @${width}: ${label} is painted (${b.style} ${b.width})`);
    check(b.color === BORDER, `${screen} @${width}: ${label} is var(--border) (${b.color})`);
  }
}

// ── 1. the public storefront ──────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await page.goto(`${WEB}/landlords/${slug}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.store-section', { timeout: 15000 }).catch(() => {});
  check(errs.length === 0, `storefront: no page error (${errs.slice(0, 2).join(' | ') || 'none'})`);

  for (const w of WIDTHS) {
    await measure(page, w, 'storefront', [
      ['.store-section', 'top', '.store-section rule above each section'],
      ['.store-foot', 'top', '.store-foot rule above the footer note'],
      ['.badge', 'top', '.badge box (the +2px width case)'],
    ]);
  }
  await page.close();
}

// ── 2. the landlord's private notes, OPENED ───────────────────────────────
{
  // `signIn` takes the BROWSER and hands back a signed-in page — it does not
  // sign an existing page in. Passing a page here fails silently: the drive
  // then measures a logged-out screen and every selector is missing.
  const page = await signIn(browser, WEB, landlord.email, PASSWORD, { width: 390, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  // ⚠️ /landlord/applicants is the ALL-applicants inbox; the card with the
  // notes panel in it is the per-room screen, /landlord/rooms/:roomId/
  // applicants. And the notes sit inside the EXPANDED card, so there are two
  // things to open: the applicant card, then the notes. A collapsed panel is a
  // panel no check has ever measured.
  await page.goto(`${WEB}/landlord/rooms/${roomId}/applicants`, { waitUntil: 'networkidle' });
  const card = page.locator('.applicant-card__header').first();
  await card.waitFor({ timeout: 15000 }).catch(() => {});
  if (!(await card.count())) {
    bad('applicants: no applicant card on the per-room screen — the fixture did not apply');
  }
  if (await card.count()) await card.click();
  const toggle = page.locator('app-tenant-notes button').first();
  await toggle.waitFor({ timeout: 15000 }).catch(() => {});
  if (!(await toggle.count())) {
    bad('applicants: the notes toggle is not on the screen — the panel was never opened');
  } else {
    await toggle.click();
    await page.waitForSelector('.notes-body', { timeout: 10000 }).catch(() => {});
    ok('applicants: the private-notes panel opens');
    check(errs.length === 0, `applicants: no page error (${errs.slice(0, 2).join(' | ') || 'none'})`);
    for (const w of WIDTHS) {
      await measure(page, w, 'applicants', [
        ['.notes-body', 'left', '.notes-body left bar (the +3px width case)'],
        ['.note', 'bottom', '.note rule between notes'],
      ]);
    }
  }
  await page.close();
}

await browser.close();

console.log(`\n── ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
console.log('✅ every border that was dropped is painted, at 360 / 390 / 768 / 1280.\n');
