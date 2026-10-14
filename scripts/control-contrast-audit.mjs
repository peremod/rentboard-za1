/**
 * Every rule that repaints a control must repaint its text — docs/OUTSTANDING.md §41.
 *
 * ── The defect
 *
 * `styles.scss` declares `:where(button)` with `color: var(--white)` on a
 * terracotta background. `:where()` has ZERO specificity, so any rule that
 * names a button wins — and a rule that sets only `background` wins the
 * background while the white `color` stays. White text on a white button,
 * measured at 1.00:1, present and invisible.
 *
 * It has reached a person's phone twice:
 *
 *   · Phase 7c, inbox rows at 1.06:1 on cream.
 *   · 14 October, `.applicant-card__actions button` in applicants.ts — the
 *     Shortlist and Invite-to-view controls rendered as blank boxes, the emoji
 *     visible because emoji carry their own colour and the words not.
 *
 * The second one is the reason this file exists rather than being described.
 * §41 recorded the gate as wanted and not written, and `screen-hint.ts` had
 * claimed in a comment that it already existed — so for several releases the
 * only thing between that pairing and the next invisible button was somebody
 * reading a sentence.
 *
 * ── What it asserts
 *
 * In every component's `styles:` block: a rule whose selector names a button
 * or `.btn`, and whose body sets `background` or `background-color`, must also
 * set `color`. That is the whole rule. It is deliberately narrow — the
 * ambition in §41 was "any interactive selector", and the hard part was
 * naming those without a false-positive rate that drives people to add
 * exemptions, which is how an allowlist becomes the place defects go to be
 * forgotten. Buttons are the surface this has actually failed on, twice.
 *
 * Transparent, `none` and `inherit` backgrounds are exempt: those do not
 * repaint anything, so the inherited colour is still the right one.
 *
 * ⚠️ Comments are blanked before parsing. `css-coverage-audit` once read class
 * names out of a component's own documentation and reported four findings that
 * were prose; `token-lint` rewrote a hex inside a comment. A checker that
 * reads commentary is reading the wrong file.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { componentCssRanges, blankCssComments } from './lib/css-values.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'frontend/src/app');

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.ts')) files.push(p);
  }
})(APP);

const NAMES_A_CONTROL = /button|\.btn\b/i;
const SETS_BACKGROUND = /(^|[;{\s])background(-color)?\s*:/;
const SETS_COLOR = /(^|[;{\s])color\s*:/;
const REPAINTS_NOTHING = /background(-color)?\s*:\s*(none|transparent|inherit|unset|revert)\b/;

let scanned = 0;
const findings = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const [start, end] of componentCssRanges(src)) {
    const css = blankCssComments(src.slice(start, end));
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim().replace(/\s+/g, ' ');
      const body = rule[2];
      if (!NAMES_A_CONTROL.test(selector)) continue;
      if (!SETS_BACKGROUND.test(body)) continue;
      scanned++;
      if (REPAINTS_NOTHING.test(body)) continue;
      if (SETS_COLOR.test(body)) continue;
      findings.push({
        file: relative(ROOT, file),
        selector,
        line: src.slice(0, start + rule.index).split('\n').length,
      });
    }
  }
}

console.log('\n── Controls: a repainted background needs a repainted foreground ──\n');

// ⚠️ The vacuous pass this repository keeps finding: a negative assertion over
// nothing passes. If no rule anywhere repaints a control, this check proved
// nothing and must say so rather than printing a tick.
if (scanned === 0) {
  console.log('  ❌ no rule in any component repaints a control background.');
  console.log('     Nothing was checked, so this is not a pass. The selector');
  console.log('     match or the styles-block parser has broken.');
  process.exit(1);
}

if (findings.length) {
  for (const f of findings) {
    console.log(`  ✗ ${f.file}:${f.line}`);
    console.log(`      ${f.selector}`);
    console.log('      sets a background and no color, so it keeps color:var(--white)');
    console.log('      from :where(button) — white text on whatever it just painted.\n');
  }
  console.log(`════════════════════════════════════════════════════════════`);
  console.log(`  ${findings.length} control(s) repainted without a foreground, of ${scanned} checked.`);
  process.exit(1);
}

console.log(`  ✅ ${scanned} rule(s) repaint a control background, and every one sets color too.`);
console.log('════════════════════════════════════════════════════════════');
