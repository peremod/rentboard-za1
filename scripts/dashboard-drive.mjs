/**
 * The dashboard's numbers, and the two inboxes behind them — Phase 7d.
 *
 * ── What is worth checking here
 *
 * Not that a dashboard loads. Four things, three of which were wrong:
 *
 *   1. **"Viewed 47 times this week" was not implementable.** `rooms.viewCount`
 *      is a single lifetime integer, so a room posted in June could show 200
 *      views without one of them being this month — the UX spec had the right
 *      sentence and no data under it. `room_view_days` is new, and what is
 *      checked here is that it counts the right things: a visitor yes, the
 *      landlord's own look no, and one row per day rather than per view.
 *   2. **The landlord task inbox's action buttons went nowhere.** Each row's
 *      destination is a string from the API, and they said
 *      `/landlord/yard#money` — a path Phase 7b turned into a redirect, which
 *      drops the fragment. "Mark it" landed a landlord on a list of addresses.
 *      scripts/nav-audit.mjs now resolves these statically; this checks the
 *      value the API actually emits for a room with a property and without one.
 *   3. **The tenant had no "what needs my attention" list at all.** New
 *      endpoint, and the checks are about what it deliberately leaves OUT as
 *      much as what it includes.
 *   4. **Rent reminders.** The one control whose own code comment records that
 *      it was built because the API had no screen. Phase 7b left it on a screen
 *      with no route, so it was unreachable again; this checks the data it
 *      needs is round-tripping.
 *
 * Needs the API on :3000 and a DATABASE_URL.
 */
import { registerUser, apiCall, dbQuery as q } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const S = Math.floor(Math.random() * 1e6);

const landlord = await registerUser(API, 'LANDLORD');
const loose = await registerUser(API, 'LANDLORD');   // never groups anything
const tenantA = await registerUser(API, 'TENANT');
const tenantB = await registerUser(API, 'TENANT');
const L = landlord.token;

const mkRoom = async (title, token, extra = {}) => {
  const res = await apiCall(API, 'POST', '/api/rooms', {
    roomType: 'shared_house', title,
    description: 'A clean room in a shared house, close to transport and the shops. Available now.',
    rentCents: 295000, province: 'Gauteng', city: 'Johannesburg',
    locationDisplay: 'Tembisa, Johannesburg',
    availableFrom: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
    ...extra,
  }, token);
  if (res.status !== 201) throw new Error(`room ${title}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${res.body.id}'`);
  return res.body.id;
};

const propA = await apiCall(API, 'POST', '/api/properties',
  { name: `Ext 7 back rooms ${S}`, suburb: 'Tembisa', city: 'Johannesburg', province: 'Gauteng' }, L);
const roomGrouped = await mkRoom(`Grouped room ${S}`, L, { propertyId: propA.body.id });
const roomLoose = await mkRoom(`Loose room ${S}`, L);

console.log('\n── 1. Views, by day, and only other people’s ──────────────');

const rooms = async (token = L) => (await apiCall(API, 'GET', '/api/rooms/my-rooms', null, token)).body;
const weekViews = async (id, token = L) =>
  ((await rooms(token)) ?? []).find((r) => r.id === id)?.viewsLast7Days;

(await weekViews(roomGrouped)) === 0
  ? ok('a brand-new room reports 0 views this week — a number, not a missing field')
  : bad(`viewsLast7Days on a new room is ${JSON.stringify(await weekViews(roomGrouped))}, expected 0`);

/**
 * ⚠️ The landlord's own look is checked FIRST and asserted, not assumed.
 *
 * If it were counted, every later check here would still pass — the counts
 * would simply all be one higher and nothing would say which view did it. A
 * landlord refreshing their own listing to see how it looks must not be
 * reported back to them as interest.
 */
await apiCall(API, 'GET', `/api/rooms/${roomGrouped}`, null, L);
await new Promise((r) => setTimeout(r, 400));
(await weekViews(roomGrouped)) === 0
  ? ok('…and the landlord opening their OWN room does not count as a view')
  : bad('a landlord looking at their own listing was counted as interest in it');

await apiCall(API, 'GET', `/api/rooms/${roomGrouped}`, null, tenantA.token);
await new Promise((r) => setTimeout(r, 400));
(await weekViews(roomGrouped)) === 1
  ? ok('somebody else opening it counts as one')
  : bad(`after one visitor, viewsLast7Days is ${JSON.stringify(await weekViews(roomGrouped))}`);

await apiCall(API, 'GET', `/api/rooms/${roomGrouped}`, null, tenantB.token);
await apiCall(API, 'GET', `/api/rooms/${roomGrouped}`, null, null);
await new Promise((r) => setTimeout(r, 500));
(await weekViews(roomGrouped)) === 3
  ? ok('…and a signed-out visitor counts too — three views from three looks')
  : bad(`after three visits, viewsLast7Days is ${JSON.stringify(await weekViews(roomGrouped))}`);

const dayRows = q(`SELECT COUNT(*) FROM room_view_days WHERE "roomId" = '${roomGrouped}'`);
dayRows === '1'
  ? ok('…stored as ONE row for today with a counter, not a row per view')
  : bad(`room_view_days has ${dayRows} row(s) for one day of views`);

const lifetime = q(`SELECT "viewCount" FROM rooms WHERE id = '${roomGrouped}'`);
lifetime === '3'
  ? ok('…and the lifetime counter still works, so nothing that reads it broke')
  : bad(`rooms.viewCount is ${lifetime}, expected 3`);

/**
 * The window is what makes the sentence true. A view dated eight days ago must
 * fall out of "this week" — written straight into the table, because waiting a
 * week is not a test strategy.
 */
q(`INSERT INTO room_view_days ("roomId", day, count) VALUES ('${roomGrouped}', (now() - interval '8 days')::date, 50)`);
(await weekViews(roomGrouped)) === 3
  ? ok('a view from eight days ago is NOT in "this week" — the window is real')
  : bad(`a view 8 days old leaked into the weekly figure: ${JSON.stringify(await weekViews(roomGrouped))}`);

q(`INSERT INTO room_view_days ("roomId", day, count) VALUES ('${roomGrouped}', (now() - interval '5 days')::date, 7)`);
(await weekViews(roomGrouped)) === 10
  ? ok('…and one from five days ago IS, so the window is seven days and not one')
  : bad(`a view 5 days old was excluded: ${JSON.stringify(await weekViews(roomGrouped))}`);

const otherRoom = (await rooms()).find((r) => r.id === roomLoose);
otherRoom?.viewsLast7Days === 0
  ? ok('one room’s views are not another’s')
  : bad(`the unviewed room reports ${JSON.stringify(otherRoom?.viewsLast7Days)} views`);

console.log('\n── 2. The landlord task inbox lands somewhere real ─────────');

// A tenancy on each room, so both a grouped and an ungrouped rent item exist.
const tenancyFor = async (roomId, tenant) => {
  const app = await apiCall(API, 'POST', '/api/applications', { roomId, coverNote: 'I can move in on the first.' }, tenant.token);
  if (app.status !== 201) throw new Error(`apply: ${app.status} ${JSON.stringify(app.body).slice(0, 160)}`);
  const acc = await apiCall(API, 'POST', `/api/applications/${app.body.id}/accept`, {}, L);
  if (acc.status >= 300) throw new Error(`accept: ${acc.status} ${JSON.stringify(acc.body).slice(0, 160)}`);
  // Poll: accept() opens the tenancy fire-and-forget
  // (`createFromApplication(...).catch(...)`, not awaited), so reading it once
  // can return ''. See tenancy-lifecycle-drive's tenancyFor.
  let id = '';
  for (let i = 0; i < 40 && !id; i++) {
    id = q(`SELECT id FROM tenancies WHERE "applicationId" = '${app.body.id}'`);
    if (!id) await new Promise((r) => setTimeout(r, 250));
  }
  if (!id) throw new Error(`no tenancy opened for application ${app.body.id}`);
  // startDate too — see account-lifecycle-drive: an 'active' tenancy with no
  // startDate cannot be produced through the API, and the rent window refuses
  // marks against one.
  q(`UPDATE tenancies SET status='active', "startDate"=now() WHERE id = '${id}'`);
  return { applicationId: app.body.id, tenancyId: id };
};

const groupedTenancy = await tenancyFor(roomGrouped, tenantA);
const looseTenancy = await tenancyFor(roomLoose, tenantB);

const inbox = await apiCall(API, 'GET', '/api/landlord/inbox', null, L);
inbox.status === 200
  ? ok('the landlord task inbox answers')
  : bad(`landlord-inbox returned ${inbox.status} ${JSON.stringify(inbox.body).slice(0, 160)}`);

const rentRows = (inbox.body?.items ?? []).filter((i) => i.kind === 'rent_unmarked');
rentRows.length === 2
  ? ok('…with an unrecorded month for each of the two tenancies')
  : bad(`expected 2 rent items, got ${rentRows.length}: ${JSON.stringify((inbox.body?.items ?? []).map((i) => i.kind))}`);

const groupedRow = rentRows.find((i) => i.entityId === groupedTenancy.tenancyId);
groupedRow?.actionPath === `/landlord/properties/${propA.body.id}#money`
  ? ok('…and a grouped room’s button points at THAT property’s money section')
  : bad(`grouped rent item points at ${JSON.stringify(groupedRow?.actionPath)}`);

const looseRow = rentRows.find((i) => i.entityId === looseTenancy.tenancyId);
looseRow?.actionPath === '/landlord/properties/ungrouped#money'
  ? ok('…while a room in no property points at the ungrouped view, not at nothing')
  : bad(`ungrouped rent item points at ${JSON.stringify(looseRow?.actionPath)}`);

!(inbox.body?.items ?? []).some((i) => i.actionPath.startsWith('/landlord/yard'))
  ? ok('nothing still points at /landlord/yard, which has been a redirect since v1.87.0')
  : bad('a task button still points at /landlord/yard — a redirect, which drops the fragment');

console.log('\n── 3. Rent reminders: the data the control needs ───────────');

const setGrace = await apiCall(API, 'PATCH', '/api/properties/rent/settings', { rentGraceDays: 0 }, L);
setGrace.status === 200
  ? ok('reminders can be turned off (0 days)')
  : bad(`setting grace days returned ${setGrace.status} ${JSON.stringify(setGrace.body).slice(0, 160)}`);

const dash = await apiCall(API, 'GET', '/api/properties/dashboard', null, L);
dash.body?.rentGraceDays === 0
  ? ok('…and the dashboard reports what is actually set, so the box cannot show a default over a real 0')
  : bad(`dashboard reports rentGraceDays ${JSON.stringify(dash.body?.rentGraceDays)} after setting 0`);

await apiCall(API, 'PATCH', '/api/properties/rent/settings', { rentGraceDays: 5 }, L);
((await apiCall(API, 'GET', '/api/properties/dashboard', null, L)).body?.rentGraceDays) === 5
  ? ok('…and a real value round-trips')
  : bad('grace days did not round-trip');

dash.body?.ungrouped?.rooms?.length >= 1
  ? ok('the dashboard carries the ungrouped rooms, which is what /properties/ungrouped renders')
  : bad(`the dashboard has no ungrouped group: ${JSON.stringify(dash.body?.ungrouped)}`);

console.log('\n── 4. The tenant task inbox ────────────────────────────────');

const quiet = await registerUser(API, 'TENANT');
const empty = await apiCall(API, 'GET', '/api/tenant-inbox', null, quiet.token);
empty.status === 200 && (empty.body?.items ?? []).length === 0
  ? ok('a tenant with nothing to do gets an empty list, not an error and not filler')
  : bad(`a fresh tenant's inbox returned ${empty.status} with ${JSON.stringify(empty.body?.items?.length)} item(s)`);

/**
 * ⚠️ TWO tenants, because one cannot be in both states.
 *
 * This block asked tenantA's inbox for `application_accepted` AND
 * `rent_unrecorded`, and those are mutually exclusive by construction:
 * `tenant-inbox.service.ts` drops the acceptance row for any tenancy that is
 * not `pending` ("a list called 'needs you' that leads with something needing
 * nothing is a list people stop reading"), while a rent item needs a tenancy
 * that has started. tenantA's tenancy is forced `active` above so the rent
 * items exist, so the acceptance row was never going to be there.
 *
 * Both assertions were right about the product and wrong about the fixture —
 * it asked one tenant to be mid-move-in and already living there. So the
 * acceptance rule gets a letting of its own, left PENDING, which is the state
 * the rule is actually about.
 */
const roomPending = await mkRoom(`Pending room ${S}`, L);
const tenantC = await registerUser(API, 'TENANT');
{
  const app = await apiCall(API, 'POST', '/api/applications',
    { roomId: roomPending, coverNote: 'I can move in on the first.' }, tenantC.token);
  if (app.status !== 201) throw new Error(`apply: ${app.status} ${JSON.stringify(app.body).slice(0, 160)}`);
  const acc = await apiCall(API, 'POST', `/api/applications/${app.body.id}/accept`, {}, L);
  if (acc.status >= 300) throw new Error(`accept: ${acc.status} ${JSON.stringify(acc.body).slice(0, 160)}`);
  // Deliberately NOT confirmed: `pending` is the whole point.
  for (let i = 0; i < 40; i++) {
    if (q(`SELECT id FROM tenancies WHERE "applicationId" = '${app.body.id}'`)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
}

const pInbox = await apiCall(API, 'GET', '/api/tenant-inbox', null, tenantC.token);
const pKinds = (pInbox.body?.items ?? []).map((i) => i.kind);
pKinds.includes('application_accepted')
  ? ok('an accepted application nobody has confirmed is the tenant’s to answer, and it is in the list')
  : bad(`no acceptance in the inbox of a tenant mid-move-in: ${JSON.stringify(pKinds)}`);

pKinds[0] === 'application_accepted'
  ? ok('…ranked first, because a day of silence there can cost somebody the room')
  : bad(`the first item is ${pKinds[0]}, not the acceptance`);

const tInbox = await apiCall(API, 'GET', '/api/tenant-inbox', null, tenantA.token);
const kinds = (tInbox.body?.items ?? []).map((i) => i.kind);
// And once they have moved in it is GONE — the row survives its own answer
// otherwise, which is the defect OUTSTANDING §23 was written for.
!kinds.includes('application_accepted')
  ? ok('…and once the move is confirmed the acceptance row is gone, not still asking')
  : bad(`a tenant who has moved in is still being told they were accepted: ${JSON.stringify(kinds)}`);

kinds.includes('rent_unrecorded')
  ? ok('…while a month their landlord has not recorded is in its place')
  : bad(`no rent item in the tenant's inbox: ${JSON.stringify(kinds)}`);

const rentItem = (tInbox.body?.items ?? []).find((i) => i.kind === 'rent_unrecorded');
!/you have not paid|in arrears|overdue/i.test(`${rentItem?.title} ${rentItem?.detail}`)
  ? ok('…worded as "your landlord has not recorded it", never as "you have not paid"')
  : bad(`the rent item accuses the tenant: "${rentItem?.title}" / "${rentItem?.detail}"`);

// A dispute is the landlord's to answer. It must leave this list.
/**
 * A rent period only exists once the landlord marks the month — the row is
 * created on first use, not on a schedule, which is why the inbox's rent item
 * says "not recorded" rather than "unpaid" when there is no row at all.
 *
 * Asserted rather than assumed: the first version of this read straight from
 * the table, found nothing, and the dispute check reported a failure about the
 * product when the setup had simply not happened.
 */
const marked = await apiCall(API, 'PATCH', `/api/properties/rent/${groupedTenancy.tenancyId}/mark`,
  { status: 'unpaid', periodStart: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString() }, L);
marked.status < 300
  ? ok('the landlord records this month as unpaid')
  : bad(`marking rent returned ${marked.status} ${JSON.stringify(marked.body).slice(0, 160)}`);
const disputeTarget = q(`SELECT id FROM rent_periods WHERE "tenancyId" = '${groupedTenancy.tenancyId}' ORDER BY "periodStart" DESC LIMIT 1`);
if (!disputeTarget) {
  bad('no rent period to dispute — the next check would prove nothing');
} else {
  const disp = await apiCall(API, 'PATCH', `/api/properties/rent/period/${disputeTarget}/dispute`, { note: 'Paid in cash on the 1st.' }, tenantA.token);
  disp.status < 300
    ? ok('the tenant says they have paid')
    : bad(`dispute returned ${disp.status} ${JSON.stringify(disp.body).slice(0, 160)}`);

  const after = await apiCall(API, 'GET', '/api/tenant-inbox', null, tenantA.token);
  !(after.body?.items ?? []).some((i) => i.kind === 'rent_unrecorded')
    ? ok('…and the month leaves their list, because it is the landlord’s to answer now')
    : bad('a month the tenant has already disputed is still listed as needing them');
}

// Messages.
await apiCall(API, 'POST', `/api/applications/${groupedTenancy.applicationId}/messages`,
  { body: 'Bring your ID and the deposit on Saturday please.' }, L);
const withMsg = await apiCall(API, 'GET', '/api/tenant-inbox', null, tenantA.token);
const msgItem = (withMsg.body?.items ?? []).find((i) => i.kind === 'message_unread');
msgItem
  ? ok('an unread message from the landlord is in the list')
  : bad(`no unread-message item: ${JSON.stringify((withMsg.body?.items ?? []).map((i) => i.kind))}`);

msgItem?.actionPath === '/account/messages'
  ? ok('…pointing at the inbox Phase 7c built, not at a per-application URL')
  : bad(`the message item points at ${JSON.stringify(msgItem?.actionPath)}`);

await apiCall(API, 'GET', `/api/applications/${groupedTenancy.applicationId}/messages`, null, tenantA.token);
await new Promise((r) => setTimeout(r, 400));
const read = await apiCall(API, 'GET', '/api/tenant-inbox', null, tenantA.token);
!(read.body?.items ?? []).some((i) => i.kind === 'message_unread')
  ? ok('…and reading it takes the item away — it rests on readAt, which Phase 7c made real')
  : bad('a message the tenant has read is still listed as unread');

console.log('\n── 5. Scope ───────────────────────────────────────────────');

const bInbox = await apiCall(API, 'GET', '/api/tenant-inbox', null, tenantB.token);
const bIds = (bInbox.body?.items ?? []).map((i) => i.entityId);
bIds.length > 0
  ? ok('the other tenant has items of their own (so the next check means something)')
  : bad('the other tenant has an empty inbox — the isolation check below proves nothing');

!bIds.includes(groupedTenancy.tenancyId) && !bIds.includes(groupedTenancy.applicationId)
  ? ok('…and none of them is the first tenant’s')
  : bad('one tenant can see another tenant’s tasks');

const landlordAsks = await apiCall(API, 'GET', '/api/tenant-inbox', null, L);
landlordAsks.status === 200
  ? ok('a LANDLORD account may ask — they rent somewhere too, and a guard would hide their own lease')
  : bad(`a landlord calling the tenant inbox got ${landlordAsks.status}, expected 200`);
(landlordAsks.body?.items ?? []).length === 0
  ? ok('…and gets nothing, because they are nobody’s tenant — scoped by the clause, not the guard')
  : bad(`a landlord saw ${landlordAsks.body.items.length} tenant task(s) that are not theirs`);

console.log('\n── 6. A landlord who never grouped anything ────────────────');

const looseRoom = await mkRoom(`Only room ${S}`, loose.token);
const looseDash = await apiCall(API, 'GET', '/api/properties/dashboard', null, loose.token);
looseDash.body?.properties?.length === 0 && looseDash.body?.ungrouped?.rooms?.length === 1
  ? ok('their dashboard has no properties and one ungrouped room, which is the case 7b promised to support')
  : bad(`unexpected shape: ${JSON.stringify({ p: looseDash.body?.properties?.length, u: looseDash.body?.ungrouped?.rooms?.length })}`);

const looseRooms = (await apiCall(API, 'GET', '/api/rooms/my-rooms', null, loose.token)).body;
looseRooms?.[0]?.viewsLast7Days === 0 && looseRooms[0].id === looseRoom
  ? ok('…and their room carries the weekly figure like any other')
  : bad(`their room's weekly figure is ${JSON.stringify(looseRooms?.[0]?.viewsLast7Days)}`);

console.log(`\n${fail === 0 ? '✅ all checks passed' : `❌ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
