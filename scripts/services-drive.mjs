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
import { registerUser, apiCall } from './lib/drive-session.mjs';
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
const p1 = await apiCall(API,'POST','/api/services/admin',{category:'plumber',name:'Sipho — Tembisa Plumbing',phone:'082 123 4567',areas:['Tembisa','Kempton Park'],note:'Geysers and blocked drains.',active:true},A);
p1.status===201 ? ok('admin adds a plumber') : bad(`create ${p1.status} ${JSON.stringify(p1.body).slice(0,200)}`);
p1.body.phone==='+27821234567' ? ok(`"082 123 4567" is stored as ${p1.body.phone}`) : bad(`stored as ${p1.body.phone}`);

// The same number in another format must normalise identically.
const p2 = await apiCall(API,'POST','/api/services/admin',{category:'electrician',name:'Thabo Electrical',phone:'+27 82 765 4321',areas:['Soweto'],active:true},A);
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

// Switching one on makes it visible.
await apiCall(API,'PATCH',`/api/services/admin/${p3.body.id}`,{active:true},A);
const seen2 = await apiCall(API,'GET','/api/services',undefined,ll.token);
(seen2.body||[]).some(x=>x.name==='Draft Locksmith') ? ok('switching it on makes it visible') : bad('still hidden after activation');

// sponsoredUntil must not change the order — nothing reads it yet.
//
// Compared BEFORE and AFTER rather than against an expected sequence: Prisma
// orders an enum by its DECLARATION order, not alphabetically, so the correct
// order here is plumber, electrician, locksmith — which an alphabetical
// assertion called a failure. The claim being tested is that sponsorship
// changes nothing, so that is what is measured.
const before = ((await apiCall(API,'GET','/api/services',undefined,ll.token)).body||[]).map(x=>x.id);
await apiCall(API,'PATCH',`/api/services/admin/${p2.body.id}`,{sponsoredUntil:new Date(Date.now()+864e5*30).toISOString()},A);
const after = ((await apiCall(API,'GET','/api/services',undefined,ll.token)).body||[]).map(x=>x.id);
JSON.stringify(before)===JSON.stringify(after) ? ok('sponsoredUntil does not jump the queue') : bad(`order changed after sponsoring: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

// Delete, and the guard on it.
const delByLandlord = await apiCall(API,'DELETE',`/api/services/admin/${p3.body.id}`,undefined,ll.token);
delByLandlord.status===403 ? ok('a landlord cannot delete a provider') : bad(`landlord delete ${delByLandlord.status}`);
const del = await apiCall(API,'DELETE',`/api/services/admin/${p3.body.id}`,undefined,A);
del.status===200 ? ok('an admin can') : bad(`admin delete ${del.status}`);

console.log(fail?`\n❌ ${fail} failure(s)`:'\n✅ the service directory drives correctly');
process.exit(fail?1:0);
