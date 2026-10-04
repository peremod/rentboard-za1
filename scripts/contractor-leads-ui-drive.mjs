/**
 * Leads on screen, both sides — Phase 7k.
 *
 * ── The landlord's side, and why it needs saying at all
 *
 * Pressing Call now records that we passed the number on. The landlord is never
 * charged — we may ask the TRADESPERSON for a referral fee — but a landlord who
 * found that out some other way would be right to feel something had been done
 * behind their back, and POPIA s.18 requires telling them what is collected and
 * why in any case. So the page says it, and this drive checks the words.
 *
 * ── The admin's side
 *
 * The figure is what the leads come to at the agreed rate. Nothing has been
 * invoiced and nothing paid, and the product cannot do either: a contractor is
 * not a user. The screen has to say that where somebody reading a column of
 * rand amounts will see it.
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
await quiet(admin);
const ADMIN = (await apiCall(API, 'POST', '/api/auth/login', { email: admin.email, password: PASSWORD })).body?.accessToken;

const landlord = await registerUser(API, 'LANDLORD');
await quiet(landlord);

/**
 * A listed plumber, and NO rate at all — the unpriced state on screen.
 *
 * ⚠️ EVERY rate, not just the plumber ones. "No lead fee has been set" is a
 * statement about the whole table, which is correct product behaviour — it
 * should not appear while some other trade has a price. The first version
 * cleared only plumbers, so the locksmith rates left behind by
 * contractor-leads-drive.mjs kept the panel hidden, and the check reported the
 * screen as silent about a state the fixture had never created.
 *
 * Clearing rows the product refuses to delete is a liberty a drive may take on
 * its own fixtures, and the precondition is asserted rather than assumed.
 */
q(`DELETE FROM contractor_lead_rates`);
Number(q(`SELECT COUNT(*) FROM contractor_lead_rates`)) === 0
  ? ok('no lead rate is configured at all (precondition, asserted)')
  : bad('a rate still exists — the no-rate checks below would prove nothing');
const created = await apiCall(API, 'POST', '/api/services/admin',
  { category: 'plumber', name: `Lead UI Plumber ${S}`, phone: `082 8${String(S).slice(0, 2)} 4444`, areas: ['Tembisa'] }, ADMIN);
await apiCall(API, 'PATCH', `/api/services/admin/${created.body?.id}`,
  { phoneConfirmedAt: '2026-09-18T10:00:00.000Z' }, ADMIN);
await apiCall(API, 'PATCH', `/api/services/admin/${created.body?.id}`, { active: true }, ADMIN);
const provider = created.body?.id;
provider
  ? ok('a listed plumber exists, with no rate configured (precondition, asserted)')
  : bad('the provider fixture failed — nothing below proves anything');

const browser = await chromium.launch();
const dismissNotice = async (p) => {
  if (await p.locator('.cookie-notice__ok').count()) {
    await p.locator('.cookie-notice__ok').click();
    await p.waitForTimeout(600);
  }
};
const pages = new Map();
const pageFor = async (width, who = landlord) => {
  const key = `${who.email}:${width}`;
  if (!pages.has(key)) {
    pages.set(key, await signIn(browser, WEB, who.email, PASSWORD, { width, height: 1000 }));
  }
  return pages.get(key);
};

console.log('\n── 1. The landlord is told, in those words ─────────────────');

{
  const p = await pageFor(1280);
  await p.goto(`${WEB}/landlord/services`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  const loaded = await p.locator('.provider').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  if (!loaded) {
    bad('no provider rendered, so nothing below was measured');
  } else {
    const note = (await p.locator('.services-note').innerText().catch(() => '')).replace(/\s+/g, ' ');
    /note that we passed the number on/i.test(note)
      ? ok('the page says that pressing Call records the hand-over')
      : bad(`the page does not say a lead is recorded: "${note.slice(0, 160)}"`);

    /**
     * ⚠️ The part that matters most. A landlord reading "referral fee" must not
     * be left wondering whether it comes out of their pocket — and "free to
     * list, free to apply" is the position the whole product rests on.
     */
    /you are never charged/i.test(note)
      ? ok('…and that the LANDLORD is never charged, in those words')
      : bad(`the page does not say the landlord is never charged: "${note.slice(0, 160)}"`);
    /tradesperson/i.test(note)
      ? ok('…and who we would ask instead')
      : bad('the page does not say who the fee would come from');
    /do not tell them which landlord/i.test(note)
      ? ok('…and that we do not tell the tradesperson which landlord it was')
      : bad('the page does not say the landlord is not identified to the contractor');
  }
}

console.log('\n── 2. Pressing Call records exactly one lead ───────────────');

{
  const p = await pageFor(1280);

  /**
   * ⚠️ THIS provider's card, not the first one on the page.
   *
   * The first version selected `.provider__actions a[href^="tel:"]` and counted
   * leads for the fixture's provider — but the directory holds every provider
   * the other drives have created, so it was clicking somebody else's number
   * and reporting "pressing Call took the count from 0 to 0". The product was
   * recording a lead correctly, against the contractor it was actually told
   * about.
   */
  const card = p.locator('.provider').filter({ hasText: `Lead UI Plumber ${S}` }).first();
  const tel = card.locator('a[href^="tel:"]').first();
  (await card.count()) === 1
    ? ok('the fixture’s own provider card is on the screen (precondition, asserted)')
    : bad(`found ${await card.count()} cards for this provider — the clicks below would land on somebody else`);

  const before = Number(q(`SELECT COUNT(*) FROM contractor_leads WHERE "providerId" = '${provider}'`));

  /**
   * ⚠️ The tel: link is NOT clicked — Playwright would try to navigate to a
   * protocol the browser cannot handle and the page would be torn down under
   * the drive. The handler is what this checks, so the click is dispatched
   * without the default action, which is what a real tap does before the
   * dialler opens.
   */
  await tel.evaluate((el) => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await p.waitForTimeout(2500);

  const after = Number(q(`SELECT COUNT(*) FROM contractor_leads WHERE "providerId" = '${provider}'`));
  after === before + 1
    ? ok('pressing Call records one lead')
    : bad(`pressing Call took the count from ${before} to ${after}`);

  /** Four more taps, because a ringing phone gets tapped again. */
  for (let i = 0; i < 4; i++) {
    await tel.evaluate((el) => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await p.waitForTimeout(400);
  }
  await p.waitForTimeout(2000);
  Number(q(`SELECT COUNT(*) FROM contractor_leads WHERE "providerId" = '${provider}'`)) === before + 1
    ? ok('…and four more taps record no more — one per landlord per day')
    : bad('tapping again recorded another lead');

  /** With no rate set, it is counted and NOT priced. */
  q(`SELECT "feeCents" IS NULL AND billable = false FROM contractor_leads WHERE "providerId" = '${provider}' LIMIT 1`) === 't'
    ? ok('…and with no rate configured it carries no fee and is not billable')
    : bad('a lead was priced with no rate configured');

  /**
   * ⚠️ The link still works. The handler is fire-and-forget on purpose: a
   * failed bookkeeping write must never stand between somebody with a burst
   * pipe and a plumber, so the href has to be intact and the click must not be
   * prevented.
   */
  const href = await tel.getAttribute('href');
  (href ?? '').startsWith('tel:+27')
    ? ok(`…and the dial link is untouched (${href})`)
    : bad(`the tel: link reads ${JSON.stringify(href)}`);
}

console.log('\n── 3. The admin screen calls it a record, not an invoice ───');

{
  const p = await pageFor(1280, admin);
  await p.goto(`${WEB}/admin/services`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  const section = await p.locator('.lead-section').waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  if (!section) {
    bad('the admin screen has no leads section');
  } else {
    const disclaimer = (await p.locator('.lead-disclaimer').innerText()).replace(/\s+/g, ' ');
    /nothing here has been invoiced or paid/i.test(disclaimer)
      ? ok('the leads section says nothing has been invoiced or paid')
      : bad(`the disclaimer reads: "${disclaimer.slice(0, 180)}"`);
    /no account|cannot do either/i.test(disclaimer)
      ? ok('…and that the product cannot bill, because contractors have no account')
      : bad('the disclaimer does not say why the product cannot bill');

    /**
     * ⚠️ Read out of the PAYLOAD, not written into the template. A report or an
     * export built on the same endpoint cannot then drift from what the screen
     * says — which is the usual way a disclaimer becomes untrue.
     */
    const api = await apiCall(API, 'GET', '/api/services/admin/leads', null, ADMIN);
    disclaimer === (api.body?.disclaimer ?? '').replace(/\s+/g, ' ')
      ? ok('…and it is the server’s own wording, so an export cannot drift from the screen')
      : bad('the screen and the payload word the disclaimer differently');

    /** The unpriced state, which is the honest state of a price nobody set. */
    const norates = (await p.locator('.lead-norates').innerText().catch(() => '')).replace(/\s+/g, ' ');
    /no lead fee has been set/i.test(norates)
      ? ok('with no rate configured it says so, rather than showing R0.00')
      : bad(`the no-rate state reads: "${norates.slice(0, 160)}"`);
    /counted and not priced/i.test(norates)
      ? ok('…and that leads are being counted and deliberately not priced')
      : bad('the no-rate state does not say leads are still counted');

    const table = (await p.locator('.lead-table').innerText()).replace(/\s+/g, ' ');
    table.includes(`Lead UI Plumber ${S}`)
      ? ok('the contractor appears in the table')
      : bad('the contractor is not in the table');
    /counted only/i.test(table)
      ? ok('…with priced and counted-only as separate columns, so one total hides nothing')
      : bad('the table does not separate priced from counted-only');
  }
}

console.log('\n── 4. Setting a rate, with no number suggested ─────────────');

{
  const p = await pageFor(1280, admin);
  const placeholder = await p.locator('.lead-rate-form input[name="rateRand"]').getAttribute('placeholder');
  const value = await p.locator('.lead-rate-form input[name="rateRand"]').inputValue();

  /**
   * ⚠️ The brief said not to implement arbitrary pricing assumptions. An
   * example amount in a form is the number somebody accepts, so the field
   * starts EMPTY and the placeholder names no figure.
   */
  value === ''
    ? ok('the rate field starts empty — no number is suggested')
    : bad(`the rate field is pre-filled with ${JSON.stringify(value)}`);
  !/\d/.test(placeholder ?? '')
    ? ok(`…and the placeholder suggests no figure either ("${placeholder}")`)
    : bad(`the placeholder contains a number: ${JSON.stringify(placeholder)}`);

  await p.selectOption('.lead-rate-form select[name="rateCategory"]', 'plumber');
  await p.fill('.lead-rate-form input[name="rateRand"]', '42');
  await p.locator('.lead-rate-form button[type="submit"]').click();
  await p.waitForTimeout(3000);

  Number(q(`SELECT "amountCents" FROM contractor_lead_rates WHERE category = 'plumber' ORDER BY "createdAt" DESC LIMIT 1`)) === 4200
    ? ok('setting R42 stores 4200 cents — rand in, cents over the wire')
    : bad(`the stored rate is ${q(`SELECT "amountCents" FROM contractor_lead_rates WHERE category = 'plumber' ORDER BY "createdAt" DESC LIMIT 1`)} cents`);

  /** And the already-recorded lead is NOT re-priced by it. */
  q(`SELECT "feeCents" IS NULL FROM contractor_leads WHERE "providerId" = '${provider}' LIMIT 1`) === 't'
    ? ok('…and the lead already recorded keeps no fee: a new rate does not re-price history')
    : bad('setting a rate re-priced a lead that was already recorded');
}

console.log('\n── 5. At four widths ───────────────────────────────────────');

for (const width of WIDTHS) {
  const p = await pageFor(width, admin);
  await p.goto(`${WEB}/admin/services`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  const section = await p.locator('.lead-section').waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  if (!section) {
    bad(`${width}px: the leads section is not on the screen`);
    continue;
  }
  await p.waitForTimeout(600);

  const shape = await p.evaluate(() => {
    const controls = [...document.querySelectorAll('.lead-rate-form input, .lead-rate-form select, .lead-rate-form button')];
    const table = document.querySelector('.lead-table');
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      smallest: controls.length ? Math.min(...controls.map((c) => Math.round(c.getBoundingClientRect().height))) : 0,
      count: controls.length,
      // A five-column table on a phone is a horizontal scroller nobody reads.
      headVisible: table ? getComputedStyle(table.querySelector('thead')).display !== 'none' : false,
      disclaimerWidth: Math.round(document.querySelector('.lead-disclaimer')?.getBoundingClientRect().width ?? 0),
    };
  });

  shape.count >= 4
    ? ok(`${width}px: the rate form is there to measure (${shape.count} controls)`)
    : bad(`${width}px: only ${shape.count} controls — the measurements mean nothing`);
  shape.overflow <= 1
    ? ok(`${width}px: no sideways scroll`)
    : bad(`${width}px: the page scrolls sideways by ${shape.overflow}px`);
  shape.smallest >= 44
    ? ok(`${width}px: every field and button clears 44px (smallest ${shape.smallest}px)`)
    : bad(`${width}px: a control is ${shape.smallest}px tall`);
  (width <= 768) === !shape.headVisible
    ? ok(`${width}px: the table ${shape.headVisible ? 'keeps its headings' : 'becomes labelled blocks'}`)
    : bad(`${width}px: table head visible = ${shape.headVisible}, which is the wrong layout for this width`);
  shape.disclaimerWidth <= 720
    ? ok(`${width}px: …and the disclaimer stays readable (${shape.disclaimerWidth}px)`)
    : bad(`${width}px: the disclaimer runs ${shape.disclaimerWidth}px wide`);
}

await browser.close();
console.log(`\n${fail === 0 ? '✅ all checks passed' : `❌ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
