/**
 * Inviting an applicant to see the room — Phase 7l, brief item 26.
 *
 * ── What did not exist before this
 *
 * `ApplicationStatus` runs pending → viewed → shortlisted → accepted, and
 * `viewed` means THE LANDLORD OPENED THE APPLICATION. Nothing in the product
 * recorded a room viewing at all, so "I'll meet you Saturday at four" lived in
 * the message thread and nowhere else: no date either side could look up,
 * nothing the tenant could answer yes or no to, and nothing to say it had been
 * agreed.
 *
 * ── The checks that matter are about the address
 *
 * The board shows a suburb, not a street. `Property.addressLine` does hold one,
 * and the form where a landlord types it promises, in those words: "Only you
 * see this. It is never on a listing and never sent to an applicant."
 *
 * So the meeting place is typed per viewing and must NEVER be read from that
 * column. A convenience that pre-filled it would break a promise the product
 * made in writing, on the form where the landlord typed it, and the landlord
 * would never know. Section 2 asserts it, against a property whose address is
 * set to a string nothing else in the fixture contains.
 *
 * ⚠️ And falsifying it taught something about the check itself.
 *
 * The first falsification made the service fall back to `addressLine` when the
 * meeting place was blank — and the check stayed GREEN, because the DTO's
 * `@MinLength(3)` refuses a blank before the service ever runs, so the fallback
 * could not fire. A leak does not arrive that way. It arrives as somebody
 * helpfully appending "The address is …" to the notice so the tenant can find
 * the place, which is the version this check does catch — proven, by doing it.
 *
 * Which is why the check searches THREE places: the stored row, the tenant's
 * notices, and the whole payload the API hands the tenant. A leak through any
 * one of them is the same broken promise, and only one of the three would have
 * caught the realistic version.
 *
 * Needs the API on :3000 and a DATABASE_URL.
 */
import { registerUser, apiCall, dbQuery as q, PASSWORD } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const S = Math.floor(Math.random() * 1e6);
const SECRET_ADDRESS = `14 Vilakazi Street SECRET${S}`;
const soon = (days = 7) => new Date(Date.now() + days * 86400_000).toISOString();

const landlord = await registerUser(API, 'LANDLORD');
const tenant = await registerUser(API, 'TENANT');
const stranger = await registerUser(API, 'TENANT');

/** A property carrying the private address, and a room in it. */
const property = await apiCall(API, 'POST', '/api/properties',
  { name: `Viewing yard ${S}`, addressLine: SECRET_ADDRESS, suburb: 'Tembisa', city: 'Johannesburg', province: 'Gauteng' },
  landlord.token);
const room = await apiCall(API, 'POST', '/api/rooms', {
  roomType: 'shared_house', title: `Viewing room ${S}`,
  description: 'A clean room in a shared house, close to transport and the shops. Available now.',
  rentCents: 310000, province: 'Gauteng', city: 'Johannesburg',
  locationDisplay: 'Tembisa, Johannesburg',
  availableFrom: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
  propertyId: property.body?.id,
}, landlord.token);
q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${room.body?.id}'`);

const application = await apiCall(API, 'POST', '/api/applications',
  { roomId: room.body?.id, coverNote: 'I can move in on the first of the month.' }, tenant.token);
const APP = application.body?.id;

q(`SELECT "addressLine" FROM properties WHERE id = '${property.body?.id}'`) === SECRET_ADDRESS && APP
  ? ok('a room at a property with a PRIVATE address, and an applicant on it (precondition, asserted)')
  : bad('the fixture failed — the address checks below would prove nothing');

console.log('\n── 1. Only the landlord invites, and only a live application ──');

const asTenant = await apiCall(API, 'POST', `/api/applications/${APP}/viewings`,
  { startsAt: soon(), meetingPlace: 'Anywhere' }, tenant.token);
asTenant.status === 403
  ? ok('an applicant cannot invite themselves to a viewing')
  : bad(`the tenant inviting returned ${asTenant.status}`);

const asStranger = await apiCall(API, 'POST', `/api/applications/${APP}/viewings`,
  { startsAt: soon(), meetingPlace: 'Anywhere' }, stranger.token);
asStranger.status === 403
  ? ok('…nor can somebody with nothing to do with the room')
  : bad(`a stranger inviting returned ${asStranger.status}`);

const anon = await apiCall(API, 'POST', `/api/applications/${APP}/viewings`,
  { startsAt: soon(), meetingPlace: 'Anywhere' });
anon.status === 401
  ? ok('…and inviting needs a session')
  : bad(`an unauthenticated invite returned ${anon.status}`);

const noPlace = await apiCall(API, 'POST', `/api/applications/${APP}/viewings`,
  { startsAt: soon(), meetingPlace: '  ' }, landlord.token);
noPlace.status === 400
  ? ok('an invitation with no meeting place is refused — nobody could turn up to it')
  : bad(`a blank meeting place returned ${noPlace.status}`);

const past = await apiCall(API, 'POST', `/api/applications/${APP}/viewings`,
  { startsAt: new Date(Date.now() - 86400_000).toISOString(), meetingPlace: 'The blue gate' }, landlord.token);
past.status === 400
  ? ok('…and a time that has already passed is refused, which is what a timezone slip produces')
  : bad(`a past time returned ${past.status}`);

console.log('\n── 2. The private address is NOT sent to the applicant ─────');

const invited = await apiCall(API, 'POST', `/api/applications/${APP}/viewings`, {
  startsAt: soon(), meetingPlace: 'The blue gate on the corner', note: 'Ask for Sipho at the gate.',
}, landlord.token);
invited.status === 201
  ? ok('the landlord invites the applicant')
  : bad(`inviting returned ${invited.status} ${JSON.stringify(invited.body).slice(0, 160)}`);

const VIEWING = invited.body?.id;

/**
 * ⚠️ THE check this phase exists to protect.
 *
 * Property.addressLine is "14 Vilakazi Street SECRET<n>" and the form that
 * collected it promised it is never sent to an applicant. If any convenience
 * ever pre-fills, copies or suggests it, this fails — and it searches the
 * viewing row, the tenant's notices and the tenant's whole API view of the
 * viewing, because a leak through any of those is the same broken promise.
 */
const storedPlace = q(`SELECT "meetingPlace" FROM room_viewings WHERE id = '${VIEWING}'`);
!(storedPlace ?? '').includes('SECRET')
  ? ok(`the stored meeting place is what the landlord typed ("${storedPlace}")`)
  : bad(`the viewing carries the PRIVATE property address: ${storedPlace}`);

const noticeText = q(`SELECT string_agg(coalesce(title,'') || ' ' || coalesce(body,''), ' | ') FROM notices WHERE "userId" = '${tenant.id}'`);
!(noticeText ?? '').includes('SECRET')
  ? ok('…and nothing in the tenant’s notices contains the private address')
  : bad('the private property address reached the tenant in a notice');

const tenantView = await apiCall(API, 'GET', `/api/applications/${APP}/viewings`, null, tenant.token);
!JSON.stringify(tenantView.body ?? {}).includes('SECRET')
  ? ok('…and it is not in what the API hands the tenant either')
  : bad('the private property address is in the tenant’s viewings payload');

console.log('\n── 3. The tenant is actually told, with the safety line ────');

const notice = q(`SELECT kind FROM notices WHERE "userId" = '${tenant.id}' AND kind = 'viewing_invited'`);
notice === 'viewing_invited'
  ? ok('the tenant gets a notice about the invitation')
  : bad(`no viewing_invited notice for the tenant (got ${JSON.stringify(notice)})`);

const body = q(`SELECT body FROM notices WHERE "userId" = '${tenant.id}' AND kind = 'viewing_invited'`);
/the blue gate on the corner/i.test(body ?? '')
  ? ok('…saying where to meet')
  : bad(`the notice does not say where: ${JSON.stringify((body ?? '').slice(0, 160))}`);
/ask for sipho/i.test(body ?? '')
  ? ok('…and the note that actually gets somebody through a gate')
  : bad('the landlord’s note did not reach the tenant');

/**
 * ⚠️ The safety line travels WITH the invitation.
 *
 * This product's own report reasons include `upfront_payment_demanded`, so the
 * risk of being asked for money before seeing a room is already known to the
 * codebase. A viewing is exactly when that happens, and a warning on a legal
 * page nobody opens is not a warning.
 */
/never pay anything before you have seen the room/i.test(body ?? '')
  ? ok('…and the warning never to pay before seeing the room')
  : bad('the invitation carries no payment warning');
/tell somebody where you are going/i.test(body ?? '')
  ? ok('…and to tell somebody where they are going')
  : bad('the invitation does not say to tell somebody where you are going');

console.log('\n── 4. One open invitation at a time ───────────────────────');

const second = await apiCall(API, 'POST', `/api/applications/${APP}/viewings`,
  { startsAt: soon(9), meetingPlace: 'Somewhere else' }, landlord.token);
second.status === 400
  ? ok('a second open invitation to the same person is refused — two times to turn up at is none')
  : bad(`a second invitation returned ${second.status}`);

console.log('\n── 5. Only the tenant answers ─────────────────────────────');

const landlordAnswers = await apiCall(API, 'POST', `/api/applications/viewings/${VIEWING}/respond`,
  { accept: true }, landlord.token);
landlordAnswers.status === 403
  ? ok('the landlord cannot accept on the applicant’s behalf')
  : bad(`the landlord answering returned ${landlordAnswers.status}`);

const strangerAnswers = await apiCall(API, 'POST', `/api/applications/viewings/${VIEWING}/respond`,
  { accept: true }, stranger.token);
strangerAnswers.status === 403
  ? ok('…nor can anybody else')
  : bad(`a stranger answering returned ${strangerAnswers.status}`);

const accepted = await apiCall(API, 'POST', `/api/applications/viewings/${VIEWING}/respond`,
  { accept: true }, tenant.token);
accepted.status === 200 && accepted.body?.status === 'accepted'
  ? ok('the tenant says yes')
  : bad(`accepting returned ${accepted.status} ${JSON.stringify(accepted.body).slice(0, 140)}`);

q(`SELECT "respondedAt" IS NOT NULL FROM room_viewings WHERE id = '${VIEWING}'`) === 't'
  ? ok('…with the date of the answer, not just the fact of it')
  : bad('the answer has no date');

q(`SELECT kind FROM notices WHERE "userId" = '${landlord.id}' AND kind = 'viewing_accepted'`) === 'viewing_accepted'
  ? ok('…and the landlord is told, or the arrangement is one-sided')
  : bad('the landlord was not told the applicant is coming');

const twice = await apiCall(API, 'POST', `/api/applications/viewings/${VIEWING}/respond`,
  { accept: false }, tenant.token);
twice.status === 400
  ? ok('…and it cannot be answered twice')
  : bad(`answering twice returned ${twice.status}`);

console.log('\n── 6. Either side can call it off ─────────────────────────');

const strangerCancels = await apiCall(API, 'POST', `/api/applications/viewings/${VIEWING}/cancel`, {}, stranger.token);
strangerCancels.status === 403
  ? ok('a stranger cannot call off somebody else’s viewing')
  : bad(`a stranger cancelling returned ${strangerCancels.status}`);

const cancelled = await apiCall(API, 'POST', `/api/applications/viewings/${VIEWING}/cancel`, {}, tenant.token);
cancelled.status === 200 && cancelled.body?.status === 'cancelled'
  ? ok('the applicant can call it off — a tenant with no transport is the same situation from the other end')
  : bad(`the tenant cancelling returned ${cancelled.status}`);

q(`SELECT "cancelledById" FROM room_viewings WHERE id = '${VIEWING}'`) === tenant.id
  ? ok('…and who called it off is recorded')
  : bad('the cancellation does not record who did it');

/**
 * ⚠️ The answer is cleared, because a CHECK constraint says a cancelled
 * viewing carries none — and because "they accepted" stops being true of a
 * viewing that is not happening. A row that says both is a row that
 * contradicts itself.
 */
q(`SELECT "respondedAt" IS NULL FROM room_viewings WHERE id = '${VIEWING}'`) === 't'
  ? ok('…and the acceptance is cleared, so the row does not claim both')
  : bad('a cancelled viewing still carries an acceptance');

q(`SELECT kind FROM notices WHERE "userId" = '${landlord.id}' AND kind = 'viewing_cancelled'`) === 'viewing_cancelled'
  ? ok('…and the other side is told')
  : bad('nobody told the landlord the viewing was off');

console.log('\n── 7. A closed application cannot be invited ──────────────');

/** Cancelling freed the slot, so the landlord can offer another time. */
const again = await apiCall(API, 'POST', `/api/applications/${APP}/viewings`,
  { startsAt: soon(10), meetingPlace: 'The blue gate, Sunday' }, landlord.token);
again.status === 201
  ? ok('after a cancellation the landlord can offer another time')
  : bad(`inviting again returned ${again.status}`);

await apiCall(API, 'POST', `/api/applications/viewings/${again.body?.id}/cancel`, {}, landlord.token);

/**
 * ⚠️ Rejected, withdrawn or archived: sending any of them a time and an
 * address is a mistake, and the person is not expecting to hear from us.
 */
await apiCall(API, 'POST', `/api/applications/${APP}/reject`,
  { reason: 'Letting it to somebody else.' }, landlord.token);
q(`SELECT status FROM applications WHERE id = '${APP}'`) === 'rejected'
  ? ok('the application is rejected (precondition, asserted)')
  : bad(`the application status is ${q(`SELECT status FROM applications WHERE id = '${APP}'`)} — the check below proves nothing`);

const afterReject = await apiCall(API, 'POST', `/api/applications/${APP}/viewings`,
  { startsAt: soon(11), meetingPlace: 'The blue gate' }, landlord.token);
afterReject.status === 400
  ? ok('…and somebody who has been told no cannot then be sent a time and an address')
  : bad(`inviting a rejected applicant returned ${afterReject.status}`);

console.log('\n── 8. What a tenant has coming up ─────────────────────────');

const tenant2 = await registerUser(API, 'TENANT');
const room2 = await apiCall(API, 'POST', '/api/rooms', {
  roomType: 'shared_house', title: `Second viewing room ${S}`,
  description: 'A clean room in a shared house, close to transport and the shops. Available now.',
  rentCents: 290000, province: 'Gauteng', city: 'Johannesburg',
  locationDisplay: 'Tembisa, Johannesburg',
  availableFrom: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
}, landlord.token);
q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${room2.body?.id}'`);
const app2 = await apiCall(API, 'POST', '/api/applications',
  { roomId: room2.body?.id, coverNote: 'I would like to see it.' }, tenant2.token);
const live = await apiCall(API, 'POST', `/api/applications/${app2.body?.id}/viewings`,
  { startsAt: soon(3), meetingPlace: 'The green gate' }, landlord.token);
live.status === 201
  ? ok('a second tenant has a live invitation (precondition, asserted)')
  : bad(`the second invitation failed: ${live.status}`);

const mine = await apiCall(API, 'GET', '/api/applications/viewings/mine', null, tenant2.token);
mine.status === 200 && (mine.body ?? []).length === 1
  ? ok('a tenant can see what they have coming up')
  : bad(`viewings/mine returned ${mine.status} with ${JSON.stringify(mine.body).slice(0, 140)}`);

(mine.body ?? [])[0]?.application?.room?.title === `Second viewing room ${S}`
  ? ok('…naming the room, so a tenant with three applications knows which')
  : bad('the upcoming list does not name the room');

/**
 * ⚠️ Only live ones, and only future ones. A list that kept last month's
 * declined invitations would bury the one on Saturday.
 */
const mineForFirst = await apiCall(API, 'GET', '/api/applications/viewings/mine', null, tenant.token);
(mineForFirst.body ?? []).length === 0
  ? ok('…and cancelled invitations are not in it')
  : bad(`the first tenant still has ${JSON.stringify(mineForFirst.body).slice(0, 140)} coming up`);

console.log(`\n${fail === 0 ? '✅ all checks passed' : `❌ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
