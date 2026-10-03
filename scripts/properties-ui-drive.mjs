/**
 * My properties, on screen — Phase 7b.
 *
 * ── What only a browser can show here
 *
 * The brief's diagnosis is a UI one: landlords create rooms one at a time
 * without realising grouping exists, because grouping lived on another screen,
 * below the rent tracking, behind a button that said "yard". Every check here
 * is about whether a landlord would now FIND it and understand what it does:
 *
 *   1. The nav leads to a list of properties, not to one page called "yard".
 *   2. With none, the screen teaches the idea in a sentence and offers one
 *      button — and says grouping is optional, because the brief insists that
 *      structure is not forced on somebody with one address.
 *   3. A card says what the brief asks: the landlord's own name for the place,
 *      the address under it, and "N rooms — M vacant".
 *   4. Tapping it opens that property, with a way back.
 *   5. "+ Add a room to this property" carries the address INTO the wizard,
 *      which is where grouping is won or lost.
 *   6. The wizard asks the grouping question in plain words, with the places
 *      they already have as cards.
 *
 * Needs the API on :3000, the app on :4200, and a DATABASE_URL.
 */
import { chromium } from '@playwright/test';
import { registerUser, apiCall, signIn, PASSWORD, dbQuery as q } from './lib/drive-session.mjs';

const API = 'http://localhost:3000', WEB = 'http://localhost:4200';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const S = Math.floor(Math.random() * 1e6);
const NAME = `Ext 7 back rooms ${S}`;
const ADDRESS = `1423 Vilakazi Street ${S}`;

const landlord = await registerUser(API, 'LANDLORD');
const browser = await chromium.launch();
const page = await signIn(browser, WEB, landlord.email, PASSWORD);

// ── 1. Reachable from the nav, by that name ──────────────────────────────
await page.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
const navLink = page.locator('a[href="/landlord/properties"]');
try {
  await navLink.first().waitFor({ state: 'visible', timeout: 15000 });
  const label = (await navLink.first().innerText()).trim();
  /propert/i.test(label)
    ? ok(`the portal nav says "${label}" and points at the properties screen`)
    : bad(`the nav entry for properties reads "${label}"`);
} catch {
  bad('nothing in the landlord nav leads to the properties screen');
}

// The old URL still works for a bookmark.
await page.goto(`${WEB}/landlord/yard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
page.url().endsWith('/landlord/properties')
  ? ok('and /landlord/yard — where the nav used to point — redirects here rather than 404ing')
  : bad(`/landlord/yard went to ${page.url()}`);

// ── 2. The empty state teaches, and says grouping is optional ───────────
await page.waitForSelector('.empty-state, .prop-list', { timeout: 15000 }).catch(() => {});
const emptyText = await page.locator('.empty-state').innerText().catch(() => '');
/groups the rooms at one address/i.test(emptyText)
  ? ok('with no properties, the screen explains the idea in one sentence')
  : bad(`the empty state reads: ${emptyText.slice(0, 120)}`);

(await page.locator('.empty-state .btn-primary').count()) === 1
  ? ok('…and offers exactly one button, not a wall of choices')
  : bad('the empty state does not offer a single clear action');

// ── 3. A property, created through the screen ───────────────────────────
await page.locator('.empty-state .btn-primary').click();
await page.waitForSelector('.prop-form', { timeout: 10000 });

const addressHint = await page.locator('.prop-form').innerText();
/Only you see this/i.test(addressHint)
  ? ok('the street address field says, where it is typed, that nobody else sees it')
  : bad('the address field does not say it is private');

await page.fill('input[name="name"]', NAME);
await page.fill('input[name="addressLine"]', ADDRESS);
await page.fill('input[name="suburb"]', 'Tembisa');
await page.fill('input[name="city"]', 'Johannesburg');
await page.selectOption('select[name="province"]', 'Gauteng');
await page.locator('.prop-form button[type="submit"]').click();
await page.waitForSelector('.prop-card', { timeout: 15000 }).catch(() => {});

const card = page.locator('.prop-card').first();
const cardText = await card.innerText().catch(() => '');
cardText.includes(NAME)
  ? ok('the card shows the landlord’s own name for the place')
  : bad(`the card reads: ${cardText.slice(0, 120)}`);
cardText.includes(ADDRESS)
  ? ok('with the street address under it, which is what the brief asked for')
  : bad('the card does not show the address the landlord gave');

// ── 4. The room count, in the brief's own words ─────────────────────────
//
// Two rooms over the API — what is being checked is the card, and driving the
// four-step wizard twice would be testing the wizard.
const propertyId = q(`SELECT id FROM properties WHERE name='${NAME}'`);
const room = (title, status) => q(
  `INSERT INTO rooms (id,"landlordId","roomType",title,status,"rentCents",province,city,` +
  `"locationDisplay","availableFrom","propertyId","createdAt","updatedAt","listerType") ` +
  `VALUES (gen_random_uuid(),'${landlord.id}','shared_house','${title}','${status}',300000,` +
  `'Gauteng','Johannesburg','Tembisa, Johannesburg',now(),'${propertyId}',now(),now(),'owner_landlord')`,
);
room(`Room A ${S}`, 'active');
room(`Room B ${S}`, 'let');

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.prop-card__count', { timeout: 15000 }).catch(() => {});
const count = await page.locator('.prop-card__count').first().innerText().catch(() => '');
/2 rooms/.test(count) && /1 vacant/.test(count)
  ? ok(`the card counts them the way the brief words it: "${count}"`)
  : bad(`the count reads "${count}"`);

// ── 5. Tapping the card opens that property ─────────────────────────────
await page.locator('.prop-card__link').first().click();
await page.waitForURL(`**/landlord/properties/${propertyId}`, { timeout: 15000 }).catch(() => {});
page.url().includes(`/landlord/properties/${propertyId}`)
  ? ok('tapping a card opens that property')
  : bad(`tapping the card went to ${page.url()}`);

/**
 * Waited for, not read straight after the navigation.
 *
 * The three checks below passed on one run and failed on the next without the
 * page changing: `waitForURL` resolves when the URL changes, which is before
 * the dashboard call behind the detail view has come back, so the body text was
 * read while the screen still said "Loading…". A check whose answer depends on
 * how fast the API felt is not a check — it is a coin toss that will eventually
 * be "fixed" by changing working code.
 */
await page.waitForSelector('.yard-back', { timeout: 15000 }).catch(() => {});
const detail = await page.locator('body').innerText();
detail.includes(NAME)
  ? ok('and the detail page is headed with the property’s name')
  : bad('the detail page does not name the property');
(await page.locator('.yard-back a').count()) === 1
  ? ok('with a way back to the list')
  : bad('no way back to the properties list');
/Take out of this property/.test(detail)
  ? ok('each room offers "Take out of this property" — words that do not read as "delete my listing"')
  : bad('no per-room action for removing a room from the property');

// ── 6. Add a room HERE, with the place already chosen ───────────────────
await page.locator('a.btn-primary', { hasText: 'Add a room to this property' }).click();
await page.waitForURL('**/landlord/rooms/new**', { timeout: 15000 }).catch(() => {});
page.url().includes('propertyId=')
  ? ok('"+ Add a room to this property" carries the property into the wizard')
  : bad(`the add-a-room button went to ${page.url()}`);

// Step 2 is where the location is, and where the picker lives.
await page.waitForSelector('form', { timeout: 10000 });
await page.fill('input[formcontrolname="title"]', `A bright room at Ext 7 ${S}`);
await page.fill('textarea[formcontrolname="description"]',
  'A clean, bright room in a shared house close to the taxis and the shops. Available immediately.');
await page.locator('button', { hasText: 'Next →' }).first().click();
await page.waitForSelector('.prop-picker', { timeout: 10000 }).catch(() => {});

const picker = await page.locator('.prop-picker').innerText().catch(() => '');
/already have a room listed/i.test(picker)
  ? ok('the wizard asks the grouping question in plain words')
  : bad(`the picker reads: ${picker.slice(0, 120)}`);
picker.includes(NAME)
  ? ok('…with the landlord’s existing place offered as a card they can recognise')
  : bad('the picker does not show the landlord’s existing property');
/No — somewhere new/.test(picker)
  ? ok('and "No — somewhere new" is a real answer, so grouping stays optional')
  : bad('the picker offers no way to say this room is somewhere else');

const chosen = await page.locator('.prop-picker__card.is-chosen').count();
chosen === 1
  ? ok('the property the landlord came from is already chosen for them')
  : bad(`${chosen} cards are pre-selected after arriving with ?propertyId`);

const city = await page.inputValue('input[formcontrolname="city"]');
const where = await page.inputValue('input[formcontrolname="locationDisplay"]');
city === 'Johannesburg' && where === 'Tembisa, Johannesburg'
  ? ok('and the location is filled in from it — nobody retypes the suburb')
  : bad(`location came through as city="${city}", display="${where}"`);

await browser.close();
q(`DELETE FROM users WHERE id = '${landlord.id}'`);

console.log(fail
  ? `\n❌ ${fail} failure(s)`
  : '\n✅ a landlord can find grouping, understand it in a sentence, and add a second room to a place without retyping it');
process.exit(fail ? 1 : 0);
