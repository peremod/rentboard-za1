#!/usr/bin/env node
/**
 * Searching by when you can move in — Phase 10.
 *
 * ── What this has to prove
 *
 * The board already had `availableNow`, a fortnight's window behind a chip.
 * What it could not answer is the question people actually arrive with: "I
 * have to be out of my place by the 1st of December." So:
 *
 *   · a room free BEFORE the date qualifies, one free AFTER it does not —
 *     the owner's own example, asserted to the day;
 *   · a window works for somebody flexible, and its FAR end is the bound;
 *   · the date filter composes with the others rather than replacing them;
 *   · every card says when its room is free, not just the immediate ones;
 *   · and a tenant can clear the date without losing the rest of the search.
 *
 * ⚠️ A move-in date is a SEARCH CRITERION. Nothing here reserves a room,
 * starts a tenancy or tells a landlord anything, and the drive asserts that
 * searching leaves the room exactly as it was.
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

/** A date `days` from today, as the YYYY-MM-DD a date input produces. */
const dayOffset = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const browser = await chromium.launch();
const stamp = Date.now();
const landlord = await registerUser(API, 'LANDLORD', stamp);

/** A published room, free from a given day. Returns its id. */
async function roomFree(label, availableFrom) {
  const r = await apiCall(API, 'POST', '/api/rooms', {
    roomType: 'shared_house', title: `${label} ${stamp}`,
    description: 'A clean back room on a quiet street, with its own entrance and a shared tap.',
    rentCents: 250000, province: 'Gauteng', city: 'Pretoria',
    locationDisplay: 'Sunnyside, Pretoria',
    availableFrom,
  }, landlord.token);
  if (r.status >= 300) throw new Error(`room ${label}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  dbQuery(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${r.body.id}'`);
  return r.body.id;
}

const ids = {
  freeNow: await roomFree('Free today', dayOffset(0)),
  // The owner's example, to the day: a 1 December search, against rooms free
  // on 25 November and 15 December.
  sixDaysBefore: await roomFree('Free six days before', dayOffset(24)),
  onTheDay: await roomFree('Free on the day', dayOffset(30)),
  twoWeeksAfter: await roomFree('Free a fortnight after', dayOffset(44)),
};

/**
 * A board search, scoped to this run's own rooms.
 *
 * ⚠️ `search: stamp` on every call, and it is not a convenience. The board
 * carries every room this database has ever had, so a bare search returns a
 * page of unrelated listings and a count comparison between two filters
 * compares two capped pages — which is exactly how "a window returns more
 * than a single date" passed at 50 versus 50 while proving nothing.
 */
const search = async (params) => {
  const query = new URLSearchParams({ limit: '50', search: String(stamp), ...params }).toString();
  const res = await apiCall(API, 'GET', `/api/rooms?${query}`, null, null);
  return {
    status: res.status,
    ids: (res.body?.data ?? []).map((r) => r.id),
    total: res.body?.total,
  };
};

// ── 1. The owner's example, asserted to the day ─────────────────────────
console.log('\n── 1. Moving on a particular day ────────────────────────────');

{
  const all = await search({});
  check(all.status === 200, `the board answers without a date (${all.status})`);
  for (const [name, id] of Object.entries(ids)) {
    check(all.ids.includes(id), `…and carries the "${name}" room when nothing is filtered`);
  }

  const strict = await search({ moveIn: dayOffset(30) });
  check(strict.ids.includes(ids.freeNow), 'a room standing empty qualifies for a date a month out');
  check(
    strict.ids.includes(ids.sixDaysBefore),
    'a room that frees up BEFORE the date qualifies — it is empty by then',
  );
  check(strict.ids.includes(ids.onTheDay), 'a room free ON the date qualifies');
  check(
    !strict.ids.includes(ids.twoWeeksAfter),
    'a room that frees up AFTER the date does NOT qualify, however well it matches otherwise',
  );
}

// ── 2. A window, for somebody who is flexible ───────────────────────────
console.log('\n── 2. Flexible about when ───────────────────────────────────');

{
  const window = await search({ moveIn: dayOffset(30), moveInTo: dayOffset(50) });
  check(
    window.ids.includes(ids.twoWeeksAfter),
    'widening the window to the far date brings in the room that frees up later',
  );
  check(window.ids.includes(ids.freeNow), '…without dropping the rooms already empty');

  /**
   * ⚠️ The FAR end is the bound, not the near one. A clause keyed on the
   * window's start would have excluded every room already standing empty —
   * most of what a flexible person wants to see.
   */
  const strict = await search({ moveIn: dayOffset(30) });
  check(
    window.ids.length > strict.ids.length,
    `a window returns more than a single date, not fewer (${window.ids.length} vs ${strict.ids.length})`,
  );

  // A window that ends before it begins is a typo. Treated as the single
  // date rather than refused: an error on a date box, on a phone, for
  // something this recoverable, is a dead end.
  const backwards = await search({ moveIn: dayOffset(30), moveInTo: dayOffset(10) });
  check(
    backwards.status === 200 && !backwards.ids.includes(ids.twoWeeksAfter),
    `a backwards window falls back to the single date rather than erroring (${backwards.status})`,
  );
}

// ── 3. It composes with the rest of the board ───────────────────────────
console.log('\n── 3. Alongside the other filters ───────────────────────────');

{
  const cheap = await roomFree('Cheap and late', dayOffset(44));
  dbQuery(`UPDATE rooms SET "rentCents" = 150000 WHERE id = '${cheap}'`);

  const both = await search({ moveIn: dayOffset(30), maxRentCents: '200000' });
  check(
    !both.ids.includes(cheap),
    'a cheap room that frees up too late is still excluded — the date is not overridden by price',
  );
  check(
    !both.ids.includes(ids.freeNow),
    '…and an expensive room free today is excluded by the price, not kept by the date',
  );

  const province = await search({ moveIn: dayOffset(30), province: 'Western Cape' });
  check(
    province.ids.length === 0,
    `and a province nothing is in empties the board as it always did (${province.ids.length})`,
  );

  // ⚠️ Searching changes nothing. A date is a question, not a booking.
  const after = dbQuery(`SELECT status || ' ' || to_char("availableFrom", 'YYYY-MM-DD') FROM rooms WHERE id = '${ids.onTheDay}'`).trim();
  check(
    after === `active ${dayOffset(30)}`,
    `searching leaves the room exactly as it was (${after})`,
  );
}

// ── 4. A room with no date cannot exist ─────────────────────────────────
console.log('\n── 4. Where an unknown date would come from ─────────────────');

{
  /**
   * ⚠️ The brief asks for an "availability date not confirmed" label. There
   * is no such state to label: `availableFrom` is required by the DTO and the
   * column is NOT NULL, so a listing without one cannot be created through
   * the API or stored if it were. Asserting the refusal is what keeps that
   * true — if the field ever becomes optional, this fails and the label has
   * to be built.
   */
  const noDate = await apiCall(API, 'POST', '/api/rooms', {
    roomType: 'shared_house', title: `No date ${stamp}`,
    description: 'A clean back room on a quiet street, with its own entrance and a shared tap.',
    rentCents: 250000, province: 'Gauteng', city: 'Pretoria',
    locationDisplay: 'Sunnyside, Pretoria',
  }, landlord.token);
  check(noDate.status === 400, `a room cannot be listed without an availability date (${noDate.status})`);

  const column = dbQuery(`SELECT is_nullable FROM information_schema.columns WHERE table_name='rooms' AND column_name='availableFrom'`).trim();
  check(column === 'NO', `…and the column itself refuses one (is_nullable=${column})`);
}

// ── 5. A landlord can move the date, and it reaches the board ───────────
console.log('\n── 5. When a landlord changes their mind ────────────────────');

{
  const moved = await roomFree('Moving its date', dayOffset(60));
  const early = await search({ moveIn: dayOffset(30) });
  check(!early.ids.includes(moved), 'a room free in two months is absent from a one-month search');

  const update = await apiCall(API, 'PATCH', `/api/rooms/${moved}`, { availableFrom: dayOffset(20) }, landlord.token);
  check(update.status < 300, `the landlord brings the date forward (${update.status})`);

  const again = await search({ moveIn: dayOffset(30) });
  check(again.ids.includes(moved), '…and it appears in the same search, with no republishing');

  /**
   * ⚠️ Changing a date must not cancel anything. An availability date is a
   * fact about a room, and applications, viewings and tenancies are about
   * people — the brief is explicit, and this is the kind of silent cascade
   * this codebase has had to fix twice.
   */
  const tenant = await registerUser(API, 'TENANT', stamp + 1);
  const app = await apiCall(API, 'POST', '/api/applications',
    { roomId: moved, coverNote: 'I can move whenever suits.' }, tenant.token);
  check(app.status < 300, `somebody applies for it (${app.status})`);
  await apiCall(API, 'PATCH', `/api/rooms/${moved}`, { availableFrom: dayOffset(70) }, landlord.token);
  const stillOpen = dbQuery(`SELECT status FROM applications WHERE id = '${app.body.id}'`).trim();
  check(
    stillOpen === 'pending',
    `…and pushing the date back does NOT touch their application (got '${stillOpen}')`,
  );
}

// ── 6. On the board, at 390px ───────────────────────────────────────────
console.log('\n── 6. The filter on a phone ─────────────────────────────────');

{
  const page = await browser.newPage({ viewport: { width: 390, height: 1200 } });
  await page.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  if (await page.locator('vite-error-overlay').count()) {
    bad('the dev server is showing a build error — every check here would read the PREVIOUS bundle');
  }
  if (await page.locator('.cookie-notice__ok').count()) {
    await page.locator('.cookie-notice__ok').click();
    await page.waitForTimeout(300);
  }

  /**
   * The drawer is off-canvas on a phone until it is opened.
   *
   * ⚠️ By `aria-controls`, not by its words. A text match on /filter/i also
   * finds "Clear all filters" INSIDE the panel, so the drive was clicking a
   * button that does not close the sheet and then timing out on an overlay
   * that was never going to go away.
   *
   * It opens the sheet and nothing else: once open, this very button is
   * underneath it, so the way out is the sheet's own close — which is the
   * way out a person has too.
   */
  const opener = page.locator('button[aria-controls="filter-panel"]').first();
  if (await opener.count()) {
    await opener.click();
    await page.waitForTimeout(600);
  }

  const dateInput = page.locator('.filter-date input[type="date"]').first();
  check(await dateInput.count() > 0, 'the board carries a move-in date box');

  if (await dateInput.count()) {
    const box = await dateInput.boundingBox();
    check(
      !!box && box.height >= 44,
      `…at least 44px tall for a thumb (${Math.round(box?.height ?? 0)}px)`,
    );

    const typed = dayOffset(30);
    await dateInput.fill(typed);
    await page.waitForTimeout(2000);
    const body = await page.locator('body').textContent().then((t) => (t ?? '').replace(/\s+/g, ' ').trim(), () => '');
    check(
      /free on or before/i.test(body),
      'typing a date says in words what it will do',
    );

    /**
     * ⚠️ The native date box renders in the BROWSER's locale, and nothing on
     * the page can change that: index.html has said lang="en-ZA" the whole
     * time and Chromium set to en-US still draws mm/dd/yyyy. Shipped that way
     * in v1.146.0. So the screen has to say the date somewhere the order
     * cannot be misread, and this is the check that it does.
     *
     * Expected text is built from the ISO string by SPLITTING IT, and the
     * month from a literal table — not by re-running the component's own
     * Date arithmetic, which would pass just as happily if that arithmetic
     * were wrong in both places.
     */
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'];
    const [isoY, isoM, isoD] = typed.split('-');
    const wanted = `${Number(isoD)} ${MONTHS[Number(isoM) - 1]} ${isoY}`;
    const echo = await page.locator('.filter-date-echo').first()
      .textContent().then((t) => (t ?? '').replace(/\s+/g, ' ').trim(), () => '');
    check(
      echo === wanted,
      `…and echoes it with the month as a word, so no digit can be read as the day (wanted "${wanted}", got "${echo}")`,
    );
    check(
      !/^\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s*$/.test(echo) && /[A-Za-z]{3}/.test(echo),
      '…and never as three numbers in an order that depends on the browser',
    );

    const spill = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(spill <= 1, `…and the drawer does not push the page sideways (${spill}px)`);

    // An impossible date empties the board, and the way out keeps the rest.
    await dateInput.fill('1900-01-01');
    await page.waitForTimeout(2000);
    /**
     * ⚠️ Close the drawer before reaching for the results.
     *
     * On a phone the filter panel is a sheet over the board, with an overlay
     * above everything behind it — so the empty state's button exists and is
     * unclickable until the sheet is shut. That is how a person meets it too:
     * set the date, close the filters, and only then see there is nothing.
     *
     * Closed through the page's own toggle and then WAITED FOR, rather than
     * clicked at and hoped: a forced click on the overlay raced the sheet's
     * transition and the next click landed on it anyway.
     */
    const closeDrawer = page.locator('.filter-drawer-close');
    if (await closeDrawer.count()) await closeDrawer.first().click();
    // Waited for, not assumed: the sheet animates out, and the next click
    // lands on the overlay if it goes in before the transition finishes.
    await page.locator('.filter-panel.open').waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => page.waitForTimeout(800));
    await page.waitForTimeout(400);
    const empty = await page.locator('body').textContent().then((t) => (t ?? '').replace(/\s+/g, ' ').trim(), () => '');
    check(/no rooms match/i.test(empty), 'a date nothing can meet shows the empty state');
    const clearDate = page.locator('button', { hasText: /search without a date/i });
    check(await clearDate.count() > 0, '…offering to search without the date, specifically');
    if (await clearDate.count()) {
      await clearDate.first().click();
      await page.waitForTimeout(2000);
      check(
        (await page.locator('app-room-card').count()) > 0,
        '…and clearing it brings the rooms back',
      );
    }
  }
  await page.close();
}

// ── 7. Every card says when ─────────────────────────────────────────────
console.log('\n── 7. What a card tells you ─────────────────────────────────');

{
  const page = await browser.newPage({ viewport: { width: 390, height: 1400 } });
  await page.goto(`${WEB}/?search=${encodeURIComponent(String(stamp))}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const cards = await page.locator('app-room-card').count();
  check(cards > 0, `the drive's own rooms are on the board (${cards})`);

  const badges = await page.locator('app-room-card .badge-now, app-room-card .badge-later')
    .evaluateAll((els) => els.map((e) => e.textContent?.replace(/\s+/g, ' ').trim() ?? ''));
  check(
    badges.some((b) => /available now/i.test(b)),
    'a room standing empty is marked available now',
  );
  check(
    /**
     * ⚠️ The date, not the picture beside it.
     *
     * This read /^📅 From / and went red the moment the calendar emoji
     * became an app-icon — correctly, because the string it asserted had
     * changed, but it was asserting the wrong half. A drive that pins the
     * GLYPH fails on every icon change and says nothing about whether the
     * badge still tells somebody when the room frees up, which is the only
     * thing this check is for. The SVG carries no text, so the badge's
     * textContent is now the date alone.
     */
    badges.some((b) => /^From \d/.test(b)),
    `…and one that is not says WHEN it will be (${badges.filter((b) => /From/.test(b))[0] ?? 'none'})`,
  );
  check(
    badges.length >= cards - 1,
    `…so a person scanning the board is not left guessing (${badges.length} badges for ${cards} cards)`,
  );
  await page.close();
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
