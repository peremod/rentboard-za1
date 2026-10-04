/**
 * An admin ending somebody's account, on their request — Phase 7i.
 *
 * ── Why this exists at all
 *
 * Phase 7g built self-service closure and recorded a gap: a phone-only account
 * has no password, so /account/close cannot confirm it. That screen tells the
 * person to ask us, and there was nothing behind the asking. POPIA s.24 is a
 * right, not a feature request — if the only self-service path needs a
 * credential some accounts do not have, the operator has to be able to act.
 *
 * ── What is worth checking, and it is not that the button works
 *
 *   1. **Closure is not suspension.** `setUserActive` is reversible, keeps the
 *      email, and is a moderation decision we make. This is irreversible,
 *      erases the email, and is the owner's decision that we carry out. The
 *      checks that matter are that the two cannot be confused: a closed account
 *      cannot be "restored" by the suspend toggle, and suspending does not
 *      erase anybody.
 *   2. **The erasure is the SAME code as the owner's path.** Asserted by
 *      driving the same survivals here that the self-service drive asserts —
 *      because two erasures that start identical drift, and the one that drifts
 *      is the one nobody drives.
 *   3. **It is attributable, and the audit row keeps no personal data.** After
 *      this runs, the email, name and number are gone, so the audit row is the
 *      only lasting evidence it was asked for. It must name the admin and the
 *      request and must NOT hold the erased identity — an audit trail that
 *      keeps what the erasure removed defeats the erasure it audits.
 *   4. **An admin cannot use it on themselves**, because this route takes no
 *      password and doing so would skip the re-authentication that
 *      /account/close exists to demand.
 *
 * ── This drive makes its own admin
 *
 * Every other admin drive in this repository reads ADMIN_EMAIL and
 * ADMIN_PASSWORD and SKIPS without them, which is how ninety-two checks in the
 * smoke suite had never run once — a skipped check reads exactly like a passing
 * one when you are scanning output. So this one promotes a registered account
 * with one SQL statement and always runs.
 *
 * Needs the API on :3000 and a DATABASE_URL. The close endpoint allows ten
 * attempts per fifteen minutes, counted in memory; this drive spends five.
 */
import { registerUser, apiCall, dbQuery as q, PASSWORD } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const S = Math.floor(Math.random() * 1e6);

const admin = await registerUser(API, 'LANDLORD');
q(`UPDATE users SET role = 'ADMIN' WHERE id = '${admin.id}'`);
q(`SELECT role FROM users WHERE id = '${admin.id}'`) === 'ADMIN'
  ? ok('the drive promoted its own admin, so nothing here is skipped for want of a credential')
  : bad('could not promote an admin — every check below would prove nothing');

// A fresh token, because the one from registration carries the old role.
const signIn = await apiCall(API, 'POST', '/api/auth/login', { email: admin.email, password: PASSWORD });
const ADMIN = signIn.body?.accessToken;
ADMIN ? ok('…and signed in again, so the token carries ADMIN') : bad(`admin sign-in failed: ${signIn.status}`);

console.log('\n── 1. A phone-only account, which is why this exists ───────');

/**
 * The case Phase 7g could not serve: no password, so /account/close refuses.
 * Built by clearing the hash directly — the phone-signup flow is a drive of its
 * own and this one only needs the SHAPE.
 */
const phoneOnly = await registerUser(API, 'TENANT');
q(`UPDATE users SET "passwordHash" = NULL, phone = '+2782${S}'::text, email = NULL WHERE id = '${phoneOnly.id}'`);
q(`SELECT "passwordHash" IS NULL FROM users WHERE id = '${phoneOnly.id}'`) === 't'
  ? ok('a phone-only account exists, with no password to confirm with')
  : bad('the phone-only fixture did not take — the check below proves nothing');

const selfAttempt = await apiCall(API, 'DELETE', '/api/account',
  { confirm: 'DELETE', understood: true }, phoneOnly.token);
selfAttempt.status === 400 && /code we sent/i.test(selfAttempt.body?.message ?? '')
  ? ok('…and they cannot close it themselves, which is the gap this phase fills')
  : bad(`a phone-only self-close returned ${selfAttempt.status} ${JSON.stringify(selfAttempt.body?.message)}`);

console.log('\n── 2. The preview an admin is shown is the owner’s preview ──');

const landlord = await registerUser(API, 'LANDLORD');
const tenantA = await registerUser(API, 'TENANT');

const room = await apiCall(API, 'POST', '/api/rooms', {
  roomType: 'shared_house', title: `Closure room ${S}`,
  description: 'A clean room in a shared house, close to transport and the shops. Available now.',
  rentCents: 310000, province: 'Gauteng', city: 'Johannesburg',
  locationDisplay: 'Tembisa, Johannesburg',
  availableFrom: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
}, landlord.token);
q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${room.body?.id}'`);

const application = await apiCall(API, 'POST', '/api/applications',
  { roomId: room.body?.id, coverNote: 'I can move in on the first of the month.' }, tenantA.token);
const accepted = await apiCall(API, 'POST', `/api/applications/${application.body?.id}/accept`, {}, landlord.token);
await apiCall(API, 'POST', `/api/applications/${application.body?.id}/messages`,
  { body: 'Bring your ID on Saturday.' }, landlord.token);
await apiCall(API, 'POST', `/api/applications/${application.body?.id}/messages`,
  { body: 'Will do, see you then.' }, tenantA.token);
const tenancyId = q(`SELECT id FROM tenancies WHERE "applicationId" = '${application.body?.id}'`);
q(`UPDATE tenancies SET status='active' WHERE id = '${tenancyId}'`);
accepted.status < 300 && !!tenancyId
  ? ok('a landlord with a tenant, a conversation and a live tenancy (precondition, asserted)')
  : bad(`the entangled fixture failed (accept ${accepted.status}, tenancy ${JSON.stringify(tenancyId)})`);

const preview = await apiCall(API, 'GET', `/api/admin/users/${landlord.id}/closure-preview`, null, ADMIN);
preview.status === 200
  ? ok('the admin can see what ending this account would do')
  : bad(`closure-preview returned ${preview.status} ${JSON.stringify(preview.body).slice(0, 140)}`);

/**
 * ⚠️ The same preview, from the same code. An admin acting on somebody's
 * request should read what that person would have read — a separate
 * admin-flavoured summary is a second thing to keep true, and the one that
 * falls behind is the one shown to the operator who cannot ask the person what
 * they expected.
 */
const ownerPreview = await apiCall(API, 'GET', '/api/account/deletion-preview', null, landlord.token);
JSON.stringify(preview.body) === JSON.stringify(ownerPreview.body)
  ? ok('…and it is byte-for-byte the preview the owner is shown, not a second summary')
  : bad('the admin preview and the owner preview differ — two summaries to keep true');

(preview.body?.kept ?? []).length >= 3
  ? ok(`…naming ${preview.body.kept.length} kinds of record that will be KEPT, with reasons`)
  : bad(`the preview's kept list is ${JSON.stringify(preview.body?.kept)}`);

console.log('\n── 3. The refusals, before anything is erased ──────────────');

const noReason = await apiCall(API, 'DELETE', `/api/admin/users/${landlord.id}`,
  { reason: 'ok', confirm: 'CLOSE', understood: true }, ADMIN);
noReason.status === 400
  ? ok('refused without a real reason — the audit row is the only lasting evidence')
  : bad(`a two-character reason returned ${noReason.status}`);

const noWord = await apiCall(API, 'DELETE', `/api/admin/users/${landlord.id}`,
  { reason: 'Emailed from the registered address, ticket 412.', confirm: 'yes', understood: true }, ADMIN);
noWord.status === 400
  ? ok('refused when the typed word is not CLOSE')
  : bad(`confirm:"yes" returned ${noWord.status}`);

/** Absent, not false: a checkbox whose binding never fired ships as absent. */
const noTick = await apiCall(API, 'DELETE', `/api/admin/users/${landlord.id}`,
  { reason: 'Emailed from the registered address, ticket 412.', confirm: 'CLOSE' }, ADMIN);
noTick.status === 400
  ? ok('refused when the acknowledgement is ABSENT, which is how a missed binding ships')
  : bad(`an absent acknowledgement returned ${noTick.status}`);

/**
 * ⚠️ An admin cannot close their OWN account here. This route takes no
 * password, so using it on themselves skips the re-authentication that
 * /account/close exists to demand.
 */
const ownAccount = await apiCall(API, 'DELETE', `/api/admin/users/${admin.id}`,
  { reason: 'Testing whether this is allowed at all.', confirm: 'CLOSE', understood: true }, ADMIN);
ownAccount.status === 400 && /your own account/i.test(ownAccount.body?.message ?? '')
  ? ok('…and an admin cannot end their OWN account here, where no password is asked for')
  : bad(`an admin closing their own account returned ${ownAccount.status} ${JSON.stringify(ownAccount.body?.message)}`);

const otherAdmin = await registerUser(API, 'LANDLORD');
q(`UPDATE users SET role = 'ADMIN' WHERE id = '${otherAdmin.id}'`);
const adminTarget = await apiCall(API, 'DELETE', `/api/admin/users/${otherAdmin.id}`,
  { reason: 'Checking the guard on admin accounts.', confirm: 'CLOSE', understood: true }, ADMIN);
adminTarget.status === 400
  ? ok('…nor another admin’s, the same rule suspension already applies')
  : bad(`closing another admin returned ${adminTarget.status}`);

const asLandlord = await apiCall(API, 'DELETE', `/api/admin/users/${tenantA.id}`,
  { reason: 'A landlord should never reach this route.', confirm: 'CLOSE', understood: true }, landlord.token);
asLandlord.status === 403
  ? ok('…and a non-admin cannot reach the route at all')
  : bad(`a landlord calling the admin close route got ${asLandlord.status}`);

q(`SELECT "deletedAt" IS NULL FROM users WHERE id = '${landlord.id}'`) === 't'
  ? ok('after four refusals the account is untouched')
  : bad('a refused attempt ended the account');

console.log('\n── 4. Closing it, and the audit row that outlives the person ──');

const REQUEST = `Emailed from the registered address on 3 Oct, ticket ${S}.`;
const closed = await apiCall(API, 'DELETE', `/api/admin/users/${landlord.id}`,
  { reason: REQUEST, confirm: 'CLOSE', understood: true }, ADMIN);
closed.status === 200 && closed.body?.deletedAt
  ? ok('with the request recorded, the typed word and the acknowledgement, it goes')
  : bad(`the close returned ${closed.status} ${JSON.stringify(closed.body).slice(0, 160)}`);

const row = {
  actor: q(`SELECT actor FROM account_closures WHERE "userId" = '${landlord.id}'`),
  by: q(`SELECT "closedByAdminId" FROM account_closures WHERE "userId" = '${landlord.id}'`),
  reason: q(`SELECT reason FROM account_closures WHERE "userId" = '${landlord.id}'`),
};
row.actor === 'admin'
  ? ok('the closure is recorded as an admin action, not as the owner’s own')
  : bad(`account_closures.actor is ${JSON.stringify(row.actor)}`);
row.by === admin.id
  ? ok('…naming WHICH admin did it')
  : bad(`closedByAdminId is ${JSON.stringify(row.by)}, expected ${admin.id}`);
row.reason === REQUEST
  ? ok('…and how the request reached them, which is now the only evidence it was asked for')
  : bad(`the recorded reason is ${JSON.stringify(row.reason)}`);

/**
 * ⚠️ The audit row must NOT hold the identity the erasure removed.
 *
 * An audit trail that keeps the email and name defeats the erasure it audits.
 * The columns are checked by name rather than trusted: this is the kind of
 * table somebody helpfully adds a "userEmail" column to later.
 */
const auditColumns = q(`SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_name = 'account_closures'`);
!/email|fullname|phone|name|ip/i.test(auditColumns ?? 'unknown')
  ? ok(`…and the table holds no identity at all (${auditColumns})`)
  : bad(`account_closures has an identifying column: ${auditColumns}`);

console.log('\n── 5. The person is erased, by the same code as the owner’s path ──');

const tomb = {
  exists: q(`SELECT COUNT(*) FROM users WHERE id = '${landlord.id}'`),
  name: q(`SELECT "fullName" FROM users WHERE id = '${landlord.id}'`),
  email: q(`SELECT email FROM users WHERE id = '${landlord.id}'`),
  phone: q(`SELECT phone IS NULL FROM users WHERE id = '${landlord.id}'`),
  hash: q(`SELECT "passwordHash" IS NULL FROM users WHERE id = '${landlord.id}'`),
  active: q(`SELECT "isActive" FROM users WHERE id = '${landlord.id}'`),
};
tomb.exists === '1'
  ? ok('the row is still there as a tombstone, so nothing of anybody else’s cascaded away')
  : bad(`the user row is gone (count ${tomb.exists}) — the survivals below cannot be trusted`);
tomb.name === 'Former member'
  ? ok('…their name is gone')
  : bad(`fullName is ${JSON.stringify(tomb.name)}`);
(tomb.email ?? '').endsWith('@deleted.mastande.invalid')
  ? ok('…their email is a reserved .invalid tombstone that can never reach anybody')
  : bad(`email is ${JSON.stringify(tomb.email)}`);
tomb.phone === 't' && tomb.hash === 't' && tomb.active === 'f'
  ? ok('…the number and the password are gone, and isActive is false as a second refusal')
  : bad(`phone-null ${tomb.phone}, hash-null ${tomb.hash}, isActive ${tomb.active}`);

const signInClosed = await apiCall(API, 'POST', '/api/auth/login', { email: landlord.email, password: PASSWORD });
signInClosed.status >= 400
  ? ok('…and they cannot sign in again')
  : bad(`a closed account signed in (${signInClosed.status})`);

console.log('\n── 6. And the other people’s records are all still there ────');

q(`SELECT COUNT(*) FROM applications WHERE id = '${application.body?.id}'`) === '1'
  ? ok('the tenant’s application survives')
  : bad('the tenant’s application went with the landlord');
q(`SELECT COUNT(*) FROM messages WHERE "applicationId" = '${application.body?.id}'`) === '2'
  ? ok('…and BOTH sides of the conversation, including what the landlord sent')
  : bad(`the conversation holds ${q(`SELECT COUNT(*) FROM messages WHERE "applicationId" = '${application.body?.id}'`)} of 2 messages`);
q(`SELECT COUNT(*) FROM tenancies WHERE id = '${tenancyId}'`) === '1'
  ? ok('…and the tenancy, which is the tenant’s record as much as the landlord’s')
  : bad('the tenancy was deleted');
q(`SELECT status FROM rooms WHERE id = '${room.body?.id}'`) === 'deleted'
  ? ok('…and the rooms are rows with a status that keeps them off the board for good')
  : bad(`the room status is ${q(`SELECT status FROM rooms WHERE id = '${room.body?.id}'`)}`);

const thread = await apiCall(API, 'GET', `/api/applications/${application.body?.id}/messages`, null, tenantA.token);
thread.status === 200 && (thread.body?.data ?? thread.body ?? []).length >= 2
  ? ok('…and the tenant can still open the conversation and read all of it')
  : bad(`the tenant’s thread returned ${thread.status} with ${JSON.stringify(thread.body).slice(0, 120)}`);

console.log('\n── 7. Closure and suspension cannot be confused ────────────');

/**
 * ⚠️ The check `isActive` could not satisfy on its own.
 *
 * Without a guard, setUserActive(id, true) on a tombstone sets isActive true on
 * a row whose name, email and phone are gone. Sign-in still refuses it, so
 * nobody gets in — but the admin screen would show the account as ACTIVE and
 * the operator would believe it. A control that reports a state the system does
 * not have is the defect this codebase keeps shipping.
 */
const restore = await apiCall(API, 'PATCH', `/api/admin/users/${landlord.id}/active`,
  { isActive: true }, ADMIN);
restore.status === 400
  ? ok('a closed account cannot be "restored" by the suspend toggle')
  : bad(`restoring a closed account returned ${restore.status} — the admin screen would show it as active`);
q(`SELECT "isActive" FROM users WHERE id = '${landlord.id}'`) === 'f'
  ? ok('…and it really is still inactive afterwards')
  : bad('the closed account was reactivated');

const twice = await apiCall(API, 'DELETE', `/api/admin/users/${landlord.id}`,
  { reason: 'A second attempt at an account already ended.', confirm: 'CLOSE', understood: true }, ADMIN);
twice.status === 400
  ? ok('…and it cannot be closed a second time')
  : bad(`closing a closed account returned ${twice.status}`);

/** Suspension still works, and still erases nobody. */
const suspended = await apiCall(API, 'PATCH', `/api/admin/users/${tenantA.id}/active`,
  { isActive: false, reason: 'Moderation, for this drive.' }, ADMIN);
suspended.status === 200
  ? ok('suspension still works on a live account')
  : bad(`suspend returned ${suspended.status}`);
q(`SELECT "deletedAt" IS NULL FROM users WHERE id = '${tenantA.id}'`) === 't'
  ? ok('…and erases nobody — the email is still there and it is reversible')
  : bad('suspending an account set deletedAt — the two actions have blurred');
q(`SELECT COUNT(*) FROM account_closures WHERE "userId" = '${tenantA.id}'`) === '0'
  ? ok('…and writes no closure record, because nothing was closed')
  : bad('suspending wrote a closure record');

console.log('\n── 8. The phone-only account, closed on request ────────────');

const phoneClosed = await apiCall(API, 'DELETE', `/api/admin/users/${phoneOnly.id}`,
  { reason: `Asked on WhatsApp from the registered number, ticket ${S}b.`, confirm: 'CLOSE', understood: true }, ADMIN);
phoneClosed.status === 200
  ? ok('the account that could not close itself is closed on request')
  : bad(`the phone-only close returned ${phoneClosed.status} ${JSON.stringify(phoneClosed.body).slice(0, 140)}`);
q(`SELECT phone IS NULL FROM users WHERE id = '${phoneOnly.id}'`) === 't'
  ? ok('…and the number, which was their only identifier, is gone')
  : bad(`the phone number survived: ${q(`SELECT phone FROM users WHERE id = '${phoneOnly.id}'`)}`);
q(`SELECT actor FROM account_closures WHERE "userId" = '${phoneOnly.id}'`) === 'admin'
  ? ok('…with the request recorded against the admin who acted on it')
  : bad('no closure record for the phone-only account');

console.log(`\n${fail === 0 ? '✅ all checks passed' : `❌ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
