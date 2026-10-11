#!/usr/bin/env node
/**
 * A backtick inside a component's inline `template:` or `styles:` literal
 * terminates the literal.
 *
 * ── Why this is a script and not a note in CLAUDE.md
 *
 * It is already a note in CLAUDE.md — "Backticks inside a component's inline
 * template literal terminate the template. Two compile failures so far." It is
 * now seven, two of them while writing the lifecycle phases this script
 * arrived with. A documented trap that keeps being hit is not a documentation
 * problem.
 *
 * What makes it expensive is the error. TypeScript reports `TS1005: ',' expected`
 * at a line hundreds of characters past the cause, because everything after
 * the stray backtick is being parsed as code. The backtick is almost always in
 * a COMMENT inside the template — somebody quoting an identifier the way they
 * would anywhere else — so it reads as harmless and the reported line reads as
 * unrelated.
 *
 * A grep is enough. So: no excuse for finding it by compiling, and no excuse
 * for a production build being the net.
 *
 * ── ⚠️ `styles:` was not covered, and that is how the eighth one landed
 *
 * The first version of this file looked only at `template: \``, and only at
 * the FIRST one in each file. Phase I's logo component put five backticked
 * identifiers inside a comment in its `styles:` block — exactly the mistake
 * this script exists for — and the script read green over it while the
 * production build produced twenty errors, among them `TS2304: Cannot find
 * name 'color'` and `TS2552: Cannot find name '_responsive'`. A lint that
 * covers one of the two places a trap occurs is a lint that will be trusted
 * in the other.
 *
 * So: every inline literal in a component decorator — `template:`, `styles:`
 * and each element of a `styles: [...]` array — and every occurrence in the
 * file, not just the first.
 *
 *     node scripts/template-literal-lint.mjs
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const files = execSync(
  `grep -rlE 'template: \`|styles: (\\[)?\`' ${join(ROOT, 'frontend/src')} --include=*.ts || true`,
).toString().trim().split('\n').filter(Boolean);

if (files.length === 0) {
  console.log('No inline templates or styles found — is the path right?');
  process.exit(2);
}

/**
 * What may legally follow a correctly-closed literal.
 *
 * `template: \`…\`` is followed by a comma. A `styles:` array element is
 * followed by a comma or by the closing `]`. Anything else — a letter, a `:`,
 * a `(` — means the literal ended at a stray backtick and what comes after is
 * being parsed as TypeScript.
 */
const LEGAL_AFTER = /^`\s*[,\]}]/;

const broken = [];
let literals = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');

  // Every opener in the file, not just the first.
  for (const m of src.matchAll(/\b(template|styles)\s*:\s*(\[\s*)?`/g)) {
    const kind = m[1];
    let i = m.index + m[0].length;
    literals++;

    while (i < src.length) {
      if (src[i] === '`' && src[i - 1] !== '\\') break;
      i++;
    }

    const after = src.slice(i, i + 60).replace(/\s+/g, ' ');
    if (!LEGAL_AFTER.test(after)) {
      broken.push({
        file: file.replace(`${ROOT}/`, ''),
        line: src.slice(0, i).split('\n').length,
        kind,
        after: after.slice(1, 45).trim(),
      });
    }
  }
}

console.log('\n── Inline template literals ────────────────────────────────');
if (broken.length) {
  for (const b of broken) {
    console.log(`  ❌ ${b.file}:${b.line}  (${b.kind}:)`);
    console.log(`     the literal ends here, not at its closing backtick.`);
    console.log(`     what follows is being parsed as code: ${b.after}`);
  }
  console.log(`\n  ${broken.length} truncated literal(s). Remove the backtick — it is almost`);
  console.log('  certainly inside a comment, quoting an identifier.');
  console.log('════════════════════════════════════════════════════════════\n');
  process.exit(1);
}
console.log(`  ✅ ${literals} inline template/styles literals across ${files.length} files,`);
console.log('     none truncated by a stray backtick.');
console.log('════════════════════════════════════════════════════════════\n');
