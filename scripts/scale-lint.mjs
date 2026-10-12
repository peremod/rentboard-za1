#!/usr/bin/env node
/**
 * One radius scale, one elevation language, and scales that cannot quietly grow.
 *
 * ── Why this exists
 *
 * Audit §H3's third identity move: "Cream surfaces, ink structure, one radius.
 * --card on --cream, hairline --border, $r4 for controls and $r12 for
 * surfaces, and NOTHING else. Every 6px and 8px in a component block goes."
 *
 * Measured before: **28 distinct radius values for 174 uses.** The tokens
 * existed and were used — var(--r4) 40, var(--r8) 21, var(--r-full) 18 — and
 * beside them sat 8px fifteen times (which IS --r8), 6px thirteen times, 10px
 * ten times, 4px six times (which IS --r4), 12px three times (--r12), plus
 * 5px, 2px, 20px, 999px, 0.4rem and 0.6rem once each. Nobody chose that tail.
 *
 * Spacing is worse and is handled differently: **60 distinct values for 1073
 * uses.** The real rhythm is .5rem, 1rem, .75rem, 1.5rem, and around them sits
 * a second unspoken half-step scale — .6, .85, .9, .4, .3. Migrating 1073
 * declarations would be churn with real visual risk and no way to review it,
 * so spacing is RATCHETED, not migrated: the current values are the baseline,
 * and a new one off the scale fails. The drift stops; the existing tail stays
 * in sight and burns down when a screen is touched for another reason.
 *
 * ── Why --r8 survives, when §H3 said r4 and r12 and nothing else
 *
 * 21 existing uses is not a rounding error, and 8px is a real step between a
 * control and a panel. Taking it out would be a 21-site visual change to
 * satisfy the letter of a sentence in an audit I wrote myself. The scale is
 * --r4 (controls), --r8 (small surfaces), --r12 (panels), --r20, --r-full
 * (pills), plus 50% for circles and 0 for deliberately square.
 *
 * ⚠️ What this does NOT check: whether the right step was chosen. A pill at
 * --r4 passes. That is a design review, not a lint.
 *
 * ── Shadows — Phase K, and three kinds of thing wearing one property
 *
 * 18 definitions for 32 uses, with --shadow-sm/md/lg/xl already defined and
 * used 8 times. The other 24 were `none` ×11 and thirteen one-offs, and the
 * one-offs were not all elevation:
 *
 *   · six focus and selection RINGS — a spread with no blur — at 1px and 3px
 *     in four tints. A ring whose thickness depends on which control you
 *     tabbed into is the kind of inconsistency nobody reports and everybody
 *     feels, and WCAG 2.4.11 wants it findable. Now four --ring-* tokens, all
 *     3px, all one alpha.
 *   · four overlay shadows for modals, all BLACK where every token is
 *     ink-tinted, two of them the same value written with and without spaces
 *     inside the rgba(). All --shadow-xl now.
 *   · a lift on the primary button, twice, in two spellings, tinted with
 *     rgba(192, 78, 40, …) — #C04E28, the terracotta this project RETIRED for
 *     measuring 4.50:1 on --cream. Now --shadow-lift, retinted.
 *
 * Zero tolerance, like radius: that migration is done too.
 *
 * ── Font size — ratcheted
 *
 * 49 values for 438 uses, with the top ten inside a 0.28rem band: .78, .8,
 * .82, .85 and .88rem all exist and are each used 25-55 times. A nine-step
 * scale would cover it. Migrating 438 declarations is churn with real visual
 * risk, so this is a ratchet, like spacing.
 *
 *   node scripts/scale-lint.mjs
 *   node scripts/scale-lint.mjs --update-baseline
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cssSource, lineAt } from './lib/css-values.mjs';

const APP = 'frontend/src/app';
const STYLES = 'frontend/src/styles';
const BASELINE = 'scripts/scale-baseline.json';

/** Everything a radius may legitimately be. */
const RADIUS_OK = [
  /^var\(--r(4|8|12|20|-full)\)$/,
  /^\$r(4|8|12|20)$/,          // the SCSS layer, in stylesheets
  /^\$radius(-lg)?$/,
  /^50%$/,                      // a circle
  /^0$/,                        // deliberately square
];
/**
 * A one-side radius: every part must itself be on the scale. Written out
 * rather than folded into the list above so the parts are actually checked —
 * `2px 2px 0 0` passed a laxer version of this rule for the life of the file.
 */
const isCompoundOk = (v) =>
  /\s/.test(v) && v.split(/\s+/).every((part) => RADIUS_OK.some((re) => re.test(part)));

const SPACING_PROPS = /^(margin|padding|gap|row-gap|column-gap)(-(top|right|bottom|left|block|inline|start|end))?$/;

/**
 * Everything a shadow may legitimately be: a token, `none`, or a COMPOSITION
 * of tokens (a ring plus an elevation is one honest value, and `.app-card`
 * uses exactly that).
 */
const SHADOW_TOKEN = /^(var\(--(shadow-(sm|md|lg|xl|lift))\)|var\(--ring-(terra|danger|sage|gold)\)|\$shadow-(sm|md|lg|xl))$/;
const isShadowOk = (v) =>
  v === 'none' || v === '0' || v.split(',').map((x) => x.trim()).every((part) => SHADOW_TOKEN.test(part));

/** The scale font sizes sit on. Anything else is the tail. */
const FONT_SIZE_OK = new Set([
  'inherit', '1em', '100%',
  '.7rem', '.75rem', '.8rem', '.85rem', '.9rem', '1rem',
  '1.15rem', '1.25rem', '1.5rem', '1.75rem', '2rem', '2.5rem',
]);

/** The rhythm the app actually uses, by count. Anything else is the tail. */
const SPACING_OK = new Set([
  '0', '0rem', '0px', 'auto',
  '.25rem', '.5rem', '.75rem',
  '1rem', '1.25rem', '1.5rem', '2rem', '2.5rem', '3rem',
  '1px', '2px', '3px', '4px', '8px', '12px', '16px', '24px',
  '100%', '50%',
]);

const walk = (dir) =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

let fail = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };

const radii = [];
const shadows = [];
const spacing = {};
const fontSizes = {};
let declarations = 0;

for (const f of [...walk(APP), ...walk(STYLES)]) {
  if (!/\.(ts|scss)$/.test(f) || f.endsWith('.spec.ts')) continue;
  const src = readFileSync(f, 'utf8');
  const s = cssSource(f, src);
  if (!s) continue;
  for (const m of s.css.matchAll(/(\$?[-\w]+)\s*:\s*([^;{}]+)[;}]/g)) {
    const prop = m[1];
    const val = m[2];
    const vs = m.index + m[0].indexOf(val, prop.length);
    if (!s.ranges.some(([a, b]) => vs >= a && vs < b)) continue;
    if (prop.startsWith('--') || prop.startsWith('$')) continue;
    const t = val.trim();
    declarations++;

    if (prop === 'border-radius' || prop === 'radius') {
      if (RADIUS_OK.some((re) => re.test(t)) || isCompoundOk(t)) continue;
      radii.push({ file: f.replace(`${APP}/`, '').replace(`${STYLES}/`, ''), line: lineAt(src, vs), value: t });
      continue;
    }

    if (prop === 'box-shadow' || prop === 'text-shadow') {
      if (!isShadowOk(t)) {
        shadows.push({ file: f.replace(`${APP}/`, '').replace(`${STYLES}/`, ''), line: lineAt(src, vs), value: t.slice(0, 70) });
      }
      continue;
    }

    if (prop === 'font-size') {
      /**
       * ⚠️ `!important` stripped and `clamp()` allowed, both found by the
       * lint's own first run. `.82rem !important` was being counted as a
       * distinct value from `.82rem`, and four `clamp(1.9rem, 8vw, 2.6rem)`
       * hero sizes were being reported as off-scale when a fluid size is a
       * deliberate choice no fixed scale can express.
       */
      const n = t.replace(/\s*!important$/, '').replace(/^0+(?=\.)/, '');
      if (
        !FONT_SIZE_OK.has(n)
        && !n.startsWith('var(') && !n.startsWith('$')
        && !n.startsWith('calc(') && !n.startsWith('clamp(')
      ) {
        fontSizes[n] = (fontSizes[n] ?? 0) + 1;
      }
      continue;
    }

    if (SPACING_PROPS.test(prop)) {
      for (const raw of t.split(/\s+/)) {
        /**
         * ⚠️ Normalised, because `.6rem` and `0.6rem` are the same value and
         * the first version of this counted them as two: `.6rem` ×87 beside
         * `0.6rem` ×14, which made the tail look longer than it is and would
         * have let a file switch spelling to get under a baseline. Two
         * spellings of one value is its own small finding — 11 of the 49
         * entries were a duplicate spelling of another.
         */
        const n = raw.replace(/^0+(?=\.)/, '');
        if (!n || SPACING_OK.has(n) || n.startsWith('var(') || n.startsWith('$') || n.startsWith('calc(')) continue;
        spacing[n] = (spacing[n] ?? 0) + 1;
      }
    }
  }
}

console.log('\n── Radius, shadows, spacing and font size ──────────────────');
if (declarations === 0) {
  console.error('No declarations read at all. Refusing to pass vacuously.');
  process.exit(2);
}
console.log(`  ${declarations} declaration(s) read across the app and the stylesheets.`);

// ── Radius: zero tolerance, because the migration is done ────────────────
if (radii.length === 0) {
  ok('every radius is on the scale: --r4 / --r8 / --r12 / --r20 / --r-full, 50% or 0');
} else {
  bad(`${radii.length} radius value(s) off the scale:`);
  for (const r of radii) console.log(`        ${r.file}:${r.line}  ${r.value}`);
  console.log('        --r4 controls, --r8 small surfaces, --r12 panels, --r-full pills.');
}

// ── Shadows: zero tolerance, because that migration is done too ─────────
if (shadows.length === 0) {
  ok('every shadow is a token, a composition of tokens, or none');
} else {
  bad(`${shadows.length} shadow value(s) off the scale:`);
  for (const r of shadows) console.log(`        ${r.file}:${r.line}  ${r.value}`);
  console.log('        --shadow-sm/md/lg/xl for elevation, --shadow-lift for the');
  console.log('        primary button, --ring-terra/danger/sage/gold for a focus ring.');
}

// ── Spacing and font size: ratchets, because 1073 and 438 uses cannot go ──
const parsed = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
const baseline = parsed.spacing ?? {};
const fontBaseline = parsed.fontSize ?? {};

if (process.argv.includes('--update-baseline')) {
  /**
   * ⚠️ Per DIMENSION, and this was wrong on the first attempt in two ways.
   *
   * The ratchet refused a first write of the font-size baseline because every
   * value was above an empty map — but a dimension with no key in the file has
   * nothing to ratchet against, exactly as `token-lint` allows its own first
   * write. And the refusal printed `baseline[v]` for font sizes too, so it
   * reported "`.6rem` 101 → 6" by comparing a font size against the SPACING
   * baseline: a message that invents a regression out of two unrelated
   * numbers is worse than no message.
   */
  const worse = [];
  for (const [label, found, base, present] of [
    ['spacing', spacing, baseline, 'spacing' in parsed],
    ['font size', fontSizes, fontBaseline, 'fontSize' in parsed],
  ]) {
    if (!present) continue;
    for (const [v, n] of Object.entries(found)) {
      if (n > (base[v] ?? 0)) worse.push(`${label}  ${v}  ${base[v] ?? 0} → ${n}`);
    }
  }
  if (worse.length) {
    console.error('\n  ❌ Refusing to write a baseline WORSE than the one on disk:');
    for (const w of worse) console.error(`     ${w}`);
    process.exit(1);
  }
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        note:
          'Spacing values outside the scale, counted. Debt, not permission — the rhythm is ' +
          '.25/.5/.75/1/1.25/1.5/2/2.5/3rem. A value not here, or a count above it, fails ' +
          'scripts/scale-lint.mjs. Radius has NO baseline: that migration is done and the ' +
          'tolerance is zero.',
        spacing: Object.fromEntries(Object.entries(spacing).sort((a, b) => b[1] - a[1])),
        fontSize: Object.fromEntries(Object.entries(fontSizes).sort((a, b) => b[1] - a[1])),
      },
      null,
      2,
    ) + '\n',
  );
  const t = Object.values(spacing).reduce((a, b) => a + b, 0);
  console.log(`\n  Baseline rewritten: ${Object.keys(spacing).length} off-scale spacing value(s), ${t} use(s).\n`);
  process.exit(0);
}

for (const [label, found, base, rhythm] of [
  ['spacing', spacing, baseline, 'The rhythm is .25 / .5 / .75 / 1 / 1.25 / 1.5 / 2 / 2.5 / 3rem.'],
  ['font size', fontSizes, fontBaseline, 'The scale is .7 / .75 / .8 / .85 / .9 / 1 / 1.15 / 1.25 / 1.5 / 1.75 / 2 / 2.5rem.'],
]) {
  const over = Object.entries(found).filter(([v, n]) => n > (base[v] ?? 0));
  const carried = Object.entries(found).filter(([v, n]) => n <= (base[v] ?? 0));
  if (over.length === 0) {
    const t = carried.reduce((a, [, n]) => a + n, 0);
    ok(`no NEW off-scale ${label} (${carried.length} value(s), ${t} use(s), carried in the baseline)`);
  } else {
    bad(`${over.length} off-scale ${label} value(s) above the baseline:`);
    for (const [v, n] of over.sort((a, b) => b[1] - a[1])) {
      console.log(`        ${v}  ×${n}  (baseline allows ${base[v] ?? 0})`);
    }
    console.log(`        ${rhythm}`);
  }
}

console.log('════════════════════════════════════════════════════════════');
if (fail) { console.log(`  ${fail} problem(s).\n`); process.exit(1); }
console.log('  ✅ one radius scale, one elevation language, and nothing drifting.\n');
