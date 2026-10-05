#!/usr/bin/env node
/**
 * Putting an existing room into a property — Phase 8d.
 *
 * ── What was wrong
 *
 * `assignRooms` has existed on the API and on `properties.service.ts` since
 * Phase 7b and nothing called it. `unassignRoom` HAD a caller — so the product
 * could take a room out of a property and never put one back. A one-way door,
 * and the owner walked into it: "I listed a room that is not in a grouped
 * property, but now I want to add it to a property and it doesn't work."
 *
 * ── And the button that looked broken
 *
 * "Add your first property" set a signal and stopped. The form renders below
 * the rent-reminder section, past the fold on a phone, so the button scrolled
 * nothing and revealed nothing.
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

const S = Date.now();
const landlord = await registerUser(API, 'LANDLORD', S);
await apiCall(API, 'POST', '/api/users/me/walkthrough-seen', {}, landlord.token);

const property = await apiCall(API, 'POST', '/api/properties', {
  name: '27 house', suburb: 'Arcadia', city: 'Pretoria', province: 'Gauteng',
  houseRules: 'Gate locked at 21:00.', sharedAmenities: ['Shared kitchen'],
}, landlord.token);
const propertyId = property.body?.id;

/** Two rooms belonging to nobody's property — the state the owner was stuck in. */
const roomIds = [];
for (const n of [1, 2]) {
  const r = await apiCall(API, 'POST', '/api/rooms', {
    roomType: 'shared_house', title: `Loose room ${n} ${S}`,
    description: 'A clean room in a shared house, close to transport and the shops. Available now.',
    rentCents: 250000 + n, province: 'Gauteng', city: 'Pretoria',
    locationDisplay: 'Arcadia, Pretoria',
    availableFrom: new Date().toISOString().slice(0, 10),
  }, landlord.token);
  if (!r.body?.id) throw new Error(`could not create room ${n}: ${r.status} ${JSON.stringify(r.body).slice(0, 180)}`);
  roomIds.push(r.body.id);
  dbQuery(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${r.body.id}'`);
}

check(
  dbQuery(`SELECT count(*) FROM rooms WHERE "landlordId" = '${landlord.id}' AND "propertyId" IS NULL`) === '2',
  'two rooms start in no property at all',
);

const browser = await chromium.launch();

// ── 1. The way in exists, on the property ──────────────────────────────────
console.log('\n── 1. Adding an existing room ──────────────────────────────');

const page = await signIn(browser, WEB, landlord.email, PASSWORD, { width: 390, height: 900 });
await page.goto(`${WEB}/landlord/properties/${propertyId}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
if (await page.locator('.cookie-notice__ok').count()) {
  await page.locator('.cookie-notice__ok').click();
  await page.waitForTimeout(400);
}

const opener = page.locator('.yard-adopt button.link-btn');
if ((await opener.count()) !== 1) {
  bad('there is no way to add an existing room to a property — this is the shipped defect:');
  bad('  …a room could be taken OUT of a property and never put back');
  await browser.close();
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  ❌ ${failures.length} failed, ${pass} passed.`);
  failures.forEach((f) => console.log(`     ${f}`));
  console.log('═══════════════════════════════════════════════════════\n');
  process.exit(1);
}
ok('the property offers to take a room already listed');

check(
  /2 not in a property/.test((await opener.textContent()) ?? ''),
  '…and says how many are loose, so it is worth opening',
);

await opener.click();
await page.waitForTimeout(600);

const rows = page.locator('.yard-adopt__row');
check((await rows.count()) === 2, `…listing both loose rooms (${await rows.count()})`);

// The row is the tap target, not the checkbox inside it.
const rowBox = await rows.first().boundingBox();
check(
  !!rowBox && Math.round(rowBox.height) >= 44,
  `…each row is a 44px target, not a 13px tick box (${rowBox ? Math.round(rowBox.height) : 0}px)`,
);

const move = page.locator('.yard-adopt__body button.btn-primary');
check(await move.isDisabled(), '…and the move button is disabled until something is picked');

await rows.first().click();
await page.waitForTimeout(300);
check(!(await move.isDisabled()), '…enabled once a room is ticked');
check(
  /Move 1 room here/.test((await move.textContent()) ?? ''),
  `…naming how many will move ("${((await move.textContent()) ?? '').trim()}")`,
);

await move.click();
await page.waitForTimeout(2200);

check(
  dbQuery(`SELECT count(*) FROM rooms WHERE "propertyId" = '${propertyId}'`) === '1',
  'the room is now ON the property, in the database',
);
check(
  dbQuery(`SELECT count(*) FROM rooms WHERE "landlordId" = '${landlord.id}' AND "propertyId" IS NULL`) === '1',
  '…and off the loose list, so it cannot be moved twice',
);

// ── 2. Still reversible ────────────────────────────────────────────────────
console.log('\n── 2. The door swings both ways now ────────────────────────');

/**
 * ⚠️ Ask which room actually moved, rather than assuming the first row is the
 * first room created. The list is rendered in the dashboard's order, not the
 * order this drive made them in, and unassigning the wrong id is a 200 that
 * changes nothing — which read as a broken feature when it was a broken check.
 */
const movedId = dbQuery(`SELECT id FROM rooms WHERE "propertyId" = '${propertyId}' LIMIT 1`);
check(roomIds.includes(movedId), 'the room on the property is one this drive created');
const removed = await apiCall(API, 'DELETE', `/api/properties/rooms/${movedId}`, null, landlord.token);
check(removed.status === 200, `a room can still be taken back out (${removed.status})`);
check(
  dbQuery(`SELECT count(*) FROM rooms WHERE "landlordId" = '${landlord.id}' AND "propertyId" IS NULL`) === '2',
  '…and it is loose again, so the pair is symmetrical',
);

// ── 3. "Add your first property" has to show the form ──────────────────────
console.log('\n── 3. The button that looked broken ────────────────────────');

const fresh = await registerUser(API, 'LANDLORD', S + 1);
await apiCall(API, 'POST', '/api/users/me/walkthrough-seen', {}, fresh.token);
const p2 = await signIn(browser, WEB, fresh.email, PASSWORD, { width: 390, height: 780 });
await p2.goto(`${WEB}/landlord/properties`, { waitUntil: 'domcontentloaded' });
await p2.waitForTimeout(2200);
if (await p2.locator('.cookie-notice__ok').count()) {
  await p2.locator('.cookie-notice__ok').click();
  await p2.waitForTimeout(400);
}

const addFirst = p2.locator('button', { hasText: 'Add your first property' }).first();
check((await addFirst.count()) === 1, 'a landlord with nothing is offered their first property');
await addFirst.click();
await p2.waitForTimeout(1400);

const form = p2.locator('#new-property');
check((await form.count()) === 1, '…and the form appears');

/**
 * ⚠️ On screen, not merely in the DOM.
 *
 * The form always rendered — the signal worked. It rendered below the
 * rent-reminder section, past the fold, so the button appeared to do nothing.
 * "The element exists" is exactly the check that would have passed throughout.
 */
const seen = await p2.evaluate(() => {
  const el = document.getElementById('new-property');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), vh: window.innerHeight };
});
check(
  !!seen && seen.top >= -20 && seen.top < seen.vh,
  `…and is scrolled INTO VIEW, not just into the DOM (top ${seen?.top}px of ${seen?.vh}px)`,
);

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
