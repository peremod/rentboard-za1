/**
 * The social card, and the first-run walkthrough — Phase 7f.
 *
 * ── What is worth checking
 *
 *   1. **The default OG image is real, the right size, and reached by a URL
 *      that works.** index.html pointed at the APEX host, and per
 *      environment.prod.ts the apex is a different box that answers
 *      `301 → /` — a redirect to the site root, not to the file, so a crawler
 *      following it is handed HTML where it asked for a PNG. The dimensions
 *      are MEASURED from the file here, because `og:image:width` is a promise
 *      WhatsApp lays a card out around.
 *   2. **The fallback actually falls back.** A room with no photo must get the
 *      site image and its dimensions; a room WITH a photo must get its own
 *      picture and, deliberately, no dimensions — see DEFAULT_IMAGE_SIZE for
 *      why claiming them there would be a guess.
 *   3. **Each environment advertises its own host**, so staging link previews
 *      do not point at production.
 *   4. **The walkthrough appears once.** Not every login — the brief is
 *      explicit — and the record is on the ACCOUNT, not in the browser,
 *      because a phone here is shared and replaced. The check that matters is
 *      that the stamp reached the database, not that the card closed.
 *   5. **It is role-appropriate**, skippable, and comes back on request.
 *   6. **It is usable at 360px**, which for a modal is the whole question.
 *
 * Needs the API on :3000, the app on :4200, and a DATABASE_URL.
 */
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { registerUser, apiCall, signIn, PASSWORD, dbQuery as q } from './lib/drive-session.mjs';

const API = 'http://localhost:3000', WEB = 'http://localhost:4200';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const S = Math.floor(Math.random() * 1e6);

console.log('\n── 1. The default social card is a real 1200×630 file ───────');

const png = new URL('../frontend/src/assets/images/og-default.png', import.meta.url);
let bytes;
try { bytes = readFileSync(png); } catch { bytes = null; }
bytes
  ? ok(`the default OG image exists (${Math.round(bytes.length / 1024)} KB)`)
  : bad('frontend/src/assets/images/og-default.png is missing — every page with no image of its own has a broken card');

if (bytes) {
  // PNG header: width and height are big-endian uint32 at bytes 16 and 20.
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  width === 1200 && height === 630
    ? ok(`…and it is ${width}×${height}, which is what the meta tags promise`)
    : bad(`the file is ${width}×${height} but og:image:width/height say 1200×630 — the card will be laid out wrong`);

  // WhatsApp stops rendering a preview for a large image, and WhatsApp is the
  // channel this product's own SEO comment says matters most here.
  bytes.length < 300 * 1024
    ? ok(`…and under 300 KB, so WhatsApp will still draw the preview`)
    : bad(`the image is ${Math.round(bytes.length / 1024)} KB — WhatsApp may skip the preview entirely`);
}

const indexHtml = readFileSync(new URL('../frontend/src/index.html', import.meta.url), 'utf8');
/**
 * ⚠️ The apex, specifically.
 *
 * environment.prod.ts records that `umastande.co.za` is the old cPanel host and
 * answers `301 → https://www.umastande.co.za/` — to the ROOT, not to the file.
 * So the no-JavaScript fallback card asked for a PNG and would be handed the
 * homepage's HTML.
 */
/content="https:\/\/www\.umastande\.co\.za\/assets\/images\/og-default\.png"/.test(indexHtml)
  ? ok('the static fallback uses the www host, not the apex that redirects every path to /')
  : bad('index.html still points og:image at a host that is not where the site is served');

for (const tag of ['og:image:width', 'og:image:height', 'og:image:type', 'og:image:alt']) {
  indexHtml.includes(tag)
    ? ok(`…and declares ${tag}`)
    : bad(`index.html has no ${tag} — Facebook and WhatsApp use it to choose a large card without fetching the file`);
}

console.log('\n── 2. Every rendered page carries the full set ──────────────');

const metaOf = async (path) => {
  const html = await (await fetch(WEB + path)).text();
  const out = {};
  for (const m of html.matchAll(/<meta\s+(?:property|name)="(og:[^"]*|twitter:[^"]*)"\s+content="([^"]*)"/g)) {
    out[m[1]] = m[2];
  }
  return out;
};

const board = await metaOf('/');
board['og:image'] === `${WEB}/assets/images/og-default.png`
  ? ok('the board is served with the default card')
  : bad(`the board's og:image is ${JSON.stringify(board['og:image'])}`);

/**
 * The environment's OWN host, which is the parity check.
 *
 * In development that is localhost. If this ever reads umastande.co.za from a
 * development or staging server, every link shared out of that environment is
 * advertising production's image — and CLAUDE.md requires a feature to behave
 * the same in all three.
 */
board['og:image']?.startsWith(WEB)
  ? ok('…built from this environment’s own siteUrl, so staging cannot advertise production')
  : bad(`og:image points outside this environment: ${board['og:image']}`);

board['og:image:width'] === '1200' && board['og:image:height'] === '630'
  ? ok('…with the dimensions the file actually has')
  : bad(`dimensions served as ${board['og:image:width']}×${board['og:image:height']}`);

board['og:image:alt'] && board['twitter:image:alt']
  ? ok('…and alt text on both cards')
  : bad('the social card has no alt text');

console.log('\n── 3. The fallback falls back, and the guess is not made ────');

const landlord = await registerUser(API, 'LANDLORD');
const tenant = await registerUser(API, 'TENANT');

const mkRoom = async (title, hero) => {
  const res = await apiCall(API, 'POST', '/api/rooms', {
    roomType: 'shared_house', title,
    description: 'A clean room in a shared house, close to transport and the shops. Available now.',
    rentCents: 295000, province: 'Gauteng', city: 'Johannesburg',
    locationDisplay: 'Tembisa, Johannesburg',
    availableFrom: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
  }, landlord.token);
  if (res.status !== 201) throw new Error(`room: ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
  q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"=${hero ? `'${hero}'` : 'NULL'} WHERE id = '${res.body.id}'`);
  return res.body.id;
};

const roomNoPhoto = await mkRoom(`No photo ${S}`, null);
const roomWithPhoto = await mkRoom(`With photo ${S}`, 'rooms/drive-stub.jpg');

const noPhoto = await metaOf(`/rooms/${roomNoPhoto}`);
noPhoto['og:image'] === `${WEB}/assets/images/og-default.png`
  ? ok('a room with no photo falls back to the site card rather than shipping an empty og:image')
  : bad(`a photoless room's og:image is ${JSON.stringify(noPhoto['og:image'])}`);
noPhoto['og:image:width'] === '1200'
  ? ok('…and carries the dimensions, because that file’s size is a measured fact')
  : bad('the fallback card has no dimensions');

const withPhoto = await metaOf(`/rooms/${roomWithPhoto}`);
withPhoto['og:image']?.includes('drive-stub.jpg')
  ? ok(`a room WITH a photo advertises its own picture`)
  : bad(`a room with a photo advertises ${JSON.stringify(withPhoto['og:image'])}`);

/**
 * ⚠️ And deliberately WITHOUT dimensions.
 *
 * The URL asks ImageKit for 1200×630, but whether `c-maintain_ratio` returns
 * exactly that or merely fits inside it was not verified in this container. A
 * wrong og:image:height is worse than none — the platform believes it and lays
 * the card out around a size the file does not have. So the honest thing is to
 * say nothing, and this check is what keeps somebody from "improving" it into a
 * guess later.
 */
!withPhoto['og:image:width'] && !withPhoto['og:image:height']
  ? ok('…and claims no dimensions for it, because ImageKit’s output size was never verified here')
  : bad(`a room photo is shipping dimensions ${withPhoto['og:image:width']}×${withPhoto['og:image:height']} that nobody measured`);

console.log('\n── 4. The walkthrough appears once, on the account ──────────');

const browser = await chromium.launch();
const page = await signIn(browser, WEB, landlord.email, PASSWORD, { width: 1280, height: 900 });
await page.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

/**
 * ⚠️ The cookie notice comes FIRST, and that is the finding.
 *
 * Both it and the walkthrough are fixed to the bottom of the screen, and the
 * notice is at z-index 9999 — so a brand-new account got the notice drawn OVER
 * the tour's buttons. This drive found it the hard way: thirteen clicks on
 * "Next" intercepted by `.cookie-notice`, which is exactly what a thumb would
 * have found. They are sequenced now, and the sequence is checked rather than
 * worked around, because clicking the notice away silently would hide the very
 * behaviour that was wrong.
 */
const notice = page.locator('.cookie-notice');
if (await notice.count()) {
  (await page.locator('.wt-card').count()) === 0
    ? ok('while the cookie notice is up the walkthrough waits — two bottom sheets at once is what this fixed')
    : bad('the walkthrough is drawn under the cookie notice, whose buttons sit on top of its own');
  await page.locator('.cookie-notice__ok').click();
  await page.waitForTimeout(1200);
} else {
  bad('no cookie notice on a fresh browser — the sequencing check below proves nothing');
}

(await page.locator('.wt-card').count()) === 1
  ? ok('…and then a brand-new landlord is shown round on their first portal screen')
  : bad('the walkthrough does not appear for a new account');

const steps = (await page.locator('.wt-card').innerText()).replace(/\s+/g, ' ');
/free to post|stays free|Listing a room is free/i.test(steps)
  ? ok('…with a landlord’s steps')
  : bad(`the landlord's first step reads: "${steps.slice(0, 140)}"`);
!/Renter.s Passport/i.test(steps)
  ? ok('…and not the tenant’s — a landlord being sold somebody else’s feature learns nothing')
  : bad('a landlord is shown the Renter’s Passport step');

// Step through it. Four cards, and Next must stop at the last one.
const dots = await page.locator('.wt-dot').count();
dots === 4
  ? ok(`…four steps, not a wall of nine (${dots} dots)`)
  : bad(`the walkthrough has ${dots} steps`);

for (let i = 1; i < dots; i++) await page.locator('.wt-actions button', { hasText: 'Next' }).click();
await page.waitForTimeout(400);
(await page.locator('.wt-actions button', { hasText: 'Got it' }).count()) === 1
  ? ok('…and the last card says "Got it" rather than offering a Next that goes nowhere')
  : bad('the final step still offers Next');

await page.locator('.wt-actions button', { hasText: 'Got it' }).click();
await page.waitForTimeout(1200);
(await page.locator('.wt-card').count()) === 0
  ? ok('closing it closes it')
  : bad('the walkthrough stayed open after "Got it"');

/**
 * ⚠️ The check that matters: the stamp reached the DATABASE.
 *
 * A card that closes is a card that closes. If the write did not land, the
 * walkthrough returns on the next login — which is the exact thing the brief
 * says must not happen, and the exact thing a local-only flag would do.
 */
const stamp = q(`SELECT "walkthroughSeenAt" IS NOT NULL FROM users WHERE id = '${landlord.id}'`);
stamp === 't'
  ? ok('…and the account is stamped on the server, not just in this browser')
  : bad('nothing was recorded — the walkthrough will come back on the next login');

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
(await page.locator('.wt-card').count()) === 0
  ? ok('…so a reload does not show it again')
  : bad('the walkthrough reappeared after a reload');

console.log('\n── 5. A tenant gets the tenant’s tour ───────────────────────');

const tPage = await signIn(browser, WEB, tenant.email, PASSWORD, { width: 1280, height: 900 });
await tPage.goto(`${WEB}/tenant/dashboard`, { waitUntil: 'domcontentloaded' });
await tPage.waitForTimeout(2500);
if (await tPage.locator('.cookie-notice__ok').count()) {
  await tPage.locator('.cookie-notice__ok').click();
  await tPage.waitForTimeout(1200);
}
const tSteps = (await tPage.locator('.wt-card').innerText().catch(() => '')).replace(/\s+/g, ' ');
/Applying is free/i.test(tSteps)
  ? ok('a tenant is told the thing that matters to a tenant: applying is free')
  : bad(`the tenant's first step reads: "${tSteps.slice(0, 140)}"`);

// Skip, rather than stepping through — the brief asks for a way out.
await tPage.locator('.wt-skip').click();
await tPage.waitForTimeout(1200);
(await tPage.locator('.wt-card').count()) === 0 && q(`SELECT "walkthroughSeenAt" IS NOT NULL FROM users WHERE id = '${tenant.id}'`) === 't'
  ? ok('…and Skip is a real way out, recorded like finishing it')
  : bad('Skip did not close and record the walkthrough');

console.log('\n── 6. "Show me around again" brings it back ─────────────────');

/**
 * ⚠️ Reach the settings screen IN-APP, because `page.goto` hides the defect.
 *
 * A full page load tears down the Angular app and rebuilds it, so the in-memory
 * `dismissed` signal — set by skipping the tour a moment ago — comes back
 * false. That is not the state a person is in: they skip the tour, tap
 * Settings, and the signal is still true. With `goto` the whole section ran
 * against a fresh app and could not see that the button did nothing.
 *
 * Proved by planting the original defect and watching this section stay green
 * until this navigation was changed.
 *
 * Widened first: at 412px the three links to a given screen are an off-canvas
 * drawer (which Playwright calls visible, at x = -1009), a hidden desktop one,
 * and one behind the burger. What is asserted here is SPA navigation versus a
 * reload, not nav chrome; the phone layout is section 7's job.
 */
await tPage.setViewportSize({ width: 1280, height: 900 });
await tPage.waitForTimeout(600);
if (await tPage.locator('.cookie-notice__ok').count()) {
  await tPage.locator('.cookie-notice__ok').click();
  await tPage.waitForTimeout(400);
}
const toSettings = tPage.locator('a[href="/account/settings"]:visible').first();
(await toSettings.count()) > 0
  ? ok('settings is reachable from a link, so the session carries across')
  : bad('no in-app link to settings — this section cannot test the real path');
await toSettings.click({ timeout: 15000 });
await tPage.waitForURL((u) => u.pathname === '/account/settings', { timeout: 15000 });
await tPage.waitForTimeout(1500);
const replay = tPage.locator('button', { hasText: 'Show me around again' });
(await replay.count()) === 1
  ? ok('account settings offers it again — the brief asks for a way back')
  : bad('there is no way to see the walkthrough again');

await replay.click();
await tPage.waitForTimeout(1500);
q(`SELECT "walkthroughSeenAt" IS NULL FROM users WHERE id = '${tenant.id}'`) === 't'
  ? ok('…and it clears the stamp rather than keeping a second piece of state')
  : bad('asking for it again did not clear the record');

/**
 * ⚠️ NOT on this screen. The copy promises the next one.
 *
 * Clearing the stamp alone re-opens the tour instantly here, because a page
 * load leaves `dismissed` false — so the modal lands on top of the button just
 * pressed and over the sentence explaining what will happen. That is one of the
 * two bugs this section now covers; the other is the tour never coming back at
 * all. They were traded for each other for three releases because both were
 * carried on one signal.
 */
(await tPage.locator('.wt-card').count()) === 0
  ? ok('…and it does NOT open on top of the button that was just pressed')
  : bad('the walkthrough opened on the settings screen, over its own button');

/**
 * ⚠️ Navigate the way a person does — by pressing a link, not `page.goto`.
 *
 * This assertion existed and passed for three releases while the button did
 * nothing, because `page.goto` is a full page load: it tears down the Angular
 * app and builds a new one, which resets the in-memory `dismissed` signal that
 * `shouldShow()` checks first. A landlord pressing "Show me around again" and
 * then tapping something in the nav gets a ROUTER navigation, no reload, and
 * that signal survived it — so the tour never came back without a hard refresh.
 *
 * The drive was exercising a code path a person never takes. Clicking is the
 * whole point of the check.
 */
/**
 * The link has to be one a thumb can reach. At 412px the navbar's links are
 * behind the burger, and the first run clicked a resolved-but-hidden <a> and
 * sat on it until Playwright timed out — a drive failing for its own reasons
 * while saying nothing about the product.
 */
// The cookie notice is fixed at z-index 9999 and sits over the foot of the
// page; it has intercepted clicks in this repo before. Out of the way first.
if (await tPage.locator('.cookie-notice__ok').count()) {
  await tPage.locator('.cookie-notice__ok').click();
  await tPage.waitForTimeout(400);
}
/**
 * ⚠️ Navigate by PRESSING A LINK, not `page.goto`.
 *
 * This section's assertion passed for three releases while the button did
 * nothing, because `page.goto` is a full page load: it tears down the Angular
 * app and builds a new one, resetting the in-memory `dismissed` signal that
 * `shouldShow()` tests first. A person pressing "Show me around again" and then
 * tapping the nav gets a ROUTER navigation with no reload, and that signal
 * survived every one — so the tour never came back without a hard refresh.
 *
 * Widened to 1280 for the click. What is being asserted is SPA navigation
 * versus a reload, not nav chrome: at 412px the three dashboard links are the
 * off-canvas drawer (Playwright calls it visible at x = -1009), a hidden
 * desktop one, and one behind the burger — all of which made this fail for the
 * drive's own reasons while saying nothing about the product. The walkthrough
 * on a phone is section 7's job, and it does it at 360.
 */
const toDash = tPage.locator('a[href="/tenant/dashboard"]:visible').first();
(await toDash.count()) > 0
  ? ok('there is a nav link on screen to press, so this is navigation and not a reload')
  : bad('no reachable in-app link to the dashboard — cannot test the way a person moves');
await toDash.click({ timeout: 15000 });
await tPage.waitForURL((u) => u.pathname === '/tenant/dashboard', { timeout: 15000 });
await tPage.waitForTimeout(2500);
(await tPage.locator('.wt-card').count()) === 1
  ? ok('…so it opens on the next screen, reached the way a person reaches it')
  : bad('the walkthrough did not come back after being reset (in-app navigation)');

console.log('\n── 7. On a phone, which for a modal is the whole question ───');

const phone = await signIn(browser, WEB, tenant.email, PASSWORD, { width: 360, height: 780 });
await phone.goto(`${WEB}/tenant/dashboard`, { waitUntil: 'domcontentloaded' });
await phone.waitForTimeout(2500);
if (await phone.locator('.cookie-notice__ok').count()) {
  await phone.locator('.cookie-notice__ok').click();
  await phone.waitForTimeout(1200);
}

const sheet = await phone.evaluate(() => {
  const card = document.querySelector('.wt-card');
  if (!card) return null;
  const r = card.getBoundingClientRect();
  const controls = [...card.querySelectorAll('button, a')];
  return {
    full: r.width >= window.innerWidth - 2,
    bottom: Math.abs(r.bottom - window.innerHeight) < 2,
    fits: r.height <= window.innerHeight,
    smallest: Math.min(...controls.map((c) => c.getBoundingClientRect().height)),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

sheet?.full && sheet.bottom
  ? ok('at 360px it is a sheet from the bottom, where the thumb is')
  : bad(`at 360px the card is not a bottom sheet: ${JSON.stringify(sheet)}`);
sheet && sheet.fits
  ? ok('…and fits on the screen, so the buttons are reachable without scrolling the page')
  : bad('the card is taller than the viewport at 360px');
sheet && sheet.smallest >= 44
  ? ok(`…with every control at least 44px (smallest ${Math.round(sheet.smallest)}px)`)
  : bad(`a control is ${Math.round(sheet?.smallest ?? 0)}px tall — including the one somebody taps to get out`);
sheet && sheet.overflow <= 1
  ? ok('…and the page behind it does not scroll sideways')
  : bad(`the page overflows by ${sheet?.overflow}px with the walkthrough open`);

// Escape, because a modal you can only leave with a mouse is a trap.
await phone.keyboard.press('Escape');
await phone.waitForTimeout(900);
(await phone.locator('.wt-card').count()) === 0
  ? ok('Escape closes it')
  : bad('Escape does not close the walkthrough');

await browser.close();
console.log(`\n${fail === 0 ? '✅ all checks passed' : `❌ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
