#!/usr/bin/env node
/**
 * What `font-display` actually costs the largest paint, measured as a
 * MECHANISM rather than as a benchmark.
 *
 * ── Why this exists
 *
 * §90e recorded that self-hosting the two families costs about 310ms of LCP
 * against the Google Fonts baseline, and named glyph-subsetting as the remedy.
 * That attribution is suspect, because the move to `src/assets/fonts` changed
 * TWO things at once:
 *
 *   1. the ORIGIN — fonts.gstatic.com became this origin;
 *   2. the DISPLAY STRATEGY — `display=swap` became `font-display: optional`.
 *
 * They do not cost the same thing. `swap` has a zero block period: the text
 * paints immediately in the fallback and reflows when the file lands — which
 * is the CLS this was all for. `optional` has a SHORT BLOCK PERIOD (~100ms in
 * Chrome) during which the text is **invisible**, and then keeps the fallback
 * for that page view. Invisible text cannot be a largest paint, so `optional`
 * can only delay LCP relative to `swap`, by up to the block period — for the
 * board, whose LCP element is the `h1.hero-headline` in Playfair.
 *
 * So some of that 310ms belongs to the fix for the shift, not to where the
 * files are served from, and a glyph subset cannot buy it back.
 *
 * ── Why this is not a benchmark
 *
 * This container is too loaded to adjudicate 300ms — it measured `/` at
 * LCP 4370ms against the runner's 2529ms in the same build (§90e). So nothing
 * here compares an absolute number to CI's. It DELAYS the font response by a
 * fixed amount and asks a yes/no question: with the file certain to miss its
 * window, does the headline paint at once, or only after the block period?
 * That answer does not depend on how fast this box is.
 *
 * The variants are produced by rewriting the stylesheet in flight, so all
 * three run against ONE build and cannot differ by anything else.
 *
 *   node scripts/font-paint-drive.mjs
 *   FONT_DELAY_MS=1500 node scripts/font-paint-drive.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4000';
const DELAY = Number(process.env.FONT_DELAY_MS ?? 1500);
const RUNS = Number(process.env.RUNS ?? 5);

/** Median, because one run of anything on this box is noise. */
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** The three variants, all from the same bundle. */
const VARIANTS = [
  { name: 'optional (as shipped)', rewrite: (css) => css },
  { name: 'swap', rewrite: (css) => css.replaceAll('font-display:optional', 'font-display:swap') },
  {
    name: 'no webfont at all',
    // Every @font-face block removed, so the fallback stack is all there is.
    rewrite: (css) => css.replace(/@font-face\s*\{[^}]*\}/g, ''),
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure(browser, variant) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  /**
   * ⚠️ Cache disabled, and this was the FOURTH defect in this harness.
   *
   * With it on, `optional` reported "brand face in use: true" while every font
   * response was being held back 1500ms — which is impossible, and therefore
   * the tell: the file was coming from cache, laid down by an earlier run in
   * the same browser. A BrowserContext does not isolate the HTTP cache as
   * reliably as it isolates cookies, so each run after the first was measuring
   * a warm font, which is the one state this harness must never be in.
   */
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  /**
   * When does the font fetch START?
   *
   * This is the mechanism the CI delta most likely turns on, and it is not the
   * same question as how long the file takes. With Google Fonts the @font-face
   * rules live in a stylesheet on fonts.googleapis.com, so the browser cannot
   * even know a font exists until a THIRD-PARTY DNS lookup, TLS handshake and
   * CSS round trip have completed — by which time the headline has long since
   * painted in the fallback under `swap`. Self-hosted, the rules are in the
   * stylesheet already being parsed, so the requests start at once and compete
   * with render-critical bytes on a throttled link.
   *
   * A font request that starts BEFORE the headline paints is contending with
   * it. One that starts after cannot be.
   */
  await page.route('**/*.woff2', async (route) => {
    if (DELAY > 0) await sleep(DELAY);
    await route.continue();
  });

  /**
   * Rewrite the stylesheet in flight — one build, three variants.
   *
   * ⚠️ The rewrite is CHECKED, because the first version of this harness was
   * not. The "no webfont at all" variant reported two font requests, which a
   * stylesheet with no @font-face cannot make: the strip had silently failed
   * and the variant was measuring the same thing as the one above it. A
   * variant that does not do what it says is worse than no variant — it looks
   * like a control.
   */
  let faceCount = { before: 0, after: 0 };

  /**
   * ⚠️ THE DOCUMENT TOO, and this is the finding that matters beyond the
   * harness: **Angular SSR inlines the critical CSS**, and the four
   * @font-face blocks are in it. The served board carries them in a <style>
   * tag, so the strategy governing the FIRST PAINT is the inlined copy — not
   * the external stylesheet, which applies later and merely overrides.
   *
   * The first two versions of this harness rewrote only `**\/*.css`. The
   * "no webfont at all" variant therefore reported 4 -> 0 @font-face in the
   * served CSS and still made two font requests, which is how the omission
   * was caught: the control was not a control, and had I stopped there I
   * would have drawn a conclusion from a variant that never existed.
   *
   * It also means a plan to defer font loading by moving @font-face out of
   * the render-critical stylesheet would be defeated by the inliner.
   */
  await page.route(BASE + '/**', async (route, request) => {
    if (request.resourceType() !== 'document') return route.continue();
    const res = await route.fetch();
    const html = await res.text();
    const body = variant.rewrite(html);
    const count = (s) => (s.match(/@font-face/g) ?? []).length;
    faceCount = { before: count(html), after: count(body) };
    await route.fulfill({ response: res, body });
  });

  await page.route('**/*.css', async (route) => {
    const res = await route.fetch();
    const css = await res.text();
    const body = variant.rewrite(css);
    await route.fulfill({ response: res, body });
  });

  await page.addInitScript(() => {
    window.__lcp = 0;
    window.__lcpEl = '';
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__lcp = e.startTime;
        window.__lcpEl = e.element?.tagName + (e.element?.className ? '.' + e.element.className : '');
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });

  await page.goto(BASE, { waitUntil: 'load' });

  // First paint of the headline, independent of the LCP heuristic: the time
  // at which the h1 has ink. Taken from the paint timeline the browser keeps.
  const firstContentfulPaint = await page.evaluate(
    () => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
  );

  // The resource timeline, read before anything here touches styles.
  const fontStarts = await page.evaluate(() =>
    performance.getEntriesByType('resource')
      .filter((e) => e.name.endsWith('.woff2'))
      .map((e) => e.startTime),
  );

  /**
   * Is the brand face painting THE HEADLINE, and at load — not two seconds
   * later, and not on some other element.
   *
   * ⚠️ The fifth defect in this harness. The first version appended a fresh
   * <span> asking for "Playfair Display" AFTER the wait, and reported the
   * face "in use" on runs where every font response had been held back
   * 1500ms. Both halves were wrong: an element created later can pick up a
   * font that arrived later, and the question was never about a span. It is
   * about whether the h1 the browser chose as its largest paint was drawn in
   * Playfair or in Georgia.
   *
   * Taken by swapping a bogus family onto the h1 itself and comparing its own
   * width with its own width — same element, same text, same size.
   */
  const out = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    if (!h1) return { lcp: window.__lcp, lcpEl: window.__lcpEl, cls: window.__cls, headlineInBrandFace: null };
    const before = h1.getBoundingClientRect().width;
    const declared = h1.style.fontFamily;
    h1.style.fontFamily = 'ZzzNoSuchFamily, Georgia, serif';
    const bogus = h1.getBoundingClientRect().width;
    h1.style.fontFamily = declared;
    return {
      lcp: window.__lcp,
      lcpEl: window.__lcpEl,
      cls: window.__cls,
      headlineInBrandFace: Math.abs(before - bogus) > 1,
    };
  });

  // Now past the delay, so a late file has had its chance to reflow under
  // `swap`, and CLS is read again after that.
  await sleep(DELAY + 600);
  const clsAfter = await page.evaluate(() => window.__cls);

  await context.close();
  return { ...out, cls: clsAfter, fcp: firstContentfulPaint, fontStarts, faceCount };
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
console.log('\n── font-display and the largest paint ──────────────────────');
console.log(`  ${BASE}, 390px, every woff2 held back ${DELAY}ms, ${RUNS} runs per variant (median).`);
console.log('  One build; the stylesheet is rewritten in flight per variant.\n');

const rows = [];
try {
  for (const v of VARIANTS) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await measure(browser, v));
    const r = {
      name: v.name,
      lcp: median(runs.map((x) => x.lcp)),
      fcp: median(runs.map((x) => x.fcp ?? 0)),
      cls: median(runs.map((x) => x.cls)),
      lcpEl: runs[0].lcpEl,
      headlineInBrandFace: runs[0].headlineInBrandFace,
      fontStarts: runs[0].fontStarts,
      faceCount: runs[0].faceCount,
      startedBeforePaint: runs.filter(
        (x) => x.fontStarts.length > 0 && Math.min(...x.fontStarts) < (x.fcp ?? Infinity),
      ).length,
      all: runs.map((x) => Math.round(x.lcp)),
      allCls: runs.map((x) => x.cls.toFixed(4)),
      allBrand: runs.map((x) => x.headlineInBrandFace),
    };
    rows.push(r);
    console.log(
      `  ${v.name.padEnd(22)} FCP ${String(Math.round(r.fcp)).padStart(5)}ms  `
      + `LCP ${String(Math.round(r.lcp)).padStart(5)}ms  CLS ${r.cls.toFixed(4)}  `
      + `headline in brand face: ${r.headlineInBrandFace}`,
    );
    console.log(`  ${''.padEnd(22)} LCP element: ${r.lcpEl}`);
    console.log(`  ${''.padEnd(22)} all ${RUNS} LCP values: ${r.all.join(', ')}`);
    console.log(`  ${''.padEnd(22)} all ${RUNS} CLS values: ${r.allCls.join(', ')}`);
    console.log(`  ${''.padEnd(22)} headline in brand face, per run: ${r.allBrand.join(', ')}`);
    console.log(
      `  ${''.padEnd(22)} @font-face in the served CSS: ${r.faceCount.before} -> ${r.faceCount.after}`,
    );
    console.log(
      `  ${''.padEnd(22)} font requests: ${r.fontStarts.length}, first at `
      + `${r.fontStarts.length ? Math.round(Math.min(...r.fontStarts)) + 'ms' : 'n/a'}; `
      + `began before the paint in ${r.startedBeforePaint}/${RUNS} runs`,
    );
  }
} finally {
  await browser.close();
}

const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
const optional = byName['optional (as shipped)'];
const swap = byName['swap'];
const none = byName['no webfont at all'];

console.log('\n── what that says ─────────────────────────────────────────');
if (optional && swap) {
  const d = Math.round(optional.lcp - swap.lcp);
  console.log(`  optional vs swap:            LCP ${d >= 0 ? '+' : ''}${d}ms, `
    + `CLS ${optional.cls.toFixed(4)} vs ${swap.cls.toFixed(4)}`);
}
if (optional && none) {
  const d = Math.round(optional.lcp - none.lcp);
  console.log(`  optional vs no webfont:      LCP ${d >= 0 ? '+' : ''}${d}ms`);
}
console.log('\n  ⚠️  This box cannot adjudicate an LCP difference of this size: the');
console.log('     spread within a single variant is wider than the gap between');
console.log('     variants. What it DOES answer is ordering and structure — whether');
console.log('     the font requests begin before the headline paints, and whether a');
console.log('     variant is really the variant it claims to be.');
console.log('════════════════════════════════════════════════════════════\n');
