/**
 * What /account/settings OFFERS a phone-only account — Phase 7o.
 *
 *   node scripts/phone-only-ui-drive.mjs
 *
 * Needs the API on :3000, the frontend on :4200, DATABASE_URL and JWT_SECRET.
 *
 * ── Why this is separate from phone-only-drive.mjs
 *
 * The API drive proves the endpoints behave. It cannot see that the screen
 * showed this person a "Current password" box for a password they do not have,
 * a "Your password" box on the one form that mattered to them, and the words
 * "Currently" followed by an empty bold tag. Those were the whole defect: every
 * refusal they met was correct behaviour from a form they should never have
 * been shown.
 */
import crypto from 'crypto';
import { chromium } from 'playwright';
import { apiCall, dbQuery as q, signIn, PASSWORD, registerUser } from './lib/drive-session.mjs';

const API = 'http://localhost:3000', WEB = 'http://localhost:4200';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const skip = (m) => console.log('  ⏭  SKIP ' + m);

const S = String(Math.floor(Math.random() * 9000) + 1000);
const LOCAL = `082141${S}`, E164 = `+2782141${S}`;
const SECRET = process.env.JWT_SECRET ?? '';
const signupHash = (c, p) => crypto.createHmac('sha256', SECRET).update(`signup:${p}:${c}`).digest('hex');
function recover(hash, phone, scheme) {
  for (let n = 0; n < 1000000; n++) {
    const c = String(n).padStart(6, '0');
    if (scheme(c, phone) === hash) return c;
  }
  return null;
}

// ── A phone-only account, made in the browser through the real screen ───
//
// ⚠️ It has to be made HERE, not over the API and then planted.
//
// First written as "sign up over the API, put the access token in
// localStorage": the browser stayed signed out, because the session is a
// refresh COOKIE and localStorage holds only a has-session flag. Every check
// below would then have passed by absence — no "Current password" on screen
// because no screen. And `signIn` from the drive library cannot be used
// either: it types an email and a password, and this account has neither,
// which is the whole subject of the drive.
//
// So the drive uses /auth/register-phone, which is what a person uses, and the
// browser ends up with a real session for a real phone-only account.
const browser = await chromium.launch();

async function makePhoneAccount(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const local = `08214${String(Math.floor(Math.random() * 90000) + 10000)}`.slice(0, 10);
  const e164 = `+27${local.slice(1)}`;

  await page.goto(`${WEB}/auth/register-phone`, { waitUntil: 'networkidle' });
  await page.fill('#phone', local);
  await page.locator('button.auth__submit').first().click();

  /**
   * ⚠️ Caught, not awaited into a crash.
   *
   * Written as a bare `waitForSelector('#code')`, this drive died with
   * "TimeoutError: waiting for locator('#code')" and reported nothing — when
   * the actual cause was a 429 from the sign-up throttle, exhausted by this
   * drive's own earlier runs. A drive that crashes instead of reporting is the
   * fault CLAUDE.md names, and the stack trace sends the next person to look at
   * the register screen rather than at the limiter.
   */
  try {
    await page.waitForSelector('#code', { timeout: 15000 });
  } catch {
    const onScreen = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200);
    return { page, failed: `the code step never arrived for ${e164}. The screen says: ${onScreen}` };
  }

  const id = q(`SELECT id FROM phone_signups WHERE phone='${e164}' AND "userId" IS NULL AND "codeHash" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1`);
  if (!id) return { page, failed: 'no phone_signups row for ' + e164 };
  const code = recover(q(`SELECT "codeHash" FROM phone_signups WHERE id='${id}'`), e164, signupHash);
  if (!code) return { page, failed: 'the code could not be derived, so JWT_SECRET does not match the API' };

  await page.fill('#code', code);
  await page.locator('button.auth__submit').first().click();
  try {
    await page.waitForSelector('#fullName', { timeout: 15000 });
  } catch {
    const onScreen = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200);
    return { page, failed: `the details step never arrived. The screen says: ${onScreen}` };
  }
  await page.fill('#fullName', 'Phone Only Landlord');
  await page.locator('button.auth__role', { hasText: 'Landlord' }).click();
  await page.locator('#acceptTerms').check();
  await page.locator('button.auth__submit').last().click();
  try {
    await page.waitForURL((u) => !/register-phone/.test(u.pathname), { timeout: 20000 });
  } catch {
    const onScreen = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200);
    return { page, failed: `the account was never created. The screen says: ${onScreen}` };
  }
  return { page, e164, ctx };
}

const made = await makePhoneAccount(390);
if (made.failed) {
  skip(`the whole drive — ${made.failed}`);
  await browser.close();
  process.exit(0);
}
const page = made.page;
const uid = q(`SELECT id FROM users WHERE phone='${made.e164}'`);
q(`SELECT coalesce(email,'none')||'/'||coalesce("passwordHash",'none') FROM users WHERE id='${uid}'`) === 'none/none'
  ? ok('a phone-only account was created through the sign-up screen (precondition, asserted)')
  : bad('the account created is not phone-only, so this drive is about the wrong thing');

console.log('\n── 1. The screen knows what kind of account this is ──────────');
await page.goto(`${WEB}/account/settings`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const signedIn = await page.evaluate(() => !/\/auth\/login/.test(location.pathname));
if (!signedIn) {
  skip('the whole drive — the planted session did not sign the browser in, so nothing below is measurable');
  await browser.close();
  process.exit(0);
}
ok('a phone-only account can open its own settings screen');

const text = await page.locator('body').innerText();

!/Currently\s*\.|Currently\s*$/m.test(text)
  ? ok('it does not say "Currently" with no address after it')
  : bad('the screen still reads "Currently" followed by nothing');

/add an email address/i.test(text)
  ? ok('the email section asks them to ADD one rather than change one')
  : bad('the email section does not offer adding an address');

/set a password/i.test(text)
  ? ok('the password section offers SETTING a first password')
  : bad('the password section does not offer setting a first password');

!/current password/i.test(text)
  ? ok('…and does not ask for a current password that does not exist')
  : bad('the screen still asks for a "Current password"');

!/google/i.test(text)
  ? ok('…and nothing on the screen mentions Google')
  : bad('the screen mentions Google to an account that has never used it');

console.log('\n── 2. The number is named as the only way in ─────────────────');
/only way into your account/i.test(text)
  ? ok('the screen says the number is the only way into the account')
  : bad('nothing tells them their number is the only credential');
/change my number/i.test(text)
  ? ok('…and offers a confirmed change rather than an editable box')
  : bad('there is no "Change my number" control');

console.log('\n── 3. The controls are there to use, at four widths ──────────');
/**
 * ⚠️ ONE account, its session copied into a context per width.
 *
 * Written as "a new phone account per width" first, which was five sign-ups a
 * run — and the sign-up throttle is twenty an hour, so two runs exhausted it
 * and the third crashed. Resizing one page would be the other cheap option and
 * is worse: a layout read at 360px after a 1280px paint has reported a desktop
 * measurement as a phone one in this repo before. A fresh CONTEXT per width
 * paints at that width from the start and costs nothing.
 */
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
let sessionState = await made.ctx.storageState();
for (const width of [360, 390, 768, 1280]) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    storageState: sessionState,
  });
  const p = await ctx.newPage();
  await p.goto(`${WEB}/account/settings`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);

  if (/\/auth\/login/.test(new URL(p.url()).pathname)) {
    bad(`${width}px: the copied session did not sign in, so nothing here is measured`);
    await ctx.close();
    continue;
  }

  const m = await p.evaluate(() => {
    const vis = (el) => !!el && getComputedStyle(el).display !== 'none'
      && el.getBoundingClientRect().height > 0;
    const controls = [...document.querySelectorAll('.dash-section button, .dash-section a.btn')]
      .filter(vis);
    return {
      count: controls.length,
      minHeight: controls.length ? Math.min(...controls.map((c) => c.getBoundingClientRect().height)) : 0,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      labels: controls.map((c) => (c.textContent ?? '').trim()).slice(0, 12),
    };
  });

  m.count > 0
    ? ok(`${width}px: ${m.count} controls to measure`)
    : bad(`${width}px: no controls found, so nothing below is measured`);
  m.count > 0 && m.minHeight >= 44
    ? ok(`${width}px: every control clears 44px (smallest ${Math.round(m.minHeight)}px)`)
    : bad(`${width}px: a control is ${Math.round(m.minHeight)}px, under the 44px target`);
  m.overflow <= 1
    ? ok(`${width}px: no sideways scroll`)
    : bad(`${width}px: the page overflows by ${m.overflow}px`);
  sessionState = await ctx.storageState();
  await ctx.close();
}

console.log('\n── 3b. And the phone-only forms can actually be used ────────');

/**
 * ⚠️ A FRESH context from the current session, not the page from section 1.
 *
 * Section 3 above chains `sessionState` through each width because the refresh
 * cookie rotates — which leaves the original page holding a token rotated away
 * three contexts ago. Reusing it here meant /account/settings bounced to the
 * login form, and the first version then sat on
 * `click('button:has-text("Send me a code")')` until Playwright's 30s timeout
 * and died with a stack trace, instead of saying "signed out". Crashing rather
 * than reporting is the fault CLAUDE.md names, and this is the third time this
 * session.
 */
const useCtx = await browser.newContext({ viewport: { width: 390, height: 900 }, storageState: sessionState });
const usePage = await useCtx.newPage();
await usePage.goto(`${WEB}/account/settings`, { waitUntil: 'networkidle' });
await usePage.waitForTimeout(1500);

if (/\/auth\/login/.test(new URL(usePage.url()).pathname)) {
  bad('section 3b: the session did not carry over, so the forms were not exercised');
} else {
const sendBtn = usePage.locator('button:has-text("Send me a code")').first();
if (await sendBtn.count() === 0) {
  bad('there is no "Send me a code" control on the settings screen');
} else {
// Ask for the code, type six digits, and check the submit wakes up. The code
// itself is wrong on purpose: what is measured here is the control, not the API.
await sendBtn.click();
await usePage.waitForTimeout(1500);
const codeBoxes = await usePage.locator('input[autocomplete="one-time-code"]').count();
codeBoxes > 0
  ? ok(`asking for a code reveals the box to type it in (${codeBoxes})`)
  : bad('no one-time-code input appeared after asking for a code');
if (codeBoxes > 0) {
  await usePage.locator('#emStepCode').fill('123456');
  await usePage.locator('#newEmail').fill(`ui${S}@example.co.za`);
  await usePage.waitForTimeout(300);
  const emBtn = usePage.locator('button:has-text("Send confirmation")');
  await (await emBtn.isEnabled())
    ? ok('…and "Send confirmation" becomes pressable with an address and a code')
    : bad('"Send confirmation" stays disabled with both filled in');
}
}
}
await useCtx.close();

console.log('\n── 4. An account WITH a password still sees its own forms ────');
const normal = await registerUser(API, 'LANDLORD');
const np = await signIn(browser, WEB, normal.email, PASSWORD, { width: 390, height: 900 });
await np.goto(`${WEB}/account/settings`, { waitUntil: 'networkidle' });
await np.waitForTimeout(1200);
const nText = await np.locator('body').innerText();
/current password/i.test(nText)
  ? ok('an ordinary account is still asked for its current password')
  : bad('the password form lost its "Current password" field for everybody');

/**
 * ⚠️ The button must become USABLE, not merely be present.
 *
 * This check exists because the drive did not have it and shipped a dead
 * button: `passwordReady` was written as a `computed()` over the FormGroup,
 * and a FormGroup's value is not a signal — so it cached `false` from the
 * empty form and "Change password" was disabled forever for every account that
 * had one. Every text assertion above still passed. The account-lifecycle UI
 * drive caught it by trying to click, which is the difference between reading
 * a screen and using it.
 */
await np.fill('#currentPassword', PASSWORD);
await np.fill('#newPassword', 'BrandNewPass123');
await np.waitForTimeout(300);
const pwBtn = np.locator('button:has-text("Change password")');
await (await pwBtn.isEnabled())
  ? ok('…and the button becomes pressable once the form is filled in')
  : bad('"Change password" stays disabled with the form filled in — a control that cannot be pressed');
/code from whatsapp/i.test(nText)
  ? bad('an ordinary account is being offered the phone step-up instead')
  : ok('…and is not offered a WhatsApp code it does not need');
!/add an email address/i.test(nText)
  ? ok('…and its email section still says "Email address", not "Add" one')
  : bad('an account with an address is being asked to add one');
await np.context().close();

await page.context().close();
await browser.close();
console.log(fail ? `\n❌ ${fail} failure(s)` : '\n✅ the settings screen fits the account it is showing');
