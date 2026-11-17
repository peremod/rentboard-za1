#!/usr/bin/env node
/**
 * How steeply does the notice board's search degrade as the board fills?
 *
 * ── Why ─────────────────────────────────────────────────────────────────
 *
 * The board's token search compiles to ILIKE with a leading AND trailing
 * wildcard across five text columns, which no index can serve — there is no
 * pg_trgm extension, no tsvector column and no `fullTextSearch` preview
 * feature anywhere in this repository. At the 256 rooms the development
 * database holds it costs half a millisecond, so nothing has ever complained.
 * Nobody had measured what it costs at a size this product would like to
 * reach, which makes "it is fine" a guess rather than a finding.
 *
 * And while reading the query to write this, a second cost turned up that is
 * worse than the ILIKE: the verified-landlord figure on the board runs a
 * findMany over EVERY row matching the search with no LIMIT, selecting
 * landlordId and de-duplicating in JavaScript. A page of twelve rooms is
 * paginated; that query is not. It runs on the unfiltered board too, because
 * the default `where` is just `status: 'active'`.
 *
 * ── Safety ──────────────────────────────────────────────────────────────
 *
 * 🔴 This script WRITES and then DELETES tens of thousands of rows. It refuses
 * to run against anything that is not a local database, by the same reasoning
 * as scripts/int-db-setup.sh: §59 is the smoke run that put a test listing in
 * front of real visitors, and this is the same mistake with a hundred thousand
 * rows and a DELETE behind it.
 *
 * Everything it inserts carries the SYNTHETIC_TAG, and the cleanup deletes by
 * that tag only — it never truncates, so a development database keeps its own
 * data. Run with --clean to remove the rows and do nothing else.
 *
 * Usage:
 *   node scripts/search-scale-probe.mjs                 # 1k, 10k, 100k
 *   node scripts/search-scale-probe.mjs --sizes 1000    # one size
 *   node scripts/search-scale-probe.mjs --clean         # remove and exit
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SYNTHETIC_TAG = 'SCALE-PROBE';
// `API` is what ci.yml passes to every other drive; API_BASE kept for callers
// that already use it.
const API = process.env.API ?? process.env.API_BASE ?? 'http://localhost:3000';

// ── The connection, and the refusal ────────────────────────────────────
/**
 * The connection, from the environment first and backend/.env second.
 *
 * CI has no backend/.env — the workflow passes DATABASE_URL as a step env, the
 * way scripts/double-let-drive.mjs and the other API drives receive it. Reading
 * only the file would make this work on a laptop and fail on every push, which
 * is the direction that wastes a CI cycle to discover.
 */
const rawUrl =
  process.env.DATABASE_URL ??
  (() => {
    let envText;
    try {
      envText = readFileSync(join(ROOT, 'backend/.env'), 'utf8');
    } catch {
      return undefined;
    }
    return (/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m.exec(envText) ?? [])[1];
  })();
if (!rawUrl) {
  console.error('❌ no DATABASE_URL: not in the environment, and not in backend/.env');
  process.exit(1);
}
// psql rejects the whole URI over ?schema=public — a Prisma-only parameter —
// with `invalid URI query parameter: "schema"`.
const URL_FOR_PSQL = rawUrl.replace(/[?&]schema=[^&]*/g, '');

const host = (/@([^:/?]+)/.exec(URL_FOR_PSQL) ?? [])[1] ?? '';
const LOCAL = ['localhost', '127.0.0.1', '::1'];
if (!LOCAL.includes(host)) {
  console.error(`❌ refusing: "${host}" is not a local host. This script inserts and deletes rows in bulk.`);
  process.exit(1);
}
if (/neon\.tech|render\.com|umastande|supabase/.test(URL_FOR_PSQL)) {
  console.error('❌ refusing: that connection string looks remote.');
  process.exit(1);
}

/** One statement per call — psql prints the command tag as well as the result. */
const q = (sql) =>
  execFileSync('psql', [URL_FOR_PSQL, '-X', '-q', '-tAc', sql], { encoding: 'utf8' }).trim();

const args = process.argv.slice(2);
const sizes = args.includes('--sizes')
  ? args[args.indexOf('--sizes') + 1].split(',').map(Number)
  : [1000, 10000, 100000];

function clean() {
  q(`DELETE FROM rooms WHERE title LIKE '%${SYNTHETIC_TAG}%'`);
  q(`DELETE FROM landlord_profiles WHERE "companyName" = '${SYNTHETIC_TAG}'`);
  q(`DELETE FROM users WHERE "fullName" LIKE '%${SYNTHETIC_TAG}%'`);
}

if (args.includes('--clean')) {
  clean();
  console.log(`removed. rooms now: ${q('SELECT count(*) FROM rooms')}`);
  process.exit(0);
}

/**
 * Seed to exactly `target` synthetic rooms, four per landlord.
 *
 * Four, because that is the person this product was built for — four back
 * rooms — so the rooms-per-landlord ratio that decides how much work the
 * verified-landlord de-duplication does is the real one rather than a round
 * number.
 *
 * The text is drawn from a small vocabulary on purpose: a search has to MATCH
 * something to be worth timing, and a corpus of random hex matches nothing, so
 * the timing would flatter the query.
 */
function seed(target) {
  const landlords = Math.ceil(target / 4);
  q(`
    INSERT INTO users (id, email, "fullName", role, "isVerified", "updatedAt")
    SELECT 'sp-u-' || g, 'scale-probe-' || g || '@example.invalid',
           'Landlord ' || g || ' ${SYNTHETIC_TAG}', 'LANDLORD', true, now()
    FROM generate_series(1, ${landlords}) g
    ON CONFLICT (id) DO NOTHING
  `);
  // Half the landlords are id-verified, so the distinct-landlord query has
  // real work to do rather than matching everything or nothing.
  q(`
    INSERT INTO landlord_profiles (id, "userId", "companyName", "idVerified")
    SELECT 'sp-p-' || g, 'sp-u-' || g, '${SYNTHETIC_TAG}', (g % 2 = 0)
    FROM generate_series(1, ${landlords}) g
    ON CONFLICT (id) DO NOTHING
  `);
  q(`
    INSERT INTO rooms (
      id, "landlordId", "roomType", title, description, status, "rentCents",
      province, city, "locationDisplay", "availableFrom", "updatedAt", "publishedAt"
    )
    SELECT
      'sp-r-' || g,
      'sp-u-' || ((g % ${landlords}) + 1),
      (ARRAY['shared_house','en_suite','studio','private'])[(g % 4) + 1]::"RoomType",
      -- 4 adjectives against 5 places, so the two cycle independently and
      -- every combination occurs. Indexed off the same counter with the same
      -- modulus they would be locked together, and a search for an adjective
      -- AND a place would match nothing at any board size — which would have
      -- timed the empty-result path and called it a search.
      (ARRAY['Tidy','Spacious','Affordable','Student'])[(g % 4) + 1]
        || ' room in ' || (ARRAY['Tembisa','Soweto','Khayelitsha','Mamelodi','Umlazi'])[(g % 5) + 1]
        || ' ${SYNTHETIC_TAG}',
      'Back room with its own entrance, prepaid electricity and space to park. '
        || (ARRAY['Near the taxi rank.','Walking distance to the clinic.','Close to the shops.'])[(g % 3) + 1],
      'active',
      150000 + (g % 40) * 25000,
      (ARRAY['Gauteng','Western Cape','KwaZulu-Natal'])[(g % 3) + 1],
      (ARRAY['Tembisa','Soweto','Khayelitsha','Mamelodi','Umlazi'])[(g % 5) + 1],
      (ARRAY['Tembisa, Ekurhuleni','Soweto, Johannesburg','Khayelitsha, Cape Town',
             'Mamelodi, Tshwane','Umlazi, Durban'])[(g % 5) + 1],
      now(), now(), now()
    FROM generate_series(1, ${target}) g
    ON CONFLICT (id) DO NOTHING
  `);
  q('ANALYZE rooms');
  q('ANALYZE users');
  q('ANALYZE landlord_profiles');
}

/** Wall-clock for a real HTTP request, which is what a visitor waits for. */
async function timeApi(path, runs = 5) {
  const times = [];
  let status = 0;
  let total = null;
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    const res = await fetch(`${API}${path}`);
    const body = await res.json().catch(() => null);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    status = res.status;
    if (body && typeof body.total === 'number') total = body.total;
  }
  times.sort((a, b) => a - b);
  return { median: times[Math.floor(times.length / 2)], max: times[times.length - 1], status, total };
}

/**
 * Two phrases, because they exercise opposite ends of the same query.
 *
 * A full phrase narrows hard — a place plus a describing word, ANDed — so the
 * unbounded verified-landlord scan runs over few rows. A SINGLE broad word is
 * the worst case and also the likeliest thing somebody types into a search
 * box: one token, matching a quarter of the board, with nothing to narrow it.
 */
const SEARCH = 'affordable room in Tembisa';
const ONE_WORD = 'affordable';

console.log(`\nAPI at ${API}, database ${host}. Tag: ${SYNTHETIC_TAG}\n`);
try {
  const probe = await fetch(`${API}/health/live`);
  if (!probe.ok) throw new Error(String(probe.status));
} catch {
  console.error(`❌ the API is not answering at ${API}. Start it first — this probe measures the real endpoint,\n   not a reimplementation of its query.`);
  process.exit(1);
}

const baseline = Number(q(`SELECT count(*) FROM rooms WHERE title NOT LIKE '%${SYNTHETIC_TAG}%'`));
console.log(`${baseline} real room(s) already on the board; synthetic rows are added on top and deleted at the end.\n`);

const rows = [];
for (const size of sizes) {
  clean();
  process.stdout.write(`  seeding ${size.toLocaleString('en-ZA')}… `);
  const t0 = Date.now();
  seed(size);
  const active = Number(q("SELECT count(*) FROM rooms WHERE status = 'active'"));
  console.log(`${active.toLocaleString('en-ZA')} active rooms (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  const unfiltered = await timeApi('/api/rooms?page=1&limit=12');
  const searched = await timeApi(`/api/rooms?page=1&limit=12&search=${encodeURIComponent(SEARCH)}`);
  const oneWord = await timeApi(`/api/rooms?page=1&limit=12&search=${encodeURIComponent(ONE_WORD)}`);

  // The two statements the endpoint issues that are NOT bounded by the page
  // size, straight to Postgres so the plan is visible.
  const explainDistinct = q(`
    EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON)
    SELECT r.id, r."landlordId" FROM rooms r
      LEFT JOIN users u ON u.id = r."landlordId"
      LEFT JOIN landlord_profiles lp ON lp."userId" = u.id
    WHERE r.status = 'active' AND lp."idVerified" = true
  `);
  const explainIlike = q(`
    EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON)
    SELECT r.id FROM rooms r
    WHERE r.status = 'active'
      AND (r.title ILIKE '%affordable%' OR r.description ILIKE '%affordable%'
           OR r."locationDisplay" ILIKE '%affordable%' OR r.city ILIKE '%affordable%'
           OR r.province ILIKE '%affordable%')
  `);
  const ms = (plan) => Number((/Execution Time: ([\d.]+) ms/.exec(plan) ?? [])[1] ?? NaN);
  const scans = (plan) => [...plan.matchAll(/(Seq Scan|Index Scan|Bitmap Heap Scan) on (\w+)/g)]
    .map((m) => `${m[1]} on ${m[2]}`);

  rows.push({
    size: active,
    unfiltered,
    searched,
    oneWord,
    distinctMs: ms(explainDistinct),
    ilikeMs: ms(explainIlike),
    plans: [...new Set([...scans(explainDistinct), ...scans(explainIlike)])],
  });
}

console.log('\n── GET /api/rooms, as a visitor experiences it ──────────────');
console.log('  active rooms │ unfiltered board │ full phrase │ one broad word │ its matches');
for (const r of rows) {
  console.log(
    `  ${String(r.size.toLocaleString('en-ZA')).padStart(12)} │ ` +
      `${(r.unfiltered.median.toFixed(0) + ' ms').padStart(16)} │ ` +
      `${(r.searched.median.toFixed(0) + ' ms').padStart(11)} │ ` +
      `${(r.oneWord.median.toFixed(0) + ' ms').padStart(14)} │ ` +
      `${String(r.oneWord.total ?? '?').padStart(11)}`,
  );
}

console.log('\n── The two unbounded statements, in Postgres ───────────────');
console.log('  active rooms │ verified-landlord scan │ one ILIKE token');
for (const r of rows) {
  console.log(
    `  ${String(r.size.toLocaleString('en-ZA')).padStart(12)} │ ` +
      `${(r.distinctMs.toFixed(1) + ' ms').padStart(22)} │ ` +
      `${(r.ilikeMs.toFixed(1) + ' ms').padStart(15)}`,
  );
}
console.log(`\n  plans seen: ${rows.at(-1).plans.join(', ')}`);

const first = rows[0];
const last = rows.at(-1);
if (rows.length > 1) {
  const growth = last.size / first.size;
  console.log(
    `\n── Growth from ${first.size.toLocaleString('en-ZA')} to ${last.size.toLocaleString('en-ZA')} rooms (${growth.toFixed(0)}×) ──\n` +
      `  unfiltered board        ${(last.unfiltered.median / first.unfiltered.median).toFixed(1)}×\n` +
      `  full phrase             ${(last.searched.median / first.searched.median).toFixed(1)}×\n` +
      `  one broad word          ${(last.oneWord.median / first.oneWord.median).toFixed(1)}×\n` +
      `  verified-landlord scan  ${(last.distinctMs / first.distinctMs).toFixed(1)}×\n` +
      `  one ILIKE token         ${(last.ilikeMs / first.ilikeMs).toFixed(1)}×\n` +
      '\n  Linear in the row count is the expected shape for a sequential scan.\n' +
      '  What matters is the absolute number at the top end and WHICH statement\n' +
      '  gets there first.',
  );
}

clean();
console.log(`\ncleaned up. rooms now: ${q('SELECT count(*) FROM rooms')} (${baseline} expected)\n`);
