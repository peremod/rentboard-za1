/**
 * Lease terms, renewal windows and notice — Phase 4c.
 *
 * Kept as a script rather than folded into smoke-test.sh because building the
 * fixtures takes three full tenancies (room, tenant, application, accept) and
 * the interesting assertions are about DATES: a 20-day fixed term is inside the
 * window, a 200-day one is not, backdated notice is already overdue, and a
 * rolling tenancy with no notice must appear in neither list.
 *
 *   node scripts/lease-drive.mjs
 *
 * Needs the API on :3000.
 */
import { registerUser, apiCall } from './lib/drive-session.mjs';
const API='http://localhost:3000';
let fail=0; const ok=m=>console.log('  ✅ '+m); const bad=m=>{console.log('  ❌ '+m);fail++;};
const iso=d=>d.toISOString().slice(0,10);
const inDays=n=>{const d=new Date();d.setDate(d.getDate()+n);return d;};

const ll = await registerUser(API,'LANDLORD'); const T=ll.token;

// Build a tenancy: room, tenant, application, accept.
async function tenancy(title){
  const r = await apiCall(API,'POST','/api/rooms',{roomType:'shared_house',title,rentCents:250000,province:'Gauteng',city:'Johannesburg',locationDisplay:'Soweto',availableFrom:iso(inDays(1)),housematesCount:2,billsIncluded:true,description:'A clean single room in a quiet Soweto yard with a shared kitchen, an outside tap and a gate locked at night.'},T);
  if(r.status>=300){bad(`room: ${JSON.stringify(r.body).slice(0,140)}`);return null;}
  await apiCall(API,'PATCH',`/api/rooms/${r.body.id}/photos`,{paths:['rooms/demo/cover.jpg']},T);
  await apiCall(API,'POST',`/api/rooms/${r.body.id}/publish`,{},T);
  const tn = await registerUser(API,'TENANT');
  const app = await apiCall(API,'POST','/api/applications',{roomId:r.body.id,coverNote:'I would like this room please, I can move in at the start of the month.'},tn.token);
  if(app.status>=300){bad(`apply: ${JSON.stringify(app.body).slice(0,160)}`);return null;}
  const acc = await apiCall(API,'POST',`/api/applications/${app.body.id}/accept`,{},T);
  if(acc.status>=300){bad(`accept: ${JSON.stringify(acc.body).slice(0,160)}`);return null;}
  // Accepting creates the tenancy asynchronously, so poll rather than assume
  // it is there on the next read — the first version of this drive looked once
  // and found the PREVIOUS room's tenancy, which looked like a query bug.
  for (let attempt = 0; attempt < 20; attempt++) {
    const mine = await apiCall(API,'GET','/api/tenancies/mine',undefined,T);
    const list = Array.isArray(mine.body) ? mine.body : (mine.body?.data ?? []);
    const found = list.find(x => x.room?.id === r.body.id || x.roomId === r.body.id);
    if (found) return { id: found.id, roomId: r.body.id };
    await new Promise((res) => setTimeout(res, 250));
  }
  bad(`no tenancy appeared for room ${r.body.id} within 5s of accepting`);
  return null;
}

const fixedSoon = await tenancy('Lease ending soon room');
const rolling   = await tenancy('Month to month room');
const fixedFar  = await tenancy('Lease far away room');
if(!fixedSoon||!rolling||!fixedFar){console.log('\n❌ fixtures failed');process.exit(1);}
ok('three tenancies created');

// Default notice period.
const mine0 = await apiCall(API,'GET','/api/tenancies/mine',undefined,T);
(mine0.body||[])[0]?.noticePeriodDays === 30 ? ok('notice period defaults to 30 days') : bad(`default noticePeriodDays: ${(mine0.body||[])[0]?.noticePeriodDays}`);

// Nothing is happening yet, so nothing should be flagged.
const u0 = await apiCall(API,'GET','/api/tenancies/upcoming',undefined,T);
u0.status===200 ? ok('upcoming returns') : bad(`upcoming ${u0.status} ${JSON.stringify(u0.body).slice(0,160)}`);
(u0.body||[]).length===0 ? ok('a month-to-month tenancy with no notice is NOT flagged') : bad(`flagged ${u0.body.length} with nothing happening`);

// A fixed term inside the window, and one outside it.
await apiCall(API,'PATCH',`/api/tenancies/${fixedSoon.id}/lease`,{leaseEndDate:iso(inDays(20))},T);
await apiCall(API,'PATCH',`/api/tenancies/${fixedFar.id}/lease`,{leaseEndDate:iso(inDays(200))},T);
const u1 = await apiCall(API,'GET','/api/tenancies/upcoming',undefined,T);
const ids1=(u1.body||[]).map(x=>x.tenancyId);
ids1.length===1 && ids1[0]===fixedSoon.id ? ok('only the lease inside the 30-day window is flagged') : bad(`flagged ${ids1.length}: ${JSON.stringify((u1.body||[]).map(x=>({r:x.room?.title,d:x.daysUntilEmpty})))}`);
const row=(u1.body||[])[0];
row?.reason==='lease_ending' ? ok(`and says why: ${row.reason}`) : bad(`reason ${row?.reason}`);
row?.daysUntilEmpty===20 ? ok('with the right countdown (20 days)') : bad(`daysUntilEmpty ${row?.daysUntilEmpty}`);

// Notice on the rolling tenancy starts a countdown.
const n = await apiCall(API,'POST',`/api/tenancies/${rolling.id}/notice`,{givenBy:'tenant'},T);
n.status===201||n.status===200 ? ok('notice is recorded on a month-to-month tenancy') : bad(`notice ${n.status} ${JSON.stringify(n.body).slice(0,160)}`);
const u2 = await apiCall(API,'GET','/api/tenancies/upcoming',undefined,T);
const rollRow=(u2.body||[]).find(x=>x.tenancyId===rolling.id);
rollRow ? ok('and it now appears as needing attention') : bad('notice did not surface it');
rollRow?.reason==='notice_given' ? ok(`reason is ${rollRow.reason}, not lease_ending`) : bad(`reason ${rollRow?.reason}`);
rollRow?.daysUntilEmpty===30 ? ok('countdown runs the notice period (30 days)') : bad(`countdown ${rollRow?.daysUntilEmpty}`);
rollRow?.noticeGivenBy==='the tenant' ? ok(`and names who gave it: "${rollRow.noticeGivenBy}"`) : bad(`noticeGivenBy ${rollRow?.noticeGivenBy}`);

// Giving notice twice must not restart the clock.
const again = await apiCall(API,'POST',`/api/tenancies/${rolling.id}/notice`,{givenBy:'landlord',givenOn:iso(inDays(0))},T);
const u3 = await apiCall(API,'GET','/api/tenancies/upcoming',undefined,T);
const rollRow2=(u3.body||[]).find(x=>x.tenancyId===rolling.id);
rollRow2?.noticeGivenBy==='the tenant' ? ok('a second notice does not overwrite who gave the first') : bad(`overwritten to ${rollRow2?.noticeGivenBy}`);

// Backdated notice can already be overdue, and must be shown not hidden.
await apiCall(API,'POST',`/api/tenancies/${fixedFar.id}/notice`,{givenBy:'landlord',givenOn:iso(inDays(-40))},T);
const u4 = await apiCall(API,'GET','/api/tenancies/upcoming',undefined,T);
const od=(u4.body||[]).find(x=>x.tenancyId===fixedFar.id);
od?.overdue === true ? ok(`backdated notice shows as overdue (${od.daysUntilEmpty} days)`) : bad(`overdue flag: ${od?.overdue}, days ${od?.daysUntilEmpty}`);

// Withdraw.
await apiCall(API,'POST',`/api/tenancies/${rolling.id}/notice/withdraw`,{},T);
const u5 = await apiCall(API,'GET','/api/tenancies/upcoming',undefined,T);
!(u5.body||[]).some(x=>x.tenancyId===rolling.id) ? ok('withdrawing notice clears it from the list') : bad('still listed after withdrawal');

// Converting a fixed term to month-to-month.
await apiCall(API,'PATCH',`/api/tenancies/${fixedSoon.id}/lease`,{leaseEndDate:null},T);
const u6 = await apiCall(API,'GET','/api/tenancies/upcoming',undefined,T);
!(u6.body||[]).some(x=>x.tenancyId===fixedSoon.id) ? ok('sending leaseEndDate null converts it to month-to-month') : bad('still flagged after going rolling');

// Another landlord.
const other = await registerUser(API,'LANDLORD');
const theft = await apiCall(API,'PATCH',`/api/tenancies/${fixedSoon.id}/lease`,{noticePeriodDays:7},other.token);
theft.status===403 ? ok('another landlord cannot change your lease terms') : bad(`cross-tenant lease edit ${theft.status}`);

console.log(fail?`\n❌ ${fail} failure(s)`:'\n✅ lease renewal and notice drive correctly');
process.exit(fail?1:0);
