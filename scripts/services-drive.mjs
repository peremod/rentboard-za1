/**
 * The contractor directory — Phase 4d.
 *
 *   ADMIN seeded (npm run db:seed) and node scripts/services-drive.mjs
 *
 * It EMPTIES the directory first, deliberately: the first version did not, so
 * the second run saw the first run's rows and the count assertions drifted —
 * which read as a broken filter rather than a drive that does not clean up.
 *
 * Needs the API on :3000.
 */
import { registerUser, apiCall, dbQuery } from './lib/drive-session.mjs';
const API='http://localhost:3000';
let fail=0; const ok=m=>console.log('  ✅ '+m); const bad=m=>{console.log('  ❌ '+m);fail++;};

const ll = await registerUser(API,'LANDLORD');
const adm = await apiCall(API,'POST','/api/auth/login',{email:'ci-admin@mastande.test',password:'CiSmokeAdmin123'});
const A = adm.body.accessToken;
A ? ok('admin signed in') : bad(`admin login ${adm.status}`);

// Start from an empty directory. Without this the second run sees the first
// run's rows and the counts drift — which is exactly what happened, and looked
// like a broken filter rather than a drive that does not clean up.
for (const existing of ((await apiCall(API,'GET','/api/services/admin/all',undefined,A)).body||[])) {
  await apiCall(API,'DELETE',`/api/services/admin/${existing.id}`,undefined,A);
}
ok('directory emptied before the run');

// Only an admin may add one — the list is curated.
const byLandlord = await apiCall(API,'POST','/api/services/admin',{category:'plumber',name:'Rogue Plumber',phone:'0821234567',areas:['Tembisa']},ll.token);
byLandlord.status===403 ? ok('a landlord cannot add a provider') : bad(`landlord add returned ${byLandlord.status}`);

// Phone normalisation, via the shared helper.
// ⚠️ phoneConfirmedAt is now part of the fixture, not decoration — Phase 7j.
//
// A provider cannot be listed until somebody has rung the number and recorded
// it, enforced by the service AND a CHECK constraint, because the directory
// tells landlords these names were checked. This drive's fixtures were all
// `active: true` with nothing recorded, so every one of them started failing
// the moment the rule landed — which is the rule working. The check below
// asserts it here too, so this drive knows about the rule rather than merely
// satisfying it.
const unchecked = await apiCall(API,'POST','/api/services/admin',{category:'plumber',name:'Unchecked Plumber',phone:'082 999 0000',areas:['Tembisa'],active:true},A);
unchecked.status===400 ? ok('a provider cannot be listed before the number has been rung') : bad(`creating a live unchecked provider returned ${unchecked.status}`);

const p1 = await apiCall(API,'POST','/api/services/admin',{category:'plumber',name:'Sipho — Tembisa Plumbing',phone:'082 123 4567',areas:['Tembisa','Kempton Park'],note:'Geysers and blocked drains.',active:true,phoneConfirmedAt:'2026-09-18T10:00:00.000Z'},A);
p1.status===201 ? ok('admin adds a plumber') : bad(`create ${p1.status} ${JSON.stringify(p1.body).slice(0,200)}`);
p1.body.phone==='+27821234567' ? ok(`"082 123 4567" is stored as ${p1.body.phone}`) : bad(`stored as ${p1.body.phone}`);

// The same number in another format must normalise identically.
const p2 = await apiCall(API,'POST','/api/services/admin',{category:'electrician',name:'Thabo Electrical',phone:'+27 82 765 4321',areas:['Soweto'],active:true,phoneConfirmedAt:'2026-09-18T10:00:00.000Z'},A);
p2.body.phone==='+27827654321' ? ok('and "+27 82 765 4321" normalises the same way') : bad(`stored as ${p2.body.phone}`);

// Rubbish is refused rather than stored unusable.
const badPhone = await apiCall(API,'POST','/api/services/admin',{category:'other',name:'Not A Number',phone:'12345',areas:['Soweto']},A);
badPhone.status===400 ? ok('a number that is not a SA mobile is refused') : bad(`bad phone accepted: ${badPhone.status}`);

// Inactive by default, and invisible to landlords until switched on.
const p3 = await apiCall(API,'POST','/api/services/admin',{category:'locksmith',name:'Draft Locksmith',phone:'0834567890',areas:['Tembisa']},A);
p3.body.active===false ? ok('a new provider is off by default') : bad(`active defaulted to ${p3.body.active}`);
const seen = await apiCall(API,'GET','/api/services',undefined,ll.token);
seen.status===200 ? ok('a landlord can read the directory') : bad(`list ${seen.status}`);
!(seen.body||[]).some(x=>x.name==='Draft Locksmith') ? ok('and does not see the one that is off') : bad('an inactive provider is visible');
(seen.body||[]).length===2 ? ok(`sees the two live ones`) : bad(`saw ${(seen.body||[]).length}`);

// Filters.
const plumbers = await apiCall(API,'GET','/api/services?category=plumber',undefined,ll.token);
(plumbers.body||[]).length===1 && plumbers.body[0].category==='plumber' ? ok('filters by category') : bad(`category filter: ${JSON.stringify((plumbers.body||[]).map(x=>x.category))}`);
const inTembisa = await apiCall(API,'GET','/api/services?area=Tembisa',undefined,ll.token);
(inTembisa.body||[]).length===1 ? ok('filters by area') : bad(`area filter returned ${(inTembisa.body||[]).length}`);
const lowerCase = await apiCall(API,'GET','/api/services?area=tembisa',undefined,ll.token);
(lowerCase.body||[]).length===1 ? ok('and matches an area typed in lower case') : bad(`"tembisa" returned ${(lowerCase.body||[]).length}`);

// Switching one on makes it visible — once the number has been rung.
const switchedTooEarly = await apiCall(API,'PATCH',`/api/services/admin/${p3.body.id}`,{active:true},A);
switchedTooEarly.status===400 ? ok('…and cannot be switched on later either, without the check') : bad(`switching on an unchecked provider returned ${switchedTooEarly.status}`);
await apiCall(API,'PATCH',`/api/services/admin/${p3.body.id}`,{phoneConfirmedAt:'2026-09-18T10:00:00.000Z'},A);
await apiCall(API,'PATCH',`/api/services/admin/${p3.body.id}`,{active:true},A);
const seen2 = await apiCall(API,'GET','/api/services',undefined,ll.token);
(seen2.body||[]).some(x=>x.name==='Draft Locksmith') ? ok('switching it on makes it visible') : bad('still hidden after activation');

// ── sponsorship: unreadable, unwritable, and not in the payload — Phase 7m ──
//
// This used to be one check: PATCH a sponsorship over the API and assert the
// order did not move. It passed, and it was testing the wrong half. The write
// it performed returned 200 and stored the date, which is the actual defect —
// an admin could sell a placement, be told it worked, and have nothing happen.
//
// So now: the write is refused, the field is absent from what a landlord's
// browser receives, and the ordering guard is tested against a row that really
// IS sponsored — set in the database, because the API can no longer set it.
// That last part is the stronger version of the old check: it exercises the
// condition the guard exists for instead of a write that is now impossible.

const sponsorWrite = await apiCall(API,'PATCH',`/api/services/admin/${p2.body.id}`,
  {sponsoredUntil:new Date(Date.now()+864e5*30).toISOString()},A);
sponsorWrite.status===400
  ? ok('an admin cannot set a sponsorship that nothing would honour')
  : bad(`setting sponsoredUntil returned ${sponsorWrite.status} — a write with no reader`);

const sponsorOnCreate = await apiCall(API,'POST','/api/services/admin',{
  category:'cleaner', name:'Sponsored On Create', phone:'0821234599', areas:['Tembisa'],
  phoneConfirmedAt:'2026-09-18T10:00:00.000Z',
  sponsoredUntil:new Date(Date.now()+864e5*30).toISOString(),
},A);
sponsorOnCreate.status===400
  ? ok('…nor smuggle one in on create')
  : bad(`creating with sponsoredUntil returned ${sponsorOnCreate.status}`);

// Set it the only way left, and read the directory as a landlord.
//
// Compared BEFORE and AFTER rather than against an expected sequence: Prisma
// orders an enum by its DECLARATION order, not alphabetically, so the correct
// order here is plumber, electrician, locksmith — which an alphabetical
// assertion called a failure. The claim being tested is that sponsorship
// changes nothing, so that is what is measured.
const before = ((await apiCall(API,'GET','/api/services',undefined,ll.token)).body||[]).map(x=>x.id);
dbQuery(`UPDATE service_providers SET "sponsoredUntil" = NOW() + INTERVAL '30 days' WHERE id = '${p2.body.id}'`);
const sponsoredList = (await apiCall(API,'GET','/api/services',undefined,ll.token)).body||[];
const sponsoredRow = sponsoredList.find(x=>x.id===p2.body.id);

// The precondition, asserted. A guard tested against a row that is not
// actually sponsored proves nothing in either direction — the same fault as
// the saved_rooms drive POSTing to a route that did not exist.
const stored = dbQuery(`SELECT "sponsoredUntil" FROM service_providers WHERE id = '${p2.body.id}'`);
/\d{4}-\d{2}-\d{2}/.test(stored)
  ? ok(`a genuinely sponsored provider exists to test against (precondition: ${stored.slice(0,10)})`)
  : bad('could not sponsor a provider in the database — the checks below prove nothing');

sponsoredRow && !('sponsoredUntil' in sponsoredRow)
  ? ok('a sponsored provider reaches the landlord with no sponsorship field at all')
  : bad(`sponsoredUntil is in the landlord payload (${JSON.stringify(sponsoredRow?.sponsoredUntil)}) — one client-side sort away from a paid directory`);

const after = ((await apiCall(API,'GET','/api/services',undefined,ll.token)).body||[]).map(x=>x.id);
JSON.stringify(before)===JSON.stringify(after) ? ok('…and does not jump the queue') : bad(`order changed after sponsoring: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

// Clean up after itself. The old version did not, which is how a live provider
// in the development database came to read "sponsored until 2026-11-03" — the
// drive set it to test the guard and walked away.
dbQuery(`UPDATE service_providers SET "sponsoredUntil" = NULL WHERE id = '${p2.body.id}'`);

// Delete, and the guard on it.
const delByLandlord = await apiCall(API,'DELETE',`/api/services/admin/${p3.body.id}`,undefined,ll.token);
delByLandlord.status===403 ? ok('a landlord cannot delete a provider') : bad(`landlord delete ${delByLandlord.status}`);
const del = await apiCall(API,'DELETE',`/api/services/admin/${p3.body.id}`,undefined,A);
del.status===200 ? ok('an admin can') : bad(`admin delete ${del.status}`);

console.log(fail?`\n❌ ${fail} failure(s)`:'\n✅ the service directory drives correctly');
process.exit(fail?1:0);
