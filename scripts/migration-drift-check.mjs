#!/usr/bin/env node
/**
 * Do the migrations and `schema.prisma` describe the same database?
 *
 *   node scripts/migration-drift-check.mjs
 *
 * ⚠️ Needs a DISPOSABLE database. It creates a shadow database, replays all
 * 39 migrations into it, compares the result against the datamodel, and drops
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

const SHADOW_DB = 'mastande_migration_drift_shadow';

/**
 * The one difference that is expected, with its cause.
 *
 * `20261016090000_survey_per_user_and_version` adds `updatedAt` to
 * `survey_responses`, a table that already had rows. Adding a NOT NULL column
 * to a populated table REQUIRES a default or the ALTER fails, so the
 * migration says `NOT NULL DEFAULT CURRENT_TIMESTAMP`. `schema.prisma`
 * declares `updatedAt DateTime @updatedAt` with no `@default`, because Prisma
 * sets the value itself on every create and update.
 *
 * ⚠️ Effect: none. Prisma is the only writer — there is no raw INSERT into
 * `survey_responses` anywhere in `backend/src` or `scripts` — so the default
 * is never reached. It would only matter to a hand-written INSERT, which
 * would succeed against the migrated database and fail against one built
 * from the datamodel.
 *
 * The clean fix is a one-line migration, `ALTER TABLE "survey_responses"
 * ALTER COLUMN "updatedAt" DROP DEFAULT`, which changes no rows and takes no
 * table lock worth naming. It is NOT done here: adding a migration means the
 * next deploy runs it against production, and this repository's rule is that
 * migrations are deliberate. Flagged for a decision rather than taken.
 */
const BASELINE = [
  '[*] Changed the `survey_responses` table',
  '[*] Altered column `updatedAt` (default changed from `Some(Now)` to `None`)',
];

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

  console.log(grey(`  39 migration(s) replayed into a disposable database.`));

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
