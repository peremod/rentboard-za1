#!/usr/bin/env node
/**
 * A live credential in a tracked file.
 *
 * ── Why this exists
 *
 * On 20 October scripts/migrate-targets.json was filled in with the full
 * DATABASE_URL of both databases, copied from the Render dashboard — user,
 * password and all — and pushed. Both Neon passwords were in public git
 * history within a minute, and both had to be rotated. The field wanted a
 * hostname fragment; the file told the operator to fetch it from "Environment
 * -> DATABASE_URL", and what you find there is a connection string. A field
 * that invites a secret will eventually be given one.
 *
 * `git rm` does not undo it. The blob stays in the history, in every clone and
 * every fetch, and GitHub serves it by SHA indefinitely. Rotation is the only
 * remedy, which is why this runs BEFORE the commit.
 *
 * ── Calibrated, not guessed
 *
 * `backend/.env.example` is the documented home for secret NAMES and is
 * skipped. Localhost credentials are NOT secrets and are legitimately in this
 * repository — README.md and scripts/lib/drive-session.mjs both carry
 * `postgresql://rentboard:rentboard@localhost:5432/...`, and a gate that
 * flagged those would be switched off within a day. So the rule is a password
 * on a host that is NOT local.
 *
 * Measured against the tree at the time of writing: these patterns flagged
 * exactly the two leaked lines and nothing else.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Secret NAMES live here by design; values never do. */
const SKIP = new Set(['backend/.env.example', 'scripts/secret-scan.mjs']);

const RULES = [
  {
    name: 'Neon database password',
    /** Neon issues passwords prefixed `npg_`. Unambiguous, so no host test. */
    re: /npg_[A-Za-z0-9]{8,}/g,
  },
  {
    name: 'database URL with an embedded password on a remote host',
    /**
     * user:password@host, where host is not local. The password class excludes
     * whitespace, @, / and the ellipsis character so that documented
     * placeholders (`postgresql://…-pooler…`) do not match.
     */
    re: /(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^\s:/@]+:[^\s:/@…]{6,}@(?!localhost|127\.0\.0\.1|db[:/]|postgres[:/])[^\s/]+/g,
  },
  {
    name: 'private key block',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
];

function tracked() {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

/** Exported so the falsification harness can test strings without a commit. */
export function findSecrets(text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      if (rule.re.test(line)) hits.push({ line: i + 1, rule: rule.name });
    }
  });
  return hits;
}

/** Shows enough to find the line, never the secret itself. */
function redact(line) {
  return line
    .replace(/npg_[A-Za-z0-9]{8,}/g, 'npg_[REDACTED]')
    .replace(/:\/\/([^\s:/@]+):[^\s:/@]{6,}@/g, '://$1:[REDACTED]@')
    .trim()
    .slice(0, 110);
}

/** Runs only when executed, so importing it for tests neither scans nor exits. */
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}

function main() {
const files = tracked();
const problems = [];
let scanned = 0;

for (const file of files) {
  if (SKIP.has(file)) continue;
  let text;
  try {
    text = readFileSync(join(root, file), 'utf8');
  } catch {
    continue; // binary or unreadable
  }
  if (text.includes('\u0000')) continue;
  scanned++;
  const lines = text.split('\n');
  for (const hit of findSecrets(text)) {
    problems.push(`${file}:${hit.line}  ${hit.rule}\n      ${redact(lines[hit.line - 1])}`);
  }
}

/** A floor: zero files scanned would print a ✅ having read nothing. */
if (scanned < 50) {
  console.error(`❌ scanned only ${scanned} file(s). This scanner is broken, not the repo.`);
  process.exit(1);
}

if (problems.length) {
  console.error('\n🔴 A LIVE CREDENTIAL IS IN A TRACKED FILE\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\n  Committing this puts it in the history for good: `git rm` leaves the\n' +
      '  blob in every clone and every fetch, and GitHub serves it by SHA.\n' +
      '  ROTATE the credential rather than only deleting the line.\n\n' +
      '  Secrets belong in the environment. Their NAMES, with a comment saying\n' +
      '  where to get them, belong in backend/.env.example — see CLAUDE.md.\n',
  );
  process.exit(1);
}

console.log(
  `── Credentials in tracked files ────────────────────────────\n` +
    `  ✅ ${scanned} tracked text file(s); no database password, remote\n` +
    `     connection string or private key.\n` +
    `════════════════════════════════════════════════════════════`,
);
}
