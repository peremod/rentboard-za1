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
 * The second check is shell syntax inside every `run:` block. A step whose
 * script does not parse is a different failure from a file GitHub rejects —
 * the workflow is valid, the jobs start, and the step dies on its first line.
 * That is worse than it sounds, because a job stops at its first failing step:
 * an unterminated quote in one `echo` took down the frontend job and hid the
 * three metadata assertions after it, which is the same "a red step conceals
 * the steps behind it" problem as checklist row 27.
 *
 * `bash -n` parses without executing, which is exactly the question being
 * asked. `${{ }}` expressions are replaced with a literal first, because
 * GitHub substitutes them before bash ever sees the script.
 *
 * Deliberately small. It is not a replacement for actionlint, which is worth
 * adding if this ever needs to check expressions or action inputs; it covers
 * the mistakes that have actually happened here.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

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

// ── Shell syntax in every `run:` block ──────────────────────────────────────

/** Only bash and sh are parseable by `bash -n`; a python or pwsh step is not. */
function isShellScript(shell) {
  if (!shell) return true; // GitHub's default on every runner this repo uses.
  return /^(bash|sh)\b/.test(shell);
}

/**
 * GitHub interpolates `${{ … }}` before the shell starts, so the script bash
 * actually receives never contains one. Replaced with a bare word rather than
 * removed, so `if [ -n "${{ … }}" ]` stays a well-formed test.
 */
function asBashSees(run) {
  return run.replace(/\$\{\{[^}]*\}\}/g, 'GHA_EXPR');
}

let stepsChecked = 0;
/**
 * Steps *traversed* per file, not steps checked. A floor on the latter looked
 * right and was wrong: labels.yml is entirely `uses:` steps, so demanding a
 * shell step failed a correct file. What actually needs proving is that the
 * walk reaches steps at all — otherwise a shape change in the workflow schema
 * would print a ✅ over nothing, which is the failure mode this floor exists
 * to stop.
 */
const stepsSeenIn = new Map();

for (const file of files) {
  let doc;
  try {
    doc = yaml.load(readFileSync(join(dir, file), 'utf8'));
  } catch (err) {
    problems.push(`${file}  does not parse as YAML: ${err.message.split('\n')[0]}`);
    continue;
  }

  const workflowShell = doc?.defaults?.run?.shell;

  for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
    const jobShell = job?.defaults?.run?.shell ?? workflowShell;

    (job?.steps ?? []).forEach((step, index) => {
      stepsSeenIn.set(file, (stepsSeenIn.get(file) ?? 0) + 1);
      if (typeof step?.run !== 'string') return;
      const shell = step.shell ?? jobShell;
      if (!isShellScript(shell)) return;

      stepsChecked++;
      const label = step.name ? `"${step.name}"` : `step ${index + 1}`;
      const check = spawnSync('bash', ['-n'], { input: asBashSees(step.run), encoding: 'utf8' });

      if (check.status !== 0) {
        const detail = (check.stderr || '').trim().split('\n').join('; ').replace(/^-: /g, '');
        problems.push(`${file}  ${jobName} → ${label}  shell syntax: ${detail}`);
      }
    });
  }
}

for (const file of files) {
  if (!stepsSeenIn.get(file)) {
    problems.push(`${file}  the walk reached no steps at all — this linter is broken, not the file`);
  }
}

if (problems.length) {
  console.error('\nWorkflow problems:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nA step whose script does not parse fails on its first line, and takes\n' +
      'every step after it in that job down with it.\n',
  );
  process.exit(1);
}

console.log(
  `✅ ${files.length} workflow files, no duplicate keys, ${stepsChecked} run steps parse as shell.`,
);
