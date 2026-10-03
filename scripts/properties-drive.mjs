/**
 * Properties: grouping rooms at one address — Phase 7b.
 *
 * ── What is worth checking here, and what is not
 *
 * Not that a property saves. That the two things a landlord fears are both
 * impossible, and that the screen tells them so BEFORE they act:
 *
 *   1. Deleting a property must never delete a listing. It never has — the
 *      relation is SetNull — but "it is safe" and "the landlord knows it is
 *      safe" are different claims, and only the second is about the person. So
 *      the API now REFUSES the call while rooms are attached unless the caller
 *      passes ungroupRooms, and the refusal names the number and says what will
 *      happen to them. That refusal is the check.
 *   2. Taking a room out of a property must leave the listing exactly as it
 *      was: on the board, with its applications and its tenant.
 *
 * Then the things the brief asks for that can be checked from the API: the card
 * counts, the private address line never leaving the landlord's own screens,
 * and a room created with an explicit property landing in it.
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
const other = await registerUser(API, 'LANDLORD');
const tenant = await registerUser(API, 'TENANT');
const T = landlord.token;

const ADDRESS = `1423 Vilakazi Street ${S}`;

// ── 1. A property, with the private address line ─────────────────────────
const created = await apiCall(API, 'POST', '/api/properties', {
  name: `Ext 7 back rooms ${S}`,
  addressLine: ADDRESS,
  suburb: 'Tembisa',
  city: 'Johannesburg',
  province: 'Gauteng',
}, T);
created.status === 201
  ? ok('a landlord can create a property')
  : bad(`create returned ${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);
const propertyId = created.body?.id;

created.body?.addressLine === ADDRESS
  ? ok('…and the street address they typed comes back to them')
  : bad(`addressLine is ${JSON.stringify(created.body?.addressLine)}`);

// ── 2. Rooms, one grouped at creation and one standalone ─────────────────
const roomBody = (title, extra = {}) => ({
  roomType: 'shared_house',
  title,
  description: 'A clean room in a shared house, close to transport and the shops. Available now.',
  rentCents: 300000,
  province: 'Gauteng',
  city: 'Johannesburg',
  locationDisplay: 'Tembisa, Johannesburg',
  availableFrom: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
  ...extra,
});

const grouped = await apiCall(API, 'POST', '/api/rooms', roomBody(`Back room one ${S}`, { propertyId }), T);
grouped.status === 201 && grouped.body?.propertyId === propertyId
  ? ok('a room can be created straight into a property — the wizard picker’s whole point')
  : bad(`room created with propertyId came back as ${JSON.stringify(grouped.body?.propertyId)}`);

const standalone = await apiCall(API, 'POST', '/api/rooms', roomBody(`Loose room ${S}`), T);
standalone.body?.propertyId == null
  ? ok('and a room created without one is NOT grouped behind the landlord’s back')
  : bad('an ungrouped room was given a property it was never asked about');

/**
 * Somebody else's property is a refusal, not a silent ignore.
 *
 * ⚠️ The precondition is asserted first, and that is not ceremony. The first
 * version of this check read `propertyId: theirs.body?.id` without ever looking
 * at whether that property had been created — and when the create failed, it
 * sent `propertyId: undefined`, which is a perfectly ordinary room creation
 * that returns 201. The check reported "a room was created against another
 * landlord's property" about a request that never mentioned one. A negative
 * test whose setup silently failed is a negative test that proves nothing in
 * whichever direction it happens to land.
 */
const theirs = await apiCall(API, 'POST', '/api/properties', {
  name: `Not yours ${S}`, city: 'Durban', province: 'KwaZulu-Natal',
}, other.token);
if (!theirs.body?.id) {
  bad(`could not create the other landlord's property, so the isolation checks cannot run: ${theirs.status} ${JSON.stringify(theirs.body).slice(0, 200)}`);
} else {
  ok('another landlord has a property of their own to test against');
  const stolen = await apiCall(API, 'POST', '/api/rooms',
    roomBody(`Wrong property ${S}`, { propertyId: theirs.body.id }), T);
  stolen.status >= 400
    ? ok('a property id that is not yours is refused, rather than dropped while saying "saved"')
    : bad(`a room was created against another landlord's property (${stolen.status})`);
}

// ── 3. The card numbers the list screen draws ────────────────────────────
const dash = await apiCall(API, 'GET', '/api/properties/dashboard', undefined, T);
const group = (dash.body?.properties ?? []).find((g) => g.property?.id === propertyId);
group?.roomCount === 1 && group?.draft === 1
  ? ok('the property card counts its rooms, and says a draft is a draft')
  : bad(`card counts read ${JSON.stringify({ rooms: group?.roomCount, draft: group?.draft })}`);

(dash.body?.ungrouped?.roomCount ?? 0) >= 1
  ? ok('and rooms in no property are still shown, rather than quietly dropped')
  : bad('the ungrouped rooms disappeared from the dashboard');

// ── 4. The address line never leaves the landlord's own screens ──────────
q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id='${grouped.body?.id}'`);
const publicRoom = await apiCall(API, 'GET', `/api/rooms/${grouped.body?.id}`);
const payload = JSON.stringify(publicRoom.body);
!payload.includes(ADDRESS) && !payload.includes('addressLine')
  ? ok('the street address is in NO public room payload — the board shows a suburb, never a street')
  : bad('a private street address leaked into the public room payload');

const board = await apiCall(API, 'GET', '/api/rooms?city=Johannesburg&limit=50');
!JSON.stringify(board.body).includes(ADDRESS)
  ? ok('…and not on the board either')
  : bad('the street address leaked onto the public board');

// ── 5. Deleting a property: never silently ───────────────────────────────
const refused = await apiCall(API, 'DELETE', `/api/properties/${propertyId}`, undefined, T);
refused.status >= 400
  ? ok('deleting a property with rooms in it is REFUSED without an explicit confirmation')
  : bad(`a property with rooms attached was deleted on the first ask (${refused.status})`);

const message = String(refused.body?.message ?? '');
/1 room/.test(message) && /NOT delete/i.test(message)
  ? ok('and the refusal names how many rooms and says they will NOT be deleted')
  : bad(`the refusal does not say what will happen: "${message.slice(0, 120)}"`);

q(`SELECT count(*) FROM properties WHERE id='${propertyId}'`) === '1'
  ? ok('the property is still there after the refusal')
  : bad('the property was deleted by a call the API said it refused');

// ── 6. Taking a room out leaves the listing alone ────────────────────────
//
// The one a landlord is most afraid of. An applicant and a published listing
// first, so there is something to lose.
await apiCall(API, 'POST', '/api/applications',
  { roomId: grouped.body?.id, coverNote: 'I would like this room please.' }, tenant.token);

const out = await apiCall(API, 'DELETE', `/api/properties/rooms/${grouped.body?.id}`, undefined, T);
out.status === 200
  ? ok('a room can be taken out of a property')
  : bad(`unassign returned ${out.status}`);

const after = q(`SELECT status || '|' || ("propertyId" IS NULL)::text || '|' || "heroImagePath" FROM rooms WHERE id='${grouped.body?.id}'`);
after === 'active|true|rooms/stub.jpg'
  ? ok('…and the listing is untouched: still active, still with its photo, just not grouped')
  : bad(`the room now reads ${after}`);

q(`SELECT count(*) FROM applications WHERE "roomId"='${grouped.body?.id}' AND "archivedAt" IS NULL`) === '1'
  ? ok('and its application survived, which is the thing a landlord is actually afraid of losing')
  : bad('taking a room out of a property lost its application');

// ── 7. Now the property is empty, deleting it is simple ─────────────────
const emptied = await apiCall(API, 'DELETE', `/api/properties/${propertyId}`, undefined, T);
emptied.status === 200
  ? ok('an empty property deletes without a song and dance')
  : bad(`deleting an empty property returned ${emptied.status} ${JSON.stringify(emptied.body).slice(0, 140)}`);

// And with rooms AND the confirmation, the rooms survive.
const second = await apiCall(API, 'POST', '/api/properties', {
  name: `Second place ${S}`, city: 'Johannesburg', province: 'Gauteng',
}, T);
await apiCall(API, 'POST', `/api/properties/${second.body?.id}/rooms`,
  { roomIds: [standalone.body?.id] }, T);
const confirmed = await apiCall(API, 'DELETE',
  `/api/properties/${second.body?.id}?ungroupRooms=true`, undefined, T);
confirmed.status === 200 && confirmed.body?.roomsUngrouped === 1
  ? ok('with the confirmation it goes ahead, and says how many rooms it ungrouped')
  : bad(`confirmed delete returned ${confirmed.status} ${JSON.stringify(confirmed.body)}`);

q(`SELECT count(*) FROM rooms WHERE id='${standalone.body?.id}' AND status <> 'deleted'`) === '1'
  ? ok('and the room it held is still a live listing')
  : bad('deleting a property destroyed a listing');

// ── 8. Another landlord's property is not yours to touch ────────────────
for (const [label, method, path, body] of [
  ['rename', 'PATCH', `/api/properties/${theirs.body?.id}`, { name: 'Mine now' }],
  ['delete', 'DELETE', `/api/properties/${theirs.body?.id}?ungroupRooms=true`, undefined],
]) {
  const r = await apiCall(API, method, path, body, T);
  r.status >= 400
    ? ok(`you cannot ${label} another landlord’s property (${r.status})`)
    : bad(`a landlord could ${label} somebody else's property`);
}
q(`SELECT name FROM properties WHERE id='${theirs.body?.id}'`).startsWith('Not yours')
  ? ok('and it still has the name its owner gave it')
  : bad("another landlord's property was renamed");

q(`DELETE FROM users WHERE id IN ('${landlord.id}','${other.id}','${tenant.id}')`);

console.log(fail
  ? `\n❌ ${fail} failure(s)`
  : '\n✅ grouping is optional, deleting a property cannot delete a listing, and the landlord is told that before they act');
process.exit(fail ? 1 : 0);
