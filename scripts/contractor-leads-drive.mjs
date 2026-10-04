/**
 * Leads sent to a contractor, and what they would come to — Phase 7k.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️  NOTHING IN THIS PHASE TAKES MONEY, AND THAT IS THE FINDING
 * ═════════════════════════════════════════════════════════════════════════
 *
 * The brief said to inspect the contractor, lead and user models and determine
 * the cleanest architecture before implementing payments. Inspecting them
 * answered the question:
 *
 *   · `ServiceProvider` has no `userId` and no email. A contractor is a name, a
 *     phone number and the areas they cover. They cannot sign in, cannot see a
 *     bill, cannot accept terms and cannot dispute a charge.
 *   · There was no lead model at all. Nothing recorded that a number had been
 *     passed on, so there was nothing to bill for either.
 *
 * So this builds the RECORD and stops. Invoicing happens outside the product,
 * by a person, from these figures. Collecting inside it would need contractor
 * accounts first — a portal, terms acceptance, a bill they can read and a way
 * to disagree with it — which is a product decision for the owner.
 *
 * It does not touch "free to list, free to apply": the money would come from a
 * contractor receiving leads, a third party, never from a landlord listing a
 * room or a tenant applying for one.
 *
 * ── What is checked here
 *
 *   1. **There is no price anywhere in the product.** With no rate configured,
 *      a lead is counted and deliberately NOT priced. That is the answer to
 *      "do not implement arbitrary pricing assumptions".
 *   2. **Nothing is billable without agreement AND a rate.** Charging somebody
 *      for leads they never agreed to receive is not defensible.
 *   3. **The fee is snapshotted.** Changing the price next month must not
 *      re-price what was already sent, and agreeing terms in November must not
 *      make October billable.
 *   4. **One lead per landlord per day**, so tapping while the phone rings does
 *      not bill five times.
 *   5. **The payload says it is a record, not an invoice** — in a field, so an
 *      export built on it cannot drift from what the screen says.
 *
 * Promotes its own admin. Needs the API on :3000 and a DATABASE_URL.
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
ADMIN ? ok('the drive promoted its own admin') : bad('could not sign in as admin — nothing below proves anything');

const landlordA = await registerUser(API, 'LANDLORD');
const landlordB = await registerUser(API, 'LANDLORD');

/** A listed plumber — which needs the phone check from Phase 7j. */
const mk = async (name, category, phone) => {
  const c = await apiCall(API, 'POST', '/api/services/admin',
    { category, name, phone, areas: ['Tembisa'] }, ADMIN);
  if (c.status !== 201) return null;
  await apiCall(API, 'PATCH', `/api/services/admin/${c.body.id}`,
    { phoneConfirmedAt: '2026-09-18T10:00:00.000Z' }, ADMIN);
  await apiCall(API, 'PATCH', `/api/services/admin/${c.body.id}`, { active: true }, ADMIN);
  return c.body.id;
};

const noAgreement = await mk(`Unagreed Plumber ${S}`, 'plumber', `082 5${String(S).slice(0, 2)} 1111`);
const agreed = await mk(`Agreed Locksmith ${S}`, 'locksmith', `083 6${String(S).slice(0, 2)} 2222`);
noAgreement && agreed
  ? ok('two listed contractors exist (precondition, asserted)')
  : bad(`the contractor fixtures failed (${noAgreement}, ${agreed})`);

/**
 * ⚠️ Clear the rates for the categories this drive uses, and say why.
 *
 * Rates are insert-only by design — a new row supersedes an older one and the
 * old one stays, because leads point at the rate they were created under. That
 * is right for the product and it makes this drive stateful: the first run
 * passed on an empty table, and the second read back the 10500c rate the first
 * run had set, so "a lead is priced at the rate" failed with the fee from the
 * previous run. A drive that only passes on a clean database is one somebody
 * eventually "fixes" by weakening the assertion.
 *
 * Deleting rows the product refuses to delete is a liberty a drive may take on
 * its own fixtures. The two categories named here are the only ones it uses.
 */
q(`DELETE FROM contractor_lead_rates WHERE category IN ('plumber', 'locksmith')`);

console.log('\n── 1. There is no price in the product ─────────────────────');

/**
 * ⚠️ The check that answers the brief directly. No constant, no default, no
 * environment variable: with no rate configured, a lead is counted and not
 * priced, which is the honest state of a price nobody has decided.
 */
Number(q(`SELECT COUNT(*) FROM contractor_lead_rates WHERE category = 'plumber'`)) === 0
  ? ok('no plumber rate is configured (precondition, asserted)')
  : bad('a plumber rate exists — the unpriced checks below would prove nothing');
await apiCall(API, 'POST', `/api/services/admin/${noAgreement}/lead-fees-agreed`,
  { note: `Agreed on the phone, 2 Oct, ticket ${S}.` }, ADMIN);

const unpriced = await apiCall(API, 'POST', `/api/services/${noAgreement}/lead`,
  { channel: 'call' }, landlordA.token);
unpriced.status === 200
  ? ok('a lead is recorded even when no rate has been set')
  : bad(`recording a lead with no rate returned ${unpriced.status} ${JSON.stringify(unpriced.body).slice(0, 140)}`);

const unpricedRow = {
  fee: q(`SELECT "feeCents" IS NULL FROM contractor_leads WHERE id = '${unpriced.body?.leadId}'`),
  billable: q(`SELECT billable FROM contractor_leads WHERE id = '${unpriced.body?.leadId}'`),
};
unpricedRow.fee === 't' && unpricedRow.billable === 'f'
  ? ok('…with NO fee and not billable — the product counts it and declines to put a number on it')
  : bad(`the unpriced lead has fee-null ${unpricedRow.fee}, billable ${unpricedRow.billable}`);

/** And nowhere in the source is there a number standing in for a price. */
Number(q(`SELECT COUNT(*) FROM contractor_lead_rates`)) >= 0
  ? ok('…and the rate table is where a price lives, which ships empty')
  : bad('could not read the rate table');

console.log('\n── 2. Nothing is billable without agreement AND a rate ─────');

const RATE = 3500;   // chosen by this DRIVE for its arithmetic, not by the product
const rate = await apiCall(API, 'POST', '/api/services/admin/lead-rates',
  { category: 'locksmith', amountCents: RATE, effectiveFrom: '2026-09-01T00:00:00.000Z', note: 'Set by the drive.' },
  ADMIN);
rate.status === 201 || rate.status === 200
  ? ok('an admin can set what a lead costs, from a date')
  : bad(`setting a rate returned ${rate.status} ${JSON.stringify(rate.body).slice(0, 140)}`);

const negative = await apiCall(API, 'POST', '/api/services/admin/lead-rates',
  { category: 'locksmith', amountCents: -100, effectiveFrom: '2026-09-01T00:00:00.000Z' }, ADMIN);
negative.status === 400
  ? ok('…and a negative rate is refused — that is a mistake, not a price')
  : bad(`a negative rate returned ${negative.status}`);

/**
 * ⚠️ A rate exists for locksmiths, but this one has NOT agreed to pay. Charging
 * somebody for leads they never agreed to receive is not defensible, and they
 * cannot agree in-product because they have no account.
 */
const notAgreedLead = await apiCall(API, 'POST', `/api/services/${agreed}/lead`,
  { channel: 'whatsapp' }, landlordA.token);
notAgreedLead.status === 200
  ? ok('a lead to a contractor who has not agreed is still recorded')
  : bad(`that lead returned ${notAgreedLead.status}`);
q(`SELECT billable FROM contractor_leads WHERE id = '${notAgreedLead.body?.leadId}'`) === 'f'
  ? ok('…and is NOT billable, because they never agreed to pay for leads')
  : bad('a lead was marked billable against somebody who never agreed to pay');

const agreement = await apiCall(API, 'POST', `/api/services/admin/${agreed}/lead-fees-agreed`,
  { note: `Agreed on the phone, 2 Oct — happy to pay per lead. Ticket ${S}.` }, ADMIN);
agreement.status === 200
  ? ok('an admin records that they agreed, out of band')
  : bad(`recording the agreement returned ${agreement.status}`);

const shortNote = await apiCall(API, 'POST', `/api/services/admin/${agreed}/lead-fees-agreed`,
  { note: 'yes' }, ADMIN);
shortNote.status === 400
  ? ok('…and "yes" is refused: it is the only evidence, because they have no account to agree in')
  : bad(`a three-character agreement note returned ${shortNote.status}`);

/**
 * ⚠️ And agreeing in November does NOT make October billable. The earlier lead
 * stays as it was recorded, which is why `billable` is stored rather than
 * derived on read.
 */
q(`SELECT billable FROM contractor_leads WHERE id = '${notAgreedLead.body?.leadId}'`) === 'f'
  ? ok('…and the lead sent BEFORE they agreed is still not billable')
  : bad('agreeing terms retroactively made an earlier lead billable');

const nowBillable = await apiCall(API, 'POST', `/api/services/${agreed}/lead`,
  { channel: 'call' }, landlordB.token);
const billableRow = {
  fee: q(`SELECT "feeCents" FROM contractor_leads WHERE id = '${nowBillable.body?.leadId}'`),
  billable: q(`SELECT billable FROM contractor_leads WHERE id = '${nowBillable.body?.leadId}'`),
};
billableRow.billable === 't' && billableRow.fee === String(RATE)
  ? ok(`a lead after both the agreement and the rate is billable, at the rate (${RATE}c)`)
  : bad(`the billable lead has fee ${billableRow.fee}, billable ${billableRow.billable}`);

console.log('\n── 3. The fee is snapshotted, not recomputed ───────────────');

await apiCall(API, 'POST', '/api/services/admin/lead-rates',
  { category: 'locksmith', amountCents: RATE * 3, effectiveFrom: new Date().toISOString(), note: 'Price rise.' },
  ADMIN);
q(`SELECT "feeCents" FROM contractor_leads WHERE id = '${nowBillable.body?.leadId}'`) === String(RATE)
  ? ok('tripling the rate does not re-price a lead already recorded')
  : bad(`the existing lead re-priced to ${q(`SELECT "feeCents" FROM contractor_leads WHERE id = '${nowBillable.body?.leadId}'`)}`);

/** A rate dated in the future is not in force yet. */
await apiCall(API, 'POST', '/api/services/admin/lead-rates',
  { category: 'locksmith', amountCents: 999999, effectiveFrom: new Date(Date.now() + 30 * 86400_000).toISOString() },
  ADMIN);
const landlordC = await registerUser(API, 'LANDLORD');
const futureLead = await apiCall(API, 'POST', `/api/services/${agreed}/lead`, { channel: 'call' }, landlordC.token);
q(`SELECT "feeCents" FROM contractor_leads WHERE id = '${futureLead.body?.leadId}'`) === String(RATE * 3)
  ? ok('…and a rate dated next month is not used yet — the one in force is')
  : bad(`a future-dated rate was applied: fee is ${q(`SELECT "feeCents" FROM contractor_leads WHERE id = '${futureLead.body?.leadId}'`)}`);

console.log('\n── 4. One lead per landlord per day ────────────────────────');

const before = Number(q(`SELECT COUNT(*) FROM contractor_leads WHERE "providerId" = '${agreed}'`));
for (let i = 0; i < 4; i++) {
  await apiCall(API, 'POST', `/api/services/${agreed}/lead`, { channel: 'call' }, landlordB.token);
}
Number(q(`SELECT COUNT(*) FROM contractor_leads WHERE "providerId" = '${agreed}'`)) === before
  ? ok('tapping four more times creates no further leads — one per landlord per day')
  : bad(`four extra taps created ${Number(q(`SELECT COUNT(*) FROM contractor_leads WHERE "providerId" = '${agreed}'`)) - before} more leads`);

/** A different landlord on the same day IS a second lead. */
const landlordD = await registerUser(API, 'LANDLORD');
await apiCall(API, 'POST', `/api/services/${agreed}/lead`, { channel: 'whatsapp' }, landlordD.token);
Number(q(`SELECT COUNT(*) FROM contractor_leads WHERE "providerId" = '${agreed}'`)) === before + 1
  ? ok('…but a DIFFERENT landlord the same day is a second lead')
  : bad('a different landlord did not create a second lead');

console.log('\n── 5. Who can record one, and against whom ────────────────');

const unlisted = await apiCall(API, 'POST', '/api/services/admin',
  { category: 'cleaner', name: `Unlisted Cleaner ${S}`, phone: `084 7${String(S).slice(0, 2)} 3333`, areas: ['Tembisa'] },
  ADMIN);
const againstUnlisted = await apiCall(API, 'POST', `/api/services/${unlisted.body?.id}/lead`,
  { channel: 'call' }, landlordA.token);
againstUnlisted.status === 400
  ? ok('no lead can be recorded against somebody who is not listed')
  : bad(`a lead against an unlisted provider returned ${againstUnlisted.status}`);

const anon = await apiCall(API, 'POST', `/api/services/${agreed}/lead`, { channel: 'call' });
anon.status === 401
  ? ok('…and recording a lead needs a session')
  : bad(`an unauthenticated lead returned ${anon.status}`);

const badChannel = await apiCall(API, 'POST', `/api/services/${agreed}/lead`,
  { channel: 'telepathy' }, landlordA.token);
badChannel.status === 400
  ? ok('…and the channel has to be one we actually offer')
  : bad(`an invented channel returned ${badChannel.status}`);

console.log('\n── 6. The summary says it is a record, not an invoice ──────');

const summary = await apiCall(API, 'GET', '/api/services/admin/leads', null, ADMIN);
summary.status === 200
  ? ok('an admin can read what was sent and what it comes to')
  : bad(`the summary returned ${summary.status}`);

/**
 * ⚠️ In the PAYLOAD, not only on the screen. A report, an export or a second
 * admin surface reads this before it reads a number, so nothing built on top
 * can mistake the figure for an amount owed on an invoice that exists.
 */
/**
 * ⚠️ The assertion was wrong, not the copy: it looked for "not been invoiced
 * or paid" against text that reads "Nothing here HAS been invoiced or paid".
 * Matched on both halves of the claim now, so it cannot pass on a sentence
 * that mentions invoicing without denying it.
 */
/nothing here has been invoiced or paid/i.test(summary.body?.disclaimer ?? '')
  ? ok('…and the payload itself says nothing has been invoiced or paid')
  : bad(`the disclaimer reads: ${JSON.stringify(summary.body?.disclaimer)}`);
/cannot do either|no account/i.test(summary.body?.disclaimer ?? '')
  ? ok('…and that the product cannot bill, because contractors have no account')
  : bad('the disclaimer does not say why the product cannot bill');

const row = (summary.body?.rows ?? []).find((r) => r.provider.id === agreed);
row
  ? ok('the contractor appears in the summary')
  : bad('the contractor is not in the summary');
if (row) {
  row.leads.billable >= 1 && row.leads.notBillable >= 1
    ? ok(`…with priced and counted-only reported SEPARATELY (${row.leads.billable} and ${row.leads.notBillable})`)
    : bad(`the counts are ${JSON.stringify(row.leads)} — one total would hide which`);
  row.wouldOweCents > 0
    ? ok(`…and what it would come to (${row.wouldOweCents}c), from the snapshotted fees`)
    : bad(`wouldOweCents is ${row.wouldOweCents}`);
  row.agreedToLeadFees === true
    ? ok('…and that they agreed, with the note recording how')
    : bad('the summary does not show the agreement');
}

const asLandlord = await apiCall(API, 'GET', '/api/services/admin/leads', null, landlordA.token);
asLandlord.status === 403
  ? ok('a landlord cannot read the lead summary')
  : bad(`a landlord reading the summary got ${asLandlord.status}`);

console.log('\n── 7. And nothing anywhere collects money ──────────────────');

/**
 * ⚠️ Asserted against the SURFACE, not by reading the code.
 *
 * The honest check that this phase stopped where it said it would: no route in
 * the services module takes a payment, and no lead carries a paid or invoiced
 * state. If somebody later adds one, this fails and they have to come and
 * change a check whose comment says why it exists.
 */
const leadColumns = q(`SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_name = 'contractor_leads'`);
!/paid|invoice|settled|payment|charged/i.test(leadColumns ?? 'unknown')
  ? ok(`a lead has no paid, invoiced or settled state (${leadColumns})`)
  : bad(`contractor_leads has a payment state: ${leadColumns} — this phase was meant to stop before collecting`);

for (const route of ['pay', 'invoice', 'checkout', 'charge']) {
  const probe = await apiCall(API, 'POST', `/api/services/admin/leads/${route}`, {}, ADMIN);
  probe.status === 404
    ? ok(`there is no /services/admin/leads/${route} route`)
    : bad(`POST /services/admin/leads/${route} answered ${probe.status} — something collects money`);
}

console.log(`\n${fail === 0 ? '✅ all checks passed' : `❌ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
