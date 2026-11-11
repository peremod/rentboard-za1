#!/usr/bin/env node
/**
 * Does the riskiest migration in this repository keep the data it moves?
 *
 *   node scripts/migration-data-survival-check.mjs
 *
 * ⚠️ Needs a DISPOSABLE database. It creates one, migrates it in two stages
 * with rows in between, and drops it. It never touches DATABASE_URL and
 * refuses a remote host outright — see `assertLocal`.
 *
 * ── Why this one migration
 *
 * `20261016090000_survey_per_user_and_version` is the only migration here
 * that moves data rather than just reshaping columns: surveys go from "a
 * landlord profile answered" to "a user answered". It backfills `userId` from
 * `landlord_profiles`, backfills `role` from `users`, sets `completedAt`, and
 * only then tightens both columns to NOT NULL and DROPs
 * `landlordProfileId`. It is hand-written, and its own header says why:
 *
 *   "The generated script DROPs landlordProfileId and ADDs a NOT NULL userId
 *    in the same statement, which loses the link on every existing row and
 *    fails outright if any exist. This backfills first and only then tightens
 *    the column, so a database with answers in it keeps them."
 *
 *   "A row that cannot be mapped makes the SET NOT NULL fail, and that is
 *    deliberate: a migration that deletes answers it cannot place is worse
 *    than one that stops and says so."
 *
 * Two claims about real people's answers, and nothing had ever checked
 * either. The migration is already applied in production, so this is
 * retrospective — but it is the template the next data migration will be
 * written from, and if the backfill were wrong the answers would be gone
 * with nothing to say so.
 *
 * ── What it does
 *
 *   1. Applies every migration BEFORE the subject into a fresh database.
 *   2. Inserts a survey, a landlord with a profile, an answer and a
 *      dismissal, all in the OLD shape, keyed on landlordProfileId.
 *   3. Applies the rest.
 *   4. Asserts the answer survived and is now keyed on the right user, with
 *      the role and completedAt the migration promises to derive.
 *   5. Does it again with an UNMAPPABLE answer and asserts the migration
 *      FAILS rather than dropping it.
 *
 * Step 5 is the half that matters. Step 4 alone would pass against a
 * migration that silently deleted what it could not place.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUBJECT = '20261016090000_survey_per_user_and_version';
const DB = 'mastande_migration_survival';

const red   = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const grey  = (s) => `\x1b[90m${s}\x1b[0m`;

let fail = 0;
const ok  = (m) => console.log(green(`  ✅ ${m}`));
const bad = (m) => { console.log(red(`  ❌ ${m}`)); fail++; };

/** 🔴 The same refusal as test-app.ts and migrate-remote.sh: never a real database. */
function assertLocal(url) {
  for (const marker of ['neon.tech', 'render.com', 'umastande', 'amazonaws']) {
    if (url.includes(marker)) {
      console.error(red(`Refusing to run against a remote host (${marker}).`));
      process.exit(1);
    }
  }
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    console.error(red('Refusing: the admin URL does not point at localhost.'));
    process.exit(1);
  }
}

const admin =
  process.env.DRIFT_ADMIN_URL ??
  'postgresql://rentboard:rentboard@localhost:5432/postgres';
assertLocal(admin);
const dbUrl = admin.replace(/\/[^/?]+(\?|$)/, `/${DB}$1`);

const psqlAdmin = (sql) =>
  execFileSync('psql', [admin, '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
    { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const sql = (q) =>
  execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-tAc', q],
    { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

/**
 * A prisma directory holding only the migrations up to `upTo` (inclusive), so
 * `migrate deploy` can be stopped part-way through history.
 *
 * ⚠️ Copied rather than filtered in place. Deleting migrations from the real
 * `prisma/migrations` to stage a test is how a working tree loses a
 * migration, and this repository has already lost uncommitted work to a
 * careless restore.
 */
function stagePrisma(upTo) {
  const dir = mkdtempSync(join(tmpdir(), 'mig-survival-'));
  cpSync('backend/prisma', join(dir, 'prisma'), { recursive: true });
  const migDir = join(dir, 'prisma', 'migrations');
  for (const name of readdirSync(migDir)) {
    if (name === 'migration_lock.toml') continue;
    if (name > upTo) rmSync(join(migDir, name), { recursive: true, force: true });
  }
  return dir;
}

/**
 * ⚠️ The project's OWN prisma binary, by path, not `npx prisma`.
 *
 * The staged schema lives in a temp directory, so `npx` cannot resolve this
 * project's local prisma from there and downloads the newest one instead —
 * which on the first run was 8.0.0-rc.33, where `migrate deploy` has been
 * replaced by `db migrate`:
 *
 *   ✘ [CLI.COMMAND_MOVED] `migrate deploy` has been replaced
 *
 * So the whole check failed on a CLI version this project does not use. The
 * binary is pinned to backend/node_modules/.bin/prisma (6.19.3) and the
 * version is asserted below rather than assumed, because the next major will
 * do this again and the error should name the cause.
 */
const PRISMA = 'backend/node_modules/.bin/prisma';

function deploy(stageDir) {
  return execFileSync(PRISMA,
    ['migrate', 'deploy', '--schema', join(stageDir, 'prisma', 'schema.prisma')],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl } },
  ).toString();
}

/** Everything before the subject migration. */
const before = readdirSync('backend/prisma/migrations')
  .filter((n) => n !== 'migration_lock.toml' && n < SUBJECT)
  .sort()
  .pop();

console.log('── Does the survey migration keep the answers it moves? ────');

// Named rather than assumed: a CLI that has moved the command is a different
// failure from a migration that loses data, and must not read as one.
const prismaVersion = execFileSync(PRISMA, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
  .toString().match(/prisma\s*:\s*(\S+)/)?.[1] ?? 'unknown';
if (!prismaVersion.startsWith('6.')) {
  console.log(red(`  ❌ this check is written for the Prisma 6 CLI; found ${prismaVersion}.`));
  console.log('     `migrate deploy` moved to `db migrate` in Prisma 8. Update the');
  console.log('     command here rather than letting it read as a data loss.');
  process.exit(1);
}
console.log(grey(`  prisma CLI: ${prismaVersion} (project-local, not npx)`));
console.log(grey(`  subject: ${SUBJECT}`));
console.log(grey(`  staged at: ${before}`));

/** The old shape: an answer and a dismissal keyed on a landlord PROFILE. */
function seedOldShape({ mappable }) {
  /**
   * ⚠️ Only the columns that are NOT NULL with no default at THIS point in
   * history, read out of information_schema rather than guessed. The first
   * version of this seed invented a `landlord_profiles.createdAt` that does
   * not exist there and the whole check died on the INSERT.
   */
  sql(`INSERT INTO "users" ("id","email","fullName","role","updatedAt")
       VALUES ('u-1','keeper@test.invalid','Thandi Keeper','LANDLORD',now())`);
  sql(`INSERT INTO "landlord_profiles" ("id","userId") VALUES ('p-1','u-1')`);
  sql(`INSERT INTO "surveys" ("id","slug","title","questions","audience","active","updatedAt")
       VALUES ('s-1','landlord-pain-2026','What is hardest?','[]'::jsonb,'{}'::jsonb,true,now())`);
  // The answer whose survival is the whole question. Distinctive free text,
  // so "it survived" cannot be confused with "a row exists".
  sql(`INSERT INTO "survey_responses" ("id","surveyId","landlordProfileId","source","answers","createdAt")
       VALUES ('r-1','s-1',${mappable ? `'p-1'` : `'p-does-not-exist'`},'dashboard',
               '{"q5_scammed":{"choice":"Yes","text":"He vanished with my gate key"}}'::jsonb,
               '2026-10-01T08:00:00Z')`);
  sql(`INSERT INTO "survey_dismissals" ("id","surveyId","landlordProfileId","dismissedAt")
       VALUES ('d-1','s-1','p-1',now())`);
}

function freshDb() {
  psqlAdmin(`DROP DATABASE IF EXISTS "${DB}"`);
  psqlAdmin(`CREATE DATABASE "${DB}"`);
}

let stages = [];
try {
  // ── 1. The mappable row survives ──────────────────────────────────────
  freshDb();
  const upToBefore = stagePrisma(before);
  stages.push(upToBefore);
  deploy(upToBefore);
  ok(`every migration up to ${before} applied to an empty database`);

  seedOldShape({ mappable: true });
  ok('an answer and a dismissal seeded in the OLD shape, keyed on the profile');

  const full = stagePrisma('99999999');
  stages.push(full);

  /**
   * ⚠️ Caught, not allowed to throw.
   *
   * Both falsification runs crashed here with a stack trace instead of
   * naming a failure: the deploy throws, nothing catches it, and the output
   * says only that two steps passed. A check that dies is not a false pass,
   * but it tells whoever reads it nothing about what broke — which is the
   * defect this repository keeps finding in its own tooling. The mutation
   * that removes the backfill now says so in one line.
   */
  let applied = true;
  let applyError = '';
  try {
    deploy(full);
    ok('the remaining migrations applied with those rows in place');
  } catch (err) {
    applied = false;
    applyError = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    bad('the migration CANNOT be applied to a database that has answers in it');
    console.log(red('     This is the failure the migration was hand-written to avoid:'));
    console.log(red('     tightening userId to NOT NULL before anything backfills it.'));
    for (const line of applyError.trim().split('\n').slice(-4)) {
      console.log(red(`     ${line}`));
    }
  }

  // Guarded: with the deploy failed, the columns below do not exist and every
  // assertion would die on its own SQL rather than report anything useful.
  if (applied) {
  const kept = sql(`SELECT count(*) FROM "survey_responses" WHERE "id" = 'r-1'`);
  kept === '1'
    ? ok('the answer is still there')
    : bad(`the answer was lost: ${kept} row(s) with id r-1`);

  const text = sql(`SELECT "answers"->'q5_scammed'->>'text' FROM "survey_responses" WHERE "id" = 'r-1'`);
  text === 'He vanished with my gate key'
    ? ok('with its free text intact — what a person actually wrote')
    : bad(`the free text changed: ${JSON.stringify(text)}`);

  const userId = sql(`SELECT "userId" FROM "survey_responses" WHERE "id" = 'r-1'`);
  userId === 'u-1'
    ? ok('and re-keyed onto the USER the profile belonged to')
    : bad(`userId is ${JSON.stringify(userId)}, expected u-1`);

  const role = sql(`SELECT "role" FROM "survey_responses" WHERE "id" = 'r-1'`);
  role === 'LANDLORD'
    ? ok('carrying the role answered as, derived from the user')
    : bad(`role is ${JSON.stringify(role)}, expected LANDLORD`);

  // The migration's choice: everything that existed was submitted whole, so
  // it counts as complete, dated from when it was answered.
  const completed = sql(`SELECT "completedAt" = "createdAt" FROM "survey_responses" WHERE "id" = 'r-1'`);
  completed === 't'
    ? ok('and marked complete as of when it was answered, not when it migrated')
    : bad(`completedAt does not equal createdAt (${completed})`);

  const gone = sql(`SELECT count(*) FROM information_schema.columns
                     WHERE table_name = 'survey_responses' AND column_name = 'landlordProfileId'`);
  gone === '0'
    ? ok('the old column is gone, so nothing can write to it again')
    : bad('landlordProfileId still exists after the migration');

  const dismissal = sql(`SELECT "userId" FROM "survey_dismissals" WHERE "id" = 'd-1'`);
  dismissal === 'u-1'
    ? ok('the dismissal moved too — a "not now" is still honoured after the migration')
    : bad(`dismissal userId is ${JSON.stringify(dismissal)}`);

  const version = sql(`SELECT "version" FROM "surveys" WHERE "id" = 's-1'`);
  version === '1'
    ? ok('and the existing survey became edition 1 rather than edition nothing')
    : bad(`surveys.version is ${JSON.stringify(version)}`);
  }

  // ── 2. The unmappable row stops the migration ─────────────────────────
  //
  // 🔴 The half that matters. Everything above would pass against a
  // migration that quietly DELETED what it could not place.
  freshDb();
  const again = stagePrisma(before);
  stages.push(again);
  deploy(again);
  seedOldShape({ mappable: false });

  let refused = false;
  let message = '';
  try {
    deploy(full);
  } catch (err) {
    refused = true;
    message = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }

  if (refused) {
    ok('an answer that cannot be mapped STOPS the migration');
    /[Nn]ot[- ]null|null value|violates/.test(message)
      ? ok('and says so as a not-null violation, naming the column')
      : bad(`it failed for some other reason:\n${message.trim().split('\n').slice(-6).join('\n')}`);
    const survived = sql(`SELECT count(*) FROM "survey_responses" WHERE "id" = 'r-1'`);
    survived === '1'
      ? ok('the answer is still in the database, unplaced rather than deleted')
      : bad(`the unmappable answer was destroyed: ${survived} row(s)`);
  } else {
    bad('the migration APPLIED with an unmappable answer — check what happened to it');
    const survived = sql(`SELECT count(*) FROM "survey_responses" WHERE "id" = 'r-1'`);
    bad(`rows with id r-1 after it: ${survived}`);
  }
} finally {
  for (const d of stages) rmSync(d, { recursive: true, force: true });
  try { psqlAdmin(`DROP DATABASE IF EXISTS "${DB}"`); }
  catch { console.log(grey(`  (could not drop ${DB} — drop it by hand)`)); }
}

console.log('════════════════════════════════════════════════════════════');
console.log(fail
  ? red(`  ${fail} failure(s)`)
  : green('  the migration moves the answers and refuses to lose one.'));
process.exit(fail ? 1 : 0);
