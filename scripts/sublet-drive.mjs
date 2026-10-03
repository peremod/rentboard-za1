/**
 * Tenant sub-letting and shared-lease listings — Phase 6, Option A.
 *
 * ── What Option A actually means, and therefore what has to be checked
 *
 * A `TENANT` account may hold a listing. That is one line of product decision
 * and fifty-two call sites of consequence: every endpoint a lister needs was
 * behind `LandlordGuard`, and the tempting fix — letting tenants through that
 * guard — would also have opened the yard, rent tracking, expenses, the paid
 * identity badge, the storefront and listing-by-WhatsApp, silently, in one
 * edit. So there is a second guard, and the split is what this drive checks
 * first: a tenant can run a listing, and still cannot touch an owner's things.
 *
 * Then the three things the brief asks for:
 *
 *   1. A sublet listing is MARKED as one, everywhere an applicant looks, and
 *      the board can filter on it (same board, explicit filter — the
 *      positioning decision).
 *   2. The sub-letting check is about a LISTING, not a person: it carries a
 *      roomId, approval stamps that room, and a rejection takes the stamp away.
 *      It is free.
 *   3. A tenant cannot pass their listing off as an owner's.
 *
 * Needs the API on :3000 and a DATABASE_URL (the admin review is driven over
 * HTTP; the lease document is a stub path, since no file is being uploaded).
 */
import { registerUser, apiCall, dbQuery as q } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
let fail = 0;
const skips = [];
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const skip = (what, why) => { skips.push({ what, why }); console.log(`  ⏭️  ${what}\n       ↳ ${why}`); };

const S = Math.floor(Math.random() * 1e6);
const LOC = `Observatory ${S}, Cape Town`;

const sublessor = await registerUser(API, 'TENANT');
const owner = await registerUser(API, 'LANDLORD');
const applicant = await registerUser(API, 'TENANT');

const roomBody = (title, extra = {}) => ({
  roomType: 'shared_house',
  title,
  description: 'A clean room in a shared house, close to transport and the shops. Available now.',
  rentCents: 350000,
  province: 'Western Cape',
  city: 'Cape Town',
  locationDisplay: LOC,
  availableFrom: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
  housematesCount: 2,
  ...extra,
});

// ── 1. A tenant can create a listing at all ──────────────────────────────
const created = await apiCall(API, 'POST', '/api/rooms', roomBody('Sunny room in a shared Obs house', {
  listerType: 'sublessor',
  household: {
    housemateProfile: 'professionals',
    householdSchedule: 'weekday_working',
    householdCleanliness: 'tidy_enough',
    householdSocial: 'quiet',
    currentHousemates: 2,
    houseRules: 'Gate locked at 9. Kitchen cleaned the same day.',
  },
}), sublessor.token);

created.status === 201
  ? ok('a TENANT account can create a listing — which was the whole of Option A')
  : bad(`a tenant could not create a listing: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
const roomId = created.body?.id;

created.body?.listerType === 'sublessor'
  ? ok('and it is marked as a sublet')
  : bad(`listerType came back as ${created.body?.listerType}`);

// ── 2. A tenant cannot pass a listing off as an owner's ──────────────────
const liar = await apiCall(API, 'POST', '/api/rooms',
  roomBody('Room in my own house, honestly', { listerType: 'owner_landlord' }), sublessor.token);
liar.body?.listerType === 'sublessor'
  ? ok('a tenant asking for owner_landlord is overridden, not obeyed')
  : bad(`a tenant created a listing presenting as an owner's (${liar.body?.listerType})`);
if (liar.body?.id) q(`DELETE FROM rooms WHERE id='${liar.body.id}'`);

// An owner's listing is untouched by any of this.
const ownerRoom = await apiCall(API, 'POST', '/api/rooms', roomBody('Backroom in Khayelitsha'), owner.token);
ownerRoom.body?.listerType === 'owner_landlord'
  ? ok('a landlord listing still defaults to owner_landlord, unchanged')
  : bad(`a landlord's listing came back as ${ownerRoom.body?.listerType}`);

// ── 3. The household went to the PROPERTY, not onto the room ─────────────
const prop = q(`SELECT p."housemateProfile" || '|' || p."householdSchedule" || '|' || p."householdCleanliness" || '|' || p."householdSocial" FROM properties p JOIN rooms r ON r."propertyId" = p.id WHERE r.id = '${roomId}'`);
prop === 'professionals|weekday_working|tidy_enough|quiet'
  ? ok('the household is stored once, on the property — four rooms at one address cannot disagree')
  : bad(`the property reads ${prop}`);

// A second room at the same place reuses it rather than making a second house.
const second = await apiCall(API, 'POST', '/api/rooms', roomBody('Second room, same house', {
  listerType: 'sublessor',
  household: { householdSocial: 'social' },
}), sublessor.token);
const houses = q(`SELECT count(*) FROM properties WHERE "landlordId"='${sublessor.id}'`);
houses === '1'
  ? ok('a second room at the same address joins the same household, not a second one')
  : bad(`${houses} properties for one sub-lessor at one address`);
q(`SELECT "householdSocial" FROM properties WHERE "landlordId"='${sublessor.id}'`) === 'social'
  ? ok('and editing the household updates the one copy')
  : bad('the household update did not land');

// ── 4. The guard split: a lister's endpoints yes, an owner's no ──────────
await apiCall(API, 'PATCH', `/api/rooms/${roomId}`, { title: 'Sunny room in a shared Obs house (updated)' }, sublessor.token);
q(`SELECT title FROM rooms WHERE id='${roomId}'`).endsWith('(updated)')
  ? ok('a sub-lessor can edit their own listing')
  : bad('a sub-lessor could not edit their own listing');

const mine = await apiCall(API, 'GET', '/api/rooms/my-rooms', undefined, sublessor.token);
mine.status === 200 && JSON.stringify(mine.body).includes(roomId)
  ? ok('…and read their listings back, so the dashboard has something to show')
  : bad(`my-rooms returned ${mine.status} for a sub-lessor`);

for (const [label, method, path] of [
  ['the yard', 'GET', '/api/properties'],
  ['the yard dashboard', 'GET', '/api/properties/dashboard'],
  ['rent settings', 'PATCH', '/api/properties/rent/settings'],
  ['the landlord inbox', 'GET', '/api/landlord/inbox'],
  ['the storefront', 'GET', '/api/landlord/storefront'],
]) {
  const r = await apiCall(API, method, path, method === 'GET' ? undefined : {}, sublessor.token);
  r.status === 403 || r.status === 404
    ? ok(`and still cannot reach ${label} (${r.status}) — LandlordGuard was not widened`)
    : bad(`a sub-lessor reached ${label}: ${r.status}`);
}

// Another lister's listing is still none of their business.
const steal = await apiCall(API, 'PATCH', `/api/rooms/${ownerRoom.body?.id}`, { title: 'Mine now, actually' }, sublessor.token);
steal.status >= 400 && !q(`SELECT title FROM rooms WHERE id='${ownerRoom.body?.id}'`).includes('Mine now')
  ? ok('a lister cannot touch somebody else’s listing — the guard says who may try, the WHERE says whose rows')
  : bad(`a sub-lessor edited another account's listing (${steal.status})`);

// ── 5. The board: same surface, explicit filter ──────────────────────────
// Published, so the public board can see it. A sublet needs a cover photo like
// any other listing.
q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id IN ('${roomId}','${ownerRoom.body?.id}')`);

const all = await apiCall(API, 'GET', `/api/rooms?city=Cape%20Town&limit=50`);
const subletOnly = await apiCall(API, 'GET', `/api/rooms?city=Cape%20Town&limit=50&listerType=sublessor`);
const ownerOnly = await apiCall(API, 'GET', `/api/rooms?city=Cape%20Town&limit=50&listerType=owner_landlord`);

const ids = (r) => (r.body?.data ?? []).map((x) => x.id);
ids(all).includes(roomId) && ids(all).includes(ownerRoom.body?.id)
  ? ok('both kinds appear on the SAME board by default — the positioning decision, in a check')
  : bad('the unfiltered board does not carry both kinds');
ids(subletOnly).includes(roomId) && !ids(subletOnly).includes(ownerRoom.body?.id)
  ? ok('the sublet filter narrows to sublets')
  : bad('listerType=sublessor did not narrow correctly');
ids(ownerOnly).includes(ownerRoom.body?.id) && !ids(ownerOnly).includes(roomId)
  ? ok('and the owner filter excludes them')
  : bad('listerType=owner_landlord did not narrow correctly');

const quiet = await apiCall(API, 'GET', `/api/rooms?city=Cape%20Town&limit=50&householdSocial=quiet`);
const social = await apiCall(API, 'GET', `/api/rooms?city=Cape%20Town&limit=50&householdSocial=social`);
// The household was updated to 'social' by the second room, so the whole house
// is social now — which is the point of storing it once.
ids(social).includes(roomId) && !ids(quiet).includes(roomId)
  ? ok('a household filter matches on the house, and excludes what does not')
  : bad('household filtering does not work');
!ids(social).includes(ownerRoom.body?.id)
  ? ok('…and excludes listings that have said nothing, which is what the UI warns about')
  : bad('a household filter matched a listing with no household stated');

// Four filters at once, which is where a careless `where` keeps only the last.
const four = await apiCall(API, 'GET',
  `/api/rooms?city=Cape%20Town&limit=50&housemateProfile=professionals&householdSchedule=weekday_working&householdCleanliness=tidy_enough&householdSocial=social`);
ids(four).includes(roomId)
  ? ok('all four household filters apply together rather than silently dropping three')
  : bad('combining the household filters lost some of them');

const mismatch = await apiCall(API, 'GET',
  `/api/rooms?city=Cape%20Town&limit=50&housemateProfile=students&householdSocial=social`);
!ids(mismatch).includes(roomId)
  ? ok('and one wrong value in the set is enough to exclude a room')
  : bad('a room matched despite a filter it does not satisfy');

// ── 6. The sub-letting check: scoped to the listing, and free ────────────
const types = await apiCall(API, 'GET', '/api/verification/types', undefined, sublessor.token);
const subletType = (types.body ?? []).find((t) => t.type === 'sublet_right');
subletType
  ? ok('a sub-lessor is offered the sublet-right check')
  : bad('sublet_right is not offered to somebody holding a sublet listing');
subletType && subletType.requiresPayment === false
  ? ok('and it is FREE — listing is free here, so charging to prove a right to sublet would be a listing fee by another name')
  : bad('the sublet-right check carries a fee');

const applicantTypes = await apiCall(API, 'GET', '/api/verification/types', undefined, applicant.token);
!(applicantTypes.body ?? []).some((t) => t.type === 'sublet_right')
  ? ok('a tenant with no sublet listing is not offered a check they cannot complete')
  : bad('sublet_right is offered to somebody with no sublet listing');

const noRoom = await apiCall(API, 'POST', '/api/verification',
  { type: 'sublet_right', documentPath: 'verification/stub-lease.jpg' }, sublessor.token);
noRoom.status >= 400
  ? ok('a sublet check with no listing named is refused — the right comes from one lease over one address')
  : bad('a sublet check was accepted without a listing');

const notTheirs = await apiCall(API, 'POST', '/api/verification',
  { type: 'sublet_right', documentPath: 'verification/stub-lease.jpg', roomId: ownerRoom.body?.id }, sublessor.token);
notTheirs.status >= 400
  ? ok('…and one naming somebody else’s listing is refused')
  : bad('a sublet check was accepted against another account’s listing');

const submitted = await apiCall(API, 'POST', '/api/verification',
  { type: 'sublet_right', documentPath: 'verification/stub-lease.jpg', roomId }, sublessor.token);
submitted.status === 201
  ? ok('the check can be submitted against their own listing')
  : bad(`submitting the sublet check returned ${submitted.status} ${JSON.stringify(submitted.body).slice(0, 160)}`);

q(`SELECT ("subletCheckedAt" IS NULL)::text FROM rooms WHERE id='${roomId}'`) === 'true'
  ? ok('and submitting it stamps nothing — only an admin decision can')
  : bad('the listing was stamped as checked by its own owner submitting a document');

// ── 7. The admin decision, both ways ────────────────────────────────────
const adm = await apiCall(API, 'POST', '/api/auth/login', {
  email: 'ci-admin@mastande.test', password: 'CiSmokeAdmin123',
});
const ADMIN = adm.body?.accessToken ?? adm.body?.access_token;

if (!ADMIN) {
  skip(
    'the admin decision, and therefore the whole badge mechanism',
    'no CI admin on this database. Seed it (npm --prefix backend run seed) and re-run — without it, nothing can prove that approval stamps the room and rejection un-stamps it.',
  );
} else {
  const queue = await apiCall(API, 'GET', '/api/verification/pending', undefined, ADMIN);
  const row = (queue.body ?? []).find((r) => r.id === submitted.body?.id);
  row?.room?.title && row.room.locationDisplay === LOC
    ? ok('the reviewer is told which listing the lease should name')
    : bad('the admin queue does not say which listing a sublet check is about');

  const approved = await apiCall(API, 'PATCH', `/api/verification/${submitted.body?.id}/review`,
    { status: 'approved' }, ADMIN);
  approved.status === 200
    ? ok('an admin can approve it')
    : bad(`approval returned ${approved.status} ${JSON.stringify(approved.body).slice(0, 160)}`);

  q(`SELECT ("subletCheckedAt" IS NOT NULL)::text FROM rooms WHERE id='${roomId}'`) === 'true'
    ? ok('and approval stamps the LISTING, not the person')
    : bad('approval did not stamp the listing');

  // The same person's other listing must not inherit it: a right to sublet in
  // Observatory says nothing about anywhere else.
  q(`SELECT ("subletCheckedAt" IS NULL)::text FROM rooms WHERE id='${second.body?.id}'`) === 'true'
    ? ok('their other listing is untouched — the right is per address, not per person')
    : bad('approving one listing stamped another listing of the same person');

  // And the document is gone, like every other decided verification.
  const doc = q(`SELECT ("documentPath" IS NULL)::text || '|' || ("documentWithdrawnAt" IS NOT NULL)::text FROM verification_requests WHERE id='${submitted.body?.id}'`);
  doc === 'true|true'
    ? ok('the lease is withdrawn on decision and queued for deletion, like every other document here')
    : bad(`the decided request still holds its document: ${doc}`);

  // Rejection of a later submission takes the stamp away.
  const again = await apiCall(API, 'POST', '/api/verification',
    { type: 'sublet_right', documentPath: 'verification/stub-lease-2.jpg', roomId }, sublessor.token);
  const rejected = await apiCall(API, 'PATCH', `/api/verification/${again.body?.id}/review`,
    { status: 'rejected', reviewNote: 'The consent letter is not from the owner.' }, ADMIN);
  rejected.status === 200 && q(`SELECT ("subletCheckedAt" IS NULL)::text FROM rooms WHERE id='${roomId}'`) === 'true'
    ? ok('a later rejection CLEARS the stamp — a badge an admin has just disagreed with must not stay up')
    : bad('a rejected re-check left the listing still showing as checked');
}

// ── 8. What an applicant is told ────────────────────────────────────────
const publicRoom = await apiCall(API, 'GET', `/api/rooms/${roomId}`);
publicRoom.body?.listerType === 'sublessor'
  ? ok('the public room payload says it is a sublet, so the page can say so')
  : bad('the public room does not carry listerType');
publicRoom.body?.property?.householdSocial === 'social'
  ? ok('and carries the household, which is the thing competitors leave out')
  : bad('the public room does not carry the household');

/**
 * An applicant applying to a sublet is told who accepted them, accurately.
 *
 * The applicant is made phone-only first, and that is not incidental: when
 * there IS an email address, NoticeRouter sends the caller's email and returns
 * without writing a Notice row — by design, since nothing about the email path
 * changed in v1.85.0. The first version of this check asserted on a Notice row
 * that therefore never existed, and read the empty string as wrong copy. The
 * in-app notice is the channel to assert on, so the drive puts the applicant on
 * it. (It also happens to exercise phone-only + sublet together, which is the
 * combination this market will actually produce.)
 */
q(`UPDATE users SET email = NULL, phone = '+2782133${String(S).slice(-4)}', "phoneVerified" = true WHERE id = '${applicant.id}'`);

const applied = await apiCall(API, 'POST', '/api/applications',
  { roomId, coverNote: 'Hi, I am interested in the room.' }, applicant.token);
if (applied.status !== 201) {
  bad(`could not apply to the sublet listing: ${applied.status} ${JSON.stringify(applied.body).slice(0, 160)}`);
} else {
  await apiCall(API, 'POST', `/api/applications/${applied.body.id}/accept`, {}, sublessor.token);
  const notice = q(`SELECT body FROM notices WHERE "userId"='${applicant.id}' AND kind='accepted' ORDER BY "createdAt" DESC LIMIT 1`);
  notice.startsWith('The person letting the room accepted')
    ? ok('and the acceptance notice does not call a tenant "the landlord"')
    : bad(`the acceptance notice reads: "${notice.slice(0, 90)}" — expected it to name the person letting the room`);
}

// ── Tidy up ─────────────────────────────────────────────────────────────
q(`DELETE FROM users WHERE id IN ('${sublessor.id}','${owner.id}','${applicant.id}')`);

if (skips.length) {
  console.log(`\n⏭️  ${skips.length} check(s) not run:`);
  for (const s of skips) console.log(`   • ${s.what} — ${s.why}`);
}
console.log(
  fail
    ? `\n❌ ${fail} failure(s)`
    : '\n✅ a tenant can let out a room, cannot pretend to be an owner, cannot reach an owner’s tools, and an applicant is told the truth about who they are dealing with',
);
process.exit(fail ? 1 : 0);
