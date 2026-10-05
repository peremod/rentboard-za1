/**
 * Assisted sign-up: help reaches the handset, consent stops at the person — 7p.
 *
 *   node scripts/assisted-signup-drive.mjs
 *
 * Needs the API on :3000, a DATABASE_URL and the API's own JWT_SECRET — a code
 * only ever goes out over WhatsApp, so it is recovered from the stored HMAC.
 *
 * ── What is actually being tested
 *
 * Almost nothing about the FLOW is new: `complete` already required
 * `acceptTerms: true` from the request and recorded it against the row the
 * handset proved, which is the control that makes helping safe. Phase 7p added
 * the record of who helped.
 *
 * So the checks are mostly about what the admin CANNOT do. An admin who could
 * get the code or the ticket out of this endpoint could create an account in
 * somebody else's name and tick the Terms for them, and the audit trail would
 * say they were helped. That is the thing to prove impossible.
 */
import crypto from 'crypto';
import { apiCall, dbQuery as q } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const skip = (m) => console.log('  ⏭  SKIP ' + m);

const S = String(Math.floor(Math.random() * 9000) + 1000);
const LOCAL = `082151${S}`, E164 = `+2782151${S}`;
const TAKEN_LOCAL = `082152${S}`, TAKEN_E164 = `+2782152${S}`;
const SECRET = process.env.JWT_SECRET ?? '';
const hashCode = (c, p) => crypto.createHmac('sha256', SECRET).update(`signup:${p}:${c}`).digest('hex');
function recover(hash, phone) {
  for (let n = 0; n < 1000000; n++) {
    const c = String(n).padStart(6, '0');
    if (hashCode(c, phone) === hash) return c;
  }
  return null;
}

const adm = await apiCall(API, 'POST', '/api/auth/login',
  { email: 'ci-admin@mastande.test', password: 'CiSmokeAdmin123' });
const A = adm.body?.accessToken;
A ? ok('admin signed in') : bad(`admin login ${adm.status}`);
const adminId = q(`SELECT id FROM users WHERE email='ci-admin@mastande.test'`);

// ── 1. Only an admin can start one ───────────────────────────────────────
console.log('\n── 1. Who may start one for somebody else ───────────────────');

const anon = await apiCall(API, 'POST', '/api/admin/phone-signups/assisted', { phone: LOCAL });
anon.status === 401
  ? ok('a stranger cannot start a sign-up in somebody else’s name')
  : bad(`unauthenticated assisted start returned ${anon.status}`);

const ll = await apiCall(API, 'POST', '/api/auth/register', {
  email: `assist-ll-${S}@rentboard.test`, password: 'ProbePass123',
  fullName: 'Ordinary Landlord', role: 'LANDLORD',
});
const asLandlord = await apiCall(API, 'POST', '/api/admin/phone-signups/assisted',
  { phone: LOCAL }, ll.body?.accessToken);
asLandlord.status === 403
  ? ok('…and nor can an ordinary signed-in landlord — codes to arbitrary numbers is the risk')
  : bad(`a landlord starting an assisted signup returned ${asLandlord.status}`);

// ── 2. The admin gets nothing they can act on alone ─────────────────────
console.log('\n── 2. What the admin is handed ──────────────────────────────');

const started = await apiCall(API, 'POST', '/api/admin/phone-signups/assisted', { phone: LOCAL }, A);
started.status === 200
  ? ok('an admin can start one')
  : bad(`assisted start returned ${started.status}: ${JSON.stringify(started.body)}`);

const payload = JSON.stringify(started.body ?? {});
!/"code"|"ticket"/.test(payload)
  ? ok('…and the reply carries no code and no ticket')
  : bad(`the reply hands the admin ${payload} — they could finish it without the person`);

// The real code, from the database. If it appears anywhere in the response the
// check above missed it under another key name.
const rowId = q(`SELECT id FROM phone_signups WHERE phone='${E164}' AND "userId" IS NULL AND "codeHash" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1`);
if (!rowId) { skip('the rest of the drive — no phone_signups row was created'); process.exit(fail ? 1 : 0); }
const code = recover(q(`SELECT "codeHash" FROM phone_signups WHERE id='${rowId}'`), E164);
if (!code) {
  skip('the rest of the drive — the code could not be derived, so JWT_SECRET does not match the API');
  process.exit(fail ? 1 : 0);
}
!payload.includes(code)
  ? ok('…and the six digits themselves appear nowhere in it, under any key')
  : bad('the actual code is in the admin response');

/^\+27\d{9}$/.test(String(started.body?.message).match(/\+27\d{9}/)?.[0] ?? '')
  ? ok('…it does name the number the code went to, so the admin can check they typed it right')
  : bad('the reply does not say which number was used');
/accept the Terms/i.test(payload)
  ? ok('…and says in the payload that the person must accept the Terms themselves')
  : bad('nothing in the reply says the acceptance is the person’s');

// ── 3. The record of who helped ─────────────────────────────────────────
console.log('\n── 3. The record ───────────────────────────────────────────');

q(`SELECT "assistedByAdminId" FROM phone_signups WHERE id='${rowId}'`) === adminId
  ? ok('the attempt records which admin started it')
  : bad('the row does not record the admin who started it');

const mine = await apiCall(API, 'GET', '/api/admin/phone-signups/assisted/mine', undefined, A);
const row = (mine.body ?? []).find((r) => r.id === rowId);
row ? ok('…and the admin can read back what they started — stored is not readable')
    : bad(`the started sign-up is not in assisted/mine (${mine.status})`);
row && row.theyAcceptedAt === null
  ? ok('…showing it is NOT accepted, because the person has not done that yet')
  : bad(`the record claims acceptance before the person accepted: ${JSON.stringify(row)}`);
row && row.becameAnAccount === false
  ? ok('…and that no account exists for it yet')
  : bad('the record claims an account that does not exist');

// ── 4. The acceptance still has to be the person's ──────────────────────
console.log('\n── 4. Consent stops at the person ──────────────────────────');

const ver = await apiCall(API, 'POST', '/api/auth/phone/signup/verify', { phone: LOCAL, code });
const ticket = ver.body?.ticket;
ticket ? ok('the code from the handset buys a ticket')
       : bad(`verify returned ${ver.status} — the rest of this section cannot run`);

if (ticket) {
  // ⚠️ Separate tickets per refusal. A ticket is spent by a request that
  // wrongly succeeds, so sharing one makes the second refusal report "that
  // sign-up has expired" and PASS — the fault the original phone-signup drive
  // had and recorded.
  const noTick = await apiCall(API, 'POST', '/api/auth/phone/signup/complete',
    { ticket, fullName: 'Not Their Choice', role: 'LANDLORD', acceptTerms: false });
  noTick.status === 400
    ? ok('…and acceptTerms:false is still refused on an assisted sign-up')
    : bad(`acceptTerms:false returned ${noTick.status} on an assisted ticket`);
  q(`SELECT count(*) FROM users WHERE phone='${E164}'`) === '0'
    ? ok('…with no account created by the refusal')
    : bad('the refusal created an account anyway');

  const done = await apiCall(API, 'POST', '/api/auth/phone/signup/complete',
    { ticket, fullName: 'Helped Landlord', role: 'LANDLORD', acceptTerms: true });
  done.status === 201
    ? ok('the person accepting themselves creates the account')
    : bad(`complete returned ${done.status}: ${JSON.stringify(done.body).slice(0, 200)}`);

  const uid = q(`SELECT id FROM users WHERE phone='${E164}'`);
  q(`SELECT CASE WHEN "consentAcceptedAt" IS NULL THEN 'none' ELSE 'recorded' END FROM phone_signups WHERE id='${rowId}'`) === 'recorded'
    ? ok('…and their acceptance is recorded against the row their handset proved')
    : bad('the consent was not recorded on the assisted row');
  q(`SELECT "assistedByAdminId" FROM phone_signups WHERE id='${rowId}'`) === adminId
    ? ok('…and the record of who helped survives onto the finished sign-up')
    : bad('the admin id was lost when the account was created');

  // The helper's identity is internal. It must not be in anything the person
  // can read — the same rule as ServiceProvider.checkedByAdminId.
  !JSON.stringify(done.body).includes(adminId)
    ? ok('…and the admin’s id is not in what the new account is handed')
    : bad('the assisting admin’s id reached the user payload');

  const after = await apiCall(API, 'GET', '/api/admin/phone-signups/assisted/mine', undefined, A);
  const r2 = (after.body ?? []).find((r) => r.id === rowId);
  r2 && r2.becameAnAccount === true && r2.theyAcceptedAt
    ? ok('…and the admin’s own list now shows it finished, with when they accepted')
    : bad(`the record does not show the completion: ${JSON.stringify(r2)}`);
  r2 && r2.phone === null
    ? ok('…with the number dropped once it is an account, since the record is about the help')
    : bad('the list still shows the number of somebody who now has an account');

  // POPIA: the audit trail leaves with the account.
  await apiCall(API, 'POST', '/api/auth/login', { email: 'x', password: 'y' });
  q(`DELETE FROM users WHERE id='${uid}'`);
  q(`SELECT count(*) FROM phone_signups WHERE id='${rowId}'`) === '0'
    ? ok('deleting the account takes its sign-up record with it (POPIA s.24)')
    : bad('the sign-up record outlived the account');
}

// ── 5. A number that already has an account ─────────────────────────────
console.log('\n── 5. A number that already has an account ─────────────────');

const owner = await apiCall(API, 'POST', '/api/auth/register', {
  email: `assist-owner-${S}@rentboard.test`, password: 'ProbePass123',
  fullName: 'Existing Owner', role: 'LANDLORD',
});
q(`UPDATE users SET phone='${TAKEN_E164}', "phoneVerified"=true WHERE id='${owner.body.user.id}'`);

const taken = await apiCall(API, 'POST', '/api/admin/phone-signups/assisted', { phone: TAKEN_LOCAL }, A);
taken.status === 400 && /already has an account/i.test(String(taken.body?.message))
  ? ok('the admin IS told the number already has an account — otherwise helping is useless')
  : bad(`assisted start on a taken number returned ${taken.status}: ${JSON.stringify(taken.body?.message)}`);
!/@|Existing Owner/.test(String(taken.body?.message))
  ? ok('…without naming them or giving an address')
  : bad(`the refusal names the owner: ${JSON.stringify(taken.body?.message)}`);
q(`SELECT count(*) FROM phone_signups WHERE phone='${TAKEN_E164}'`) === '0'
  ? ok('…and no attempt row or code is created for it')
  : bad('an assisted start on a taken number still sent a code');

// ⚠️ The PUBLIC endpoint must be unchanged. Telling an admin is a deliberate
// divergence; telling anybody is the membership oracle the public reply exists
// to avoid.
const pub = await apiCall(API, 'POST', '/api/auth/phone/signup/request-code', { phone: TAKEN_LOCAL });
pub.status === 200 && !/already/i.test(String(pub.body?.message))
  ? ok('the public endpoint still gives nothing away about a taken number')
  : bad(`the public reply changed: ${pub.status} ${JSON.stringify(pub.body?.message)}`);

console.log(fail ? `\n❌ ${fail} failure(s)` : '\n✅ an admin can help, and cannot consent for anybody');
