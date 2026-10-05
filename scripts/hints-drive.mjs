#!/usr/bin/env node
/**
 * First-use hints, per screen — Phase 8b.
 *
 * ── What this has to prove
 *
 * 1. Every `key` used in a template is on the server's allowlist. A key that is
 *    not cannot be dismissed — the POST answers 400 — so the hint comes back on
 *    every visit forever. That is a control that only looks like a control, and
 *    it is checked structurally rather than by opening ten screens.
 * 2. The hint shows on a brand-new account and goes away on the tap.
 * 3. It STAYS away in a different browser context. This is the whole reason the
 *    flag is on the account rather than in localStorage: a phone in this market
 *    is shared, borrowed and replaced. A localStorage implementation passes
 *    every check but this one.
 * 4. Dismissing one screen's hint does not dismiss another's.
 * 5. The button clears 44px at 360px, like every other control.
 *
 * Needs the API on :3000, the app on :4200, and a DATABASE_URL.
 */
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { apiCall, registerUser, signIn, PASSWORD } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
const WEB = process.env.WEB ?? 'http://localhost:4200';

let pass = 0;
const failures = [];
const ok = (m) => { pass++; console.log('  ✅ ' + m); };
const bad = (m) => { failures.push(m); console.log('  ❌ ' + m); };
const check = (c, m) => (c ? ok(m) : bad(m));

// ── 1. Every key in a template is one the server will accept ───────────────
console.log('\n── 1. Keys the server will accept ──────────────────────────');

const allow = new Set(
  [...readFileSync('backend/src/modules/users/screen-hints.ts', 'utf8')
    .matchAll(/^\s*'([a-z-]+)',$/gm)].map((m) => m[1]),
);
check(allow.size > 0, `the server allowlist has ${allow.size} key(s)`);

const walk = (d) =>
  readdirSync(d).flatMap((e) => {
    const p = join(d, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const used = new Map();
for (const f of walk('frontend/src/app').filter((f) => f.endsWith('.ts'))) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/<app-screen-hint\s+key="([^"]+)"/g)) {
    used.set(m[1], f.replace('frontend/src/app/', ''));
  }
}
check(used.size > 0, `${used.size} screen(s) carry a first-use hint`);

const orphans = [...used].filter(([k]) => !allow.has(k));
check(
  orphans.length === 0,
  orphans.length === 0
    ? 'every key used in a template is on the server allowlist'
    : `${orphans.length} key(s) the server would reject, so the hint never goes away: `
      + orphans.map(([k, f]) => `${k} (${f})`).join(', '),
);

const unused = [...allow].filter((k) => !used.has(k));
check(
  unused.length === 0,
  unused.length === 0
    ? 'and every key on the allowlist is actually used'
    : `${unused.length} allowlisted key(s) no template uses: ${unused.join(', ')}`,
);

// ── 2. The server refuses a key that is not on the list ────────────────────
console.log('\n── 2. An unknown key is refused, by name ───────────────────');

const landlord = await registerUser(API, 'LANDLORD');
await apiCall(API, 'POST', '/api/users/me/walkthrough-seen', {}, landlord.token);

const bogus = await apiCall(API, 'POST', '/api/users/me/hints/not-a-screen', {}, landlord.token);
check(bogus.status === 400, `an unknown key answers 400 (got ${bogus.status})`);
check(
  JSON.stringify(bogus.body ?? {}).includes('not-a-screen'),
  'and the message names the key, so a typo in a template is findable',
);

// ── 3. It shows, it goes away, and it does not take the others with it ─────
console.log('\n── 3. On the screen ────────────────────────────────────────');

const browser = await chromium.launch();
const page = await signIn(browser, WEB, landlord.email, PASSWORD, { width: 360, height: 900 });

await page.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
if (await page.locator('.cookie-notice__ok').count()) {
  await page.locator('.cookie-notice__ok').click();
  await page.waitForTimeout(400);
}

const hint = page.locator('app-screen-hint .hint');
check((await hint.count()) === 1, 'a brand-new landlord gets the dashboard hint');

const closeBox = await page.locator('.hint__close').boundingBox();
check(
  !!closeBox && Math.round(closeBox.height) >= 44,
  `…and "Got it" clears 44px at 360px (${closeBox ? Math.round(closeBox.height) : 0}px)`,
);

// Another screen's hint is a different hint.
await page.goto(`${WEB}/landlord/properties`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);
check((await hint.count()) === 1, 'the properties screen has its own hint');

await page.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);
await page.locator('.hint__close').click();
await page.waitForTimeout(1200);
check((await hint.count()) === 0, '…pressing "Got it" puts it away at once');

await page.goto(`${WEB}/landlord/properties`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);
check(
  (await hint.count()) === 1,
  '…and putting one away leaves the other screens alone',
);

// ── 4. A different browser, which is the point of storing it on the account ─
console.log('\n── 4. A borrowed phone ─────────────────────────────────────');

const fresh = await signIn(browser, WEB, landlord.email, PASSWORD, { width: 360, height: 900 });
await fresh.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
await fresh.waitForTimeout(2200);
check(
  (await fresh.locator('app-screen-hint .hint').count()) === 0,
  'the dismissal follows the ACCOUNT, not the browser — a fresh context still has it hidden',
);
check(
  (await fresh.locator('.hint__heading').count()) === 0,
  '…with nothing left of the panel behind it',
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
