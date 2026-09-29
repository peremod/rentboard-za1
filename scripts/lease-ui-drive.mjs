import { chromium } from '@playwright/test';
import { registerUser, signIn, apiCall, PASSWORD } from './lib/drive-session.mjs';
const API='http://localhost:3000', WEB='http://localhost:4200';
let fail=0; const ok=m=>console.log('  ✅ '+m); const bad=m=>{console.log('  ❌ '+m);fail++;};
const iso=d=>d.toISOString().slice(0,10);
const inDays=n=>{const d=new Date();d.setDate(d.getDate()+n);return d;};

const ll = await registerUser(API,'LANDLORD'); const T=ll.token;
async function tenancy(title){
  const r = await apiCall(API,'POST','/api/rooms',{roomType:'shared_house',title,rentCents:250000,province:'Gauteng',city:'Johannesburg',locationDisplay:'Soweto',availableFrom:iso(inDays(1)),housematesCount:2,billsIncluded:true,description:'A clean single room in a quiet Soweto yard with a shared kitchen, an outside tap and a gate locked at night.'},T);
  await apiCall(API,'PATCH',`/api/rooms/${r.body.id}/photos`,{paths:['rooms/demo/cover.jpg']},T);
  await apiCall(API,'POST',`/api/rooms/${r.body.id}/publish`,{},T);
  const tn = await registerUser(API,'TENANT');
  const app = await apiCall(API,'POST','/api/applications',{roomId:r.body.id,coverNote:'I would like this room please, I can move in at the start of the month.'},tn.token);
  await apiCall(API,'POST',`/api/applications/${app.body.id}/accept`,{},T);
  for(let i=0;i<20;i++){
    const mine=await apiCall(API,'GET','/api/tenancies/mine',undefined,T);
    const f=(mine.body||[]).find(x=>x.roomId===r.body.id);
    if(f) return {id:f.id, roomId:r.body.id};
    await new Promise(res=>setTimeout(res,250));
  }
  bad(`no tenancy for ${title}`); return null;
}

const browser = await chromium.launch();
const page = await signIn(browser, WEB, ll.email, PASSWORD, {width:390, height:844});

// Nothing happening yet: no card at all.
await page.goto(`${WEB}/landlord/yard`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(2500);
(await page.locator('#ending-soon').count())===0 ? ok('no card when nothing is ending — not an empty "Rooms coming up"') : bad('empty panel rendered');

const fixed = await tenancy('Lease ending soon room');
const rolling = await tenancy('Month to month room');
if(!fixed||!rolling){console.log('\n❌ fixtures failed');process.exit(1);}
await apiCall(API,'PATCH',`/api/tenancies/${fixed.id}/lease`,{leaseEndDate:iso(inDays(12))},T);

await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(2500);
(await page.locator('#ending-soon').count()) ? ok('the card appears once a lease is inside the window') : bad('no card with a lease ending in 12 days');
const body1=(await page.locator('body').textContent()) ?? '';
body1.includes('in 12 days') ? ok('the countdown reads "in 12 days", not a raw date') : bad(`countdown text missing: ${body1.match(/in \d+ days/g)}`);
body1.includes('Lease ending soon room') ? ok('and names the room') : bad('room not named');
const rows1 = await page.locator('.lease-row').count();
rows1===1 ? ok('the rolling tenancy is not listed') : bad(`${rows1} rows — a month-to-month tenancy is being listed`);

// Renew.
await page.getByRole('button',{name:/Renew for a year/i}).first().click();
await page.waitForTimeout(2000);
(await page.locator('.lease-row').count())===0 ? ok('renewing for a year clears it from the list') : bad('still listed after renewing');

// Let it roll on.
await apiCall(API,'PATCH',`/api/tenancies/${fixed.id}/lease`,{leaseEndDate:iso(inDays(5))},T);
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(2500);
await page.getByRole('button',{name:/Let it roll on/i}).first().click();
await page.waitForTimeout(2000);
(await page.locator('.lease-row').count())===0 ? ok('"Let it roll on" converts it to month to month') : bad('still listed after going rolling');

// Notice, via the UI, with its confirmation.
await apiCall(API,'PATCH',`/api/tenancies/${rolling.id}/lease`,{leaseEndDate:iso(inDays(8))},T);
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(2500);
await page.getByRole('button',{name:/They are leaving/i}).first().click();
await page.waitForTimeout(700);
const dialogText=(await page.locator('body').textContent()) ?? '';
dialogText.includes('gave notice') ? ok('"They are leaving" asks first, naming the consequence') : bad('no confirmation shown');
await page.getByRole('button',{name:/Yes, they gave notice/i}).first().click();
await page.waitForTimeout(2200);
const body2=(await page.locator('body').textContent()) ?? '';
body2.includes('They gave notice') ? ok('the row now says who gave notice') : bad('notice attribution missing after logging it');
(await page.getByRole('link',{name:/Get it back on the board/i}).count()) ? ok('and offers the relist action instead of renew') : bad('relist action missing');

// Undo.
await page.getByRole('button',{name:/Notice was a mistake/i}).first().click();
await page.waitForTimeout(2200);
((await page.locator('body').textContent()) ?? '').includes('They gave notice') === false
  ? ok('undoing notice puts it back to a lease decision') : bad('notice still shown after undo');

// ── Accessibility of the panel itself ─────────────────────────────────────
//
// scripts/a11y-drive.mjs does NOT cover this panel: its landlord has no
// tenancies, so the panel renders nothing during that run and 23 green pages
// say nothing about it. Rather than make every a11y run build a tenancy, the
// two things most likely to break are checked here, where it is already on
// screen.
await apiCall(API,'PATCH',`/api/tenancies/${rolling.id}/lease`,{leaseEndDate:iso(inDays(8))},T);
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(2500);

const unnamed = await page.locator('#ending-soon button, #ending-soon a').evaluateAll((els) =>
  els.filter((el) => !(el.textContent ?? '').trim() && !el.getAttribute('aria-label')).length,
);
unnamed === 0 ? ok('every control in the panel has an accessible name') : bad(`${unnamed} unnamed control(s) in the panel`);

// The panel sits under the page h1, so its heading must be an h2. Getting this
// wrong is the defect the accessibility drive caught twice already, and it
// cannot catch it here.
const level = await page.locator('#ending-soon h2, #ending-soon h3').evaluateAll((els) =>
  els.map((el) => el.tagName).join(','),
);
level === 'H2' ? ok('its heading is an H2, following the page H1') : bad(`panel heading is ${level}, which skips or repeats a level`);

await browser.close();
console.log(fail?`\n❌ ${fail} failure(s)`:'\n✅ the lease panel drives correctly');
process.exit(fail?1:0);
