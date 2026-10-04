/**
 * Pausing or closing an account, on screen — Phase 7g, item 3.
 *
 * ── What only a browser shows
 *
 * The API drive proves the data outcomes. These are the things that decide
 * whether a person understands what they are about to do:
 *
 *   1. **The two options are explained as what they do**, not as "deactivate"
 *      and "delete".
 *   2. **What STAYS is on the screen before anything is typed**, with the
 *      reason. A person told "permanently deleted" who later finds their own
 *      words in somebody else's thread would be right to feel misled — the
 *      mechanism keeps shared records on purpose, so the screen has to say so.
 *   3. **The destructive button cannot be reached by accident**: a password,
 *      the word DELETE, and a box that arrives UNTICKED.
 *   4. **A failure keeps what they typed** and shows the real reason.
 *   5. **It works at 360px**, where this is a column of text and three
 *      controls.
 *
 * Needs the API on :3000, the app on :4200, and a DATABASE_URL. The delete
 * endpoint allows ten attempts per fifteen minutes, counted in memory — see the
 * API drive's header.
 */
import { chromium } from '@playwright/test';
import { registerUser, apiCall, signIn, PASSWORD, dbQuery as q } from './lib/drive-session.mjs';

const API = 'http://localhost:3000', WEB = 'http://localhost:4200';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

/** The walkthrough is a modal over everything for a new account. */
const quietNew = async (user) => apiCall(API, 'POST', '/api/users/me/walkthrough-seen', {}, user.token);

const S = Math.floor(Math.random() * 1e6);
const landlord = await registerUser(API, 'LANDLORD');
const pauser = await registerUser(API, 'LANDLORD');
/** Section 7 drives the settings screen's own step-up check, not this phase's. */
const settingsUser = await registerUser(API, 'TENANT');

const room = await apiCall(API, 'POST', '/api/rooms', {
  roomType: 'shared_house', title: `Closing room ${S}`,
  description: 'A clean room in a shared house, close to transport and the shops. Available now.',
  rentCents: 305000, province: 'Gauteng', city: 'Johannesburg',
  locationDisplay: 'Tembisa, Johannesburg',
  availableFrom: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
}, landlord.token);
q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${room.body.id}'`);

/**
 * ⚠️ The fixture has to be entangled, or the check below cannot fail.
 *
 * The first version of this drive gave the landlord a room and nothing else.
 * The preview then had ONE kept item — the rooms — and the assertion looked for
 * the conversation wording, so it failed against correct copy. Worse than the
 * false alarm: with a single kept row this screen cannot show what it exists to
 * show. The person this section is for is the one who had a conversation, let a
 * room and wrote a review, and would otherwise be told "permanently deleted"
 * about records that stay.
 *
 * So a tenant applies, is accepted, and both sides speak. Preconditions are
 * asserted below rather than assumed, because a setup that silently fails makes
 * the screen look honest about a list it never had to render.
 */
const tenant = await registerUser(API, 'TENANT');
await quietNew(tenant);

const application = await apiCall(API, 'POST', '/api/applications',
  { roomId: room.body.id, coverNote: 'I can move in on the first of the month.' }, tenant.token);
const acceptance = await apiCall(API, 'POST', `/api/applications/${application.body?.id}/accept`, {}, landlord.token);
await apiCall(API, 'POST', `/api/applications/${application.body?.id}/messages`,
  { body: 'Bring your ID on Saturday and we can sort the paperwork.' }, landlord.token);
await apiCall(API, 'POST', `/api/applications/${application.body?.id}/messages`,
  { body: 'Will do, see you then.' }, tenant.token);

const uiTenancy = q(`SELECT id FROM tenancies WHERE "applicationId" = '${application.body?.id}'`);
q(`UPDATE tenancies SET status='active' WHERE id = '${uiTenancy}'`);
q(`INSERT INTO reviews (id, "tenancyId", "authorId", "subjectId", "roomId", type, rating, comment, "publishedAt", "createdAt", "updatedAt") VALUES (gen_random_uuid()::text, '${uiTenancy}', '${landlord.id}', '${tenant.id}', '${room.body.id}', 'tenant', 5, 'Paid on time every month, left the room clean.', now(), now(), now())`);

const fixtureOk = acceptance.status < 300
  && Number(q(`SELECT COUNT(*) FROM messages WHERE "senderId" = '${landlord.id}'`)) >= 1
  && Number(q(`SELECT COUNT(*) FROM reviews WHERE "authorId" = '${landlord.id}'`)) >= 1
  && !!uiTenancy;
if (!fixtureOk) {
  console.log('  ❌ the fixture is not entangled (accept '
    + acceptance.status + ', tenancy ' + JSON.stringify(uiTenancy)
    + ') — the kept-list check below could not fail');
  fail++;
}

const browser = await chromium.launch();
const dismissNotice = async (p) => {
  if (await p.locator('.cookie-notice__ok').count()) {
    await p.locator('.cookie-notice__ok').click();
    await p.waitForTimeout(800);
  }
};
await quietNew(landlord);
await quietNew(pauser);
await quietNew(settingsUser);

console.log('\n── 1. Reachable from settings, and not a button on it ───────');

const page = await signIn(browser, WEB, landlord.email, PASSWORD, { width: 1280, height: 900 });
await page.goto(`${WEB}/account/settings`, { waitUntil: 'domcontentloaded' });
await dismissNotice(page);
await page.waitForTimeout(1500);

const link = page.locator('a[href="/account/close"]');
(await link.count()) === 1
  ? ok('settings offers a way to pause or close the account')
  : bad('there is no way to reach the close-account screen from settings');

(await page.locator('.ca-danger, button:has-text("Close my account for good")').count()) === 0
  ? ok('…as a LINK, so the irreversible button is not one scroll below "change your name"')
  : bad('the destructive control is on the settings screen itself');

await link.click();
await page.waitForURL('**/account/close', { timeout: 15000 });
await page.waitForSelector('.ca-danger', { timeout: 20000 });
/**
 * ⚠️ Wait for the PREVIEW, not for the section around it.
 *
 * The kept list, the device-local caveat and the whole form live inside the
 * `@else if (preview(); as p)` block, which arrives one request later than
 * `.ca-danger`. Waiting on `.ca-danger` alone made this drive read the screen
 * before its contents existed: `locator.count()` does not auto-wait, so the
 * kept list measured 0 rows, while `innerText()` on the next line DID wait and
 * came back full — two checks disagreeing about the same screen, one of them
 * reporting a defect that was not there.
 */
await page.waitForSelector('.ca-form', { timeout: 20000 });

console.log('\n── 2. The difference is explained, and so is what survives ──');

const text = (await page.locator('.portal-main').innerText()).replace(/\s+/g, ' ');
/Nothing is deleted/i.test(text) && /you can come back/i.test(text)
  ? ok('pausing is described as reversible, in those words')
  : bad(`the pause section does not say it is reversible: "${text.slice(0, 200)}"`);

/cannot be undone/i.test(text)
  ? ok('closing is described as irreversible')
  : bad('nothing says the closure cannot be undone');

/**
 * ⚠️ The honest part, and the reason this check exists.
 *
 * The mechanism keeps shared records — a conversation, a tenancy's rent
 * history, a review somebody else reads — because deleting the row cascades
 * into other people's data. A screen that said "permanently deleted" and left
 * those behind unmentioned would be the lie.
 */
const keptRows = page.locator('.ca-list--kept li');
const keptCount = await keptRows.count();
const keptText = (await page.locator('.ca-list--kept').innerText().catch(() => '')).replace(/\s+/g, ' ');

/**
 * Asserted STRUCTURALLY, not by phrase.
 *
 * The first version matched the conversation wording against a fixture whose
 * landlord had only listed a room: correct copy, failing check. A phrase match
 * also passes when the reason is missing from every OTHER row, which is the
 * defect worth catching — one explained bullet and three bare labels reads as
 * an explanation and is not one. So: every row carries a reason of its own.
 */
keptCount >= 3
  ? ok(`what STAYS is listed before anything is typed (${keptCount} kinds of record)`)
  : bad(`the kept list has ${keptCount} rows for an entangled account — it should name the rooms, the conversation, the tenancy and the review`);

const rowsWithWhy = [];
for (let i = 0; i < keptCount; i++) {
  const why = (await keptRows.nth(i).locator('.ca-why').innerText().catch(() => '')).trim();
  rowsWithWhy.push(why.length > 20);
}
keptCount > 0 && rowsWithWhy.every(Boolean)
  ? ok('…and EVERY one carries its own reason, so "permanent" is not left to mean something it does not')
  : bad(`${rowsWithWhy.filter((x) => !x).length} of ${keptCount} kept rows have no reason beside them`);

/** The specific one a person would feel misled by: their words in a thread. */
/your name comes off it|name comes off/i.test(keptText)
  ? ok('…including the conversation, which stays with the name taken off it')
  : bad(`the kept list does not mention the conversation: "${keptText.slice(0, 220)}"`);

/kept on this phone or computer/i.test(text)
  ? ok('…including the saved rooms the server cannot reach, which nobody would guess')
  : bad('the screen does not mention the device-local saved rooms');

console.log('\n── 3. The button cannot be reached by accident ──────────────');

const box = page.locator('input[name="understood"]');
(await box.isChecked()) === false
  ? ok('the acknowledgement arrives UNTICKED')
  : bad('the acknowledgement box is pre-ticked, which is consent nobody gave');

const deleteBtn = page.locator('button.btn-danger');
(await deleteBtn.isDisabled())
  ? ok('…and the button is dead until all three are given')
  : bad('the destructive button is live with an empty form');

await page.fill('input[name="password"]', PASSWORD);
await page.waitForTimeout(300);
(await deleteBtn.isDisabled())
  ? ok('…still dead with only the password')
  : bad('the password alone enabled the button');

await page.fill('input[name="confirm"]', 'DELETE');
await page.waitForTimeout(300);
(await deleteBtn.isDisabled())
  ? ok('…still dead with the password and the typed word but no acknowledgement')
  : bad('the button went live without the acknowledgement');

await box.check();
await page.waitForTimeout(300);
!(await deleteBtn.isDisabled())
  ? ok('…and live only with all three')
  : bad('the button stayed dead with everything supplied');

console.log('\n── 4. A wrong password is a wrong password, not a lost session ──');

/**
 * ⚠️ This section found a shipped bug, and it was not on this screen.
 *
 * The step-up checks answered 401. The error interceptor reads a 401 on any
 * non-auth endpoint as an expired access token: it refreshes silently and
 * retries the request once. The retry re-sent the same wrong password, came
 * back 401 again, and a second failure means what it says — "Your session has
 * expired", session cleared, off to the login page.
 *
 * So typing your own password wrong logged you out. The inline "that password
 * is not right" could never render, because the component was gone before it
 * had the chance. That had been true of the settings screen's change-password
 * and change-email forms since they shipped — section 7 below drives that one.
 *
 * Those refusals are 403 now: the request WAS authenticated, and what failed is
 * the password typed into the form. Falsify by putting `UnauthorizedException`
 * back — every check in this section fails, and the URL check names why.
 */
await page.fill('input[name="password"]', 'WrongPass123');
await deleteBtn.click();
await page.waitForTimeout(3000);

page.url().includes('/account/close')
  ? ok('a wrong password leaves you on the screen you were on')
  : bad(`a wrong password navigated to ${page.url()} — the refusal was read as a lost session`);

const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
!/session has expired/i.test(bodyText)
  ? ok('…and is not reported as an expired session')
  : bad('a wrong password was reported as "your session has expired"');

const err = (await page.locator('.ca-form .field-error').innerText().catch(() => '')).replace(/\s+/g, ' ');
/not right/i.test(err)
  ? ok(`…it says the real reason, under the field ("${err.slice(0, 40)}")`)
  : bad(`the failure said: "${err.slice(0, 120)}"`);

/**
 * The dialog would otherwise say the same thing in a modal over the form.
 *
 * Paired with "the form is still there" on purpose: on its own, "no dialog"
 * passed while the bug was present, because the person was on the login page
 * and there was no form for a modal to cover. A check that passes in the broken
 * state is not a check.
 */
(await page.locator('[role="dialog"]').count()) === 0 && (await page.locator('.ca-form').count()) === 1
  ? ok('…once, under the field, and not also in a modal over the form')
  : bad('the refusal is reported in a dialog as well as inline, or the form is gone');

/**
 * ⚠️ Read DEFENSIVELY, because the headline failure removes the form.
 *
 * When this bug is present the person is on the login page, so these locators
 * do not exist — and `inputValue()` on a missing element THROWS, which killed
 * the drive here rather than failing a check. Sections 5, 6 and 7 never ran,
 * including the one covering the settings screen. A drive that crashes on the
 * exact fault it exists to find reports less than one that says nothing.
 *
 * Fourth time in this repository, so: every read past the first failure of a
 * section falls back to a value that FAILS the check.
 */
const keptWord = await page.locator('input[name="confirm"]').inputValue().catch(() => null);
const keptTick = await box.isChecked().catch(() => false);
keptWord === 'DELETE' && keptTick
  ? ok('…and the typed word and the ticked box are left alone, so nothing is refilled')
  : bad(`a failed attempt lost the form (typed word ${JSON.stringify(keptWord)}, tick ${keptTick})`);

q(`SELECT "deletedAt" IS NULL FROM users WHERE id = '${landlord.id}'`) === 't'
  ? ok('…and the account is untouched')
  : bad('a failed attempt changed the account');

console.log('\n── 5. Pausing, from the screen ──────────────────────────────');

const pPage = await signIn(browser, WEB, pauser.email, PASSWORD, { width: 1280, height: 900 });
await pPage.goto(`${WEB}/account/close`, { waitUntil: 'domcontentloaded' });
await dismissNotice(pPage);
await pPage.waitForSelector('button:has-text("Pause my account")', { timeout: 20000 });
await pPage.locator('button:has-text("Pause my account")').click();
await pPage.waitForTimeout(2500);

const paused = (await pPage.locator('.ca-paused').innerText().catch(() => '')).replace(/\s+/g, ' ');
/account is paused/i.test(paused)
  ? ok('pausing says so, and leads with it')
  : bad(`after pausing the screen reads: "${paused.slice(0, 160)}"`);
/Nothing has been deleted/i.test(paused)
  ? ok('…and reassures that nothing was destroyed')
  : bad('the paused state does not say that nothing was deleted');
(await pPage.locator('button:has-text("Use my account again")').count()) === 1
  ? ok('…with the way back on the same screen')
  : bad('there is no way to reactivate from the paused screen');

await pPage.locator('button:has-text("Use my account again")').click();
await pPage.waitForTimeout(2500);
q(`SELECT "deactivatedAt" IS NULL FROM users WHERE id = '${pauser.id}'`) === 't'
  ? ok('…and it works')
  : bad('reactivating from the screen did not clear the pause');

console.log('\n── 6. At 360, 390, 768 and 1280 ─────────────────────────────');

/**
 * All four widths, because the rule in CLAUDE.md is all four and this screen is
 * a form with three controls — the shape that has broken here before. 768 is
 * the one worth having: it is above the 480 breakpoint where the buttons stop
 * going full-width, so it exercises the OTHER branch of the stylesheet.
 */
for (const width of [360, 390, 768, 1280]) {
  const phone = await signIn(browser, WEB, landlord.email, PASSWORD, { width, height: 780 });
  await phone.goto(`${WEB}/account/close`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(phone);
  await phone.waitForSelector('.ca-form', { timeout: 20000 });

  const shape = await phone.evaluate(() => {
    const controls = [...document.querySelectorAll(
      '.ca-form input[type="password"], .ca-form input[type="text"], .ca-form button, .dash-section > .btn')];
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      smallest: controls.length ? Math.min(...controls.map((c) => Math.round(c.getBoundingClientRect().height))) : 0,
      controls: controls.length,
      // The tick box is deliberately 20px — a checkbox is not a tap target on
      // its own, its label is, so the label's height is what matters.
      labelHeight: Math.round(document.querySelector('.ca-check')?.getBoundingClientRect().height ?? 0),
      // A line of body text hundreds of characters wide is the desktop failure.
      widestText: Math.round(Math.max(0, ...[...document.querySelectorAll('.ca-lead, .ca-why, .ca-caveat')]
        .map((e) => e.getBoundingClientRect().width))),
    };
  });

  shape.controls >= 3
    ? ok(`${width}px: the form is there to measure (${shape.controls} controls)`)
    : bad(`${width}px: only ${shape.controls} controls found — the measurements below mean nothing`);
  shape.overflow <= 1
    ? ok(`${width}px: no sideways scroll`)
    : bad(`${width}px: the close-account screen overflows by ${shape.overflow}px`);
  shape.smallest >= 44
    ? ok(`${width}px: every field and button clears 44px (smallest ${shape.smallest}px)`)
    : bad(`${width}px: a control is ${shape.smallest}px tall — under the 44px tap target`);
  shape.labelHeight >= 44
    ? ok(`${width}px: the acknowledgement's whole label is tappable (${shape.labelHeight}px)`)
    : bad(`${width}px: the acknowledgement label is ${shape.labelHeight}px — a 20px tick box with nothing around it`);
  shape.widestText <= 700
    ? ok(`${width}px: the reading measure stays sane (${shape.widestText}px)`)
    : bad(`${width}px: body text runs ${shape.widestText}px wide — one line hundreds of characters long`);

  await phone.context().close();
}

console.log('\n── 7. The same control, where the bug actually shipped ──────');

/**
 * ⚠️ Not this phase's screen, and that is the point.
 *
 * Section 4's finding was never specific to closing an account: the settings
 * screen has demanded the current password to change a password or an email
 * address since it shipped, answered 401 when it was wrong, and so logged the
 * person out with "your session has expired". Both forms had an inline
 * `.field-error` written for a message that could not arrive.
 *
 * A fix proven only on the new screen would have left that in place, so it is
 * driven here. Falsify the same way: `UnauthorizedException` at
 * AccountRecoveryService.changePassword, and this section fails.
 */
const sPage = await signIn(browser, WEB, settingsUser.email, PASSWORD, { width: 1280, height: 900 });
await sPage.goto(`${WEB}/account/settings`, { waitUntil: 'domcontentloaded' });
await dismissNotice(sPage);
await sPage.waitForSelector('#currentPassword', { timeout: 20000 });
await sPage.fill('#currentPassword', 'WrongPass123');
await sPage.fill('#newPassword', 'BrandNewPass789');
await sPage.locator('button:has-text("Change password")').click();
await sPage.waitForTimeout(3500);

sPage.url().includes('/account/settings')
  ? ok('a wrong current password keeps you on the settings screen')
  : bad(`changing a password with the wrong current one went to ${sPage.url()}`);

const sBody = (await sPage.locator('body').innerText()).replace(/\s+/g, ' ');
!/session has expired/i.test(sBody)
  ? ok('…and is not reported as an expired session')
  : bad('a wrong current password is still reported as "your session has expired"');

const sErr = (await sPage.locator('.field-error').allInnerTexts()).join(' | ').replace(/\s+/g, ' ');
/not correct/i.test(sErr)
  ? ok(`…and the inline message finally renders ("${sErr.slice(0, 48)}")`)
  : bad(`the settings screen showed no inline reason: "${sErr.slice(0, 120)}"`);

/** And the password really did not change — a refusal that changed it would be worse. */
const stillOld = await apiCall(API, 'POST', '/api/auth/login', { email: settingsUser.email, password: PASSWORD });
stillOld.status === 200 || stillOld.status === 201
  ? ok('…and the password is unchanged, so the refusal refused')
  : bad(`the old password no longer signs in (${stillOld.status}) after a REFUSED change`);

await browser.close();
console.log(`\n${fail === 0 ? '✅ all checks passed' : `❌ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
