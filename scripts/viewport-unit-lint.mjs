#!/usr/bin/env node
/**
 * `vh` is not the height of the screen on a phone, and this codebase has now
 * shipped that mistake three times.
 *
 * On mobile Chrome `100vh` is the viewport with the browser's address bar
 * HIDDEN — taller than what the person can actually see while it is showing.
 * So:
 *
 *   · `max-height: calc(100vh - X)` on a scrolling panel is a cap BIGGER than
 *     the screen. The panel never overflows its own max-height, `overflow-y:
 *     auto` therefore has nothing to scroll, and whatever is at the bottom is
 *     unreachable. The top-nav drawer lost "Dashboard", "+ List a room" and
 *     "Log out" that way, with the third button sliced in half at the screen
 *     edge — reported from a phone, because nothing here could see it.
 *   · `min-height: 100vh` makes a block taller than the screen, which is how
 *     `.hero--splash` pushed the board below the fold before it moved to dvh.
 *
 * ⚠️ And it cannot be caught by driving a headless browser: Chromium in CI has
 * no address bar, so `100vh` and the visible height are the same number and
 * every viewport measures correctly. That is exactly why this is a SOURCE
 * check. It is not a substitute for looking at a phone; it is the only part
 * that can run at all.
 *
 * The rule: a viewport-height unit must be paired with a `dvh` declaration of
 * the same property, the `vh` line first as the fallback for browsers without
 * dvh support:
 *
 *     max-height: calc(100vh - 66px);     // fallback
 *     max-height: calc(100dvh - 66px);    // what a phone actually uses
 *
 * Exempt: anything inside a `min-width` media query of 901px or more. A
 * desktop browser has no dynamic chrome, so vh IS the visible height there,
 * and rewriting those would be churn that teaches the next reader nothing.
 *
 *   node scripts/viewport-unit-lint.mjs
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = 'frontend/src';

/** Properties where a viewport height decides what a person can see or reach. */
const PROPS = /(max-height|min-height|height)\s*:\s*([^;}]*\b\d*\.?\d*vh\b[^;}]*)/;

/**
 * Lines that may use vh alone, each with the reason.
 *
 * An entry is a file path and the selector it belongs to — not a line number,
 * which goes stale on the next edit and then silently exempts whatever moved
 * into its place.
 */
const ALLOWED = [
  {
    file: 'frontend/src/styles/_responsive.scss',
    match: '.filter-panel',
    why: 'inside @media (min-width: 901px) — desktop only, where there is no address bar to shrink the viewport',
  },
];

const files = execSync(
  `git ls-files '${SRC}/**/*.scss' '${SRC}/**/*.ts' '${SRC}/*.scss'`,
  { cwd: ROOT, encoding: 'utf8' },
).split('\n').filter(Boolean);

let checked = 0;
const findings = [];

for (const rel of files) {
  const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');

  // Track whether we are inside a desktop-only media query. Crude brace
  // counting rather than a CSS parser, and deliberately so: it has to read
  // both .scss and the styles block of a component .ts.
  let desktopDepth = 0;
  let depth = 0;

  lines.forEach((line, i) => {
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;

    const desktopMedia = /@media[^{]*min-width\s*:\s*(\d+)/.exec(line);
    if (desktopMedia && Number(desktopMedia[1]) >= 901 && opens > closes) {
      desktopDepth = depth + 1;
    }

    const hit = PROPS.exec(line);
    if (hit && !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*')) {
      checked++;
      const prop = hit[1];
      const inDesktop = desktopDepth > 0 && depth >= desktopDepth;

      // The dvh companion, on this line or the next two.
      //
      // \u26a0\ufe0f NOT `\\bdvh\\b`. A word boundary needs a non-word character
      // beside it, and in `100dvh` the digit and the letter are both word
      // characters — so the first version of this check could not match the
      // very pattern it exists to require, and reported the one line in the
      // codebase that was already correct. Found by running it.
      const window_ = lines.slice(i, i + 3).join('\n');
      const paired = new RegExp(`${prop}\\s*:\\s*[^;}]*dvh`).test(window_);

      const allowed = ALLOWED.find((a) => {
        if (a.file !== rel) return false;
        // The selector this declaration sits under, searched upwards.
        const above = lines.slice(Math.max(0, i - 12), i).join('\n');
        return above.includes(a.match);
      });

      /**
       * Which vh heights actually strand something.
       *
       * The first version flagged every vh height and found nine, most of
       * them harmless: `min-height: 50vh` on a centring block cannot hide
       * anything, and a lint that cries about six non-problems to reach two
       * real ones gets switched off. Two shapes do real damage:
       *
       *   \u00b7 a `max-height` in vh on a SCROLLING box. The cap is bigger than
       *     the screen, so the box never overflows it, `overflow-y: auto` has
       *     nothing to scroll, and the bottom of the content is unreachable.
       *     That is the nav drawer, and the walkthrough card every new account
       *     meets, and the report dialog's submit button.
       *   \u00b7 a `min-height` of a FULL viewport or more, which makes a block
       *     taller than the screen and pushes what follows below the fold.
       *     That is what `.hero--splash` did before it moved to dvh.
       */
      const nearby = lines.slice(Math.max(0, i - 6), i + 7).join('\n');
      const scrolls = /overflow(-y)?\s*:\s*(auto|scroll)/.test(nearby);
      const fullViewport = /\b(100|1[0-9][0-9])vh\b/.test(hit[2]);
      const strands = (prop === 'max-height' && scrolls) || (prop === 'min-height' && fullViewport);

      if (strands && !paired && !inDesktop && !allowed) {
        findings.push({ rel, line: i + 1, prop, text: line.trim().slice(0, 78) });
      }
    }

    depth += opens - closes;
    if (desktopDepth > 0 && depth < desktopDepth) desktopDepth = 0;
  });
}

console.log('\n── Viewport height units ───────────────────────────────────');
console.log(`  ${checked} vh-based height declaration(s) across ${files.length} file(s).`);

if (!findings.length) {
  console.log('  ✅ every one is paired with a dvh declaration, or is desktop-only.');
  console.log('════════════════════════════════════════════════════════════\n');
  process.exit(0);
}

for (const f of findings) {
  console.log(`  ❌ ${f.rel}:${f.line}`);
  console.log(`     ${f.text}`);
  console.log(`     ${f.prop} in vh with no dvh companion — on a phone this is`);
  console.log(`     bigger than the screen, and what sits past the edge cannot`);
  console.log(`     be scrolled to.`);
}
console.log(`\n  ${findings.length} unpaired vh height(s).`);
console.log('  Add the dvh line directly after the vh one, or allowlist it in');
console.log('  this file with the reason.');
console.log('════════════════════════════════════════════════════════════\n');
process.exit(1);
