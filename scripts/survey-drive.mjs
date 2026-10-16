#!/usr/bin/env node
/**
 * The welcome questions, for both roles — Phase 9a.
 *
 * ── What this has to prove
 *
 * The survey existed for landlords only, as a card on their dashboard, and
 * could not store a tenant answer at all: `SurveyResponse` was keyed on
 * `landlordProfileId` and `submit()` refused anybody without a landlord
 * profile. So the things to prove are not "a survey works" but:
 *
 *   · a TENANT is asked tenant questions, and the answers are stored;
 *   · a LANDLORD is asked landlord questions, and the two never mix;
 *   · the account is created BEFORE any of this, so skipping costs nothing;
 *   · a half-answered set survives the tab closing and resumes where it was;
 *   · finishing stops the asking — on the dashboard AND in the inbox;
 *   · the admin view can tell the two populations apart.
 *
 * Needs the API on :3000, the app on :4200, and a DATABASE_URL.
 *
 * ⚠️ Restart the API before a run: registering is rate limited to 60 an hour
 * in memory, and this file registers roughly a dozen accounts.
 */
import { chromium } from '@playwright/test';
import { apiCall, registerUser, signIn, PASSWORD, dbQuery, dbRows } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
const WEB = process.env.WEB ?? 'http://localhost:4200';

let pass = 0;
const failures = [];
const ok = (m) => { pass++; console.log('  ✅ ' + m); };
const bad = (m) => { failures.push(m); console.log('  ❌ ' + m); };
const check = (c, m) => (c ? ok(m) : bad(m));

const browser = await chromium.launch();

/** The build-error overlay makes every UI check below meaningless. */
async function freshBundle(page, where) {
  if (await page.locator('vite-error-overlay').count()) {
    bad(`${where}: the dev server is showing a build error — every check here would be reading the PREVIOUS bundle`);
    return false;
  }
  return true;
}

// ── 1. Each role is asked its OWN questions ──────────────────────────────
console.log('\n── 1. Two surveys, one per role ─────────────────────────────');

{
  const stamp = Date.now();
  const landlord = await registerUser(API, 'LANDLORD', stamp);
  const tenant = await registerUser(API, 'TENANT', stamp + 1);

  const lp = await apiCall(API, 'GET', '/api/surveys/prompt', null, landlord.token);
  const tp = await apiCall(API, 'GET', '/api/surveys/prompt', null, tenant.token);

  check(lp.body?.slug === 'landlord-pain-2026', `a landlord is asked the landlord survey (${lp.body?.slug})`);
  check(tp.body?.slug === 'tenant-search-2026', `a tenant is asked the tenant survey (${tp.body?.slug})`);

  /**
   * ⚠️ THE CHECK THAT MATTERS MOST HERE. The brief says in as many words: do
   * not assume both surveys contain the same questions. A tenant asked what is
   * hard about collecting rent is a survey written by copying, not thinking.
   */
  const lIds = (lp.body?.questions ?? []).map((q) => q.id);
  const tIds = (tp.body?.questions ?? []).map((q) => q.id);
  const shared = lIds.filter((id) => tIds.includes(id));
  check(
    lIds.length > 0 && tIds.length > 0 && shared.length === 0,
    `and they share no question at all (${lIds.length} vs ${tIds.length}, overlap ${shared.length})`,
  );
  check(
    (tp.body?.questions ?? []).every((q) => !/rent on time|tenants damaging/i.test(q.prompt)),
    '…the tenant is not asked a landlord\'s question with the nouns swapped',
  );

  // Cross-role writes are refused by the server, not hidden by the screen.
  const wrong = await apiCall(API, 'POST', '/api/surveys/landlord-pain-2026/responses',
    { answers: { q1_find_tenants: 'Facebook' }, source: 'onboarding' }, tenant.token);
  check(wrong.status === 404, `a tenant cannot answer the landlord survey (${wrong.status})`);
}

// ── 2. The account exists first, and skipping costs nothing ─────────────
console.log('\n── 2. Registration is never at risk ─────────────────────────');

{
  const stamp = Date.now() + 1000;
  const page = await browser.newPage({ viewport: { width: 390, height: 1100 } });
  await page.goto(`${WEB}/auth/register`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await freshBundle(page, '/auth/register');
  if (await page.locator('.cookie-notice__ok').count()) {
    await page.locator('.cookie-notice__ok').click();
    await page.waitForTimeout(300);
  }

  const email = `drive.tenant.${stamp}@example.com`;
  await page.fill('input[formControlName="fullName"], #fullName', `Drive Tenant ${stamp}`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/auth/register'), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  check(page.url().includes('/welcome'), `signing up lands on the welcome questions (${page.url().replace(WEB, '')})`);

  /**
   * ⚠️ THE ACCOUNT IS ALREADY REAL. This is the brief's "do not disrupt
   * account creation", and it is the reason the questions come AFTER the POST
   * rather than inside the form: whatever happens on this screen — a refresh,
   * a closed tab, a skip — the sign-up is already done.
   */
  const row = dbQuery(`SELECT role FROM users WHERE email = '${email}'`).trim();
  check(row === 'TENANT', `…and the account already exists before a single question is answered (got '${row}')`);

  const body = await page.locator('.welcome').textContent().then((t) => (t ?? '').replace(/\s+/g, ' ').trim(), () => '');
  check(/Question 1 of 7/.test(body), `…showing one question at a time with a count ("${(body.match(/Question \d+ of \d+/) ?? ['none'])[0]}")`);
  check(/optional/i.test(body), '…and saying before the first question that every one is optional');
  check(
    (await page.locator('[role="progressbar"]').count()) === 1,
    '…with a progress indicator a screen reader can read',
  );

  /**
   * ⚠️ Guarded, not clicked blind.
   *
   * With the questions unreachable there is nothing to click, and an
   * unguarded click THROWS — ending the run before every check below it,
   * which reports a crash where a list of failures belongs. Proven the hard
   * way: the first negative run of this file died here.
   */
  const answerable = await page.locator('.welcome__option').count();
  if (!answerable) {
    bad('there are no questions to answer on /welcome — everything below this was never measured');
    await page.close();
  } else {
    // Answer two, then LEAVE as if the tab had closed.
    await page.locator('.welcome__option').first().click();
    await page.waitForTimeout(200);
    await page.locator('.btn-primary', { hasText: 'Next' }).click();
    await page.waitForTimeout(900);
    if (await page.locator('.welcome__option').count()) {
      await page.locator('.welcome__option').first().click();
      await page.locator('.btn-primary', { hasText: 'Next' }).click();
      await page.waitForTimeout(900);
    }
    await page.close();
  }

  // ── interrupted, then returning
  // ⚠️ dbRows, not dbQuery. dbQuery returns the FIRST LINE only, so this
  // check reported one answer when there were two — the reader truncating,
  // not the code losing anything.
  const saved = dbRows(
    `SELECT jsonb_object_keys(answers::jsonb) FROM survey_responses r JOIN users u ON u.id = r."userId" WHERE u.email = '${email}'`,
  );
  check(saved.length === 2, `two answers are on the SERVER after walking away (${saved.join(', ') || 'none'})`);
  const done = dbQuery(
    `SELECT "completedAt" IS NULL FROM survey_responses r JOIN users u ON u.id = r."userId" WHERE u.email = '${email}'`,
  ).trim();
  check(done === 't', 'and the set is still open, not counted as finished');

  const back = await signIn(browser, WEB, email, PASSWORD, { width: 390, height: 1100 });
  await back.goto(`${WEB}/welcome`, { waitUntil: 'domcontentloaded' });
  await back.waitForTimeout(1800);
  const resumed = await back.locator('.welcome').textContent().then((t) => (t ?? '').replace(/\s+/g, ' ').trim(), () => '');
  check(
    /Question 3 of 7/.test(resumed),
    `coming back resumes at the next unanswered question ("${(resumed.match(/Question \d+ of \d+/) ?? ['none'])[0]}")`,
  );
  await back.close();
}

// ── 3. Finishing stops the asking, everywhere ───────────────────────────
console.log('\n── 3. Asked once ────────────────────────────────────────────');

{
  const stamp = Date.now() + 2000;
  const landlord = await registerUser(API, 'LANDLORD', stamp);

  const before = await apiCall(API, 'GET', '/api/landlord/inbox', null, landlord.token);
  check(
    (before.body?.items ?? []).some((i) => i.kind === 'survey_open'),
    'an unanswered survey is ONE row in the inbox',
  );
  const row = (before.body?.items ?? []).find((i) => i.kind === 'survey_open');
  check(row?.actionPath === '/welcome', `…pointing at the same screen, not a card of its own (${row?.actionPath})`);
  check(
    (before.body?.items ?? []).indexOf(row) === (before.body?.items ?? []).length - 1,
    '…and last in the list, under everything somebody is actually waiting on',
  );

  const prompt = await apiCall(API, 'GET', '/api/surveys/prompt', null, landlord.token);
  const answers = {};
  for (const q of prompt.body.questions) {
    answers[q.id] = q.kind === 'choice' ? q.options[0] : 'Something I typed';
  }
  const submitted = await apiCall(API, 'POST', `/api/surveys/${prompt.body.slug}/responses`,
    { answers, source: 'onboarding', complete: true }, landlord.token);
  check(submitted.body?.complete === true, `finishing records it as finished (${submitted.status})`);

  const after = await apiCall(API, 'GET', '/api/surveys/prompt', null, landlord.token);
  check(!after.body, 'the prompt goes quiet for good');
  const inboxAfter = await apiCall(API, 'GET', '/api/landlord/inbox', null, landlord.token);
  check(
    !(inboxAfter.body?.items ?? []).some((i) => i.kind === 'survey_open'),
    '…and so does the inbox row');

  // The dashboard carries no survey card at all any more.
  const page = await signIn(browser, WEB, landlord.email, PASSWORD, { width: 390, height: 1400 });
  await page.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await freshBundle(page, '/landlord/dashboard');
  check(
    (await page.locator('app-survey-prompt').count()) === 0,
    'the landlord dashboard has no survey card on it any more',
  );
  await page.close();
}

// ── 4. "I will do this later" is honoured, and keeps what was said ──────
console.log('\n── 4. Not now ───────────────────────────────────────────────');

{
  const stamp = Date.now() + 3000;
  const tenant = await registerUser(API, 'TENANT', stamp);
  const prompt = await apiCall(API, 'GET', '/api/surveys/prompt', null, tenant.token);
  const first = prompt.body.questions[0];
  await apiCall(API, 'POST', `/api/surveys/${prompt.body.slug}/responses`,
    { answers: { [first.id]: first.options[0] }, source: 'onboarding', complete: false }, tenant.token);

  const skipped = await apiCall(API, 'POST', `/api/surveys/${prompt.body.slug}/dismiss`, {}, tenant.token);
  check(skipped.body?.askAgainInDays === 30, `saying "later" is honoured for ${skipped.body?.askAgainInDays} days`);

  const quiet = await apiCall(API, 'GET', '/api/surveys/prompt', null, tenant.token);
  check(!quiet.body, '…and nothing asks again in the meantime');

  // ⚠️ A skip is not a withdrawal: what they already said is still theirs.
  const keptRow = dbQuery(
    `SELECT count(*) FROM survey_responses r JOIN users u ON u.id = r."userId" WHERE u.email = '${tenant.email}'`,
  ).trim();
  check(keptRow === '1', `…while the answer already given is kept (${keptRow} row)`);

  // The window reopens. Proven by moving the dismissal back, not by waiting.
  dbQuery(`UPDATE survey_dismissals SET "dismissedAt" = now() - interval '31 days' WHERE "userId" = (SELECT id FROM users WHERE email = '${tenant.email}')`);
  const again = await apiCall(API, 'GET', '/api/surveys/prompt', null, tenant.token);
  check(!!again.body, 'after 30 days it is asked again, with the earlier answers still there');
  check(again.body?.answered === 1, `…resuming at ${again.body?.answered} of ${again.body?.questions?.length}`);
}

// ── 5. The two populations are counted apart ────────────────────────────
console.log('\n── 5. Landlord and tenant answers never mix ────────────────');

{
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    console.log('  ⏭  SKIP the admin aggregate — set ADMIN_EMAIL and ADMIN_PASSWORD to include it.');
  } else {
    const token = (await apiCall(API, 'POST', '/api/auth/login',
      { email: adminEmail, password: adminPassword })).body?.accessToken;
    const l = await apiCall(API, 'GET', '/api/surveys/admin/landlord-pain-2026/results', null, token);
    const t = await apiCall(API, 'GET', '/api/surveys/admin/tenant-search-2026/results', null, token);
    check(l.status === 200 && t.status === 200, `both surveys have results (${l.status}, ${t.status})`);
    check(l.body?.audienceRole === 'LANDLORD', `the landlord aggregate says whose it is (${l.body?.audienceRole})`);
    check(t.body?.audienceRole === 'TENANT', `…and so does the tenant one (${t.body?.audienceRole})`);
    const lIds = (l.body?.questions ?? []).map((q) => q.id);
    const tIds = (t.body?.questions ?? []).map((q) => q.id);
    check(
      lIds.length && tIds.length && lIds.filter((i) => tIds.includes(i)).length === 0,
      'and no question appears in both aggregates',
    );
    check(
      typeof l.body?.completionRate === 'number' || l.body?.completionRate === null,
      `a completion rate is reported (${l.body?.completionRate}%, ${l.body?.finished}/${l.body?.started})`,
    );
    const csv = await apiCall(API, 'GET', '/api/surveys/admin/tenant-search-2026/results.csv', null, token);
    const text = typeof csv.body === 'string' ? csv.body : JSON.stringify(csv.body);
    check(csv.status === 200 && /question_id/.test(text), `the export is a CSV of counts (${csv.status})`);
    /**
     * ⚠️ Proves its subject exists first. On a 401 the body is an error
     * object, which contains no email and no userId either — so this check
     * passed while reading a refusal. Every negative check in this repo has
     * to show the thing it is denying was actually there.
     */
    check(
      /question_id/.test(text) && !/@|\buserId\b/i.test(text),
      `and carries no person in it — an aggregate, never a row per respondent (${text.length} bytes)`,
    );

    const a = await apiCall(API, 'GET', '/api/surveys/admin/landlord-pain-2026/results', null, null);
    check(a.status === 401, `results need an admin session (${a.status})`);
  }
}

await browser.close();

console.log('\n═══════════════════════════════════════════════════════');
if (failures.length) {
  console.log(`  ❌ ${failures.length} failed, ${pass} passed.`);
  failures.forEach((f) => console.log(`     ${f}`));
  console.log('═══════════════════════════════════════════════════════\n');
  process.exit(1);
}
console.log(`  ✅ ${pass} checks passed.`);
console.log('═══════════════════════════════════════════════════════\n');
