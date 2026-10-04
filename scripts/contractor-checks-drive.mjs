/**
 * What the directory claims about a tradesperson — Phase 7j.
 *
 * ── The defect this drive was written against
 *
 * /landlord/services opened with "People we have checked out and can pass on",
 * and its empty state read "It is names we have checked, not an open
 * directory". **Nothing in the product recorded a check of any kind** — no
 * column on service_providers, no table, nothing. The screen made a trust claim
 * the data could not support, on the one axis this product competes on, and
 * that claim was the only thing a landlord had when deciding whether to let a
 * stranger into their tenant's room.
 *
 * Same family as a documentDeletedAt that deleted nothing, except this one
 * faced the user and asked them to rely on it.
 *
 * ── So the checks here are about the claim, not the columns
 *
 *   1. **Nobody is listed without a check.** Refused by the service AND by a
 *      CHECK constraint, because the rule matters more than the route: a seed
 *      script or a second admin surface must not be able to publish an
 *      unchecked name.
 *   2. **The payload carries the outcomes** so the screen can state which, and
 *      **not** `checkedByAdminId` — which admin signed somebody off is for
 *      accountability, not for the directory.
 *   3. **Dates, not booleans.** A check with no date is a rumour.
 *   4. **No document is ever stored.** Only the outcome, the rule
 *      verification_requests already follows.
 *
 * This drive promotes its own admin, so nothing is skipped for want of a
 * credential. Needs the API on :3000 and a DATABASE_URL.
 */
import { registerUser, apiCall, dbQuery as q, PASSWORD } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const S = Math.floor(Math.random() * 1e6);

const admin = await registerUser(API, 'LANDLORD');
q(`UPDATE users SET role = 'ADMIN' WHERE id = '${admin.id}'`);
const ADMIN = (await apiCall(API, 'POST', '/api/auth/login', { email: admin.email, password: PASSWORD })).body?.accessToken;
ADMIN
  ? ok('the drive promoted its own admin, so nothing here is skipped for want of a credential')
  : bad('could not sign in as admin — every check below proves nothing');

const landlord = await registerUser(API, 'LANDLORD');

console.log('\n── 1. Nobody is listed without a check ─────────────────────');

const body = (extra = {}) => ({
  category: 'plumber',
  name: `Sipho Plumbing ${S}`,
  phone: `082 1${String(S).padStart(6, '0').slice(0, 2)} 4567`,
  areas: ['Tembisa'],
  note: 'Geysers and blocked drains.',
  ...extra,
});

/**
 * ⚠️ The check that gives this phase its reason. Before it, `active: true` on a
 * provider nobody had rung published a name into a list captioned "people we
 * have checked out".
 */
const liveUnchecked = await apiCall(API, 'POST', '/api/services/admin', body({ active: true }), ADMIN);
liveUnchecked.status === 400 && /ring the number/i.test(liveUnchecked.body?.message ?? '')
  ? ok('a provider cannot be created live without the number having been rung')
  : bad(`creating a live unchecked provider returned ${liveUnchecked.status} ${JSON.stringify(liveUnchecked.body?.message)}`);

const draft = await apiCall(API, 'POST', '/api/services/admin', body(), ADMIN);
draft.status === 201 && draft.body?.active === false
  ? ok('…but it can be created as a draft, which is what an admin does first')
  : bad(`creating a draft returned ${draft.status} ${JSON.stringify(draft.body).slice(0, 140)}`);

const providerId = draft.body?.id;

const publishUnchecked = await apiCall(API, 'PATCH', `/api/services/admin/${providerId}`, { active: true }, ADMIN);
publishUnchecked.status === 400
  ? ok('…and it cannot be switched on later either, which is the route an admin would actually take')
  : bad(`publishing an unchecked provider returned ${publishUnchecked.status}`);

/**
 * ⚠️ The rule lives in the DATABASE as well, so a seed script, a direct UPDATE
 * or a second admin surface cannot get around it. Asserted by trying the thing
 * the application would refuse.
 */
let constraintHeld = false;
try {
  q(`UPDATE service_providers SET active = true WHERE id = '${providerId}'`);
} catch {
  constraintHeld = true;
}
constraintHeld || q(`SELECT active FROM service_providers WHERE id = '${providerId}'`) === 'f'
  ? ok('…and a direct SQL UPDATE cannot publish it either — the rule is a CHECK constraint too')
  : bad('a direct UPDATE published an unchecked provider: the rule is only in the application');

console.log('\n── 2. Recording the checks, with their dates ───────────────');

const RANG = '2026-09-18T10:00:00.000Z';
const rang = await apiCall(API, 'PATCH', `/api/services/admin/${providerId}`, { phoneConfirmedAt: RANG }, ADMIN);
rang.status === 200
  ? ok('an admin records that the number was rung, with the date it happened')
  : bad(`recording the phone check returned ${rang.status} ${JSON.stringify(rang.body).slice(0, 140)}`);

/**
 * ⚠️ Back-dated on purpose. The check happened when it happened: a call made on
 * the 18th and recorded on the 20th is an 18th check, and a server that stamped
 * `now()` would quietly make every check look fresher than it is.
 */
(q(`SELECT to_char("phoneConfirmedAt", 'YYYY-MM-DD') FROM service_providers WHERE id = '${providerId}'`)) === '2026-09-18'
  ? ok('…and the date is the one given, not the moment it was typed in')
  : bad(`phoneConfirmedAt stored as ${q(`SELECT "phoneConfirmedAt" FROM service_providers WHERE id = '${providerId}'`)}`);

q(`SELECT "checkedByAdminId" FROM service_providers WHERE id = '${providerId}'`) === admin.id
  ? ok('…and which admin recorded it, for accountability')
  : bad(`checkedByAdminId is ${JSON.stringify(q(`SELECT "checkedByAdminId" FROM service_providers WHERE id = '${providerId}'`))}`);

const nowPublished = await apiCall(API, 'PATCH', `/api/services/admin/${providerId}`, { active: true }, ADMIN);
nowPublished.status === 200 && nowPublished.body?.active === true
  ? ok('…and now it can be listed')
  : bad(`publishing a checked provider returned ${nowPublished.status}`);

/**
 * ⚠️ And the check cannot be withdrawn out from under a live listing in one
 * call. `{ active: true, phoneConfirmedAt: null }` would otherwise clear the
 * only thing that justifies the listing while keeping it live — which is why
 * the rule is evaluated against what the row will BE, not against the request.
 */
const clearWhileLive = await apiCall(API, 'PATCH', `/api/services/admin/${providerId}`,
  { phoneConfirmedAt: null }, ADMIN);
clearWhileLive.status === 400
  ? ok('…and the phone check cannot be cleared while the provider is still listed')
  : bad(`clearing the check on a live provider returned ${clearWhileLive.status}`);

await apiCall(API, 'PATCH', `/api/services/admin/${providerId}`,
  { idCheckedAt: '2026-09-19T09:00:00.000Z', referenceCheckedAt: '2026-09-20T14:00:00.000Z', tradeRegistration: 'PIRB P12345' },
  ADMIN);
const stored = {
  id: q(`SELECT "idCheckedAt" IS NOT NULL FROM service_providers WHERE id = '${providerId}'`),
  ref: q(`SELECT "referenceCheckedAt" IS NOT NULL FROM service_providers WHERE id = '${providerId}'`),
  reg: q(`SELECT "tradeRegistration" FROM service_providers WHERE id = '${providerId}'`),
};
stored.id === 't' && stored.ref === 't' && stored.reg === 'PIRB P12345'
  ? ok('the identity check, the reference call and the registration are all recorded')
  : bad(`stored checks are ${JSON.stringify(stored)}`);

/**
 * ⚠️ No document, anywhere. Only the outcome persists — the rule
 * verification_requests already follows for tenants and landlords. Asserted
 * against the column list rather than trusted, because "we should store the ID
 * so we can re-check it" is a reasonable-sounding thing somebody adds later.
 */
const cols = q(`SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_name = 'service_providers'`);
!/document|photo|upload|idnumber|id_number/i.test(cols ?? 'unknown')
  ? ok('…and the table holds no document, photo or ID number — only outcomes')
  : bad(`service_providers has a column that stores the evidence itself: ${cols}`);

console.log('\n── 3. What a landlord is sent, and what they are not ───────');

const list = await apiCall(API, 'GET', '/api/services?category=plumber', null, landlord.token);
list.status === 200
  ? ok('a landlord can read the directory')
  : bad(`the directory returned ${list.status}`);

const mine = (list.body ?? []).find((p) => p.id === providerId);
mine
  ? ok('…and the provider we checked is in it')
  : bad('the checked provider is not in the landlord-facing list');

if (mine) {
  mine.phoneConfirmedAt && mine.idCheckedAt && mine.referenceCheckedAt
    ? ok('…with the outcomes, so the screen can state WHICH checks were done')
    : bad(`the payload omits the outcomes: ${JSON.stringify(Object.keys(mine))}`);

  mine.tradeRegistration === 'PIRB P12345'
    ? ok('…and the registration verbatim, so a landlord can check it with the body themselves')
    : bad(`tradeRegistration came through as ${JSON.stringify(mine.tradeRegistration)}`);

  /**
   * ⚠️ Which admin signed somebody off is for accountability, not for the
   * directory. The column did not exist before this phase, so a bare findMany
   * would have started shipping it the moment it did — the same reasoning as
   * the verification endpoint withholding documentPath.
   */
  !('checkedByAdminId' in mine)
    ? ok('…and NOT which admin signed them off, which is ours and not the landlord’s')
    : bad('the landlord-facing payload leaks checkedByAdminId');
}

console.log('\n── 4. An unchecked name never reaches a landlord ───────────');

const other = await apiCall(API, 'POST', '/api/services/admin',
  { category: 'electrician', name: `Unchecked Sparks ${S}`, phone: `083 2${String(S).padStart(6, '0').slice(0, 2)} 7654`, areas: ['Tembisa'] },
  ADMIN);
other.status === 201
  ? ok('a second provider exists as a draft, with nothing recorded (precondition, asserted)')
  : bad(`the draft fixture failed: ${other.status}`);

/**
 * ⚠️ The LANDLORD route, and the response asserted as a list first.
 *
 * A fat-fingered edit pointed this at /api/services/admin, which a landlord is
 * refused — so `body` was an error object, `.some()` found nothing, and the
 * check reported "a landlord does not see it" about a request that never
 * returned a directory at all. A negative check against a failed request
 * proves nothing in either direction, so the shape is asserted before the
 * absence is.
 */
const landlordSees = await apiCall(API, 'GET', '/api/services', null, landlord.token);
Array.isArray(landlordSees.body)
  ? ok('the landlord-facing directory answers with a list (precondition, asserted)')
  : bad(`the directory returned ${landlordSees.status} ${JSON.stringify(landlordSees.body).slice(0, 120)} — the absence check below would prove nothing`);
Array.isArray(landlordSees.body) && !landlordSees.body.some((p) => p.id === other.body?.id)
  ? ok('…and the unchecked provider is not in it, because nobody has rung the number')
  : bad('an unchecked provider is in the landlord-facing directory');

console.log('\n── 5. The existing rows were not grandfathered in ──────────');

/**
 * ⚠️ The migration un-published every live provider, because none of them had a
 * recorded check and leaving them live would mean the directory still said "we
 * checked these" about rows nobody checked — the exact defect it existed to
 * end. This asserts the state that migration guarantees, rather than trusting
 * that it ran: a provider that is live and unchecked should not exist anywhere
 * in the table.
 */
const liveUncheckedRows = q(`SELECT COUNT(*) FROM service_providers WHERE active = true AND "phoneConfirmedAt" IS NULL`);
liveUncheckedRows === '0'
  ? ok('no provider anywhere is live without the number having been rung')
  : bad(`${liveUncheckedRows} live provider(s) have no phone check — the claim on the screen is false for them`);

console.log(`\n${fail === 0 ? '✅ all checks passed' : `❌ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
