/**
 * Private tenant notes and the shared calendar — Phase 5e and 5f.
 *
 * ── What is worth checking about a private note
 *
 * Not that it saves. That NOBODY ELSE can read it, and that it cannot be written
 * about a stranger. A note store where either of those fails is not a memory aid,
 * it is an unregulated reference that follows a person around — which is the
 * thing Phase 1 rejected the bureau credit check in order to avoid.
 *
 * So: another landlord, the tenant themselves, and an admin token are all tried
 * against the same note. And a note about someone the landlord has never dealt
 * with must be refused, because otherwise the endpoint is a way to keep a file on
 * any account id you can guess.
 *
 * ── And about the calendar
 *
 * That its dates are DAYS in UTC. "Rent is due on the 1st" rendered as an instant
 * shows a South African landlord the 31st, and that bug is invisible until
 * somebody complains about a date being wrong by one.
 *
 * Needs the API on :3000.
 */
import { registerUser, apiCall } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const iso = (d) => d.toISOString().slice(0, 10);
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ll = await registerUser(API, 'LANDLORD');
const T = ll.token;
const other = await registerUser(API, 'LANDLORD');

const adm = await apiCall(API, 'POST', '/api/auth/login', {
  email: 'ci-admin@mastande.test', password: 'CiSmokeAdmin123',
});
const AT = adm.body?.accessToken ?? adm.body?.access_token;

async function room(title) {
  const r = await apiCall(API, 'POST', '/api/rooms', {
    roomType: 'shared_house', title, rentCents: 250000, province: 'Gauteng',
    city: 'Johannesburg', locationDisplay: 'Soweto', availableFrom: iso(inDays(1)),
    housematesCount: 2, billsIncluded: true,
    description: 'A clean single room in a quiet Soweto yard with a shared kitchen, an outside tap and a gate locked at night.',
  }, T);
  if (r.status >= 300) { bad(`room: ${JSON.stringify(r.body).slice(0, 160)}`); return null; }
  await apiCall(API, 'PATCH', `/api/rooms/${r.body.id}/photos`, { paths: ['rooms/demo/cover.jpg'] }, T);
  await apiCall(API, 'POST', `/api/rooms/${r.body.id}/publish`, {}, T);
  return r.body.id;
}

const roomId = await room('Notes drive room one');
if (!roomId) { console.log('\n❌ fixtures failed'); process.exit(1); }

// Somebody who applied — so the landlord has dealt with them.
const applicant = await registerUser(API, 'TENANT');
const app = await apiCall(API, 'POST', '/api/applications', {
  roomId, coverNote: 'I would like this room please, I can move in at the start of the month.',
}, applicant.token);
app.status === 201 ? ok('an applicant to note about') : bad(`apply: ${app.status}`);

// And a complete stranger the landlord has never dealt with.
const stranger = await registerUser(API, 'TENANT');

// ── A note can only be written about someone you have dealt with ──────────
const aboutStranger = await apiCall(API, 'POST', `/api/landlord/notes/tenant/${stranger.id}`,
  { body: 'I have never met this person.' }, T);
aboutStranger.status === 403
  ? ok('a note about a stranger is refused — this is not a way to file on any id')
  : bad(`note about a stranger got ${aboutStranger.status}`);

const write = await apiCall(API, 'POST', `/api/landlord/notes/tenant/${applicant.id}`,
  { body: 'Phoned twice about the gate. Polite, asked good questions.' }, T);
write.status === 201 || write.status === 200
  ? ok('a note about their own applicant is written')
  : bad(`write: ${write.status} ${JSON.stringify(write.body).slice(0, 200)}`);
const noteId = write.body?.id;

// ── Nobody else can read it. Not another landlord, not the tenant, not an admin ─
const asOther = await apiCall(API, 'GET', `/api/landlord/notes/tenant/${applicant.id}`, undefined, other.token);
(asOther.body ?? []).length === 0
  ? ok('another landlord sees none of it')
  : bad(`leaked ${asOther.body.length} note(s) to another landlord`);

const asTenant = await apiCall(API, 'GET', `/api/landlord/notes/tenant/${applicant.id}`, undefined, applicant.token);
asTenant.status === 403
  ? ok('the tenant cannot read notes about themselves through the API')
  : bad(`tenant got ${asTenant.status} — POPIA access is the admin-assisted path, not self-service`);

if (AT) {
  // An admin DOES pass LandlordGuard — it admits ADMIN as well as LANDLORD — so
  // what protects the note is the query, which scopes on the caller's own id.
  // That is the property to assert: no DATA, whatever the status code.
  //
  // The first version of this checked for a 403 and failed on a 200 with an
  // empty body. That was testing the mechanism rather than the outcome, and it
  // would also have broken the day somebody legitimately changed the guard.
  //
  // Checked against a marker string rather than an empty array, because an empty
  // array can be empty for the wrong reason.
  const adminPerTenant = await apiCall(API, 'GET', `/api/landlord/notes/tenant/${applicant.id}`, undefined, AT);
  const adminAll = await apiCall(API, 'GET', '/api/landlord/notes', undefined, AT);
  const seen = JSON.stringify(adminPerTenant.body) + JSON.stringify(adminAll.body);
  !seen.includes('Polite') && !seen.includes('gate')
    ? ok('an admin gets no notes — the query scopes to the author, not the guard')
    : bad(`an admin read private notes: ${seen.slice(0, 200)}`);
} else {
  bad('no admin token — run npm run db:seed with ADMIN_EMAIL/ADMIN_PASSWORD');
}

const mine = await apiCall(API, 'GET', `/api/landlord/notes/tenant/${applicant.id}`, undefined, T);
(mine.body ?? []).length === 1
  ? ok('but the author reads their own')
  : bad(`author saw ${(mine.body ?? []).length}`);
mine.body?.[0]?.body?.includes('Polite')
  ? ok('with their own words intact')
  : bad(`body: ${JSON.stringify(mine.body?.[0]?.body)}`);

// No score, no rating, nothing structured — this must never become a shadow
// credit score assembled from opinions.
const noteKeys = Object.keys(mine.body?.[0] ?? {});
!noteKeys.some((k) => /rating|score|stars|flag|recommend/i.test(k))
  ? ok('and nothing on it is a score or a rating')
  : bad(`a structured judgement leaked onto the model: ${noteKeys.join(', ')}`);

// ── Editing and deleting is the author's alone ───────────────────────────
const editByOther = await apiCall(API, 'PATCH', `/api/landlord/notes/${noteId}`, { body: 'hijacked' }, other.token);
editByOther.status === 404
  ? ok('another landlord editing it gets 404, not 403 — no confirmation it exists')
  : bad(`other landlord edit got ${editByOther.status}`);
const stillMine = await apiCall(API, 'GET', `/api/landlord/notes/tenant/${applicant.id}`, undefined, T);
!stillMine.body?.[0]?.body?.includes('hijacked')
  ? ok('and the note is untouched')
  : bad('another landlord edited the note');

const edit = await apiCall(API, 'PATCH', `/api/landlord/notes/${noteId}`, { body: 'Moved in on the 1st. No trouble.' }, T);
edit.status === 200 ? ok('the author can edit it') : bad(`edit: ${edit.status}`);

// ── The grouped "all my notes" view ─────────────────────────────────────
const all = await apiCall(API, 'GET', '/api/landlord/notes', undefined, T);
all.status === 200 ? ok('the grouped view answers') : bad(`all notes: ${all.status}`);
(all.body ?? []).length === 1 && all.body[0].notes.length === 1
  ? ok('one card per person, with their notes under it')
  : bad(`grouping: ${JSON.stringify((all.body ?? []).map((g) => ({ t: g.tenantName, n: g.notes.length })))}`);
all.body?.[0]?.tenantName
  ? ok('naming the person, so the list is navigable')
  : bad('no tenant name in the grouped view');

const delByOther = await apiCall(API, 'DELETE', `/api/landlord/notes/${noteId}`, undefined, other.token);
delByOther.status === 404 ? ok('another landlord cannot delete it') : bad(`other delete got ${delByOther.status}`);
const del = await apiCall(API, 'DELETE', `/api/landlord/notes/${noteId}`, undefined, T);
del.status === 200 ? ok('the author can') : bad(`delete: ${del.status}`);

// ── The calendar ───────────────────────────────────────────────────────
const cal0 = await apiCall(API, 'GET', '/api/landlord/calendar', undefined, T);
cal0.status === 200 ? ok('the calendar answers') : bad(`calendar: ${cal0.status} ${JSON.stringify(cal0.body).slice(0, 200)}`);
(cal0.body ?? []).length === 0
  ? ok('and is empty with no live tenancy — no invented rent dates')
  : bad(`${cal0.body.length} entries with no tenancy`);

// A live tenancy generates rent dates.
await apiCall(API, 'POST', `/api/applications/${app.body.id}/accept`, {}, T);
let tenancyId = null;
for (let i = 0; i < 20; i++) {
  const m = await apiCall(API, 'GET', '/api/tenancies/mine', undefined, T);
  const f = (m.body || []).find((x) => x.roomId === roomId || x.room?.id === roomId);
  if (f) { tenancyId = f.id; break; }
  await sleep(250);
}
if (!tenancyId) { bad('no tenancy appeared'); process.exit(1); }
await apiCall(API, 'POST', `/api/tenancies/${tenancyId}/confirm-start`, { startDate: iso(inDays(-40)) }, T);

const cal1 = await apiCall(API, 'GET', '/api/landlord/calendar', undefined, T);
const entries = cal1.body ?? [];
entries.some((e) => e.kind === 'rent_due')
  ? ok('a live tenancy generates rent due dates')
  : bad(`kinds: ${JSON.stringify(entries.map((e) => e.kind))}`);

// Every date must be a plain day, in UTC, and every rent date the 1st.
const allDays = entries.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
allDays ? ok('every date is a plain YYYY-MM-DD, not a timestamp') : bad(`a date is not a day: ${JSON.stringify(entries.map((e) => e.date).slice(0, 4))}`);
const rentDays = entries.filter((e) => e.kind === 'rent_due').map((e) => e.date.slice(8));
rentDays.length && rentDays.every((d) => d === '01')
  ? ok(`and every rent date is the 1st (${rentDays.length} of them)`)
  : bad(`rent dates are not all the 1st: ${JSON.stringify([...new Set(rentDays)])}`);

// Rent entries must say we do not collect it — a calendar entry that looks like
// a bill is exactly where someone would assume otherwise.
entries.filter((e) => e.kind === 'rent_due').every((e) => /does not collect/i.test(e.detail ?? ''))
  ? ok('and says outright that Mastande does not collect it')
  : bad('a rent entry does not disclaim collection');

// A lease ending adds its own entries, including the day the room frees up.
await apiCall(API, 'PATCH', `/api/tenancies/${tenancyId}/lease`, { leaseEndDate: iso(inDays(21)) }, T);
const cal2 = await apiCall(API, 'GET', '/api/landlord/calendar', undefined, T);
const kinds2 = (cal2.body ?? []).map((e) => e.kind);
kinds2.includes('lease_ends') ? ok('a lease ending appears') : bad(`no lease_ends: ${JSON.stringify([...new Set(kinds2)])}`);
kinds2.includes('room_free')
  ? ok('and the day the room is free to relist, as its own entry')
  : bad('no room_free entry');

// Sorted, soonest first — a calendar out of order is worse than no calendar.
const dates = (cal2.body ?? []).map((e) => e.date);
JSON.stringify(dates) === JSON.stringify([...dates].sort())
  ? ok('the whole list is in date order')
  : bad('the calendar is not sorted');

// No inspection category invented, since no inspection model exists.
!kinds2.includes('inspection')
  ? ok('and no inspection category is invented — there is no inspection model')
  : bad('an inspection category exists with nothing behind it');

// Nobody else's calendar.
const calOther = await apiCall(API, 'GET', '/api/landlord/calendar', undefined, other.token);
(calOther.body ?? []).length === 0
  ? ok('another landlord sees none of it')
  : bad(`leaked ${calOther.body.length} entries`);
const calTenant = await apiCall(API, 'GET', '/api/landlord/calendar', undefined, applicant.token);
calTenant.status === 403 ? ok('and a tenant cannot open it') : bad(`tenant got ${calTenant.status}`);

// ── On screen ─────────────────────────────────────────────────────────────
//
// The copy is the assertion here. A note field beside an applicant's name with no
// explanation reads like a review — something the platform collects and might act
// on. A landlord who believes that writes differently, or writes nothing useful.
const { chromium } = await import('@playwright/test');
const { signIn, PASSWORD } = await import('./lib/drive-session.mjs');
const browser = await chromium.launch();
const lp = await signIn(browser, 'http://localhost:4200', ll.email, PASSWORD);

await lp.goto(`http://localhost:4200/landlord/rooms/${roomId}/applicants`, { waitUntil: 'domcontentloaded' });
await lp.waitForTimeout(2600);
// Open the applicant card, then the notes block inside it.
const header = lp.locator('.applicant-card__header').first();
if (await header.count()) {
  await header.click();
  await lp.waitForTimeout(900);
  const toggle = lp.getByRole('button', { name: /private notes about/i }).first();
  (await toggle.count())
    ? ok('the notes toggle names whose notes they are')
    : bad('no notes toggle on the applicant card');
  if (await toggle.count()) {
    await toggle.click();
    await lp.waitForTimeout(700);
    const block = (await lp.locator('.notes-block').first().textContent()) ?? '';
    /Only you can see these/i.test(block)
      ? ok('and says outright that only the author can see them')
      : bad(`no privacy line: ${block.replace(/\s+/g, ' ').slice(0, 160)}`);
    /cannot|neither can/i.test(block)
      ? ok('naming the tenant as someone who cannot')
      : bad('does not say the tenant cannot see it');
    /not a rating/i.test(block)
      ? ok('and that it is not a rating')
      : bad('nothing says it is not a rating');
  }
} else {
  bad('no applicant card to open');
}

await lp.goto('http://localhost:4200/landlord/dashboard', { waitUntil: 'domcontentloaded' });
await lp.waitForTimeout(2800);
(await lp.locator('#calendar').count())
  ? ok('the calendar is on the dashboard')
  : bad('no calendar section on the dashboard');
const cal = (await lp.locator('#calendar').textContent()) ?? '';
/Rent due/i.test(cal) ? ok('showing rent dates') : bad(`calendar text: ${cal.replace(/\s+/g, ' ').slice(0, 160)}`);
/does not collect/i.test(cal)
  ? ok('with the line saying Mastande does not collect it')
  : bad('the calendar does not disclaim rent collection');
// Heading order, with the calendar's own month sub-headings in place.
const hOrder = await lp.locator('h1,h2,h3,h4').evaluateAll(
  (els) => els.filter((e) => e.offsetWidth || e.offsetHeight).map((e) => Number(e.tagName[1])),
);
const skip = hOrder.findIndex((l, i) => i > 0 && l > hOrder[i - 1] + 1);
hOrder[0] === 1 && skip === -1
  ? ok(`heading order holds with month sub-headings (${hOrder.map((l) => 'H' + l).join(' → ')})`)
  : bad(`heading order broken at ${skip}: ${hOrder.map((l) => 'H' + l).join(' → ')}`);
await browser.close();

console.log(fail ? `\n❌ ${fail} failure(s)` : '\n✅ notes are private to their author, cannot be written about a stranger, and the calendar deals in days rather than instants');
process.exit(fail ? 1 : 0);
