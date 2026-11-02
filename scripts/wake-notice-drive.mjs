/**
 * The free-instance waking notice on the public board, driven at the four
 * widths CLAUDE.md names: 360 / 390 / 768 / 1280.
 *
 * ── What this proves, and what it does not
 *
 * It proves the notice appears when a first load of the board is genuinely
 * slow, that it is NOT on screen before the threshold, that it fits the
 * viewport and wraps, and that the results heading changes with it. Every
 * assertion here is something a unit test cannot see: all of it is layout and
 * timing in a real browser.
 *
 * It does NOT prove the notice helps the cold first load of `/`. It cannot,
 * because the server renders the board itself — see docs/OUTSTANDING.md §103,
 * where the measurement that matters is recorded.
 *
 * ── How the wait is imitated
 *
 * `page.route` holds `/api/rooms` open for 12s. That is the browser's own
 * request, which is the one the notice covers; a Render free instance waking
 * takes 30-60s, so 12s is the shape, shortened.
 *
 * ── Running it
 *
 *   node scripts/wake-notice-drive.mjs [outputDir]
 *
 * Needs a DEVELOPMENT SSR bundle on :4200 and the API on :3000:
 *
 *   cd frontend && npx ng build --configuration=development
 *   PORT=4200 node dist/mastande-frontend/server/server.mjs &
 *
 * ⚠️ `--configuration=production` would serve a bundle that calls
 * api.umastande.co.za, which does not resolve in the dev container. That has
 * cost three sessions so far; the board then renders empty and reads as an SSR
 * defect. See scripts/lib/drive-session.mjs.
 *
 * ⚠️ Run it from the repository root — playwright is in the root
 * node_modules, and an ESM import resolves from the script's own directory.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'drive-output/wake-notice';
const BASE = process.env.FRONTEND_URL ?? 'http://localhost:4200';
/** Must match Home.WAKE_NOTICE_MS. */
const THRESHOLD_MS = 6000;
const WIDTHS = [360, 390, 768, 1280];

mkdirSync(OUT, { recursive: true });

let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) fails++;
};

const browser = await chromium.launch();

for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  // A waking instance: the browser's own request for the board hangs.
  await page.route('**/api/rooms?**', async (route) => {
    await new Promise((r) => setTimeout(r, 12_000));
    await route.continue();
  });

  await page.goto(`${BASE}/`, { waitUntil: 'commit' });
  await page.waitForTimeout(500);

  const notice = page.locator('.waking-notice');
  const visible = () => notice.isVisible().catch(() => false);

  check(!(await visible()), `${width}px: notice NOT on screen at ~0.5s`);

  await page.waitForTimeout(THRESHOLD_MS + 1000);
  const shown = await visible();
  check(shown, `${width}px: notice on screen past the ${THRESHOLD_MS}ms threshold`);

  if (shown) {
    const box = await notice.boundingBox();
    check(box.width <= width - 16, `${width}px: notice keeps the 16px gutter (${Math.round(box.width)}px wide)`);

    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    check(scrollW <= width, `${width}px: no horizontal page scroll (scrollWidth ${scrollW})`);

    // A single line hundreds of characters wide is the failure mode CLAUDE.md
    // names; two lines or more means the copy wrapped.
    const h = await notice.locator('p').evaluate((el) => Math.round(el.getBoundingClientRect().height));
    check(h >= 24, `${width}px: body copy wraps rather than running one line (${h}px tall)`);

    const heading = (await page.locator('h2.results-count').innerText()).trim();
    check(/Waking the server/.test(heading), `${width}px: results heading says waking, not "Loading rooms…" (${JSON.stringify(heading)})`);

    await page.screenshot({ path: `${OUT}/board-waking-${width}.png`, fullPage: false });
  }

  await ctx.close();
}

await browser.close();
console.log(fails === 0 ? `\nALL PASS — screenshots in ${OUT}` : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
