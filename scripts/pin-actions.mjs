#!/usr/bin/env node
/**
 * Pin third-party GitHub Actions to commit SHAs (F-05).
 *
 * A `uses: owner/action@v2` reference trusts a MUTABLE tag: whoever controls
 * the tag controls what runs in CI, with this repository's token and secrets.
 * Pinning to the 40-char commit SHA removes that trust — `# v2` is kept beside
 * it so a human and Dependabot can still read the intended version.
 *
 * ── Why a script and not a hand-edit
 *
 * The SHAs MUST come from the real action repositories — a guessed SHA is worse
 * than a tag, because it silently fails closed or pins to nothing. The audit
 * environment's GitHub access is scoped to this repository alone (both the MCP
 * tools and api.github.com through the proxy refuse actions/checkout), so the
 * SHAs cannot be resolved there. This script resolves them where GitHub IS
 * reachable — your machine, or CI — so the values are real, not invented.
 *
 * ── Usage
 *
 *   node scripts/pin-actions.mjs            # dry run: print what would change
 *   node scripts/pin-actions.mjs --write    # rewrite .github/workflows/*
 *   node scripts/pin-actions.mjs --selfcheck # offline: prove the rewrite logic
 *
 * Resolution uses `gh api repos/<owner>/<repo>/commits/<ref>` (the commits
 * endpoint dereferences an annotated tag to its commit for you), so `gh` must
 * be installed and authenticated. Re-running is idempotent: an already-pinned
 * `uses:` is left untouched, and a local `./` action is never touched.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const WORKFLOWS = '.github/workflows';
const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * Rewrite one workflow line, resolving its ref to a SHA via `resolve`.
 *
 * Pure except for `resolve`, which is injected so the logic can be checked
 * offline with a stub. Returns the line unchanged when there is nothing to pin.
 */
export function rewriteLine(line, resolve) {
  // `  - uses: owner/repo[/sub]@ref   # optional comment`
  const m = line.match(/^(\s*-?\s*uses:\s*)([^\s@#]+)@([^\s#]+)(\s*(#.*)?)$/);
  if (!m) return line;
  const [, prefix, path, ref] = m;

  if (path.startsWith('./') || path.startsWith('.\\')) return line; // local action
  if (SHA_RE.test(ref)) return line;                                // already pinned

  // The API repo is the first two path segments; a sub-action keeps its path.
  const [owner, repo] = path.split('/');
  const sha = resolve(owner, repo, ref);
  if (!SHA_RE.test(sha)) {
    throw new Error(`resolver returned a non-SHA for ${path}@${ref}: ${JSON.stringify(sha)}`);
  }
  const nl = line.endsWith('\n') ? '\n' : '';
  return `${prefix}${path}@${sha} # ${ref}${nl}`;
}

function resolveViaGh(owner, repo, ref) {
  const out = execFileSync(
    'gh',
    ['api', `repos/${owner}/${repo}/commits/${ref}`, '--jq', '.sha'],
    { encoding: 'utf8' },
  );
  return out.trim();
}

function selfcheck() {
  const stub = () => 'a'.repeat(40);
  const cases = [
    // [input, expected]
    ['  - uses: actions/checkout@v5\n', `  - uses: actions/checkout@${'a'.repeat(40)} # v5\n`],
    ['      uses: google/osv-scanner-action/osv-scanner-action@v2.2.3\n',
     `      uses: google/osv-scanner-action/osv-scanner-action@${'a'.repeat(40)} # v2.2.3\n`],
    // already pinned → unchanged
    [`  - uses: actions/checkout@${'b'.repeat(40)} # v5\n`, `  - uses: actions/checkout@${'b'.repeat(40)} # v5\n`],
    // local action → unchanged
    ['  - uses: ./.github/actions/thing\n', '  - uses: ./.github/actions/thing\n'],
    // a non-uses line → unchanged
    ['    run: npm ci\n', '    run: npm ci\n'],
  ];
  let failed = 0;
  for (const [input, expected] of cases) {
    const got = rewriteLine(input, stub);
    const ok = got === expected;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(input.trim())}`);
    if (!ok) console.log(`     expected ${JSON.stringify(expected)}\n     got      ${JSON.stringify(got)}`);
  }
  // The guard that makes this more than a formatter: a resolver that returns a
  // non-SHA must throw, not write garbage into a workflow.
  let threw = false;
  try { rewriteLine('  - uses: actions/checkout@v5\n', () => 'not-a-sha'); } catch { threw = true; }
  console.log(`${threw ? 'PASS' : 'FAIL'} throws when the resolver returns a non-SHA`);
  if (!threw) failed++;
  if (failed) { console.error(`\n${failed} self-check(s) failed`); process.exit(1); }
  console.log('\nself-check passed');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selfcheck')) return selfcheck();
  const write = args.includes('--write');

  const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
  let changes = 0;
  for (const file of files) {
    const path = join(WORKFLOWS, file);
    const original = readFileSync(path, 'utf8');
    const lines = original.split(/(?<=\n)/);
    const next = lines.map((l) => rewriteLine(l, resolveViaGh)).join('');
    if (next !== original) {
      changes++;
      console.log(`${write ? 'pinned' : 'would pin'}: ${path}`);
      if (write) writeFileSync(path, next);
    }
  }
  console.log(changes ? `\n${changes} file(s) ${write ? 'updated' : 'to update — re-run with --write'}` : 'nothing to pin');
}

main();
