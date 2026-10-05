/**
 * The two screens of lost-number recovery — Phase 7q.
 *
 *   node scripts/lost-number-ui-drive.mjs
 *
 * Needs the API on :3000, the frontend on :4200, DATABASE_URL and JWT_SECRET.
 *
 * ── What the UI has to do that the API cannot
 *
 * The API refuses an approval with no recorded identity check. The SCREEN's job
 * is to make an admin slow down before they get there, and to refuse out loud
 * when the account has a safer route — because an admin who does not know that
 * a password reset would do the same job will hand an account over for no
 * reason. None of that is visible to the API drive.
 *
 * And the public page has to be useful to somebody who arrives with nothing: it
 * cannot start a recovery, so if it does not EXPLAIN that, it is a form that
 * silently cannot help the person reading it.
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
const OLD_LOCAL = `082181${S}`, OLD_E164 = `+2782181${S}`;
const NEW_LOCAL = `082182${S}`;
const SECRET = process.env.JWT_SECRET ?? '';
const signupHash = (c, p) => crypto.createHmac('sha256', SECRET).update(`signup:${p}:${c}`).digest('hex');
function derive(hash, phone) {
  for (let n = 0; n < 1000000; n++) {
    const c = String(n).padStart(6, '0');
    if (signupHash(c, phone) === hash) return c;
  }
  return null;
}

const browser = await chromium.launch();

// ── 1. The public page, for somebody who arrives with nothing ───────────
console.log('\n── 1. The page somebody lands on with a dead phone ──────────');

const pub = await browser.newContext({ viewport: { width: 390, height: 900 } });
const pp = await pub.newPage();
await pp.goto(`${WEB}/auth/lost-number`, { waitUntil: 'networkidle' });
await pp.waitForTimeout(900);
const pText = await pp.locator('body').innerText();

/lost the phone/i.test(pText)
  ? ok('the page exists and says what it is for')
  : bad('the lost-number page does not load or has no heading');
/talk to us first|contact us/i.test(pText)
  ? ok('…and tells them to talk to a person, because no form can do this')
  : bad('the page does not say a person has to be involved');
/only way in|no email address and no password/i.test(pText)
  ? ok('…and why: their number is the only way into the account')
  : bad('the page does not explain why this needs checking in person');
(await pp.locator('#phone').count()) === 1 && (await pp.locator('#code').count()) === 1
  ? ok('…and still offers the code box, for somebody who has been told to expect one')
  : bad('the page has no number and code fields');

// ⚠️ Reachable. A page nobody can find is a page that does not exist for the
// person who needs it, and "forgot your password" is no help to an account
// with no password.
const lp = await pub.newPage();
await lp.goto(`${WEB}/auth/login`, { waitUntil: 'networkidle' });
await lp.waitForTimeout(700);
const links = await lp.evaluate(() =>
  [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? ''));
links.some((h) => /lost-number/.test(h))
  ? ok('…and the login page links to it, so somebody locked out can find it')
  : bad('nothing links to /auth/lost-number — it exists and cannot be found');
await pub.close();

// ── 2. A real phone-only account to recover ─────────────────────────────
await apiCall(API, 'POST', '/api/auth/phone/signup/request-code', { phone: OLD_LOCAL });
const sid = q(`SELECT id FROM phone_signups WHERE phone='${OLD_E164}' AND "userId" IS NULL AND "codeHash" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1`);
if (!sid) { skip('the admin sections — no phone_signups row'); await browser.close(); process.exit(fail ? 1 : 0); }
const sCode = derive(q(`SELECT "codeHash" FROM phone_signups WHERE id='${sid}'`), OLD_E164);
if (!sCode) { skip('the admin sections — JWT_SECRET does not match the API'); await browser.close(); process.exit(fail ? 1 : 0); }
const ver = await apiCall(API, 'POST', '/api/auth/phone/signup/verify', { phone: OLD_LOCAL, code: sCode });
await apiCall(API, 'POST', '/api/auth/phone/signup/complete',
  { ticket: ver.body?.ticket, fullName: 'Lost Phone Landlord', role: 'LANDLORD', acceptTerms: true });
const uid = q(`SELECT id FROM users WHERE phone='${OLD_E164}'`);

console.log('\n── 2. The admin screen says what it can do ──────────────────');

const page = await signIn(browser, WEB, 'ci-admin@mastande.test', 'CiSmokeAdmin123',
  { width: 390, height: 900 });
await page.goto(`${WEB}/admin/recoveries`, { waitUntil: 'networkidle' });
await page.waitForSelector('#lookup-phone', { timeout: 20000 });
ok('the admin screen loads from its own nav entry');

const aText = await page.locator('body').innerText();
/wrong person|rooms, tenants and rent record/i.test(aText)
  ? ok('…and says out loud what it can get wrong')
  : bad('nothing on the screen says what the risk is');
/two things have to be true/i.test(aText)
  ? ok('…and names both proofs')
  : bad('the screen does not say both proofs are needed');
/cannot do the second part for them/i.test(aText)
  ? ok('…and that the admin cannot finish it themselves')
  : bad('the screen does not say the code is the person’s to enter');

// ── 3. The narrowing, on screen ─────────────────────────────────────────
console.log('\n── 3. Refused out loud when something safer would work ──────');

q(`UPDATE users SET email='safe${S}@rentboard.test' WHERE id='${uid}'`);
await page.fill('#lookup-phone', OLD_LOCAL);
await page.locator('button:has-text("Look it up")').click();
await page.waitForTimeout(1800);
const withEmail = await page.locator('body').innerText();
/do not use this/i.test(withEmail)
  ? ok('an account with an email is refused on the screen, in those words')
  : bad('the screen does not refuse an account that has a safer route');
/password reset/i.test(withEmail)
  ? ok('…naming the safer route')
  : bad('the refusal does not name what to do instead');
(await page.locator('#new-phone').count()) === 0
  ? ok('…and the form to open one is not even rendered')
  : bad('the open-a-request form is shown for an account that should not use this');
q(`UPDATE users SET email=NULL WHERE id='${uid}'`);

// ── 4. Approving is off until a check is recorded ───────────────────────
console.log('\n── 4. Approve is off until something is written down ────────');

await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#lookup-phone', { timeout: 15000 });
await page.fill('#lookup-phone', OLD_LOCAL);
await page.locator('button:has-text("Look it up")').click();
await page.waitForTimeout(1800);
await page.fill('#new-phone', NEW_LOCAL);
await page.fill('#open-note', 'Phone stolen, came in person.');
await page.locator('button:has-text("Open a request")').click();
await page.waitForTimeout(2000);

const rid = q(`SELECT id FROM account_recoveries WHERE "userId"='${uid}' AND status='open' ORDER BY "createdAt" DESC LIMIT 1`);
rid ? ok('a request can be opened from the screen') : bad('no request row was created from the screen');

if (rid) {
  const approveBtn = page.locator('button:has-text("Approve")').first();
  (await approveBtn.count()) === 1
    ? ok('…and the approve button is on the row')
    : bad('there is no approve button on an open request');
  !(await approveBtn.isEnabled())
    ? ok('…but DISABLED, because nothing has been checked yet')
    : bad('approve is pressable with no identity check recorded — the screen invites the mistake');
  /off until you have recorded/i.test(await page.locator('body').innerText())
    ? ok('…and the screen says why it is off')
    : bad('the disabled button has no explanation beside it');

  // Record a check through the screen, the way a person does it.
  await page.locator(`#id-${rid}`).fill('Green ID book, photo and name match.');
  await page.locator('button:has-text("Save what I checked")').first().click();
  await page.waitForTimeout(2000);

  q(`SELECT CASE WHEN "idSeenAt" IS NULL THEN 'none' ELSE 'dated' END FROM account_recoveries WHERE id='${rid}'`) === 'dated'
    ? ok('saving through the screen records it, dated')
    : bad('the screen did not record the check');

  const approve2 = page.locator('button:has-text("Approve")').first();
  (await approve2.count()) === 1 && await approve2.isEnabled()
    ? ok('…and only now is approve pressable')
    : bad('approve is still disabled after a check was recorded');
}

// ── 5. Four widths ──────────────────────────────────────────────────────
console.log('\n── 5. Four widths ──────────────────────────────────────────');
let state = await page.context().storageState();
for (const width of [360, 390, 768, 1280]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, storageState: state });
  const p = await ctx.newPage();
  await p.goto(`${WEB}/admin/recoveries`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  if (/\/auth\/login/.test(new URL(p.url()).pathname)) {
    bad(`${width}px: the copied session did not sign in, so nothing was measured`);
    await ctx.close();
    continue;
  }

  const m = await p.evaluate(() => {
    const vis = (el) => !!el && getComputedStyle(el).display !== 'none'
      && el.getBoundingClientRect().height > 0;
    const controls = [...document.querySelectorAll('button, input, textarea')].filter(vis);
    const banner = document.querySelector('.insight-banner');
    return {
      count: controls.length,
      minHeight: controls.length ? Math.min(...controls.map((c) => c.getBoundingClientRect().height)) : 0,
      bannerWidth: banner ? Math.round(banner.getBoundingClientRect().width) : 0,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  m.count >= 2
    ? ok(`${width}px: ${m.count} controls to measure`)
    : bad(`${width}px: only ${m.count} control(s) found, so nothing is measured`);
  m.count >= 2 && m.minHeight >= 44
    ? ok(`${width}px: every control clears 44px (smallest ${Math.round(m.minHeight)}px)`)
    : bad(`${width}px: a control is ${Math.round(m.minHeight)}px, under the 44px target`);
  m.overflow <= 1
    ? ok(`${width}px: no sideways scroll`)
    : bad(`${width}px: the page overflows by ${m.overflow}px`);
  m.bannerWidth > 0 && m.bannerWidth <= width
    ? ok(`${width}px: the warning fits (${m.bannerWidth}px)`)
    : bad(`${width}px: the warning is ${m.bannerWidth}px in a ${width}px viewport`);

  state = await ctx.storageState();
  await ctx.close();
}

// ── 6. A landlord sees none of it ───────────────────────────────────────
console.log('\n── 6. A landlord cannot reach the screen ───────────────────');
const reg = await apiCall(API, 'POST', '/api/auth/register', {
  email: `lost-ui-ll-${S}@rentboard.test`, password: 'ProbePass123',
  fullName: 'Ordinary Landlord', role: 'LANDLORD',
});
if (reg.status !== 201) {
  skip(`section 6 — could not register a landlord (${reg.status})`);
} else {
  const llp = await signIn(browser, WEB, `lost-ui-ll-${S}@rentboard.test`, 'ProbePass123',
    { width: 390, height: 900 });
  await llp.goto(`${WEB}/admin/recoveries`, { waitUntil: 'networkidle' });
  await llp.waitForTimeout(1500);
  const lText = await llp.locator('body').innerText();
  !/account recovery|look it up/i.test(lText)
    ? ok('a landlord sent to /admin/recoveries is not shown it')
    : bad('an ordinary landlord can see the recovery screen');
  await llp.context().close();
}

await page.context().close();
await browser.close();
console.log(fail ? `\n❌ ${fail} failure(s)` : '\n✅ both screens say what they can and cannot do');
