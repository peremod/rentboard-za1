/**
 * Sub-letting on screen — Phase 6.
 *
 * ── What only a browser can prove here
 *
 * Three things, and each one has a history in this codebase:
 *
 *   1. That a tenant can FIND the flow. A sub-letting feature reachable only by
 *      typing /tenant/sublet/new is a feature nobody uses — the same shape as
 *      the landlord verification screen that existed for releases with nothing
 *      linking to it.
 *   2. That an applicant is TOLD. The disclaimer is the whole legal and moral
 *      point of the phase; the brief says surface it plainly to applicants, and
 *      a notice that renders below the fold or only on the legal page does not.
 *   3. That the household the sub-lessor typed comes back out on the room page.
 *      The API carrying it is checked in sublet-drive.mjs; that the page reads
 *      it is a different claim.
 *
 * Needs the API on :3000, the app on :4200, and a DATABASE_URL (to publish the
 * draft, which otherwise needs a real photo upload).
 */
import { chromium } from '@playwright/test';
import { registerUser, apiCall, signIn, PASSWORD, dbQuery as q } from './lib/drive-session.mjs';

const API = 'http://localhost:3000', WEB = 'http://localhost:4200';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const S = Math.floor(Math.random() * 1e6);
const sublessor = await registerUser(API, 'TENANT');

const browser = await chromium.launch();

// ── 1. Reachable from the tenant's own portal ────────────────────────────
const page = await signIn(browser, WEB, sublessor.email, PASSWORD);
await page.goto(`${WEB}/tenant/dashboard`, { waitUntil: 'domcontentloaded' });

const cta = page.locator('a[href="/tenant/sublet/new"]');
try {
  await cta.first().waitFor({ state: 'visible', timeout: 15000 });
  ok('the tenant dashboard offers sub-letting, so it can be found without knowing the URL');
} catch {
  bad('nothing on the tenant dashboard leads to sub-letting — the flow is unreachable in practice');
}

const navItem = page.locator('a[href*="your-sublets"]');
(await navItem.count())
  ? ok('…and the portal nav carries it too, so it survives leaving the dashboard')
  : bad('the tenant nav has no entry for rooms they let out');

// ── 2. The wizard says which kind of listing this is ────────────────────
await page.goto(`${WEB}/tenant/sublet/new`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.sublet-banner', { timeout: 15000 }).catch(() => {});
const banner = await page.locator('.sublet-banner').innerText().catch(() => '');
/place you rent/i.test(banner) && /free/i.test(banner)
  ? ok('the wizard says plainly that this is a sublet, and that the lease check is free')
  : bad(`the sublet wizard banner reads: ${banner.slice(0, 120)}`);

(await page.locator('.sublet-banner a[href="/legal/sublet"]').count())
  ? ok('and links the sub-lessor to what applicants will be told')
  : bad('the wizard does not show the lister what applicants are told');

// ── 3. An applicant is told, above the fold ─────────────────────────────
//
// The listing is created over the API rather than through four wizard steps:
// what is being checked is the room PAGE, and driving the form would test the
// form. Published with SQL for the same reason — publishing needs a real photo.
const room = await apiCall(API, 'POST', '/api/rooms', {
  roomType: 'shared_house',
  title: `Room in a shared Yeoville house ${S}`,
  description: 'A clean room in a house I rent myself. Close to taxis and the shops. Available now.',
  rentCents: 310000,
  province: 'Gauteng',
  city: 'Johannesburg',
  locationDisplay: `Yeoville ${S}, Johannesburg`,
  availableFrom: new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10),
  housematesCount: 3,
  household: {
    housemateProfile: 'students',
    householdSchedule: 'shift_work',
    householdCleanliness: 'very_tidy',
    householdSocial: 'social',
    currentHousemates: 3,
    houseRules: 'Gate locked at nine. Kitchen cleaned the same day.',
  },
}, sublessor.token);

const roomId = room.body?.id;
if (!roomId) {
  bad(`could not create the sublet listing over the API: ${room.status}`);
} else {
  q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id='${roomId}'`);

  const anon = await browser.newPage({ viewport: { width: 412, height: 900 } });
  await anon.goto(`${WEB}/rooms/${roomId}`, { waitUntil: 'domcontentloaded' });
  await anon.waitForSelector('.sublet-notice', { timeout: 20000 }).catch(() => {});

  const notice = await anon.locator('.sublet-notice').innerText().catch(() => '');
  /not the owner/i.test(notice)
    ? ok('the room page tells an applicant this is let by a tenant, not the owner')
    : bad(`no sublet notice on the room page (read: ${notice.slice(0, 100)})`);

  /does not confirm|not confirm or guarantee/i.test(notice)
    ? ok('and says in terms that we do not confirm the right to sublet')
    : bad('the notice does not say the platform has not confirmed the right to sublet');

  /lose the room|deposit/i.test(notice)
    ? ok('…in terms of what the APPLICANT risks, not our liability')
    : bad('the notice is about the platform rather than about the person reading it');

  /only the sub-lessor|ask to see their lease/i.test(notice)
    ? ok('an unchecked listing says so, and says what to ask for')
    : bad('an unchecked sublet listing does not say it is unchecked');

  /**
   * Above the fold, measured rather than assumed.
   *
   * 412×900 is the viewport the rest of the drives use — a cheap Android in
   * portrait, which is most of this market. A disclaimer an applicant has to
   * scroll to find is one they decide without.
   */
  // Caught: with no notice on the page this threw a TimeoutError and killed the
  // drive mid-run, so the four failures above it scrolled away behind a stack
  // trace. A check that cannot fail cleanly is a check somebody misreads.
  const box = await anon.locator('.sublet-notice').boundingBox().catch(() => null);
  box && box.y < 900
    ? ok(`and it is on the first screen on a phone (at ${Math.round(box.y)}px of 900)`)
    : bad(`the notice sits at ${box ? Math.round(box.y) : '?'}px — below the fold on a 900px phone`);

  const body = await anon.locator('body').innerText();
  /mostly students|shift/i.test(body)
    ? ok('the household the sub-lessor described is rendered for the applicant')
    : bad('the household is not shown on the room page');

  // The badge on the board, which is what somebody scanning thirty rooms sees.
  await anon.goto(`${WEB}/?city=Johannesburg`, { waitUntil: 'domcontentloaded' });
  await anon.waitForSelector('.room-card', { timeout: 20000 }).catch(() => {});
  const badges = await anon.locator('.badge-sublet').count();
  badges > 0
    ? ok('and the board marks sublet listings on the card')
    : bad('no Sublet badge on the board, so the distinction is invisible while scanning');

  await anon.close();
}

// ── 4. The legal page exists and is linked from the notice ──────────────
const legal = await browser.newPage();
await legal.goto(`${WEB}/legal/sublet`, { waitUntil: 'domcontentloaded' });
const legalText = await legal.locator('body').innerText();
/Rental Housing Tribunal/i.test(legalText) && /deposit/i.test(legalText)
  ? ok('the sub-letting page tells somebody where to go and what to ask for')
  : bad('the sub-letting legal page is missing its practical content');
/not legal advice/i.test(legalText)
  ? ok('and says it is not legal advice')
  : bad('the page does not state that it is not legal advice');
await legal.close();

await browser.close();
q(`DELETE FROM users WHERE id = '${sublessor.id}'`);

console.log(fail
  ? `\n❌ ${fail} failure(s)`
  : '\n✅ a tenant can find the flow, and an applicant is told what they are taking on before they decide');
process.exit(fail ? 1 : 0);
