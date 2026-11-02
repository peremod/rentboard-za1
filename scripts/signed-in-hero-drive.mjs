/**
 * The hero, signed out and signed in, at 360 / 390 / 768 / 1280.
 *
 * ── What it is for
 *
 * Signed in, the hero's whole content is a pitch to somebody who has already
 * bought: an eyebrow, an alternating "rooms to rent / list your room"
 * headline, a sub-line, and four statistics about a decision already made.
 * It collapses to a heading and the actions. Two things have to stay true
 * while it does:
 *
 *   1. the page still has exactly one h1, and the results count is still an
 *      h2 UNDER it — dropping the block entirely would leave the busiest page
 *      in the site with no h1 and an h2 as its first heading, and
 *   2. the CTA row keeps working at a 44px touch target and starts no
 *      horizontal scroll at 360px.
 *
 * It also checks that signing in does not cost the board itself: the room
 * cards must still render.
 *
 * ── Running it
 *
 *   node scripts/signed-in-hero-drive.mjs [outputDir]
 *
 * Needs the API on :3000 and a DEVELOPMENT SSR bundle on :4200:
 *
 *   cd frontend && npx ng build --configuration=development
 *   PORT=4200 node dist/mastande-frontend/server/server.mjs &
 *
 * ⚠️ A production bundle calls api.umastande.co.za, which does not resolve in
 * the dev container; sign-in then fails and reads as an auth bug. signIn() in
 * scripts/lib/drive-session.mjs names the unreachable origin for that reason.
 *
 * ⚠️ Run it from the repository root — playwright is in the root
 * node_modules and an ESM import resolves from the script's own directory.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { registerUser, signIn, PASSWORD } from './lib/drive-session.mjs';

const OUT = process.argv[2] ?? 'drive-output/signed-in-hero';
const WEB = process.env.FRONTEND_URL ?? 'http://localhost:4200';
const API = process.env.API_URL ?? 'http://localhost:3000';
const WIDTHS = [360, 390, 768, 1280];
/** WCAG 2.5.8. */
const MIN_TARGET_PX = 44;

mkdirSync(OUT, { recursive: true });

let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) fails++;
};

/** What the hero is showing, read from the rendered page rather than guessed. */
const readHero = (page) => page.evaluate(() => {
  const q = (sel) => document.querySelectorAll(sel).length;
  const h1 = document.querySelectorAll('h1');
  return {
    eyebrow: q('.hero-eyebrow'),
    pitchHeadline: q('h1.hero-headline'),
    compactHeadline: q('h1.hero-compact-title'),
    sub: q('p.hero-sub'),
    stats: q('.hero-stat'),
    ctas: q('.hero-ctas .btn'),
    registerCta: q('.hero-ctas a[href*="/auth/register"]'),
    listCta: q('.hero-ctas a[href*="/landlord/rooms/new"]'),
    h1Count: h1.length,
    h1Text: (h1[0]?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
    heroHeight: Math.round(document.querySelector('.hero')?.getBoundingClientRect().height ?? 0),
    // The first two headings in document order — the heading-order check.
    firstHeadings: [...document.querySelectorAll('h1,h2')].slice(0, 2).map((h) => h.tagName),
    scrollW: document.documentElement.scrollWidth,
    cards: q('app-room-card'),
    ctaBoxes: [...document.querySelectorAll('.hero-ctas .btn')]
      .map((b) => Math.round(b.getBoundingClientRect().height)),
  };
});

const browser = await chromium.launch();

// One landlord account, reused across the widths. A landlord rather than a
// tenant because the landlord branch is the one that swaps a CTA rather than
// just removing it.
const landlord = await registerUser(API, 'LANDLORD');
console.log(`signed-in account: ${landlord.email}\n`);

const signedOutHeights = {};

for (const width of WIDTHS) {
  // ── signed out ──────────────────────────────────────────────────────────
  const outCtx = await browser.newContext({ viewport: { width, height: 900 } });
  const outPage = await outCtx.newPage();
  await outPage.goto(`${WEB}/`, { waitUntil: 'networkidle' });
  const out = await readHero(outPage);

  check(out.pitchHeadline === 1, `${width}px signed out: the pitch headline is there`);
  check(out.eyebrow === 1 && out.sub === 1, `${width}px signed out: eyebrow and sub-line are there`);
  check(out.stats === 4, `${width}px signed out: four statistics (${out.stats})`);
  check(out.registerCta === 1, `${width}px signed out: the register CTA is there`);
  check(out.cards > 0, `${width}px signed out: rooms render (${out.cards} cards)`);
  signedOutHeights[width] = out.heroHeight;
  await outPage.screenshot({ path: `${OUT}/hero-signed-out-${width}.png` });
  await outCtx.close();

  // ── signed in ───────────────────────────────────────────────────────────
  const inPage = await signIn(browser, WEB, landlord.email, PASSWORD, { width, height: 900 });
  await inPage.goto(`${WEB}/`, { waitUntil: 'networkidle' });
  await inPage.waitForTimeout(600); // the startup refresh settles, then the hero collapses
  const sin = await readHero(inPage);

  check(sin.pitchHeadline === 0, `${width}px signed in: the pitch headline is GONE`);
  check(sin.eyebrow === 0, `${width}px signed in: the eyebrow is gone`);
  check(sin.sub === 0, `${width}px signed in: the sub-line is gone`);
  check(sin.stats === 0, `${width}px signed in: the four statistics are gone (${sin.stats})`);

  check(sin.h1Count === 1, `${width}px signed in: exactly one h1 remains (${sin.h1Count})`);
  check(sin.compactHeadline === 1, `${width}px signed in: and it is the plain heading ("${sin.h1Text}")`);
  check(
    sin.firstHeadings[0] === 'H1' && sin.firstHeadings[1] === 'H2',
    `${width}px signed in: heading order is still h1 then h2 (${sin.firstHeadings.join(' → ')})`,
  );

  check(sin.registerCta === 0, `${width}px signed in: no register CTA — it is a dead end when signed in`);
  check(sin.listCta === 1, `${width}px signed in: a landlord gets "List a room" instead`);
  check(sin.ctas === 2, `${width}px signed in: two actions, no more (${sin.ctas})`);
  check(
    sin.ctaBoxes.length > 0 && sin.ctaBoxes.every((h) => h >= MIN_TARGET_PX),
    `${width}px signed in: every CTA clears the ${MIN_TARGET_PX}px touch target (${sin.ctaBoxes.join(', ')})`,
  );

  check(sin.scrollW <= width, `${width}px signed in: no horizontal page scroll (scrollWidth ${sin.scrollW})`);
  check(sin.cards > 0, `${width}px signed in: rooms still render (${sin.cards} cards)`);

  // The point of the change: the board is nearer than it was.
  check(
    sin.heroHeight < signedOutHeights[width],
    `${width}px: the hero is shorter signed in (${sin.heroHeight}px vs ${signedOutHeights[width]}px)`,
  );

  await inPage.screenshot({ path: `${OUT}/hero-signed-in-${width}.png` });
  await inPage.context().close();
}

await browser.close();
console.log(fails === 0 ? `\nALL PASS — screenshots in ${OUT}` : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
