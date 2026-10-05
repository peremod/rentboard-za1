#!/usr/bin/env node
/**
 * Every class a template uses must have a rule somewhere in the shipped CSS.
 *
 * ── Why this exists
 *
 * A landlord sent a screenshot of the property screen on a 360px handset
 * reading "Shared detailsDelete this property" — two buttons welded into one
 * string, a destructive action with no gap between it and a harmless one. The
 * container, `.yard__actions`, had no rule anywhere. Not a wrong rule: none.
 *
 * Beside it, `.form-error` — the whole-form error banner, the thing a person is
 * meant to NOTICE — had no rule either, across four components, two of them
 * announcing it with `role="alert"`. A screen reader said "error"; the screen
 * showed body text.
 *
 * Neither is visible to anything else here. A unit test renders the component
 * and the class is present. A UI drive only measures the screens it visits, and
 * `layout-ui-drive` visited five, none of them this one. The production build
 * succeeds — an unused class is not an error. So the defect reaches a phone.
 *
 * This check cannot be fooled by not visiting a screen, because it reads the
 * templates rather than the pages. It is the same shape as `nav-audit`: a
 * structural claim, checked structurally.
 *
 * ── What it does NOT check
 *
 * That the rule is any good. A class with `color:red` and nothing else passes.
 * Widths, overflow and tap targets are `layout-ui-drive`'s job, and that one
 * has to actually visit the screen. This finds the hole; it does not measure
 * the floor.
 *
 * ⚠️ A component carrying its own `styles:` block is NOT skipped, and the first
 * version of this file skipped them. That hid the worst case it has found:
 * `.btn-danger` is used by SEVEN components and written in the scoped styles of
 * TWO. Angular's emulated encapsulation rewrites those two rules with an
 * attribute selector, so the other five — verifications, disputes, reports, the
 * admin dashboard and advertising — render a destructive button identical to an
 * ordinary one. Having a `styles:` block says nothing about whether THIS class
 * is in it, so each component is checked against the global bundle plus its own
 * styles, and nothing is assumed from the presence of a block.
 *
 *   npm run build:prod && node scripts/css-coverage-audit.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * ⚠️ A baseline rather than an allowlist, and the difference is the point.
 *
 * Switched on, this check found 27 bare classes across 82 components. Writing
 * 27 invented reasons into ALLOWED to get a green tick is precisely the failure
 * the ALLOWED comment warns about — the list becomes the place defects go to be
 * forgotten, and the check reads green over all of them forever.
 *
 * So the known ones live in a baseline FILE, counted and named on every run,
 * and the check fails on anything that is not in it. A new bare class is caught
 * the day it is written; the existing debt stays in sight and can be burned
 * down by deleting lines from the baseline, which is a one-way ratchet.
 *
 * `--update-baseline` rewrites it. That is for when a class is legitimately
 * removed, not for making a failure go away.
 */
const BASELINE = 'scripts/css-coverage-baseline.json';

const APP = 'frontend/src/app';
const DIST = 'frontend/dist/mastande-frontend/browser';

/**
 * Classes that are deliberately bare: a hook for a test or a script, or a
 * modifier that only ever appears beside a class that does the styling.
 *
 * ⚠️ Each one needs a reason. An allowlist without reasons becomes the place
 * defects go to be forgotten, which is the failure this whole file is about.
 */
const ALLOWED = new Map([
  ['money-basis', 'always written as "muted money-basis"; .muted styles it, this is a hook'],
  ['money-scope', 'always written as "muted money-scope"; .muted styles it'],
  ['yard__shared', 'always written as "yard__shared muted"; .muted styles it'],
  ['yard-ungrouped-note', 'always written as "muted yard-ungrouped-note"; .muted styles it'],
  ['rating--none', 'modifier on .rating, which carries the styling'],
]);

if (!existsSync(DIST)) {
  console.error(`No build at ${DIST}. Run: cd frontend && npm run build:prod`);
  process.exit(2);
}

const css = readdirSync(DIST)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(DIST, f), 'utf8'))
  .join('\n');

const walk = (dir) =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** A selector mentions the class if it appears followed by any selector delimiter. */
const styled = (c) =>
  ['{', ',', ' ', ':', '>', '+', '~', '[', '.'].some((d) => css.includes(`.${c}${d}`));

const bare = new Map();
let scanned = 0;
let usages = 0;

for (const file of walk(APP).filter((f) => f.endsWith('.ts'))) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('template:')) continue;
  scanned++;

  /**
   * The component's own styles count only for the component that declares them.
   * A `styleUrl` is followed to the file; an inline `styles:` block is near
   * enough to just search the source, since a class written anywhere in the
   * component's own text is in its own scope.
   */
  let ownCss = /\bstyles\s*:/.test(src) ? src : '';
  for (const m of src.matchAll(/styleUrls?\s*:\s*\[?\s*['"]([^'"]+)['"]/g)) {
    const p = join(file, '..', m[1]);
    if (existsSync(p)) ownCss += readFileSync(p, 'utf8');
  }

  const used = new Set();
  for (const m of src.matchAll(/class="([^"{]+)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) used.add(c);
  }
  for (const c of used) {
    usages++;
    if (styled(c) || ALLOWED.has(c)) continue;
    // Styled in this component's own scope — real for this component only.
    if (ownCss && ['{', ',', ' ', ':', '>'].some((d) => ownCss.includes(`.${c}${d}`))) continue;
    const short = file.replace(`${APP}/`, '');
    bare.set(c, [...(bare.get(c) ?? []), short]);
  }
}

console.log('\n═══ CSS coverage — every template class needs a rule ═══');
console.log(`  ${scanned} components with templates, ${usages} class usages.`);
console.log(`  ${ALLOWED.size} deliberately bare (allowlisted with a reason).`);

const known = existsSync(BASELINE)
  ? new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).classes)
  : new Set();

if (process.argv.includes('--update-baseline')) {
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        note: 'Classes used in a template with no rule anywhere. Debt, not permission — delete lines as they are fixed. A class NOT in here fails the audit.',
        classes: [...bare.keys()].sort(),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`\n  Baseline rewritten: ${bare.size} class(es).\n`);
  process.exit(0);
}

const fresh = [...bare].filter(([c]) => !known.has(c));
const stillKnown = [...bare].filter(([c]) => known.has(c));

if (stillKnown.length) {
  console.log(`  ${stillKnown.length} known bare class(es) carried in the baseline:`);
  console.log('     ' + stillKnown.map(([c]) => '.' + c).sort().join(' '));
  console.log('     Each is a screen rendering unstyled content. Fix and delete the line.');
}

if (fresh.length === 0) {
  console.log('\n  ✅ No NEW class is used in a template and styled nowhere.\n');
  process.exit(0);
}
bare.clear();
for (const [c, f] of fresh) bare.set(c, f);

console.log(`\n  ❌ ${bare.size} NEW class(es) are used in a template and styled nowhere:\n`);
for (const [c, files] of [...bare].sort()) {
  console.log(`     .${c}`);
  for (const f of files) console.log(`        ${f}`);
}
console.log(
  '\n     Give it a rule. Do not add it to the baseline to silence this —',
);
console.log('     A class with no rule renders as unstyled inline content — which on a');
console.log('     phone is how two buttons become one unbroken string.\n');
process.exit(1);
