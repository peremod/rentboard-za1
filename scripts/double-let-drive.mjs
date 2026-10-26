#!/usr/bin/env node
/**
 * Can one room be let to two people at once? — the API brief's gap 5.
 *
 * ── Why this exists
 *
 * `docs/API-TESTING.md` §6.5 names concurrency as a gap in its own words: "No
 * test races two acceptances of the same room, or two simultaneous rent marks
 * for one month. The idempotency that exists is asserted sequentially."
 *
 * §91 is why that gap is worth closing now rather than later. The tenant
 * dashboard's 500 was a race nobody could reproduce for four days, because
 * every fixture built by hand was one thing standing still. The same shape of
 * defect in `accept` does not cost a dialog — it costs a room. This product is
 * built for somebody with four back rooms, and two people told they have the
 * same one is a person arriving with their things.
 *
 * ── The shape of the suspicion
 *
 * `applications.service.ts accept()` reads, checks, then writes, with no
 * transaction and no conditional update:
 *
 *     const application = await this.getOwnedApplication(id, landlordId);
 *     this.assertNotDecided(application);        // reads the application's OWN status
 *     ... update the application to accepted ...
 *     ... update the room to let ...
 *     await this.autoRejectOthers(roomId, id);   // what protects the room
 *
 * `assertNotDecided` knows only about the application in front of it. What
 * keeps a room from being accepted twice is `autoRejectOthers`, which runs
 * AFTER the write — so sequentially the room is safe, and concurrently there
 * is a window in which two different applications for one room both read
 * `pending`, both pass the check, and both are accepted.
 *
 * ── What is asserted
 *
 * Not "it did not crash". That one room ends up let ONCE: one acceptance, one
 * tenancy, one tenant told they have it.
 *
 *   node scripts/double-let-drive.mjs          # needs the API on :3000
 */
import { registerUser, apiCall, dbRows, dbQuery } from './lib/drive-session.mjs';

const API = process.env.API ?? 'http://localhost:3000';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const warn = (m) => console.log('  ⚠️  ' + m);
const iso = (d) => d.toISOString().slice(0, 10);
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

const ll = await registerUser(API, 'LANDLORD');
const T = ll.token;

async function room(title) {
  const r = await apiCall(API, 'POST', '/api/rooms', {
    roomType: 'shared_house', title, rentCents: 250000, province: 'Gauteng',
    city: 'Johannesburg', locationDisplay: 'Soweto', availableFrom: iso(inDays(1)),
    housematesCount: 2, billsIncluded: true,
    description: 'A clean single room in a quiet Soweto yard with a shared kitchen, an outside tap and a gate locked at night.',
  }, T);
  if (r.status >= 300) { bad(`room: ${JSON.stringify(r.body).slice(0, 160)}`); return null; }
  await apiCall(API, 'PATCH', `/api/rooms/${r.body.id}/photos`, { paths: ['rooms/demo/cover.jpg'] }, T);
  await apiCall(API, 'POST', `/api/rooms/${r.body.id}/publish`, {}, T);
  return r.body.id;
}

async function applicant(roomId) {
  const tn = await registerUser(API, 'TENANT');
  const app = await apiCall(API, 'POST', '/api/applications', {
    roomId, coverNote: 'I would like this room please, I can move in at the start of the month.',
  }, tn.token);
  if (app.status >= 300) { bad(`apply: ${JSON.stringify(app.body).slice(0, 160)}`); return null; }
  return { tenant: tn, applicationId: app.body.id };
}

/** Settle time for the fire-and-forget tenancy open inside accept(). */
const settle = () => new Promise((r) => setTimeout(r, 1500));

// ══ 1. Two applicants, one room, both accepted at the same moment ══════════
console.log('\n── Two applications for one room, accepted at the same moment ──');

const roomId = await room('A room two people are told they have');
if (!roomId) { console.log('\n❌ fixtures failed'); process.exit(1); }

const a = await applicant(roomId);
const b = await applicant(roomId);
if (!a || !b) { console.log('\n❌ fixtures failed'); process.exit(1); }

// Fired together, deliberately not awaited in sequence.
const [ra, rb] = await Promise.all([
  apiCall(API, 'POST', `/api/applications/${a.applicationId}/accept`, {}, T),
  apiCall(API, 'POST', `/api/applications/${b.applicationId}/accept`, {}, T),
]);
await settle();

const accepted = [ra, rb].filter((r) => r.status < 300).length;
const refused = [ra, rb].filter((r) => r.status >= 400 && r.status < 500).length;
const errored = [ra, rb].filter((r) => r.status >= 500).length;

console.log(`     responses: ${ra.status}, ${rb.status}`);

/**
 * ⚠️ WHICH guard refused, and why that decides what this run proves.
 *
 * `200, 400` is also what a run where the two requests SERIALISED looks like:
 * the first acceptance completes, `autoRejectOthers` rejects the second
 * application, and `assertNotDecided` then refuses it on the sequential path —
 * which was always correct and was never the defect. A drive that cannot tell
 * that apart from a working compare-and-swap passes whether or not the fix is
 * there, which is the fault §91 was a lesson in.
 *
 * The two refusals say different things, so they can be told apart:
 *
 *   · the room CAS      "This room has already been let to another applicant"
 *   · the application
 *     CAS               "This application has already been decided"
 *   · the sequential
 *     path              "This application has already been rejected"
 *
 * A run refused only by the sequential path is reported as INCONCLUSIVE for
 * this race, not as a pass.
 */
const refusals = [ra, rb]
  .filter((r) => r.status >= 400)
  .map((r) => String(r.body?.message ?? ''));
const byRace = refusals.filter((m) => /already been let|already been decided/i.test(m));
const bySequence = refusals.filter((m) => /already been rejected|already been accepted/i.test(m));

accepted === 1
  ? ok('exactly one acceptance succeeded')
  : bad(`${accepted} of 2 acceptances succeeded — a room let ${accepted} times`);

if (accepted === 1 && byRace.length === 0 && bySequence.length > 0) {
  warn('INCONCLUSIVE for this race: the two requests serialised, so the refusal');
  warn('came from autoRejectOthers and the conditional claim was never tested.');
  warn(`refusal was: "${bySequence[0]}"`);
  fail++;
} else if (byRace.length > 0) {
  ok(`the conditional claim is what refused — "${byRace[0]}"`);
}
refused === 1
  ? ok('…and the other was refused with a 4xx, which is the honest answer')
  : bad(`${refused} refusals; a loser must be told why, not given a 500 or a silent 200`);
errored === 0 ? ok('neither answered 5xx') : bad(`${errored} response(s) were 5xx`);

// ── The database is the witness, not the status codes ──────────────────────
const acceptedRows = dbRows(
  `SELECT id FROM applications WHERE "roomId" = '${roomId}' AND status = 'accepted'`,
);
acceptedRows.length === 1
  ? ok(`one accepted application on the room (${acceptedRows.length})`)
  : bad(`${acceptedRows.length} accepted applications for one room`);

const tenancies = dbRows(
  `SELECT id, status FROM tenancies WHERE "roomId" = '${roomId}' AND status NOT IN ('cancelled')`,
);
tenancies.length <= 1
  ? ok(`at most one live tenancy on the room (${tenancies.length})`)
  : bad(`${tenancies.length} live tenancies for one room — this is the double-let`);

// ══ 2. The same application accepted twice at the same moment ═════════════
console.log('\n── One application, accepted twice at the same moment ─────────');

const room2 = await room('A room accepted twice over');
const c = room2 ? await applicant(room2) : null;
if (!room2 || !c) { console.log('\n❌ fixtures failed'); process.exit(1); }

const [r1, r2] = await Promise.all([
  apiCall(API, 'POST', `/api/applications/${c.applicationId}/accept`, {}, T),
  apiCall(API, 'POST', `/api/applications/${c.applicationId}/accept`, {}, T),
]);
await settle();

console.log(`     responses: ${r1.status}, ${r2.status}`);
const won = [r1, r2].filter((r) => r.status < 300).length;
won === 1
  ? ok('exactly one of the two identical accepts succeeded')
  : bad(`${won} of 2 identical accepts succeeded`);
[r1, r2].every((r) => r.status < 500)
  ? ok('neither answered 5xx')
  : bad(`a 5xx: ${r1.status}, ${r2.status}`);

const t2 = dbRows(`SELECT id FROM tenancies WHERE "roomId" = '${room2}'`);
t2.length === 1
  ? ok('one tenancy, because Tenancy.applicationId is unique')
  : bad(`${t2.length} tenancies for one application`);

// ══ 3. One rent month, marked twice at the same moment ═══════════════════
//
// The other half of what §6.5 names: "two simultaneous rent marks for one
// month". `rent.service.ts mark()` is a Prisma `upsert` on the unique
// [tenancyId, periodStart]. An upsert is a read then a write, so two of them
// can both decide to INSERT and one loses on the constraint — which is
// correct, as long as the person is told something true rather than handed a
// 500 for pressing a button twice.
//
// ⚠️ The rent tracker is the landlord's OWN RECORD. Mastande never holds rent
// or a deposit, and nothing here moves money; a duplicated month would be a
// wrong record, not a double charge.
console.log('\n── One rent month, marked paid twice at the same moment ───────');

const room3 = await room('A room with a rent month');
const d = room3 ? await applicant(room3) : null;
if (!room3 || !d) { console.log('\n❌ fixtures failed'); process.exit(1); }

await apiCall(API, 'POST', `/api/applications/${d.applicationId}/accept`, {}, T);
await settle();

// dbRows returns LINES OF TEXT, one per row — not objects. Reading `.id` off
// one gave `undefined`, which the route answered with "uuid is expected".
const [tenancyId] = dbRows(`SELECT id FROM tenancies WHERE "roomId" = '${room3}'`);
if (!tenancyId) {
  bad('no tenancy was opened, so the rent race cannot be driven');
} else {
  // Rent can only be recorded for a month the tenant actually lived there,
  // so the move-in has to be confirmed first.
  const started = await apiCall(
    API, 'POST', `/api/tenancies/${tenancyId}/confirm-start`,
    { startDate: iso(inDays(-40)) }, T,
  );
  if (started.status >= 300) {
    bad(`confirm-start: ${started.status} ${JSON.stringify(started.body).slice(0, 140)}`);
  } else {
    const month = iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

    /**
     * ⚠️ Repeated, and the row is deleted between attempts.
     *
     * One pair of requests proves little here: if the first upsert commits
     * before the second reads, both take the UPDATE path, no constraint is
     * ever tested, and the drive passes having raced nothing. Deleting the
     * period between attempts puts every pair back on the INSERT path, which
     * is the only one the unique index can reject.
     */
    const ATTEMPTS = 5;
    let serverErrors = 0;
    let duplicates = 0;
    const codes = [];
    for (let i = 0; i < ATTEMPTS; i++) {
      dbQuery(`DELETE FROM rent_periods WHERE "tenancyId" = '${tenancyId}'`);
      const [m1, m2] = await Promise.all([
        apiCall(API, 'PATCH', `/api/properties/rent/${tenancyId}/mark`, { periodStart: month, status: 'paid' }, T),
        apiCall(API, 'PATCH', `/api/properties/rent/${tenancyId}/mark`, { periodStart: month, status: 'paid' }, T),
      ]);
      codes.push(`${m1.status}/${m2.status}`);
      if (m1.status >= 500 || m2.status >= 500) serverErrors++;
      const rows = dbRows(`SELECT id FROM rent_periods WHERE "tenancyId" = '${tenancyId}'`);
      if (rows.length !== 1) duplicates++;
    }
    console.log(`     ${ATTEMPTS} attempts, response pairs: ${codes.join(', ')}`);

    serverErrors === 0
      ? ok(`no rent mark answered 5xx in ${ATTEMPTS} attempts`)
      : bad(`${serverErrors}/${ATTEMPTS} attempts produced a 5xx — a unique-constraint violation reaching the client`);
    duplicates === 0
      ? ok(`exactly one rent period each time, in ${ATTEMPTS} attempts`)
      : bad(`${duplicates}/${ATTEMPTS} attempts left the wrong number of rent periods`);
  }
}

console.log('\n═══ Summary ═══');
if (fail === 0) {
  console.log('  ✅ a room is let once, however many accepts arrive together.');
} else {
  console.log(`  ❌ ${fail} assertion(s) failed.`);
  warn('A room let twice is two people arriving with their things.');
}
console.log('════════════════════════════════════════════════════════════\n');
process.exit(fail === 0 ? 0 : 1);
