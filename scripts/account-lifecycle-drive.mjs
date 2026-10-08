/**
 * Pausing an account, and ending one — Phase 7g, item 3.
 *
 * ── What is worth checking, and it is not that the buttons work
 *
 *   1. **Pausing is not a trapdoor.** `User.isActive` already existed and every
 *      sign-in path refuses a false value with "contact support". Reusing it
 *      for a self-service pause would have looked like one line of work and
 *      shipped an account nobody could ever reactivate. So the check that
 *      matters is that a paused person can still SIGN IN.
 *   2. **Pausing actually hides them.** `isActive` stays true, so every
 *      existing `user: { isActive: true }` filter would have kept their public
 *      page lit. A pause that leaves the shop window on is not a pause.
 *   3. **Ending the account erases the PERSON and keeps the SHARED RECORD.**
 *      This is the substance. `DELETE FROM users` cascades into other people's
 *      rooms, applications, messages, tenancies, rent history and reviews — the
 *      foreign keys were read before this was designed. Every one of those
 *      survivals is asserted here, from the database, because a UI that says
 *      "deleted" over a mechanism that quietly took a landlord's conversation
 *      with it is the failure this phase exists to avoid.
 *   4. **And the person really is erased** — name, email, phone, photo,
 *      password, income, verification outcomes — with the photo queued through
 *      the deletion queue rather than hoped about.
 *
 * ⚠️ Needs a FRESH API. The delete endpoint is rate limited to ten attempts per
 * fifteen minutes, counted in memory, and this drive spends six of them on
 * purpose — four refusals, the real one, and a second attempt that must be
 * rejected. Two runs inside the window exhaust it and the failure reads as
 * "an account was closed without the password", which is the opposite of what
 * happened. Restart the API between runs.
 *
 * Needs the API on :3000 and a DATABASE_URL.
 */
import { registerUser, apiCall, dbQuery as q } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const S = Math.floor(Math.random() * 1e6);
const PASSWORD = 'DrivePass123';

const landlord = await registerUser(API, 'LANDLORD');
const tenantA = await registerUser(API, 'TENANT');   // will be the one who stays
const leaver = await registerUser(API, 'LANDLORD');  // will end their account
const pauser = await registerUser(API, 'LANDLORD');  // will pause theirs

const mkRoom = async (title, token, extra = {}) => {
  const res = await apiCall(API, 'POST', '/api/rooms', {
    roomType: 'shared_house', title,
    description: 'A clean room in a shared house, close to transport and the shops. Available now.',
    rentCents: 310000, province: 'Gauteng', city: 'Johannesburg',
    locationDisplay: 'Tembisa, Johannesburg',
    availableFrom: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
    ...extra,
  }, token);
  if (res.status !== 201) throw new Error(`room ${title}: ${res.status} ${JSON.stringify(res.body).slice(0, 180)}`);
  q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${res.body.id}'`);
  return res.body.id;
};

console.log('\n── 1. Pausing: hidden to everybody, open to the owner ───────');

const pauserRoom = await mkRoom(`Pauser room ${S}`, pauser.token);
// A public page, so the storefront check below means something.
const slug = `pauser-${S}`;
const pauserProfile = q(`SELECT id FROM landlord_profiles WHERE "userId" = '${pauser.id}'`);
q(`UPDATE landlord_profiles SET slug = '${slug}', "storefrontLive" = true WHERE id = '${pauserProfile}'`);

const liveBefore = await apiCall(API, 'GET', `/api/storefronts/${slug}`, null, null);
liveBefore.status === 200
  ? ok('the landlord’s public page is live before pausing (so the next check means something)')
  : bad(`the public page is not reachable before pausing: ${liveBefore.status}`);

const paused = await apiCall(API, 'POST', '/api/account/deactivate', {}, pauser.token);
paused.status === 200 && paused.body?.roomsPaused === 1
  ? ok('pausing takes the listings off the board')
  : bad(`deactivate returned ${paused.status} ${JSON.stringify(paused.body).slice(0, 160)}`);

q(`SELECT status FROM rooms WHERE id = '${pauserRoom}'`) === 'paused'
  ? ok('…as PAUSED, not deleted — the applications and the tenancy stay attached')
  : bad(`the room is ${q(`SELECT status FROM rooms WHERE id = '${pauserRoom}'`)} after pausing`);

/**
 * ⚠️ The check `isActive` could not satisfy.
 *
 * Pausing deliberately leaves `isActive` TRUE so sign-in keeps working, which
 * means every existing `user: { isActive: true }` filter would have gone on
 * showing this person's public page. One shared PUBLIC_USER rule fixed that;
 * this is what proves it.
 */
const liveAfter = await apiCall(API, 'GET', `/api/storefronts/${slug}`, null, null);
liveAfter.status === 404
  ? ok('…and the public page goes dark, although isActive is still true')
  : bad(`the public page still answers ${liveAfter.status} for a paused landlord`);

/**
 * ⚠️ And the one that makes it a pause rather than a trapdoor.
 */
const signInPaused = await apiCall(API, 'POST', '/api/auth/login', { email: pauser.email, password: PASSWORD });
signInPaused.status === 201 || signInPaused.status === 200
  ? ok('a paused person can still sign in — which is the only way back')
  : bad(`a paused account cannot sign in (${signInPaused.status}) — the control is a trapdoor`);

signInPaused.body?.user?.deactivatedAt
  ? ok('…and the payload says so, so the portal can offer to wake it up')
  : bad('the sign-in payload does not mention that the account is paused');

const woken = await apiCall(API, 'POST', '/api/account/reactivate', {}, pauser.token);
woken.status === 200 && woken.body?.deactivatedAt === null
  ? ok('waking it up clears the pause')
  : bad(`reactivate returned ${woken.status} ${JSON.stringify(woken.body).slice(0, 160)}`);

/**
 * Rooms are NOT republished, deliberately: one may have been let while the
 * account slept, and advertising a taken room to people who then apply for it
 * is worse than making the landlord press publish.
 */
q(`SELECT status FROM rooms WHERE id = '${pauserRoom}'`) === 'paused'
  ? ok('…and does NOT put the rooms back on the board by itself')
  : bad('reactivating republished a room nobody asked it to');
woken.body?.roomsStillPaused === 1
  ? ok('…but says how many are waiting, so it is not a silent omission')
  : bad(`reactivate reported ${JSON.stringify(woken.body?.roomsStillPaused)} paused rooms`);

console.log('\n── 2. A full account, with other people entangled in it ─────');

const leaverRoom = await mkRoom(`Leaver room ${S}`, leaver.token);
const otherRoom = await mkRoom(`Leaver second room ${S}`, leaver.token);

// Tenant A applies, is accepted, has a tenancy with a rent record, exchanges
// messages, saves the other room, and writes a review. Every one of those is a
// record Tenant A has a claim on.
const app = await apiCall(API, 'POST', '/api/applications',
  { roomId: leaverRoom, coverNote: 'I can move in on the first.' }, tenantA.token);
const accepted = await apiCall(API, 'POST', `/api/applications/${app.body.id}/accept`, {}, leaver.token);
accepted.status < 300 ? ok('a tenant applies and is accepted') : bad(`accept: ${accepted.status}`);

const tenancyId = q(`SELECT id FROM tenancies WHERE "applicationId" = '${app.body.id}'`);
// ⚠️ startDate too, not just the status. `confirmStart` sets both in one
// update, so an 'active' tenancy with a null startDate is a row this product
// cannot otherwise reach — and the rent window reads startDate, so a mark
// against it is refused with "Confirm the move-in first". Forcing one column
// and not the other fabricates an impossible tenancy.
q(`UPDATE tenancies SET status='active', "startDate"=now() WHERE id = '${tenancyId}'`);
await apiCall(API, 'PATCH', `/api/properties/rent/${tenancyId}/mark`,
  { status: 'paid', periodStart: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString() },
  leaver.token);

await apiCall(API, 'POST', `/api/applications/${app.body.id}/messages`, { body: 'Bring your ID on Saturday.' }, leaver.token);
await apiCall(API, 'POST', `/api/applications/${app.body.id}/messages`, { body: 'Will do, see you then.' }, tenantA.token);
/**
 * ⚠️ Written straight in, and the reason is a finding.
 *
 * There is NO endpoint that saves a room. `saved_rooms` is in the schema, is
 * read in two places and deleted from in one, and **nothing writes to it** —
 * saved rooms are entirely localStorage, which the service's own comment had
 * gone stale about. So the first version of this drive POSTed to a route that
 * does not exist, the row was never created, and the survival check below
 * reported a product bug about a row that had never been there: a negative
 * check whose setup silently failed proves nothing in either direction.
 *
 * The row still belongs in this fixture, because the deletion code does delete
 * from that table and would cascade it away on a plain DELETE. Recorded in
 * docs/OUTSTANDING.md.
 */
q(`INSERT INTO saved_rooms (id, "tenantId", "roomId", "createdAt") VALUES (gen_random_uuid()::text, '${tenantA.id}', '${otherRoom}', now())`);
Number(q(`SELECT COUNT(*) FROM saved_rooms WHERE "tenantId" = '${tenantA.id}'`)) === 1
  ? ok('the other tenant has a saved room on one of these rooms (precondition, asserted)')
  : bad('the saved-room fixture did not insert — the survival check below proves nothing');

// The leaver writes a review of their tenant, and saves a room of their own.
// Written straight in: the review API requires an ENDED tenancy and a window,
// which is a fixture this drive does not need to reproduce. The columns were
// read from the table rather than guessed — the first attempt invented a `kind`
// column that does not exist, and a drive that cannot set up its own fixture
// proves nothing about what it then asserts.
q(`INSERT INTO reviews (id, "tenancyId", "authorId", "subjectId", "roomId", type, rating, comment, "publishedAt", "createdAt", "updatedAt") VALUES (gen_random_uuid()::text, '${tenancyId}', '${leaver.id}', '${tenantA.id}', '${leaverRoom}', 'tenant', 5, 'Paid on time every month, left the room clean.', now(), now(), now())`);
q(`UPDATE users SET "avatarPath" = 'avatars/leaver-${S}.jpg' WHERE id = '${leaver.id}'`);

const reviewsByLeaver = Number(q(`SELECT COUNT(*) FROM reviews WHERE "authorId" = '${leaver.id}'`));
reviewsByLeaver >= 1
  ? ok('…and the landlord has written a review, saved rooms and a tenancy with rent on it')
  : bad('the review fixture did not insert — the survival check below would prove nothing');

/**
 * A contractor lead belonging to the leaver — Phase 7k.
 *
 * Inserted directly with an asserted precondition. The endpoint exists
 * (POST /services/:id/lead) but it needs a LISTED provider, which needs a
 * recorded phone check, which is a fixture this drive does not otherwise need —
 * and a survival check whose setup silently failed proves nothing in either
 * direction, which this file has already paid for once over saved_rooms.
 */
const leadProvider = q(`INSERT INTO service_providers (id, category, name, phone, whatsapp, areas, active, "phoneConfirmedAt", "createdAt", "updatedAt") VALUES (gen_random_uuid()::text, 'plumber', 'Lead Fixture Plumber ${S}', '+2782${String(S).padStart(7, '0').slice(0, 7)}', true, ARRAY['Tembisa'], true, now(), now(), now()) RETURNING id`);
const leadId = q(`INSERT INTO contractor_leads (id, "providerId", "landlordId", channel, "leadDay", billable, "createdAt") VALUES (gen_random_uuid()::text, '${leadProvider}', '${leaver.id}', 'call', CURRENT_DATE, false, now()) RETURNING id`);
Number(q(`SELECT COUNT(*) FROM contractor_leads WHERE id = '${leadId}'`)) === 1
  ? ok('the leaver has a contractor lead against them (precondition, asserted)')
  : bad('the contractor-lead fixture did not insert — the survival check below proves nothing');

console.log('\n── 3. The preview tells them the truth, from their own rows ──');

const preview = await apiCall(API, 'GET', '/api/account/deletion-preview', null, leaver.token);
preview.status === 200
  ? ok('the preview answers')
  : bad(`deletion-preview returned ${preview.status} ${JSON.stringify(preview.body).slice(0, 160)}`);

const keptLabels = (preview.body?.kept ?? []).map((k) => k.label).join(' | ');
/Messages you sent/.test(keptLabels) && /Reviews you wrote/.test(keptLabels) && /tenancy records/.test(keptLabels)
  ? ok('…and names the things that will be KEPT rather than only what goes')
  : bad(`the preview's kept list is ${JSON.stringify(keptLabels)}`);

(preview.body?.kept ?? []).every((k) => k.why && k.why.length > 20)
  ? ok('…each with the reason it stays, so "permanent" is not left to mean something it does not')
  : bad('a kept item has no explanation');

(preview.body?.stops ?? []).some((l) => /tenants keep their rent records/i.test(l))
  ? ok('…and warns a landlord that their tenants will lose the way to reach them')
  : bad(`the stops list does not warn about the tenants: ${JSON.stringify(preview.body?.stops)}`);

console.log('\n── 4. Ending it takes three things, and refuses without each ──');

const tryDelete = (body, token = leaver.token) => apiCall(API, 'DELETE', '/api/account', body, token);

(await tryDelete({ confirm: 'DELETE', understood: true })).status === 400
  ? ok('refused with no password — a phone left unlocked must not be enough')
  : bad('an account was closed without the password');

/**
 * ⚠️ 403, and the number is the check.
 *
 * This was 401, which the frontend's error interceptor reads as an expired
 * access token: it refreshed the session, retried the DELETE with the same
 * wrong password, got 401 again, and on a second failure did what that means —
 * "Your session has expired", session cleared, login page. Typing your own
 * password wrong logged you out and threw away the typed DELETE and the tick.
 *
 * The request was authenticated; the password typed into the form is what was
 * refused, so it is 403. Asserting the exact code is the only way this stays
 * fixed — the behaviour is in an interceptor the backend cannot see, and
 * `status >= 400` would have passed throughout the broken version.
 */
const wrongPw = await tryDelete({ password: 'WrongPass123', confirm: 'DELETE', understood: true });
wrongPw.status === 403
  ? ok('refused with the wrong password, as 403 — not as a lost session')
  : bad(`the wrong password returned ${wrongPw.status}; 401 is read by the browser as an expired session and logs the person out`);
/not right/i.test(wrongPw.body?.message ?? '')
  ? ok('…and says which thing was wrong, so the screen has something to show')
  : bad(`the refusal message is ${JSON.stringify(wrongPw.body?.message)}`);

(await tryDelete({ password: PASSWORD, confirm: 'delete', understood: true })).status === 400
  ? ok('refused when the typed word is not exactly DELETE')
  : bad('a lower-case "delete" was accepted — @Equals on the literal is what stops that');

/**
 * ⚠️ ABSENT, not false. A missed checkbox binding ships as absent, which is
 * why @Equals(true) is the right validator and a truthiness check is not —
 * Phase 7g part two learned that on the sign-up consent box.
 */
(await tryDelete({ password: PASSWORD, confirm: 'DELETE' })).status === 400
  ? ok('refused when the acknowledgement is ABSENT, which is how a missed binding ships')
  : bad('an account was closed with no acknowledgement at all');

// Nothing should have changed yet.
q(`SELECT "deletedAt" IS NULL FROM users WHERE id = '${leaver.id}'`) === 't'
  ? ok('…and after four refusals the account is untouched')
  : bad('a refused attempt changed the account anyway');

const gone = await tryDelete({ password: PASSWORD, confirm: 'DELETE', understood: true });
gone.status === 200
  ? ok('with the password, the typed word and the acknowledgement, it goes')
  : bad(`delete returned ${gone.status} ${JSON.stringify(gone.body).slice(0, 180)}`);

console.log('\n── 5. The person is erased ─────────────────────────────────');

/**
 * ⚠️ The row is read defensively, and that is not defensive programming for
 * its own sake.
 *
 * If the row is GONE — which is what the naive `DELETE FROM users` this phase
 * exists to avoid would do — `q` returns an empty string, `split('|')` yields
 * one element, and the next line threw a TypeError that CRASHED the drive
 * before its summary. So the single most important failure mode produced a
 * stack trace instead of a finding, and every survival check below it never
 * ran. Third time in this codebase: a drive that crashes is a drive that tells
 * you nothing.
 */
const row = q(`SELECT "fullName" || '|' || COALESCE(email,'') || '|' || COALESCE(phone,'-') || '|' || COALESCE("avatarPath",'-') || '|' || COALESCE("passwordHash",'-') FROM users WHERE id = '${leaver.id}'`);
const tombstoneExists = row.trim().length > 0;
tombstoneExists
  ? ok('the row is still there as a tombstone, so nothing of anybody else\u2019s cascaded away')
  : bad('the USER ROW IS GONE — a plain delete, which takes other people\u2019s records with it');
const [name, email = '', phone = '', avatar = '', hash = ''] = row.split('|');
name === 'Former member'
  ? ok('their name is gone')
  : bad(`the name is still "${name}"`);
email.endsWith('@deleted.mastande.invalid')
  ? ok('…their email is a reserved .invalid tombstone, which can never reach anybody')
  : bad(`the email is still "${email}"`);
phone === '-' && avatar === '-' && hash === '-'
  ? ok('…and the phone number, the photo and the password are all gone')
  : bad(`phone=${phone} avatar=${avatar} passwordHash=${hash}`);

/**
 * The photo is a face. It goes through the deletion QUEUE, which marks a file
 * done only from the provider's own response — the pattern this codebase had to
 * go back and make true after shipping a column whose name asserted a deletion
 * that never happened.
 */
Number(q(`SELECT COUNT(*) FROM file_deletions WHERE path = 'avatars/leaver-${S}.jpg' AND reason = 'account_deleted'`)) === 1
  ? ok('…with the photo queued for real deletion, not just unlinked')
  : bad('the avatar was unlinked from the row and never queued for deletion');

for (const [label, table, column] of [
  ['their saved rooms', 'saved_rooms', 'tenantId'],
  ['their verification checks', 'verification_requests', 'userId'],
  ['their notices', 'notices', 'userId'],
  ['their sessions', 'refresh_tokens', 'userId'],
  ['their landlord profile', 'landlord_profiles', 'userId'],
]) {
  Number(q(`SELECT COUNT(*) FROM ${table} WHERE "${column}" = '${leaver.id}'`)) === 0
    ? ok(`…and ${label} are gone`)
    : bad(`${label} survived in ${table}`);
}

const canSignIn = await apiCall(API, 'POST', '/api/auth/login', { email: leaver.email, password: PASSWORD });
canSignIn.status === 401
  ? ok('they cannot sign in again')
  : bad(`a closed account signed in with ${canSignIn.status}`);

console.log('\n── 6. And the other people’s records are all still there ───');

/**
 * ⚠️ This is the whole point of the phase.
 *
 * A plain DELETE would have cascaded through rooms into Tenant A's application,
 * their saved room and the review; through applications into the conversation,
 * taking the LANDLORD's own messages with it; and through tenancies into the
 * rent history both parties rely on. Every one is checked from the database.
 */
Number(q(`SELECT COUNT(*) FROM rooms WHERE id = '${leaverRoom}'`)) === 1
  ? ok('the rooms still exist as rows')
  : bad('the rooms were deleted — and other people’s applications went with them');
q(`SELECT status FROM rooms WHERE id = '${leaverRoom}'`) === 'deleted'
  ? ok('…with the status that keeps them off the board for good')
  : bad(`the room status is ${q(`SELECT status FROM rooms WHERE id = '${leaverRoom}'`)}`);

Number(q(`SELECT COUNT(*) FROM applications WHERE id = '${app.body.id}'`)) === 1
  ? ok(`the tenant's application survives`)
  : bad('the tenant’s own application was destroyed with the landlord');

Number(q(`SELECT COUNT(*) FROM messages WHERE "applicationId" = '${app.body.id}'`)) === 2
  ? ok('…and BOTH sides of the conversation, including the messages the landlord sent')
  : bad(`the conversation has ${q(`SELECT COUNT(*) FROM messages WHERE "applicationId" = '${app.body.id}'`)} messages, expected 2`);

Number(q(`SELECT COUNT(*) FROM tenancies WHERE id = '${tenancyId}'`)) === 1
  ? ok('the tenancy survives')
  : bad('the tenancy was destroyed — the tenant lost their own record');
Number(q(`SELECT COUNT(*) FROM rent_periods WHERE "tenancyId" = '${tenancyId}'`)) >= 1
  ? ok('…and its rent history, which is the tenant’s proof of payment')
  : bad('the rent history went with the landlord’s account');

Number(q(`SELECT COUNT(*) FROM saved_rooms WHERE "tenantId" = '${tenantA.id}' AND "roomId" = '${otherRoom}'`)) === 1
  ? ok('the other tenant’s saved room survives')
  : bad('a different person’s saved room was deleted');

Number(q(`SELECT COUNT(*) FROM reviews WHERE "authorId" = '${leaver.id}'`)) === reviewsByLeaver
  ? ok('the review they WROTE about somebody else survives, with no name on it')
  : bad('a review this person wrote about somebody else was destroyed');

// The name must not leak through any of those survivals.
q(`SELECT "fullName" FROM users WHERE id = '${leaver.id}'`) === 'Former member'
  ? ok('…and every one of those rows now resolves to "Former member", not to a person')
  : bad('the tombstone still carries a name');

// Tenant A can still read their own thread, which is the acid test.
const thread = await apiCall(API, 'GET', `/api/applications/${app.body.id}/messages`, null, tenantA.token);
thread.status === 200 && (thread.body ?? []).length === 2
  ? ok('and the tenant can still open the conversation and read all of it')
  : bad(`the tenant's thread returned ${thread.status} with ${(thread.body ?? []).length} message(s)`);

/**
 * ⚠️ Contractor leads — Phase 7k, asserted here because the erasure owns them.
 *
 * A lead records that a contractor's number was passed on, and it is what that
 * contractor may be invoiced from. Deleting it would destroy a third party's
 * record of work we sent them; keeping the landlord id would retain personal
 * information about somebody who asked to be forgotten. So the row stays and
 * the id is nulled, and both halves are checked — a drive that only asserted
 * the row survived would pass with the person still named in it.
 */
Number(q(`SELECT COUNT(*) FROM contractor_leads WHERE id = '${leadId}'`)) === 1
  ? ok('the contractor lead survives, because it is what a third party may be invoiced from')
  : bad('closing the account destroyed a contractor lead the contractor may be billed for');
q(`SELECT "landlordId" IS NULL FROM contractor_leads WHERE id = '${leadId}'`) === 't'
  ? ok('…with the landlord’s identity removed from it')
  : bad('the contractor lead still names the person who closed their account');

console.log('\n── 7. A second attempt, and somebody else’s account ─────────');

(await tryDelete({ password: PASSWORD, confirm: 'DELETE', understood: true })).status === 401
  ? ok('the closed account’s token no longer works, so it cannot be closed twice')
  : bad('a closed account accepted a second deletion');

(await apiCall(API, 'POST', '/api/account/deactivate', {}, null)).status === 401
  ? ok('a stranger cannot pause an account')
  : bad('deactivate is reachable without a session');
(await apiCall(API, 'DELETE', '/api/account', { password: PASSWORD, confirm: 'DELETE', understood: true }, null)).status === 401
  ? ok('…nor close one')
  : bad('delete is reachable without a session');

console.log(`\n${fail === 0 ? '✅ all checks passed' : `❌ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
