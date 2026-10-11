#!/usr/bin/env node
/**
 * Loading, empty and error are three components, not thirty-eight paragraphs.
 *
 * ── Why this exists
 *
 * Audit §G5: "No shared empty-state, skeleton or error-state component beyond
 * skeleton-card. Each screen writes its own loading paragraph and its own
 * empty copy. The copy is good — genuinely better than most — but there is no
 * system, so the twentieth screen will invent a twenty-first phrasing."
 *
 * Counted, it was worse in one specific way than "no system":
 *
 *   · 38 loading states in 28 components, 23 of them the identical paragraph.
 *     NONE was announced — no role, no aria-live — so a screen reader was told
 *     neither that a screen was busy nor that it had finished. axe does not
 *     flag a missing live region, so a11y-drive could never report it.
 *   · notices, messages and applicants-inbox used ONE element for the error
 *     AND the loading state AND the empty state, with role="alert" on it. So
 *     "Loading…" was announced as an alert, and "we could not reach the
 *     server" looked exactly like "you have nothing" — which on an applicants
 *     screen means a landlord concludes nobody applied.
 *   · the whole-screen error had no error styling at all. Muted body text,
 *     the same defect .form-error had before css-coverage-audit found it.
 *
 * What this checks:
 *
 *   1. No template says "Loading" in its own element any more. One component.
 *   2. No component declares a rule for a feedback class it does not own
 *      (.loading, .empty*, .err*), beyond placement.
 *   3. The loading component still carries role="status" and aria-live. That
 *      is the entire reason it exists, and it is one careless edit from being
 *      a plain paragraph again with nothing to say so.
 *
 *   node scripts/feedback-lint.mjs
 *   node scripts/feedback-lint.mjs --update-baseline
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cssSource, stripComments, lineAt } from './lib/css-values.mjs';

const APP = 'frontend/src/app';
const STYLES = 'frontend/src/styles';
const LOADING = `${APP}/shared/components/loading/loading.ts`;

/**
 * The three components that OWN the treatment. Everything else may place a
 * feedback element; only these may say what it looks like.
 *
 * ⚠️ Exempted by path, not by a magic class-name prefix, because the point of
 * the lint is "defined in one place" — and the only honest way to express that
 * is to name the place.
 */
const OWNERS = [
  LOADING,
  `${APP}/shared/components/empty-state/empty-state.ts`,
  `${APP}/shared/components/error-state/error-state.ts`,
];
const BASELINE = 'scripts/feedback-baseline.json';

const PLACEMENT_ONLY = new Set([
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'margin-block', 'margin-inline', 'align-self', 'justify-self', 'order',
  'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'grid-area', 'grid-column',
  'grid-row', 'max-width', 'text-align',
]);

const walk = (dir) =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

let fail = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };

console.log('\n── Loading, empty and error ────────────────────────────────');

// ── 3. The one thing the loading component is FOR ─────────────────────────
if (!existsSync(LOADING)) {
  console.error(`No ${LOADING}. Refusing to pass vacuously.`);
  process.exit(2);
}
/**
 * ⚠️ Comments stripped first, and this check was WRONG without it.
 *
 * The component's own header explains why it carries role="status" — so the
 * assertion matched the prose that describes the attribute rather than the
 * attribute, and passed with the attribute deleted from the template. Verified
 * by deleting it: the lint stayed green. A check that cannot fail is not a
 * check, and this one was reading its own documentation.
 *
 * stripComments blanks the JSDoc while leaving the template literal intact,
 * because a template literal is a string and the stripper does not enter one.
 */
const loadingSrc = stripComments(readFileSync(LOADING, 'utf8'));
/role="status"/.test(loadingSrc)
  ? ok('app-loading carries role="status"')
  : bad('app-loading has LOST role="status" — a loading state nothing announces');
/aria-live="polite"/.test(loadingSrc)
  ? ok('…and aria-live="polite", so it is announced politely, not as an alert')
  : bad('app-loading has LOST aria-live — and role="status" alone is not relied on by every reader');

// ── 1 + 2 ─────────────────────────────────────────────────────────────────
const strays = [];
const declared = [];
let templates = 0;
let uses = 0;

for (const f of [...walk(APP), ...walk(STYLES)]) {
  if (!/\.(ts|scss)$/.test(f) || f.endsWith('.spec.ts')) continue;
  const src = readFileSync(f, 'utf8');

  if (f.endsWith('.ts')) {
    if (src.includes('template:')) templates++;
    uses += (src.match(/<app-(loading|empty-state|error-state)/g) ?? []).length;
    if (f === LOADING) continue;
    /**
     * A loading state written as its own element. The component is the only
     * place "Loading" belongs now — and a BUTTON that says "Sending…" or
     * "Saving…" is a different thing entirely, which is why this looks for
     * "Loading" specifically and inside a non-button element.
     */
    for (const m of src.matchAll(/<(p|div|span)\b[^>]*>\s*(\{\{[^}]*\}\}\s*)?Loading/g)) {
      strays.push({ file: f.replace(`${APP}/`, ''), line: lineAt(src, m.index), tag: m[1] });
    }
  }

  // Global layers may define the treatment, and so may the three components
  // that own it. No other component may.
  if (f.startsWith(STYLES) || OWNERS.includes(f)) continue;
  const s = cssSource(f, src);
  if (!s) continue;
  for (const m of s.css.matchAll(/(^|[\s,{}])(\.(?:loading|empty(?:__[\w-]+)?|err(?:__[\w-]+)?))\s*(?=[,{:.\s])/g)) {
    const at = m.index + m[1].length;
    if (!s.ranges.some(([a, b]) => at >= a && at < b)) continue;
    const brace = s.css.indexOf('{', at);
    if (brace === -1) continue;
    const close = s.css.indexOf('}', brace);
    const body = s.css.slice(brace + 1, close === -1 ? undefined : close);
    const props = [...body.matchAll(/([-\w]+)\s*:/g)].map((p) => p[1]).filter((p) => !PLACEMENT_ONLY.has(p));
    if (props.length) {
      declared.push({ file: f.replace(`${APP}/`, ''), line: lineAt(src, at), sel: m[2], props });
    }
  }
}

if (uses === 0) {
  console.error('\nNothing uses app-loading / app-empty-state / app-error-state. Refusing to pass vacuously.');
  process.exit(2);
}
ok(`${uses} use(s) of the three components across ${templates} templates`);

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { loading: {}, declarations: {} };
const strayCounts = {};
for (const s of strays) strayCounts[s.file] = (strayCounts[s.file] ?? 0) + 1;
const declCounts = {};
for (const d of declared) declCounts[d.file] = (declCounts[d.file] ?? 0) + 1;

if (process.argv.includes('--update-baseline')) {
  const worse = [
    ...Object.entries(strayCounts).filter(([f, n]) => n > (baseline.loading?.[f] ?? 0)),
    ...Object.entries(declCounts).filter(([f, n]) => n > (baseline.declarations?.[f] ?? 0)),
  ];
  if (worse.length && existsSync(BASELINE)) {
    console.error('\n  ❌ Refusing to write a baseline WORSE than the one on disk:');
    for (const [f, n] of worse) console.error(`     ${f} → ${n}`);
    process.exit(1);
  }
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        note:
          'Loading states still written as their own element, and components still declaring a ' +
          'feedback treatment, counted per file. Debt, not permission — app-loading, ' +
          'app-empty-state and app-error-state are the three. A count above these, or a new file, fails.',
        loading: Object.fromEntries(Object.entries(strayCounts).sort(([a], [b]) => a.localeCompare(b))),
        declarations: Object.fromEntries(Object.entries(declCounts).sort(([a], [b]) => a.localeCompare(b))),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`\n  Baseline rewritten: ${strays.length} stray loading state(s), ${declared.length} declaration(s).\n`);
  process.exit(0);
}

for (const [f, n] of Object.entries(strayCounts)) {
  const allowed = baseline.loading?.[f] ?? 0;
  if (n > allowed) {
    bad(`${f} writes its own loading state (${n}, baseline allows ${allowed}) — use <app-loading>`);
    for (const s of strays.filter((x) => x.file === f)) console.log(`        line ${s.line}  <${s.tag}>`);
  }
}
for (const [f, n] of Object.entries(declCounts)) {
  const allowed = baseline.declarations?.[f] ?? 0;
  if (n > allowed) {
    bad(`${f} declares a feedback treatment itself (${n}, baseline allows ${allowed})`);
    for (const d of declared.filter((x) => x.file === f)) console.log(`        line ${d.line}  ${d.sel} sets ${d.props.join(', ')}`);
  }
}
if (!Object.keys(strayCounts).length) ok('no template writes its own loading state');
if (!Object.keys(declCounts).length) ok('no component declares a feedback treatment itself');

console.log('════════════════════════════════════════════════════════════');
if (fail) {
  console.log(`  ${fail} problem(s).\n`);
  process.exit(1);
}
console.log('  ✅ three components, one treatment each, and the loading state is announced.\n');
