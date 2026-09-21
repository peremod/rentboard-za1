#!/usr/bin/env node
/**
 * Workflow YAML sanity, checked before a push rather than by GitHub.
 *
 * Written after a duplicate `env:` key on one step shipped to GitHub, which
 * rejected the whole file: the run appeared instantly as a failure with zero
 * jobs and the workflow's name showing as its path. A broken workflow cannot
 * be caught by a job inside that workflow, so this runs locally, from the
 * pre-commit hook.
 *
 * The specific trap is that YAML's ordinary loaders accept duplicate keys and
 * silently keep the last one, so a "does it parse" check passes on exactly the
 * file GitHub refuses. This rejects them.
 *
 * Deliberately small. It is not a replacement for actionlint, which is worth
 * adding if this ever needs to check expressions or action inputs; it covers
 * the mistake that has actually happened here.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../.github/workflows');
const files = readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

const problems = [];

for (const file of files) {
  const lines = readFileSync(join(dir, file), 'utf8').split('\n');

  // Track sibling keys per indent level. A key repeating at the same indent
  // under the same parent is the duplicate GitHub rejects.
  const seen = new Map(); // indent -> Map<key, lineNumber>
  let previousIndent = 0;

  lines.forEach((line, i) => {
    if (!line.trim() || line.trimStart().startsWith('#')) return;

    const indent = line.length - line.trimStart().length;
    const match = line.trimStart().match(/^(-\s+)?([A-Za-z_][\w.-]*):(\s|$)/);

    // Leaving a block ends the scope of every deeper level.
    if (indent < previousIndent) {
      for (const level of [...seen.keys()]) if (level > indent) seen.delete(level);
    }
    previousIndent = indent;

    if (!match) return;
    // A list item starts a new mapping, so its keys are not siblings of the
    // previous item's.
    if (match[1]) {
      for (const level of [...seen.keys()]) if (level >= indent) seen.delete(level);
    }

    const key = match[2];
    const effectiveIndent = match[1] ? indent + match[1].length : indent;
    if (!seen.has(effectiveIndent)) seen.set(effectiveIndent, new Map());
    const atLevel = seen.get(effectiveIndent);

    if (atLevel.has(key)) {
      problems.push(`${file}:${i + 1}  duplicate key "${key}" (first seen on line ${atLevel.get(key)})`);
    }
    atLevel.set(key, i + 1);
  });
}

if (problems.length) {
  console.error('\nWorkflow problems:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nGitHub rejects the whole file for these, and the run fails with no jobs.\n');
  process.exit(1);
}

console.log(`✅ ${files.length} workflow files, no duplicate keys.`);
