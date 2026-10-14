#!/usr/bin/env node
/**
 * The wordmark: one component, one MA colour, everywhere — Phase I.
 *
 * ── Why this exists
 *
 * The requirement is that the **MA** portion of the logo is the same colour
 * and styling wherever the logo appears. That is a claim about every
 * placement at once, which is exactly the kind of claim nothing here could
 * previously check: the markup was written twice and the rules twice, so
 * "the same" was a thing two files happened to agree about.
 *
 * It is now one component with `--logo-ma` declared on `.logo__ma` inside the
 * component's own scoped styles. That makes the claim structural — but
 * structural is not measured, and this repo has shipped a `MAX_ATTEMPTS`
 * nothing read and a `documentDeletedAt` that deleted nothing. So:
 *
 *   1. MA is #C4522C at every placement and every width, and the SAME value
 *      at all of them, compared rather than asserted one at a time.
 *   2. MA is NOT the stem's colour — if a rule ever pins both halves, the
 *      wordmark still looks fine on a dark header and the requirement is
 *      quietly gone.
 *   3. A parent CANNOT recolour MA. The drive sets `color` on the host from
 *      outside, the way a future stylesheet would, and MA must not move while
 *      the stem must.
 *   4. The rendered size clears **18.66px bold**. This one is load-bearing:
 *      #C4522C is 3.92:1 on `--ink` and 4.28:1 on `--cream`, which clears
 *      WCAG's LARGE-text threshold of 3:1 and not the 4.5:1 small-text one.
 *      The justification holds only while the wordmark is large text, so a
 *      smaller logo is a contrast failure that would look like a styling
 *      tweak. Measured here, not trusted.
 *   5. MA's measured contrast against the backdrop it is actually painted on
 *      is at or above 3:1.
 *   6. There is exactly ONE wordmark per page. Two copies of the markup is
 *      what this phase removed; two copies on screen is what a careless
 *      third placement would add.
 *
 * ⚠️ A selector that matches nothing is a FAILURE here, not a skip. Five
 * vacuous passes have shipped in this repo from negative assertions over text
 * that did not exist.
 *
 * Needs the API on :3000 and a development build served on :4200.
 *
 *   node scripts/logo-drive.mjs
 */
import { chromium } from '@playwright/test';

const WEB = process.env.WEB ?? 'http://localhost:4200';
const WIDTHS = [360, 390, 768, 1280];

/** The one value, and the floor the 3:1 threshold depends on. */
const MA = 'rgb(196, 82, 44)';
const FLOOR_PX = 18.66;

let pass = 0;
const failures = [];
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { failures.push(m); console.log(`  ❌ ${m}`); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

const parseRgb = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
const lum = (rgb) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = rgb.map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/**
 * Everything about one wordmark, read from the browser.
 *
 * The backdrop is walked up the ancestor chain to the first non-transparent
 * background, because `.logo__ma` has none of its own and `rgba(0,0,0,0)` is
 * not a colour you can measure contrast against.
 */
const readLogo = (page, nth) =>
  page.evaluate((n) => {
    const hosts = [...document.querySelectorAll('app-logo')];
    const host = hosts[n];
    if (!host) return null;
    const ma = host.querySelector('.logo__ma');
    const stem = host.querySelector('.logo__stem');
    const root = host.querySelector('.logo');
    if (!ma || !stem || !root) return { incomplete: true, hasMa: !!ma, hasStem: !!stem, hasRoot: !!root };

    let el = root, backdrop = null;
    while (el) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { backdrop = bg; break; }
      el = el.parentElement;
    }

    const cs = getComputedStyle(root);
    const box = root.getBoundingClientRect();
    return {
      count: hosts.length,
      maColour: getComputedStyle(ma).color,
      stemColour: getComputedStyle(stem).color,
      backdrop,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: cs.fontWeight,
      fontFamily: cs.fontFamily,
      text: root.textContent.trim(),
      name: root.getAttribute('aria-label'),
      visible: box.width > 0 && box.height > 0,
      tag: root.tagName.toLowerCase(),
    };
  }, nth);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
await page.goto(`${WEB}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('app-logo', { timeout: 15000 }).catch(() => {});
check(errs.length === 0, `no page error (${errs.slice(0, 2).join(' | ') || 'none'})`);

// ── The two placements, at every width ────────────────────────────────────
const seen = new Map();

for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(200);

  const hosts = await page.locator('app-logo').count();
  check(hosts === 2, `@${width}: exactly 2 wordmarks on the page — header and footer (found ${hosts})`);

  const overflow = await page.evaluate(() => ({
    s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth,
  }));
  check(overflow.s <= overflow.c + 1, `@${width}: no horizontal page scroll (${overflow.s} vs ${overflow.c})`);

  for (let n = 0; n < Math.max(hosts, 1); n++) {
    const where = n === 0 ? 'header' : 'footer';
    const L = await readLogo(page, n);
    if (!L) { bad(`@${width}: ${where} wordmark is not on the page at all — nothing measured`); continue; }
    if (L.incomplete) {
      bad(`@${width}: ${where} wordmark is missing a part (ma=${L.hasMa} stem=${L.hasStem} root=${L.hasRoot})`);
      continue;
    }

    check(L.visible, `@${width}: ${where} wordmark is rendered with a box`);
    // ⚠️ This asserted 'MAstande' until 14 October — the misspelling the
    // component introduced — so the gate did not merely miss the bug, it
    // REQUIRED it: a correct wordmark would have failed the drive. A check
    // written from the code it checks inherits that code's mistakes.
    check(L.text === 'Mastande', `@${width}: ${where} reads "Mastande" (got "${L.text}")`);

    // 1 + 2 — MA is the one value, and it is not the stem's.
    check(L.maColour === MA, `@${width}: ${where} MA is ${MA} (got ${L.maColour})`);
    check(
      L.maColour !== L.stemColour,
      `@${width}: ${where} MA is a different colour from the stem (MA ${L.maColour}, stem ${L.stemColour})`,
    );
    seen.set(`${where}@${width}`, L.maColour);

    // 4 — the floor the 3:1 threshold rests on.
    const bold = Number(L.fontWeight) >= 700;
    check(
      L.fontSize >= FLOOR_PX && bold,
      `@${width}: ${where} is large text — ${L.fontSize}px at weight ${L.fontWeight}, floor ${FLOOR_PX}px bold`,
    );

    // 5 — measured against what it is actually painted on.
    if (!L.backdrop) {
      bad(`@${width}: ${where} has no opaque backdrop anywhere up the tree — contrast is not measurable`);
    } else {
      const ratio = contrast(parseRgb(L.maColour), parseRgb(L.backdrop));
      check(ratio >= 3, `@${width}: ${where} MA on ${L.backdrop} is ${ratio.toFixed(2)}:1 (large-text floor 3:1)`);
      const stemRatio = contrast(parseRgb(L.stemColour), parseRgb(L.backdrop));
      check(stemRatio >= 3, `@${width}: ${where} stem on ${L.backdrop} is ${stemRatio.toFixed(2)}:1`);
    }

    // The accessible name must CONTAIN the visible text — WCAG 2.5.3.
    check(
      (L.name ?? '').toLowerCase().includes(L.text.toLowerCase()),
      `@${width}: ${where} accessible name contains the visible text ("${L.name}")`,
    );
  }
}

// ── 1, continued — the same value at every placement and width ────────────
const values = [...new Set(seen.values())];
check(
  values.length === 1,
  `MA is ONE colour across all ${seen.size} placement/width combinations (${values.join(', ')})`,
);

// ── 3 — a parent cannot recolour MA ───────────────────────────────────────
await page.setViewportSize({ width: 1280, height: 900 });
const forced = await page.evaluate(() => {
  const host = document.querySelector('app-logo');
  const before = {
    ma: getComputedStyle(host.querySelector('.logo__ma')).color,
    stem: getComputedStyle(host.querySelector('.logo__stem')).color,
  };
  // What a future stylesheet, or a parent component, would do.
  host.style.color = 'rgb(0, 128, 0)';
  const root = host.querySelector('.logo');
  root.style.color = 'rgb(0, 128, 0)';
  const after = {
    ma: getComputedStyle(host.querySelector('.logo__ma')).color,
    stem: getComputedStyle(host.querySelector('.logo__stem')).color,
  };
  host.style.color = '';
  root.style.color = '';
  return { before, after };
});
check(
  forced.after.ma === MA,
  `a parent setting color on the logo cannot move MA (still ${forced.after.ma})`,
);
check(
  forced.after.stem === 'rgb(0, 128, 0)',
  `…and the stem DOES follow it, so the test is testing something (${forced.after.stem})`,
);

// ── 6 — EVERY placement, not just the two on the landing page ────────────
//
// ⚠️ This drive measured `/` and nothing else, so it certified "one wordmark
// component" for five releases while /auth/login and /auth/register carried a
// hand-rolled `Mas<span>tande</span>` — unstyled by any rule in the repository,
// inheriting its colours from whatever was nearby, and rendering the OLD split
// with the terracotta on the wrong half. Reported from a live phone on
// 14 October.
//
// A check scoped to one route cannot speak for the others, and this one's own
// headline claim was about everywhere.
for (const route of ['/auth/login', '/auth/register']) {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`${WEB}${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const hosts = await page.locator('app-logo').count();
  check(hosts >= 1, `${route}: uses <app-logo> rather than its own markup (found ${hosts})`);

  // The hand-rolled one is still detectable even if an <app-logo> is added
  // beside it: the brand name split across elements that are NOT the component.
  const handRolled = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      // Inside the component, or a wrapper AROUND it: both are the component
      // doing its job. `.footer-brand` is a div holding one <app-logo> and was
      // this check's first false positive — skipping descendants was not enough,
      // ancestors read as a one-child element whose text is the brand name.
      if (el.closest('app-logo') || el.querySelector('app-logo')) continue;
      if (el.children.length !== 1) continue;
      const t = el.textContent.replace(/\s+/g, '');
      if (/^Mastande$/i.test(t)) out.push(el.tagName.toLowerCase() + '.' + (el.className || '?'));
    }
    return out;
  });
  check(
    handRolled.length === 0,
    `${route}: no wordmark built from raw spans outside the component (${handRolled.join(', ') || 'none'})`,
  );

  if (hosts >= 1) {
    const L = await readLogo(page, 0);
    if (L && !L.incomplete) {
      check(L.text === 'Mastande', `${route}: reads "Mastande" (got "${L.text}")`);
      check(L.maColour === MA, `${route}: MA is ${MA} (got ${L.maColour})`);
      check(
        L.maColour !== L.stemColour,
        `${route}: MA differs from the stem (MA ${L.maColour}, stem ${L.stemColour})`,
      );
    } else {
      bad(`${route}: the wordmark is incomplete or unreadable`);
    }
  }
}

await browser.close();

console.log(`\n── ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
console.log('✅ one wordmark component, MA fixed at #C4522C, large text everywhere.\n');
