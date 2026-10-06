#!/usr/bin/env node
/**
 * "Continue with Google" is gone — Phase 8g.
 *
 * The owner is not paying for it. Removing a way IN is only safe if the people
 * who used it still have one, so this proves both halves:
 *
 *   1. the button is off the login screen, and nothing else on the page points
 *      at the OAuth route;
 *   2. an account with NO password — which is what a Google sign-up is — can
 *      still get in, two ways:
 *        · "email me a link" (requestMagicLink never gated on a password, and
 *          this asserts that rather than assuming it);
 *        · "forgot password", which used to answer such an account with "you
 *          sign in with Google" and hand it nothing. That message now points at
 *          a door that does not exist, so it issues a real reset token instead
 *          and the account comes out an ordinary email account.
 *
 * ⚠️ The backend /auth/google route and the passport strategy are deliberately
 * LEFT IN. An account that signed up through Google still exists, and a
 * half-finished callback must not meet a 404. Turning the integration off for
 * real is a Google Cloud change, not a code one.
 *
 * Needs the API on :3000, the app on :4200, and a DATABASE_URL.
 */
import { chromium } from '@playwright/test';
import { apiCall, registerUser, PASSWORD, dbQuery } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
const WEB = process.env.WEB ?? 'http://localhost:4200';

let pass = 0;
const failures = [];
const ok = (m) => { pass++; console.log('  ✅ ' + m); };
const bad = (m) => { failures.push(m); console.log('  ❌ ' + m); };
const check = (c, m) => (c ? ok(m) : bad(m));

// ── 1. The button is off the screen ────────────────────────────────────────
console.log('\n── 1. The login screen ─────────────────────────────────────');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
await page.goto(`${WEB}/auth/login`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const body = ((await page.locator('body').textContent()) ?? '');
check(!/Continue with Google/i.test(body), 'no "Continue with Google" button');
check(
  (await page.locator('.auth__google').count()) === 0,
  '…and no .auth__google element left behind',
);
check(
  (await page.locator('[href*="auth/google"], [href*="/google"]').count()) === 0,
  '…and nothing on the page links to the OAuth route',
);

// The ways in that remain have to actually be there.
check((await page.locator('input[type="email"]').count()) === 1, 'the email field is still there');
check((await page.locator('input[type="password"]').count()) === 1, '…and the password field');
/**
 * ⚠️ The elements, then their words — not a guess at the copy.
 *
 * The first version matched /email me a link/ and failed on a working screen,
 * because the button reads "Email me a sign-in link instead". The second
 * asserted exactly one such button and failed too, because there are two. A
 * check built on remembered wording or a guessed count reports the product
 * broken when it is fine, which is how people learn to ignore a drive.
 */
const magicLabels = await page.locator('.auth__magic').allTextContents();
check(
  magicLabels.length >= 1,
  `…and the passwordless options are on the same screen (${magicLabels.length})`,
);
/**
 * ⚠️ Two of them, not one, and asserting `=== 1` failed on a working screen.
 * The second is "use my phone number instead". Worth stating rather than
 * loosening quietly: an account with no password has TWO ways in here, and the
 * email link is only the one that suits a Google sign-up, which has an address
 * by definition and may well have no number.
 */
check(
  magicLabels.some((t) => /link/i.test(t)),
  `…including one that emails a sign-in link (${magicLabels.map((t) => t.trim()).join(' / ') || 'none'})`,
);
await browser.close();

// ── 2. An account with no password can still get in ────────────────────────
console.log('\n── 2. A Google-shaped account is not stranded ──────────────');

const user = await registerUser(API, 'TENANT');

/**
 * Make it look like a Google sign-up: no password, authProvider google. That is
 * the state the removed button used to be the only comfortable way out of.
 */
dbQuery(`UPDATE users SET "passwordHash" = NULL, "authProvider" = 'google' WHERE id = '${user.id}'`);
check(
  dbQuery(`SELECT "passwordHash" IS NULL FROM users WHERE id = '${user.id}'`) === 't',
  'the fixture has no password at all (precondition, asserted)',
);

const magic = await apiCall(API, 'POST', '/api/auth/magic-link', { email: user.email });
check(magic.status === 200 || magic.status === 201, `"email me a link" is accepted (${magic.status})`);
check(
  dbQuery(`SELECT count(*) FROM auth_tokens WHERE "userId" = '${user.id}' AND type = 'magic_link'`) === '1',
  '…and a magic-link token really was issued for a passwordless account',
);

const reset = await apiCall(API, 'POST', '/api/auth/forgot-password', { email: user.email });
check(reset.status === 200 || reset.status === 201, `"forgot password" is accepted (${reset.status})`);
/**
 * ⚠️ The row in the database, not the reply. This endpoint answers identically
 * whether or not the address exists — deliberately, so it cannot be used to
 * discover accounts — so the HTTP response cannot tell these apart and asserting
 * on it would pass just as well with the old behaviour.
 */
check(
  dbQuery(`SELECT count(*) FROM auth_tokens WHERE "userId" = '${user.id}' AND type = 'password_reset'`) === '1',
  '…and a reset token was issued, where before it got "you sign in with Google" and nothing',
);

console.log('\n═══════════════════════════════════════════════════════');
if (failures.length) {
  console.log(`  ❌ ${failures.length} failed, ${pass} passed.`);
  failures.forEach((f) => console.log(`     ${f}`));
  console.log('═══════════════════════════════════════════════════════\n');
  process.exit(1);
}
console.log(`  ✅ ${pass} checks passed.`);
console.log('═══════════════════════════════════════════════════════\n');
