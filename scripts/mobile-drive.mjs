/**
 * The phone, driven at 390px — the width most of this market actually uses.
 *
 * Every assertion here is a bug that reached production and was found by a
 * person using the site on their phone, not by any check in this repository.
 * That is the reason the file exists: the a11y and phase drives run at 412px
 * but neither opens the navigation drawer, signs in on a narrow viewport, or
 * follows a link and looks at where "back" goes.
 *
 * The five, as reported:
 *
 *   1. no way to log in on mobile — .nav-actions .btn-ghost is display:none at
 *      this width, and the rule's own comment claimed the action "moves into
 *      the drawer". It never did. Worse than reported: a signed-in landlord
 *      also had no Dashboard and no Log out, and an admin had nothing at all.
 *   2. the hero counted "verified landlords" without checking verification,
 *      and only across the loaded page, so the figure grew while scrolling.
 *   3. "1 rooms" on the board.
 *   5. a room opened from the landlord dashboard offered "Back to all rooms",
 *      because NavigationHistoryService is providedIn:'root' and was therefore
 *      first created BY the room page — it started listening after the
 *      navigation it existed to record.
 *
 * (4 was the house adverts still saying RentBoard, which is production data,
 * not code — prisma/seed-house-ads.ts fixes it and has never been run there.)
 *
 *   node scripts/mobile-drive.mjs
 *
 * Needs the API on :3000 and a development build served on :4200.
 */
import { chromium } from '@playwright/test';
import { registerUser, signIn, apiCall, PASSWORD } from './lib/drive-session.mjs';
const API='http://localhost:3000', WEB='http://localhost:4200';
let fail=0; const ok=m=>console.log('  ✅ '+m); const bad=m=>{console.log('  ❌ '+m);fail++;};

const ll = await registerUser(API,'LANDLORD'); const T=ll.token;
const r = await apiCall(API,'POST','/api/rooms',{roomType:'shared_house',title:'Vilakazi back room one',rentCents:250000,province:'Gauteng',city:'Johannesburg',locationDisplay:'Soweto',availableFrom:new Date(Date.now()+864e5).toISOString(),housematesCount:2,billsIncluded:true,description:'A clean single room in a quiet Soweto yard with a shared kitchen, an outside tap and a gate locked at night.'},T);
if(r.status>=300){bad(`room: ${JSON.stringify(r.body).slice(0,140)}`);process.exit(1);}
await apiCall(API,'PATCH',`/api/rooms/${r.body.id}/photos`,{paths:['rooms/demo/cover.jpg']},T);
await apiCall(API,'POST',`/api/rooms/${r.body.id}/publish`,{},T);

const browser = await chromium.launch();

// ── 1. Mobile login
const anon = await browser.newPage({ viewport: { width: 390, height: 844 } });
await anon.goto(`${WEB}/`,{waitUntil:'domcontentloaded'});
await anon.waitForTimeout(2000);
const loginVisibleBefore = await anon.locator('a[href="/auth/login"]:visible').count();
await anon.locator('.nav-burger').click();
await anon.waitForTimeout(500);
const loginVisibleAfter = await anon.locator('a[href="/auth/login"]:visible').count();
/**
 * ⚠️ Rewritten in Phase 7e, not deleted: the rule it encoded has been
 * superseded.
 *
 * As reported, the bug was "no way to log in on mobile" and the fix put Log in
 * in the DRAWER, so this asserted only that it was reachable after a tap. The
 * brief's item 23 asks for something stricter and better: Log in and Get
 * started belong in the header itself, because they are what the header is for
 * and a returning visitor should not have to find a hamburger first. So the
 * check now requires it BEFORE the drawer is opened — the old assertion would
 * pass on a header that showed neither.
 *
 * scripts/nav-ui-drive.mjs measures the pair at 360, 390 and 430px, with the
 * tap target and the overcrowding. This keeps the originally-reported bug's own
 * check next to the other four from that report.
 */
loginVisibleBefore > 0
  ? ok(`Log in is in the HEADER on a 390px phone, before any tap (${loginVisibleBefore} visible)`)
  : bad('Log in is not in the mobile header — item 23 wants it there, not behind the hamburger');
loginVisibleAfter > 0
  ? ok(`…and still reachable with the drawer open (${loginVisibleAfter} visible)`)
  : bad('opening the drawer hides the header Log in');
console.log(`     (before opening the drawer: ${loginVisibleBefore} visible)`);

// ── 3. Pluralisation
const board = (await anon.locator('body').textContent()) ?? '';
/\b1 rooms\b/.test(board) ? bad('the board says "1 rooms"') : ok('no "1 rooms" anywhere on the board');
const cue = (await anon.locator('.hero-scroll-cue span').first().textContent() ?? '').trim();
/^\d+ rooms?$/.test(cue) ? ok(`the scroll cue reads "${cue}"`) : bad(`scroll cue reads "${cue}"`);

// ── 2. Hero stat must not count an unverified landlord
const stats = await anon.locator('.hero-stat strong').allTextContents();
const verified = Number(stats[1] ?? '-1');
verified === 0 ? ok('verified landlords reads 0 while the only landlord is unverified') : bad(`verified landlords reads ${verified} with no verified landlord on the board`);

// ── 5. Back link from a landlord's own dashboard
const page = await signIn(browser, WEB, ll.email, PASSWORD, { width: 390, height: 844 });
// Signed in on mobile: dashboard and logout must be reachable too.
await page.goto(`${WEB}/`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1800);
await page.locator('.nav-burger').click();
await page.waitForTimeout(500);
(await page.locator('a[href="/landlord/dashboard"]:visible').count()) ? ok('a signed-in landlord can reach the dashboard on mobile') : bad('no visible Dashboard link on mobile when signed in');
(await page.getByRole('button',{name:/log ?out/i}).count()) ? ok('and can log out') : bad('no Log out on mobile when signed in');

await page.goto(`${WEB}/landlord/dashboard`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(2200);
await page.locator('a[href^="/rooms/"]').first().click();
await page.waitForTimeout(2500);
const backLabel = ((await page.locator('.detail__back a, a').filter({hasText:/Back to/}).first().textContent()) ?? '').trim();
backLabel.includes('your dashboard')
  ? ok(`back link from the dashboard reads "${backLabel}"`)
  : bad(`back link reads "${backLabel}" — should return to the dashboard`);

await browser.close();
console.log(fail?`\n❌ ${fail} failure(s)`:'\n✅ all reported bugs fixed');
process.exit(fail?1:0);
