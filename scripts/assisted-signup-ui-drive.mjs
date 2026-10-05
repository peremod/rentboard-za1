/**
 * The admin screen for assisted sign-up — Phase 7p.
 *
 *   node scripts/assisted-signup-ui-drive.mjs
 *
 * Needs the API on :3000, the frontend on :4200, DATABASE_URL and JWT_SECRET.
 *
 * ── Why the wording is a check and not decoration
 *
 * The control that makes assisted sign-up safe is that the code goes to the
 * PERSON'S handset and the Terms are accepted by them. An admin who does not
 * know that will sit watching their own phone, decide the feature is broken,
 * and the next thing they try is typing the landlord's details in themselves.
 * So the screen has to say both things, and this asserts it does.
 */
import crypto from 'crypto';
import { chromium } from 'playwright';
import { apiCall, dbQuery as q, signIn } from './lib/drive-session.mjs';

const API = 'http://localhost:3000', WEB = 'http://localhost:4200';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const skip = (m) => console.log('  ⏭  SKIP ' + m);

const S = String(Math.floor(Math.random() * 9000) + 1000);
const LOCAL = `082161${S}`, E164 = `+2782161${S}`;
const SECRET = process.env.JWT_SECRET ?? '';
const hashCode = (c, p) => crypto.createHmac('sha256', SECRET).update(`signup:${p}:${c}`).digest('hex');

const adminId = q(`SELECT id FROM users WHERE email='ci-admin@mastande.test'`);
if (!adminId) { skip('the whole drive — no ci-admin seeded'); process.exit(0); }
// A clean slate, so counts below are this run's.
q(`DELETE FROM phone_signups WHERE "assistedByAdminId"='${adminId}' AND "userId" IS NULL`);

const browser = await chromium.launch();

console.log('\n── 1. The screen says where the code goes ───────────────────');
const page = await signIn(browser, WEB, 'ci-admin@mastande.test', 'CiSmokeAdmin123',
  { width: 390, height: 900 });
await page.goto(`${WEB}/admin/dashboard`, { waitUntil: 'networkidle' });
await page.waitForSelector('#assist-phone', { timeout: 20000 });
ok('the admin overview offers helping somebody sign up');

const text = await page.locator('body').innerText();
/code goes to their handset/i.test(text)
  ? ok('…and says the code goes to THEIR handset, not the admin’s')
  : bad('nothing on the screen says whose phone the code goes to');
/accept the Terms themselves|cannot do that part for them/i.test(text)
  ? ok('…and that the Terms are theirs to accept')
  : bad('nothing says the acceptance has to come from the person');
/you have not started any yet/i.test(text)
  ? ok('…and shows an empty state rather than an empty list')
  : bad('no empty state for an admin who has started none');

console.log('\n── 2. Starting one, and the record appearing ────────────────');
await page.fill('#assist-phone', LOCAL);
await page.locator('button:has-text("Send them a code")').click();
await page.waitForTimeout(2500);

const after = await page.locator('body').innerText();
/code is on its way/i.test(after)
  ? ok('the admin is told a code went out')
  : bad(`no confirmation after starting one: ${after.replace(/\s+/g, ' ').slice(0, 200)}`);

// ⚠️ The code must not be on the admin's screen. This is the whole control, and
// a screen that prints it defeats a server that withholds it.
const rowId = q(`SELECT id FROM phone_signups WHERE phone='${E164}' AND "assistedByAdminId"='${adminId}' ORDER BY "createdAt" DESC LIMIT 1`);
rowId ? ok('…and the attempt is recorded against this admin')
      : bad('no assisted row was created for this admin');

if (rowId) {
  let code = null;
  const hash = q(`SELECT "codeHash" FROM phone_signups WHERE id='${rowId}'`);
  for (let n = 0; n < 1000000 && !code; n++) {
    const c = String(n).padStart(6, '0');
    if (hashCode(c, E164) === hash) code = c;
  }
  if (!code) {
    skip('the code check — it could not be derived, so JWT_SECRET does not match the API');
  } else {
    !after.includes(code)
      ? ok(`…and the six digits are nowhere on the admin’s screen`)
      : bad('the code is printed on the admin screen — they could finish without the person');
  }

  /waiting for/i.test(after) && after.includes(E164)
    ? ok('…and the list shows it waiting on that number')
    : bad('the started sign-up does not appear in the list');
  !/they accepted/i.test(after)
    ? ok('…and does NOT claim they accepted anything yet')
    : bad('the screen says they accepted before they did');
}

console.log('\n── 3. Four widths ──────────────────────────────────────────');
/**
 * ⚠️ Re-captured each time: the refresh cookie ROTATES.
 *
 * A single `storageState()` reused across contexts worked at the first width
 * and was signed out at every one after it — the app spends the cookie on load
 * and the server issues a new one, so the second context presents a token
 * already rotated away. Found in layout-ui-drive, where the login-bounce guard
 * reported it; this drive passed only because of ordering, which is luck rather
 * than a check.
 */
let state = await page.context().storageState();
for (const width of [360, 390, 768, 1280]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, storageState: state });
  const p = await ctx.newPage();
  await p.goto(`${WEB}/admin/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  const m = await p.evaluate(() => {
    const vis = (el) => !!el && getComputedStyle(el).display !== 'none'
      && el.getBoundingClientRect().height > 0;
    const sec = [...document.querySelectorAll('.dash-section')]
      .find((s) => /Help somebody sign up/i.test(s.textContent ?? ''));
    if (!sec) return null;
    const controls = [...sec.querySelectorAll('button, input')].filter(vis);
    const banner = sec.querySelector('.insight-banner');
    return {
      count: controls.length,
      minHeight: controls.length ? Math.min(...controls.map((c) => c.getBoundingClientRect().height)) : 0,
      bannerWidth: banner ? Math.round(banner.getBoundingClientRect().width) : 0,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  if (!m) { bad(`${width}px: the section is not on the page, so nothing is measured`); await ctx.close(); continue; }
  m.count >= 2
    ? ok(`${width}px: ${m.count} controls to measure`)
    : bad(`${width}px: only ${m.count} control(s) found`);
  m.minHeight >= 44
    ? ok(`${width}px: every control clears 44px (smallest ${Math.round(m.minHeight)}px)`)
    : bad(`${width}px: a control is ${Math.round(m.minHeight)}px, under the 44px target`);
  m.overflow <= 1
    ? ok(`${width}px: no sideways scroll`)
    : bad(`${width}px: the page overflows by ${m.overflow}px`);
  m.bannerWidth > 0 && m.bannerWidth <= width
    ? ok(`${width}px: the "whose handset" notice fits (${m.bannerWidth}px)`)
    : bad(`${width}px: the notice is ${m.bannerWidth}px in a ${width}px viewport`);
  state = await ctx.storageState();
  await ctx.close();
}

console.log('\n── 4. An ordinary landlord cannot see any of it ─────────────');
const reg = await apiCall(API, 'POST', '/api/auth/register', {
  email: `assist-ui-ll-${S}@rentboard.test`, password: 'ProbePass123',
  fullName: 'Ordinary Landlord', role: 'LANDLORD',
});
if (reg.status !== 201) {
  skip(`section 4 — could not register a landlord (${reg.status})`);
} else {
  const lp = await signIn(browser, WEB, `assist-ui-ll-${S}@rentboard.test`, 'ProbePass123',
    { width: 390, height: 900 });
  await lp.goto(`${WEB}/admin/dashboard`, { waitUntil: 'networkidle' });
  await lp.waitForTimeout(1500);
  const lText = await lp.locator('body').innerText();
  !/help somebody sign up/i.test(lText)
    ? ok('a landlord sent to /admin/dashboard is not shown the assisted form')
    : bad('an ordinary landlord can see and use the assisted sign-up form');
  await lp.context().close();
}

await page.context().close();
await browser.close();
console.log(fail ? `\n❌ ${fail} failure(s)` : '\n✅ the admin screen says whose handset, and whose consent');
