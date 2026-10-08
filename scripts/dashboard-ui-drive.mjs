/**
 * The dashboard home, on screen — Phase 7d.
 *
 * ── What only a browser can show here
 *
 *   1. **The buttons on the task list actually arrive somewhere.** The API
 *      drive checks the string; only a click checks that the page it names
 *      renders the section it names. This is the headline fix of the phase: the
 *      two most important buttons on the landlord dashboard pointed at
 *      /landlord/yard#money, which Phase 7b turned into a redirect, and a
 *      redirect drops the fragment.
 *   2. **The numbers read as sentences.** The brief asks that the plain-English
 *      principle be confirmed "in the real components, not just present in the
 *      original design doc", and the only place to confirm that is the page.
 *      The four-box grid of bare numbers has to be gone, and the window
 *      ("this week", "the last seven days") has to be stated — a figure without
 *      its window is the lifetime counter this replaced.
 *   3. **Rent reminders is reachable at all.** The control was built because
 *      the API had no screen; Phase 7b then left it on a screen with no route.
 *      Reachability is not a thing an API drive can see.
 *   4. **A landlord who never grouped anything can reach their own money.**
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
const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();

const landlord = await registerUser(API, 'LANDLORD');
const loose = await registerUser(API, 'LANDLORD');
const tenantA = await registerUser(API, 'TENANT');
const tenantB = await registerUser(API, 'TENANT');
const quiet = await registerUser(API, 'TENANT');
const L = landlord.token;

const mkRoom = async (title, token, extra = {}) => {
  const res = await apiCall(API, 'POST', '/api/rooms', {
    roomType: 'shared_house', title,
    description: 'A clean room in a shared house, close to transport and the shops. Available now.',
    rentCents: 300000, province: 'Gauteng', city: 'Johannesburg',
    locationDisplay: 'Tembisa, Johannesburg',
    availableFrom: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
    ...extra,
  }, token);
  if (res.status !== 201) throw new Error(`room ${title}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${res.body.id}'`);
  return res.body.id;
};

const propA = (await apiCall(API, 'POST', '/api/properties',
  { name: `Vilakazi Street ${S}`, suburb: 'Tembisa', city: 'Johannesburg', province: 'Gauteng' }, L)).body;
const propB = (await apiCall(API, 'POST', '/api/properties',
  { name: `Ext 7 back rooms ${S}`, suburb: 'Tembisa', city: 'Johannesburg', province: 'Gauteng' }, L)).body;

const roomA = await mkRoom(`Front room ${S}`, L, { propertyId: propA.id });
const roomB = await mkRoom(`Back room ${S}`, L, { propertyId: propB.id });
/**
 * A third room with no applicant, and that is not padding.
 *
 * ⚠️ Accepting an application takes the room OFF the board — it becomes
 * reserved — so a landlord whose every room has been let has no live rooms and
 * the dashboard correctly says "nothing listed yet". The first version of this
 * drive accepted on both rooms and then reported that the week sentence was
 * broken, which was the drive describing a landlord it had itself emptied.
 */
const roomLive = await mkRoom(`Still looking ${S}`, L, { propertyId: propA.id });
/** A second live room, so the window and the "nobody applied" wording are both checked. */
const roomQuiet = await mkRoom(`Nobody yet ${S}`, L, { propertyId: propA.id });

// Views, written straight in — a drive cannot wait a week and should not try.
// The second room's are three days old, which must still be inside "this week".
q(`INSERT INTO room_view_days ("roomId", day, count) VALUES ('${roomLive}', now()::date, 12)`);
q(`INSERT INTO room_view_days ("roomId", day, count) VALUES ('${roomQuiet}', (now() - interval '3 days')::date, 5)`);

const tenancyFor = async (roomId, tenant) => {
  const app = await apiCall(API, 'POST', '/api/applications', { roomId, coverNote: 'I work at the mall and can move in on the first.' }, tenant.token);
  const acc = await apiCall(API, 'POST', `/api/applications/${app.body.id}/accept`, {}, L);
  if (acc.status >= 300) throw new Error(`accept: ${acc.status} ${JSON.stringify(acc.body).slice(0, 160)}`);
  const id = q(`SELECT id FROM tenancies WHERE "applicationId" = '${app.body.id}'`);
  // startDate too — an 'active' tenancy with none is a row the API cannot
  // make, and the rent window refuses marks against it.
  q(`UPDATE tenancies SET status='active', "startDate"=now() WHERE id = '${id}'`);
  return { applicationId: app.body.id, tenancyId: id };
};

const tenancyA = await tenancyFor(roomA, tenantA);
const tenancyB = await tenancyFor(roomB, tenantB);

/**
 * A third tenancy, on a room in NO property, paid, at a different rent.
 *
 * ⚠️ This exists so the next section's figure checks can actually fail. With
 * only property A's month marked paid, A's own rent and the landlord's
 * portfolio total were the SAME number — so when the scoping was deliberately
 * broken, the two figure checks still passed and only the sentence caught it.
 * Two checks passing for the wrong reason is worse than one check: they make
 * the one that works look redundant.
 *
 * With R3 000 on A and R4 500 outside it, the portfolio is R7 500 and A's page
 * showing the portfolio is now a visible failure.
 */
const roomSolo = await mkRoom(`Loose let ${S}`, L, {});
q(`UPDATE rooms SET "rentCents" = 450000 WHERE id = '${roomSolo}'`);
const soloTenant = await registerUser(API, 'TENANT');
const tenancySolo = await tenancyFor(roomSolo, soloTenant);
await apiCall(API, 'PATCH', `/api/properties/rent/${tenancySolo.tenancyId}/mark`,
  { status: 'paid', periodStart: monthStart }, L);

// One applicant left waiting on the live room, so its line has both clauses.
const waiter = await registerUser(API, 'TENANT');
await apiCall(API, 'POST', '/api/applications',
  { roomId: roomLive, coverNote: 'I can come and see it on Saturday.' }, waiter.token);

// Property A's rent is marked PAID, B's is left unrecorded — so the two
// property detail screens must show different figures, which is the check.
await apiCall(API, 'PATCH', `/api/properties/rent/${tenancyA.tenancyId}/mark`,
  { status: 'paid', periodStart: monthStart }, L);
await apiCall(API, 'PATCH', `/api/properties/rent/${tenancyB.tenancyId}/mark`,
  { status: 'unpaid', periodStart: monthStart }, L);

const browser = await chromium.launch();
const page = await signIn(browser, WEB, landlord.email, PASSWORD);

console.log('\n── 1. The numbers read as sentences ────────────────────────');

await page.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.dash-week', { timeout: 20000 });

const week = (await page.locator('.dash-week').first().innerText()).replace(/\s+/g, ' ');
/last seven days/i.test(week)
  ? ok('the dashboard says what window its view figure covers')
  : bad(`the week sentence does not state its window: "${week.slice(0, 160)}"`);

/viewed \d+ times? in the last seven days/i.test(week)
  ? ok(`…as a sentence, not a number in a box — "${week.slice(0, 90)}…"`)
  : bad(`the week sentence does not read as the brief asks: "${week.slice(0, 160)}"`);

/**
 * ⚠️ The grid has to be GONE, not merely moved down the page.
 *
 * It sat directly below a health paragraph whose own code comment explains why
 * a raw figure is the wrong shape here ("invites a landlord to think something
 * has been measured"). Two opposite designs, one above the other.
 */
const portalMain = page.locator('.portal-main, main').first();
(await portalMain.locator('.stat-row .lbl', { hasText: 'Total views' }).count()) === 0
  ? ok('the four-box grid of bare numbers is gone from the dashboard home')
  : bad('the dashboard still shows a "Total views" stat box — the lifetime figure this phase replaced');

const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
!/get far more viewings/i.test(bodyText)
  ? ok('…and so is the claim that replying within 24 hours "gets far more viewings", which nobody measured')
  : bad('the dashboard still asserts an unmeasured statistic about reply times');

console.log('\n── 2. Per room, in the brief’s own words ────────────────────');

const roomLines = await page.locator('.app-week').allInnerTexts();
const joined = roomLines.join(' | ').replace(/\s+/g, ' ');
/Viewed 12 times this week/.test(joined)
  ? ok('a room says how many times it was viewed THIS WEEK')
  : bad(`no room line carries the weekly figure: "${joined.slice(0, 200)}"`);

/1 person has applied/.test(joined)
  ? ok('…and how many people applied, in words rather than a bare count')
  : bad(`the applied clause is missing or wrong: "${joined.slice(0, 200)}"`);

/Viewed 5 times this week\. Nobody has applied yet\./.test(joined)
  ? ok('…and a room viewed three days ago counts those inside the window, and says nobody applied')
  : bad(`the second room's line is wrong: "${joined.slice(0, 220)}"`);

console.log('\n── 3. Both starts, on the home screen ──────────────────────');

const addRoom = page.locator('.dash-starts a[href="/landlord/rooms/new"]');
const addProperty = page.locator('.dash-starts a[href="/landlord/properties"]');
(await addRoom.count()) === 1 && (await addProperty.count()) === 1
  ? ok('"Add a room" and "Add a property" are both on the dashboard home')
  : bad(`found ${await addRoom.count()} add-a-room and ${await addProperty.count()} add-a-property entry points`);

await addProperty.click();
await page.waitForURL('**/landlord/properties', { timeout: 15000 });
ok('…and the property one goes where it says');

console.log('\n── 4. Rent reminders is reachable again ────────────────────');

await page.waitForSelector('#grace-days', { timeout: 15000 }).catch(() => {});
(await page.locator('#grace-days').count()) === 1
  ? ok('the rent-reminder window is on /landlord/properties, where a landlord can find it')
  : bad('the rent-reminder control is still on no reachable screen');

await page.fill('#grace-days', '0');
await page.locator('.rent-reminders button', { hasText: 'Save' }).click();
await page.waitForTimeout(1500);
const graceMsg = (await page.locator('.rent-reminders [role="status"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
/Reminders are off/i.test(graceMsg)
  ? ok('…saving 0 says plainly that nothing will be sent')
  : bad(`saving 0 said: "${graceMsg.slice(0, 120)}"`);

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#grace-days', { timeout: 15000 });
(await page.locator('#grace-days').inputValue()) === '0'
  ? ok('…and it comes back as 0 rather than the default, so a landlord who turned it off is not told it is on')
  : bad(`after a reload the box reads "${await page.locator('#grace-days').inputValue()}", not 0`);

console.log('\n── 5. "This month" belongs to the property you opened ──────');

await page.goto(`${WEB}/landlord/properties/${propA.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#money', { timeout: 20000 });
const scopeA = (await page.locator('#money .money-scope').innerText()).replace(/\s+/g, ' ');
scopeA.includes(propA.name)
  ? ok('the money section names the property it is about')
  : bad(`the money section says "${scopeA}" on ${propA.name}'s page`);

/**
 * The rand figure, digits only.
 *
 * ⚠️ Not a substring test on the rendered text. "R7,500.00" does not contain
 * "7500" — the comma is in the way — so a check written as /7500/ silently
 * passed on a page showing exactly the wrong number, and only the sentence
 * above caught the deliberate break. A formatted currency string has to be
 * parsed, not matched.
 */
const randOf = (text) => (text.match(/R\s?([\d,]+)/)?.[1] ?? '').replace(/,/g, '');

/**
 * ⚠️ Waits for the FIGURE, not for the box around it.
 *
 * `waitForSelector('#money')` returns as soon as the section renders, and the
 * money comes from a request that lands after it. So reading the stat box
 * immediately caught R0 about one run in four, and reported "expected its own
 * 3000, not the portfolio's 7500" — a scoping bug, about a screen that was
 * right and merely not finished loading. A check that fails one run in four is
 * one somebody eventually satisfies by changing working code.
 *
 * It polls until two consecutive reads agree, so it waits for the value to
 * settle rather than for a fixed sleep. A figure that really is 0 still fails:
 * the poll gives up and the assertion reads whatever is on the screen.
 */
const settledRand = async (locator, timeoutMs = 12000) => {
  const started = Date.now();
  let previous = null;
  while (Date.now() - started < timeoutMs) {
    const current = randOf(await locator.innerText().catch(() => ''));
    if (current && current === previous) return current;
    previous = current;
    await page.waitForTimeout(400);
  }
  return previous ?? '';
};

const paidA = await settledRand(page.locator('#money .stat-box').first());
paidA === '3000'
  ? ok("…and shows that property's R3 000, not the R7 500 across everything")
  : bad(`property A's "rent marked paid" is R${paidA} — expected its own 3000, not the portfolio's 7500`);

await page.goto(`${WEB}/landlord/properties/${propB.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#money', { timeout: 20000 });
const paidB = await settledRand(page.locator('#money .stat-box').first());
paidB === '0'
  ? ok('…while the other property, whose month is unpaid, shows R0 — not A’s rent and not the total')
  : bad(`property B shows R${paidB} — it is being handed somebody else's money`);

console.log('\n── 6. The task list’s buttons arrive somewhere ──────────────');

await page.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#needs-attention', { timeout: 20000 });

const markIt = page.locator('#needs-attention .inbox-action', { hasText: /Mark it|Look at the month/ }).first();
(await markIt.count()) > 0
  ? ok('the task list offers the unrecorded month')
  : bad('no rent task on the dashboard, so the click below proves nothing');

const href = await markIt.getAttribute('href');
await markIt.click();
await page.waitForTimeout(2500);
(await page.locator('#money').count()) === 1
  ? ok(`…and pressing it lands on a page that HAS the money section (${href})`)
  : bad(`pressing it went to ${page.url()} and no #money is on the page — the Phase 7b break`);

!page.url().endsWith('/landlord/properties')
  ? ok('…not on the bare properties list, which is where it used to end up')
  : bad('the button still dumps the landlord on a list of addresses');

console.log('\n── 7. A landlord who never grouped anything ────────────────');

const looseRoom = await mkRoom(`Only room ${S}`, loose.token);
const looseApp = await apiCall(API, 'POST', '/api/applications', { roomId: looseRoom, coverNote: 'Is it still open?' }, quiet.token);
await apiCall(API, 'POST', `/api/applications/${looseApp.body.id}/accept`, {}, loose.token);
const looseTenancy = q(`SELECT id FROM tenancies WHERE "applicationId" = '${looseApp.body.id}'`);
q(`UPDATE tenancies SET status='active', "startDate"=now() WHERE id = '${looseTenancy}'`);
await apiCall(API, 'PATCH', `/api/properties/rent/${looseTenancy}/mark`, { status: 'unpaid', periodStart: monthStart }, loose.token);

const loosePage = await signIn(browser, WEB, loose.email, PASSWORD);
await loosePage.goto(`${WEB}/landlord/properties/ungrouped`, { waitUntil: 'domcontentloaded' });
await loosePage.waitForTimeout(3000);

(await loosePage.locator('#money').count()) === 1
  ? ok('a landlord with no property can reach their rent at /landlord/properties/ungrouped')
  : bad('the ungrouped view does not render the money section — rent is still unreachable for them');

const looseNote = (await loosePage.locator('.yard-ungrouped-note').innerText().catch(() => '')).replace(/\s+/g, ' ');
/not grouped under a property/i.test(looseNote)
  ? ok('…and the screen says which rooms it is showing')
  : bad(`the ungrouped view does not explain itself: "${looseNote.slice(0, 120)}"`);

await loosePage.goto(`${WEB}/landlord/properties`, { waitUntil: 'domcontentloaded' });
await loosePage.waitForTimeout(2500);
/**
 * ⚠️ Guarded, and the guard found the bug.
 *
 * The first version called getAttribute straight away, the element did not
 * exist, and Playwright threw after thirty seconds — CRASHING the drive before
 * the summary rather than failing a check. The reason it did not exist is the
 * finding: a landlord with rooms and NO properties gets the teaching empty
 * state, and the "Not grouped" card renders only in the other branch, so the
 * link to their own rent was in a branch they never see.
 */
const ungroupedLinks = loosePage.locator('a[href="/landlord/properties/ungrouped"]');
(await ungroupedLinks.count()) > 0
  ? ok('…and /landlord/properties offers them a way in, even with no properties to list')
  : bad('a landlord with rooms but no properties is shown the empty state with no link to their own rooms');

console.log('\n── 8. The tenant’s side of the same idea ───────────────────');

const tPage = await signIn(browser, WEB, tenantA.email, PASSWORD);
await tPage.goto(`${WEB}/tenant/dashboard`, { waitUntil: 'domcontentloaded' });
await tPage.waitForSelector('#needs-you, .dash-week', { timeout: 20000 });

/**
 * ⚠️ Tenant A has an ACTIVE tenancy — this drive's own `tenancyFor` sets the
 * status directly — so there must be no acceptance row for them, and this
 * check used to assert the opposite.
 *
 * It read: "with the acceptance at the top, which is the one where silence
 * costs them the room". That is true of somebody who has just been accepted
 * and false of somebody who has moved in, and an Application stays `accepted`
 * for good, so the inbox showed it for the whole tenancy at urgency -2000. The
 * person it was built for read it as "you have been accepted, talk to the
 * landlord" on the dashboard of the room they were sitting in, and said so.
 *
 * The acceptance wording is proved on a tenant who really is waiting, below.
 */
const tTasks = (await tPage.locator('#needs-you').innerText().catch(() => '')).replace(/\s+/g, ' ');
!/You have been accepted/i.test(tTasks)
  ? ok('a tenant who has MOVED IN is not still told they have been accepted')
  : bad(`tenant A lives there and the task list still says: "${tTasks.slice(0, 180)}"`);
(await tPage.locator('#where-you-live').count()) === 1
  ? ok('…their room is under "Where you live now" instead')
  : bad('nothing on the dashboard says where tenant A actually lives');
(await tPage.locator('#your-applications').innerText()).includes(`Front room ${S}`)
  ? bad('…and it is STILL also filed under "Your applications"')
  : ok('…and it is no longer filed under "Your applications"');

/**
 * Somebody genuinely waiting: accepted, with no tenancy confirmed. This is
 * what the check above used to be pointed at.
 */
const waiting = await registerUser(API, 'TENANT');
const roomWait = await mkRoom(`Waiting room ${S}`, L, { propertyId: propA.id });
const waitApp = await apiCall(API, 'POST', '/api/applications',
  { roomId: roomWait, coverNote: 'I can move in on the first of next month.' }, waiting.token);
await apiCall(API, 'POST', `/api/applications/${waitApp.body.id}/accept`, {}, L);
const wPage = await signIn(browser, WEB, waiting.email, PASSWORD);
await wPage.goto(`${WEB}/tenant/dashboard`, { waitUntil: 'domcontentloaded' });
await wPage.waitForSelector('#needs-you', { timeout: 20000 });
const wTasks = (await wPage.locator('#needs-you').innerText()).replace(/\s+/g, ' ');
/You have been accepted/i.test(wTasks)
  ? ok('a tenant who has just been accepted IS told so, at the top — silence here costs them the room')
  : bad(`the waiting tenant's task list does not lead with the acceptance: "${wTasks.slice(0, 160)}"`);
/record the day you move in/i.test(wTasks)
  ? ok('…and the same row names the step that finishes it')
  : bad(`the acceptance row does not say how to finish it: "${wTasks.slice(0, 200)}"`);
// Kept open: its summary sentence is read below, where tenant A's cannot be.

/**
 * The rent wording is checked on tenant B, whose month is the UNPAID one.
 *
 * ⚠️ It was checked on tenant A at first, whose rent this drive's own setup
 * marks PAID — so there was no rent item to read and the check reported the
 * wording as wrong about a row that correctly did not exist. A check pointed at
 * a condition its setup removed proves nothing in either direction.
 */
const tbPage = await signIn(browser, WEB, tenantB.email, PASSWORD);
await tbPage.goto(`${WEB}/tenant/dashboard`, { waitUntil: 'domcontentloaded' });
await tbPage.waitForSelector('#needs-you', { timeout: 20000 });
const tbTasks = (await tbPage.locator('#needs-you').innerText()).replace(/\s+/g, ' ');
/has not recorded/i.test(tbTasks) && !/you have not paid/i.test(tbTasks)
  ? ok('…and the rent line says the landlord has not recorded it, never that the tenant has not paid')
  : bad(`the rent wording is wrong: "${tbTasks.slice(0, 220)}"`);

/**
 * ⚠️ The count sentence is read on the WAITING tenant, not on tenant A.
 *
 * Tenant A has moved in, so their application is no longer open and the
 * sentence correctly says none are — which is not a sentence with a number in
 * it. Asserting /\d+ applications? open/ on them was asserting that a tenant
 * who lives somewhere still has an open application, which is the whole fault
 * this section was changed for. Both wordings are checked, each on the account
 * it is true of.
 */
const wSummary = (await wPage.locator('.dash-week').first().innerText()).replace(/\s+/g, ' ');
/\d+ applications? open/.test(wSummary)
  ? ok('the three bare numbers are a sentence now')
  : bad(`the waiting tenant's summary reads: "${wSummary.slice(0, 160)}"`);

const tSummary = (await tPage.locator('.dash-week').first().innerText()).replace(/\s+/g, ' ');
/none of your applications are still open/i.test(tSummary)
  ? ok('…and a tenant who has moved in is told none are still open, rather than given a count of one')
  : bad(`tenant A's summary reads: "${tSummary.slice(0, 160)}"`);

(await tPage.locator('.stat-row .lbl', { hasText: 'Awaiting reply' }).count()) === 0
  ? ok('…and the overlapping "Applications / Shortlisted / Awaiting reply" boxes are gone')
  : bad('the tenant dashboard still shows the three boxes that add up to each other');

// A tenant with nothing at all. `quiet` was accepted for the ungrouped
// landlord's room above, so they HAVE a task and cannot answer this question.
const nobody = await registerUser(API, 'TENANT');
const nPage = await signIn(browser, WEB, nobody.email, PASSWORD);
await nPage.goto(`${WEB}/tenant/dashboard`, { waitUntil: 'domcontentloaded' });
await nPage.waitForSelector('.dash-week', { timeout: 20000 });
(await nPage.locator('#needs-you').count()) === 0
  ? ok('a tenant with nothing to do is shown no empty queue at all')
  : bad('the "Needs you" heading renders with nothing under it');

console.log('\n── 9. On a phone, at 390px ─────────────────────────────────');

/**
 * The pages already signed in, resized — not two fresh sign-ins.
 *
 * ⚠️ Each sign-in here costs a request against /auth/login, which v1.86.0
 * limits to 30 per 15 minutes counted in memory. This drive needs nine
 * accounts; running it twice inside the window made it die on a sign-in with
 * "still on /auth/login", which reads like an auth bug and is the limiter
 * working. Reusing the pages keeps the drive inside its own budget.
 */
for (const [label, p, path] of [['landlord', page, '/landlord/dashboard'], ['tenant', tPage, '/tenant/dashboard']]) {
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(WEB + path, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  const overflow = await p.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  overflow <= 1
    ? ok(`the ${label} dashboard does not scroll sideways at 390px`)
    : bad(`the ${label} dashboard overflows by ${overflow}px at 390px`);
}

await browser.close();
console.log(`\n${fail === 0 ? '✅ all checks passed' : `❌ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
