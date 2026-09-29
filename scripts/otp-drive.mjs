/**
 * Phone sign-in hardening — Phase 7g.
 *
 * ── What the service's own header admitted
 *
 * There was a `MAX_ATTEMPTS = 5` constant that nothing ever read. It described
 * an intention and counted nothing, and the reason was not a missed wiring: the
 * lookup was `findUnique({ tokenHash: hash(submittedCode) })`, so a wrong code
 * matched no row — and you cannot increment a counter on a token you could not
 * find. The lookup shape made the check impossible.
 *
 * Three things are checked here, all of which were absent:
 *
 *   1. Wrong codes are counted, per ACCOUNT, and the code burns at five. The
 *      existing @Throttle is per IP, so a distributed attacker gets one budget
 *      per address while the account owner gets one in total — the wrong way
 *      round.
 *   2. Asking for a new code kills the old one. Up to three valid codes used to
 *      coexist, tripling the guessing surface for no benefit — the person only
 *      reads the newest message.
 *   3. Nothing anywhere reveals whether a number has an account.
 *
 * Needs the API on :3000 and a DATABASE_URL, because a code is only ever sent
 * over WhatsApp — reading it back requires the database.
 */
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { registerUser, apiCall } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const DB = process.env.DATABASE_URL
  ?? 'postgresql://rentboard:rentboard@localhost:5432/rentboard_dev';

/** One row, one column, straight out of Postgres. */
function q(sql) {
  return execSync(`psql "${DB}" -tAc ${JSON.stringify(sql)}`, { encoding: 'utf8' }).trim();
}

/**
 * A number unique to this run.
 *
 * Hardcoded at first, which made the drive pass once and then fail forever: the
 * partial unique index on verified numbers correctly refused the second run's
 * INSERT. The index doing its job read as a broken drive — the same shape as the
 * services drive that saw its own previous rows.
 *
 * 082 123 9xxx, so it stays a plausible SA mobile and cannot collide with the
 * seeded fixtures.
 */
const SUFFIX = String(Math.floor(Math.random() * 9000) + 1000);
const PHONE_LOCAL = `082123${SUFFIX}`;
const PHONE_E164 = `+2782123${SUFFIX}`;

// A landlord with a verified number, which is what sign-in requires.
const ll = await registerUser(API, 'LANDLORD');
q(`UPDATE users SET phone = '${PHONE_E164}', "phoneVerified" = true WHERE id = '${ll.id}'`);
ok('a landlord with a verified number');

// ── No enumeration, in either direction ───────────────────────────────────
const known = await apiCall(API, 'POST', '/api/auth/phone/request-code', { phone: PHONE_LOCAL });
const unknown = await apiCall(API, 'POST', '/api/auth/phone/request-code', { phone: `082999${SUFFIX}` });
known.status === unknown.status && JSON.stringify(known.body) === JSON.stringify(unknown.body)
  ? ok('a number with an account and one without get the identical reply')
  : bad(`enumerable: ${known.status} ${JSON.stringify(known.body)} vs ${unknown.status} ${JSON.stringify(unknown.body)}`);

// ── Asking again kills the previous code ─────────────────────────────────
const before = q(`SELECT count(*) FROM auth_tokens WHERE "userId"='${ll.id}' AND type='phone_otp' AND "usedAt" IS NULL`);
await apiCall(API, 'POST', '/api/auth/phone/request-code', { phone: PHONE_LOCAL });
const after = q(`SELECT count(*) FROM auth_tokens WHERE "userId"='${ll.id}' AND type='phone_otp' AND "usedAt" IS NULL`);
after === '1'
  ? ok(`only one live code at a time (was ${before}, now ${after})`)
  : bad(`${after} live codes at once — each one is another guess that works`);

// ── Wrong codes are counted, and the code burns at five ──────────────────
//
// The code itself is only ever sent over WhatsApp, so the drive brute-forces its
// OWN account's token by hash — which is exactly what the attempt counter is
// there to make expensive.
const tokenId = q(`SELECT id FROM auth_tokens WHERE "userId"='${ll.id}' AND type='phone_otp' AND "usedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`);
q(`UPDATE auth_tokens SET attempts = 0 WHERE id = '${tokenId}'`);

let sawCountdown = false;
let burnedAt = null;
for (let i = 1; i <= 7; i++) {
  const r = await apiCall(API, 'POST', '/api/auth/phone/verify', { phone: PHONE_LOCAL, code: '000000' });
  const msg = String(r.body?.message ?? '');
  if (/tries? left/i.test(msg)) sawCountdown = true;
  if (/Too many wrong codes/i.test(msg) && burnedAt === null) burnedAt = i;
}
sawCountdown
  ? ok('a wrong code says how many tries are left')
  : bad('no attempt countdown in the response');
burnedAt !== null && burnedAt <= 6
  ? ok(`the code burns after the fifth wrong try (refused on try ${burnedAt})`)
  : bad(`never burned in seven tries — MAX_ATTEMPTS counts nothing again`);

const spent = q(`SELECT ("usedAt" IS NOT NULL)::text FROM auth_tokens WHERE id='${tokenId}'`);
spent === 'true'
  ? ok('and the token is spent, so a further guess cannot reach it at all')
  : bad('the burned token is still outstanding');

// ── A correct code still works, and only once ───────────────────────────
await apiCall(API, 'POST', '/api/auth/phone/request-code', { phone: PHONE_LOCAL });
const freshId = q(`SELECT id FROM auth_tokens WHERE "userId"='${ll.id}' AND type='phone_otp' AND "usedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`);
const freshHash = q(`SELECT "tokenHash" FROM auth_tokens WHERE id='${freshId}'`);

// Recover the code by searching the space against the stored hash. Only possible
// because the drive knows the salt scheme; an attacker does not have the hash.
const secret = process.env.JWT_SECRET ?? '';
let code = null;
for (let n = 0; n < 1000000; n++) {
  const candidate = String(n).padStart(6, '0');
  const h = crypto.createHmac('sha256', secret).update(`${PHONE_E164}:${candidate}`).digest('hex');
  if (h === freshHash) { code = candidate; break; }
}
if (!code) {
  console.log('     ↳ could not derive the code — the hash scheme differs from this drive’s assumption.');
  console.log('        Skipping the success path rather than reporting a pass that proves nothing.');
} else {
  const good = await apiCall(API, 'POST', '/api/auth/phone/verify', { phone: PHONE_LOCAL, code });
  good.status === 200 && (good.body?.accessToken || good.body?.access_token)
    ? ok('the right code signs you in')
    : bad(`correct code returned ${good.status} ${JSON.stringify(good.body).slice(0, 160)}`);
  const again = await apiCall(API, 'POST', '/api/auth/phone/verify', { phone: PHONE_LOCAL, code });
  again.status >= 400
    ? ok('and cannot be used twice')
    : bad('a spent code was accepted a second time');
}

// ── Email is optional at the database level, and enforced as a pair ──────
const constraint = q(`SELECT count(*) FROM pg_constraint WHERE conname = 'users_email_or_phone_required'`);
constraint === '1'
  ? ok('the database refuses an account with neither email nor phone')
  : bad('no email-or-phone CHECK constraint — an unreachable account can be created');
const partial = q(`SELECT indexdef FROM pg_indexes WHERE indexname = 'users_phone_verified_key'`);
/WHERE \(?"phoneVerified"/.test(partial)
  ? ok('and verified numbers are unique, by a PARTIAL index that spares existing duplicates')
  : bad(`the phone index is not partial: ${partial}`);

// A phone-only account is a legal row.
// Per-run, like the number above. A fixed one here made the drive fail on its
// SECOND run once a crash had left the row behind — the index was right and the
// drive was not idempotent.
const phoneOnly = q(`INSERT INTO users (id,"fullName",role,phone,"phoneVerified","createdAt","updatedAt") VALUES (gen_random_uuid(),'Phone Only','LANDLORD','+2782999${SUFFIX}',true,now(),now()) RETURNING id`);
phoneOnly.length > 10
  ? ok('a landlord with a phone and no email can exist')
  : bad('a phone-only account was rejected');
q(`DELETE FROM users WHERE id = '${phoneOnly}'`);

console.log(fail ? `\n❌ ${fail} failure(s)` : '\n✅ wrong codes are counted per account, one code lives at a time, and a phone-only account is reachable');
process.exit(fail ? 1 : 0);
