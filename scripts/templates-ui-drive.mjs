/**
 * The four downloadable documents — Phase 8a.
 *
 *   node scripts/templates-ui-drive.mjs   (needs the frontend on :4200)
 *
 * ── What is worth checking here, and what is not
 *
 * The content is prose; a drive cannot tell you whether a lease clause is any
 * good. What it CAN tell you is whether the things that stop somebody being
 * harmed are actually on the page and actually on the paper:
 *
 *   · the two contracts say they have not been checked by a lawyer
 *   · that warning SURVIVES PRINTING — a warning that disappears when the
 *     document is printed is one the person holding the paper never sees, and
 *     printing is the entire point of the feature
 *   · "nothing is signed on Mastande" is on the printed page too
 *   · the pages are reachable, and usable on a 360px phone
 *
 * The print checks work by applying the print stylesheet with Playwright's
 * emulateMedia, which is the same cascade the browser uses when it makes the
 * PDF — not a guess about what print might do.
 */
import { chromium } from 'playwright';

const WEB = 'http://localhost:4200';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const CONTRACTS = ['lease-agreement', 'lease-addendum'];
const READY = ['move-in-inspection', 'deposit-receipt'];
const ALL = [...READY, ...CONTRACTS];

const browser = await chromium.launch();

// ── 1. The index ────────────────────────────────────────────────────────
console.log('\n── 1. The list page ─────────────────────────────────────────');
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${WEB}/templates`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const listText = await page.locator('body').innerText();

/forms and templates/i.test(listText)
  ? ok('the list page loads')
  : bad('the templates list does not load or has no heading');

const cards = await page.locator('.tpl-card').count();
cards === 4
  ? ok(`all four templates are listed (${cards})`)
  : bad(`${cards} templates listed, expected 4`);

/nothing is signed on mastande/i.test(listText)
  ? ok('…and the list says nothing is signed here')
  : bad('the list page does not say nothing is signed on Mastande');
/not a law firm/i.test(listText)
  ? ok('…and that Mastande is not a law firm')
  : bad('the list page does not disclaim legal advice');
/does not hold deposits/i.test(listText)
  ? ok('…and does not hold deposits or rent')
  : bad('the list page does not say Mastande holds no money');

const flags = await page.locator('.tpl-flag').count();
flags === 2
  ? ok('exactly the two contracts are flagged as unchecked')
  : bad(`${flags} templates flagged as unchecked, expected 2 (the lease and the addendum)`);

// ── 2. Every template opens, and says what it is ────────────────────────
console.log('\n── 2. Each document ────────────────────────────────────────');
for (const slug of ALL) {
  await page.goto(`${WEB}/templates/${slug}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const t = await page.locator('body').innerText();

  (await page.locator('.tpl-doc').count()) === 1
    ? ok(`${slug}: the document renders`)
    : bad(`${slug}: no document on the page`);

  /nothing is signed on mastande/i.test(t)
    ? ok(`${slug}: …and carries "nothing is signed on Mastande"`)
    : bad(`${slug}: the document does not say nothing is signed here`);

  (await page.locator('.tpl-field').count()) > 0
    ? ok(`${slug}: …and has lines to fill in (${await page.locator('.tpl-field').count()})`)
    : bad(`${slug}: the document has no fields, so it is not a form`);

  (await page.locator('button:has-text("Save as PDF or print")').count()) === 1
    ? ok(`${slug}: …and a way to save it`)
    : bad(`${slug}: there is no print control`);
}

// ── 3. ⚠️ The warning survives printing ─────────────────────────────────
//
// The whole point of this section. A warning that is visible on screen and
// gone from the PDF is a warning nobody sees, on the two documents that create
// binding obligations.
console.log('\n── 3. What survives into the PDF ───────────────────────────');
await page.emulateMedia({ media: 'print' });

for (const slug of CONTRACTS) {
  await page.goto(`${WEB}/templates/${slug}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const warnVisible = await page.evaluate(() => {
    const el = document.querySelector('.tpl-warn');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden'
      && el.getBoundingClientRect().height > 0;
  });
  warnVisible === true
    ? ok(`${slug}: the "not checked by a lawyer" warning is ON THE PRINTED PAGE`)
    : bad(`${slug}: the warning is ${warnVisible === null ? 'absent' : 'hidden'} when printed — the person holding the paper never sees it`);
}

for (const slug of READY) {
  await page.goto(`${WEB}/templates/${slug}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  (await page.locator('.tpl-warn').count()) === 0
    ? ok(`${slug}: carries no lawyer warning, because it does not need one`)
    : bad(`${slug}: is flagged as unreviewed; only the two contracts should be`);
}

// The footer disclaimer prints too, on every one of them.
for (const slug of ALL) {
  await page.goto(`${WEB}/templates/${slug}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const footVisible = await page.evaluate(() => {
    const el = document.querySelector('.tpl-foot');
    return el ? getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0 : false;
  });
  footVisible
    ? ok(`${slug}: the disclaimer prints as well`)
    : bad(`${slug}: the disclaimer is dropped from the printed page`);
}

// And the site chrome is NOT on the paper.
await page.goto(`${WEB}/templates/move-in-inspection`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const chrome = await page.evaluate(() => {
  const vis = (sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).display !== 'none' : false;
  };
  return { navbar: vis('app-navbar'), footer: vis('app-footer'), buttons: vis('.tpl-bar') };
});
!chrome.navbar && !chrome.footer && !chrome.buttons
  ? ok('the navbar, site footer and buttons are all off the printed page')
  : bad(`site chrome would print onto a lease: ${JSON.stringify(chrome)}`);

await page.emulateMedia({ media: 'screen' });
await ctx.close();

// ── 4. Usable on a phone ────────────────────────────────────────────────
console.log('\n── 4. At four widths ───────────────────────────────────────');
for (const width of [360, 390, 768, 1280]) {
  const c = await browser.newContext({ viewport: { width, height: 900 } });
  const p = await c.newPage();
  await p.goto(`${WEB}/templates/move-in-inspection`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const m = await p.evaluate(() => {
    const vis = (el) => getComputedStyle(el).display !== 'none'
      && el.getBoundingClientRect().height > 0;
    const controls = [...document.querySelectorAll('button, a.btn')].filter(vis);
    return {
      count: controls.length,
      minHeight: controls.length ? Math.min(...controls.map((c) => c.getBoundingClientRect().height)) : 0,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tableWidth: Math.round(document.querySelector('.tpl-table')?.getBoundingClientRect().width ?? 0),
    };
  });

  m.count >= 2
    ? ok(`${width}px: ${m.count} controls to measure`)
    : bad(`${width}px: only ${m.count} control(s) found`);
  m.count >= 2 && m.minHeight >= 44
    ? ok(`${width}px: every control clears 44px (smallest ${Math.round(m.minHeight)}px)`)
    : bad(`${width}px: a control is ${Math.round(m.minHeight)}px, under the 44px target`);
  m.overflow <= 1
    ? ok(`${width}px: no sideways scroll`)
    : bad(`${width}px: the page overflows by ${m.overflow}px`);
  // The inspection table is the widest thing in the feature and the most
  // likely to push the page sideways on a phone.
  m.tableWidth > 0 && m.tableWidth <= width
    ? ok(`${width}px: the inspection table fits (${m.tableWidth}px)`)
    : bad(`${width}px: the inspection table is ${m.tableWidth}px in a ${width}px viewport`);
  await c.close();
}

// ── 5. Reachable ────────────────────────────────────────────────────────
console.log('\n── 5. Somebody can find it ─────────────────────────────────');
const c2 = await browser.newContext({ viewport: { width: 390, height: 900 } });
const p2 = await c2.newPage();
await p2.goto(`${WEB}/`, { waitUntil: 'networkidle' });
await p2.waitForTimeout(900);
const links = await p2.evaluate(() =>
  [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? ''));
links.some((h) => /\/templates/.test(h))
  ? ok('a signed-out visitor is offered the templates from the home page footer')
  : bad('nothing on the public site links to /templates — it exists and cannot be found');

// A slug that does not exist must say so rather than render an empty document.
await p2.goto(`${WEB}/templates/not-a-real-template`, { waitUntil: 'networkidle' });
await p2.waitForTimeout(700);
const missing = await p2.locator('body').innerText();
/does not exist/i.test(missing) && (await p2.locator('.tpl-doc').count()) === 0
  ? ok('an unknown template says so rather than rendering a blank document')
  : bad('an unknown slug renders something — a blank form with a print button is worse than a 404');
await c2.close();

await browser.close();
console.log(fail ? `\n❌ ${fail} failure(s)` : '\n✅ the templates print, warn, and fit on a phone');
