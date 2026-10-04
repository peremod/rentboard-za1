/**
 * The two inboxes, on screen — Phase 7c.
 *
 * ── What only a browser can show here
 *
 * The API drive proves the data is right. These are the things that are only
 * true on a screen, and two of them are the point of the phase:
 *
 *   1. **The nav entries are real.** Both portals listed "Messages" greyed out
 *      with a "Soon" chip, because there was no inbox. A link that goes
 *      somewhere is the deliverable; a check that the chip is gone is a check
 *      that the promise is kept.
 *   2. **Which channel a reply leaves by, said out loud.** A thread genuinely
 *      mixes channels: the tenant writes in the app, it is forwarded to the
 *      landlord on WhatsApp, the landlord answers there and that answer is
 *      threaded back. So the landlord's last reply may have left by a door they
 *      are not now standing at, and replies typed on this screen never go out
 *      over WhatsApp whatever channel they are answering. The brief calls this
 *      a real confusion risk rather than an edge case, and the only way to tell
 *      whether it has been designed against is to read the screen.
 *   3. **A failed request does not read as an empty inbox.** "No messages" when
 *      the request simply did not come back tells somebody nobody has written
 *      to them. Checked by aborting the call in the browser.
 *   4. **The applicants list lands on the applicant**, not merely on the room:
 *      a list that tells you somebody is waiting and then makes you find them
 *      again has moved the work, not saved it.
 *
 * Needs the API on :3000, the app on :4200, and a DATABASE_URL.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { registerUser, apiCall, signIn, PASSWORD, dbQuery as q } from './lib/drive-session.mjs';

const API = 'http://localhost:3000', WEB = 'http://localhost:4200';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const S = Math.floor(Math.random() * 1e6);

// ── Setup over the API: two rooms on one property, one loose, three applicants
const landlord = await registerUser(API, 'LANDLORD');
const tenantA = await registerUser(API, 'TENANT');
const tenantB = await registerUser(API, 'TENANT');
const L = landlord.token;

const prop = await apiCall(API, 'POST', '/api/properties', {
  name: `Ext 7 back rooms ${S}`, suburb: 'Tembisa', city: 'Johannesburg', province: 'Gauteng',
}, L);
if (prop.status !== 201) throw new Error(`property: ${prop.status} ${JSON.stringify(prop.body).slice(0, 200)}`);
const propertyId = prop.body.id;

const mkRoom = async (title, extra = {}) => {
  const res = await apiCall(API, 'POST', '/api/rooms', {
    roomType: 'shared_house', title,
    description: 'A clean room in a shared house, close to transport and the shops. Available now.',
    rentCents: 285000, province: 'Gauteng', city: 'Johannesburg',
    locationDisplay: 'Tembisa, Johannesburg',
    availableFrom: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
    ...extra,
  }, L);
  if (res.status !== 201) throw new Error(`room ${title}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${res.body.id}'`);
  return res.body.id;
};

const roomGrouped = await mkRoom(`Back room ${S}`, { propertyId });
const roomLoose = await mkRoom(`Loose room ${S}`);

const apply = async (roomId, tenant, note) => {
  const res = await apiCall(API, 'POST', '/api/applications', { roomId, coverNote: note }, tenant.token);
  if (res.status !== 201) throw new Error(`apply: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  return res.body.id;
};

const appGrouped = await apply(roomGrouped, tenantA, 'I work at the mall and can move in on the first.');
const appLoose = await apply(roomLoose, tenantB, 'Is the room still available?');

// A tenant message in each, so both appear in the message inbox.
const firstMsg = await apiCall(API, 'POST', `/api/applications/${appGrouped}/messages`,
  { body: 'Good day, is the room still open? I can come see it on Saturday.' }, tenantA.token);
await apiCall(API, 'POST', `/api/applications/${appLoose}/messages`,
  { body: 'Hello, is it still available?' }, tenantB.token);

/**
 * One of the two threads is made to carry a WhatsApp reply from the landlord,
 * because the channel warning only shows on a thread that has actually used
 * both — a warning shown on every thread is a warning nobody reads, so a drive
 * that cannot tell the two apart cannot check it.
 */
const profileId = q(`SELECT id FROM landlord_profiles WHERE "userId" = '${landlord.id}'`);
const LANDLORD_WA = `+2782556${String(S).padStart(4, '0').slice(0, 4)}`;
q(`INSERT INTO landlord_whatsapp_configs (id, "landlordId", "phoneNumber", "phoneVerified", "waEnabled", "optInAt") VALUES ('${crypto.randomUUID()}', '${profileId}', '${LANDLORD_WA}', true, true, now()) ON CONFLICT ("landlordId") DO UPDATE SET "phoneNumber" = '${LANDLORD_WA}'`);

const WAMID = `wamid.ui.${S}`;
q(`UPDATE messages SET "waMessageId" = '${WAMID}' WHERE id = '${firstMsg.body.id}'`);

const APP_SECRET = (fs.readFileSync(new URL('../backend/.env', import.meta.url), 'utf8')
  .match(/^WHATSAPP_APP_SECRET=(.*)$/m) ?? [])[1]?.trim();
if (!APP_SECRET) throw new Error('WHATSAPP_APP_SECRET is not set in backend/.env');

const payload = JSON.stringify({
  entry: [{ changes: [{ value: {
    contacts: [{ wa_id: LANDLORD_WA.replace(/\D/g, '') }],
    messages: [{
      id: `wamid.uireply.${S}`, from: LANDLORD_WA.replace(/\D/g, ''), type: 'text',
      context: { id: WAMID }, text: { body: 'Ewe, come at ten. The gate is the green one.' },
    }],
  } }] }],
});
const waPost = await fetch(`${API}/api/whatsapp/webhook`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(payload).digest('hex'),
  },
  body: payload,
});
// Asserted, not assumed: if this setup fails silently, every channel check
// below passes or fails for a reason that has nothing to do with the screen.
const waStored = q(`SELECT "senderId" FROM messages WHERE "waMessageId" = 'wamid.uireply.${S}'`);
waStored === landlord.id
  ? ok('setup: a WhatsApp reply from the landlord is in one of the two threads')
  : bad(`setup failed — webhook returned ${waPost.status} and senderId is ${waStored || 'missing'}; the channel checks below prove nothing`);

const browser = await chromium.launch();
const page = await signIn(browser, WEB, landlord.email, PASSWORD);

console.log('\n── 1. The nav entries are real, not a "Soon" chip ──────────');

await page.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const msgLink = page.locator('a.portal-nav-link[href="/account/messages"]');
(await msgLink.count()) > 0
  ? ok('the landlord nav has Messages as a real link')
  : bad('the landlord nav has no working link to the message inbox');

const soon = page.locator('.portal-nav-link.is-disabled', { hasText: 'Messages' });
(await soon.count()) === 0
  ? ok('…and the greyed-out "Soon" version of it is gone')
  : bad('Messages is still listed as disabled with a "Soon" chip');

const applicantsLink = page.locator('a.portal-nav-link[href="/landlord/applicants"]');
(await applicantsLink.count()) > 0
  ? ok('…and "All applicants" leads to the portfolio-wide list')
  : bad('the landlord nav has no link to the all-applicants screen');

/**
 * The badge means "waiting on you" and nothing else. It used to carry every
 * application ever received, which only goes up — and a badge that never
 * clears is one people stop reading, at which point the one that matters is
 * invisible too.
 */
const badge = await applicantsLink.locator('.portal-nav-badge, [class*=badge]').innerText().catch(() => '');
badge.trim() === '2'
  ? ok('…with a badge counting the two applicants waiting on them, not every application ever')
  : bad(`the All applicants badge reads "${badge.trim()}", expected 2`);

console.log('\n── 2. All applicants, across rooms ─────────────────────────');

await applicantsLink.click();
await page.waitForURL('**/landlord/applicants', { timeout: 15000 });
await page.waitForSelector('.ai-row, .ai-empty', { timeout: 15000 });

const rows = page.locator('.ai-row');
(await rows.count()) === 2
  ? ok('both applicants are listed on one screen, across two different rooms')
  : bad(`the all-applicants screen shows ${await rows.count()} row(s), expected 2`);

const listText = await page.locator('.ai-list').innerText();
listText.includes(`Back room ${S}`) && listText.includes(`Loose room ${S}`)
  ? ok('…each row naming the room it is for')
  : bad('a row does not say which room the application is for');

listText.includes(`Ext 7 back rooms ${S}`)
  ? ok('…and the property, for the one that has one')
  : bad('a grouped room’s row does not name its property');

console.log('\n── 3. Filtering narrows, and keeps its own way back ────────');

const propertySelect = page.locator('.ai-filters select').first();
await propertySelect.selectOption(propertyId);
await page.waitForTimeout(1200);
(await page.locator('.ai-row').count()) === 1
  ? ok('choosing a property narrows the list to the rooms on it')
  : bad(`filtering by property left ${await page.locator('.ai-row').count()} row(s), expected 1`);

/**
 * The trap this screen was written to avoid. If the options were derived from
 * the rows on screen, choosing a property would shrink the room list to the one
 * room already chosen — the filter would delete its own way back, which is the
 * same defect as a nav that shrinks as you walk through it.
 */
const roomOptions = await page.locator('.ai-filters select').nth(1).locator('option').count();
roomOptions >= 3
  ? ok('…and the room filter still offers every room, not just the one left showing')
  : bad(`after filtering, the room picker offers ${roomOptions} option(s) — the filter deleted its own way back`);

await page.locator('.ai-filters button', { hasText: 'Clear filters' }).click();
await page.waitForTimeout(1200);
(await page.locator('.ai-row').count()) === 2
  ? ok('…and "Clear filters" brings everyone back')
  : bad('clearing the filters did not restore the full list');

console.log('\n── 4. A row lands on the applicant, not just the room ──────');

await page.locator('.ai-row a.btn-primary').first().click();
await page.waitForURL('**/applicants?*', { timeout: 15000 });
await page.waitForSelector('.applicant-card', { timeout: 15000 });
await page.waitForTimeout(1200);

(await page.locator('.applicant-card__body').count()) === 1
  ? ok('the applicant’s own card is already open — the list did not just drop you on the room')
  : bad('opening an applicant from the list left every card collapsed');

const openCard = await page.locator('.applicant-card__body').innerText().catch(() => '');
/mall|still available/i.test(openCard)
  ? ok('…showing what they actually wrote')
  : bad(`the open card does not show the applicant’s cover note: ${openCard.slice(0, 120)}`);

await page.goBack();
await page.waitForTimeout(800);

console.log('\n── 5. The message inbox, and which door a reply leaves by ──');

await page.goto(`${WEB}/account/messages`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.msg-row, .msg-empty', { timeout: 15000 });

const threads = page.locator('.msg-row');
(await threads.count()) === 2
  ? ok('both conversations are in one inbox, without knowing which room to look in')
  : bad(`the inbox shows ${await threads.count()} conversation(s), expected 2`);

const inboxText = await page.locator('.msg-list').innerText();
/WhatsApp/.test(inboxText) && /In the app/.test(inboxText)
  ? ok('…and the rows say which channel the last message came in on — both appear')
  : bad(`the inbox does not distinguish the channels: ${inboxText.replace(/\s+/g, ' ').slice(0, 200)}`);

/**
 * The two rows are picked by the channel chip's own class, not by their text.
 *
 * ⚠️ `filter({ hasText: 'In the app' })` is how the first version of this did
 * it, and Playwright's hasText is case-insensitive: once the mixed thread was
 * expanded, its warning ("…is sent in the app and emailed…") matched that text
 * too, so `.first()` returned the SAME row and the drive reported the warning
 * leaking onto a single-channel thread. A check that selects the wrong element
 * is worse than no check — it invents a defect and sends somebody to look for
 * it in the component.
 */
const mixedRow = page.locator('.msg-row:has(.chan--whatsapp)');
const plainRow = page.locator('.msg-row:has(.chan--in_app)');
(await mixedRow.count()) === 1 && (await plainRow.count()) === 1
  ? ok('…one of each, so the next two checks are about different threads')
  : bad(`expected one thread per channel, found ${await mixedRow.count()} whatsapp and ${await plainRow.count()} in-app`);

await mixedRow.locator('.msg-row__head').click();
await page.waitForSelector('.msg-row__body', { timeout: 10000 });

const warn = await page.locator('.chan-warn').innerText().catch(() => '');
/used WhatsApp and the app/i.test(warn)
  ? ok('opening a thread that has used both channels warns that it has')
  : bad(`a mixed-channel thread shows no warning: "${warn.slice(0, 120)}"`);

/does not\s+go out on WhatsApp/i.test(warn.replace(/\s+/g, ' '))
  ? ok('…and says plainly that a reply typed here does NOT go out on WhatsApp')
  : bad(`the warning does not say where a reply goes: "${warn.replace(/\s+/g, ' ').slice(0, 180)}"`);

(await page.locator('.msg-row__body .thread__composer').count()) === 1
  ? ok('…with the composer right there, so the warning is read before the reply is typed')
  : bad('an open conversation has no composer');

// The single-channel thread gets the quiet version, not the alarm. The
// collapse is WAITED for: clicking the next row before Angular has re-rendered
// re-expands the one just closed, which is how the race above was found.
await mixedRow.locator('.msg-row__head').click();
await page.waitForSelector('.msg-row__body', { state: 'detached', timeout: 10000 });
await plainRow.locator('.msg-row__head').click();
await page.waitForSelector('.msg-row__body', { timeout: 10000 });

(await page.locator('.chan-warn').count()) === 0
  ? ok('a thread that has only used one channel is not given the same alarm')
  : bad('the mixed-channel warning is shown on a thread that has only used one');

const note = await page.locator('.chan-note').innerText().catch(() => '');
/sent in the app/i.test(note)
  ? ok('…but still says quietly where a reply goes')
  : bad(`the quiet note is missing or wrong: "${note.slice(0, 120)}"`);

console.log('\n── 6. The tenant’s side says the tenant’s truth ────────────');

const tPage = await signIn(browser, WEB, tenantA.email, PASSWORD);
await tPage.goto(`${WEB}/account/messages`, { waitUntil: 'domcontentloaded' });
await tPage.waitForSelector('.msg-row, .msg-empty', { timeout: 15000 });

(await tPage.locator('a.portal-nav-link[href="/account/messages"]').count()) > 0
  ? ok('the tenant nav also leads here, with no "Soon" chip')
  : bad('the tenant nav has no working link to the message inbox');

await tPage.locator('.msg-row__head').first().click();
await tPage.waitForSelector('.msg-row__body', { timeout: 10000 });
const tNote = (await tPage.locator('.chan-warn, .chan-note').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
/forwarded on WhatsApp if they have WhatsApp switched on/i.test(tNote)
  ? ok('…and tells the TENANT the opposite true thing: their reply IS forwarded to the landlord on WhatsApp')
  : bad(`the tenant is shown the landlord's wording or none: "${tNote.slice(0, 180)}"`);

console.log('\n── 7. A closed conversation ────────────────────────────────');

await apiCall(API, 'POST', `/api/applications/${appLoose}/reject`, { reason: 'Let to someone else' }, L);
const tbPage = await signIn(browser, WEB, tenantB.email, PASSWORD);
await tbPage.goto(`${WEB}/account/messages`, { waitUntil: 'domcontentloaded' });
await tbPage.waitForSelector('.msg-row, .msg-empty', { timeout: 15000 });

(await tbPage.locator('.msg-row .closed').count()) === 1
  ? ok('a turned-down application’s conversation is still listed, marked closed')
  : bad('a rejected application’s thread is either gone or not marked closed');

await tbPage.locator('.msg-row__head').first().click();
await tbPage.waitForSelector('.msg-row__body', { timeout: 10000 });
(await tbPage.locator('.thread__composer').count()) === 0
  ? ok('…and offers no box to type in, instead of letting a send fail')
  : bad('a closed conversation still shows a composer, so a send will be refused after typing');

const closedNote = await tbPage.locator('.thread__closed').innerText().catch(() => '');
/turned down/i.test(closedNote) && /stay here to read/i.test(closedNote)
  ? ok('…saying why it is closed and that the messages stay readable')
  : bad(`the closed note reads: "${closedNote.slice(0, 140)}"`);

console.log('\n── 8. A failed request is not an empty inbox ───────────────');

const failPage = await signIn(browser, WEB, landlord.email, PASSWORD);
await failPage.route('**/messages/inbox', (route) => route.abort());
await failPage.goto(`${WEB}/account/messages`, { waitUntil: 'domcontentloaded' });
await failPage.waitForTimeout(2500);

const failText = (await failPage.locator('.msg-empty').innerText().catch(() => '')).replace(/\s+/g, ' ');
/problem at our end/i.test(failText)
  ? ok('when the request fails the screen says so — it does not say nobody has written')
  : bad(`a failed inbox request shows: "${failText.slice(0, 160)}"`);

(await failPage.locator('.msg-empty button').count()) === 1
  ? ok('…and offers a way to try again')
  : bad('the failure state offers no retry');

await failPage.route('**/applications/inbox*', (route) => route.abort());
await failPage.goto(`${WEB}/landlord/applicants`, { waitUntil: 'domcontentloaded' });
await failPage.waitForTimeout(2500);
const failText2 = (await failPage.locator('.ai-empty').innerText().catch(() => '')).replace(/\s+/g, ' ');
/problem at our end/i.test(failText2)
  ? ok('the applicants screen draws the same distinction, which is the one that matters most there')
  : bad(`a failed applicants request shows: "${failText2.slice(0, 160)}"`);

console.log('\n── 9. On a phone, at 390px ─────────────────────────────────');

/**
 * The width most of this market actually uses. Four native selects side by side
 * is a filter bar on a laptop and an unreadable row of stubs on a phone, and
 * horizontal page scroll is the specific failure this product cannot afford:
 * the person it is for is holding a cheap Android in one hand.
 */
const phone = await signIn(browser, WEB, landlord.email, PASSWORD, { width: 390, height: 844 });
await phone.goto(`${WEB}/landlord/applicants`, { waitUntil: 'domcontentloaded' });
await phone.waitForSelector('.ai-row', { timeout: 15000 });

const overflow = await phone.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
overflow <= 1
  ? ok('the applicants screen does not scroll sideways on a 390px phone')
  : bad(`the applicants screen overflows by ${overflow}px at 390px`);

const selectWidth = await phone.locator('.ai-filters select').first().evaluate((el) => el.clientWidth);
selectWidth > 240
  ? ok('…and the filters stack full-width rather than sitting four-across as stubs')
  : bad(`a filter select is ${selectWidth}px wide at 390px — the bar did not stack`);

await phone.goto(`${WEB}/account/messages`, { waitUntil: 'domcontentloaded' });
await phone.waitForSelector('.msg-row', { timeout: 15000 });
const overflow2 = await phone.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
overflow2 <= 1
  ? ok('the message inbox does not scroll sideways either')
  : bad(`the message inbox overflows by ${overflow2}px at 390px`);

// A row is the control; on a phone it has to be big enough to hit.
const rowBox = await phone.locator('.msg-row__head').first().boundingBox();
(rowBox?.height ?? 0) >= 44
  ? ok('…and a conversation row is a target you can actually hit with a thumb')
  : bad(`a conversation row is ${Math.round(rowBox?.height ?? 0)}px tall, under the 44px target`);

await browser.close();
console.log(`\n${fail === 0 ? '✅ all checks passed' : `❌ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
