/**
 * What the directory SAYS about a tradesperson — Phase 7j, on screen.
 *
 * ── The sentence this drive exists for
 *
 * /landlord/services opened with "People we have checked out and can pass on",
 * and nothing in the product recorded a check of any kind. The API drive proves
 * the outcomes are now stored and enforced; this one proves the screen states
 * them rather than going back to a reassuring phrase.
 *
 * The checks that matter:
 *
 *   1. **No blanket claim.** The old sentence is gone, and the new one points
 *      the landlord at the per-name detail rather than asking for their trust.
 *   2. **Each name carries its own checks, with dates.** A provider with one
 *      check must not read the same as one with three.
 *   3. **The registration is shown verbatim**, with the caveat that we pass it
 *      on as given — it is only worth storing because a landlord can check it
 *      with the body themselves.
 *   4. **Nothing on screen says more than the row holds.** Driven by stripping
 *      a check in the database and reading the screen again: the line must
 *      disappear, not persist as decoration.
 *   5. **It works at the four widths.**
 *
 * Promotes its own admin. Needs the API on :3000, the app on :4200 and a
 * DATABASE_URL.
 */
import { chromium } from '@playwright/test';
import { registerUser, signIn, apiCall, PASSWORD, dbQuery as q } from './lib/drive-session.mjs';

const API = 'http://localhost:3000', WEB = 'http://localhost:4200';
const WIDTHS = [360, 390, 768, 1280];
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const S = Math.floor(Math.random() * 1e6);
const quiet = (u) => apiCall(API, 'POST', '/api/users/me/walkthrough-seen', {}, u.token);

const admin = await registerUser(API, 'LANDLORD');
q(`UPDATE users SET role = 'ADMIN' WHERE id = '${admin.id}'`);
const ADMIN = (await apiCall(API, 'POST', '/api/auth/login', { email: admin.email, password: PASSWORD })).body?.accessToken;

const landlord = await registerUser(API, 'LANDLORD');
await quiet(landlord);

/** Two providers: one fully checked, one with only the phone call. */
const mk = async (name, category, phone, checks) => {
  const created = await apiCall(API, 'POST', '/api/services/admin',
    { category, name, phone, areas: ['Tembisa'], note: 'Geysers and blocked drains.' }, ADMIN);
  if (created.status !== 201) return null;
  await apiCall(API, 'PATCH', `/api/services/admin/${created.body.id}`, checks, ADMIN);
  await apiCall(API, 'PATCH', `/api/services/admin/${created.body.id}`, { active: true }, ADMIN);
  return created.body.id;
};

const thorough = await mk(`Thorough Plumbing ${S}`, 'plumber', `082 3${String(S).slice(0, 2)} 1111`, {
  phoneConfirmedAt: '2026-09-18T10:00:00.000Z',
  idCheckedAt: '2026-09-19T09:00:00.000Z',
  referenceCheckedAt: '2026-09-20T14:00:00.000Z',
  tradeRegistration: 'PIRB P12345',
});
const minimal = await mk(`Phoned Only Sparks ${S}`, 'electrician', `083 4${String(S).slice(0, 2)} 2222`, {
  phoneConfirmedAt: '2026-09-21T11:00:00.000Z',
});

thorough && minimal
  ? ok('two providers exist: one with three checks, one with only the phone call (asserted)')
  : bad(`the fixtures failed (thorough ${thorough}, minimal ${minimal}) — nothing below proves anything`);

const browser = await chromium.launch();
const dismissNotice = async (p) => {
  if (await p.locator('.cookie-notice__ok').count()) {
    await p.locator('.cookie-notice__ok').click();
    await p.waitForTimeout(600);
  }
};
const pages = new Map();
const pageFor = async (width) => {
  if (!pages.has(width)) {
    pages.set(width, await signIn(browser, WEB, landlord.email, PASSWORD, { width, height: 1000 }));
  }
  return pages.get(width);
};

/** The provider card for one name, found by its heading text. */
const cardFor = (p, name) => p.locator('.provider').filter({ hasText: name }).first();

console.log('\n── 1. The blanket claim is gone ────────────────────────────');

{
  const p = await pageFor(1280);
  await p.goto(`${WEB}/landlord/services`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  const loaded = await p.locator('.provider').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  if (!loaded) {
    bad('no provider rendered, so nothing below was measured');
  } else {
    const banner = (await p.locator('.insight-banner').innerText()).replace(/\s+/g, ' ');

    /**
     * ⚠️ The exact old sentence. Asserted as ABSENT by its own words, because
     * "we have checked out" is the unfalsifiable claim this phase removed, and
     * a drive that only checked for the NEW wording would pass with both on the
     * screen.
     */
    !/checked out and can pass on/i.test(banner)
      ? ok('the old blanket claim "people we have checked out and can pass on" is gone')
      : bad(`the banner still makes the blanket claim: "${banner.slice(0, 140)}"`);

    /each one says below what we checked/i.test(banner)
      ? ok('…and the banner points at the per-name detail instead of asking for trust')
      : bad(`the banner does not point at the detail: "${banner.slice(0, 160)}"`);

    /we take no money|take no money/i.test(banner)
      ? ok('…while still saying we take no money, which has not changed')
      : bad('the banner no longer says we take no money');
  }
}

console.log('\n── 2. Each name carries its own checks, with dates ─────────');

{
  const p = await pageFor(1280);
  const thoroughCard = cardFor(p, `Thorough Plumbing ${S}`);
  const minimalCard = cardFor(p, `Phoned Only Sparks ${S}`);

  const tLines = await thoroughCard.locator('.provider__checks li').allInnerTexts().catch(() => []);
  const mLines = await minimalCard.locator('.provider__checks li').allInnerTexts().catch(() => []);

  tLines.length === 3
    ? ok('the thoroughly checked name lists all three checks')
    : bad(`the thorough provider shows ${tLines.length} checks: ${JSON.stringify(tLines)}`);

  /**
   * ⚠️ The check that makes the difference visible. One check and three checks
   * must not read the same — which is exactly what a blanket "we checked them"
   * did for both.
   */
  mLines.length === 1
    ? ok('…and the one we only phoned lists exactly one, so the two do not read alike')
    : bad(`the minimally checked provider shows ${mLines.length} checks: ${JSON.stringify(mLines)}`);

  const joined = tLines.join(' | ');
  /rang this number/i.test(joined) && /identity document/i.test(joined) && /landlord they have worked for/i.test(joined)
    ? ok('…named in plain words: the call, the document, the reference')
    : bad(`the check labels read: ${JSON.stringify(joined)}`);

  /** A check has a date or it is a rumour. */
  /18 Sep 2026/.test(joined)
    ? ok('…each with the date it happened, not just that it happened')
    : bad(`no date on the checks: ${JSON.stringify(joined)}`);

  const reg = (await thoroughCard.locator('.provider__reg').innerText().catch(() => '')).replace(/\s+/g, ' ');
  /PIRB P12345/.test(reg)
    ? ok('the registration is shown verbatim')
    : bad(`the registration is not on screen: "${reg.slice(0, 120)}"`);
  /check it with the body yourself/i.test(reg)
    ? ok('…with the caveat that we pass it on as given, not as verified by us')
    : bad(`the registration is presented without the caveat: "${reg.slice(0, 140)}"`);
  (await minimalCard.locator('.provider__reg').count()) === 0
    ? ok('…and a provider with no registration claims none')
    : bad('a provider with no registration shows a registration line');
}

console.log('\n── 3. The screen cannot say more than the row holds ────────');

{
  /**
   * ⚠️ Driven by stripping a stored outcome and reading the screen again.
   *
   * This is the falsification built into the drive: if the check lines were
   * decoration — a fixed list of reassurances rather than a render of the data
   * — removing the row's reference call would change nothing on screen. The
   * whole phase is about the screen not being able to overclaim, so the drive
   * proves it the only way that means anything.
   */
  q(`UPDATE service_providers SET "referenceCheckedAt" = NULL WHERE id = '${thorough}'`);
  const p = await pageFor(1280);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  await p.waitForSelector('.provider', { timeout: 20000 });
  await p.waitForTimeout(800);

  const lines = await cardFor(p, `Thorough Plumbing ${S}`).locator('.provider__checks li').allInnerTexts().catch(() => []);
  lines.length === 2
    ? ok('removing the reference call from the row removes the line from the screen')
    : bad(`the card still shows ${lines.length} checks after one was cleared: ${JSON.stringify(lines)}`);
  !/landlord they have worked for/i.test(lines.join(' | '))
    ? ok('…so the list is a render of the data, not a fixed set of reassurances')
    : bad('the reference line is still on screen after the outcome was cleared');

  // Put it back, so the width checks below read the full card.
  q(`UPDATE service_providers SET "referenceCheckedAt" = '2026-09-20T14:00:00Z' WHERE id = '${thorough}'`);
}

console.log('\n── 4. At four widths ───────────────────────────────────────');

for (const width of WIDTHS) {
  const p = await pageFor(width);
  await p.goto(`${WEB}/landlord/services`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  const loaded = await p.locator('.provider').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  if (!loaded) {
    bad(`${width}px: no provider rendered, so nothing was measured`);
    continue;
  }
  await p.waitForTimeout(600);

  const shape = await p.evaluate(() => {
    const actions = [...document.querySelectorAll('.provider__actions .btn, .provider__actions .link-btn')];
    const checkList = document.querySelector('.provider__checks');
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      smallestAction: actions.length ? Math.min(...actions.map((a) => Math.round(a.getBoundingClientRect().height))) : 0,
      actionCount: actions.length,
      // A check list that runs wider than the card is the desktop failure.
      checksWidth: checkList ? Math.round(checkList.getBoundingClientRect().width) : 0,
      bulleted: checkList ? getComputedStyle(checkList).listStyleType : 'none',
    };
  });

  shape.actionCount >= 1
    ? ok(`${width}px: the call and WhatsApp buttons are there to measure (${shape.actionCount})`)
    : bad(`${width}px: no action buttons found — the measurements mean nothing`);
  shape.overflow <= 1
    ? ok(`${width}px: no sideways scroll`)
    : bad(`${width}px: the directory scrolls sideways by ${shape.overflow}px`);
  shape.smallestAction >= 44
    ? ok(`${width}px: every action clears 44px (smallest ${shape.smallestAction}px)`)
    : bad(`${width}px: an action is ${shape.smallestAction}px tall — under the tap target`);
  shape.bulleted === 'none'
    ? ok(`${width}px: the checks are a styled list, not a bulleted one`)
    : bad(`${width}px: the check list renders list-style-type ${shape.bulleted}`);
  shape.checksWidth <= 700
    ? ok(`${width}px: …and the reading measure stays sane (${shape.checksWidth}px)`)
    : bad(`${width}px: the check list runs ${shape.checksWidth}px wide`);
}

console.log('\n── 5. The empty state no longer claims a check either ──────');

{
  const p = await pageFor(1280);
  await p.goto(`${WEB}/landlord/services?`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  await p.waitForSelector('.services-filter input', { timeout: 20000 });
  await p.fill('.services-filter input', `Nowhere${S}`);
  await p.locator('button:has-text("Filter")').click();
  await p.waitForTimeout(2500);

  const empty = (await p.locator('.empty-state').innerText().catch(() => '')).replace(/\s+/g, ' ');
  empty.length > 0
    ? ok('filtering to an area with nobody in it shows the empty state')
    : bad('no empty state rendered, so its wording was not checked');
  !/names we have checked/i.test(empty)
    ? ok('…and it no longer says "names we have checked", which nothing recorded')
    : bad(`the empty state still makes the old claim: "${empty.slice(0, 140)}"`);
}

await browser.close();
console.log(`\n${fail === 0 ? '✅ all checks passed' : `❌ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
