/**
 * The lease, on screen, for both parties — Phase 4e.
 *
 * ── What this checks that the API drive cannot
 *
 * scripts/storage-drive.mjs proves the API stores and really deletes. This
 * proves a person can get to it, that BOTH parties see the same document from
 * one component, and — the point of the whole phase — that nothing on the screen
 * says signed, agreed, verified or binding about a file the platform has only
 * stored.
 *
 * That last one is a copy assertion on purpose. Phase 4e was flagged before it
 * was built because storage and execution are one careless sentence apart, and a
 * reassuring word added later by someone tidying the wording is exactly how the
 * line would get crossed.
 *
 * Needs the API on :3000 and the app on :4200.
 */
import { chromium } from '@playwright/test';
import { registerUser, signIn, apiCall, PASSWORD } from './lib/drive-session.mjs';

const API = 'http://localhost:3000', WEB = 'http://localhost:4200';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const iso = (d) => d.toISOString().slice(0, 10);
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

const ll = await registerUser(API, 'LANDLORD');
const T = ll.token;

let tenant = null;
async function tenancy(title) {
  const r = await apiCall(API, 'POST', '/api/rooms', {
    roomType: 'shared_house', title, rentCents: 250000, province: 'Gauteng',
    city: 'Johannesburg', locationDisplay: 'Soweto', availableFrom: iso(inDays(1)),
    housematesCount: 2, billsIncluded: true,
    description: 'A clean single room in a quiet Soweto yard with a shared kitchen, an outside tap and a gate locked at night.',
  }, T);
  await apiCall(API, 'PATCH', `/api/rooms/${r.body.id}/photos`, { paths: ['rooms/demo/cover.jpg'] }, T);
  await apiCall(API, 'POST', `/api/rooms/${r.body.id}/publish`, {}, T);
  const tn = await registerUser(API, 'TENANT');
  tenant = tn;
  const app = await apiCall(API, 'POST', '/api/applications', {
    roomId: r.body.id,
    coverNote: 'I would like this room please, I can move in at the start of the month.',
  }, tn.token);
  await apiCall(API, 'POST', `/api/applications/${app.body.id}/accept`, {}, T);
  for (let i = 0; i < 20; i++) {
    const mine = await apiCall(API, 'GET', '/api/tenancies/mine', undefined, T);
    const f = (mine.body || []).find((x) => x.roomId === r.body.id || x.room?.id === r.body.id);
    if (f) return { id: f.id, roomId: r.body.id };
    await new Promise((res) => setTimeout(res, 250));
  }
  bad(`no tenancy for ${title}`);
  return null;
}

const tcy = await tenancy('Paperwork room');
if (!tcy) { console.log('\n❌ fixtures failed'); process.exit(1); }

// The tenancy starts out `pending`, and a lease is usually signed BEFORE
// move-in — so the pending case is checked first, then the tenancy is confirmed
// and the active case checked. The tenant rent page used to filter pending
// tenancies out entirely and tell the tenant "No tenancies yet", which is when
// they are most likely to be looking for the lease they just signed.
const pendingList = await apiCall(API, 'GET', '/api/tenancies/mine', undefined, tenant.token);
(pendingList.body || [])[0]?.status === 'pending'
  ? ok('the tenancy starts out pending, before anyone has moved in')
  : bad(`expected a pending tenancy, got ${(pendingList.body || [])[0]?.status}`);
const PENDING_TENANCY = tcy.id;

// Two documents: one from each side, so "the other party added this" is real
// rather than a branch nothing exercises.
await apiCall(API, 'POST', `/api/tenancies/${tcy.id}/documents`, {
  path: 'leases/ui/landlord-lease.pdf', label: 'Signed lease March 2026',
  kind: 'lease', sizeBytes: 512_000, contentType: 'application/pdf',
}, T);
await apiCall(API, 'POST', `/api/tenancies/${tcy.id}/documents`, {
  path: 'leases/ui/tenant-inspection.jpg', label: 'Move-in photos',
  kind: 'inspection', sizeBytes: 2_200_000, contentType: 'image/jpeg',
}, tenant.token);

const browser = await chromium.launch();

// ── The landlord's view: behind a toggle in the yard ──────────────────────
const lp = await signIn(browser, WEB, ll.email, PASSWORD);
await lp.goto(`${WEB}/landlord/yard`, { waitUntil: 'domcontentloaded' });
await lp.waitForTimeout(2600);

(await lp.locator('#lease-documents').count()) === 0
  ? ok('the yard does not open with an upload form per tenancy')
  : bad('paperwork is expanded before anyone asked for it');

const toggle = lp.getByRole('button', { name: /Paperwork for/i }).first();
(await toggle.count())
  ? ok('there is a paperwork control, named after the tenant')
  : bad('no paperwork toggle on the yard');
await toggle.click();
await lp.waitForTimeout(1800);

(await lp.locator('#lease-documents').count())
  ? ok('opening it reveals the panel')
  : bad('panel did not appear after clicking Paperwork');

const lbody = (await lp.locator('#lease-documents').textContent()) ?? '';
lbody.includes('Signed lease March 2026')
  ? ok('the landlord sees their own upload')
  : bad('landlord upload missing from the panel');
lbody.includes('Move-in photos')
  ? ok('and the one the tenant added')
  : bad('tenant upload not visible to the landlord');
/added by the other party/i.test(lbody)
  ? ok('which is labelled as the other party’s')
  : bad('nothing says the tenant added it');
/2\.1 MB|2\.2 MB/.test(lbody)
  ? ok('sizes are shown, so a reader knows what a download costs on data')
  : bad(`no human-readable size in: ${lbody.replace(/\s+/g, ' ').slice(0, 200)}`);

// Remove is offered only for your own upload. Two documents, one Remove.
const removes = await lp.locator('#lease-documents').getByRole('button', { name: /^Remove /i }).count();
removes === 1
  ? ok('only their own upload offers Remove')
  : bad(`${removes} Remove buttons for 2 documents, 1 of them theirs`);

// ── The sentence that must not appear ─────────────────────────────────────
//
// Checked as a rendered string, because the risk is someone adding a
// reassuring word later — not the code being wrong today.
const claims = ['is signed', 'legally binding', 'verified by', 'e-signature', 'electronically signed', 'we have checked'];
const found = claims.filter((c) => lbody.toLowerCase().includes(c));
found.length === 0
  ? ok('nothing on the panel claims the lease is signed, verified or binding')
  : bad(`the panel makes a claim it cannot support: ${found.join(', ')}`);
/does not sign|not sign anything/i.test(lbody)
  ? ok('and it says out loud that Mastande does not sign anything')
  : bad('the panel never states the limit of what it does');

// Accessibility of the panel, where the a11y drive cannot reach it: it needs a
// tenancy with documents, and that drive's landlord has neither.
const unnamed = await lp.locator('#lease-documents button, #lease-documents a').evaluateAll(
  (els) => els.filter((el) => !(el.textContent ?? '').trim() && !el.getAttribute('aria-label')).length,
);
unnamed === 0 ? ok('every control in the panel has a name') : bad(`${unnamed} unnamed control(s)`);
const inputsUnlabelled = await lp.locator('#lease-documents input, #lease-documents select').evaluateAll(
  (els) => els.filter((el) => !el.closest('label') && !el.getAttribute('aria-label') && !el.id).length,
);
inputsUnlabelled === 0 ? ok('and every field has a label') : bad(`${inputsUnlabelled} unlabelled field(s)`);
// H2, not H3. The yard blocks are rendered by an ngTemplateOutlet near the top
// of the yard template — above the reminders and money sections — and a yard's
// own name is a <strong>, not a heading. So this sits directly under the page h1.
// It was built as an h3 and this assertion is what caught it; reading the
// template did not, because the outlet is 140 lines from the definition.
const lvl = await lp.locator('#lease-documents h2, #lease-documents h3').evaluateAll((els) => els.map((e) => e.tagName).join(','));
lvl === 'H2'
  ? ok('its heading is an H2, directly under the page H1 where it actually renders')
  : bad(`heading is ${lvl} in the yard`);

// The whole yard page, with the panel open.
const order = await lp.locator('h1,h2,h3,h4').evaluateAll(
  (els) => els.filter((el) => el.offsetWidth || el.offsetHeight).map((el) => Number(el.tagName[1])),
);
const skip = order.findIndex((l, i) => i > 0 && l > order[i - 1] + 1);
order[0] === 1 && skip === -1
  ? ok(`heading order holds with paperwork open (${order.map((l) => 'H' + l).join(' → ')})`)
  : bad(`heading order broken at ${skip}: ${order.map((l) => 'H' + l).join(' → ')}`);

// ── The tenant's view while the tenancy is still pending ──────────────────
//
// The case that was broken: this page filtered pending tenancies out and said
// "No tenancies yet" to someone who had just signed a lease.
const tp = await signIn(browser, WEB, tenant.email, PASSWORD);
await tp.goto(`${WEB}/tenant/rent`, { waitUntil: 'domcontentloaded' });
await tp.waitForTimeout(2600);

const pendingBody = (await tp.locator('body').textContent()) ?? '';
!/No tenancies yet/i.test(pendingBody)
  ? ok('a tenant with a pending tenancy is not told they have none')
  : bad('"No tenancies yet" shown to a tenant who has one');
(await tp.locator('#lease-documents').count())
  ? ok('and can already see the lease they signed before moving in')
  : bad('no paperwork panel while the tenancy is pending');
/move-in is not confirmed/i.test(pendingBody)
  ? ok('with the reason there is no rent record yet')
  : bad('nothing explains the missing rent record');

// Now confirm it, and check the active case.
const confirm = await apiCall(API, 'POST', `/api/tenancies/${PENDING_TENANCY}/confirm-start`,
  { startDate: iso(inDays(-30)) }, T);
confirm.status === 200
  ? ok('the tenancy is confirmed')
  : bad(`confirm-start: ${confirm.status} ${JSON.stringify(confirm.body).slice(0, 200)}`);
await tp.reload({ waitUntil: 'domcontentloaded' });
await tp.waitForTimeout(2600);

(await tp.locator('#lease-documents').count())
  ? ok('the tenant sees their lease without hunting for it')
  : bad('no paperwork panel on the tenant rent page');
const tbody = (await tp.locator('#lease-documents').first().textContent()) ?? '';
tbody.includes('Signed lease March 2026')
  ? ok('including the copy their landlord uploaded')
  : bad('the landlord’s lease is not visible to the tenant');
/added by the other party/i.test(tbody)
  ? ok('attributed to the landlord, from the same one component')
  : bad('the tenant view does not attribute the landlord’s upload');
const tRemoves = await tp.locator('#lease-documents').first().getByRole('button', { name: /^Remove /i }).count();
tRemoves === 1
  ? ok('and the tenant can only remove their own')
  : bad(`tenant sees ${tRemoves} Remove buttons, expected 1`);

const tOrder = await tp.locator('h1,h2,h3,h4').evaluateAll(
  (els) => els.filter((el) => el.offsetWidth || el.offsetHeight).map((el) => Number(el.tagName[1])),
);
const tSkip = tOrder.findIndex((l, i) => i > 0 && l > tOrder[i - 1] + 1);
tOrder[0] === 1 && tSkip === -1
  ? ok(`the tenant page's heading order holds too (${tOrder.map((l) => 'H' + l).join(' → ')})`)
  : bad(`tenant heading order broken at ${tSkip}: ${tOrder.map((l) => 'H' + l).join(' → ')}`);

await browser.close();
console.log(fail ? `\n❌ ${fail} failure(s)` : '\n✅ both parties see the lease, and nothing claims it was signed here');
process.exit(fail ? 1 : 0);
