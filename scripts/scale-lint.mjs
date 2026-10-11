#!/usr/bin/env node
/**
 * One radius scale, and a spacing scale that cannot quietly grow.
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
const spacing = {};
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

console.log('\n── Radius and spacing scales ───────────────────────────────');
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

// ── Spacing: a ratchet, because 1073 uses cannot go clean in one step ────
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).spacing ?? {} : {};

if (process.argv.includes('--update-baseline')) {
  const worse = Object.entries(spacing).filter(([v, n]) => n > (baseline[v] ?? 0));
  if (worse.length && existsSync(BASELINE)) {
    console.error('\n  ❌ Refusing to write a baseline WORSE than the one on disk:');
    for (const [v, n] of worse) console.error(`     ${v}  ${baseline[v] ?? 0} → ${n}`);
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
      },
      null,
      2,
    ) + '\n',
  );
  const t = Object.values(spacing).reduce((a, b) => a + b, 0);
  console.log(`\n  Baseline rewritten: ${Object.keys(spacing).length} off-scale spacing value(s), ${t} use(s).\n`);
  process.exit(0);
}

const over = Object.entries(spacing).filter(([v, n]) => n > (baseline[v] ?? 0));
const carried = Object.entries(spacing).filter(([v, n]) => n <= (baseline[v] ?? 0));
if (over.length === 0) {
  const t = carried.reduce((a, [, n]) => a + n, 0);
  ok(`no NEW off-scale spacing (${carried.length} value(s), ${t} use(s), carried in the baseline)`);
} else {
  bad(`${over.length} off-scale spacing value(s) above the baseline:`);
  for (const [v, n] of over.sort((a, b) => b[1] - a[1])) {
    console.log(`        ${v}  ×${n}  (baseline allows ${baseline[v] ?? 0})`);
  }
  console.log('        The rhythm is .25 / .5 / .75 / 1 / 1.25 / 1.5 / 2 / 2.5 / 3rem.');
}

console.log('════════════════════════════════════════════════════════════');
if (fail) { console.log(`  ${fail} problem(s).\n`); process.exit(1); }
console.log('  ✅ one radius scale, and spacing is not drifting.\n');
