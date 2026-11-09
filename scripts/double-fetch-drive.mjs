/**
 * §103 — does the browser re-request the board the server already rendered?
 *
 * The server renders the board and serialises the rooms response into
 * `<script id="ng-state">`. The question is whether Angular's HTTP transfer
 * cache serves the client's identical request from that, or the client goes
 * to the network anyway and throws the rendered board away while it waits.
 *
 * Measured rather than reasoned about, two ways at once:
 *
 *   1. every browser-side request to /api/rooms is counted on the wire;
 *   2. the DOM is sampled every 100ms, so a board that renders and then
 *      BLANKS is visible as a card count that goes up and back down.
 *
 * With `--slow`, the browser's own /api/rooms is held open for 12s, which is
 * what a waking free instance does. That is the case that matters: warm, the
 * second request costs ~300ms and nobody sees it.
 *
 *   node scripts/double-fetch-drive.mjs [--slow]
 *
 * Needs the API on :3000 and a DEVELOPMENT SSR bundle on :4200. A production
 * bundle calls api.umastande.co.za, which does not resolve in the dev
 * container, and the board then renders empty for an unrelated reason.
 *
 * ⚠️ Run from the repository root — playwright is in the root node_modules.
 */
import { chromium } from 'playwright';
import { registerUser, signIn, PASSWORD } from './lib/drive-session.mjs';

const SLOW = process.argv.includes('--slow');
const WEB = process.env.FRONTEND_URL ?? 'http://localhost:4200';
const HOLD_MS = 12_000;

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
const page = await ctx.newPage();

/** Browser-side requests for the board, in order. */
const boardRequests = [];
page.on('request', (r) => {
  if (/\/api\/rooms\?/.test(r.url())) boardRequests.push({ url: r.url(), at: Date.now() });
});

if (SLOW) {
  await page.route('**/api/rooms?**', async (route) => {
    await new Promise((r) => setTimeout(r, HOLD_MS));
    await route.continue();
  });
}

// `commit` so sampling starts as soon as the HTML lands, not after the page
// settles — the blank is between those two points.
const t0 = Date.now();
await page.goto(`${WEB}/`, { waitUntil: 'commit' });

const timeline = [];
const until = SLOW ? HOLD_MS + 4000 : 6000;
while (Date.now() - t0 < until) {
  const s = await page.evaluate(() => ({
    cards: document.querySelectorAll('app-room-card').length,
    skeletons: document.querySelectorAll('app-skeleton-card').length,
    heading: document.querySelector('h2.results-count')?.textContent?.trim().slice(0, 28) ?? null,
  })).catch(() => null);
  if (s) timeline.push({ t: Date.now() - t0, ...s });
  await page.waitForTimeout(100);
}

// Collapse to transitions, which is what a person actually sees.
const steps = [];
let prev = '';
for (const s of timeline) {
  const key = `${s.cards}/${s.skeletons}/${s.heading}`;
  if (key !== prev) { steps.push(s); prev = key; }
}
console.log(`\n── DOM transitions (${SLOW ? 'board request held 12s' : 'warm'})`);
for (const s of steps) {
  console.log(`   t=${String(s.t).padStart(6)}ms  cards=${String(s.cards).padStart(2)}  skeletons=${s.skeletons}  heading=${JSON.stringify(s.heading)}`);
}
console.log(`\n── browser-side /api/rooms requests: ${boardRequests.length}`);
for (const r of boardRequests) console.log(`   +${r.at - t0}ms  ${r.url.replace(/^https?:\/\/[^/]+/, '')}`);

// ── the two assertions ────────────────────────────────────────────────────
const sawCards = steps.some((s) => s.cards > 0);
const blanked = steps.some((s, i) => i > 0 && s.cards === 0 && steps[i - 1].cards > 0);

check(sawCards, 'the server rendered rooms into the HTML');
check(
  boardRequests.length === 0,
  `the browser does not re-request the board the server already rendered (saw ${boardRequests.length})`,
);
check(!blanked, 'and the rendered board is never replaced by skeletons');

// ── ⚠️ and the board must still FETCH ─────────────────────────────────────
//
// The transfer cache is consumed once. A fix that stops the first request can
// just as easily be a board that never asks for anything again — the filters
// dead, the next page never arriving — and the checks above would all still
// pass, because they only ever look at the first load. So: drive the two
// things that must still go to the network.
if (SLOW) await page.unroute('**/api/rooms?**');
await page.waitForTimeout(500);

// ⚠️ Scrolled in steps on the SSR-loaded board, and BEFORE the filter change.
// Two things made the first version of this check cry wolf on working code:
// one jump to `scrollHeight` measured against a grid that had only just
// re-rendered, and running it after a filter change, whose own re-render moves
// the sentinel. Probed separately, the untouched board asks for page=2 and
// goes from 12 cards to 24. A check that fails on working code is a false
// alarm waiting to cost somebody an afternoon.
const beforeScroll = boardRequests.length;
for (let i = 0; i < 6 && boardRequests.length === beforeScroll; i++) {
  await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
  await page.waitForTimeout(900);
}
check(
  boardRequests.length > beforeScroll,
  `scrolling to the end still asks for the next page (${boardRequests.length - beforeScroll} request(s))`,
);

const before = boardRequests.length;
await page.evaluate(() => {
  const sel = document.querySelector('select');
  if (sel) { sel.value = sel.options[1]?.value ?? sel.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
});
await page.waitForTimeout(2500);
check(
  boardRequests.length > before,
  `changing a filter still goes to the network (${boardRequests.length - before} request(s))`,
);

// ── ⚠️ signed in, a VIEWER-DEPENDENT read must still carry its token ──────
//
// This is the case neither of the other checks can see, and it is the one
// that would have shipped a real regression.
//
// The first version of the fix reused `isPublicRead`, the predicate that says
// what a server-side render may fetch. It matches by PREFIX, so it is also
// true for `/rooms/:id`, `/reviews/mine`, `/ads/enquiries` and the two admin
// ad reads. Everything above would still have passed — the board is public,
// and the board is all they load — while a landlord opening their own DRAFT
// room got a 404, because findOne only returns a draft to its owner and the
// request had just been stripped of the token that identifies them.
//
// So: sign in, open a room, and read the Authorization header off the wire.
const authHeaders = [];
const apiOrigin = (process.env.API_URL ?? 'http://localhost:3000');
const landlord = await registerUser(apiOrigin, 'LANDLORD');
const inPage = await signIn(browser, WEB, landlord.email, PASSWORD, { width: 390, height: 900 });
inPage.on('request', (r) => {
  if (/\/api\/rooms\/[0-9a-f-]{8,}/i.test(r.url())) {
    authHeaders.push({ url: r.url(), auth: !!r.headers()['authorization'] });
  }
});

// Any room will do: the question is what the request carries, not what it
// returns.
const roomId = await inPage.evaluate(async (origin) => {
  const res = await fetch(`${origin}/api/rooms?limit=1`);
  const body = await res.json();
  return body.data?.[0]?.id ?? null;
}, apiOrigin);

if (!roomId) {
  check(false, 'could not find a room to open — the board returned none');
} else {
  await inPage.goto(`${WEB}/rooms/${roomId}`, { waitUntil: 'networkidle' });
  await inPage.waitForTimeout(800);
  const detail = authHeaders.filter((h) => h.url.includes(`/api/rooms/${roomId}`));
  check(detail.length > 0, `signed in, the room page requested /api/rooms/:id (${detail.length})`);
  check(
    detail.length > 0 && detail.every((h) => h.auth),
    'and it still carried its Authorization header — an owner must be able to open their own draft',
  );
}

await browser.close();
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
