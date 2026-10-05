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
 * it. The repair is `prisma migrate deploy`, and running fourteen migrations
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

/** One line of SQL per call, as the repo's own notes insist. */
function q(sql) {
  try {
    return execSync(`psql "${URL}" -tAc ${JSON.stringify(sql)}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    return { error: String(e.stderr ?? e.message ?? e).trim() };
  }
}

console.log('\n═══ Migration preflight — READ ONLY ═══');
console.log(`  Target: ${URL.replace(/:\/\/[^@]*@/, '://***@')}`);

// ── Can we even reach it ────────────────────────────────────────────────
const alive = q('SELECT 1');
if (typeof alive === 'object') {
  console.log(`\n  ❌ Cannot reach that database:\n     ${alive.error.split('\n')[0]}`);
  process.exit(1);
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

console.log(`  ${onDisk.length} migrations in the repository, ${applied.size} applied, ${pending.length} pending.`);
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
  if (typeof live !== 'object') {
    warn(`${live} contractor(s) are listed and ALL of them will be un-listed.`);
    console.log('     Phase 7j made "active" require a recorded phone check, and no existing row');
    console.log('     has one. This is deliberate — the directory tells landlords these names were');
    console.log('     checked, and none of them were — but "Who to call" will be empty afterwards');
    console.log('     until an admin rings each number and records it on /admin/services.');
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
  console.log(`  ✅ ${pending.length} migration(s) can be applied.${warnings ? ` ${warnings} thing(s) to know about first.` : ''}`);
  console.log('     Back the database up, then:  cd backend && npx prisma migrate deploy');
} else {
  console.log('  ✅ Nothing to do.');
}
console.log('═══════════════════════════════════════════════════════════\n');
process.exit(problems ? 1 : 0);
