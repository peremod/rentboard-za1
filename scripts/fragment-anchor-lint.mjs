#!/usr/bin/env node
/**
 * A link to an anchor that does not exist is a button that does nothing.
 *
 * The tenant inbox's elapsed-viewing row has pointed at
 * `/tenant/dashboard#viewings` since Phase 8n. There was no `id="viewings"`
 * anywhere in the frontend. So "Say what happened" navigated, the URL gained a
 * fragment, and the page did not move — measured at 390px as
 * `scrollY 0 -> 0, #viewings exists: false`. Reported from a phone as "the
 * button does nothing", which is exactly what it did, for weeks.
 *
 * ⚠️ Nothing could see it. `route-audit` checks that a PATH resolves to a
 * route, and `/tenant/dashboard` does. The fragment is not part of the route,
 * so a dead anchor is invisible to it — the same shape as the nav audit that
 * was structurally incapable of seeing a dead link.
 *
 * This reads the fragments the API actually emits and asks whether anything in
 * the frontend carries that id.
 *
 *   node scripts/fragment-anchor-lint.mjs
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const files = (pattern) =>
  execSync(`git ls-files ${pattern}`, { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);

/**
 * Every '/path#fragment' the backend hands the frontend as something to open.
 *
 * Read from the API rather than from the templates, because the API is where
 * these are written: `actionPath` comes from the inbox services precisely so a
 * path is not reassembled in a template, where no check would read it.
 */
const emitted = [];
for (const rel of files("'backend/src/**/*.ts'")) {
  const src = read(rel);
  for (const m of src.matchAll(/['"`](\/[a-z0-9/_-]*)#([a-z0-9-]+)['"`]/gi)) {
    emitted.push({ rel, path: m[1], fragment: m[2] });
  }
}

/**
 * Every id the frontend RENDERS. Static ids only — a bound id cannot be read
 * here.
 *
 * ⚠️ Comments are stripped first, and that is not tidiness. The first version
 * of this check did not, so the comment ABOVE the fix — which quotes
 * `id="viewings"` while explaining why it had to be added — satisfied the
 * check on its own. Falsified by deleting the real attribute: the lint still
 * passed, because it was reading prose about markup as markup.
 *
 * That is the same defect font-lint had (§90d), found the same way, by trying
 * to make the check fail and watching it refuse.
 */
const stripComments = (src) => src
  .replace(/<!--[\s\S]*?-->/g, ' ')   // HTML comments, including in templates
  .replace(/\/\*[\s\S]*?\*\//g, ' ')  // block comments, including in styles
  .replace(/^\s*\/\/.*$/gm, ' ');     // line comments

const anchors = new Set();
for (const rel of files("'frontend/src/**/*.ts' 'frontend/src/**/*.html'")) {
  for (const m of stripComments(read(rel)).matchAll(/\bid="([a-z0-9-]+)"/gi)) anchors.add(m[1]);
}

console.log('\n── Fragment links and the anchors they need ────────────────');
console.log(`  ${emitted.length} fragment link(s) emitted by the API; `
  + `${anchors.size} static id(s) in the frontend.`);

const dead = emitted.filter((e) => !anchors.has(e.fragment));
for (const e of emitted) {
  const ok = anchors.has(e.fragment);
  console.log(`  ${ok ? '✅' : '❌'} ${e.path}#${e.fragment}   ${e.rel.replace('backend/src/modules/', '')}`);
}

if (!dead.length) {
  console.log('\n  ✅ every fragment the API points at exists in the frontend.');
  console.log('════════════════════════════════════════════════════════════\n');
  process.exit(0);
}

console.log(`\n  ${dead.length} fragment(s) point at an id nothing renders.`);
console.log('  A link to an anchor that does not exist does NOTHING when tapped:');
console.log('  the URL changes, the page stays where it was, and the person is');
console.log('  left pressing a button that looks like a control.');
console.log('  Add the id to the section it names, or change the actionPath.');
console.log('════════════════════════════════════════════════════════════\n');
process.exit(1);
