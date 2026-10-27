#!/usr/bin/env node
/**
 * Read a row, decide from its state, then write it — with nothing holding the
 * row still in between.
 *
 * That is the shape that let one room be accepted twice (§93). `accept()` read
 * an application, checked its status, wrote, and the thing that actually
 * protected the room ran afterwards. Sequentially it was correct; two requests
 * that did not wait for each other made two tenancies on one room, and 527
 * smoke assertions held throughout.
 *
 * §93f closed saying the PATTERN was not searched for — it was found by
 * suspecting one method. This searches for it.
 *
 * ── What it looks for
 *
 * Inside one method body:
 *   1. a read of a single row     (findUnique / findFirst / …OrThrow, or a
 *      private helper whose name begins assert/get/require and returns one)
 *   2. a refusal that depends on that row's state  (if (… status …) throw,
 *      or `return` — see below)
 *   3. a write to the SAME model  (.update( / .delete( )
 * …with no `$transaction` around it and no conditional write (`updateMany`
 * carrying the old state in its `where`).
 *
 * ── ⚠️ What it CANNOT know
 *
 * Whether the race matters. Some rows only one person can touch; some writes
 * are idempotent; some checks are advisory and the database has a unique index
 * doing the real work. So this does not fail on what it finds — it fails on
 * what is NEW, against a baseline, the way token-lint and scale-lint do. Every
 * baselined entry is a judgement somebody made once, and the file is where the
 * reasoning lives.
 *
 *   node scripts/check-then-write-lint.mjs
 *   node scripts/check-then-write-lint.mjs --write   # ratchet the baseline
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const BASELINE = join(ROOT, 'scripts/.check-then-write-baseline.json');

const files = execSync("git ls-files 'backend/src/**/*.service.ts'", { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);

/** Split a file into top-level method bodies, crudely but predictably. */
function methods(src) {
  const out = [];
  const re = /^\s{2}(?:private\s+|public\s+|protected\s+)?async\s+([A-Za-z0-9_]+)\s*\(/gm;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index;
    let i = src.indexOf('{', re.lastIndex);
    if (i < 0) continue;
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    out.push({ name: m[1], body: src.slice(start, i + 1), line: src.slice(0, start).split('\n').length });
  }
  return out;
}

const READ = /\.(findUnique|findFirst|findUniqueOrThrow|findFirstOrThrow)\s*\(/;
const HELPER_READ = /\b(?:this\.)?(assert[A-Z]\w*|get[A-Z]\w*|require[A-Z]\w*)\s*\(/;
/**
 * A refusal, which is NOT always a throw.
 *
 * ⚠️ This read `throw\s+new` only, and that blind spot hid a real one:
 * `referrals.consumeFreeVerification` refuses with `if (!reward) return false`
 * and then writes — a single-use credit worth R149, spendable twice by two
 * concurrent callers. §99 found it by reading the module, not by running this.
 *
 * ⚠️ The column list below is the same mistake `GUARDED` already carries a
 * comment about, and it is still here on purpose. Dropping it takes this lint
 * from 9 matches to **32** — measured — and 23 unexamined entries in a
 * baseline is precisely the queue §96 spent a release clearing. A baseline
 * whose entries claim to have been considered when they have not is this
 * codebase's own recurring defect wearing a JSON file. So the list stays until
 * somebody has the appetite to judge 32, and this comment is the record that
 * it is a known limit rather than a complete search.
 */
const STATE_THROW = /if\s*\([^)]*\b(status|state|archivedAt|deletedAt|decidedAt|readAt|outcome|rewardUsedAt|usedAt|revokedAt)\b[^)]*\)[\s\S]{0,160}?(throw\s+new|return\b)/;
const WRITE = /\.(update|delete)\s*\(/;
/**
 * What counts as already guarded.
 *
 * ⚠️ The first version listed the state COLUMNS it knew about
 * (status|state|readAt|outcome), and so went on reporting `auth.refresh` after
 * it had been fixed — that claim keys on `revokedAt`, which was not in the
 * list. A detector that only recognises the fixes it has seen before will keep
 * naming repaired code and, worse, teaches the reader to ignore it.
 *
 * So: a conditional write is an `updateMany`/`deleteMany` whose `where`
 * carries something BESIDES the id. `where: { id }` is unconditional;
 * `where: { id, anything: ... }` is a compare-and-swap, whatever the column is
 * called.
 */
const GUARDED = /\$transaction\s*\(|\.(updateMany|deleteMany)\s*\(\s*\{\s*where:\s*\{[^}]*,[^}]*\}/;

/**
 * RULE 2 — the check is in the QUERY, not in an `if`.
 *
 * ⚠️ Added because rule 1 structurally could not see the shape that matters
 * most for a single-use credential:
 *
 *     findFirst({ where: { …, usedAt: null } })   // the check IS the query
 *     update({ where: { id } })                   // unconditional write
 *
 * There is no `if` refusing on state, so no amount of widening rule 1's
 * refusal clause reaches it — measured: the `return`-as-refusal widening took
 * rule 1 from 5 matches to 9 and did NOT include either of the two below.
 *
 * It is deliberately narrow — a read whose `where` names a spent-marker
 * column, then a write to that row by id — and it matches exactly two
 * methods, both of them "consume a single-use thing":
 * `referrals.consumeFreeVerification` (an R149 credit) and
 * `phone-otp.consumeStepUp` (the step-up code that guards setting a first
 * password and changing an email address on a passwordless account). Both are
 * fixed; both would have been found by this on the day they were written.
 */
const STATEFUL_READ = /\.(findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow)\s*\(\s*\{\s*where:\s*\{[^}]*\b(usedAt|rewardUsedAt|consumedAt|redeemedAt|revokedAt|spentAt)\b[^}]*\}/;
const WRITE_BY_ID = /\.(update|delete)\s*\(\s*\{\s*where:\s*\{\s*id[^,}]*\}/;

const findings = [];
for (const rel of files) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  for (const m of methods(src)) {
    if (GUARDED.test(m.body)) continue;

    // Rule 1: a read, an `if` that refuses on the row's state, then a write.
    const reads = READ.test(m.body) || HELPER_READ.test(m.body);
    const rule1 = reads && STATE_THROW.test(m.body) && WRITE.test(m.body);

    // Rule 2: the state check sits in the read's own `where`.
    const rule2 = STATEFUL_READ.test(m.body) && WRITE_BY_ID.test(m.body);

    if (!rule1 && !rule2) continue;
    findings.push({ id: `${rel}:${m.name}`, rel, method: m.name, line: m.line });
  }
}

const baseline = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf8'))
  : { note: '', accepted: {} };

if (process.argv.includes('--write')) {
  const accepted = { ...baseline.accepted };
  for (const f of findings) if (!accepted[f.id]) accepted[f.id] = 'TODO: why this race is survivable, or fix it';
  writeFileSync(BASELINE, JSON.stringify({ ...baseline, accepted }, null, 2) + '\n');
  console.log(`baseline written: ${Object.keys(accepted).length} entr(y/ies).`);
  process.exit(0);
}

console.log('\n── Read, check, then write ─────────────────────────────────');
console.log(`  ${files.length} service file(s); ${findings.length} method(s) match the shape.`);

const fresh = findings.filter((f) => !baseline.accepted[f.id]);
for (const f of findings) {
  const why = baseline.accepted[f.id];
  console.log(`  ${why ? '·' : '❌'} ${f.rel}:${f.line}  ${f.method}()`);
  if (why) console.log(`       ${why}`);
}

const untriaged = findings.filter((f) => baseline.accepted[f.id] === 'untriaged');

if (!fresh.length) {
  console.log(`\n  ✅ no NEW read-check-write.`);
  /**
   * ⚠️ Said out loud on every run, because a baseline that goes quiet is a
   * list of things nobody will ever look at again. These matched the shape and
   * NOBODY HAS JUDGED THEM. That is not the same as "considered and accepted",
   * and the file must not be allowed to blur the two.
   */
  if (untriaged.length) {
    console.log(`  ⚠️  ${untriaged.length} of ${findings.length} carried entr(y/ies) are UNTRIAGED —`);
    console.log('     they matched the shape and nobody has worked out yet what two');
    console.log('     concurrent callers would leave behind. Not a pass; a queue.');
  }
  console.log('════════════════════════════════════════════════════════════\n');
  process.exit(0);
}

console.log(`\n  ${fresh.length} NEW method(s) read a row, decide from its state, then write it`);
console.log('  with nothing holding the row still in between. That is §93: two');
console.log('  requests that do not wait for each other both pass the check.');
console.log('  Make the write conditional (updateMany carrying the old state in');
console.log('  its where, inside a transaction), or record why the race is');
console.log('  survivable with --write.');
console.log('════════════════════════════════════════════════════════════\n');
process.exit(1);
