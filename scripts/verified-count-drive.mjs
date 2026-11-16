#!/usr/bin/env node
/**
 * Does the board's "verified landlords" figure tell the truth once it is
 * bounded?
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 *
 * The hero stat on the landing page reads "N verified landlords", to a
 * signed-out visitor, in eleven languages. It is a trust claim, and it has
 * already been false once: it was computed in the browser as
 * `new Set(loadedRooms.map(r => r.landlordId)).size`, which never looked at
 * whether anybody was verified AND counted only the current page, so the
 * number grew as a visitor scrolled. rooms.service.ts says why that matters:
 * a trust figure that is both false and unstable is worse than no figure.
 *
 * It has now been changed a second time, for performance: the server-side
 * count was a `findMany({ distinct })`, and Prisma applies `distinct` in the
 * CLIENT, so every row matching the search crossed into the heap — ~10 MB per
 * in-flight request at 100,000 active rooms, on a 512 MB instance. It is a
 * `groupBy` with a `take` now, capped at 200 and reporting the cap.
 *
 * A performance change to a trust figure is exactly the change that can
 * quietly make it lie again, in three different ways: by counting unverified
 * landlords, by counting landlords whose rooms the search excludes, or by
 * clamping to 200 without saying so. So each of those is asserted here rather
 * than assumed, and the drive is written so that reintroducing any of them
 * turns it red.
 *
 *   node scripts/verified-count-drive.mjs      # needs the API on :3000
 *
 * ⚠️ It seeds and deletes rows in bulk and refuses any non-local database,
 * for the reasons scripts/int-db-setup.sh gives.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// `API` is what ci.yml passes to every other drive; API_BASE kept for callers
// that already use it.
const API = process.env.API ?? process.env.API_BASE ?? 'http://localhost:3000';
const TAG = 'VERIFIED-COUNT-DRIVE';
/** Must match VERIFIED_LANDLORD_CAP in backend/src/modules/rooms/rooms.service.ts. */
const CAP = 200;

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
const URL_FOR_PSQL = rawUrl.replace(/[?&]schema=[^&]*/g, '');
const host = (/@([^:/?]+)/.exec(URL_FOR_PSQL) ?? [])[1] ?? '';
if (!['localhost', '127.0.0.1', '::1'].includes(host) || /neon\.tech|render\.com|umastande/.test(URL_FOR_PSQL)) {
  console.error(`❌ refusing: "${host}" is not a local database. This drive inserts and deletes rows in bulk.`);
  process.exit(1);
}
const q = (sql) => execFileSync('psql', [URL_FOR_PSQL, '-X', '-q', '-tAc', sql], { encoding: 'utf8' }).trim();

let fail = 0;
const check = (ok, text) => {
  console.log(`  ${ok ? '\u001b[32m✅\u001b[0m' : '\u001b[31m❌\u001b[0m'} ${text}`);
  if (!ok) fail++;
};

const clean = () => {
  q(`DELETE FROM rooms WHERE title LIKE '%${TAG}%'`);
  q(`DELETE FROM landlord_profiles WHERE "companyName" = '${TAG}'`);
  q(`DELETE FROM users WHERE "fullName" LIKE '%${TAG}%'`);
};

/**
 * `verified` landlords get an id-verified profile; `unverified` get a profile
 * with idVerified false. Each landlord gets ONE room in Tembisa and, when
 * `decoy` is set, one more in Soweto — so a city filter can be shown to
 * exclude landlords rather than merely reorder them.
 */
function seed({ verified, unverified }) {
  const total = verified + unverified;
  q(`
    INSERT INTO users (id, email, "fullName", role, "isVerified", "updatedAt")
    SELECT 'vc-u-' || g, 'vc-' || g || '@example.invalid',
           'Landlord ' || g || ' ${TAG}', 'LANDLORD', true, now()
    FROM generate_series(1, ${total}) g
  `);
  q(`
    INSERT INTO landlord_profiles (id, "userId", "companyName", "idVerified")
    SELECT 'vc-p-' || g, 'vc-u-' || g, '${TAG}', (g <= ${verified})
    FROM generate_series(1, ${total}) g
  `);
  // One room each in Tembisa.
  q(`
    INSERT INTO rooms (id, "landlordId", "roomType", title, status, "rentCents",
                       province, city, "locationDisplay", "availableFrom", "updatedAt", "publishedAt")
    SELECT 'vc-r-' || g, 'vc-u-' || g, 'private'::"RoomType",
           'Room in Tembisa ${TAG}', 'active', 200000,
           'Gauteng', 'Tembisa', 'Tembisa, Ekurhuleni', now(), now(), now()
    FROM generate_series(1, ${total}) g
  `);
  q('ANALYZE rooms'); q('ANALYZE users'); q('ANALYZE landlord_profiles');
}

/** Only the landlords this drive made, so a dirty database cannot flatter it. */
const trueVerifiedInCity = (city) =>
  Number(q(`
    SELECT count(DISTINCT r."landlordId") FROM rooms r
      JOIN users u ON u.id = r."landlordId"
      JOIN landlord_profiles lp ON lp."userId" = u.id
    WHERE r.title LIKE '%${TAG}%' AND r.status = 'active'
      AND lp."idVerified" = true AND r.city = '${city}'
  `));

const board = async (query = '') => {
  const res = await fetch(`${API}/api/rooms?limit=1${query}`);
  if (!res.ok) throw new Error(`GET /api/rooms -> ${res.status}`);
  return res.json();
};

try {
  const probe = await fetch(`${API}/health/live`);
  if (!probe.ok) throw new Error(String(probe.status));
} catch {
  console.error(`❌ the API is not answering at ${API}. Start it first.`);
  process.exit(1);
}

const preexisting = Number(q(`
  SELECT count(DISTINCT r."landlordId") FROM rooms r
    JOIN users u ON u.id = r."landlordId"
    JOIN landlord_profiles lp ON lp."userId" = u.id
  WHERE r.status = 'active' AND lp."idVerified" = true AND r.title NOT LIKE '%${TAG}%'
`));

console.log(`\nAPI ${API}, database ${host}. ${preexisting} verified landlord(s) already on the board.`);
if (preexisting > 0) {
  console.log('  (counted into the expectations below, so existing data does not break the drive)');
}

// ── 1. Exact below the cap ───────────────────────────────────────────────
console.log('\n── Below the cap: the figure is exact, and counts only the verified ──');
clean();
seed({ verified: 7, unverified: 5 });
let body = await board();
check(
  body.verifiedLandlords === 7 + preexisting,
  `7 verified + 5 unverified landlords -> verifiedLandlords is ${body.verifiedLandlords}, expected ${7 + preexisting}`,
);
check(
  body.verifiedLandlordsCapped === false,
  `and it is reported as exact, not capped (verifiedLandlordsCapped=${body.verifiedLandlordsCapped})`,
);
check(
  body.verifiedLandlords !== 12 + preexisting,
  'the 5 unverified landlords are NOT counted — this is the original defect, and it would read 12',
);

// ── 2. The search filter applies to the count, not just the rooms ────────
console.log('\n── A search that excludes rooms must exclude their landlords too ──');
// Move three of the seven verified landlords' rooms to another city.
q(`UPDATE rooms SET city = 'Soweto', "locationDisplay" = 'Soweto, Johannesburg'
   WHERE id IN ('vc-r-1','vc-r-2','vc-r-3')`);
q('ANALYZE rooms');
const tembisa = await board('&city=Tembisa');
const expectTembisa = trueVerifiedInCity('Tembisa');
check(
  tembisa.verifiedLandlords === expectTembisa,
  `city=Tembisa -> ${tembisa.verifiedLandlords}, and SQL says ${expectTembisa} verified landlord(s) have an active Tembisa room`,
);
check(
  expectTembisa === 4,
  `the fixture is what the assertion assumes: 4 of the 7 verified landlords are left in Tembisa (SQL: ${expectTembisa})`,
);
const soweto = await board('&city=Soweto');
check(
  soweto.verifiedLandlords === trueVerifiedInCity('Soweto'),
  `city=Soweto -> ${soweto.verifiedLandlords}, SQL says ${trueVerifiedInCity('Soweto')}`,
);
check(
  tembisa.verifiedLandlords !== body.verifiedLandlords,
  'and the two searches do NOT return the same number — a count ignoring the filter would',
);

// ── 3. At and above the cap ─────────────────────────────────────────────
console.log(`\n── At the cap (${CAP}) and above it, the number must stop being exact AND say so ──`);
clean();
seed({ verified: CAP - preexisting, unverified: 0 });
body = await board();
check(
  body.verifiedLandlords === CAP,
  `exactly ${CAP} verified landlords -> ${body.verifiedLandlords}`,
);
check(
  body.verifiedLandlordsCapped === false,
  'exactly at the cap is still EXACT, so it must not claim to be capped — the off-by-one that would read "200+" for a true 200',
);

clean();
seed({ verified: CAP + 50 - preexisting, unverified: 0 });
body = await board();
check(
  body.verifiedLandlords === CAP,
  `${CAP + 50} verified landlords -> the figure is clamped to ${body.verifiedLandlords}`,
);
check(
  body.verifiedLandlordsCapped === true,
  'and the response SAYS it is a floor, so the hero can render "200+" instead of a false exact number',
);

// ── 4. The statement Postgres runs is actually bounded ──────────────────
console.log('\n── The point of the change: the work is bounded in the database ──');
const plan = q(`
  EXPLAIN (ANALYZE, TIMING OFF) SELECT r."landlordId" FROM rooms r
    LEFT JOIN users u ON u.id = r."landlordId"
    LEFT JOIN landlord_profiles lp ON lp."userId" = u.id
  WHERE r.status = 'active' AND lp."idVerified" = true
  GROUP BY r."landlordId" ORDER BY r."landlordId" ASC LIMIT ${CAP + 1}
`);
check(/Limit/.test(plan), 'the plan carries a Limit node, so the database returns at most the cap');
check(
  /HashAggregate|GroupAggregate|Group/.test(plan),
  'and an aggregate node, so Postgres de-duplicates rather than shipping one row per room',
);

clean();
console.log(
  fail === 0
    ? '\n\u001b[32m✅ bounded, and still honest: verified-only, filter-aware, exact below the cap, and it admits the cap.\u001b[0m\n'
    : `\n\u001b[31m❌ ${fail} check(s) failed.\u001b[0m\n`,
);
process.exit(fail ? 1 : 0);
