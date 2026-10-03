/**
 * Signing UP with a phone number — Phase 7g part two.
 *
 * Sign-in by phone shipped first, which left the gap this drives: a landlord
 * could sign in with WhatsApp only if somebody had already made them an account
 * with an email address, so the WhatsApp-first people the feature exists for
 * could not get in on their own.
 *
 * What is actually checked here, in the order it matters:
 *
 *   1. Requesting a code creates NO account. The obvious implementation — a
 *      User row with phoneVerified: false — hands anybody who can type a number
 *      an account on somebody else's handset.
 *   2. A number that already has an account and one that does not get byte-for-
 *      byte identical replies. "That number is taken" on a rental site tells a
 *      stranger who the landlords are.
 *   3. …and the real owner is told anyway, by a notice, which is the part that
 *      would otherwise be lost to that silence.
 *   4. Wrong codes are counted and the code burns at five.
 *   5. No account exists until the terms are accepted, and the refusal is a
 *      refusal — not an account with consentAcceptedAt quietly null.
 *   6. The ticket works once.
 *
 * Needs the API on :3000 and a DATABASE_URL: a code only ever goes out over
 * WhatsApp, so reading one back means reading the database.
 */
import crypto from 'node:crypto';
import { registerUser, apiCall, dbQuery as q } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
let fail = 0;
const skips = [];
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
/** Named, with its reason and its remedy — never a silent pass. */
const skip = (what, why) => { skips.push({ what, why }); console.log(`  ⏭️  ${what}\n       ↳ ${why}`); };

/**
 * Numbers unique to this run.
 *
 * Hardcoded numbers made the OTP drive pass once and fail forever — the partial
 * unique index on verified numbers correctly refused the second run's insert,
 * and the index doing its job read as a broken drive. 082 12x xxxx stays a
 * plausible SA mobile and cannot collide with the seeded fixtures.
 */
const S = String(Math.floor(Math.random() * 9000) + 1000);
const NEW_LOCAL = `082124${S}`;
const NEW_E164 = `+2782124${S}`;
const TAKEN_LOCAL = `082125${S}`;
const TAKEN_E164 = `+2782125${S}`;

const SECRET = process.env.JWT_SECRET ?? '';
const hashCode = (code, phone) =>
  crypto.createHmac('sha256', SECRET).update(`signup:${phone}:${code}`).digest('hex');

/** Recovers the code from the stored HMAC. Only possible knowing the scheme. */
function recoverCode(hash, phone) {
  for (let n = 0; n < 1000000; n++) {
    const candidate = String(n).padStart(6, '0');
    if (hashCode(candidate, phone) === hash) return candidate;
  }
  return null;
}

const liveRow = (phone) =>
  q(`SELECT id FROM phone_signups WHERE phone='${phone}' AND "userId" IS NULL AND "codeHash" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1`);

/**
 * A number taken all the way to a ticket, ready for the last step.
 *
 * Exists because the two consent checks each need their OWN ticket. They were
 * written against one, and a ticket is spent by a request that wrongly
 * succeeds — so when the `false` case created an account, the `absent` case
 * that followed got "that sign-up has expired" and reported a pass. Reordering
 * only moved which of the two lied. Separate tickets make each one stand on its
 * own, which is the only version of this check worth running.
 *
 * Returns null when the code cannot be derived (a JWT_SECRET mismatch), so the
 * caller skips by name rather than passing.
 */
async function proveNumber(local, e164) {
  await apiCall(API, 'POST', '/api/auth/phone/signup/request-code', { phone: local });
  const id = liveRow(e164);
  if (!id) return null;
  const hash = q(`SELECT "codeHash" FROM phone_signups WHERE id='${id}'`);
  const code = recoverCode(hash, e164);
  if (!code) return null;
  const res = await apiCall(API, 'POST', '/api/auth/phone/signup/verify', { phone: local, code });
  return res.status === 200 ? { ticket: res.body?.ticket, id, code, body: res.body } : null;
}

// ── 1. A code creates no account ─────────────────────────────────────────
const first = await apiCall(API, 'POST', '/api/auth/phone/signup/request-code', { phone: NEW_LOCAL });
first.status === 200
  ? ok('a sign-up code can be requested for a number with no account')
  : bad(`request-code returned ${first.status} ${JSON.stringify(first.body).slice(0, 200)}`);

q(`SELECT count(*) FROM users WHERE phone='${NEW_E164}'`) === '0'
  ? ok('and no user row was created by asking for it')
  : bad('asking for a code created an account on a number nobody has proven');

q(`SELECT count(*) FROM phone_signups WHERE phone='${NEW_E164}'`) === '1'
  ? ok('the attempt is a phone_signups row, not a half-built person')
  : bad('no phone_signups row — the code has nowhere to be checked against');

// ── 2 & 3. A taken number: identical reply, and the owner hears ──────────
const owner = await registerUser(API, 'LANDLORD');
q(`UPDATE users SET phone='${TAKEN_E164}', "phoneVerified"=true WHERE id='${owner.id}'`);

const taken = await apiCall(API, 'POST', '/api/auth/phone/signup/request-code', { phone: TAKEN_LOCAL });
const unknown = await apiCall(API, 'POST', '/api/auth/phone/signup/request-code', { phone: `082999${S}` });
taken.status === unknown.status && JSON.stringify(taken.body) === JSON.stringify(unknown.body)
  ? ok('a number with an account and one without get the identical reply')
  : bad(`enumerable: ${taken.status} ${JSON.stringify(taken.body)} vs ${unknown.status} ${JSON.stringify(unknown.body)}`);

q(`SELECT count(*) FROM phone_signups WHERE phone='${TAKEN_E164}'`) === '0'
  ? ok('and no code was issued against a number that already has an account')
  : bad('a sign-up row was created for a number somebody already owns');

// The notice is written unconditionally and the WhatsApp attempt is best-effort
// on top, so the row is the thing to assert. Not awaited by the service — the
// reply must not take longer for a known number than an unknown one — so give
// it a moment.
await new Promise((r) => setTimeout(r, 1200));
const notice = q(`SELECT kind FROM notices WHERE "userId"='${owner.id}' AND kind='signup_attempt_existing_account' LIMIT 1`);
notice === 'signup_attempt_existing_account'
  ? ok('the real owner is told somebody tried to sign up with their number')
  : bad('the owner was never told — the silence protects the prober and nobody else');

// ── 4. Wrong codes are counted, and the code burns at five ───────────────
const rowId = liveRow(NEW_E164);
q(`UPDATE phone_signups SET attempts=0 WHERE id='${rowId}'`);

let sawCountdown = false;
let burnedAt = null;
for (let i = 1; i <= 7; i++) {
  const r = await apiCall(API, 'POST', '/api/auth/phone/signup/verify', { phone: NEW_LOCAL, code: '000000' });
  const msg = String(r.body?.message ?? '');
  if (/tries? left/i.test(msg)) sawCountdown = true;
  if (/Too many wrong codes/i.test(msg) && burnedAt === null) burnedAt = i;
}
sawCountdown ? ok('a wrong code says how many tries are left') : bad('no attempt countdown');
burnedAt !== null && burnedAt <= 6
  ? ok(`the code burns after the fifth wrong try (refused on try ${burnedAt})`)
  : bad('never burned in seven tries — the cap counts nothing');
q(`SELECT ("codeHash" IS NULL)::text FROM phone_signups WHERE id='${rowId}'`) === 'true'
  ? ok('and the burned code is gone from the table, not merely flagged')
  : bad('the burned code is still stored and still checkable');

// ── 5. The right code, then the terms ────────────────────────────────────
await apiCall(API, 'POST', '/api/auth/phone/signup/request-code', { phone: NEW_LOCAL });
const freshId = liveRow(NEW_E164);
const freshHash = q(`SELECT "codeHash" FROM phone_signups WHERE id='${freshId}'`);
const code = recoverCode(freshHash, NEW_E164);

if (!code) {
  skip(
    'the whole success path (correct code → ticket → account)',
    'could not derive the code from its stored hash, so JWT_SECRET here differs from the API’s. ' +
    'Run this drive with the same JWT_SECRET the API was started with — a pass without it would prove nothing.',
  );
} else {
  const verified = await apiCall(API, 'POST', '/api/auth/phone/signup/verify', { phone: NEW_LOCAL, code });
  const ticket = verified.body?.ticket;
  verified.status === 200 && typeof ticket === 'string' && ticket.length > 20
    ? ok('the right code returns a ticket proving the number')
    : bad(`verify returned ${verified.status} ${JSON.stringify(verified.body).slice(0, 200)}`);

  verified.body?.phone === NEW_E164
    ? ok('and hands back the canonical +27 form, so the account gets the number sign-in will look for')
    : bad(`verify echoed ${verified.body?.phone} rather than ${NEW_E164}`);

  q(`SELECT count(*) FROM users WHERE phone='${NEW_E164}'`) === '0'
    ? ok('still no account: proving the number is not agreeing to anything')
    : bad('the account appeared before anybody accepted the terms');

  // Two refusals, on two separate numbers with a ticket each — see proveNumber
  // for why they cannot share one. `acceptTerms: false` and no acceptTerms at
  // all are different bugs: a DTO that rejects only `false` lets `undefined`
  // through, and `undefined` is the shape a missed checkbox binding ships as.
  for (const [label, suffix, payload] of [
    ['no acceptTerms field at all', '127', {}],
    ['an unticked box', '128', { acceptTerms: false }],
  ]) {
    const local = `082${suffix}${S}`;
    const e164 = `+2782${suffix}${S}`;
    const proven = await proveNumber(local, e164);
    if (!proven?.ticket) {
      skip(`the refusal of ${label}`, 'could not take a second number as far as a ticket.');
      continue;
    }
    const res = await apiCall(API, 'POST', '/api/auth/phone/signup/complete', {
      ticket: proven.ticket, fullName: 'Nobody Agreed', role: 'LANDLORD', ...payload,
    });
    const accounts = q(`SELECT count(*) FROM users WHERE phone='${e164}'`);
    res.status >= 400 && accounts === '0'
      ? ok(`${label}: refused, and no account left behind`)
      : bad(`${label}: complete returned ${res.status} and ${accounts} account(s) exist`);
    q(`DELETE FROM phone_signups WHERE phone='${e164}'`);
  }

  const done = await apiCall(API, 'POST', '/api/auth/phone/signup/complete', {
    ticket, fullName: 'Sipho Drive', role: 'LANDLORD', acceptTerms: true,
  });
  done.status === 201 && (done.body?.accessToken || done.body?.access_token)
    ? ok('ticking it creates the account and signs them straight in')
    : bad(`complete returned ${done.status} ${JSON.stringify(done.body).slice(0, 200)}`);

  const made = q(`SELECT (email IS NULL)::text || '|' || "phoneVerified"::text || '|' || "authProvider" FROM users WHERE phone='${NEW_E164}'`);
  made === 'true|true|phone'
    ? ok('and it is a phone-only account: no email, number verified, provider "phone"')
    : bad(`the account reads ${made} (want true|true|phone)`);

  const consent = q(`SELECT ("consentAcceptedAt" IS NOT NULL)::text FROM phone_signups WHERE phone='${NEW_E164}' AND "userId" IS NOT NULL`);
  consent === 'true'
    ? ok('with the acceptance recorded against the number that was proven')
    : bad('no consent record — nothing evidences that this person agreed');

  // POPIA s.69: marketing is a separate consent and this flow does not ask for
  // it, so the account must not arrive opted in on the column default.
  const marketing = q(`SELECT "marketingEmails"::text FROM users WHERE phone='${NEW_E164}'`);
  marketing === 'false'
    ? ok('and is NOT opted into marketing, which is a consent nobody asked for here')
    : bad('the account is opted into marketing on a tick that only covered the Terms');

  const profile = q(`SELECT count(*) FROM landlord_profiles lp JOIN users u ON u.id = lp."userId" WHERE u.phone='${NEW_E164}'`);
  profile === '1'
    ? ok('and a landlord profile, so the portal is not half-built on first login')
    : bad('no landlord profile was created');

  const reuse = await apiCall(API, 'POST', '/api/auth/phone/signup/complete', {
    ticket, fullName: 'Second Account', role: 'TENANT', acceptTerms: true,
  });
  reuse.status >= 400
    ? ok('the ticket cannot be spent twice')
    : bad('one proven number created a second account');

  // ── 6. And the number now signs in, which is the whole point ──────────
  const signin = await apiCall(API, 'POST', '/api/auth/phone/request-code', { phone: NEW_LOCAL });
  const otpHash = q(`SELECT a."tokenHash" FROM auth_tokens a JOIN users u ON u.id=a."userId" WHERE u.phone='${NEW_E164}' AND a.type='phone_otp' AND a."usedAt" IS NULL ORDER BY a."createdAt" DESC LIMIT 1`);
  let signinCode = null;
  for (let n = 0; n < 1000000 && otpHash; n++) {
    const candidate = String(n).padStart(6, '0');
    const h = crypto.createHmac('sha256', SECRET).update(`${NEW_E164}:${candidate}`).digest('hex');
    if (h === otpHash) { signinCode = candidate; break; }
  }
  if (signin.status === 200 && signinCode) {
    const back = await apiCall(API, 'POST', '/api/auth/phone/verify', { phone: NEW_LOCAL, code: signinCode });
    back.status === 200 && (back.body?.accessToken || back.body?.access_token)
      ? ok('an account created this way can then sign in by phone — the loop closes')
      : bad(`phone sign-in on the new account returned ${back.status}`);
  } else {
    bad('the new phone-only account could not be sent a sign-in code');
  }
}

// ── An expired ticket is refused ─────────────────────────────────────────
//
// Expiry cannot be waited out in a drive (twenty minutes), so it is forced in
// the database. The clock is the thing being tested, not the SQL.
await apiCall(API, 'POST', '/api/auth/phone/signup/request-code', { phone: `082126${S}` });
const expId = liveRow(`+2782126${S}`);
const expHash = q(`SELECT "codeHash" FROM phone_signups WHERE id='${expId}'`);
const expCode = recoverCode(expHash, `+2782126${S}`);
if (!expCode) {
  skip('the expired-ticket refusal', 'same JWT_SECRET mismatch as above.');
} else {
  const v = await apiCall(API, 'POST', '/api/auth/phone/signup/verify', { phone: `082126${S}`, code: expCode });
  q(`UPDATE phone_signups SET "ticketExpiresAt" = now() - interval '1 minute' WHERE id='${expId}'`);
  const late = await apiCall(API, 'POST', '/api/auth/phone/signup/complete', {
    ticket: v.body?.ticket, fullName: 'Too Late', role: 'TENANT', acceptTerms: true,
  });
  late.status >= 400 && q(`SELECT count(*) FROM users WHERE phone='+2782126${S}'`) === '0'
    ? ok('an expired ticket is refused and creates nothing')
    : bad(`an expired ticket was accepted (${late.status})`);
}

// ── Rate limiting exists at all ─────────────────────────────────────────
//
// Not a phone-signup check as such, and here because this is where it was found.
// Every @Throttle in this codebase was decoration: ThrottlerGuard was never
// registered, so eight requests to a route marked `limit: 5` all returned 200,
// and /auth/login had no decorator to be inert in the first place.
//
// Probed on /referrals/validate rather than an auth route because its window is
// a minute rather than fifteen, so this check leaves the next thing to run with
// a clean budget instead of a poisoned one. The recovery is asserted too: a
// limiter that never refills is a lockout with extra steps.
let limited = null;
for (let i = 1; i <= 26 && limited === null; i++) {
  const r = await apiCall(API, 'GET', `/api/referrals/validate?code=DRIVE${S}`);
  if (r.status === 429) limited = i;
}
limited !== null
  ? ok(`the rate limiter actually refuses (429 on request ${limited} of a 20-per-minute route)`)
  : bad('26 requests to a 20-per-minute route were all accepted — the throttle is decoration again');

if (limited !== null) {
  let recovered = false;
  for (let waited = 0; waited < 75 && !recovered; waited += 5) {
    await new Promise((r) => setTimeout(r, 5000));
    const r = await apiCall(API, 'GET', `/api/referrals/validate?code=DRIVE${S}`);
    if (r.status !== 429) recovered = true;
  }
  recovered
    ? ok('and the window refills, so a shared address is throttled rather than locked out')
    : bad('the limit never lifted within 75s on a 60s window');
}

// ── Abandoned sign-ups are thrown away, completed ones are kept ──────────
//
// This was a named skip at first — the prune runs on a cron and a drive cannot
// fire a cron. But "it is on a cron" is exactly the standard of proof behind
// the deletion claim this codebase had to go back and make true, and this is
// the same kind of promise: a mobile number belonging to somebody who never
// joined. So the prune got an admin endpoint, like the storage queue has, and
// the rule is checked rather than described.
//
// Both halves matter. An over-eager prune that also removed COMPLETED rows
// would delete the only evidence that an account holder accepted the terms.
const adm = await apiCall(API, 'POST', '/api/auth/login', {
  email: 'ci-admin@mastande.test', password: 'CiSmokeAdmin123',
});
const ADMIN = adm.body?.accessToken ?? adm.body?.access_token;

if (!ADMIN) {
  skip(
    'the retention rule for abandoned sign-ups',
    'no CI admin account on this database. Seed it (`npm --prefix backend run seed`) and re-run; ' +
    'without an admin token the prune endpoint cannot be called.',
  );
} else {
  // One abandoned attempt from two days ago, and one completed sign-up of the
  // same age that must survive it.
  const keeper = await registerUser(API, 'TENANT');
  q(`INSERT INTO phone_signups (id, phone, "expiresAt", "createdAt", "updatedAt") VALUES ('drive-old-${S}', '+2782130${S}', now(), now() - interval '2 days', now())`);
  q(`INSERT INTO phone_signups (id, phone, "expiresAt", "userId", "consentAcceptedAt", "createdAt", "updatedAt") VALUES ('drive-kept-${S}', '+2782131${S}', now(), '${keeper.id}', now() - interval '2 days', now() - interval '2 days', now())`);

  const before = await apiCall(API, 'GET', '/api/admin/phone-signups/status', undefined, ADMIN);
  Number(before.body?.overdue) >= 1
    ? ok('the admin status names a sign-up kept longer than a day, rather than reporting all clear')
    : bad(`status reported overdue=${before.body?.overdue} with a two-day-old abandoned row present`);

  const pruned = await apiCall(API, 'POST', '/api/admin/phone-signups/prune', {}, ADMIN);
  pruned.status === 201 || pruned.status === 200
    ? ok('the prune can be run on demand, not only by a cron nobody can watch')
    : bad(`prune returned ${pruned.status} ${JSON.stringify(pruned.body).slice(0, 160)}`);

  q(`SELECT count(*) FROM phone_signups WHERE id='drive-old-${S}'`) === '0'
    ? ok('and the abandoned attempt is gone — a number belonging to somebody who never joined')
    : bad('the abandoned sign-up survived the prune');

  q(`SELECT count(*) FROM phone_signups WHERE id='drive-kept-${S}'`) === '1'
    ? ok('while the completed one survives, because it is that account holder’s consent record')
    : bad('the prune deleted a consent record — the evidence that somebody accepted the terms');

  // And it goes when the account does, by cascade, which is the s.24 half.
  q(`DELETE FROM users WHERE id='${keeper.id}'`);
  q(`SELECT count(*) FROM phone_signups WHERE id='drive-kept-${S}'`) === '0'
    ? ok('and deleting the account takes the consent record with it (POPIA s.24)')
    : bad('the consent record outlived the account it belonged to');
}

// Tidy up: the per-run numbers make this unnecessary for correctness, but a
// drive that leaves accounts behind inflates every user count on the dev box.
q(`DELETE FROM users WHERE phone IN ('${NEW_E164}','${TAKEN_E164}','+2782126${S}')`);
q(`DELETE FROM phone_signups WHERE phone LIKE '+278212%${S}' OR phone='+2782999${S}'`);
q(`DELETE FROM users WHERE phone IN ('+2782127${S}','+2782128${S}')`);

if (skips.length) {
  console.log(`\n⏭️  ${skips.length} check(s) not run:`);
  for (const s of skips) console.log(`   • ${s.what} — ${s.why}`);
}
console.log(
  fail
    ? `\n❌ ${fail} failure(s)`
    : '\n✅ a phone-only person can create their own account, nobody else can create one for them, and the terms are theirs to accept',
);
process.exit(fail ? 1 : 0);
