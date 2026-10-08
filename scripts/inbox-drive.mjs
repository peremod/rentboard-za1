/**
 * "What needs my attention right now" — Phase 5a and 5d.
 *
 * ── What is worth checking about an aggregation layer
 *
 * Not that it returns rows: that it returns the RIGHT rows in the RIGHT ORDER,
 * and that it stays quiet about things it cannot know. Those are the two ways an
 * inbox fails in practice — it buries the urgent item under admin, or it invents
 * a confident figure out of two data points.
 *
 * So this builds a landlord with several competing situations at once and checks
 * the ordering between them, then checks the health paragraph refuses to quote a
 * percentage it has not earned.
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

// ── A landlord with nothing ────────────────────────────────────────────────
const empty = await apiCall(API, 'GET', '/api/landlord/inbox', undefined, T);
empty.status === 200 ? ok('the inbox answers for a landlord with no rooms') : bad(`inbox: ${empty.status} ${JSON.stringify(empty.body).slice(0, 200)}`);
(empty.body?.items ?? []).length === 0
  ? ok('and it is empty rather than inventing something to do')
  : bad(`${empty.body.items.length} items for a landlord with no rooms`);

const h0 = await apiCall(API, 'GET', '/api/landlord/health', undefined, T);
h0.body?.occupancyPct === null
  ? ok('occupancy is null, not 0% — nothing has been measured')
  : bad(`occupancyPct ${h0.body?.occupancyPct} with no rooms`);
h0.body?.paymentReliabilityPct === null
  ? ok('and so is payment reliability, rather than reading as "never pays"')
  : bad(`paymentReliabilityPct ${h0.body?.paymentReliabilityPct} with no rent recorded`);
/not posted a room yet/i.test(h0.body?.summary ?? '')
  ? ok('the paragraph says there is nothing yet, in words')
  : bad(`summary: ${h0.body?.summary}`);

// ── Fixtures: a room with a waiting applicant, and a live tenancy ──────────
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

async function applicant(roomId) {
  const tn = await registerUser(API, 'TENANT');
  const app = await apiCall(API, 'POST', '/api/applications', {
    roomId, coverNote: 'I would like this room please, I can move in at the start of the month.',
  }, tn.token);
  if (app.status >= 300) { bad(`apply: ${JSON.stringify(app.body).slice(0, 160)}`); return null; }
  return { tenant: tn, applicationId: app.body.id };
}

const roomA = await room('Inbox room with an applicant');
const roomB = await room('Inbox room that gets let');
if (!roomA || !roomB) { console.log('\n❌ fixtures failed'); process.exit(1); }

const waiting = await applicant(roomA);
const accepted = await applicant(roomB);
if (!waiting || !accepted) { console.log('\n❌ fixtures failed'); process.exit(1); }

await apiCall(API, 'POST', `/api/applications/${accepted.applicationId}/accept`, {}, T);
let tenancyId = null;
for (let i = 0; i < 20; i++) {
  const mine = await apiCall(API, 'GET', '/api/tenancies/mine', undefined, T);
  const f = (mine.body || []).find((x) => x.roomId === roomB || x.room?.id === roomB);
  if (f) { tenancyId = f.id; break; }
  await sleep(250);
}
if (!tenancyId) { bad('no tenancy appeared'); process.exit(1); }
await apiCall(API, 'POST', `/api/tenancies/${tenancyId}/confirm-start`, { startDate: iso(inDays(-40)) }, T);
ok('a waiting applicant and a live tenancy');

// ── The unanswered applicant shows up ─────────────────────────────────────
const i1 = await apiCall(API, 'GET', '/api/landlord/inbox', undefined, T);
const items1 = i1.body?.items ?? [];
items1.some((x) => x.kind === 'application_waiting')
  ? ok('the unanswered applicant is in the inbox')
  : bad(`kinds: ${JSON.stringify(items1.map((x) => x.kind))}`);
const appItem = items1.find((x) => x.kind === 'application_waiting');
// A person's name, and no id. The first version of this had ok() on BOTH
// branches, so it could not fail — the same shape of defect as a check that
// asserts its own timestamp. Kept as a comment because it took a second reading
// to notice, and it read as green the whole time.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
appItem?.title?.includes('Drive Tenant') && !UUID.test(appItem.title)
  ? ok('named by person, with no id in the sentence')
  : bad(`title does not name the applicant, or leaks an id: ${appItem?.title}`);
appItem?.actionPath?.includes(`/rooms/${roomA}/applicants`)
  ? ok('and the row carries where to go, rather than the template guessing')
  : bad(`actionPath: ${appItem?.actionPath}`);
/waiting to hear from you/i.test(appItem?.title ?? '')
  ? ok('in plain English, with no enum in it')
  : bad(`title: ${appItem?.title}`);

// Rent for this month is unrecorded, so that should appear too.
items1.some((x) => x.kind === 'rent_unmarked')
  ? ok('unrecorded rent for the live tenancy is also listed')
  : bad(`no rent_unmarked among: ${JSON.stringify(items1.map((x) => x.kind))}`);

// ── Ordering: a dispute must outrank rent admin, which must outrank nothing ─
//
// The point of the list is that the top of it is the right thing to do first.
await apiCall(API, 'PATCH', `/api/tenancies/${tenancyId}/lease`, { leaseEndDate: iso(inDays(10)) }, T);
const i2 = await apiCall(API, 'GET', '/api/landlord/inbox', undefined, T);
const kinds2 = (i2.body?.items ?? []).map((x) => x.kind);
kinds2.includes('lease_ending')
  ? ok('a lease ending in 10 days joins the list')
  : bad(`kinds: ${JSON.stringify(kinds2)}`);
kinds2.indexOf('lease_ending') < kinds2.indexOf('rent_unmarked')
  ? ok('and it sorts above rent admin, which has no deadline')
  : bad(`order puts rent admin first: ${JSON.stringify(kinds2)}`);

// A tenant disputing the record should go straight to the top.
// ⚠️ `.periods`. The endpoint answers `{ tenancy, periods }`, and indexing
// the envelope yields undefined — which made the `if (period)` block below
// skip the tenant-dispute checks entirely, with no bad() and a green run. A
// check that cannot fail is not a check.
const periods = await apiCall(API, 'GET', `/api/properties/rent/${tenancyId}`, undefined, T);
const thisMonth = (periods.body?.periods ?? [])[0];
if (!thisMonth) {
  // No period row yet — mark one so there is something to dispute.
  const mk = await apiCall(API, 'PATCH', `/api/properties/rent/${tenancyId}/mark`,
    { periodStart: iso(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))), status: 'unpaid' }, T);
  if (mk.status >= 300) bad(`could not mark rent: ${mk.status} ${JSON.stringify(mk.body).slice(0, 160)}`);
}
const periods2 = await apiCall(API, 'GET', `/api/properties/rent/${tenancyId}`, undefined, T);
const period = (periods2.body?.periods ?? [])[0];
// Say so rather than skipping. The silent `if (period)` is what let this
// section pass while testing nothing.
if (!period) bad(`no rent period to dispute: ${JSON.stringify(periods2.body).slice(0, 200)}`);
if (period) {
  const dis = await apiCall(API, 'PATCH', `/api/properties/rent/period/${period.id}/dispute`,
    { note: 'paid on the 3rd by EFT' }, accepted.tenant.token);
  dis.status === 200 ? ok('the tenant disputes the month') : bad(`dispute: ${dis.status} ${JSON.stringify(dis.body).slice(0, 160)}`);

  const i3 = await apiCall(API, 'GET', '/api/landlord/inbox', undefined, T);
  const items3 = i3.body?.items ?? [];
  items3[0]?.kind === 'rent_disputed'
    ? ok('and it goes straight to the top of the list')
    : bad(`top item is ${items3[0]?.kind}: ${JSON.stringify(items3.map((x) => x.kind))}`);
  /says they have paid/i.test(items3[0]?.title ?? '')
    ? ok('worded as what the tenant said, not as a verdict')
    : bad(`title: ${items3[0]?.title}`);
  items3[0]?.detail?.includes('paid on the 3rd')
    ? ok('and their own words are carried through')
    : bad(`detail: ${items3[0]?.detail}`);
  // The disputed month must NOT also appear as unmarked — one situation, one row.
  items3.filter((x) => x.entityId === tenancyId && (x.kind === 'rent_unmarked' || x.kind === 'rent_disputed')).length === 1
    ? ok('the same month is not listed twice')
    : bad('the disputed month also appears as unmarked');
}

// ── Counts match the list ────────────────────────────────────────────────
const i4 = await apiCall(API, 'GET', '/api/landlord/inbox', undefined, T);
const items4 = i4.body?.items ?? [];
const counts4 = i4.body?.counts ?? {};
Object.entries(counts4).every(([k, n]) => items4.filter((x) => x.kind === k).length === n)
  ? ok('the per-kind counts agree with the list they describe')
  : bad(`counts ${JSON.stringify(counts4)} vs ${JSON.stringify(items4.map((x) => x.kind))}`);

// ── Health: honest about small numbers ───────────────────────────────────
const h1 = await apiCall(API, 'GET', '/api/landlord/health', undefined, T);
const h = h1.body ?? {};
h.rooms?.total === 2 ? ok('health counts both rooms') : bad(`rooms: ${JSON.stringify(h.rooms)}`);
h.paymentReliabilityPct === null
  ? ok('one month recorded is not enough for a reliability figure')
  : bad(`quoted ${h.paymentReliabilityPct}% from ${h.paymentReliabilityFrom} month(s)`);
typeof h.paymentReliabilityFrom === 'number'
  ? ok(`and it says what it would be from (${h.paymentReliabilityFrom})`)
  : bad('no denominator reported');
!/\d+%/.test(h.summary ?? '') || h.paymentReliabilityPct !== null
  ? ok('the paragraph quotes no percentage it has not earned')
  : bad(`summary has a % with nothing behind it: ${h.summary}`);
/room/i.test(h.summary ?? '') && h.summary.length > 30
  ? ok('and reads as a sentence rather than a row of figures')
  : bad(`summary: ${h.summary}`);

// ── Nobody else's inbox ─────────────────────────────────────────────────
const other = await registerUser(API, 'LANDLORD');
const iOther = await apiCall(API, 'GET', '/api/landlord/inbox', undefined, other.token);
(iOther.body?.items ?? []).length === 0
  ? ok('another landlord sees none of it')
  : bad(`leaked ${iOther.body.items.length} items to another landlord`);
const tn = await registerUser(API, 'TENANT');
const iTenant = await apiCall(API, 'GET', '/api/landlord/inbox', undefined, tn.token);
iTenant.status === 403 ? ok('and a tenant cannot open it at all') : bad(`tenant got ${iTenant.status}`);

console.log(fail ? `\n❌ ${fail} failure(s)` : '\n✅ the inbox lists the right things in the right order, and the health card admits what it cannot know');
process.exit(fail ? 1 : 0);
