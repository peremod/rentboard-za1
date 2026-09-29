/**
 * Does deleting actually delete? — the check that was missing.
 *
 * ── Why this script exists
 *
 * Nothing in this codebase had ever deleted a stored file. Deciding a
 * verification cleared `documentPath`, set a column named `documentDeletedAt`,
 * and wrote an audit event reading "The uploaded document was deleted." There
 * was no ImageKit SDK in package.json and no call to its delete API anywhere.
 * The reference went; the ID photograph stayed.
 *
 * Three live statements said otherwise, one of them statutory — the privacy
 * policy, the PAIA manual, and the line shown to a tenant as they upload their
 * ID. The one smoke assertion covering it read `documentDeletedAt != null`,
 * which was true and proved nothing, and it sat behind ADMIN_TOKEN so it had
 * never run.
 *
 * So the standard here is not "the code calls fetch". It is: a DELETE arrived at
 * the storage API, for the right file, and a failure does NOT get recorded as a
 * deletion. That needs somewhere to receive the request, which is why this
 * script IS an ImageKit stub.
 *
 *   # in backend/ — all three, and the key must be exactly this so the drive can
 *   # recompute the signature independently rather than trusting the server's
 *   IMAGEKIT_API_BASE=http://127.0.0.1:4310 \
 *     IMAGEKIT_PRIVATE_KEY=stub-private-key \
 *     IMAGEKIT_PUBLIC_KEY=stub-public-key \
 *     IMAGEKIT_URL_ENDPOINT=https://ik.example/stub \
 *     npm run start:dev
 *
 * All four. The public key is not used here, but smoke-test.sh checks the upload
 * auth payload is complete, and a server with a private key and no public one
 * fails it — correctly. Set three of four and you get a red suite that has
 * nothing to do with what you changed.
 *   node scripts/storage-drive.mjs
 *
 * It refuses to run against a server that is not pointed at the stub, because
 * passing by talking to nothing is the failure mode it exists to rule out.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { registerUser, apiCall } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
const STUB_PORT = 4310;
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const iso = (d) => d.toISOString().slice(0, 10);
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The stub ───────────────────────────────────────────────────────────────
//
// Records every request, so the assertions are about what the server actually
// sent rather than about what it logged. `mode` lets one test make deletion
// fail, which is the half that matters most: a failure must not be recorded as
// success, or we are back to the original bug with extra steps.
const seen = { lookups: [], deletes: [] };
let mode = 'ok';
/** path -> fileId, so a lookup can resolve to something deletable. */
const files = new Map();

const stub = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${STUB_PORT}`);

  if (req.method === 'GET' && url.pathname === '/v1/files') {
    const q = url.searchParams.get('searchQuery') ?? '';
    seen.lookups.push(q);
    if (mode === 'lookup500') { res.writeHead(500); return res.end('stub lookup failure'); }
    // filePath="/rooms/x.jpg" -> rooms/x.jpg
    const m = /filePath="\/?([^"]*)"/.exec(q);
    const path = m?.[1] ?? '';
    const fileId = files.get(path);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(fileId ? [{ fileId, filePath: `/${path}` }] : []));
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/v1/files/')) {
    const fileId = decodeURIComponent(url.pathname.slice('/v1/files/'.length));
    seen.deletes.push(fileId);
    if (mode === 'delete500') { res.writeHead(500); return res.end('stub delete failure'); }
    for (const [p, id] of files) if (id === fileId) files.delete(p);
    res.writeHead(204);
    return res.end();
  }

  res.writeHead(404);
  res.end();
});
// A clear message, because the stack trace for this is unreadable and the cause
// is almost always another copy of a stub left running from an earlier run.
stub.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`  ❌ something is already listening on 127.0.0.1:${STUB_PORT} — this drive needs that port for its ImageKit stub.`);
    console.log('     ↳ stop it and re-run. A stub left over from an earlier run is the usual cause.');
  } else {
    console.log(`  ❌ could not start the stub: ${e.message}`);
  }
  process.exit(1);
});
await new Promise((r) => stub.listen(STUB_PORT, '127.0.0.1', r));

// ── Guard: is the API even pointed at us? ──────────────────────────────────
//
// Checked by making the API do a deletion and seeing whether the stub hears
// anything, rather than by reading its config — the whole point is to test the
// wire, so trusting a self-report would defeat it.

const ll = await registerUser(API, 'LANDLORD');
const T = ll.token;

// The drain is admin-only, deliberately — see StorageController. Same seeded
// account services-drive.mjs uses.
const adm = await apiCall(API, 'POST', '/api/auth/login', {
  email: 'ci-admin@mastande.test', password: 'CiSmokeAdmin123',
});
const AT = adm.body?.accessToken ?? adm.body?.access_token;
if (!AT) {
  console.log('  ❌ no admin: run `npm run db:seed` with ADMIN_EMAIL=ci-admin@mastande.test ADMIN_PASSWORD=CiSmokeAdmin123');
  stub.close();
  process.exit(1);
}
ok('admin signed in');

// A landlord must NOT be able to drain the queue or read the counts.
const forbidden = await apiCall(API, 'POST', '/api/admin/storage/drain', {}, T);
forbidden.status === 403
  ? ok('a landlord cannot work the deletion queue')
  : bad(`landlord drain got ${forbidden.status}, expected 403`);

async function tenancy(title) {
  const r = await apiCall(API, 'POST', '/api/rooms', {
    roomType: 'shared_house', title, rentCents: 250000, province: 'Gauteng',
    city: 'Johannesburg', locationDisplay: 'Soweto', availableFrom: iso(inDays(1)),
    housematesCount: 2, billsIncluded: true,
    description: 'A clean single room in a quiet Soweto yard with a shared kitchen, an outside tap and a gate locked at night.',
  }, T);
  if (r.status >= 300) { bad(`room: ${JSON.stringify(r.body).slice(0, 140)}`); return null; }
  await apiCall(API, 'PATCH', `/api/rooms/${r.body.id}/photos`, { paths: ['rooms/demo/cover.jpg'] }, T);
  await apiCall(API, 'POST', `/api/rooms/${r.body.id}/publish`, {}, T);
  const tn = await registerUser(API, 'TENANT');
  const app = await apiCall(API, 'POST', '/api/applications', {
    roomId: r.body.id,
    coverNote: 'I would like this room please, I can move in at the start of the month.',
  }, tn.token);
  if (app.status >= 300) { bad(`apply: ${JSON.stringify(app.body).slice(0, 160)}`); return null; }
  const acc = await apiCall(API, 'POST', `/api/applications/${app.body.id}/accept`, {}, T);
  if (acc.status >= 300) { bad(`accept: ${JSON.stringify(acc.body).slice(0, 160)}`); return null; }
  for (let i = 0; i < 20; i++) {
    const mine = await apiCall(API, 'GET', '/api/tenancies/mine', undefined, T);
    const list = Array.isArray(mine.body) ? mine.body : (mine.body?.data ?? []);
    const found = list.find((x) => x.room?.id === r.body.id || x.roomId === r.body.id);
    if (found) return { id: found.id, roomId: r.body.id, tenant: tn };
    await sleep(250);
  }
  bad(`no tenancy appeared for room ${r.body.id}`);
  return null;
}

const tcy = await tenancy('Lease document room');
if (!tcy) { console.log('\n❌ fixtures failed'); stub.close(); process.exit(1); }
ok('a tenancy to hang documents off');

// ── Storage only: the feature itself ──────────────────────────────────────

const LEASE_PATH = 'leases/drive/signed-lease.pdf';
files.set(LEASE_PATH, 'file-lease-1');

const add = await apiCall(API, 'POST', `/api/tenancies/${tcy.id}/documents`, {
  path: LEASE_PATH, label: 'Signed lease, March 2026', kind: 'lease',
  sizeBytes: 482_113, contentType: 'application/pdf',
}, T);
add.status === 201 || add.status === 200
  ? ok('the landlord stores a signed lease')
  : bad(`add: ${add.status} ${JSON.stringify(add.body).slice(0, 200)}`);
const docId = add.body?.id;

// The storage path must not ride along in the list — it is fetched once, when
// someone opens the file.
const list1 = await apiCall(API, 'GET', `/api/tenancies/${tcy.id}/documents`, undefined, T);
const listed = (list1.body || [])[0];
listed && !('path' in listed)
  ? ok('and the list does not carry the storage path')
  : bad(`path leaked into the list: ${JSON.stringify(listed).slice(0, 200)}`);
listed?.mine === true ? ok('it is marked as theirs to change') : bad(`mine: ${listed?.mine}`);

// The tenant is a party and must see it — a lease is about both of them.
const asTenant = await apiCall(API, 'GET', `/api/tenancies/${tcy.id}/documents`, undefined, tcy.tenant.token);
(asTenant.body || []).length === 1
  ? ok('the tenant sees the lease too')
  : bad(`tenant saw ${(asTenant.body || []).length}: ${asTenant.status}`);
(asTenant.body || [])[0]?.mine === false
  ? ok('but not as theirs to change')
  : bad(`tenant's mine flag: ${(asTenant.body || [])[0]?.mine}`);

// A stranger to the tenancy gets 404, not 403 — a 403 would confirm the
// tenancy exists to someone who has no business knowing.
const stranger = await registerUser(API, 'LANDLORD');
const peek = await apiCall(API, 'GET', `/api/tenancies/${tcy.id}/documents`, undefined, stranger.token);
peek.status === 404
  ? ok('a stranger gets 404, which does not confirm the tenancy exists')
  : bad(`stranger got ${peek.status}`);

// ── Opening it: signed, expiring, and not the raw path ────────────────────
//
// Checked independently rather than by trusting the server: the signature is
// recomputed here with the same key and compared. That catches a wrong formula
// in our implementation. Whether ImageKit ACCEPTS the signature needs a real
// key and is the one thing this cannot settle — see PRE-LAUNCH-CHECKLIST.
const open1 = await apiCall(API, 'GET', `/api/tenancies/documents/${docId}/open`, undefined, T);
open1.status === 200 ? ok('a party can ask where to read it') : bad(`open: ${open1.status} ${JSON.stringify(open1.body).slice(0, 200)}`);
const u = String(open1.body?.url ?? '');
u.includes(LEASE_PATH) && u.startsWith('http')
  ? ok('it is an absolute URL, not a bare path resolving against our own origin')
  : bad(`url looks wrong: ${u.slice(0, 160)}`);
const ikt = /[?&]ik-t=(\d+)/.exec(u)?.[1];
const iks = /[?&]ik-s=([0-9a-f]+)/.exec(u)?.[1];
ikt && iks ? ok('signed and time-limited (ik-t and ik-s present)') : bad(`no signature in ${u.slice(0, 160)}`);
if (ikt && iks) {
  const expected = crypto.createHmac('sha1', 'stub-private-key').update(`${LEASE_PATH}${ikt}`).digest('hex');
  iks === expected
    ? ok('and the signature matches an independent HMAC of path + expiry')
    : bad(`signature mismatch: got ${iks.slice(0, 16)}…, computed ${expected.slice(0, 16)}…`);
  const ttl = Number(ikt) - Math.floor(Date.now() / 1000);
  ttl > 0 && ttl <= 300
    ? ok(`it expires in ${ttl}s, so a copied link stops working`)
    : bad(`expiry window is ${ttl}s`);
}
// Guarded on u being non-empty: an empty URL would pass this trivially, which
// is the kind of check that reads green and proves nothing.
u && !u.includes('stub-private-key')
  ? ok('and the private key is not in the URL')
  : bad(u ? 'THE PRIVATE KEY IS IN THE URL' : 'no URL to check for key leakage');

// A stranger cannot get a URL for someone else's lease.
const openStranger = await apiCall(API, 'GET', `/api/tenancies/documents/${docId}/open`, undefined, stranger.token);
openStranger.status === 404
  ? ok('a stranger cannot get a read URL for it')
  : bad(`stranger open got ${openStranger.status}`);
// The tenant can — it is their lease too.
const openTenant = await apiCall(API, 'GET', `/api/tenancies/documents/${docId}/open`, undefined, tcy.tenant.token);
openTenant.status === 200
  ? ok('the tenant can open their own lease')
  : bad(`tenant open got ${openTenant.status}`);

// Only the uploader may remove. Neither party can delete the other's copy of
// what was agreed.
const tenantDelete = await apiCall(API, 'DELETE', `/api/tenancies/documents/${docId}`, undefined, tcy.tenant.token);
tenantDelete.status === 403
  ? ok('the tenant cannot delete the landlord’s upload')
  : bad(`tenant delete got ${tenantDelete.status}`);

// ── No e-signature. Asserted, not just intended. ──────────────────────────
//
// Phase 4e was flagged before it was built because signing is legal document
// execution. This checks the API offers no way to do it, so a later commit
// adding one has to walk past a failing test.
const signish = Object.keys(add.body || {}).filter((k) => /sign|witness|execut|notar/i.test(k));
signish.length === 0
  ? ok('nothing on a stored document records a signature')
  : bad(`signature-shaped fields present: ${signish.join(', ')}`);
const trySign = await apiCall(API, 'POST', `/api/tenancies/documents/${docId}/sign`, {}, T);
trySign.status === 404
  ? ok('and there is no sign endpoint to call (404)')
  : bad(`POST .../sign answered ${trySign.status} — e-signature must not exist yet`);

// ── Deletion, for real ────────────────────────────────────────────────────

const before = seen.deletes.length;
const rm = await apiCall(API, 'DELETE', `/api/tenancies/documents/${docId}`, undefined, T);
rm.status === 200 ? ok('the uploader removes it') : bad(`remove: ${rm.status} ${JSON.stringify(rm.body).slice(0, 160)}`);

// The removal itself deletes the bytes — it does not merely enqueue and wait for
// the hourly cron. That changed deliberately: the privacy policy says documents
// are "deleted once reviewed" and the tenant upload screen says "as soon as
// someone has looked at it", and an hourly drain made both of those mean "within
// the hour". So the DELETE should already have arrived by the time the request
// returned, with no drain call of our own.
const heardImmediately = seen.deletes.length > before;
heardImmediately
  ? ok('the DELETE goes out with the removal, not at the top of the hour')
  : bad('nothing reached storage during the removal — deletion is waiting on the cron');

// The endpoint still exists and is still admin-only, as the retry path.
const drain1 = await apiCall(API, 'POST', '/api/admin/storage/drain', {}, AT);
drain1.status === 200 || drain1.status === 201
  ? ok('and the queue can still be drained on demand, as the retry path')
  : bad(`drain answered ${drain1.status} ${JSON.stringify(drain1.body).slice(0, 160)}`);

const heard = seen.deletes.length > before;
heard
  ? ok(`a DELETE actually reached storage (${seen.deletes.at(-1)})`)
  : bad('NOTHING reached storage — the file was unlinked, not deleted. This is the original bug.');
if (!heard) {
  console.log('     ↳ is the API running with IMAGEKIT_API_BASE=http://127.0.0.1:4310 and a private key set?');
}
seen.lookups.some((q) => q.includes(LEASE_PATH))
  ? ok('and it resolved the right path first')
  : bad(`lookups did not mention the file: ${JSON.stringify(seen.lookups).slice(0, 200)}`);
!files.has(LEASE_PATH)
  ? ok('the file is gone from storage')
  : bad('storage still holds the file after a successful drain');

// ── A failure must not be recorded as a deletion ──────────────────────────
//
// The half that matters most. The original bug was not a wrong call, it was an
// absent one reported as success — so a stub that refuses must leave the row
// outstanding and must NOT stamp it deleted.
const SECOND = 'leases/drive/addendum.pdf';
files.set(SECOND, 'file-addendum-1');
const add2 = await apiCall(API, 'POST', `/api/tenancies/${tcy.id}/documents`, {
  path: SECOND, label: 'Addendum', kind: 'addendum',
}, T);

// The stub is set to fail BEFORE the removal, not after. It used to be after,
// which stopped working the moment removal began deleting immediately: the queue
// was already empty by the time the mode changed, every later drain reported
// attempted:0, and three assertions failed for the wrong reason.
mode = 'delete500';
const rm2 = await apiCall(API, 'DELETE', `/api/tenancies/documents/${add2.body?.id}`, undefined, T);
rm2.status === 200
  ? ok('a removal still succeeds when storage refuses — the row is durable')
  : bad(`remove with failing storage: ${rm2.status} ${JSON.stringify(rm2.body).slice(0, 160)}`);
files.has(SECOND)
  ? ok('and the file is still there, so "deleted" would have been a lie')
  : bad('the stub lost the file despite refusing to delete it');

const st2 = await apiCall(API, 'GET', '/api/admin/storage/status', undefined, AT);
(st2.body?.outstanding ?? 0) >= 1
  ? ok(`the failure is left outstanding and visible (${st2.body.outstanding} waiting)`)
  : bad(`nothing outstanding after a failed deletion: ${JSON.stringify(st2.body).slice(0, 200)}`);
/50\d|delete failed/i.test(String(st2.body?.oldestError ?? ''))
  ? ok('with the storage provider\u2019s own error recorded against it')
  : bad(`no usable error recorded: ${JSON.stringify(st2.body?.oldestError)}`);

mode = 'ok';
const drain3 = await apiCall(API, 'POST', '/api/admin/storage/drain', {}, AT);
(drain3.body || {}).deleted >= 1
  ? ok('a retry after the failure completes it')
  : bad(`retry did not delete: ${JSON.stringify(drain3.body)}`);
!files.has(SECOND) ? ok('and now the file is gone') : bad('file survived the retry');

// ── The same machinery on a verification document ─────────────────────────
//
// The case the promise was originally made about. A tenant uploads a proof, an
// admin decides, and the document must actually leave storage.
const ID_PATH = 'verification/drive/sassa-letter.jpg';
files.set(ID_PATH, 'file-sassa-1');
const tn2 = await registerUser(API, 'TENANT');
const sub = await apiCall(API, 'POST', '/api/verification', {
  type: 'sassa_grant', documentPath: ID_PATH,
}, tn2.token);
if (sub.status >= 300) {
  bad(`could not submit a verification: ${sub.status} ${JSON.stringify(sub.body).slice(0, 200)}`);
} else {
  ok('a tenant submits a proof document');
  const hist0 = await apiCall(API, 'GET', `/api/verification/mine/${sub.body.id}/history`, undefined, tn2.token);
  const steps0 = (hist0.body || []).map((e) => e.step);
  !steps0.includes('document_deleted')
    ? ok('nothing claims a deletion before one has happened')
    : bad(`trail already says document_deleted: ${steps0.join(', ')}`);

  // The whole reason any of this exists. An admin decides, and the ID document
  // must actually leave storage — not merely stop being pointed at.
  const beforeDecision = seen.deletes.length;
  const dec = await apiCall(API, 'PATCH', `/api/verification/${sub.body.id}/review`, { status: 'approved' }, AT);
  dec.status === 200
    ? ok('an admin approves it')
    : bad(`review: ${dec.status} ${JSON.stringify(dec.body).slice(0, 200)}`);
  dec.body?.documentPath === null || dec.body?.documentPath === undefined
    ? ok('the document is out of view straight away')
    : bad(`documentPath still returned: ${dec.body?.documentPath}`);
  dec.body?.documentWithdrawnAt
    ? ok('and the moment is recorded as a withdrawal, which is what it is')
    : bad(`no documentWithdrawnAt: ${JSON.stringify(dec.body).slice(0, 200)}`);

  // Both steps, by the time the decision returns. They are written at different
  // moments and mean different things — withdrawn in the decision's own
  // transaction, deleted only from the storage provider's response — and the
  // deletion is attempted straight away rather than on the hourly pass, because
  // "deleted once reviewed" should not mean "within the hour".
  const hist1 = await apiCall(API, 'GET', `/api/verification/mine/${sub.body.id}/history`, undefined, tn2.token);
  const steps1 = (hist1.body || []).map((e) => e.step);
  steps1.includes('document_withdrawn')
    ? ok('the trail records the document being withdrawn')
    : bad(`trail steps: ${steps1.join(', ')}`);
  steps1.includes('document_deleted')
    ? ok('and the confirmed deletion, by the time the decision returns')
    : bad(`no confirmed deletion on the trail: ${steps1.join(', ')}`);
  seen.deletes.length > beforeDecision
    ? ok(`a DELETE reached storage for the ID document (${seen.deletes.at(-1)})`)
    : bad('the ID document was never deleted — this is exactly the defect this script exists for');
  !files.has(ID_PATH)
    ? ok('the file is gone')
    : bad('storage still holds the identity document');
}

// ── The promise is checkable ──────────────────────────────────────────────
//
// An unfalsifiable compliance claim is what started all this, so the counts are
// readable and they have to be honest about a stuck row rather than rounding it
// to "nothing pending".
const st = await apiCall(API, 'GET', '/api/admin/storage/status', undefined, AT);
st.status === 200 ? ok('the retention queue reports its own state') : bad(`status ${st.status}`);
typeof st.body?.deleted === 'number' && st.body.deleted >= 1
  ? ok(`and counts what it has actually deleted (${st.body.deleted})`)
  : bad(`deleted count: ${JSON.stringify(st.body).slice(0, 200)}`);
!JSON.stringify(st.body ?? {}).includes(LEASE_PATH)
  ? ok('without naming anyone\u2019s file')
  : bad('the status payload leaks a stored path');

stub.close();
console.log(fail ? `\n❌ ${fail} failure(s)` : '\n✅ stored files are really deleted, and a failure is not reported as a deletion');
process.exit(fail ? 1 : 0);
