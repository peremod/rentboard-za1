import { chromium } from '@playwright/test';
import { registerUser, signIn, apiCall, PASSWORD } from './lib/drive-session.mjs';
const API='http://localhost:3000', WEB='http://localhost:4200';
let fail=0; const ok=m=>console.log('  ✅ '+m); const bad=m=>{console.log('  ❌ '+m);fail++;};

const A=(await apiCall(API,'POST','/api/auth/login',{email:'ci-admin@mastande.test',password:'CiSmokeAdmin123'})).body.accessToken;
for(const e of ((await apiCall(API,'GET','/api/services/admin/all',undefined,A)).body||[])) await apiCall(API,'DELETE',`/api/services/admin/${e.id}`,undefined,A);

const ll = await registerUser(API,'LANDLORD');
const browser = await chromium.launch();

// ── Landlord sees an honest empty state, and the disclaimer
const page = await signIn(browser, WEB, ll.email, PASSWORD, {width:390, height:844});
await page.goto(`${WEB}/landlord/services`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(2500);
let body=(await page.locator('body').textContent()) ?? '';
body.includes('Nobody listed yet') ? ok('empty directory says so plainly') : bad('no empty state');
body.includes('take') && body.includes('no money') ? ok('and states we do not book or take money') : bad('disclaimer missing');
(await page.locator('.nav-links a[href="/landlord/services"], a[href="/landlord/services"]').count()) ? ok('reachable from the landlord nav') : bad('no nav entry');

// ── Admin adds one through the form
const admin = await signIn(browser, WEB, 'ci-admin@mastande.test', 'CiSmokeAdmin123', {width:390, height:844});
await admin.goto(`${WEB}/admin/services`,{waitUntil:'domcontentloaded'});
await admin.waitForTimeout(2500);
(await admin.locator('.provider-form').count()) ? ok('the admin form renders') : bad('no admin form');

await admin.locator('.provider-form input[name=name]').fill('Sipho — Tembisa Plumbing');
await admin.locator('.provider-form input[name=phone]').fill('082 123 4567');
await admin.locator('.provider-form input[name=areas]').fill('Tembisa, Kempton Park');
await admin.locator('.provider-form input[name=note]').fill('Geysers and blocked drains.');
await admin.getByRole('button',{name:/Add, switched off/i}).click();
await admin.waitForTimeout(2200);
body=(await admin.locator('body').textContent()) ?? '';
body.includes('Sipho') ? ok('the provider is added') : bad('provider not listed after adding');
body.includes('+27821234567') ? ok('and the number shows normalised as +27821234567') : bad(`number not normalised on screen: ${body.match(/\+?27[\d]+/g)}`);
body.includes('Not live') ? ok('marked "Not live" — off by default') : bad('no not-live marker');
body.includes('(0 live)') ? ok('and the live count is 0') : bad(`live count wrong: ${body.match(/\(\d+ live\)/)}`);

// A bad number surfaces the API's own message, not a generic failure.
//
// 0123456789 is long enough to pass the DTO's length rule and is NOT a South
// African mobile (those start 06, 07 or 08), so it reaches the normaliser. My
// first attempt used "12345", which the length rule caught first — the message
// shown was about length, which was correct behaviour and a wrong test.
await admin.locator('.provider-form input[name=name]').fill('Not A Number');
await admin.locator('.provider-form input[name=phone]').fill('0123456789');
await admin.locator('.provider-form input[name=areas]').fill('Soweto');
await admin.getByRole('button',{name:/Add, switched off/i}).click();
await admin.waitForTimeout(2000);
// The message arrives in the global dialog, not inline: the error interceptor
// owns 400s that carry a string, and the component deliberately does not
// duplicate it — see the note there.
const dlg1 = (await admin.locator('[role=alertdialog]').textContent()) ?? '';
dlg1.includes('South African mobile')
  ? ok("a number that is not a SA mobile shows the API's own explanation") : bad(`dialog said: ${dlg1.slice(0,120)}`);
await admin.locator('[role=alertdialog] button').last().click();
await admin.waitForTimeout(600);

// Waiting for the dialog to actually go before touching the form again: the
// first attempt clicked submit while it was animating out, the overlay ate the
// click, and no second dialog appeared — which read as a missing error.
await admin.locator('[role=alertdialog]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});

const inlineDupes = (await admin.locator('.field-error').allTextContents()).filter((t) => t.includes('mobile'));
inlineDupes.length === 0 ? ok('and the same sentence is not repeated inline under the form') : bad(`duplicated inline: ${JSON.stringify(inlineDupes)}`);

// Landlord still sees nothing while it is off.
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(2200);
((await page.locator('body').textContent()) ?? '').includes('Sipho') === false
  ? ok('a landlord cannot see a provider that is switched off') : bad('inactive provider visible to landlord');

// ── Switch on, which now needs the number rung first — Phase 7j ───────────
//
// ⚠️ This drive used to click "Switch on" straight away, and it started
// timing out on a DISABLED button carrying the reason in its title. That is the
// control working: the directory tells landlords these names were checked, so
// nobody is listed until an admin has rung the number and recorded it.
//
// Driven through the admin UI's own "Record it" button rather than patched in
// over the API, because the button is the thing a person uses and a drive that
// goes around it would not notice if it broke.
await admin.reload({waitUntil:'domcontentloaded'});
await admin.waitForTimeout(2200);

const switchBtn = admin.getByRole('button',{name:'Switch on'}).first();
(await switchBtn.isDisabled())
  ? ok('"Switch on" is disabled until the number has been rung, with the reason on it')
  : bad('an unchecked provider can be switched on from the admin screen');
((await admin.locator('.svc-blocked').first().textContent()) ?? '').match(/ring the number/i)
  ? ok('…and the reason is on the screen, not only in a title attribute')
  : bad('nothing on screen says why the provider cannot be listed');

await admin.locator('.svc-checks li').filter({hasText:'Rang the number'}).locator('button:has-text("Record it")').click();
await admin.waitForTimeout(2200);
((await admin.locator('.svc-checks').first().textContent()) ?? '').includes('✓')
  ? ok('recording the call ticks it off on the row')
  : bad('the recorded check did not appear on the row');

await admin.getByRole('button',{name:'Switch on'}).first().click();
await admin.waitForTimeout(2200);
((await admin.locator('body').textContent()) ?? '').includes('(1 live)') ? ok('switching on updates the live count') : bad('live count did not change');

// Landlord now sees it, with working links.
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(2500);
body=(await page.locator('body').textContent()) ?? '';
body.includes('Sipho') ? ok('the landlord now sees it') : bad('still hidden after switch-on');
body.includes('Plumber') ? ok('grouped under its trade in plain English') : bad('trade heading missing');
const tel = await page.locator('a[href^="tel:"]').first().getAttribute('href');
tel === 'tel:+27821234567' ? ok(`the call link is ${tel}`) : bad(`tel link is ${tel}`);
const wa = await page.locator('a[href^="https://wa.me/"]').first().getAttribute('href');
wa === 'https://wa.me/27821234567' ? ok(`and the WhatsApp link drops the +: ${wa}`) : bad(`wa link is ${wa}`);

// Area filter from the landlord's side.
await page.locator('.services-filter input[name=area]').fill('tembisa');
await page.getByRole('button',{name:'Filter'}).click();
await page.waitForTimeout(1800);
((await page.locator('body').textContent()) ?? '').includes('Sipho')
  ? ok('filtering by "tembisa" in lower case still finds them') : bad('lower-case area filter found nothing');

await page.locator('.services-filter input[name=area]').fill('Cape Town');
await page.getByRole('button',{name:'Filter'}).click();
await page.waitForTimeout(1800);
((await page.locator('body').textContent()) ?? '').includes('nobody for Cape Town')
  ? ok('and an area with nobody says so, naming the area') : bad('unhelpful empty state for a filtered area');

await browser.close();
console.log(fail?`\n❌ ${fail} failure(s)`:'\n✅ the directory UI drives correctly');
process.exit(fail?1:0);
