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

/**
 * ⚠️ The property DETAIL screen, and the property that makes it exist.
 *
 * This drive went to /landlord/yard, which v1.87.0 (Phase 7b) turned into a
 * redirect to /landlord/properties — the LIST. The #ending-soon card lives on
 * the yard component, which moved to /landlord/properties/:propertyId. So for
 * four releases every check below was looking at a page of property cards:
 * "no card when nothing is ending" passed because the card can never be there,
 * and the four checks after it failed. A drive that is red for a structural
 * reason teaches people to ignore it being red.
 *
 * The property also has to exist and hold the rooms: Phase 7b made grouping
 * optional, and a landlord with no property gets the teaching empty state.
 * Same fault, same release, found the same day in lease-docs-ui-drive.
 */
const prop = (await apiCall(API,'POST','/api/properties',
  {name:'Lease yard',city:'Johannesburg',province:'Gauteng',suburb:'Soweto'},T)).body;
const YARD = `${WEB}/landlord/properties/${prop?.id}`;

const browser = await chromium.launch();
const page = await signIn(browser, WEB, ll.email, PASSWORD, {width:390, height:844});

// Nothing happening yet: no card at all.
await page.goto(YARD,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(2500);
(await page.locator('#ending-soon').count())===0 ? ok('no card when nothing is ending — not an empty "Rooms coming up"') : bad('empty panel rendered');
// ⚠️ …and the screen it is absent FROM is the right one. Without this the
// check above passes on any page in the app that has no such card, which is
// how it survived pointing at a redirect.
(await page.locator('#money').count()) ? ok('…on the yard itself, which is the screen the card belongs to') : bad('this is not the yard screen — the absence above proves nothing');

const fixed = await tenancy('Lease ending soon room');
const rolling = await tenancy('Month to month room');
if(!fixed||!rolling){console.log('\n❌ fixtures failed');process.exit(1);}
await apiCall(API,'POST',`/api/properties/${prop?.id}/rooms`,{roomIds:[fixed.roomId, rolling.roomId]},T);
await apiCall(API,'PATCH',`/api/tenancies/${fixed.id}/lease`,{leaseEndDate:iso(inDays(12))},T);

await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(2500);
(await page.locator('#ending-soon').count()) ? ok('the card appears once a lease is inside the window') : bad('no card with a lease ending in 12 days');
const body1=(await page.locator('body').textContent()) ?? '';
body1.includes('in 12 days') ? ok('the countdown reads "in 12 days", not a raw date') : bad(`countdown text missing: ${body1.match(/in \d+ days/g)}`);
body1.includes('Lease ending soon room') ? ok('and names the room') : bad('room not named');
const rows1 = await page.locator('.lease-row').count();
rows1===1 ? ok('the rolling tenancy is not listed') : bad(`${rows1} rows — a month-to-month tenancy is being listed`);

/**
 * ⚠️ Both tenancies are still PENDING here, and that is the state this drive
 * spent four releases in without noticing.
 *
 * Accepting an application opens a tenancy with status `pending`; nothing in
 * the fixture above confirmed a move-in. `LeaseService.upcoming()` includes
 * pending rows on purpose, so the panel rendered — but `giveNotice()` REFUSES
 * a pending tenancy ("This tenancy has not started yet. If it has fallen
 * through, mark it as such instead"), so the notice half of this drive was
 * driving a button that could not work. It read as three product failures and
 * a 30-second timeout.
 *
 * It was a real defect as well as a fixture bug: the button was offered, and
 * the panel answered every failure with "That did not save. Check your
 * connection and try again." Both are fixed, so both are now checked — here,
 * while the rows are genuinely pending.
 */
{
  const pendingText = (await page.locator('.lease-row').first().textContent()) ?? '';
  !/They are leaving/i.test(pendingText)
    ? ok('a tenancy nobody has moved into does not offer "They are leaving" — the API refuses it')
    : bad('"They are leaving" offered on a pending tenancy, where giveNotice() answers 400');
  /They are leaving|Confirm or cancel the move-in/i.test(pendingText) && /Confirm or cancel the move-in/i.test(pendingText)
    ? ok('…it points at the move-in instead, which is the thing that is actually waiting')
    : bad('no move-in action offered on a pending row — the landlord is given nothing to do');
  // Renew and "let it roll" are NOT gated: the API allows lease terms to be
  // edited before move-in, and both are driven green below.
  /Renew for a year/i.test(pendingText) && /Let it roll on/i.test(pendingText)
    ? ok('…while renew and "let it roll on" stay, because the API allows them before move-in')
    : bad('renew or "let it roll on" disappeared from a pending row — over-gated');
}

/**
 * Somebody moves in. Everything below is the lease of a LIVE tenancy, which is
 * what the rest of this drive was always written for.
 */
for (const t of [fixed, rolling]) {
  const started = await apiCall(API,'POST',`/api/tenancies/${t.id}/confirm-start`,{},T);
  if (started.status >= 300) { bad(`confirm-start failed: ${started.status} ${JSON.stringify(started.body).slice(0,160)}`); }
}
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(2500);

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

/**
 * ⚠️ What the panel SAYS when the API refuses.
 *
 * Every error handler here used to set "That did not save. Check your
 * connection and try again." for every failure, including the ones the API
 * explains in a sentence written for a person. That is how the pending-tenancy
 * bug above stayed invisible: the server said "This tenancy has not started
 * yet. If it has fallen through, mark it as such instead" and the screen told
 * the landlord to check their signal.
 *
 * Provoked the way it actually happens — the screen going stale. Notice is
 * given, the row renders its undo, and the notice is then withdrawn behind the
 * screen (a second tab, or the tenant). The stale "Notice was a mistake" then
 * answers 400 "No notice has been given on this tenancy."
 */
{
  await apiCall(API,'POST',`/api/tenancies/${rolling.id}/notice`,{givenBy:'tenant'},T);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2500);
  // …and now it is withdrawn behind the screen's back.
  const gone = await apiCall(API,'POST',`/api/tenancies/${rolling.id}/notice/withdraw`,{},T);
  if (gone.status >= 300) bad(`could not withdraw behind the screen: ${gone.status}`);
  await page.getByRole('button',{name:/Notice was a mistake/i}).first().click();
  await page.waitForTimeout(2200);
  const shown = (await page.locator('.field-error').textContent().catch(() => '')) ?? '';
  shown.includes('No notice has been given on this tenancy')
    ? ok('a refusal is reported in the API\'s own words')
    : bad(`the refusal was not surfaced — the panel said: "${shown.trim().slice(0,120)}"`);
  !/check your connection/i.test(shown)
    ? ok('…and does not blame the connection for a 400')
    : bad('a 400 is reported as a connection problem');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2000);
}

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

// ── Both Phase 4 cards on one screen ──────────────────────────────────────
//
// Expenses and lease renewal were built on separate branches and both added a
// card at the same point in the yard template, so the merge had to order them.
// This is the assertion that ordering is actually sound on a rendered page:
// the a11y drive's landlord has neither card, so its green yard page says
// nothing about the two of them together — the same data-dependent blind spot
// that made an earlier heading defect look environmental.
const both = await page.locator('#ending-soon, #money').evaluateAll((els) =>
  els.map((el) => el.id),
);
both.length === 2
  ? ok('the lease panel and the money card both render on one yard')
  : bad(`only ${both.join(' + ') || 'neither'} rendered — the combined case is untested`);

both[0] === 'ending-soon'
  ? ok('and the thing with a deadline comes first')
  : bad(`document order is ${both.join(' then ')} — the money card has no deadline and should not lead`);

// The whole page, not just the panel. Two adjacent h2s are fine; an h3 that
// now arrives before its h2 is the defect a merge of two sections can cause.
const order = await page.locator('h1,h2,h3,h4').evaluateAll((els) =>
  els.filter((el) => (el.offsetWidth || el.offsetHeight)).map((el) => Number(el.tagName[1])),
);
const skip = order.findIndex((lvl, i) => i > 0 && lvl > order[i - 1] + 1);
order[0] === 1 && skip === -1
  ? ok(`heading order holds with both cards up (${order.map((l) => 'H' + l).join(' → ')})`)
  : bad(`heading order broken at position ${skip}: ${order.map((l) => 'H' + l).join(' → ')}`);

await browser.close();
console.log(fail?`\n❌ ${fail} failure(s)`:'\n✅ the lease panel drives correctly');
process.exit(fail?1:0);
