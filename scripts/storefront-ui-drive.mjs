/**
 * The storefront on screen, and in the HTML a crawler is served — Phase 5b/5h.
 *
 * ── The assertion that matters most
 *
 * That the page SERVER-RENDERS its content. An SEO surface delivered to a
 * crawler reading "Loading…" is not an SEO surface, and that exact defect has
 * shipped here before — it is why verify-build.sh checks room pages for it. So
 * this fetches the page as a crawler does, with no JavaScript, and reads the raw
 * HTML for the landlord's name and their JSON-LD.
 *
 * Then, in a browser: that the settings screen is reachable from the nav rather
 * than only by URL, that publishing is the landlord's own act, and that the page
 * states plainly which words are theirs and which are checked.
 *
 * Needs the API on :3000 and the app on :4200.
 */
import { chromium } from '@playwright/test';
import { registerUser, signIn, apiCall, PASSWORD } from './lib/drive-session.mjs';

const API = 'http://localhost:3000', WEB = 'http://localhost:4200';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const iso = (d) => d.toISOString().slice(0, 10);
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

const ll = await registerUser(API, 'LANDLORD');
const T = ll.token;

const r = await apiCall(API, 'POST', '/api/rooms', {
  roomType: 'shared_house', title: 'Storefront UI room to let', rentCents: 275000,
  province: 'Gauteng', city: 'Johannesburg', locationDisplay: 'Orlando East',
  availableFrom: iso(inDays(1)), housematesCount: 2, billsIncluded: true,
  description: 'A clean single room in a quiet Soweto yard with a shared kitchen, an outside tap and a gate locked at night.',
}, T);
await apiCall(API, 'PATCH', `/api/rooms/${r.body.id}/photos`, { paths: ['rooms/demo/cover.jpg'] }, T);
await apiCall(API, 'POST', `/api/rooms/${r.body.id}/publish`, {}, T);

const browser = await chromium.launch();

// ── The settings screen must be reachable from the nav ────────────────────
const lp = await signIn(browser, WEB, ll.email, PASSWORD);
await lp.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
await lp.waitForTimeout(2600);

const navLink = lp.getByRole('link', { name: /Your public page/i }).first();
(await navLink.count())
  ? ok('"Your public page" is in the nav, not reachable only by URL')
  : bad('no nav entry for the public page');

await lp.goto(`${WEB}/landlord/public-page`, { waitUntil: 'domcontentloaded' });
await lp.waitForTimeout(2600);
const settings = (await lp.locator('.portal-main').textContent()) ?? '';

/not live yet/i.test(settings)
  ? ok('it opens NOT live — nothing about a person is published on their behalf')
  : bad(`expected "not live yet": ${settings.replace(/\s+/g, ' ').slice(0, 200)}`);
/\/landlords\//.test(settings)
  ? ok('and shows the address they will share')
  : bad('the public URL is not shown');
/cannot be changed/i.test(settings)
  ? ok('saying plainly that it cannot be changed')
  : bad('nothing explains that the slug is fixed');
/nothing about your tenants|rent records/i.test(settings)
  ? ok('and what the page does NOT show')
  : bad('the page never says what is kept private');

// The slug, read from the screen.
const slugMatch = /\/landlords\/([a-z0-9-]+)/.exec(settings);
const slug = slugMatch?.[1];
slug ? ok(`its address is /landlords/${slug}`) : bad('could not read the slug from the screen');

// Not live, so the public page must 404 even in a browser.
if (slug) {
  const anon = await browser.newPage();
  await anon.goto(`${WEB}/landlords/${slug}`, { waitUntil: 'domcontentloaded' });
  await anon.waitForTimeout(2400);
  const offText = (await anon.locator('body').textContent()) ?? '';
  /no such page/i.test(offText)
    ? ok('an unpublished page says "no such page" to a visitor')
    : bad(`unpublished page showed: ${offText.replace(/\s+/g, ' ').slice(0, 160)}`);
  await anon.close();
}

// ── Publishing is the landlord's own act ─────────────────────────────────
await lp.getByRole('button', { name: /Put it online/i }).first().click();
await lp.waitForTimeout(2400);
const after = (await lp.locator('.portal-main').textContent()) ?? '';
/it is live/i.test(after)
  ? ok('pressing the switch puts it online')
  : bad(`still not live: ${after.replace(/\s+/g, ' ').slice(0, 200)}`);

// ── As a visitor, in a browser ───────────────────────────────────────────
const anon = await browser.newPage();
await anon.goto(`${WEB}/landlords/${slug}`, { waitUntil: 'domcontentloaded' });
await anon.waitForTimeout(2600);
const pub = (await anon.locator('body').textContent()) ?? '';

/Drive Landlord/.test(pub) ? ok('the public page names the landlord') : bad('no name on the public page');
/Storefront UI room to let/.test(pub)
  ? ok('and lists their live room')
  : bad('the live room is not listed');
/On Mastande since \d{4}/.test(pub)
  ? ok('with the joining-year badge')
  : bad('no since badge');
/Not enough answered applications yet/i.test(pub)
  ? ok('and says outright that there is not enough behind a response time')
  : bad('a response time is quoted, or its absence is unexplained');
!/Verified landlord/.test(pub)
  ? ok('no verified badge for an unverified landlord')
  : bad('an unverified landlord shows as verified');
/does not vet listings/i.test(pub)
  ? ok('the disclaimer is on the page')
  : bad('no disclaimer');
/Never pay a deposit/i.test(pub)
  ? ok('including the deposit warning, which is the real risk to a tenant')
  : bad('no deposit warning');

// Heading order on a public page — it has an H1 of its own, unlike a portal page.
const hOrder = await anon.locator('h1,h2,h3,h4').evaluateAll(
  (els) => els.filter((e) => e.offsetWidth || e.offsetHeight).map((e) => Number(e.tagName[1])),
);
const skip = hOrder.findIndex((l, i) => i > 0 && l > hOrder[i - 1] + 1);
hOrder[0] === 1 && skip === -1
  ? ok(`heading order is sound (${hOrder.map((l) => 'H' + l).join(' → ')})`)
  : bad(`heading order broken at ${skip}: ${hOrder.map((l) => 'H' + l).join(' → ')}`);
hOrder.filter((l) => l === 1).length === 1
  ? ok('with exactly one H1')
  : bad(`${hOrder.filter((l) => l === 1).length} H1s on one page`);
await anon.close();
await browser.close();

// ── What a CRAWLER is served: raw HTML, no JavaScript ────────────────────
//
// The whole SEO case for 5b rests on this. A page delivered as "Loading…" is
// worth nothing to a search engine, and that defect has shipped here before.
const res = await fetch(`${WEB}/landlords/${slug}`);
const html = await res.text();
res.status === 200 ? ok('the page answers 200 to a plain fetch') : bad(`plain fetch: ${res.status}`);
html.includes('Drive Landlord')
  ? ok('the landlord’s name is in the SERVER-RENDERED HTML')
  : bad('the served HTML does not contain the name — a crawler sees nothing');
!/>\s*Loading…\s*</.test(html)
  ? ok('and it is not delivered as "Loading…"')
  : bad('the served HTML is a loading state: the SEO surface is empty');
html.includes('Storefront UI room to let')
  ? ok('their room is in it too')
  : bad('the room list is not server-rendered');
// Canonical and robots are NOT checked here, deliberately.
//
// The dev server is not the canonical host, so server.ts correctly serves
// `noindex, nofollow` and omits the canonical for every page on it — a room
// page, the known-good SEO surface, does exactly the same. Asserting them here
// would fail for the environment rather than for the code, and rejecting a
// foreign Host header is not something ng serve allows (403).
//
// They belong against the BUILT SSR server with the canonical Host header, which
// is what scripts/verify-build.sh does. The storefront checks live there.
/"@type"\s*:\s*"RealEstateAgent"/.test(html)
  ? ok('and RealEstateAgent JSON-LD in the served markup')
  : bad('no JSON-LD in the served HTML');
/"makesOffer"/.test(html)
  ? ok('carrying the rooms as offers, not just the name')
  : bad('JSON-LD has no offers');
// A page that is off must not be served as real content to a crawler. Checked by
// what is IN the markup rather than by robots, for the reason above.
const off = await fetch(`${WEB}/landlords/definitely-not-real-at-all`);
const offHtml = await off.text();
off.status === 404 || /No such page/i.test(offHtml)
  ? ok('a nonexistent storefront is served as "no such page", not as a shell')
  : bad(`nonexistent slug served ${off.status} without saying so`);
!/Drive Landlord/.test(offHtml)
  ? ok('and carries nobody\u2019s details')
  : bad('a nonexistent storefront leaked a real landlord onto the page');

console.log(fail ? `\n❌ ${fail} failure(s)` : '\n✅ the storefront is published by its owner, server-rendered for crawlers, and honest about what it has not checked');
process.exit(fail ? 1 : 0);
