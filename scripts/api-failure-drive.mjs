#!/usr/bin/env node
/**
 * A request that fails AFTER the page has rendered — and what the person is
 * told it was.
 *
 *   node scripts/api-failure-drive.mjs
 *
 * Needs the API on :3000 and a development build served on :4200.
 *
 * ── Why this exists
 *
 * `error.interceptor.ts` makes a distinction that was paid for:
 *
 *   > "Something went wrong on our end. Please try again shortly." was the
 *   > answer to every status at or above 500, and it is three different
 *   > situations wearing one sentence.
 *
 * The three are the phone losing its connection (status 0), the platform
 * answering instead of the API because it was asleep (502/503/504 — this
 * deployment's API sleeps when idle, and it was reported on a landlord
 * dashboard at 04:38, exactly the hour it would be cold), and the API itself
 * throwing (a real 500, which will not fix itself on a retry).
 *
 * "Try again shortly" is right for the first two and wrong for the third. The
 * fix was to say which one it was, and to put the method, path and status in
 * the console — "the one line that would have turned a screenshot into a
 * diagnosis".
 *
 * 🔴 **Nothing asserted any of it.** Not a drive, not a spec, not a smoke
 * line: the strings "No connection", "Waking up" and "quote this" appear
 * nowhere outside the interceptor itself. So the distinction could collapse
 * back into one sentence and every gate would stay green — and the next
 * 04:38 report would be unreadable again.
 *
 * ── Why the failures are faked in the browser
 *
 * A real cold start cannot be arranged on demand, and a real dropped
 * connection even less so. The interceptor branches on the STATUS, so a
 * status is a status however it arrived; `route.abort('connectionfailed')`
 * produces a genuine status 0 in the browser rather than a simulation of one.
 *
 * Each failure is forced AFTER the dashboard has rendered, which is the case
 * that matters: a screen that never loaded at all is obviously broken, while a
 * screen that looks fine and then quietly fails to fetch is the one that gets
 * reported as "it does not work" with no detail.
 */
import { chromium } from 'playwright';
import { registerUser, signIn, apiCall, PASSWORD } from './lib/drive-session.mjs';

const API = process.env.API_URL ?? 'http://localhost:3000';
const WEB = process.env.WEB ?? 'http://localhost:4200';

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const check = (c, m) => (c ? ok(m) : bad(m));

const landlord = await registerUser(API, 'LANDLORD');
await apiCall(API, 'POST', '/api/users/me/walkthrough-seen', {}, landlord.token);

const browser = await chromium.launch();

/**
 * Render the dashboard, then break the NEXT read of one path and go to the
 * screen that makes it. Returns what the person was shown and what the console
 * recorded.
 */
async function failWith(mode) {
  const page = await signIn(browser, WEB, landlord.email, PASSWORD, { width: 390, height: 844 });
  const console_ = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console_.push(m.text());
  });

  await page.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);   // …and it has rendered

  let forced = 0;
  await page.route('**/api/properties/**', async (route) => {
    if (forced) return route.continue();
    forced = 1;
    if (mode === 0) return route.abort('connectionfailed');
    return route.fulfill({
      status: mode, contentType: 'application/json',
      body: JSON.stringify({ statusCode: mode, message: 'forced by api-failure-drive' }),
    });
  });

  await page.goto(`${WEB}/landlord/properties`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);

  const body = ((await page.locator('body').textContent()) ?? '').replace(/\s+/g, ' ');
  await page.context().close();
  return { forced, body, console: console_ };
}

const shown = {};

for (const [mode, label, expect] of [
  [0, 'the phone loses its connection', {
    title: 'No connection',
    says: /could not reach Mastande.*(data|wi-?fi)/i,
    notTitle: ['Waking up', 'Server error'],
  }],
  [503, 'the API was asleep and the platform answered', {
    title: 'Waking up',
    says: /idle and is starting up|wait a few seconds/i,
    notTitle: ['No connection', 'Server error'],
  }],
  [500, 'the API itself threw', {
    title: 'Server error',
    says: /quote this: GET \/api\/properties\/dashboard \(500\)/,
    notTitle: ['No connection', 'Waking up'],
  }],
]) {
  console.log(`\n── ${label} ──`);
  try {
    const r = await failWith(mode);
    check(r.forced === 1, `a read was failed with ${mode === 0 ? 'a dead connection' : mode} — the section has a subject`);

    check(r.body.includes(expect.title), `the person is told "${expect.title}"`);
    check(expect.says.test(r.body),
      `…in words that fit what happened (${expect.says.source.slice(0, 44)}…)`);
    /**
     * ⚠️ And NOT one of the other two. The defect this distinction replaced was
     * one sentence for three situations, so each case has to exclude the others
     * or the three could collapse back and every assertion above would still
     * pass.
     */
    for (const other of expect.notTitle) {
      check(!r.body.includes(other), `…and not "${other}", which is a different situation`);
    }

    /**
     * The console line, which is the half of the fix a person never sees and
     * the half a report depends on: "the one line that would have turned a
     * screenshot into a diagnosis."
     */
    const line = r.console.find((l) => l.includes('/api/properties/dashboard'));
    check(Boolean(line), 'the console records the request that failed');
    check(Boolean(line) && /GET/.test(line) && new RegExp(`\\b${mode}\\b`).test(line),
      `…with the method and the status on it (${(line ?? '').replace(/\s+/g, ' ').slice(0, 72)})`);

    shown[mode] = r.body.slice(r.body.indexOf(expect.title), r.body.indexOf(expect.title) + 170);
  } catch (err) {
    bad(`${label} could not run: ${String(err?.message ?? err).replace(/\s+/g, ' ').slice(0, 170)}`);
  }
}

// ── The three are actually three ──────────────────────────────────────────
console.log('\n── and the three are not one sentence ──');
{
  const seen = Object.entries(shown);
  check(seen.length === 3, `all three cases produced a message (${seen.length})`);
  const pairs = [[0, 503], [0, 500], [503, 500]];
  for (const [a, b] of pairs) {
    check(Boolean(shown[a]) && Boolean(shown[b]) && shown[a] !== shown[b],
      `${a} and ${b} are told apart`);
  }
}

await browser.close();
console.log(fail
  ? `\n❌ ${fail} failure(s)`
  : '\n✅ a request failing after the page rendered says which of the three things happened, and the console carries the line a report needs');
process.exit(fail ? 1 : 0);
