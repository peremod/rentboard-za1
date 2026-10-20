/**
 * The navigation sheet — the thing the hamburger opens.
 *
 * ⚠️ Every assertion here is a behaviour the drawer SHIPPED WITHOUT, found
 * by opening it and looking rather than by any check in this repository.
 * `nav-ui-drive` has covered the nav since Phase 7e and passes on all of
 * it, because it asks what the nav CONTAINS and never what the drawer DOES.
 *
 *   1. **Escape did not close it.** Measured: open, press Escape, still
 *      open. On a phone that reads as a stuck menu.
 *   2. **The page scrolled underneath.** body had no lock, and because the
 *      panel is positioned against the HEADER rather than the viewport, a
 *      thumb travelling past the panel's edge slid the whole menu off the
 *      top of the screen while it was still open.
 *   3. **There was no scrim and no close.** A dark panel over a dark hero,
 *      with no boundary between them and nothing outside it saying "tap
 *      away to shut this".
 *   4. **Tab walked straight out of it.** No dialog role, no trap — and
 *      adding the role without the trap is worse than neither, because a
 *      screen reader has then been told the rest of the page is inert when
 *      it is not.
 *   5. **The burger was the character U+2630.** Not an icon: a typeface's
 *      idea of three lines, a different weight and width on every handset.
 *   6. 🔴 **The sheet's own controls were white on white.** The surface went
 *      white in v1.147.0 and `:where(button)` has set `color: var(--white)`
 *      app-wide since Phase 8 — so the language switcher rendered at
 *      1.00:1, the exact ratio `.hint__close` shipped with. Nothing
 *      repainted it; the surface moved out from under it, which is why
 *      `control-contrast-audit` passed throughout: it asks whether a rule
 *      that repaints a BACKGROUND also sets a colour.
 *
 * Needs the API on :3000 and the app on :4200.
 */
import { chromium } from '@playwright/test';

const WEB = 'http://localhost:4200';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const check = (cond, m) => (cond ? ok(m) : bad(m));

const lum = ([r, g, b]) => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || ['0', '0', '0']).slice(0, 3).map(Number);

const browser = await chromium.launch();

/** The sheet only exists at ≤768px; above that the links are in the header. */
for (const width of [360, 390, 768]) {
  console.log(`\n── ${width}px ─────────────────────────────────────────`);
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.goto(WEB, { waitUntil: 'networkidle' });
  // The cookie notice is a fixed panel over the foot of the page and will
  // take a tap meant for the scrim.
  await page.evaluate(() => document.querySelector('app-cookie-consent')?.remove());

  const burger = page.locator('.nav-burger');
  const sheet = page.locator('#nav-sheet');

  check(await burger.locator('svg').count() === 1,
    'the burger is an SVG, not a character the handset chooses');
  check(await burger.locator('svg path').count() === 3,
    '…drawn as three strokes on a 24px grid');
  const boxed = await burger.boundingBox();
  check(!!boxed && boxed.width >= 44 && boxed.height >= 44,
    `…in a 44px target (${Math.round(boxed?.width ?? 0)}×${Math.round(boxed?.height ?? 0)})`);
  check(await burger.getAttribute('aria-label') === 'Open menu',
    '…named for what it will DO, not "Toggle navigation"');
  check(await burger.getAttribute('aria-controls') === 'nav-sheet',
    '…and the state it reports names the thing it belongs to');

  await burger.click();
  await page.waitForTimeout(400);

  check(await burger.getAttribute('aria-label') === 'Close menu',
    'opening it changes what the button says it will do');
  check(await sheet.getAttribute('aria-modal') === 'true',
    'the sheet is a dialog while it is open');
  check(await page.locator('.nav-scrim').count() === 1,
    'there is a scrim behind it');
  check(await page.locator('.nav-sheet-close').count() === 1,
    'and a close inside it, reachable by a thumb that has scrolled');

  // ── 2. the page is held still ──────────────────────────────────────────
  check(await page.evaluate(() => document.body.style.overflowY) === 'hidden',
    'the page behind is locked while it is open');
  /**
   * ⚠️ And overflow-X is still hidden. body carries `overflow-x:hidden`
   * from _spec.scss; a lock written as the `overflow` SHORTHAND would drop
   * it on every close, which is a horizontal scrollbar appearing on a phone
   * after the second time somebody opens the menu.
   */
  check(await page.evaluate(() => getComputedStyle(document.body).overflowX) === 'hidden',
    '…without dropping the overflow-x the body already had');

  // ── 6. the sheet's own controls are legible ON THE SHEET ───────────────
  const sheetBg = await sheet.evaluate((e) => getComputedStyle(e).backgroundColor);
  for (const [sel, name] of [
    ['.nav-sheet-close', 'the close'],
    ['.nav-links.open > a', 'a nav link'],
    ['.nav-links__legal a', 'a legal link'],
    ['.nav-links-lang button', 'the language switcher'],
  ]) {
    const el = page.locator(sel).first();
    if (!(await el.count())) { bad(`${name} is not in the sheet at all`); continue; }
    const fg = await el.evaluate((e) => getComputedStyle(e).color);
    const r = ratio(rgb(fg), rgb(sheetBg));
    check(r >= 4.5, `${name} is legible on the sheet (${r.toFixed(2)}:1)`);
  }

  // The legal links are still reachable, and no longer shouting.
  const navSize = await page.locator('.nav-links.open > a').first()
    .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  const legalSize = await page.locator('.nav-links__legal a').first()
    .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  check(legalSize < navSize,
    `Privacy/Terms/Disclaimer are demoted, not removed (${legalSize}px vs ${navSize}px)`);

  // ── 4. focus is inside, and stays inside ───────────────────────────────
  check(await page.evaluate(() => document.activeElement?.className?.includes?.('nav-sheet-close')),
    'focus moves into the sheet when it opens');
  for (let i = 0; i < 20; i++) await page.keyboard.press('Tab');
  check(await page.evaluate(() =>
    !!document.getElementById('nav-sheet')?.contains(document.activeElement)),
    '…and 20 Tabs later it has not escaped into the page behind');

  // ── 1. Escape ──────────────────────────────────────────────────────────
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  check(await page.locator('.nav-links.open').count() === 0, 'Escape closes it');
  check(await page.evaluate(() => document.body.style.overflowY) === '',
    '…and gives the page back its scroll');
  check(await page.evaluate(() => document.activeElement?.id) === 'nav-burger',
    '…and returns focus to the button that opened it');

  // ── 3. tapping away ────────────────────────────────────────────────────
  await burger.click();
  await page.waitForTimeout(350);
  /**
   * ⚠️ Presence first, then the tap.
   *
   * Written as a bare click, this line DIED on a 30-second timeout when the
   * scrim was removed to falsify it — after correctly failing the scrim
   * check twenty lines earlier. That is the crash-instead-of-report fault
   * this repo keeps producing, and it is worse here than elsewhere: a drive
   * that dies mid-run reports nothing about the checks below it, so the
   * desktop section never ran at all. The absence IS the finding; say it
   * once and carry on.
   */
  const scrim = page.locator('.nav-scrim');
  if (!(await scrim.count())) {
    bad('tapping the scrim closes it — there is no scrim to tap');
  } else {
    await scrim.click({ position: { x: 40, y: 500 } });
    await page.waitForTimeout(350);
    check(await page.locator('.nav-links.open').count() === 0, 'tapping the scrim closes it');
  }

  // ── nothing is pushed sideways by any of it ────────────────────────────
  await burger.click();
  await page.waitForTimeout(350);
  const spill = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(spill <= 1, `the open sheet does not push the page sideways (${spill}px)`);

  await page.close();
}

// ── the sheet must NOT exist on a desktop ────────────────────────────────
console.log('\n── 1280px ───────────────────────────────────────────');
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(WEB, { waitUntil: 'networkidle' });
  check(!(await page.locator('.nav-burger').isVisible().catch(() => false)),
    'the burger is not on a desktop, where the links are in the header');
  check(await page.locator('.nav-scrim').count() === 0,
    '…and nothing is dimmed');
  await page.close();
}

await browser.close();
console.log('\n═══════════════════════════════════════════════════════');
if (fail) { console.log(`  ❌ ${fail} failed.`); process.exit(1); }
console.log('  ✅ all checks passed.');
console.log('═══════════════════════════════════════════════════════');
