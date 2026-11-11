#!/usr/bin/env node
/**
 * Do the migrations and `schema.prisma` describe the same database?
 *
 *   node scripts/migration-drift-check.mjs
 *
 * ⚠️ Needs a DISPOSABLE database. It creates a shadow database, replays every
 * migration into it, compares the result against the datamodel, and drops
 * it again. It never touches the database in DATABASE_URL, and it refuses to
 * run against a remote host at all — see `assertLocal` below.
 *
 * ── Why this exists
 *
 * `schema.prisma` and `prisma/migrations/` are two descriptions of one
 * database, and nothing compared them. They can disagree in both directions
 * and each has already hurt this project:
 *
 *   · A model edited without a migration. `prisma generate` happily builds a
 *     client for columns no database has. The symptom is P2022 in production
 *     — "The column `rooms.listerType` does not exist in the current
 *     database" — which is `docs/OUTSTANDING.md` §5 and an hour of downtime
 *     on 5 October.
 *   · A migration written by hand that the datamodel does not reflect. Then
 *     the client is right about the live database and wrong about a fresh
 *     one, so CI and a new developer's machine diverge from production.
 *
 * `scripts/migration-preflight.mjs` answers a different question — what a
 * pending migration would do to a database that already has people in it —
 * and `scripts/prisma-client-check.mjs` a third: whether the GENERATED client
 * is current. Neither compares the migrations to the schema. This does.
 *
 * ── The baseline, and why there is one
 *
 * There is exactly one known difference, it is explained below, and the check
 * fails on anything else. A gate that starts red is a gate somebody turns
 * off; a gate that accepts one NAMED difference and refuses every new one is
 * the pattern this repository already uses for emoji and for off-scale
 * spacing.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const SHADOW_DB = 'mastande_migration_drift_shadow';

/**
 * Nothing is expected. The gate demands zero differences.
 *
 * There was one, found on this check's first run:
 * `survey_responses.updatedAt` carried a database default the datamodel does
 * not declare, because the migration that added the column backfilled a NOT
 * NULL on a populated table and that requires a default. It was correct when
 * it was written and had nothing left to do afterwards, since Prisma sets
 * `@updatedAt` itself on every write.
 *
 * It was baselined here for one commit and then CLEARED, by
 * `20261111101138_survey_response_updatedat_drop_default` — a metadata-only
 * DROP DEFAULT that rewrites no rows. A gate that accepts one known
 * exception is one rewrite away from accepting two, so the exception was
 * removed rather than kept.
 *
 * ⚠️ If a future migration has to leave drift behind — and a NOT NULL
 * backfill on a populated table is the case that will — add it here WITH its
 * cause and its effect, the way that one was, rather than loosening the
 * comparison. The check also fails when a baselined difference disappears,
 * so a stale allowance cannot sit here unnoticed.
 */
const BASELINE = [];

const red   = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const grey  = (s) => `\x1b[90m${s}\x1b[0m`;

/**
 * 🔴 The guard that matters. This script CREATES AND DROPS a database, so it
 * must never be pointed at anything real. The check is on the resolved
 * connection string rather than on a flag somebody can forget, the same way
 * `backend/test/support/test-app.ts` and `scripts/migrate-remote.sh` do it.
 */
function assertLocal(url) {
  for (const marker of ['neon.tech', 'render.com', 'umastande', 'amazonaws']) {
    if (url.includes(marker)) {
      console.error(red(`Refusing to run against a remote host (${marker}).`));
      console.error('   This script creates and drops a shadow database.');
      process.exit(1);
    }
  }
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    console.error(red('Refusing: the admin URL does not point at localhost.'));
    process.exit(1);
  }
}

const base =
  process.env.DRIFT_ADMIN_URL ??
  'postgresql://rentboard:rentboard@localhost:5432/postgres';
assertLocal(base);

/**
 * ⚠️ SKIP, by name, when there is no database — and only then.
 *
 * This runs in the pre-commit hook as well as in CI, and the hook must not
 * fail on a machine with Postgres stopped: in this container it stops on its
 * own, repeatedly, which CLAUDE.md records and which happened four times
 * while this check was being written. But a skip that says nothing is how a
 * gate disappears, so it prints the reason and the command to re-run — and
 * it REFUSES to skip unless SKIP_IF_NO_DB is set, which only the hook sets.
 * CI runs the same script without it, so a runner with a broken database
 * fails there rather than passing quietly.
 */
try {
  execFileSync('psql', [base, '-tAc', 'select 1'], { stdio: ['ignore', 'pipe', 'pipe'] });
} catch {
  if (!process.env.SKIP_IF_NO_DB) {
    console.log('── Migrations vs schema.prisma ─────────────────────────────');
    console.error(red('  ❌ no database at the admin URL, and SKIP_IF_NO_DB is not set.'));
    console.error('     A failure rather than a skip: in CI the database is always');
    console.error('     there, so its absence means a broken runner, not a clean tree.');
    process.exit(1);
  }
  console.log('── Migrations vs schema.prisma ─────────────────────────────');
  console.log(grey('  ⏭  SKIPPED — no PostgreSQL at the admin URL.'));
  console.log(grey('     This replays every migration into a disposable database, so'));
  console.log(grey('     it needs one. Start it and re-run:'));
  console.log(grey('       sudo pg_ctlcluster 16 main restart'));
  console.log(grey('       node scripts/migration-drift-check.mjs'));
  console.log(grey('     It runs unskippably in CI, so this cannot hide drift.'));
  console.log('════════════════════════════════════════════════════════════');
  process.exit(0);
}

const shadowUrl = base.replace(/\/[^/?]+(\?|$)/, `/${SHADOW_DB}$1`);

const psql = (sql) =>
  execFileSync('psql', [base, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], {
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString().trim();

console.log('── Migrations vs schema.prisma ─────────────────────────────');

let created = false;
try {
  // Dropped first in case an earlier run died before its cleanup.
  psql(`DROP DATABASE IF EXISTS "${SHADOW_DB}"`);
  psql(`CREATE DATABASE "${SHADOW_DB}"`);
  created = true;

  let out = '';
  let code = 0;
  try {
    out = execFileSync(
      'npx',
      [
        'prisma', 'migrate', 'diff',
        '--from-migrations', './prisma/migrations',
        '--to-schema-datamodel', './prisma/schema.prisma',
        '--shadow-database-url', shadowUrl,
        '--exit-code',
      ],
      { cwd: 'backend', stdio: ['ignore', 'pipe', 'pipe'] },
    ).toString();
  } catch (err) {
    out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    code = err.status ?? 1;
  }

  // Prisma's exit codes: 0 no difference, 2 a difference, 1 an error. An
  // error must never read as "no drift", which is how a broken check passes.
  if (code === 1) {
    console.log(red('  ❌ the comparison itself failed — this is not a verdict'));
    console.log(out.trim().split('\n').map((l) => `     ${l}`).join('\n'));
    process.exit(1);
  }

  const differences = out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('[') || l.startsWith('[*]'));

  const unexpected = differences.filter((l) => !BASELINE.includes(l));
  const missing = BASELINE.filter((l) => !differences.includes(l));

  // Counted, not written down. The first version of this line said 39 and was
  // stale within the hour, when the migration that cleared the baseline landed.
  const migrationCount = readdirSync('backend/prisma/migrations')
    .filter((n) => n !== 'migration_lock.toml').length;
  console.log(grey(`  ${migrationCount} migration(s) replayed into a disposable database.`));

  if (unexpected.length) {
    console.log(red(`  ❌ ${unexpected.length} unexpected difference(s):`));
    for (const l of unexpected) console.log(red(`     ${l}`));
    console.log();
    console.log('     schema.prisma and prisma/migrations/ disagree. Either a');
    console.log('     model was edited without a migration — the client then');
    console.log('     describes columns no database has, which is P2022 in');
    console.log('     production and docs/OUTSTANDING.md §5 — or a migration');
    console.log('     was written that the datamodel does not reflect.');
    console.log();
    console.log('     Generate the missing migration with');
    console.log('       cd backend && npx prisma migrate dev --name <what-it-does>');
    console.log('     and never by editing an applied migration in place.');
    process.exit(1);
  }

  if (missing.length) {
    // The baseline describing something that is no longer true is also a
    // failure: a stale allowance is how a gate quietly stops gating.
    console.log(red('  ❌ a baselined difference is gone — update BASELINE:'));
    for (const l of missing) console.log(red(`     ${l}`));
    process.exit(1);
  }

  if (differences.length) {
    console.log(green('  ✅ no NEW drift.'));
    console.log(grey(`     ${differences.length} baselined difference(s), each explained in this file:`));
    for (const l of differences) console.log(grey(`       ${l}`));
    console.log(grey('     survey_responses.updatedAt — a NOT NULL backfill needed a'));
    console.log(grey('     database default; the datamodel wants none. Prisma is the'));
    console.log(grey('     only writer, so nothing reaches it. One-line migration to'));
    console.log(grey('     clear it, flagged rather than taken.'));
  } else {
    console.log(green('  ✅ the migrations and the datamodel describe the same database.'));
  }
  console.log('════════════════════════════════════════════════════════════');
} finally {
  if (created) {
    try {
      psql(`DROP DATABASE IF EXISTS "${SHADOW_DB}"`);
    } catch {
      console.log(grey(`  (could not drop ${SHADOW_DB} — drop it by hand)`));
    }
  }
}
