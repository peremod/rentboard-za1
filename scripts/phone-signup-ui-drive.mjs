/**
 * Signing up with a phone number, on screen — Phase 7g part two.
 *
 * ── The one assertion this exists for
 *
 * That the account cannot be created until the person ticks the box themselves.
 * The API refuses anything but a literal `true`, and that is proven in
 * phone-signup-drive.mjs; what cannot be proven from the API is that the SCREEN
 * makes the tick the person's own act rather than a pre-ticked box they scroll
 * past. So: the button is disabled, the box is NOT ticked on arrival, and only
 * ticking it enables the button.
 *
 * That matters because of how this feature will actually be used. Somebody —
 * an agent, a family member, the person at the internet café — will sit with a
 * landlord and help them through it. The help can reach as far as the handset.
 * The acceptance has to stop at the person.
 *
 * ── And that the route is reachable
 *
 * A sign-up path the intended users cannot find does not exist. The people who
 * need this are the least likely to go looking for a second sign-up page, so
 * the link on /auth/register is checked from the page itself, not assumed.
 *
 * Needs the API on :3000, the app on :4200, and a DATABASE_URL — the code only
 * ever goes out over WhatsApp, so reading it back means reading the database.
 */
import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const API = 'http://localhost:3000', WEB = 'http://localhost:4200';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const DB = process.env.DATABASE_URL
  ?? 'postgresql://rentboard:rentboard@localhost:5432/rentboard_dev';
const q = (sql) => execSync(`psql "${DB}" -tAc ${JSON.stringify(sql)}`, { encoding: 'utf8' }).trim();

const S = String(Math.floor(Math.random() * 9000) + 1000);
const LOCAL = `082129${S}`;
const E164 = `+2782129${S}`;
const SECRET = process.env.JWT_SECRET ?? '';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 900 } });

// ── The link, from the page a person actually lands on ───────────────────
//
// WAITED for, not counted immediately. The auth routes are not prerendered —
// /auth/register comes back as a shell and the card is drawn on the client — so
// a count straight after domcontentloaded is zero whether the link exists or
// not. The first version of this check reported the link missing and then
// passed its own "the link goes there" assertion, because the fallback had
// navigated manually. Two wrong answers from one missing wait.
await page.goto(`${WEB}/auth/register`, { waitUntil: 'domcontentloaded' });
const link = page.locator('a[href="/auth/register-phone"]');
let clicked = false;
try {
  await link.first().waitFor({ state: 'visible', timeout: 15000 });
  ok('the register page offers a phone sign-up, so the people who need it can find it');
  await link.first().click();
  await page.waitForURL('**/auth/register-phone', { timeout: 10000 });
  clicked = true;
} catch {
  bad('nothing on /auth/register links to the phone sign-up — it is unreachable in practice');
  await page.goto(`${WEB}/auth/register-phone`, { waitUntil: 'domcontentloaded' });
}

// Only meaningful if the click is what got us here.
if (clicked) {
  page.url().includes('/auth/register-phone')
    ? ok('and the link goes there')
    : bad(`the link landed on ${page.url()}`);
}
await page.waitForSelector('#phone', { timeout: 15000 });

// ── Step one ─────────────────────────────────────────────────────────────
await page.fill('#phone', LOCAL);
await page.getByRole('button', { name: /Send me a code/i }).click();
await page.waitForSelector('#code', { timeout: 15000 }).catch(() => {});
(await page.locator('#code').count())
  ? ok('entering a number asks for the code')
  : bad('the code field never appeared');

q(`SELECT count(*) FROM users WHERE phone='${E164}'`) === '0'
  ? ok('and no account exists yet — the screen has not created a person')
  : bad('an account was created merely by asking for a code');

// ── Step two: the real code, out of the database ─────────────────────────
const hash = q(`SELECT "codeHash" FROM phone_signups WHERE phone='${E164}' AND "codeHash" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1`);
let code = null;
for (let n = 0; n < 1000000 && hash; n++) {
  const candidate = String(n).padStart(6, '0');
  const h = crypto.createHmac('sha256', SECRET).update(`signup:${E164}:${candidate}`).digest('hex');
  if (h === hash) { code = candidate; break; }
}

if (!code) {
  bad('could not read the code back — JWT_SECRET here differs from the API’s, so the rest cannot run');
} else {
  await page.fill('#code', code);
  await page.getByRole('button', { name: /Confirm my number/i }).click();
  await page.waitForSelector('#acceptTerms', { timeout: 15000 }).catch(() => {});

  // ── The consent control ────────────────────────────────────────────────
  const box = page.locator('#acceptTerms');
  const submit = page.getByRole('button', { name: /Create my free account/i });

  (await box.count())
    ? ok('the last step asks for the Terms to be accepted')
    : bad('no consent checkbox on the final step');

  (await box.isChecked().catch(() => true)) === false
    ? ok('and it arrives UNticked, so accepting is an act and not a default')
    : bad('the consent box is pre-ticked — nobody accepted anything');

  await page.fill('#fullName', 'Sipho UiDrive');
  (await submit.isDisabled())
    ? ok('with a name filled in and the box untouched, the account cannot be created')
    : bad('the create button is live without consent — the screen can make an account nobody agreed to');

  // Polled, not read once. `disabled` is bound to a method on an OnPush
  // component, so the attribute is removed when change detection next runs
  // rather than inside check(); reading it immediately is a race that reported
  // a dead button the drive then successfully clicked. Still a real check —
  // it fails if the button never enables.
  await box.check();
  let enabled = false;
  for (let i = 0; i < 20 && !enabled; i++) {
    enabled = await submit.isEnabled();
    if (!enabled) await page.waitForTimeout(100);
  }
  enabled
    ? ok('ticking it enables the button')
    : bad('the button stays dead after ticking — the flow cannot be completed');

  // Both links have to go somewhere a person can read before agreeing.
  const terms = await page.locator('#acceptTerms ~ span a, .auth__check a').evaluateAll(
    (as) => as.map((a) => a.getAttribute('href')),
  );
  terms.includes('/legal/terms') && terms.includes('/legal/privacy')
    ? ok('and the Terms and Privacy Policy are linked from the words being agreed to')
    : bad(`the consent text links to ${JSON.stringify(terms)} — a person cannot read what they are accepting`);

  await submit.click();
  await page.waitForURL((u) => !u.pathname.includes('/auth/'), { timeout: 20000 }).catch(() => {});

  !page.url().includes('/auth/')
    ? ok(`and creating the account signs them in (landed on ${new URL(page.url()).pathname})`)
    : bad(`still on ${page.url()} after submitting`);

  const row = q(`SELECT u.role || '|' || (u.email IS NULL)::text || '|' || (p."consentAcceptedAt" IS NOT NULL)::text FROM users u JOIN phone_signups p ON p."userId" = u.id WHERE u.phone='${E164}'`);
  row === 'TENANT|true|true'
    ? ok('the account is phone-only, and the acceptance is recorded against it')
    : bad(`the created account reads ${row} (want TENANT|true|true)`);
}

await browser.close();
q(`DELETE FROM users WHERE phone='${E164}'`);
q(`DELETE FROM phone_signups WHERE phone='${E164}'`);

console.log(fail ? `\n❌ ${fail} failure(s)` : '\n✅ a person can sign up with a number alone, and only by accepting the terms themselves');
process.exit(fail ? 1 : 0);
