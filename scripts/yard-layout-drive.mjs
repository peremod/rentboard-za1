#!/usr/bin/env node
/**
 * The property screen, measured at the widths a landlord actually holds.
 *
 * ── Why this exists
 *
 * A landlord sent three screenshots of /landlord on a 360px handset. The
 * shared-details form had its labels and inputs side by side, each input a
 * different width and running off the right edge; "Shared details" and "Delete
 * this property" rendered as one unbroken string, "Shared detailsDelete this
 * property", with no gap between a harmless action and a destructive one.
 *
 * Nothing here could have caught it. `layout-ui-drive` is the drive written for
 * exactly this problem, and its screen list is `/`, `/account/settings`,
 * `/auth/login`, `/auth/register`, `/auth/register-phone` and
 * `/landlord/rooms/new`. It creates a property and an expense through the API
 * on the way past — and never opens the screen that shows them.
 * `properties-ui-drive` visits the screen and has no widths, no overflow check
 * and no tap-target check at all.
 *
 * So: the yard dashboard, at 360 / 390 / 768 / 1280, with both forms OPEN —
 * because a form that is collapsed by default is a form no check ever sees.
 *
 * Needs the API on :3000, the app on :4200, and a DATABASE_URL.
 */
import { chromium } from '@playwright/test';
import { apiCall, registerUser, signIn, PASSWORD, dbQuery } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
const WEB = process.env.WEB ?? 'http://localhost:4200';
const WIDTHS = [360, 390, 768, 1280];
const TARGET = 44;
const MIN_GAP = 8;

let pass = 0;
const failures = [];
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { failures.push(m); console.log(`  ❌ ${m}`); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

const landlord = await registerUser(API, 'LANDLORD');
await apiCall(API, 'POST', '/api/users/me/walkthrough-seen', {}, landlord.token);

const created = await apiCall(API, 'POST', '/api/properties', {
  name: '27 house',
  addressLine: '1423 Vilakazi Street',
  suburb: 'Arcadia',
  city: 'Pretoria',
  province: 'Gauteng',
  houseRules: 'Gate locked at 21:00. Tell me before overnight visitors.',
  sharedAmenities: ['Shared kitchen', 'outside tap', 'washing line'],
}, landlord.token);

/** `apiCall` answers {status, body}; reading `.id` off the envelope put the
 *  string "undefined" in the URL and the drive measured a blank screen. */
const propertyId = created.body?.id ?? created.id;
if (!propertyId) {
  console.error('Could not create a property:', JSON.stringify(created).slice(0, 300));
  process.exit(2);
}

await apiCall(API, 'POST', '/api/properties/expenses', {
  propertyId,
  category: 'municipal',
  amountCents: 3699,
  spentOn: new Date().toISOString().slice(0, 10),
  note: 'Plumber for the geyser',
}, landlord.token);

/**
 * A room in this property with a LIVE tenancy and a marked month — so the rent
 * panel has something to render.
 *
 * ⚠️ This is here because of a defect no compiler could see. The rent endpoint
 * answers `{ tenancy, periods }`; `PropertiesService.rentHistory` still
 * declared `RentPeriod[]`, and the generic on `http.get` is an unchecked cast,
 * so `tsc --noEmit` and `ng build --configuration=production` were both green
 * while `loadRent` put an object into the `rent` signal and
 * `currentLabel(periods)` called `.find` on it — a TypeError on the landlord's
 * own property screen, found by a code review rather than by any check in this
 * repository.
 *
 * The widths loop below opens this screen at four sizes and never touched the
 * rent panel, because the panel is behind a "Rent this month" button and a
 * tenancy that none of these fixtures had. A control nothing clicks is a
 * control nothing tests.
 */
const rentRoom = await apiCall(API, 'POST', '/api/rooms', {
  roomType: 'shared_house', title: 'Rent panel room',
  description: 'A clean back room on a quiet street, with its own entrance and a shared tap.',
  rentCents: 250000, province: 'Gauteng', city: 'Pretoria',
  locationDisplay: 'Arcadia, Pretoria', propertyId,
  availableFrom: new Date().toISOString().slice(0, 10),
}, landlord.token);
const rentRoomId = rentRoom.body?.id;
if (!rentRoomId) {
  console.error('Could not create the rent-panel room:', JSON.stringify(rentRoom.body).slice(0, 300));
  process.exit(2);
}
dbQuery(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${rentRoomId}'`);

const rentTenant = await registerUser(API, 'TENANT');
const rentApp = await apiCall(API, 'POST', '/api/applications',
  { roomId: rentRoomId, coverNote: 'I can move in on the first of the month.' }, rentTenant.token);
await apiCall(API, 'POST', `/api/applications/${rentApp.body.id}/accept`, {}, landlord.token);

// Poll: accept() opens the tenancy fire-and-forget and is not awaited.
let rentTenancyId = '';
for (let i = 0; i < 40 && !rentTenancyId; i++) {
  rentTenancyId = dbQuery(`SELECT id FROM tenancies WHERE "applicationId" = '${rentApp.body.id}'`);
  if (!rentTenancyId) await new Promise((r) => setTimeout(r, 250));
}
if (!rentTenancyId) {
  console.error('No tenancy was opened for the rent-panel room');
  process.exit(2);
}

// Through the API, so status and startDate are set together — the rent window
// reads startDate, and forcing one column in SQL without the other fabricates
// a tenancy this product cannot otherwise reach.
await apiCall(API, 'POST', `/api/tenancies/${rentTenancyId}/confirm-start`,
  { startDate: new Date().toISOString().slice(0, 10) }, landlord.token);

const monthStart = new Date(
  Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
).toISOString().slice(0, 10);
const marked = await apiCall(API, 'PATCH', `/api/properties/rent/${rentTenancyId}/mark`,
  { periodStart: monthStart, status: 'paid' }, landlord.token);
if (marked.status !== 200) {
  console.error(`Could not mark the month: ${marked.status} ${JSON.stringify(marked.body).slice(0, 200)}`);
  process.exit(2);
}

const browser = await chromium.launch();

// ── The rent panel actually renders ──────────────────────────────────────
console.log('\n── The rent panel, with a live tenancy ─────────────────');
{
  const page = await signIn(browser, WEB, landlord.email, PASSWORD, { width: 390, height: 1000 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message ?? e)));
  await page.goto(`${WEB}/landlord/properties/${propertyId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const trigger = page.locator('.link-btn', { hasText: /Rent this month/i }).first();
  check(await trigger.count() > 0, 'a live tenancy offers "Rent this month" on the property screen');
  if (await trigger.count()) {
    await trigger.click();
    await page.waitForTimeout(1800);

    const state = (await page.locator('.yard-rent__state').first().textContent().catch(() => '')) ?? '';
    check(
      state.trim().length > 0,
      state.trim().length > 0
        ? `…and opening it renders the month's state ("${state.trim()}")`
        : 'opening it rendered NO state — the rent panel is blank where the label should be',
    );
    // The label is derived from the period, so it also proves the array
    // arrived rather than the envelope: `currentLabel` on an object throws,
    // and on an empty array says "not recorded".
    check(
      /paid/i.test(state),
      /paid/i.test(state)
        ? '…reading the month that was actually marked, so the periods arrived as an array'
        : `the label reads "${state.trim()}" for a month marked paid — the ledger did not arrive as periods`,
    );
    check(
      (await page.locator('.yard-rent__actions button').count()) >= 2,
      'and the Paid / Not yet toggle is there beside it',
    );
  }

  /**
   * ⚠️ Kept, but it is NOT what catches the defect above — measured.
   *
   * With the envelope stored where the periods belong, this check stays GREEN:
   * Angular catches a template expression's error and logs it rather than
   * letting it reach `window.onerror`, so Playwright's `pageerror` never
   * fires. The `@if (rent()[tenancy.id]; as periods)` guard also passes,
   * because an object is truthy — which is why the Paid / Not yet toggle
   * renders too.
   *
   * So neither the error hook nor the control count can see it. Only the
   * CONTENT check can: the label is derived from the periods, and a label that
   * should read "paid" and reads "" is the only visible trace. Verified by
   * reintroducing it — 2 failed, 39 passed, and both failures were the content
   * checks.
   */
  check(
    pageErrors.length === 0,
    pageErrors.length === 0
      ? 'no uncaught error on the property screen while the rent panel loaded'
      : `uncaught error(s): ${pageErrors.slice(0, 2).join(' | ')}`,
  );
  await page.context().close();
}

for (const width of WIDTHS) {
  console.log(`\n── ${width}px ──────────────────────────────────────────`);
  const page = await signIn(browser, WEB, landlord.email, PASSWORD, { width, height: 900 });
  // ⚠️ `/landlord` redirects to the dashboard. The screen in the screenshots is
  // the yard component scoped to one property, at properties/:propertyId.
  await page.goto(`${WEB}/landlord/properties/${propertyId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // Open both forms. Collapsed is the state no check ever measures.
  const shared = page.locator('button.link-btn', { hasText: 'Shared details' }).first();
  if (await shared.count()) { await shared.click(); await page.waitForTimeout(500); }
  const money = page.locator('button.link-btn', { hasText: 'Money spent' }).first();
  if (await money.count()) { await money.click(); await page.waitForTimeout(500); }

  // ── 1. The page must not scroll sideways.
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  check(
    overflow.scroll <= overflow.client + 1,
    `no horizontal page scroll (content ${overflow.scroll}px in ${overflow.client}px)`,
  );

  // ── 2. Every label stacks its control underneath it.
  //
  // This is the screenshot, stated as a measurement: when the label text and
  // its input share a line, the input's left edge is to the RIGHT of the
  // label's, and the control is pushed toward (or past) the screen edge. When
  // it stacks, both start at the same x.
  const stacking = await page.evaluate(() => {
    const out = [];
    for (const label of document.querySelectorAll(
      '.yard-shared-form label, .expense-form label',
    )) {
      const control = label.querySelector('input, select, textarea');
      const span = label.querySelector('span');
      if (!control || !span) continue;
      const l = label.getBoundingClientRect();
      const c = control.getBoundingClientRect();
      out.push({
        text: (span.textContent ?? '').trim().slice(0, 28),
        stacked: c.left - l.left < 4,
        overflows: c.right > l.right + 1,
        height: Math.round(c.height),
      });
    }
    return out;
  });
  /**
   * ⚠️ The emptiness guard, and it is not a formality.
   *
   * The first run of this drive was pointed at `/landlord`, which redirects to
   * the dashboard, so the yard card was never on the page. Three of these four
   * checks reported ✅ — "every labelled control sits under its label", "no
   * control runs past the right edge", "every form control clears 44px" —
   * because `[].filter(...).length === 0` is true. Sixteen green ticks over a
   * screen that had not been rendered.
   *
   * That is this codebase's own recurring defect, produced by the drive written
   * to find it. So the count is asserted FIRST and the measurements are skipped
   * rather than passed when there is nothing to measure.
   */
  if (stacking.length === 0) {
    bad('no labelled control found — the form did not open, so nothing below was measured');
  } else {
    ok(`found ${stacking.length} labelled control(s) to measure`);
    const inline = stacking.filter((s) => !s.stacked);
    check(
      inline.length === 0,
      inline.length === 0
        ? 'every labelled control sits under its label, not beside it'
        : `${inline.length} control(s) sit BESIDE their label: ${inline.map((s) => s.text).join(', ')}`,
    );
    const spilling = stacking.filter((s) => s.overflows);
    check(
      spilling.length === 0,
      spilling.length === 0
        ? 'no control runs past the right edge of its label'
        : `${spilling.length} control(s) run off the edge: ${spilling.map((s) => s.text).join(', ')}`,
    );
    const short = stacking.filter((s) => s.height < TARGET);
    check(
      short.length === 0,
      short.length === 0
        ? `every form control clears ${TARGET}px`
        : `${short.length} under ${TARGET}px: ${short.map((s) => `${s.text} ${s.height}px`).join(', ')}`,
    );
  }

  // ── 3. The two actions in the card head must not touch.
  //
  // "Shared detailsDelete this property" is what no gap looks like to a person
  // holding a phone: one string, and the destructive half of it is wherever
  // your thumb lands.
  const actions = await page.evaluate(() => {
    const box = document.querySelector('.yard__actions');
    if (!box) return null;
    const btns = [...box.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect();
      return {
        text: (b.textContent ?? '').trim().slice(0, 24),
        left: r.left, right: r.right, top: r.top, bottom: r.bottom,
        w: Math.round(r.width), h: Math.round(r.height),
      };
    });
    return { display: getComputedStyle(box).display, btns };
  });
  if (actions === null) {
    bad('.yard__actions is not on the page — the card did not render, nothing measured');
  } else {
    ok('.yard__actions is on the page');
    check(actions.display === 'flex', `.yard__actions is laid out (display: ${actions.display})`);
    let touching = [];
    for (let i = 0; i < actions.btns.length - 1; i++) {
      const a = actions.btns[i], b = actions.btns[i + 1];
      const sameRow = Math.abs(a.top - b.top) < 4;
      const gap = sameRow ? b.left - a.right : b.top - a.bottom;
      // 8px floor between adjacent actionable controls. Not a WCAG number —
      // 2.5.8 sizes targets, it does not space them — but one of these two
      // deletes a property, and "close enough to mis-tap" is the whole risk.
      if (gap < MIN_GAP) touching.push(`"${a.text}" / "${b.text}" gap ${Math.round(gap)}px`);
    }
    check(
      touching.length === 0,
      touching.length === 0
        ? `the ${actions.btns.length} card actions are separated`
        : `actions are touching: ${touching.join('; ')}`,
    );
    const smallActions = actions.btns.filter((b) => b.h < TARGET);
    check(
      smallActions.length === 0,
      smallActions.length === 0
        ? `every card action clears ${TARGET}px`
        : `${smallActions.length} action(s) under ${TARGET}px: ${smallActions.map((b) => `${b.text} ${b.h}px`).join(', ')}`,
    );
  }

  await page.context().close();
}

await browser.close();

console.log('\n═══════════════════════════════════════════════════════');
if (failures.length) {
  console.log(`  ❌ ${failures.length} failed, ${pass} passed.`);
  failures.forEach((f) => console.log(`     ${f}`));
  console.log('═══════════════════════════════════════════════════════\n');
  process.exit(1);
}
console.log(`  ✅ ${pass} checks passed across ${WIDTHS.join(', ')}px.`);
console.log('═══════════════════════════════════════════════════════\n');
