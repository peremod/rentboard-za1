/**
 * A phone-only account: the lockout, the Google lie, and the way out — Phase 7o.
 *
 *   node scripts/phone-only-drive.mjs
 *
 * Needs the API on :3000, a DATABASE_URL and the API's own JWT_SECRET — codes
 * only ever go out over WhatsApp, which is not connected here, so they are
 * recovered from the stored HMAC. Skips by name rather than passing if the
 * secret does not match.
 *
 * ── What this drive is about
 *
 * Phase 7g gave a person with only a mobile number their own account: no email,
 * no password, the verified number as the single credential. It was bolted onto
 * a profile form written for accounts that have an email address. Measured
 * before this phase, on an account created through the product's own three-step
 * flow:
 *
 *   PATCH /api/users/me {"phone":""}             -> 500 Internal server error
 *   PATCH /api/users/me {"phone":<one digit out>} -> 200, and the account is gone
 *
 * and then: no sign-in (the number is un-verified and nobody holds it), no
 * forgot-password (no address), and a request for a code on the real number
 * answering "a code is on its way" while sending nothing — because that reply
 * is identical for a number with no account. A permanent, silent lockout from
 * one keystroke.
 *
 * Both ways off a phone-only account were also refused with "This account signs
 * in with Google", to people who have never seen Google.
 */
import crypto from 'crypto';
import { apiCall, dbQuery as q } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const skip = (m) => console.log('  ⏭  SKIP ' + m);

const S = String(Math.floor(Math.random() * 9000) + 1000);
const LOCAL = `082131${S}`, E164 = `+2782131${S}`;
const NEW_LOCAL = `082132${S}`, NEW_E164 = `+2782132${S}`;
const SECRET = process.env.JWT_SECRET ?? '';

const signupHash = (code, phone) =>
  crypto.createHmac('sha256', SECRET).update(`signup:${phone}:${code}`).digest('hex');
const otpHash = (code, phone) =>
  crypto.createHmac('sha256', SECRET).update(`${phone}:${code}`).digest('hex');

/** Brute-forces the six digits back out of a stored HMAC. */
function recover(hash, phone, scheme) {
  for (let n = 0; n < 1000000; n++) {
    const c = String(n).padStart(6, '0');
    if (scheme(c, phone) === hash) return c;
  }
  return null;
}

// ── 0. A real phone-only account, through the product's own flow ─────────
console.log('\n── 0. A phone-only account, made the way a person makes one ──');

await apiCall(API, 'POST', '/api/auth/phone/signup/request-code', { phone: LOCAL });
const sid = q(`SELECT id FROM phone_signups WHERE phone='${E164}' AND "userId" IS NULL AND "codeHash" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1`);
if (!sid) {
  skip('the whole drive — no phone_signups row, so the API is not reachable or the DB is wrong');
  process.exit(0);
}
const sCode = recover(q(`SELECT "codeHash" FROM phone_signups WHERE id='${sid}'`), E164, signupHash);
if (!sCode) {
  skip('the whole drive — the sign-up code could not be derived, so JWT_SECRET does not match the API');
  process.exit(0);
}
const ver = await apiCall(API, 'POST', '/api/auth/phone/signup/verify', { phone: LOCAL, code: sCode });
const done = await apiCall(API, 'POST', '/api/auth/phone/signup/complete',
  { ticket: ver.body?.ticket, fullName: 'Phone Only Landlord', role: 'LANDLORD', acceptTerms: true });
const token = done.body?.accessToken;
const uid = done.body?.user?.id;
token && uid ? ok('an account exists with a verified number') : bad(`signup/complete returned ${done.status}`);

const shape = q(`SELECT coalesce(email,'none')||'/'||coalesce("passwordHash",'none')||'/'||"phoneVerified"||'/'||"authProvider" FROM users WHERE id='${uid}'`);
shape === 'none/none/true/phone'
  ? ok('…and no email, no password, authProvider=phone (precondition, asserted)')
  : bad(`the account is not phone-only: ${shape} — every check below is about the wrong thing`);

// ── 1. The profile form cannot strand the only credential ───────────────
console.log('\n── 1. The field that used to lock people out ─────────────────');

const cleared = await apiCall(API, 'PATCH', '/api/users/me', { phone: '' }, token);
cleared.status === 400
  ? ok('clearing the only number is refused — it was a 500 from the database CHECK')
  : bad(`clearing the number returned ${cleared.status}, not 400`);
/lock you out|only way into/i.test(String(cleared.body?.message))
  ? ok('…with a sentence a person can act on, naming what to do first')
  : bad(`the refusal says ${JSON.stringify(cleared.body?.message)}`);

const typo = await apiCall(API, 'PATCH', '/api/users/me', { phone: NEW_LOCAL }, token);
typo.status === 400
  ? ok('mistyping it is refused — this returned 200 and ended the account')
  : bad(`changing the number through the profile form returned ${typo.status}`);
/change my number|send a code to the new/i.test(String(typo.body?.message))
  ? ok('…and points at the flow that confirms a new number first')
  : bad(`the refusal says ${JSON.stringify(typo.body?.message)}`);

q(`SELECT phone||'/'||"phoneVerified" FROM users WHERE id='${uid}'`) === `${E164}/true`
  ? ok('…and the account still has its working, verified number')
  : bad(`the account's number is now ${q(`SELECT phone||'/'||"phoneVerified" FROM users WHERE id='${uid}'`)}`);

// The check that proves it is not merely a stored string: a code really goes out.
await apiCall(API, 'POST', '/api/auth/phone/request-code', { phone: LOCAL });
const canStillIn = q(`SELECT count(*) FROM auth_tokens a JOIN users u ON u.id=a."userId" WHERE u.id='${uid}' AND a.type='phone_otp' AND a."usedAt" IS NULL`);
Number(canStillIn) > 0
  ? ok('…and asking for a sign-in code on it really sends one (nothing was sent before)')
  : bad('no sign-in code was issued — the reassuring 200 is all the person would get');

// ── 2. Adding an email, with no password to prove it with ───────────────
console.log('\n── 2. Adding an email later ──────────────────────────────────');

const NEW_EMAIL = `added${S}@example.co.za`;
const noCode = await apiCall(API, 'POST', '/api/auth/change-email',
  { newEmail: NEW_EMAIL, currentPassword: 'anything' }, token);
!/google/i.test(JSON.stringify(noCode.body))
  ? ok('the refusal no longer claims this is a Google account')
  : bad(`still told to change the address on a Google account: ${JSON.stringify(noCode.body?.message)}`);
noCode.status === 400 && /code on whatsapp|ask for a code/i.test(String(noCode.body?.message))
  ? ok('…it asks for a code on WhatsApp, which is the credential they have')
  : bad(`adding an email with no code returned ${noCode.status}: ${JSON.stringify(noCode.body?.message)}`);

await apiCall(API, 'POST', '/api/auth/phone/verify-number', {}, token);
const stepHash = q(`SELECT "tokenHash" FROM auth_tokens WHERE "userId"='${uid}' AND type='phone_otp' AND "usedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`);
const stepCode = recover(stepHash, E164, otpHash);

const wrongCode = await apiCall(API, 'POST', '/api/auth/change-email',
  { newEmail: NEW_EMAIL, phoneCode: '000000' }, token);
wrongCode.status === 400
  ? ok('a wrong code is refused')
  : bad(`a wrong step-up code returned ${wrongCode.status}`);

if (!stepCode) {
  skip('the rest of section 2 — the step-up code could not be derived');
} else {
  const added = await apiCall(API, 'POST', '/api/auth/change-email',
    { newEmail: NEW_EMAIL, phoneCode: stepCode }, token);
  added.status === 200
    ? ok('with the code, the address is accepted')
    : bad(`adding an email with a valid code returned ${added.status}: ${JSON.stringify(added.body)}`);

  // ⚠️ The address must NOT be on the account yet. A typo or somebody else's
  // address would otherwise start receiving this person's notifications.
  q(`SELECT coalesce(email,'none') FROM users WHERE id='${uid}'`) === 'none'
    ? ok('…and is NOT written to the account until it is confirmed at that address')
    : bad('the email landed on the account without being confirmed at the new address');

  const pending = q(`SELECT "newEmail" FROM auth_tokens WHERE "userId"='${uid}' AND type='email_change' AND "usedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`);
  pending === NEW_EMAIL
    ? ok('…it is a pending token carrying the address, confirmed by the round trip')
    : bad(`no pending email_change token for ${NEW_EMAIL} (got ${JSON.stringify(pending)})`);

  // The code is single-use: a second attempt on the same code must fail.
  const reuse = await apiCall(API, 'POST', '/api/auth/change-email',
    { newEmail: `other${S}@example.co.za`, phoneCode: stepCode }, token);
  reuse.status === 400
    ? ok('…and the code is spent, so it cannot add a second address')
    : bad(`the same step-up code worked twice (${reuse.status})`);
}

// ── 3. Setting a first password ─────────────────────────────────────────
console.log('\n── 3. Setting a first password ───────────────────────────────');

const pwNoCode = await apiCall(API, 'POST', '/api/auth/change-password',
  { currentPassword: 'anything', newPassword: 'FirstPass123' }, token);
!/google/i.test(JSON.stringify(pwNoCode.body))
  ? ok('"change password" no longer claims this is a Google account either')
  : bad(`still says Google: ${JSON.stringify(pwNoCode.body?.message)}`);
pwNoCode.status === 400 && /no password yet|ask for a code/i.test(String(pwNoCode.body?.message))
  ? ok('…it says there is no password yet and how to set one')
  : bad(`change-password returned ${pwNoCode.status}: ${JSON.stringify(pwNoCode.body?.message)}`);

/**
 * ⚠️ The code request is checked, and a refusal is named.
 *
 * Written without this, section 3 printed "the code could not be derived" and
 * skipped — which reads as a JWT_SECRET mismatch. It was not: `requestVerification`
 * allows three phone_otp codes per account per fifteen minutes, counting every
 * one including the sign-in code section 1 asks for, and this was the fourth.
 * The limiter was working. A skip that blames the wrong thing sends the next
 * person to look at the secret, so the reason is now reported.
 */
const pwReq = await apiCall(API, 'POST', '/api/auth/phone/verify-number', {}, token);
const pwHash = pwReq.status === 200
  ? q(`SELECT "tokenHash" FROM auth_tokens WHERE "userId"='${uid}' AND type='phone_otp' AND "usedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`)
  : '';
const pwCode = pwHash ? recover(pwHash, E164, otpHash) : null;
if (pwReq.status !== 200) {
  skip(`the rest of section 3 — no code could be requested: ${pwReq.status} ${JSON.stringify(pwReq.body?.message)}`);
} else if (!pwCode) {
  skip('the rest of section 3 — a code was issued but could not be derived, so JWT_SECRET does not match the API');
} else {
  const set = await apiCall(API, 'POST', '/api/auth/change-password',
    { newPassword: 'FirstPass123', phoneCode: pwCode }, token);
  set.status === 200
    ? ok('with a code, a first password is set')
    : bad(`setting a first password returned ${set.status}: ${JSON.stringify(set.body)}`);
  q(`SELECT CASE WHEN "passwordHash" IS NULL THEN 'none' ELSE 'set' END FROM users WHERE id='${uid}'`) === 'set'
    ? ok('…and it is really on the account, not just a message')
    : bad('the password was reported set and the column is still null');
}

// ── 4. Changing the number, proven before it lands ──────────────────────
console.log('\n── 4. Changing the number ────────────────────────────────────');

const req = await apiCall(API, 'POST', '/api/auth/phone/change/request-code', { newPhone: NEW_LOCAL }, token);
req.status === 200
  ? ok('a code can be sent to a new number')
  : bad(`change/request-code returned ${req.status}: ${JSON.stringify(req.body)}`);

q(`SELECT phone FROM users WHERE id='${uid}'`) === E164
  ? ok('…and the account still has the OLD number while that code is outstanding')
  : bad('asking for the code already moved the account');

const chHash = q(`SELECT "tokenHash" FROM auth_tokens WHERE "userId"='${uid}' AND type='phone_change' AND "usedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`);
q(`SELECT "newPhone" FROM auth_tokens WHERE "tokenHash"='${chHash}'`) === NEW_E164
  ? ok('…the pending token carries the number being proven')
  : bad('the phone_change token has no newPhone — the CHECK constraint should have stopped that');

const wrong = await apiCall(API, 'POST', '/api/auth/phone/change/confirm', { code: '000000' }, token);
wrong.status === 400
  ? ok('a wrong code is refused')
  : bad(`a wrong change code returned ${wrong.status}`);
Number(q(`SELECT attempts FROM auth_tokens WHERE "tokenHash"='${chHash}'`)) === 1
  ? ok('…and counted against the token, not against an IP')
  : bad(`attempts is ${q(`SELECT attempts FROM auth_tokens WHERE "tokenHash"='${chHash}'`)} after one wrong code`);

const chCode = recover(chHash, NEW_E164, otpHash);
if (!chCode) {
  skip('the rest of section 4 — the change code could not be derived');
} else {
  const conf = await apiCall(API, 'POST', '/api/auth/phone/change/confirm', { code: chCode }, token);
  conf.status === 200
    ? ok('the right code switches the number')
    : bad(`change/confirm returned ${conf.status}: ${JSON.stringify(conf.body)}`);
  q(`SELECT phone||'/'||"phoneVerified" FROM users WHERE id='${uid}'`) === `${NEW_E164}/true`
    ? ok('…and it arrives ALREADY VERIFIED — the un-verified window was the lockout')
    : bad(`after confirming, the account is ${q(`SELECT phone||'/'||"phoneVerified" FROM users WHERE id='${uid}'`)}`);

  await apiCall(API, 'POST', '/api/auth/phone/request-code', { phone: NEW_LOCAL });
  Number(q(`SELECT count(*) FROM auth_tokens WHERE "userId"='${uid}' AND type='phone_otp' AND "usedAt" IS NULL`)) > 0
    ? ok('…and the new number can sign in')
    : bad('the new number cannot sign in after the change');
}

// ── 5. A number somebody else has verified ──────────────────────────────
console.log('\n── 5. A number that is already somebody else’s ───────────────');

const TAKEN_LOCAL = `082133${S}`, TAKEN_E164 = `+2782133${S}`;
const other = q(`SELECT id FROM users WHERE "authProvider"='email' AND "deletedAt" IS NULL ORDER BY random() LIMIT 1`);
q(`UPDATE users SET phone='${TAKEN_E164}', "phoneVerified"=true WHERE id='${other}'`);
const clash = await apiCall(API, 'POST', '/api/auth/phone/change/request-code', { newPhone: TAKEN_LOCAL }, token);
clash.status === 400
  ? ok('moving to a number verified on another account is refused')
  : bad(`a clashing number returned ${clash.status} — two accounts on one number is a takeover`);
q(`UPDATE users SET phone=NULL, "phoneVerified"=false WHERE id='${other}'`);

// ── 6. A real Google account still hears about Google ───────────────────
console.log('\n── 6. The Google message is still right for Google ───────────');

q(`UPDATE users SET "authProvider"='google', "passwordHash"=NULL WHERE id='${uid}'`);
const g = await apiCall(API, 'POST', '/api/auth/change-email', { newEmail: `g${S}@example.co.za` }, token);
/google/i.test(String(g.body?.message))
  ? ok('an account with authProvider=google is still told to change it on Google')
  : bad(`a Google account was told: ${JSON.stringify(g.body?.message)} — the fix went too far`);
q(`UPDATE users SET "authProvider"='phone' WHERE id='${uid}'`);

console.log(fail ? `\n❌ ${fail} failure(s)` : '\n✅ a phone-only account can be looked after');
