/**
 * What a pending migration would do to a database that already has people in it.
 *
 *   DATABASE_URL='postgresql://…' node scripts/migration-preflight.mjs
 *
 * ⚠️ READ ONLY. Every statement here is a SELECT. It changes nothing, creates
 * nothing and drops nothing, so it is safe to point at production — which is
 * the only database where the answer matters.
 *
 * ── Why this exists
 *
 * Production answered every request with
 *
 *   P2022: The column `rooms.listerType` does not exist in the current database
 *
 * which is deployed code meeting a database that was never migrated to match
 * it. The repair is `prisma migrate deploy`, and running fifteen migrations
 * against a live database is the moment to find out IN ADVANCE whether any of
 * them will fail halfway and leave it half-migrated — because the second half
 * of a failed migration run is a worse place to be than where it started.
 *
 * Two kinds of finding:
 *
 *   · A migration that CANNOT APPLY because existing rows violate a constraint
 *     it adds. This is the one that halts a run partway.
 *   · A migration that WILL APPLY and change live data on purpose. Not a
 *     failure, but somebody should know before it happens rather than after.
 */
import { execSync } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

const URL = process.env.DATABASE_URL;
if (!URL) {
  console.error('Set DATABASE_URL to the database you are about to migrate.');
  console.error("  DATABASE_URL='postgresql://…' node scripts/migration-preflight.mjs");
  process.exit(2);
}

const MIGRATIONS_DIR = join(process.cwd(), 'backend', 'prisma', 'migrations');
if (!existsSync(MIGRATIONS_DIR)) {
  console.error(`No migrations directory at ${MIGRATIONS_DIR}. Run this from the repository root.`);
  process.exit(2);
}

let problems = 0;
let warnings = 0;
const bad = (m) => { console.log('  ❌ ' + m); problems++; };
const warn = (m) => { console.log('  ⚠️  ' + m); warnings++; };
const ok = (m) => console.log('  ✅ ' + m);

/**
 * Prisma's connection string is not libpq's.
 *
 * ⚠️ `?schema=public` is a Prisma-only parameter and psql rejects the whole URI
 * over it: `invalid URI query parameter: "schema"`. Since that is the form in
 * `backend/.env`, this script could not reach development or staging AT ALL —
 * it only ever worked against production, whose Neon URL happens to carry
 * `sslmode` and `channel_binding`, which libpq does understand. A preflight
 * that runs on exactly one of the three environments cannot be rehearsed
 * anywhere before it is trusted on the one that matters.
 *
 * So: keep the parameters libpq knows, carry `schema` across as a search_path
 * instead, and SAY which ones were dropped rather than dropping them quietly.
 */
const LIBPQ_PARAMS = new Set([
  'application_name', 'channel_binding', 'client_encoding', 'connect_timeout',
  'fallback_application_name', 'gssencmode', 'hostaddr', 'keepalives',
  'keepalives_count', 'keepalives_idle', 'keepalives_interval', 'krbsrvname',
  'load_balance_hosts', 'options', 'passfile', 'replication', 'require_auth',
  'requirepeer', 'service', 'ssl_max_protocol_version',
  'ssl_min_protocol_version', 'sslcert', 'sslcompression', 'sslcrl',
  'sslcrldir', 'sslkey', 'sslmode', 'sslnegotiation', 'sslpassword',
  'sslrootcert', 'sslsni', 'target_session_attrs', 'tcp_user_timeout',
]);

function splitConn(raw) {
  let parsed;
  try {
    parsed = new globalThis.URL(raw);
  } catch {
    return { psqlUrl: raw, schema: '', dropped: [], host: 'unparseable' };
  }
  const keep = new globalThis.URLSearchParams();
  const lost = [];
  let found = '';
  for (const [k, v] of parsed.searchParams) {
    if (LIBPQ_PARAMS.has(k)) keep.append(k, v);
    else if (k === 'schema') found = v;
    else lost.push(k);
  }
  const host = `${parsed.host}${parsed.pathname}`;
  parsed.search = keep.toString();
  return { psqlUrl: parsed.toString(), schema: found, dropped: lost, host };
}

const { psqlUrl, schema, dropped } = splitConn(URL);

/** One line of SQL per call, as the repo's own notes insist. */
function qOn(conn, sql) {
  try {
    return execSync(`psql "${conn.psqlUrl}" -tAc ${JSON.stringify(sql)}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: conn.schema && conn.schema !== 'public'
        ? { ...process.env, PGOPTIONS: `-c search_path=${conn.schema}` }
        : process.env,
    }).trim();
  } catch (e) {
    return { error: String(e.stderr ?? e.message ?? e).trim() };
  }
}

const primary = { psqlUrl, schema };
const q = (sql) => qOn(primary, sql);

console.log('\n═══ Migration preflight — READ ONLY ═══');
console.log(`  Target: ${URL.replace(/:\/\/[^@]*@/, '://***@')}`);
if (schema) console.log(`  Schema: ${schema}`);
if (dropped.length) {
  console.log(`  Note:   ignored Prisma-only parameter(s) psql rejects: ${dropped.join(', ')}`);
}

// ── Can we even reach it ────────────────────────────────────────────────
const alive = q('SELECT 1');
if (typeof alive === 'object') {
  console.log(`\n  ❌ Cannot reach that database:\n     ${alive.error.split('\n')[0]}`);
  process.exit(1);
}

// ── 0. The connection migrate deploy will ACTUALLY use ──────────────────
//
// ⚠️ This section exists because the script did not have it, and production
// stayed down for it.
//
// `backend/prisma/schema.prisma` declares BOTH:
//
//     url       = env("DATABASE_URL")
//     directUrl = env("DIRECT_URL")
//
// and `prisma migrate` connects through `directUrl`, not `url`. So a preflight
// that reads only DATABASE_URL inspects a database the migration may never
// touch. On the real incident the operator passed the production DATABASE_URL
// to this script, which reported 15 pending migrations on production — then ran
// `migrate deploy`, which took DIRECT_URL from `backend/.env` and applied twelve
// migrations to `localhost:5432/rentboard_dev`. It printed "All migrations have
// been successfully applied." Production never moved, and the P2022 the script
// had just named by column was still in the logs afterwards.
//
// Nothing in the output contradicted that. Both commands succeeded. That is the
// shape of failure this repository keeps producing: a check that passes on one
// thing while the action lands on another.
console.log('\n── 0. The connection `migrate deploy` would use ─────────────');

const envFile = join(process.cwd(), 'backend', '.env');
const envFallback = (() => {
  if (!existsSync(envFile)) return '';
  const line = execSync(`grep -m1 '^DIRECT_URL=' ${JSON.stringify(envFile)} || true`, {
    encoding: 'utf8',
  }).trim();
  const raw = line.replace(/^DIRECT_URL=/, '').replace(/^["']|["']$/g, '');
  return raw ? splitConn(raw).host : '';
})();

const directRaw = process.env.DIRECT_URL;
if (!directRaw) {
  bad('DIRECT_URL is not set in this shell, so this preflight cannot vouch for the run.');
  console.log('     prisma/schema.prisma migrates through directUrl = env("DIRECT_URL").');
  console.log('     With it unset, `prisma migrate deploy` falls back to backend/.env and');
  console.log(
    envFallback
      ? `     would migrate:  ${envFallback}`
      : '     would migrate whatever that file points at',
  );
  console.log(`     ...not:         ${splitConn(URL).host}`);
  console.log('     Export BOTH variables (see the bottom of this report) and run again,');
  console.log('     and migrate through `scripts/migrate-remote.sh`, which refuses to run');
  console.log('     at all in this state instead of succeeding against the wrong database.');
} else {
  const direct = splitConn(directRaw);
  const theirs = qOn(direct, 'SELECT current_database()');
  const ours = q('SELECT current_database()');
  if (typeof theirs === 'object') {
    bad(`DIRECT_URL is set but unreachable: ${theirs.error.split('\n')[0]}`);
  } else if (theirs !== ours) {
    bad(`DATABASE_URL and DIRECT_URL point at DIFFERENT databases — "${ours}" vs "${theirs}".`);
    console.log('     `migrate deploy` would apply to the second one. Everything below');
    console.log('     describes the first. Fix the pair before running anything.');
  } else {
    const a = q('SELECT count(*) FROM _prisma_migrations');
    const b = qOn(direct, 'SELECT count(*) FROM _prisma_migrations');
    if (a !== b) {
      bad(`Same database name "${ours}" but different migration history (${a} rows vs ${b}).`);
      console.log('     These are two different databases that happen to share a name.');
    } else {
      ok(`DIRECT_URL reaches the same database — ${direct.host}`);
      console.log(`     (queries below run over DATABASE_URL — ${splitConn(URL).host})`);
    }
  }
}

// ── 1. How far behind is it ─────────────────────────────────────────────
console.log('\n── 1. Which migrations are missing ─────────────────────────');

const onDisk = readdirSync(MIGRATIONS_DIR)
  .filter((d) => /^\d/.test(d) && existsSync(join(MIGRATIONS_DIR, d, 'migration.sql')))
  .sort();

const hasTable = q("SELECT to_regclass('public._prisma_migrations') IS NOT NULL");
if (hasTable !== 't') {
  bad('There is no _prisma_migrations table — Prisma has never migrated this database.');
  console.log('     Every migration below would be applied from scratch. Check you are pointed at the right database.');
}

const appliedRaw = hasTable === 't'
  ? q(`SELECT string_agg(migration_name, ',' ORDER BY migration_name) FROM _prisma_migrations WHERE finished_at IS NOT NULL`)
  : '';
const applied = new Set(String(appliedRaw || '').split(',').filter(Boolean));
const pending = onDisk.filter((m) => !applied.has(m));

/**
 * A migration started and never finished is the half-applied state this script
 * exists to avoid creating.
 *
 * ⚠️ `rolled_back_at IS NULL` matters, and leaving it out made this script cry
 * wolf on a perfectly healthy database. Prisma does not update the failed row
 * when you resolve a migration — it writes a SECOND one. So a migration that
 * failed, was rolled back and then applied cleanly leaves two rows, the first
 * with `finished_at` null forever. Flagging that as "unfinished" tells somebody
 * to stop a migration that is fine.
 *
 * On a script whose whole job is to be believed before touching production, a
 * false alarm is worse than no check at all: either they halt a good run, or
 * they learn to skim past it and miss a real one.
 */
const unfinished = hasTable === 't'
  ? q(`SELECT string_agg(migration_name, ',') FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`)
  : '';
if (unfinished && typeof unfinished === 'string' && unfinished.length) {
  bad(`A previous run left these UNFINISHED: ${unfinished}`);
  console.log('     Resolve that before applying anything else (prisma migrate resolve).');
}

/**
 * ⚠️ `applied.size` is NOT "how many of the repository's migrations are applied".
 *
 * `_prisma_migrations` holds a row per migration RUN, and a name in it need not
 * exist on disk at all — a migration renamed or squashed in the repository
 * leaves a row matching nothing. Printing that raw count beside the pending
 * count produced a line that did not add up on the real production database
 * (34 in the repository, 29 applied, 15 pending — 44 of 34), which is how this
 * was found. The three numbers now reconcile by construction.
 */
const appliedFromRepo = onDisk.filter((m) => applied.has(m));
const dbOnly = [...applied].filter((m) => !onDisk.includes(m)).sort();

console.log(
  `  ${onDisk.length} migrations in the repository: ` +
    `${appliedFromRepo.length} applied, ${pending.length} pending.`,
);
if (dbOnly.length) {
  warn(
    `${dbOnly.length} migration(s) are recorded as applied but do NOT exist in this ` +
      `checkout.`,
  );
  dbOnly.forEach((m) => console.log(`       ${m}`));
  console.log('     They were renamed, squashed or applied from another branch. `migrate');
  console.log('     deploy` ignores them and applies only the pending list above, but');
  console.log('     `migrate status` will exit non-zero because of them — that is expected');
  console.log('     here and is not a reason to stop. Confirm the names look like history');
  console.log('     you recognise rather than a different project before you proceed.');
}
if (!pending.length) {
  ok('Nothing to apply — this database is up to date with the repository.');
} else {
  console.log('\n  Pending, in the order they would run:');
  pending.forEach((m, i) => console.log(`    ${String(i + 1).padStart(2)}. ${m}`));
}

// ── 2. Would anything FAIL ──────────────────────────────────────────────
//
// Only the checks whose migration is actually pending. A warning about a
// constraint that is already in place is noise, and noise is how a real one
// gets skimmed past.
console.log('\n── 2. Anything that would make the run fail ────────────────');

const pendingHas = (needle) => pending.some((m) => m.includes(needle));
let checked = 0;

if (pendingHas('phone_login_identity')) {
  checked++;
  // The partial unique index is the one real risk in the whole set: this column
  // has never been unique, so duplicates can already exist.
  const dupes = q(`SELECT count(*) FROM (SELECT phone FROM users WHERE "phoneVerified" = true AND phone IS NOT NULL GROUP BY phone HAVING count(*) > 1) d`);
  if (typeof dupes === 'object') {
    warn(`Could not check for duplicate verified numbers: ${dupes.error.split('\n')[0]}`);
  } else if (Number(dupes) > 0) {
    bad(`${dupes} mobile number(s) are verified on MORE THAN ONE account.`);
    console.log('     "users_phone_verified_key" is a UNIQUE index and will fail on them,');
    console.log('     stopping the run partway. Find them with:');
    console.log('       SELECT phone, count(*) FROM users WHERE "phoneVerified" = true');
    console.log('        GROUP BY phone HAVING count(*) > 1;');
    console.log('     Decide which account keeps each number, then set "phoneVerified" = false on the others.');
  } else {
    ok('No mobile number is verified on two accounts — the unique index will apply.');
  }

  // The email-or-phone CHECK is NOT VALID, so it does not test existing rows.
  // Worth reporting anyway: those accounts cannot sign in by either route.
  const stranded = q(`SELECT count(*) FROM users WHERE email IS NULL AND phone IS NULL`);
  if (typeof stranded !== 'object' && Number(stranded) > 0) {
    warn(`${stranded} account(s) have neither an email address nor a phone number.`);
    console.log('     The new constraint is NOT VALID so the migration still applies, but those');
    console.log('     accounts have no way to sign in and nothing can reach them.');
  }
}

if (!checked) {
  ok('None of the pending migrations add a constraint that existing rows could violate.');
}

// ── 3. What would CHANGE ────────────────────────────────────────────────
//
// These apply cleanly. They are here because somebody should hear about them
// before a landlord does.
console.log('\n── 3. Live data these would deliberately change ────────────');
let changes = 0;

if (pendingHas('service_provider_checks')) {
  changes++;
  const live = q(`SELECT count(*) FROM service_providers WHERE active = true`);
  /**
   * ⚠️ The `> 0` is the whole point of this branch.
   *
   * Without it this printed "0 contractor(s) are listed and ALL of them will be
   * un-listed" on production — a warning about nothing, which also pushed the
   * verdict to "1 thing(s) to know about first". An operator reading a preflight
   * before touching a live database has to be able to trust that a ⚠️ means
   * something; one that fires on an empty table teaches them to skim.
   */
  if (typeof live === 'object') {
    warn('Could not count listed contractors.');
  } else if (Number(live) > 0) {
    warn(`${live} contractor(s) are listed and ALL of them will be un-listed.`);
    console.log('     Phase 7j made "active" require a recorded phone check, and no existing row');
    console.log('     has one. This is deliberate — the directory tells landlords these names were');
    console.log('     checked, and none of them were — but "Who to call" will be empty afterwards');
    console.log('     until an admin rings each number and records it on /admin/services.');
  } else {
    changes--;
    ok('No contractor is listed, so the phone-check requirement un-lists nobody.');
  }
}

if (pendingHas('sponsorship_residue')) {
  const sponsored = q(`SELECT count(*) FROM service_providers WHERE "sponsoredUntil" IS NOT NULL`);
  if (typeof sponsored !== 'object' && Number(sponsored) > 0) {
    changes++;
    warn(`${sponsored} contractor(s) have a sponsoredUntil date, which will be cleared.`);
    console.log('     Nothing has ever read that column. See FLOW-AUDIT 5.31.');
  }
}

if (!changes) ok('No pending migration rewrites existing rows.');

// ── 4. The one that is failing right now ────────────────────────────────
console.log('\n── 4. The column production is erroring on ─────────────────');
const listerType = q(`SELECT count(*) FROM information_schema.columns WHERE table_name='rooms' AND column_name='listerType'`);
if (typeof listerType === 'object') {
  warn('Could not check for rooms.listerType.');
} else if (Number(listerType) === 0) {
  /**
   * ⚠️ NOT a blocker, and the first version of this script called it one.
   *
   * A missing column is the REASON to migrate, not a reason to stop — and the
   * verdict at the bottom printed "do NOT run migrate deploy" on the one
   * database that most needed it. A preflight that tells somebody not to apply
   * the fix for the outage they are in the middle of is worse than no
   * preflight.
   *
   * `bad()` is for things that would make the RUN FAIL. This explains an
   * outage; it does not predict one.
   */
  console.log('  ℹ️  rooms.listerType does NOT exist — this is the P2022 the board and every');
  console.log('     room query is failing with. It is added by 20261003170000_sublet_listings,');
  console.log('     which is pending above. Applying these migrations is the fix.');
} else {
  ok('rooms.listerType exists.');
}

// ── Verdict ─────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════');
if (problems) {
  console.log(`  ❌ ${problems} thing(s) would stop the run. Fix those first.`);
  console.log('     Do NOT run migrate deploy until this comes back clean.');
} else if (pending.length) {
  /**
   * ⚠️ This footer used to read:
   *
   *     Back the database up, then:  cd backend && npx prisma migrate deploy
   *
   * which is a command that CANNOT REACH the database this script just spent
   * four sections inspecting. An inline `DATABASE_URL=… node script.mjs` prefix
   * applies to that one command; the next command loads `backend/.env`. So the
   * preflight passed on production, the operator pasted the line it printed,
   * and twelve migrations went to `localhost:5432/rentboard_dev` — reporting
   * "All migrations have been successfully applied." while production stayed
   * down on the exact column this script had just named.
   *
   * A preflight that verifies one database and then hands over a command
   * pointed at a different one is not a safeguard, it is a trap. The host is
   * printed below so the `migrate status` line can be checked against it by
   * eye before anything is written.
   */
  const host = splitConn(URL).host;
  console.log(`  ✅ ${pending.length} migration(s) can be applied.${warnings ? ` ${warnings} thing(s) to know about first.` : ''}`);
  console.log('');
  console.log('     Back this database up first — on Neon, create a branch from the current');
  console.log('     head (instant, and the restore path if a migration goes wrong); with');
  console.log('     pg_dump, the client major version must match the server or it refuses.');
  console.log('');
  console.log('     Then apply them with the wrapper, from the repository ROOT — not with');
  console.log('     `npx prisma migrate deploy` directly:');
  console.log('');
  console.log("       export DATABASE_URL='<the URL you passed to this script>'");
  console.log("       export DIRECT_URL='<the same database, the NON-pooler endpoint>'");
  console.log('       bash scripts/migrate-remote.sh');
  console.log('');
  console.log(`     It prints the target (expect ${host}) and asks before`);
  console.log('     applying anything, and it refuses outright if DATABASE_URL is unset, if');
  console.log('     DIRECT_URL is unset, if either resolves to localhost, or if DIRECT_URL');
  console.log('     is a `-pooler` host. A bare `npx prisma migrate deploy` has none of');
  console.log('     those guards: it reads backend/.env for whichever variable you did not');
  console.log('     export and reports success about the database it reached instead.');
} else {
  console.log('  ✅ Nothing to do.');
}
console.log('═══════════════════════════════════════════════════════════\n');
process.exit(problems ? 1 : 0);
