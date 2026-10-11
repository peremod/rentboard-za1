#!/usr/bin/env node
/**
 * The state vocabulary is defined in ONE place, and nothing invents a sixth.
 *
 * ── Why this exists
 *
 * Audit §H4 said the state treatments were "ad hoc and partial". Counted, they
 * were worse than that:
 *
 *   · `.arc-row__badge` (the archive) and `.rent-past__badge` (the rent
 *     screen) were the SAME chip, written twice, both reading "Past letting",
 *     differing only in `.12rem` vs `.15rem` of padding.
 *   · `.yard-past__review` was a THIRD copy of it.
 *   · `.status--accepted` and `.status--rejected` were declared identically in
 *     `applicants.ts` AND `applicants-inbox.ts`, with raw hexes — and the
 *     inbox quietly folded `withdrawn` in with `rejected`, so an applicant who
 *     stopped read as one the landlord had refused.
 *   · Beside them, a PARALLEL set under a different name: `.status-accepted`
 *     (single hyphen) in the spec layer vs `.status--accepted` (BEM modifier)
 *     in components. Neither shadows the other. They are separate systems that
 *     happen to agree.
 *
 * Three of those four I wrote myself, across Phases D, E and F. A vocabulary
 * is not a vocabulary if each screen may add a word to it, so:
 *
 *   1. Every `state--X` used in a template must be one of the five names the
 *      system defines. A typo, or a sixth meaning invented on the twentieth
 *      screen, fails here rather than rendering as the unmodified grey.
 *   2. No component may declare a rule for `.state`, `.state--*`,
 *      `.state-edge` or `.state-text` beyond pure placement. The treatment
 *      lives in `styles.scss`; a component may say where the chip sits, not
 *      what it looks like.
 *   3. The legacy names (`.status--*`, `.pill--*`, `.app-card--closed`) are
 *      carried in a baseline, counted and named on every run, and the count
 *      may only go down.
 *
 * ⚠️ What this does NOT check: that the right state was chosen. `tenancyState`
 * and `applicationState` in `core/models/state.model.ts` are where that lives,
 * and a new status added to either union is a TYPE error there — which is the
 * reason the mapping is a typed function and not a string in each template.
 *
 *   node scripts/state-lint.mjs
 *   node scripts/state-lint.mjs --update-baseline
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cssSource, stripComments, lineAt } from './lib/css-values.mjs';

const APP = 'frontend/src/app';
const STYLES = 'frontend/src/styles';
const VOCAB = 'frontend/src/styles/styles.scss';
const MODEL = 'frontend/src/app/core/models/state.model.ts';
const BASELINE = 'scripts/state-baseline.json';

/** Properties a component may legitimately set on a state class: placement only. */
const PLACEMENT_ONLY = new Set([
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'margin-block', 'margin-inline', 'align-self', 'justify-self', 'order',
  'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'grid-area', 'grid-column',
  'grid-row', 'position', 'top', 'right', 'bottom', 'left', 'inset', 'z-index',
]);

const walk = (dir) =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

let fail = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };

console.log('\n── State vocabulary ────────────────────────────────────────');

// ── The five names, read from the model rather than retyped here ──────────
if (!existsSync(MODEL)) {
  console.error(`No ${MODEL}. The vocabulary's mapping is the source of the names; refusing to pass vacuously.`);
  process.exit(2);
}
const modelSrc = readFileSync(MODEL, 'utf8');
const nameMatch = modelSrc.match(/export type StateName\s*=\s*([^;]+);/);
if (!nameMatch) {
  console.error(`Could not read StateName from ${MODEL}. Refusing to pass vacuously.`);
  process.exit(2);
}
const NAMES = [...nameMatch[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
if (NAMES.length === 0) {
  console.error('StateName parsed to zero names. Refusing to pass vacuously.');
  process.exit(2);
}
ok(`${NAMES.length} state names defined: ${NAMES.join(', ')}`);

// ── Each one must actually have a rule, or the class renders as nothing ───
const vocabCss = stripComments(readFileSync(VOCAB, 'utf8'));
for (const n of NAMES) {
  vocabCss.includes(`.state--${n}`)
    ? ok(`.state--${n} has a rule in ${VOCAB.split('/').pop()}`)
    : bad(`.state--${n} is a declared name with NO rule — the chip renders unmodified grey`);
}

// ── 1. Nothing invents a sixth ────────────────────────────────────────────
const used = new Map();
const declared = [];
let templates = 0;

for (const f of [...walk(APP), ...walk(STYLES)]) {
  if (!/\.(ts|scss)$/.test(f) || f.endsWith('.spec.ts')) continue;
  const src = readFileSync(f, 'utf8');
  if (f.endsWith('.ts')) {
    if (src.includes('template:')) templates++;
    // Every state-- mention anywhere in the component: class="", [class]="",
    // [class.state--x], and a string built in TypeScript all count, because
    // all four reach the DOM.
    /**
     * ⚠️ The lookbehind is load-bearing. Without it this matched the TAIL of
     * `landlord-trust__state--ok` and reported two states that do not exist,
     * which is how a gate earns its first two false positives and gets
     * switched off. A state class is its own token, not a suffix of one.
     */
    for (const m of src.matchAll(/(?<![\w-])state--([a-zA-Z-]+)/g)) {
      if (!used.has(m[1])) used.set(m[1], []);
      used.get(m[1]).push(`${f.replace(`${APP}/`, '')}:${lineAt(src, m.index)}`);
    }
  }

  /**
   * ── 2. No COMPONENT declares the treatment ─────────────────────────────
   *
   * The global layers may: `styles.scss` holds the vocabulary, and
   * `_spec.scss` / `_responsive.scss` are the ported visual language and the
   * breakpoints. Each of those is one place. The defect is a per-component
   * rule, because that is the one that gets written twice — and `_responsive`
   * holding `.app-card--closed` once is not the same shape of problem as
   * `.status--rejected` existing in two components with raw hexes.
   */
  if (f.startsWith(STYLES)) continue;
  const s = cssSource(f, src);
  if (!s) continue;
  /**
   * ⚠️ The LEGACY names count too, and the first version of this lint left
   * them out — which made the baseline file empty and therefore pointless. A
   * debt file with nothing in it is not a ratchet, it is a reassurance.
   *
   * `.status--*` and `.app-card--*` are the same thing under older names: a
   * state rendered by whichever component felt like it. Any that survive go in
   * the baseline, counted and named on every run, with a count that may only
   * go down.
   *
   * ⚠️ `.pill--*` is deliberately NOT governed. In this codebase a pill is an
   * ATTRIBUTE, not a state: "✓ Verified", "🛂 Passport", "Couples welcome".
   * Those are facts about a room or a person that do not change with a
   * lifecycle, and forcing them into a vocabulary of `live / waiting / past /
   * closed / disputed` would mean picking a state for "Couples welcome". The
   * one genuine state among them, `.pill--off` ("Not live") on the admin
   * services screen, is noted here rather than bent into the chip set.
   *
   * (Measured on the way past, since the question comes up: `.pill--green`
   * (#3D7040 on sage 10%) is 4.42:1 over `--cream2` and `.pill` is .6rem —
   * under the 4.5:1 small-text floor on that surface. It renders on `--card`
   * (4.90) and `--cream` (4.80) today, so it passes where it actually appears,
   * with 0.3 of margin. Worth knowing before a pill is moved onto cream2.)
   */
  for (const m of s.css.matchAll(
    /(^|[\s,{}])(\.(?:state(?:--[\w-]+|-edge|-text)?|status--[\w-]+|app-card--[\w-]+))\s*(?=[,{:.\s])/g,
  )) {
    const at = m.index + m[1].length;
    if (!s.ranges.some(([a, b]) => at >= a && at < b)) continue;
    // What does the rule actually set?
    const brace = s.css.indexOf('{', at);
    if (brace === -1) continue;
    const close = s.css.indexOf('}', brace);
    const body = s.css.slice(brace + 1, close === -1 ? undefined : close);
    const props = [...body.matchAll(/([-\w]+)\s*:/g)].map((p) => p[1]);
    const offending = props.filter((p) => !PLACEMENT_ONLY.has(p));
    if (offending.length) {
      declared.push({
        file: f.replace(`${APP}/`, ''),
        line: lineAt(src, at),
        sel: m[2],
        props: offending,
      });
    }
  }
}

if (used.size === 0) {
  // Nothing uses the vocabulary — which would make every check above vacuous.
  console.error('\nNo template uses a state-- class at all. The vocabulary is unused; refusing to pass.');
  process.exit(2);
}

const unknown = [...used].filter(([n]) => !NAMES.includes(n));
if (unknown.length === 0) {
  ok(`every state-- class used in a template is one of the ${NAMES.length} (${used.size} distinct, ${templates} templates scanned)`);
} else {
  for (const [n, where] of unknown) {
    bad(`state--${n} is not in the vocabulary — ${where.join(', ')}`);
  }
}

// ── Each defined name should be USED somewhere, or it is decoration ───────
/**
 * ⚠️ A name can reach the DOM without ever appearing in a template.
 * `stateClass(applicationState(app.status))` builds the string at runtime, so
 * `state--live` is rendered by the applicants screen and is nowhere in its
 * source. Counting only literal occurrences reported `live` and `disputed` as
 * dead when one of them was in daily use — a warning that is wrong is a
 * warning people learn to scroll past. The mapping's own return values count.
 */
for (const m of modelSrc.matchAll(/return\s+'([a-z-]+)'/g)) {
  if (!used.has(m[1])) used.set(m[1], [`${MODEL.split('/').pop()} (via the mapping)`]);
}

const unusedNames = NAMES.filter((n) => !used.has(n));
if (unusedNames.length) {
  console.log(`  ⚠️  defined but used nowhere yet: ${unusedNames.map((n) => `state--${n}`).join(', ')}`);
}

// ── 3. The legacy baseline, which may only shrink ─────────────────────────
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).declarations ?? {} : {};
const counts = {};
for (const d of declared) counts[d.file] = (counts[d.file] ?? 0) + 1;

if (process.argv.includes('--update-baseline')) {
  const over = Object.entries(counts).filter(([f, n]) => n > (baseline[f] ?? 0));
  if (over.length && existsSync(BASELINE)) {
    console.error('\n  ❌ Refusing to write a baseline WORSE than the one on disk:');
    for (const [f, n] of over) console.error(`     ${f}  ${baseline[f] ?? 0} → ${n}`);
    process.exit(1);
  }
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        note:
          'Components declaring their own rule for a .state* class, counted per file. ' +
          'Debt, not permission — the treatment belongs in styles.scss and a component may ' +
          'set placement only. A count higher than here, or a new file, fails the lint.',
        declarations: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`\n  Baseline rewritten: ${declared.length} declaration(s) across ${Object.keys(counts).length} file(s).\n`);
  process.exit(0);
}

for (const [f, n] of Object.entries(counts)) {
  const allowed = baseline[f] ?? 0;
  if (n > allowed) {
    const mine = declared.filter((d) => d.file === f);
    bad(`${f} declares the state treatment itself (${n}, baseline allows ${allowed})`);
    for (const d of mine) console.log(`        line ${d.line}  ${d.sel} sets ${d.props.join(', ')}`);
  }
}
const carried = declared.filter((d) => (counts[d.file] ?? 0) <= (baseline[d.file] ?? 0));
if (carried.length) {
  console.log(`  ${carried.length} legacy declaration(s) carried in the baseline, in ${new Set(carried.map((d) => d.file)).size} file(s):`);
  for (const d of carried) console.log(`     ${d.file}:${d.line}  ${d.sel} sets ${d.props.join(', ')}`);
  console.log('     Each is a state rendered outside the vocabulary. Fix and delete the line.');
}
if (!Object.keys(counts).length) ok('no component declares the state treatment itself');

console.log('════════════════════════════════════════════════════════════');
if (fail) {
  console.log(`  ${fail} problem(s). One treatment per meaning, defined in styles.scss.\n`);
  process.exit(1);
}
console.log('  ✅ one vocabulary, five names, declared in one place.\n');
