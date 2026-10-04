/**
 * An admin ending somebody's account, on screen — Phase 7i.
 *
 * ── What only a browser shows
 *
 * The API drive proves the data outcomes. These are the things that decide
 * whether an operator understands what they are about to do to somebody else's
 * account:
 *
 *   1. **It is not where suspension is.** Suspension is an inline control in
 *      the dashboard's user list — reversible, quick, and it belongs there.
 *      This erases a person, so it belongs on a screen that can show what it
 *      will do BEFORE offering the button. Same reasoning that kept the
 *      owner's own closure off the settings screen.
 *   2. **The preview is on screen before anything is typed**, and it names what
 *      STAYS. An admin told "this erases the account" who later finds the
 *      person's words in a landlord's thread was misled by us, not by the
 *      mechanism.
 *   3. **Three things to reach the button**: a written request of real length,
 *      the word CLOSE, and a box that arrives UNTICKED.
 *   4. **A refusal keeps what was typed** and says the real reason — the
 *      request text especially, because retyping it is how a reason becomes
 *      "ok".
 *   5. **An ended account offers no button at all**, and says so.
 *   6. **It works at 360px**, because an operator answering support on a phone
 *      is the normal case here, not the exception.
 *
 * Needs the API on :3000, the app on :4200, and a DATABASE_URL. The drive
 * promotes its own admin rather than reading ADMIN_EMAIL, so nothing is skipped
 * for want of a credential.
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
await quiet(admin);
q(`SELECT role FROM users WHERE id = '${admin.id}'`) === 'ADMIN'
  ? ok('the drive promoted its own admin, so nothing here is skipped for want of a credential')
  : bad('could not promote an admin — every check below proves nothing');

/** A landlord with a tenant, so the preview has a kept list worth reading. */
const landlord = await registerUser(API, 'LANDLORD');
const tenant = await registerUser(API, 'TENANT');
await quiet(landlord);
await quiet(tenant);

const room = await apiCall(API, 'POST', '/api/rooms', {
  roomType: 'shared_house', title: `Admin closure room ${S}`,
  description: 'A clean room in a shared house, close to transport and the shops. Available now.',
  rentCents: 310000, province: 'Gauteng', city: 'Johannesburg',
  locationDisplay: 'Tembisa, Johannesburg',
  availableFrom: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
}, landlord.token);
q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${room.body?.id}'`);
const application = await apiCall(API, 'POST', '/api/applications',
  { roomId: room.body?.id, coverNote: 'I can move in on the first of the month.' }, tenant.token);
await apiCall(API, 'POST', `/api/applications/${application.body?.id}/accept`, {}, landlord.token);
await apiCall(API, 'POST', `/api/applications/${application.body?.id}/messages`,
  { body: 'Bring your ID on Saturday.' }, landlord.token);
application.status === 201
  ? ok('…and a landlord with a tenant and a conversation to be entangled in (asserted)')
  : bad(`the fixture failed (${application.status}) — the preview checks prove nothing`);

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
    pages.set(width, await signIn(browser, WEB, admin.email, PASSWORD, { width, height: 900 }));
  }
  return pages.get(width);
};

console.log('\n── 1. Not where suspension is, and it explains the difference ──');

{
  const p = await pageFor(1280);
  await p.goto(`${WEB}/admin/dashboard`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  await p.waitForTimeout(2500);

  /**
   * ⚠️ Suspension is inline in the list and must STAY inline. The check is
   * that closure has not joined it there — an irreversible control in a list
   * row, one tap from the row above, is the arrangement this phase exists to
   * avoid.
   */
  const body = (await p.locator('.portal-main').innerText()).replace(/\s+/g, ' ');
  /suspend/i.test(body)
    ? ok('the dashboard still offers suspension, inline, where it belongs')
    : bad('suspension has gone from the dashboard list');
  !/end this account|close this account/i.test(body)
    ? ok('…and does NOT offer closure in a list row, one tap from the row above')
    : bad('closure is offered inline in the dashboard list');

  await p.goto(`${WEB}/admin/users/${landlord.id}`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  const section = await p.locator('.ac-danger').waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  section
    ? ok('the detail screen offers it, where there is room to say what it does')
    : bad('there is no way to end an account from the user detail screen');

  if (section) {
    const text = (await p.locator('.ac-danger').innerText()).replace(/\s+/g, ' ');
    /not suspension/i.test(text)
      ? ok('…and says in those words that it is not suspension')
      : bad(`the section does not distinguish itself from suspension: "${text.slice(0, 160)}"`);
    /cannot be undone/i.test(text)
      ? ok('…and that it cannot be undone')
      : bad('nothing says the closure is irreversible');
    /only do this on a request from the account holder/i.test(text)
      ? ok('…and that it is the owner’s decision, not a moderation one')
      : bad('nothing says this is only for a request from the account holder');
  }
}

console.log('\n── 2. The preview is there before anything is typed ────────');

{
  const p = await pageFor(1280);
  await p.waitForSelector('.ac-form', { timeout: 20000 });

  const kept = p.locator('.ac-list--kept li');
  const keptCount = await kept.count();
  keptCount >= 2
    ? ok(`what STAYS is listed before anything is typed (${keptCount} kinds of record)`)
    : bad(`the kept list has ${keptCount} rows for an entangled account`);

  const reasons = [];
  for (let i = 0; i < keptCount; i++) {
    reasons.push(((await kept.nth(i).locator('.ac-why').innerText().catch(() => '')) || '').trim().length > 20);
  }
  keptCount > 0 && reasons.every(Boolean)
    ? ok('…each with the reason it stays, so "erased" is not left to mean something it does not')
    : bad(`${reasons.filter((x) => !x).length} of ${keptCount} kept rows carry no reason`);

  const erased = await p.locator('.ac-list').first().innerText().catch(() => '');
  erased.replace(/\s+/g, ' ').length > 20
    ? ok('…and what goes is listed too')
    : bad('the erased list is empty');
}

console.log('\n── 3. The button cannot be reached by accident ─────────────');

{
  const p = await pageFor(1280);
  const box = p.locator('input[name="understood"]');
  (await box.isChecked()) === false
    ? ok('the acknowledgement arrives UNTICKED')
    : bad('the acknowledgement is pre-ticked, which is consent nobody gave');

  const btn = p.locator('.ac-form button.btn-danger');
  (await btn.isDisabled())
    ? ok('…and the button is dead with an empty form')
    : bad('the destructive button is live with an empty form');

  /** A request of real length, because "ok" is not evidence it was asked for. */
  await p.fill('input[name="reason"]', 'ok');
  await p.fill('input[name="confirm"]', 'CLOSE');
  await box.check();
  await p.waitForTimeout(300);
  (await btn.isDisabled())
    ? ok('…still dead when the recorded request is two characters long')
    : bad('a two-character request enabled the button');

  await p.fill('input[name="reason"]', `Emailed from the registered address, ticket ${S}.`);
  await p.fill('input[name="confirm"]', 'close');
  await p.waitForTimeout(300);
  (await btn.isDisabled())
    ? ok('…and the typed word is case-sensitive, so "close" is not CLOSE')
    : bad('a lowercase "close" enabled the button');

  await p.fill('input[name="confirm"]', 'CLOSE');
  await box.uncheck();
  await p.waitForTimeout(300);
  (await btn.isDisabled())
    ? ok('…still dead with the request and the word but no acknowledgement')
    : bad('the button went live without the acknowledgement');

  await box.check();
  await p.waitForTimeout(300);
  !(await btn.isDisabled())
    ? ok('…and live only with all three')
    : bad('the button stayed dead with everything supplied');
}

console.log('\n── 4. At four widths ───────────────────────────────────────');

for (const width of WIDTHS) {
  const p = await pageFor(width);
  await p.goto(`${WEB}/admin/users/${landlord.id}`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  const formed = await p.locator('.ac-form').waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  if (!formed) {
    bad(`${width}px: the closure form is not on the screen, so nothing was measured`);
    continue;
  }
  await p.waitForTimeout(500);

  const shape = await p.evaluate(() => {
    const controls = [...document.querySelectorAll('.ac-form input[type="text"], .ac-form button')];
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      smallest: controls.length ? Math.min(...controls.map((c) => Math.round(c.getBoundingClientRect().height))) : 0,
      count: controls.length,
      // A tick box is not a tap target on its own; its label is.
      labelHeight: Math.round(document.querySelector('.ac-check')?.getBoundingClientRect().height ?? 0),
    };
  });
  shape.count >= 3
    ? ok(`${width}px: the form is there to measure (${shape.count} controls)`)
    : bad(`${width}px: only ${shape.count} controls — the measurements mean nothing`);
  shape.overflow <= 1
    ? ok(`${width}px: no sideways scroll`)
    : bad(`${width}px: the page scrolls sideways by ${shape.overflow}px`);
  shape.smallest >= 44
    ? ok(`${width}px: every field and button clears 44px (smallest ${shape.smallest}px)`)
    : bad(`${width}px: a control is ${shape.smallest}px tall — under the tap target`);
  shape.labelHeight >= 44
    ? ok(`${width}px: the acknowledgement's whole label is tappable (${shape.labelHeight}px)`)
    : bad(`${width}px: the acknowledgement label is ${shape.labelHeight}px`);
}

console.log('\n── 5. A refusal keeps the request that was typed ───────────');

{
  const p = await pageFor(1280);
  await p.goto(`${WEB}/admin/users/${landlord.id}`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  await p.waitForSelector('.ac-form', { timeout: 20000 });

  const REQUEST = `Emailed from the registered address on 3 Oct, ticket ${S}.`;
  await p.fill('input[name="reason"]', REQUEST);
  await p.fill('input[name="confirm"]', 'CLOSE');
  await p.locator('input[name="understood"]').check();

  /**
   * ⚠️ Refused by the SERVER, not by the form: the account is suspended out
   * from under the screen first, then... no — suspension does not block
   * closure. So the refusal is provoked the only honest way available, by
   * closing it in another tab first and submitting the stale form. A refusal
   * nobody can provoke is a path nobody has tested.
   */
  await apiCall(API, 'DELETE', `/api/admin/users/${landlord.id}`,
    { reason: 'Closed out of band, to provoke the stale-form refusal.', confirm: 'CLOSE', understood: true },
    (await apiCall(API, 'POST', '/api/auth/login', { email: admin.email, password: PASSWORD })).body?.accessToken);

  await p.locator('.ac-form button.btn-danger').click();
  await p.waitForTimeout(3000);

  const err = (await p.locator('.ac-form .field-error').innerText().catch(() => '')).replace(/\s+/g, ' ');
  /already been ended/i.test(err)
    ? ok(`a refusal says the real reason ("${err.slice(0, 48)}")`)
    : bad(`the failure said: "${err.slice(0, 140)}"`);

  const keptText = await p.locator('input[name="reason"]').inputValue().catch(() => null);
  keptText === REQUEST
    ? ok('…and the recorded request is left alone, so nobody retypes it as "ok"')
    : bad(`a refused attempt lost the request text (${JSON.stringify(keptText)})`);

  const url = p.url();
  url.includes(`/admin/users/${landlord.id}`)
    ? ok('…and the operator stays on the account they were looking at')
    : bad(`a refusal navigated to ${url}`);
}

console.log('\n── 6. An ended account offers no button, and says so ───────');

{
  const p = await pageFor(1280);
  await p.goto(`${WEB}/admin/users/${landlord.id}`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  await p.waitForTimeout(2500);

  (await p.locator('.ac-form').count()) === 0
    ? ok('an account that has been ended offers no closure form at all')
    : bad('the closure form is still offered on an account that has been ended');

  const done = (await p.locator('.ac-done').innerText().catch(() => '')).replace(/\s+/g, ' ');
  /has been ended/i.test(done)
    ? ok('…and says so, rather than leaving the operator to infer it')
    : bad(`the ended state reads: "${done.slice(0, 140)}"`);
  /name taken off/i.test(done)
    ? ok('…including that the shared records were kept with the name taken off them')
    : bad('the ended state does not mention what was kept');
}

console.log('\n── 7. And an admin account is never offered the button ─────');

{
  const p = await pageFor(1280);
  await p.goto(`${WEB}/admin/users/${admin.id}`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  await p.waitForTimeout(2500);
  (await p.locator('.ac-danger').count()) === 0
    ? ok('an admin account is not offered a closure form, matching the API’s refusal')
    : bad('the closure form is offered on an admin account the API would refuse');
}

await browser.close();
console.log(`\n${fail === 0 ? '✅ all checks passed' : `❌ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
