#!/usr/bin/env node
/**
 * A backtick inside a component's inline `template:` literal terminates the
 * template.
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
 *     node scripts/template-literal-lint.mjs
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const files = execSync(
  `grep -rl 'template: \`' ${join(ROOT, 'frontend/src')} --include=*.ts || true`,
).toString().trim().split('\n').filter(Boolean);

if (files.length === 0) {
  console.log('No inline templates found — is the path right?');
  process.exit(2);
}

const broken = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const open = src.indexOf('template: `') + 'template: `'.length;

  // Where the literal actually ends: the first unescaped backtick.
  let i = open;
  while (i < src.length) {
    if (src[i] === '`' && src[i - 1] !== '\\') break;
    i++;
  }

  /**
   * A correctly-closed template is followed by a comma — `template: ...`,
   * then `styles`, `changeDetection` or the closing brace. If the next
   * non-space character is anything else, the literal ended early and the rest
   * of the template is being read as TypeScript.
   */
  const after = src.slice(i, i + 60).replace(/\s+/g, ' ');
  if (!/^`\s*,/.test(after)) {
    const line = src.slice(0, i).split('\n').length;
    broken.push({
      file: file.replace(`${ROOT}/`, ''),
      line,
      after: after.slice(1, 45).trim(),
    });
  }
}

console.log('\n── Inline template literals ────────────────────────────────');
if (broken.length) {
  for (const b of broken) {
    console.log(`  ❌ ${b.file}:${b.line}`);
    console.log(`     the literal ends here, not at its closing backtick.`);
    console.log(`     what follows is being parsed as code: ${b.after}`);
  }
  console.log(`\n  ${broken.length} truncated template(s). Remove the backtick — it is almost`);
  console.log('  certainly inside a comment, quoting an identifier.');
  console.log('════════════════════════════════════════════════════════════\n');
  process.exit(1);
}
console.log(`  ✅ ${files.length} inline templates, none truncated by a stray backtick.`);
console.log('════════════════════════════════════════════════════════════\n');
