#!/usr/bin/env node
/**
 * The session running out in the middle of what somebody was doing.
 *
 *   node scripts/session-expiry-drive.mjs
 *
 * Needs the API on :3000 and a development build served on :4200.
 *
 * ── Why this exists
 *
 * Nothing covered it. `refresh-race-drive.mjs` counts refresh tokens in the
 * DATABASE under a concurrent rotation; `auth.interceptor.spec.ts` covers
 * which reads may travel without credentials. The browser journey — a 401
 * arriving while a person is mid-form, and what they are shown — had no test
 * of any kind, and `error.interceptor.ts`, which decides all of it, has no
 * spec at all.
 *
 * It matters most for exactly the person this product is built for: a cheap
 * Android on a flaky connection, filling in a listing with four back rooms to
 * let. Three things can happen to them, and only one of them is acceptable:
 *
 *   1. the app recovers silently and they never know;
 *   2. they are told, and sent somewhere they can get back from;
 *   3. they are bounced to a login screen, lose what they typed, and land on a
 *      dashboard rather than the page they were on.
 *
 * The third is the one this drive exists to catch. `error.interceptor.ts`
 * carries a comment about "the seven identical rounds of 401s in the console"
 * and another about the login page "nesting its own returnUrl" each time —
 * both of those were this failure mode, found by hand, twice.
 *
 * ── How the 401 is produced
 *
 * ⚠️ By intercepting in the browser, not by shortening the token's life.
 *
 * A short `JWT_EXPIRES_IN` would need the API started differently for this one
 * drive, and a drive that needs its own server configuration is a drive CI
 * runs differently from everybody else — which is how a check ends up
 * measuring a setup nobody ships. Intercepting answers the same question
 * against the shipped configuration: `error.interceptor.ts` branches on the
 * STATUS, so a 401 is a 401 however it arrived.
 *
 * The expired-arrival case below needs no faking at all: the cookies are
 * cleared, which is exactly a person opening a bookmark the next morning.
 *
 * ── ⚠️ What this drive does NOT cover, said plainly
 *
 * The expired-arrival section exercises the ROUTE GUARD
 * (`core/guards/auth.guard.ts`), not `error.interceptor.ts`'s own
 * `redirectToLogin`. Measured: dropping the returnUrl from the interceptor
 * changes nothing here, while dropping it from the guard reds two assertions.
 * Two separate pieces of code build that returnUrl and only one of them is
 * under test.
 *
 * And the interceptor's "Signed out — your session has expired" ALERT branch
 * is not exercised either. It fires only when `restoreSession()` returns no
 * user, and with a live in-memory session that call returns the cached user
 * without going near the network — so a synthetic 401 cannot reach it. Driving
 * it needs a genuinely dead refresh cookie AND a dead access token at the same
 * moment, which this drive cannot arrange without its own server
 * configuration. Named here rather than left for somebody to assume covered:
 * that is the §6 mistake this repository has made six times.
 */
import { chromium } from 'playwright';
import { registerUser, signIn, apiCall, PASSWORD } from './lib/drive-session.mjs';

const API = process.env.API_URL ?? 'http://localhost:3000';
const WEB = process.env.WEB ?? 'http://localhost:4200';

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const check = (c, m) => (c ? ok(m) : bad(m));

/**
 * ⚠️ One section dying must not take the others with it.
 *
 * Falsifying this drive killed it: the mutation signed every request out, so
 * section 2's own `signIn` threw and the run ended there — sections 2 and 3
 * reported nothing at all. scripts/lib/drive-session.mjs says it in its own
 * comment: "A drive that dies mid-run reports neither a pass nor a failure; it
 * reports nothing, which is the worst of the three."
 */
async function section(name, body) {
  console.log(`\n── ${name} ──`);
  try {
    await body();
  } catch (err) {
    bad(`${name} could not run: ${String(err?.message ?? err).replace(/\s+/g, ' ').slice(0, 180)}`);
  }
}

const landlord = await registerUser(API, 'LANDLORD');
await apiCall(API, 'POST', '/api/users/me/walkthrough-seen', {}, landlord.token);

const browser = await chromium.launch();

// ── 1. A 401 mid-journey is survived, not escalated ───────────────────────
await section('A 401 arrives while they are working', async () => {
  const page = await signIn(browser, WEB, landlord.email, PASSWORD, { width: 390, height: 844 });

  /** Every /api/ response, so the retry can be shown rather than assumed. */
  const calls = [];
  page.on('response', (r) => {
    if (!r.url().includes('/api/')) return;
    calls.push({ method: r.request().method(), path: r.url().split('/api/')[1].split('?')[0], status: r.status() });
  });

  /**
   * Exactly ONE 401, on the first guarded GET of the page load, and
   * everything after it untouched. One, because the contract is "attempt
   * exactly one silent refresh": a drive that 401s everything would send the
   * app round a loop and prove nothing about the single-retry rule.
   */
  /**
   * ⚠️ `landlord/calendar`, named rather than "the first guarded GET", and
   * that choice is the assertion below working at all.
   *
   * The first version 401'd whichever guarded read happened to go first and
   * then asserted "some call to that path came back 200". That path turned out
   * to be `landlord/health`, which the dashboard requests TWICE a load — so a
   * later, unrelated call satisfied it and the check passed with the retry
   * removed from the interceptor entirely. Caught by falsifying it; the drive
   * was green against the bug it exists to find.
   *
   * Measured per load: notices/unread, applications/inbox, rooms/my-rooms,
   * landlord/inbox, landlord/calendar, referrals/mine and four others go once;
   * landlord/health and tenancies/mine go twice. So the 401 goes to a
   * single-request path, and the assertion is the exact sequence — one refusal
   * then one success, two requests in total. Nothing but a retry can produce
   * that, and a path that starts being polled breaks the count rather than
   * quietly satisfying it.
   */
  const FORCED = 'landlord/calendar';
  let forced = 0;
  const forcedPath = FORCED;
  await page.route(`**/api/${FORCED}**`, async (route) => {
    if (forced === 0 && route.request().method() === 'GET') {
      forced = 1;
      return route.fulfill({
        status: 401, contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized', statusCode: 401 }),
      });
    }
    return route.continue();
  });

  await page.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  check(forced === 1, 'a guarded read was answered 401 — the drive has a subject');
  const body = ((await page.locator('body').textContent()) ?? '').replace(/\s+/g, ' ');

  check(new URL(page.url()).pathname === '/landlord/dashboard',
    `they are still on the page they were on (${new URL(page.url()).pathname})`);
  check(!/session has expired/i.test(body),
    'nothing told them they had been signed out — the session is fine, one request was not');

  /**
   * ⚠️ The retry is the whole point and it is asserted on the NETWORK, not on
   * the screen. A dashboard that renders because eleven other reads succeeded
   * looks identical to one that recovered the twelfth, and only one of those
   * is the behaviour under test.
   */
  const seq = calls.filter((c) => c.path === forcedPath).map((c) => c.status);
  check(seq.length === 2 && seq[0] === 401 && seq[1] === 200,
    `and the refused read was re-issued once and succeeded (${forcedPath}: ${seq.join(', ') || 'never requested'})`);

  await page.context().close();
});

// ── 2. Arriving with no session at all ────────────────────────────────────
await section('They open a bookmark the next morning', async () => {
  const page = await signIn(browser, WEB, landlord.email, PASSWORD, { width: 390, height: 844 });
  /**
   * Cookies cleared, which is the real thing rather than a simulation of it:
   * the refresh cookie is httpOnly, so this is the state a person is in when
   * it has expired or been cleared. No interception anywhere in this section.
   */
  await page.context().clearCookies();
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* private mode */ } });

  const WANTED = '/landlord/properties';
  await page.goto(`${WEB}${WANTED}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  const u = new URL(page.url());
  check(u.pathname === '/auth/login', `they are sent to the login screen (${u.pathname})`);

  const ret = u.searchParams.get('returnUrl');
  check(ret === WANTED, `…which remembers where they were going (returnUrl=${JSON.stringify(ret)})`);
  /**
   * ⚠️ Not nested, and that is not hypothetical: error.interceptor.ts carries
   * a comment about repeated 401s putting the login page in its own
   * returnUrl, nesting it further each time. A returnUrl containing
   * "/auth/login" sends somebody from the login screen to the login screen.
   */
  check(!(ret ?? '').includes('/auth/login'),
    '…and does not point back at the login screen itself');

  // The round trip, because a returnUrl nobody acts on is decoration.
  await page.fill('input[type="email"]', landlord.email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  // Wait for the URL the returnUrl promises, not a fixed delay — see the note
  // in templates-ui-drive: a delay is a bet on how fast the box is.
  await page.waitForURL((u) => new URL(u).pathname === WANTED, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  check(new URL(page.url()).pathname === WANTED,
    `…and logging in puts them back on it (${new URL(page.url()).pathname})`);

  await page.context().close();
});

// ── 3. A save refused mid-edit ────────────────────────────────────────────
//
// ⚠️ This section was first written against the listing wizard, on the theory
// that a background poll could 401 while somebody was half way through it.
// Measured, and that theory is wrong: the wizard makes its guarded reads on
// load and then NOTHING — no autosave, no polling, no refetch on focus or on
// visibilitychange, over 45 seconds of waiting. It holds the form in memory
// and talks to the API only when the person acts.
//
// Which is worth knowing in itself, and it moves the risk: the dangerous
// moment is not a background read, it is the ACTION. So the subject is a save
// that comes back 401 — a landlord editing their own name on a cheap handset
// with a connection that drops for a second. Three ways that can go, and only
// one is acceptable: it is recovered silently, or they are told and keep their
// typing, or they lose what they wrote.
//
// The first version of this section had no subject assertion at all and passed
// while forcing no 401 whatsoever. Found by falsifying the drive.
await section('A save refused in the middle of an edit', async () => {
  const page = await signIn(browser, WEB, landlord.email, PASSWORD, { width: 390, height: 844 });

  const calls = [];
  page.on('response', (r) => {
    if (!r.url().includes('/api/')) return;
    calls.push({ method: r.request().method(), path: r.url().split('/api/')[1].split('?')[0], status: r.status() });
  });

  await page.goto(`${WEB}/account/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  const field = page.locator('input#fullName').first();
  if (!(await field.count())) {
    bad('no name field on the account settings screen — nothing to type into, so this section proves nothing');
    await page.context().close();
    return;
  }

  const TYPED = 'Thandi Mokoena-Driven';
  await field.fill(TYPED);
  check((await field.inputValue()) === TYPED, 'a name is typed into the account form');

  /**
   * One 401, on the save itself. `/auth/` is excluded so the interceptor's own
   * refresh is not the thing being refused — that is a different test, and
   * refusing it here would prove only that a broken refresh breaks things.
   */
  let forced = 0;
  let forcedOn = null;
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    if (forced === 0 && method !== 'GET' && !route.request().url().includes('/auth/')) {
      forced = 1;
      forcedOn = route.request().url().split('/api/')[1].split('?')[0];
      return route.fulfill({
        status: 401, contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized', statusCode: 401 }),
      });
    }
    return route.continue();
  });

  await page.getByRole('button', { name: /Save changes/i }).first().click();
  await page.waitForTimeout(4000);

  check(forced === 1, `the save was answered 401 (${forcedOn ?? 'nothing was refused'}) — the section has a subject`);
  check(new URL(page.url()).pathname === '/account/settings',
    `they are still on the form (${new URL(page.url()).pathname})`);

  /**
   * 🔴 The assertion this drive exists for. A landlord retyping their details
   * because a save came back 401 for one second is the difference between
   * using this product and going back to a WhatsApp group.
   */
  check((await field.inputValue()) === TYPED,
    `and what they typed is still in the field (${JSON.stringify(await field.inputValue())})`);

  const seq = calls.filter((c) => c.path === forcedOn && c.method !== 'GET').map((c) => c.status);
  check(seq.length === 2 && seq[0] === 401 && seq[1] >= 200 && seq[1] < 300,
    `…the save was re-issued once and went through (${forcedOn}: ${seq.join(', ') || 'never sent'})`);

  const body = ((await page.locator('body').textContent()) ?? '').replace(/\s+/g, ' ');
  check(!/session has expired/i.test(body),
    '…and they were not told they had been signed out, because they had not been');

  await page.context().close();
});

await browser.close();
console.log(fail
  ? `\n❌ ${fail} failure(s)`
  : '\n✅ a session running out is survived, explained, or returned from — and never silently costs somebody their typing');
process.exit(fail ? 1 : 0);
