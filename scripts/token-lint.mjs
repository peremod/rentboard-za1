#!/usr/bin/env node
/**
 * A literal colour that duplicates a token the design system already defines
 * fails the build.
 *
 * ── Why this exists
 *
 * `--border` is #E0D5C4. The styling of this app also writes #DDD5C8 nineteen
 * times across nine files. The two are 2.40 apart in CIE Lab, which means
 * nobody has ever seen the difference — not on a cheap Android in daylight,
 * not side by side. They are the same colour, stored twice, and the second
 * copy does not move when the first one does.
 *
 * That is not hypothetical here. `--terra` has been changed twice for contrast
 * (once because #C04E28 measured 4.50:1 on cream and subpixel rendering tipped
 * it under), `--gold-text` twice, `--slate` once. Every one of those edits
 * fixed the token and left behind whichever literals had been written as a
 * copy of it. There is no way to find them by reading a diff, and no build
 * error: a hex code is always valid CSS.
 *
 * `design-handoff/tools/tokens.mjs` has been able to SEE this for a while — it
 * is where the ΔE clustering comes from. But a report nobody runs is not a
 * control. This is the same claim, as a gate.
 *
 * ── What it checks, exactly
 *
 * Every declaration value in `frontend/src/styles/*.scss` and in every
 * component's inline `styles:` block (half the styling in this app, which a
 * stylesheet-only audit never sees). Each hex literal and each fully-opaque
 * `rgb()` is compared against every `--token` the stylesheets define. Within
 * ΔE 3 of one, it is a bypass and is named with the token to use instead.
 *
 * ── What it does NOT check
 *
 * · Translucent `rgba()`/`hsla()`. `rgba(28,22,14,.07)` cannot be replaced by
 *   `var(--ink)` — it is a different value, not a copy of one. The shadow
 *   tokens are the answer there and they are a separate job.
 * · A literal far from every token. #D63B3B is used ten times across nine
 *   files and is nobody's token; that is a MISSING token, which this cannot
 *   tell apart from a deliberate one-off. `tokens.mjs --md` lists it.
 * · Two tokens that are near-duplicates of each other (`--card` is 3.49 from
 *   `--cream`). That is a design decision, not a bypass. Printed as info.
 * · Whether the rule is any good. `css-coverage-audit.mjs` finds classes with
 *   no rule at all; this one finds rules written in the wrong currency.
 *
 * ── The second assertion: every var(--x) must name something
 *
 * Migrating 57 literals to `var(--token)` by hand is 57 chances to type
 * `var(--bordre)`. An unresolved custom property is not a CSS error — the
 * declaration is simply dropped, so `border: 1px solid var(--bordre)` renders
 * a BLACK border (the initial value) and `color: var(--whte)` inherits
 * whatever the parent had, which on a terracotta button is white on white at
 * 1.00:1. That exact pairing has already reached a person's phone here once.
 *
 * Nothing else in this repo can see it. `ng build` succeeds — a hex code and
 * an unknown custom property are both valid CSS. `tsc` never reads the styles.
 * `css-coverage-audit` checks that a CLASS has a rule, not that the rule's
 * values resolve. So the gate that replaced the literals also has to assert
 * that what replaced them exists. A `var(--x, fallback)` is fine either way:
 * the fallback is the answer.
 *
 *   node scripts/token-lint.mjs
 *   node scripts/token-lint.mjs --update-baseline   # see the warning below
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  stripComments,
  cssSource,
  hex2rgb,
  lab,
  deltaE,
  SAME_COLOUR_DELTA_E,
  lineAt,
} from './lib/css-values.mjs';

const STYLES = 'frontend/src/styles';
const APP = 'frontend/src/app';

/**
 * ⚠️ A baseline rather than an allowlist, and the difference is the point —
 * the same reasoning as `scripts/css-coverage-baseline.json`.
 *
 * Switched on, this found 314 literal colour uses, 71 of them in the two
 * largest clusters alone. Writing 150 exemptions to get a green tick makes the
 * list the place defects go to be forgotten. So the known ones live in a file,
 * keyed by FILE AND VALUE AND COUNT, and anything above that fails: a new file
 * reaching for #FFF fails, and so does a twenty-second #DDD5C8 in a file that
 * already had nineteen. The debt stays visible and burns down by deleting
 * lines, which is a one-way ratchet.
 *
 * `--update-baseline` is for when a literal is legitimately REMOVED, not for
 * making a failure go away. It only ever ratchets down: a run that would raise
 * a count or add a file refuses to write.
 */
const BASELINE = 'scripts/token-baseline.json';

/**
 * `_spec.scss` is a verbatim port of the visual preview and its own header
 * forbids hand-editing it, so its literals cannot be burned down from here —
 * the preview has to change first. It is NOT exempted: it sits in the baseline
 * with everything else, so a re-sync that introduces a NEW off-token colour
 * still fails. That failure is the signal (the spec grew a colour the token
 * set does not have), not noise.
 */

/**
 * Deliberately literal, keyed `file:line`, each with a reason.
 *
 * ⚠️ Two entries, and they are the only two. An allowlist without reasons is
 * where defects go to be forgotten — which is why the other 61 live in a
 * ratcheting baseline instead, and why this map must never grow to hold
 * "I did not get round to it".
 */
const ALLOWED = new Map([
  [
    'frontend/src/app/features/templates/template-document.ts:244',
    'print stylesheet: paper is paper, not a themed surface — a token could be redefined, a sheet of A4 cannot',
  ],
  [
    'frontend/src/app/features/templates/template-document.ts:246',
    'same print block: the signature box must be white on paper whatever the screen theme is',
  ],
]);

const walk = (dir) =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

// ── The tokens: every --x the stylesheets define ──────────────────────────
// `tokens` is the colour ones (what a literal can be compared against);
// `defined` is ALL of them, radii and fonts included, because the second
// assertion is about a name resolving, not about what kind of value it holds.
const tokens = new Map();
const defined = new Set();
for (const f of walk(STYLES).filter((p) => p.endsWith('.scss'))) {
  const css = stripComments(readFileSync(f, 'utf8'));
  for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\b/g)) {
    const rgb = hex2rgb(m[2]);
    if (rgb) tokens.set(m[1], { hex: m[2].toUpperCase(), lab: lab(rgb) });
  }
}
if (tokens.size === 0) {
  // A gate that finds nothing because it loaded nothing reads as a pass. This
  // repo has shipped that exact shape more than once.
  console.error(`No --token definitions found under ${STYLES}. Refusing to pass vacuously.`);
  process.exit(2);
}

const nearestToken = (hex) => {
  const rgb = hex2rgb(hex);
  if (!rgb) return null;
  const L = lab(rgb);
  let best = null;
  for (const [name, t] of tokens) {
    const d = deltaE(L, t.lab);
    if (!best || d < best.delta) best = { name, hex: t.hex, delta: d };
  }
  return best;
};

// ── The sources: stylesheets, plus every inline styles: block ────────────
const sources = [];
for (const f of [...walk(STYLES), ...walk(APP)]) {
  if (!/\.(scss|ts)$/.test(f) || f.endsWith('.spec.ts')) continue;
  const src = readFileSync(f, 'utf8');
  const s = cssSource(f, src);
  if (s) sources.push({ file: f, src, css: s.css, ranges: s.ranges });
}

/** Literal colours in a declaration value, with the line they are written on. */
function bypasses({ file, src, css, ranges }) {
  const found = [];
  const inRange = (i) => ranges.some(([a, b]) => i >= a && i < b);

  for (const m of css.matchAll(/(\$?[-\w]+)\s*:\s*([^;{}]+)[;}]/g)) {
    const prop = m[1];
    const val = m[2];
    const valueStart = m.index + m[0].indexOf(val, prop.length);
    if (!inRange(valueStart)) continue;
    // A definition is where a literal BELONGS: `--white:#FFFFFF` and
    // `$color-white: #FFFFFF` are the token, not a bypass of it.
    if (prop.startsWith('--') || prop.startsWith('$')) continue;

    const hits = [
      ...val.matchAll(/#[0-9a-fA-F]{3,6}\b/g),
      // Opaque rgb() only. rgba(…,.07) is a different value, not a copy.
      ...val.matchAll(/\brgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*\)/g),
    ];
    for (const h of hits) {
      const hex = h[0].startsWith('#')
        ? h[0].toUpperCase()
        : '#' + [h[1], h[2], h[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('').toUpperCase();
      const near = nearestToken(hex);
      if (!near || near.delta >= SAME_COLOUR_DELTA_E) continue;
      const line = lineAt(src, valueStart + h.index);
      if (ALLOWED.has(`${file}:${line}`)) continue;
      found.push({
        file,
        line,
        // An opaque rgb() keeps its own spelling; only hex is normalised, so
        // the baseline key reads as what is actually written in the file.
        literal: h[0].startsWith('#') ? h[0].toUpperCase() : h[0].replace(/\s+/g, ''),
        prop,
        token: near.name,
        tokenHex: near.hex,
        delta: near.delta,
      });
    }
  }
  return found;
}

/**
 * `var(--x)` with no fallback, where `--x` is defined nowhere.
 *
 * A component may also define its own custom properties locally, so the
 * component's own `styles:` block counts as a definition site for itself.
 */
function danglingVars({ file, src, css, ranges }) {
  const local = new Set();
  for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) {
    if (ranges.some(([a, b]) => m.index >= a && m.index < b)) local.add(m[1]);
  }
  const out = [];
  for (const m of css.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
    if (!ranges.some(([a, b]) => m.index >= a && m.index < b)) continue;
    if (m[2] === ',') continue; // has a fallback: resolves either way
    if (defined.has(m[1]) || local.has(m[1])) continue;
    out.push({ file, line: lineAt(src, m.index), name: m[1] });
  }
  return out;
}

const dangling = sources.flatMap(danglingVars);
const all = sources.flatMap(bypasses);

// ── Counted per file and value, which is the ratchet's granularity ───────
const counts = {};
for (const b of all) {
  counts[b.file] ??= {};
  counts[b.file][b.literal] = (counts[b.file][b.literal] ?? 0) + 1;
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).files ?? {} : {};

console.log('\n═══ Token gate — a literal colour that duplicates a token ═══');
console.log(`  ${tokens.size} colour tokens defined; ${sources.length} styling sources scanned.`);
console.log(`  ${ALLOWED.size} deliberately literal (allowlisted with a reason).`);
console.log(`  ${defined.size} custom properties defined in total.`);
console.log(`  ${all.length} literal use(s) within ΔE ${SAME_COLOUR_DELTA_E} of a token.`);

const over = [];
for (const [file, byValue] of Object.entries(counts)) {
  for (const [literal, n] of Object.entries(byValue)) {
    const allowed = baseline[file]?.[literal] ?? 0;
    if (n > allowed) over.push({ file, literal, n, allowed });
  }
}

if (process.argv.includes('--update-baseline')) {
  // The first write has nothing to ratchet against: every line is new by
  // definition. After that, only downwards.
  if (over.length && existsSync(BASELINE)) {
    console.error('\n  ❌ Refusing to write a baseline that is WORSE than the one on disk:');
    for (const o of over) console.error(`     ${o.file}  ${o.literal}  ${o.allowed} → ${o.n}`);
    console.error('\n     --update-baseline only ratchets down. Fix the new literal instead.\n');
    process.exit(1);
  }
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        note:
          'Literal colours within ΔE 3 of a token that already exists, counted per file. ' +
          'Debt, not permission — delete lines as they are fixed. A literal NOT in here, ' +
          'or one count higher than here, fails the gate. --update-baseline only ratchets down.',
        files: Object.fromEntries(
          Object.entries(counts)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([f, v]) => [f, Object.fromEntries(Object.entries(v).sort())]),
        ),
      },
      null,
      2,
    ) + '\n',
  );
  const total = Object.values(counts).flatMap((v) => Object.values(v)).reduce((a, b) => a + b, 0);
  console.log(`\n  Baseline rewritten: ${total} use(s) across ${Object.keys(counts).length} file(s).\n`);
  process.exit(0);
}

const carried = all.length - over.reduce((a, o) => a + (o.n - o.allowed), 0);
if (carried > 0) {
  console.log(`  ${carried} carried in the baseline — each one a token's value stored twice.`);
}

if (dangling.length) {
  console.log(`\n  ❌ ${dangling.length} var(--x) reference(s) name a token that is defined nowhere:\n`);
  for (const d of dangling) console.log(`     ${d.file}:${d.line}  var(${d.name})`);
  console.log('\n     An unresolved custom property is not a CSS error: the declaration is');
  console.log('     dropped. A border becomes black, a colour inherits — which on a');
  console.log('     terracotta button is white on white at 1.00:1.\n');
}

if (over.length === 0 && dangling.length === 0) {
  console.log('\n  ✅ No NEW literal duplicates a token, and every var(--x) resolves.\n');
  process.exit(0);
}
if (over.length === 0) process.exit(1);

console.log(`\n  ❌ ${over.length} literal colour(s) duplicate a token that already exists:\n`);
const byKey = new Map(over.map((o) => [`${o.file}\u0000${o.literal}`, o]));
for (const o of [...over].sort((a, b) => a.file.localeCompare(b.file))) {
  const lines = all
    .filter((b) => b.file === o.file && b.literal === o.literal)
    .map((b) => `${b.line} (${b.prop})`);
  const ex = all.find((b) => b.file === o.file && b.literal === o.literal);
  console.log(`     ${o.file}`);
  console.log(
    `        ${o.literal} × ${o.n}${o.allowed ? ` (baseline allows ${o.allowed})` : ''}` +
      `  →  var(${ex.token})  ${ex.tokenHex}, ΔE ${ex.delta.toFixed(2)}`,
  );
  console.log(`        line ${lines.join(', line ')}`);
}
console.log('\n     Write var(--token). ΔE under 3 means nobody can see the difference,');
console.log('     so the only thing the literal adds is a copy that will not move when');
console.log('     the token does — which is how --terra was fixed twice and six');
console.log('     hand-written copies of it were not.\n');
void byKey;
process.exit(1);
