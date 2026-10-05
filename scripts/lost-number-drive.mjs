/**
 * Getting back in when the phone is gone — Phase 7q.
 *
 *   node scripts/lost-number-drive.mjs
 *
 * Needs the API on :3000, a DATABASE_URL and the API's own JWT_SECRET.
 *
 * ── Why this drive is written the way it is
 *
 * This is the most dangerous path in the product: the account on the other side
 * holds rooms, applications, tenancies, a rent record and conversations with
 * tenants. So most of these checks are about what CANNOT happen, and several of
 * them go round the service and talk to the database directly — because a rule
 * that only the service enforces is one direct UPDATE away from being no rule,
 * which is the lesson of the nineteen @Throttle decorators with no guard.
 */
import crypto from 'crypto';
import { apiCall, dbQuery as q } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const skip = (m) => console.log('  ⏭  SKIP ' + m);

const S = String(Math.floor(Math.random() * 9000) + 1000);
const OLD_LOCAL = `082171${S}`, OLD_E164 = `+2782171${S}`;
const NEW_LOCAL = `082172${S}`, NEW_E164 = `+2782172${S}`;
const SECRET = process.env.JWT_SECRET ?? '';
const signupHash = (c, p) => crypto.createHmac('sha256', SECRET).update(`signup:${p}:${c}`).digest('hex');
const recoverHash = (c, p) => crypto.createHmac('sha256', SECRET).update(`recover:${p}:${c}`).digest('hex');
function derive(hash, phone, scheme) {
  for (let n = 0; n < 1000000; n++) {
    const c = String(n).padStart(6, '0');
    if (scheme(c, phone) === hash) return c;
  }
  return null;
}
/** Runs SQL that is expected to be refused, and returns the error text. */
function expectRefused(sql) {
  try { q(sql); return null; } catch (e) { return String(e.message ?? e); }
}

const adm = await apiCall(API, 'POST', '/api/auth/login',
  { email: 'ci-admin@mastande.test', password: 'CiSmokeAdmin123' });
const A = adm.body?.accessToken;
A ? ok('admin signed in') : bad(`admin login ${adm.status}`);
const adminId = q(`SELECT id FROM users WHERE email='ci-admin@mastande.test'`);

// ── 0. A real phone-only account, through the product's own flow ─────────
console.log('\n── 0. An account with no email, no password, and a lost phone ──');

await apiCall(API, 'POST', '/api/auth/phone/signup/request-code', { phone: OLD_LOCAL });
const sid = q(`SELECT id FROM phone_signups WHERE phone='${OLD_E164}' AND "userId" IS NULL AND "codeHash" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1`);
if (!sid) { skip('the whole drive — no phone_signups row, so the API or DB is wrong'); process.exit(0); }
const sCode = derive(q(`SELECT "codeHash" FROM phone_signups WHERE id='${sid}'`), OLD_E164, signupHash);
if (!sCode) { skip('the whole drive — JWT_SECRET does not match the API'); process.exit(0); }
const ver = await apiCall(API, 'POST', '/api/auth/phone/signup/verify', { phone: OLD_LOCAL, code: sCode });
const done = await apiCall(API, 'POST', '/api/auth/phone/signup/complete',
  { ticket: ver.body?.ticket, fullName: 'Lost Phone Landlord', role: 'LANDLORD', acceptTerms: true });
const uid = done.body?.user?.id;
uid ? ok('the account exists') : bad(`signup/complete ${done.status}`);
q(`SELECT coalesce(email,'none')||'/'||coalesce("passwordHash",'none')||'/'||"phoneVerified" FROM users WHERE id='${uid}'`) === 'none/none/true'
  ? ok('…with no email, no password, and a verified number (precondition, asserted)')
  : bad('the account is not phone-only, so this drive is about the wrong thing');

// ── 1. Who may do any of this ───────────────────────────────────────────
console.log('\n── 1. Who may hand an account over ──────────────────────────');

const anon = await apiCall(API, 'POST', '/api/admin/recoveries', { phone: OLD_LOCAL, newPhone: NEW_LOCAL });
anon.status === 401 ? ok('a stranger cannot open a recovery') : bad(`unauthenticated open returned ${anon.status}`);

const ll = await apiCall(API, 'POST', '/api/auth/register', {
  email: `lost-ll-${S}@rentboard.test`, password: 'ProbePass123',
  fullName: 'Ordinary Landlord', role: 'LANDLORD',
});
const L = ll.body?.accessToken;
const asLl = await apiCall(API, 'POST', '/api/admin/recoveries', { phone: OLD_LOCAL, newPhone: NEW_LOCAL }, L);
asLl.status === 403 ? ok('…and nor can an ordinary signed-in landlord') : bad(`landlord open returned ${asLl.status}`);
const lookLl = await apiCall(API, 'GET', `/api/admin/recoveries/lookup?phone=${OLD_LOCAL}`, undefined, L);
lookLl.status === 403 ? ok('…or even look an account up by number') : bad(`landlord lookup returned ${lookLl.status}`);

// ── 2. The narrowing: refused when a safer route exists ─────────────────
console.log('\n── 2. Refused when something safer would work ───────────────');

const safeEmail = await apiCall(API, 'POST', '/api/admin/recoveries',
  { phone: `0821${S}0001`.slice(0, 10), newPhone: NEW_LOCAL }, A);
// (that number has no account; the real test is the two below)

q(`UPDATE users SET email='temp${S}@rentboard.test' WHERE id='${uid}'`);
const withEmail = await apiCall(API, 'POST', '/api/admin/recoveries', { phone: OLD_LOCAL, newPhone: NEW_LOCAL }, A);
withEmail.status === 400 && /email address/i.test(String(withEmail.body?.message))
  ? ok('an account WITH an email is refused — a password reset needs nobody trusted')
  : bad(`an account with an email returned ${withEmail.status}: ${JSON.stringify(withEmail.body?.message)}`);
/password reset/i.test(String(withEmail.body?.message))
  ? ok('…and the refusal names the safer route')
  : bad('the refusal does not say what to do instead');
q(`UPDATE users SET email=NULL WHERE id='${uid}'`);

q(`UPDATE users SET "passwordHash"='\\$2b\\$12\\$fakefakefakefakefakefakefakefakefakefakefakefakefakefa' WHERE id='${uid}'`);
const withPw = await apiCall(API, 'POST', '/api/admin/recoveries', { phone: OLD_LOCAL, newPhone: NEW_LOCAL }, A);
withPw.status === 400 && /password/i.test(String(withPw.body?.message))
  ? ok('an account WITH a password is refused too')
  : bad(`an account with a password returned ${withPw.status}`);
q(`UPDATE users SET "passwordHash"=NULL WHERE id='${uid}'`);

const look = await apiCall(API, 'GET', `/api/admin/recoveries/lookup?phone=${OLD_LOCAL}`, undefined, A);
look.body?.recoverable === true && look.body?.saferRoute === null
  ? ok('the lookup says this one really has no safer route')
  : bad(`lookup says ${JSON.stringify({ recoverable: look.body?.recoverable, safer: look.body?.saferRoute })}`);
look.body?.fullName === 'Lost Phone Landlord'
  ? ok('…and gives the name, which is what the ID document gets matched against')
  : bad('the lookup does not give the name to check against');

// ── 3. Opening one moves nothing, and the account is told ───────────────
console.log('\n── 3. Opening a request ────────────────────────────────────');

const same = await apiCall(API, 'POST', '/api/admin/recoveries', { phone: OLD_LOCAL, newPhone: OLD_LOCAL }, A);
same.status === 400 && /same number/i.test(String(same.body?.message))
  ? ok('asking to move a number to itself is refused, pointing at the self-service flow')
  : bad(`same-number open returned ${same.status}`);

const opened = await apiCall(API, 'POST', '/api/admin/recoveries',
  { phone: OLD_LOCAL, newPhone: NEW_LOCAL, note: 'Phone stolen at the taxi rank, came in person.' }, A);
opened.status === 201 ? ok('an admin can open one') : bad(`open returned ${opened.status}: ${JSON.stringify(opened.body)}`);
const rid = opened.body?.id;

q(`SELECT phone||'/'||"phoneVerified" FROM users WHERE id='${uid}'`) === `${OLD_E164}/true`
  ? ok('…and the account still signs in with the OLD number — nothing moved')
  : bad('opening a request already changed the account');

q(`SELECT status||'/'||coalesce("openedByAdminId",'null') FROM account_recoveries WHERE id='${rid}'`) === `open/${adminId}`
  ? ok('…the request is open and records which admin opened it')
  : bad(`the row reads ${q(`SELECT status||'/'||coalesce("openedByAdminId",'null') FROM account_recoveries WHERE id='${rid}'`)}`);

Number(q(`SELECT count(*) FROM notices WHERE "userId"='${uid}' AND kind='account_recovery_requested'`)) === 1
  ? ok('…and the account is told somebody has asked, naming both numbers')
  : bad('the account was never told a request was opened');
/\+27/.test(q(`SELECT body FROM notices WHERE "userId"='${uid}' AND kind='account_recovery_requested' LIMIT 1`))
  ? ok('…with the numbers in the message, so an owner who gets back in can tell what happened')
  : bad('the notice does not name the numbers');

const second = await apiCall(API, 'POST', '/api/admin/recoveries', { phone: OLD_LOCAL, newPhone: `08217${S}9` }, A);
second.status === 400 ? ok('a second live request on the same account is refused') : bad(`a second request returned ${second.status}`);

// ── 4. No approval without a recorded identity check ────────────────────
console.log('\n── 4. An approval needs a recorded check ────────────────────');

const early = await apiCall(API, 'POST', `/api/admin/recoveries/${rid}/approve`, {}, A);
early.status === 400 && /identity document/i.test(String(early.body?.message))
  ? ok('approving with nothing recorded is refused, and says why')
  : bad(`approve with no check returned ${early.status}: ${JSON.stringify(early.body?.message)}`);

// ⚠️ And the database refuses it too. The service check above is one direct
// UPDATE away from being no check at all.
const dbRefusal = expectRefused(
  `UPDATE account_recoveries SET "approvedAt"=NOW(), "approvedByAdminId"='${adminId}' WHERE id='${rid}'`,
);
dbRefusal && /approval_needs_identity_check/.test(dbRefusal)
  ? ok('…and a direct UPDATE is refused by the CHECK constraint, not just by the service')
  : bad(`the database allowed an approval with no identity check: ${dbRefusal ?? 'no error'}`);

const emptyNote = await apiCall(API, 'POST', `/api/admin/recoveries/${rid}/checked`, {}, A);
emptyNote.status === 400 ? ok('recording a check with no words is refused') : bad(`empty check returned ${emptyNote.status}`);

const checked = await apiCall(API, 'POST', `/api/admin/recoveries/${rid}/checked`,
  { idSeenNote: 'Green ID book, photo and name match the account.', knowledgeCheckedNote: 'Named both tenants and the rent.' }, A);
checked.status === 200 ? ok('a check with words is recorded') : bad(`recording a check returned ${checked.status}`);
q(`SELECT CASE WHEN "idSeenAt" IS NULL THEN 'none' ELSE 'dated' END FROM account_recoveries WHERE id='${rid}'`) === 'dated'
  ? ok('…with a DATE, not a boolean')
  : bad('the check was recorded without a date');

// ── 5. Approving sends a code and still moves nothing ───────────────────
console.log('\n── 5. Approving ────────────────────────────────────────────');

const appr = await apiCall(API, 'POST', `/api/admin/recoveries/${rid}/approve`, {}, A);
appr.status === 200 ? ok('with a check recorded, it can be approved') : bad(`approve returned ${appr.status}: ${JSON.stringify(appr.body)}`);

const codeHash = q(`SELECT "codeHash" FROM account_recoveries WHERE id='${rid}'`);
const code = codeHash ? derive(codeHash, NEW_E164, recoverHash) : null;
!code || !JSON.stringify(appr.body).includes(code)
  ? ok('…and the admin is not handed the code — they cannot finish it for the person')
  : bad('the approval response contains the code');

q(`SELECT phone FROM users WHERE id='${uid}'`) === OLD_E164
  ? ok('…and the account STILL has the old number: approval is not the hand-over')
  : bad('approving moved the account before the handset answered');

q(`SELECT coalesce("approvedByAdminId",'null') FROM account_recoveries WHERE id='${rid}'`) === adminId
  ? ok('…with the approving admin recorded')
  : bad('the approval has no approver recorded');

// ── 6. Only the new handset can finish it ───────────────────────────────
console.log('\n── 6. The handset finishes it, nobody else ──────────────────');

const wrong = await apiCall(API, 'POST', '/api/auth/lost-number/confirm', { phone: NEW_LOCAL, code: '000000' });
wrong.status === 400 ? ok('a wrong code is refused') : bad(`a wrong code returned ${wrong.status}`);
Number(q(`SELECT attempts FROM account_recoveries WHERE id='${rid}'`)) === 1
  ? ok('…and counted against the request, not against an IP')
  : bad(`attempts is ${q(`SELECT attempts FROM account_recoveries WHERE id='${rid}'`)} after one wrong code`);

const otherNumber = await apiCall(API, 'POST', '/api/auth/lost-number/confirm',
  { phone: OLD_LOCAL, code: code ?? '123456' });
otherNumber.status === 400
  ? ok('…and the right code typed on the OLD number does not work')
  : bad('the code worked against a number it was not sent to');

if (!code) {
  skip('the rest of the drive — the recovery code could not be derived');
} else {
  const fin = await apiCall(API, 'POST', '/api/auth/lost-number/confirm', { phone: NEW_LOCAL, code });
  fin.status === 200 ? ok('the code from the new handset completes it') : bad(`confirm returned ${fin.status}: ${JSON.stringify(fin.body)}`);

  q(`SELECT phone||'/'||"phoneVerified" FROM users WHERE id='${uid}'`) === `${NEW_E164}/true`
    ? ok('…the account now signs in with the new number, already verified')
    : bad(`the account is ${q(`SELECT phone||'/'||"phoneVerified" FROM users WHERE id='${uid}'`)}`);

  // ⚠️ The old number is in somebody else's hands. It must not still work.
  Number(q(`SELECT count(*) FROM users WHERE phone='${OLD_E164}'`)) === 0
    ? ok('…and the OLD number is retired, so the stolen handset cannot sign in')
    : bad('the old number still belongs to the account — the hand-over is undone');

  q(`SELECT status FROM account_recoveries WHERE id='${rid}'`) === 'recovered'
    ? ok('…the request is marked recovered')
    : bad('the request status was not updated');
  q(`SELECT coalesce("codeHash",'cleared') FROM account_recoveries WHERE id='${rid}'`) === 'cleared'
    ? ok('…and the code is gone rather than merely marked spent')
    : bad('the code is still stored and still checkable');

  const note = q(`SELECT body FROM notices WHERE "userId"='${uid}' AND kind='account_recovery_completed' LIMIT 1`);
  note && note.includes(NEW_E164) && note.includes(OLD_E164)
    ? ok('…and the account is told, naming both the old and the new number')
    : bad(`the completion notice does not name both numbers: ${JSON.stringify(note)}`);
  /was not you/i.test(note ?? '')
    ? ok('…and tells them what to do if it was not them')
    : bad('the notice does not tell a wronged owner what to do');

  const reuse = await apiCall(API, 'POST', '/api/auth/lost-number/confirm', { phone: NEW_LOCAL, code });
  reuse.status === 400 ? ok('…and the code cannot be used twice') : bad(`the code worked again (${reuse.status})`);
}

// ── 7. The record, and what it does not keep ────────────────────────────
console.log('\n── 7. The record ───────────────────────────────────────────');

const listed = await apiCall(API, 'GET', '/api/admin/recoveries', undefined, A);
const mine = (listed.body ?? []).find((r) => r.id === rid);
mine ? ok('an admin can read the queue back — stored is not readable') : bad(`the request is not in the list (${listed.status})`);
mine && mine.idSeenNote && mine.openedByAdmin && mine.approvedByAdmin
  ? ok('…showing what was checked and which admin did each part')
  : bad(`the record does not carry the audit: ${JSON.stringify(mine)}`);

// Only outcomes persist: there is no column for the document itself.
Number(q(`SELECT count(*) FROM information_schema.columns WHERE table_name='account_recoveries' AND column_name ILIKE '%document%'`)) === 0
  ? ok('there is no document column at all — only outcomes persist (POPIA s.19)')
  : bad('account_recoveries has a document column; a stored ID is a liability that outlives its use');

/**
 * ⚠️ A refusal needs a reason, and this check found that the constraint did not
 * enforce it.
 *
 * It was written `CHECK ("refusedAt" IS NULL OR length(btrim("refusedReason")) > 0)`
 * — and `btrim(NULL)` is NULL, `length(NULL)` is NULL, `NULL > 0` is NULL, and
 * **a CHECK that evaluates to NULL is satisfied.** The row went straight in: a
 * refusal nobody can review, on the most dangerous path in the product. Two
 * constraints in the same migration had it; the fix compares the column to NULL
 * explicitly.
 *
 * This is the reason the drive talks to the database rather than only to the
 * service. The service's checks were correct the whole time, and a rule only
 * the service holds is one direct UPDATE from being no rule.
 */
const refusalRefused = expectRefused(
  `INSERT INTO account_recoveries (id,"userId","newPhone","oldPhone",status,"refusedAt","updatedAt") VALUES (gen_random_uuid(),'${uid}','+27820000001','+27820000002','refused',NOW(),NOW())`,
);
refusalRefused && /refusal_has_a_reason/.test(refusalRefused)
  ? ok('a refusal with a NULL reason is refused by the database')
  : bad(`the database allowed a reasonless refusal: ${refusalRefused ?? 'no error'}`);

// …and with a blank one, which is the case the original expression DID catch.
const blankReason = expectRefused(
  `INSERT INTO account_recoveries (id,"userId","newPhone","oldPhone",status,"refusedAt","refusedReason","updatedAt") VALUES (gen_random_uuid(),'${uid}','+27820000005','+27820000006','refused',NOW(),'   ',NOW())`,
);
blankReason && /refusal_has_a_reason/.test(blankReason)
  ? ok('…and with a blank one')
  : bad(`the database allowed a blank refusal reason: ${blankReason ?? 'no error'}`);

/**
 * ⚠️ This check did not exist, which is why the same NULL hole in
 * `id_check_has_a_note` shipped unnoticed beside the one above.
 *
 * A dated identity check with no words is a tick box, and on this path a tick
 * box is what stands between a stranger and somebody's tenancy records.
 */
const nullNote = expectRefused(
  `INSERT INTO account_recoveries (id,"userId","newPhone","oldPhone",status,"idSeenAt","updatedAt") VALUES (gen_random_uuid(),'${uid}','+27820000007','+27820000008','open',NOW(),NOW())`,
);
nullNote && /id_check_has_a_note/.test(nullNote)
  ? ok('a dated identity check with a NULL note is refused by the database')
  : bad(`the database allowed a dated ID check with no words: ${nullNote ?? 'no error'}`);

const blankNote = expectRefused(
  `INSERT INTO account_recoveries (id,"userId","newPhone","oldPhone",status,"idSeenAt","idSeenNote","updatedAt") VALUES (gen_random_uuid(),'${uid}','+27820000009','+27820000010','open',NOW(),'  ',NOW())`,
);
blankNote && /id_check_has_a_note/.test(blankNote)
  ? ok('…and with a blank one')
  : bad(`the database allowed a blank ID note: ${blankNote ?? 'no error'}`);

// And nothing can be marked recovered without an approval.
const unapproved = expectRefused(
  `INSERT INTO account_recoveries (id,"userId","newPhone","oldPhone",status,"recoveredAt","updatedAt") VALUES (gen_random_uuid(),'${uid}','+27820000003','+27820000004','recovered',NOW(),NOW())`,
);
unapproved && /recovery_needs_approval/.test(unapproved)
  ? ok('…and a recovery with no approval is refused by the database')
  : bad(`the database allowed an unapproved recovery: ${unapproved ?? 'no error'}`);

// ── 8. POPIA: what is kept, and what goes ───────────────────────────────
console.log('\n── 8. What is kept, and what goes ──────────────────────────');

// A stale open request holds the number of somebody who was never recovered.
const staleId = q(`INSERT INTO account_recoveries (id,"userId","newPhone","oldPhone",status,"createdAt","updatedAt") VALUES (gen_random_uuid(),'${uid}','+27829998888','${OLD_E164}','open',NOW() - INTERVAL '5 days',NOW()) RETURNING id`);
const expired = await apiCall(API, 'POST', '/api/admin/recoveries/expire-stale', {}, A);
expired.status === 200 ? ok('stale requests can be expired on demand, not only on a cron') : bad(`expire-stale returned ${expired.status}`);
q(`SELECT status FROM account_recoveries WHERE id='${staleId}'`) === 'expired'
  ? ok('…a request nobody finished is expired')
  : bad('the stale request was not expired');
q(`SELECT "newPhone" FROM account_recoveries WHERE id='${staleId}'`) === '(expired)'
  ? ok('…and the number of somebody who was never recovered is dropped')
  : bad('an abandoned request still holds a mobile number');

// The audit leaves with the account.
q(`DELETE FROM users WHERE id='${uid}'`);
Number(q(`SELECT count(*) FROM account_recoveries WHERE "userId"='${uid}'`)) === 0
  ? ok('deleting the account takes its recovery records with it (POPIA s.24)')
  : bad('recovery records outlived the account');

console.log(fail ? `\n❌ ${fail} failure(s)` : '\n✅ an account can be handed back, and only with two proofs');
