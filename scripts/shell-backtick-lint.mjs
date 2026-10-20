#!/usr/bin/env node
/**
 * A backtick inside a double-quoted shell string is COMMAND SUBSTITUTION.
 *
 * ── The measured cost
 *
 * Written on 20 October, immediately after this line was added to
 * scripts/migrate-remote.sh — the script whose whole job is to migrate a
 * remote database:
 *
 *   echo "   `prisma migrate deploy` migrates the DIRECT one. Every line this"
 *
 * The backticks were meant as prose quoting, the way every comment in this
 * repository uses them. In a double-quoted bash string they run the command.
 * That line sits on the refusal path whose next sentence is "Nothing has been
 * written" — so the error that exists to stop a migration would have
 * performed one, against whichever database was exported at the time.
 *
 * `bash -n` accepts it: it is valid shell, and that is the problem. The same
 * blindness as the JSDoc block in a workflow run step (scripts/workflow-lint.mjs)
 * and the same root habit as the backtick inside an Angular inline template
 * literal (scripts/template-literal-lint.mjs), which has now cost this
 * repository thirteen compile failures. Three languages, one reflex.
 *
 * ── Why this is a lexer and not a regex
 *
 * Because three of the four backticks already in this repository's shell
 * scripts are legitimate, and a pattern match flags all of them:
 *
 *   · push-release-tags.sh  \` — escaped inside a double-quoted string
 *   · test-imagekit.sh       ` — inside a SINGLE-quoted printf format
 *   · verify-build.sh        ` — a JS template literal inside node -e '…'
 *
 * A gate that cries wolf on correct code gets switched off, so this tracks
 * quoting state properly and reports only the case that actually substitutes.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function tracked() {
  const out = execFileSync('git', ['ls-files', '*.sh', '.husky/*'], {
    cwd: root,
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

/**
 * Returns the 1-based line numbers holding an unescaped backtick while inside
 * a double-quoted string.
 *
 * Deliberately does not flag a backtick in UNQUOTED position. That is also
 * command substitution, but it is the old, intentional spelling of it; this
 * repository uses $( ) throughout and has none, and the defect being caught
 * here is prose quoting that turns into execution.
 */
export function findDoubleQuotedBackticks(src) {
  const hits = [];
  let line = 1;
  let state = 'NONE'; // NONE | SINGLE | DOUBLE | HEREDOC
  let heredocDelim = null;
  let heredocExpands = false;
  let pendingHeredoc = null;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (c === '\n') {
      line++;
      if (state === 'HEREDOC') {
        // A heredoc ends on a line that is exactly the delimiter.
        let end = src.indexOf('\n', i + 1);
        if (end === -1) end = src.length;
        if (src.slice(i + 1, end).trim() === heredocDelim) {
          state = 'NONE';
          heredocDelim = null;
        }
      } else if (pendingHeredoc) {
        state = 'HEREDOC';
        heredocDelim = pendingHeredoc.delim;
        heredocExpands = pendingHeredoc.expands;
        pendingHeredoc = null;
      }
      continue;
    }

    /**
     * ⚠️ A heredoc is only inert if its delimiter was QUOTED. `cat <<'EOF'`
     * passes its body through untouched; `cat <<EOF` expands it, backticks
     * included, exactly like a double-quoted string. Treating both as safe
     * would have left this gate with a hole in the shape of the defect it
     * exists to catch.
     */
    if (state === 'HEREDOC') {
      if (!heredocExpands) continue;
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === '`') hits.push(line);
      continue;
    }

    if (state === 'SINGLE') {
      if (c === "'") state = 'NONE';
      continue;
    }

    if (state === 'DOUBLE') {
      if (c === '\\') {
        i++; // Escaped: \" and \` are literal.
        continue;
      }
      if (c === '"') state = 'NONE';
      else if (c === '`') hits.push(line);
      continue;
    }

    // NONE
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '#' && (i === 0 || /[\s;|&(]/.test(src[i - 1]))) {
      while (i < src.length && src[i] !== '\n') i++;
      i--; // Let the newline be handled above, so `line` stays correct.
      continue;
    }
    if (c === "'") state = 'SINGLE';
    else if (c === '"') state = 'DOUBLE';
    else if (c === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
      const m = /^<<-?\s*(['"]?)([A-Za-z_][\w]*)\1/.exec(src.slice(i));
      if (m) {
        pendingHeredoc = { delim: m[2], expands: m[1] === '' };
        i += m[0].length - 1;
      }
    }
  }
  return hits;
}

/**
 * Everything below runs only when this file is EXECUTED. Importing it (the
 * falsification harness does) must not scan or exit — a linter whose module
 * body has side effects cannot be tested without running it for real.
 */
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}

function main() {
const files = tracked();
const problems = [];
let scanned = 0;

for (const file of files) {
  let src;
  try {
    src = readFileSync(join(root, file), 'utf8');
  } catch {
    continue;
  }
  scanned++;
  // One report per line: a line with two backticks has one defect, not two.
  for (const line of [...new Set(findDoubleQuotedBackticks(src))]) {
    problems.push(`${file}:${line}  backtick inside a double-quoted string — bash RUNS this`);
  }
}

/**
 * A floor on the walk. Zero files scanned would print a ✅ having read
 * nothing, which is the failure mode these gates keep being written to stop.
 */
if (scanned < 5) {
  console.error(`❌ scanned only ${scanned} shell file(s). This linter is broken, not the repo.`);
  process.exit(1);
}

if (problems.length) {
  console.error('\n── Backticks in shell strings ──────────────────────────────\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\n  In a double-quoted bash string, `x` executes x. For prose, drop the\n' +
      "  backticks or escape them as \\`. `bash -n` accepts this, so nothing\n" +
      '  else will tell you.\n',
  );
  process.exit(1);
}

console.log(
  `── Backticks in shell strings ──────────────────────────────\n` +
    `  ✅ ${scanned} shell file(s); no backtick sits in a double-quoted string\n` +
    `     or an unquoted heredoc.\n` +
    `════════════════════════════════════════════════════════════`,
);
}
