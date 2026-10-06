/**
 * The task inbox on screen — Phase 5a/5d.
 *
 * scripts/inbox-drive.mjs proves the API lists the right things in the right
 * order. This proves a landlord can see them and act on them, and that the two
 * mistakes this codebase keeps making are not repeated: a panel whose heading
 * skips a level (three times now), and a list of identically-named buttons that
 * tell a screen-reader user nothing about which row they belong to.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── A landlord with nothing to do ─────────────────────────────────────────
const quiet = await registerUser(API, 'LANDLORD');
const browser = await chromium.launch();
const qp = await signIn(browser, WEB, quiet.email, PASSWORD);
await qp.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
await qp.waitForTimeout(2600);

(await qp.locator('#needs-attention').count()) === 0
  ? ok('no "Needs you" panel when nothing needs them')
  : bad('an empty attention panel is rendered');
(await qp.locator('#portfolio-health').count())
  ? ok('but the health card is there from day one')
  : bad('no health card for a new landlord');
const qText = (await qp.locator('#portfolio-health').textContent()) ?? '';
/not posted a room yet/i.test(qText)
  ? ok('and it says there is nothing yet, in a sentence')
  : bad(`health text: ${qText.replace(/\s+/g, ' ').slice(0, 160)}`);
!/%/.test(qText)
  ? ok('with no percentage invented out of nothing')
  : bad(`a percentage with nothing behind it: ${qText.replace(/\s+/g, ' ').slice(0, 160)}`);

// ── A landlord with real work ─────────────────────────────────────────────
const ll = await registerUser(API, 'LANDLORD');
const T = ll.token;

async function room(title) {
  const r = await apiCall(API, 'POST', '/api/rooms', {
    roomType: 'shared_house', title, rentCents: 250000, province: 'Gauteng',
    city: 'Johannesburg', locationDisplay: 'Soweto', availableFrom: iso(inDays(1)),
    housematesCount: 2, billsIncluded: true,
    description: 'A clean single room in a quiet Soweto yard with a shared kitchen, an outside tap and a gate locked at night.',
  }, T);
  await apiCall(API, 'PATCH', `/api/rooms/${r.body.id}/photos`, { paths: ['rooms/demo/cover.jpg'] }, T);
  await apiCall(API, 'POST', `/api/rooms/${r.body.id}/publish`, {}, T);
  return r.body.id;
}
const roomA = await room('Inbox UI room with applicant');
const roomB = await room('Inbox UI room that is let');

const waiter = await registerUser(API, 'TENANT');
await apiCall(API, 'POST', '/api/applications', {
  roomId: roomA, coverNote: 'I would like this room please, I can move in at the start of the month.',
}, waiter.token);

const mover = await registerUser(API, 'TENANT');
const app2 = await apiCall(API, 'POST', '/api/applications', {
  roomId: roomB, coverNote: 'I would like this room please, I can move in at the start of the month.',
}, mover.token);
await apiCall(API, 'POST', `/api/applications/${app2.body.id}/accept`, {}, T);
let tenancyId = null;
for (let i = 0; i < 20; i++) {
  const mine = await apiCall(API, 'GET', '/api/tenancies/mine', undefined, T);
  const f = (mine.body || []).find((x) => x.roomId === roomB || x.room?.id === roomB);
  if (f) { tenancyId = f.id; break; }
  await sleep(250);
}
if (!tenancyId) { bad('no tenancy appeared'); await browser.close(); process.exit(1); }
await apiCall(API, 'POST', `/api/tenancies/${tenancyId}/confirm-start`, { startDate: iso(inDays(-40)) }, T);
await apiCall(API, 'PATCH', `/api/tenancies/${tenancyId}/lease`, { leaseEndDate: iso(inDays(9)) }, T);
ok('a landlord with an unanswered applicant, a lease ending and unrecorded rent');

const lp = await signIn(browser, WEB, ll.email, PASSWORD);
await lp.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
await lp.waitForTimeout(2800);

const panel = lp.locator('#needs-attention');
(await panel.count()) ? ok('the panel appears') : bad('no attention panel with three things outstanding');
const body = (await panel.textContent()) ?? '';

/waiting to hear from you/i.test(body)
  ? ok('the unanswered applicant is named in plain English')
  : bad(`no applicant row: ${body.replace(/\s+/g, ' ').slice(0, 200)}`);
/lease is ending/i.test(body)
  ? ok('so is the lease ending')
  : bad('no lease row');
/not recorded|has not paid/i.test(body)
  ? ok('and the rent that is not settled')
  : bad('no rent row');
!/pending|viewed|lease_ending|rent_unmarked|undefined|null/i.test(body)
  ? ok('with no enum name or null leaking into the copy')
  : bad(`raw value in the copy: ${body.replace(/\s+/g, ' ').slice(0, 200)}`);

// It is at the TOP. The whole point of 5a is that this leads the dashboard.
const order = await lp.locator('#needs-attention, #portfolio-health, .insight-banner, #active-listings')
  .evaluateAll((els) => els.map((e) => e.id || e.className.split(' ')[0]));
order[0] === 'needs-attention'
  ? ok('it leads the dashboard, above the totals banner')
  : bad(`dashboard order: ${order.join(' → ')}`);
order[1] === 'portfolio-health'
  ? ok('with the health paragraph second')
  : bad(`health is not second: ${order.join(' → ')}`);

// Ordering on screen matches what the API decided.
const rowTitles = await panel.locator('.inbox-title').allTextContents();
const leaseIdx = rowTitles.findIndex((t) => /lease is ending/i.test(t));
const rentIdx = rowTitles.findIndex((t) => /not recorded|has not paid/i.test(t));
leaseIdx >= 0 && rentIdx >= 0 && leaseIdx < rentIdx
  ? ok('the dated item sorts above rent admin, as the API ordered it')
  : bad(`on-screen order: ${JSON.stringify(rowTitles.map((t) => t.slice(0, 40)))}`);

// ── Every row is actionable, and distinguishable to a screen reader ───────
const actions = panel.locator('.inbox-action');
const actionCount = await actions.count();
actionCount === rowTitles.length
  ? ok(`every row carries its own action (${actionCount})`)
  : bad(`${actionCount} actions for ${rowTitles.length} rows`);

const labels = await actions.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
labels.every((l) => l.length > 12)
  ? ok('each action has an accessible name naming its row')
  : bad(`thin aria-labels: ${JSON.stringify(labels)}`);
new Set(labels).size === labels.length
  ? ok('and no two are identical — "Mark it" three times names nothing')
  : bad(`duplicate accessible names: ${JSON.stringify(labels)}`);

// The link actually goes somewhere real, fragment included.
const hrefs = await actions.evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
hrefs.every((h) => h.startsWith('/landlord/'))
  ? ok('every action points at a real landlord route')
  : bad(`hrefs: ${JSON.stringify(hrefs)}`);
hrefs.some((h) => h.includes('#'))
  ? ok('and the ones that target a section carry the fragment')
  : bad(`no fragment on any action: ${JSON.stringify(hrefs)}`);

// Following one must land on the section, not 404.
const applicantAction = panel.locator('.inbox-action').filter({ hasText: /Open the application/i }).first();
if (await applicantAction.count()) {
  await applicantAction.click();
  await lp.waitForTimeout(2400);
  /\/applicants/.test(lp.url())
    ? ok('following the applicant action lands on that room’s applicants')
    : bad(`landed on ${lp.url()}`);
  const dest = (await lp.locator('body').textContent()) ?? '';
  !/404|not found/i.test(dest)
    ? ok('and the page renders rather than 404ing')
    : bad('the action led to a 404');
  await lp.goBack({ waitUntil: 'domcontentloaded' });
  await lp.waitForTimeout(2200);
} else {
  bad('no applicant action to follow');
}

// ── Accessibility, where the a11y drive cannot reach it ──────────────────
//
// a11y-drive.mjs audits a landlord with no rooms, so it sees this panel empty —
// the same data-dependent blind spot that let a heading defect survive 23 green
// pages. Checked here, where it is populated.
const lvl = await panel.locator('h2, h3').evaluateAll((els) => els.map((e) => e.tagName).join(','));
lvl === 'H2'
  ? ok('its heading is an H2, directly under the page H1')
  : bad(`heading is ${lvl}`);
const hOrder = await lp.locator('h1,h2,h3,h4').evaluateAll(
  (els) => els.filter((e) => e.offsetWidth || e.offsetHeight).map((e) => Number(e.tagName[1])),
);
const skip = hOrder.findIndex((l, i) => i > 0 && l > hOrder[i - 1] + 1);
hOrder[0] === 1 && skip === -1
  ? ok(`heading order holds with the panel populated (${hOrder.map((l) => 'H' + l).join(' → ')})`)
  : bad(`heading order broken at ${skip}: ${hOrder.map((l) => 'H' + l).join(' → ')}`);

// Urgency must not be conveyed by colour alone.
const urgentSaysSoInWords = await panel.locator('.inbox-row--urgent').evaluateAll(
  (els) => els.every((e) => /already passed|overdue|day/i.test(e.textContent ?? '')),
);
urgentSaysSoInWords
  ? ok('an urgent row says so in words, not only with a coloured edge')
  : bad('urgency is conveyed by colour alone');

// ── The "Needs you" NAV TAB, which pointed at nothing — Phase 8h ─────────
//
// ⚠️ landlordNav has had an item { label: 'Needs you', fragment:
// 'needs-attention' } since Phase 7a, and this panel renders nothing when
// nothing needs doing. Those two decisions are each defensible and together
// they made a dead control: for every landlord who was on top of their work,
// the tab pointed at an element that did not exist. Measured before the fix —
// hasAnchor false, scrollY 0 before the click and 0 after — so pressing it did
// nothing at all and left a screen identical to the one before it. Reported as
// "the needs you page looks exactly the same as the dashboard page, nothing
// happens when I click the needs you tab".
//
// The file's own comments say a nav item must not point at a destination that
// does not exist. This is the check that makes that true rather than stated.
//
// The QUIET landlord is used deliberately: the fault only exists when the
// inbox is empty, which is the state the rest of this drive sets up and then
// moves away from.
console.log('\n── The Needs you tab reaches somewhere, even when empty ────');

await qp.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
await qp.waitForTimeout(2600);

// Not merely "scrolled": scrolled TO this section. The dashboard is long
// enough that a scroll to anywhere would move the number.
const tab = qp.locator('.portal-nav-link', { hasText: 'Needs you' });
(await tab.count()) === 1
  ? ok('the sidebar offers exactly one Needs you tab')
  : bad(`${await tab.count()} Needs you tabs in the sidebar`);

const beforeTab = await qp.evaluate(() => ({
  anchor: !!document.getElementById('needs-attention'),
  y: Math.round(window.scrollY),
}));
!beforeTab.anchor
  ? ok('…and on an ordinary visit there is still no empty panel drawing the eye')
  : bad('an empty attention panel is rendered before anybody asked for it');

await tab.first().click();
await qp.waitForTimeout(1600);

const afterTab = await qp.evaluate(() => {
  const el = document.getElementById('needs-attention');
  return {
    anchor: !!el,
    y: Math.round(window.scrollY),
    top: el ? Math.round(el.getBoundingClientRect().top) : null,
    text: (el?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    fragment: location.hash,
  };
});

afterTab.anchor
  ? ok('pressing it brings the section into existence rather than doing nothing')
  : bad('the Needs you tab still points at an element that does not exist');
afterTab.top !== null && Math.abs(afterTab.top) < 80
  ? ok(`…and the page is scrolled to it (section top at ${afterTab.top}px, from scrollY ${beforeTab.y} → ${afterTab.y})`)
  : bad(`the section exists but the page did not move to it: top ${afterTab.top}, scrollY ${beforeTab.y} → ${afterTab.y}`);
/nothing is waiting on you/i.test(afterTab.text)
  ? ok('…and it says so in words, rather than being an empty heading')
  : bad(`the empty panel reads: ${afterTab.text.slice(0, 160)}`);
!/\b0\b/.test(afterTab.text)
  ? ok('…with no count of zero beside the heading')
  : bad(`a zero count is shown: ${afterTab.text.slice(0, 120)}`);

await browser.close();
console.log(fail ? `\n❌ ${fail} failure(s)` : '\n✅ the inbox leads the dashboard, every row acts, nothing skips a heading level, and the Needs you tab always lands somewhere');
process.exit(fail ? 1 : 0);
