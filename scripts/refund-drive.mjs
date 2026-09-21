#!/usr/bin/env node
/**
 * The refund promise, driven end to end.
 *
 * The pricing page says "if we cannot verify you, you are refunded in full".
 * That sentence is a commitment, and until v1.59.0 nothing in the code kept
 * it — an admin had to remember. This drives the path that now does.
 *
 * It lives outside scripts/smoke-test.sh because it cannot be done over HTTP
 * alone. Reaching a *paid* verification needs a valid PayFast ITN, and
 * validating one requires PayFast to confirm it server-to-server (see
 * payfast.service.ts step 4, which is what makes a forged ITN useless). There
 * is no way to reach that state from outside without either a live gateway or
 * a test backdoor in the payment handler, and a backdoor in a payment handler
 * is worth more to an attacker than this test is to us. So the paid row is
 * seeded directly, and everything after it is driven through the real API.
 *
 *   node scripts/refund-drive.mjs
 *
 * Needs a running API, the backend's DATABASE_URL, and an admin. Skips with a
 * clear message rather than failing when any of those is missing.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const API = process.env.API_URL ?? 'http://localhost:3000';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', 'backend', 'package.json'));

const GREEN = '\x1b[32m', RED = '\x1b[31m', GREY = '\x1b[90m', BOLD = '\x1b[1m', OFF = '\x1b[0m';
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`${GREEN}  PASS  ${name}${OFF}`); }
  else { fail++; console.log(`${RED}  FAIL  ${name}${detail ? ` — ${detail}` : ''}${OFF}`); }
};
const skip = (why) => { console.log(`${GREY}  SKIP  ${why}${OFF}`); process.exit(0); };

const api = async (method, pathname, body, token) => {
  const res = await fetch(API + pathname, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

console.log(`${BOLD}── Verification refund promise ──${OFF}`);

if (!process.env.DATABASE_URL) skip('set DATABASE_URL to run this — it seeds a paid payment directly');

let PrismaClient;
try {
  ({ PrismaClient } = require('@prisma/client'));
} catch {
  skip('backend dependencies are not installed (npm --prefix backend ci)');
}

const health = await fetch(`${API}/api/rooms`).catch(() => null);
if (!health?.ok) skip(`no API at ${API}`);

const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminEmail || !adminPassword) skip('set ADMIN_EMAIL and ADMIN_PASSWORD — a refund is an admin action');

const admin = await api('POST', '/api/auth/login', { email: adminEmail, password: adminPassword });
if (admin.status !== 200 && admin.status !== 201) skip(`could not sign in as ${adminEmail} (${admin.status})`);
const ADMIN = admin.body.accessToken;

const prisma = new PrismaClient();
const stamp = Date.now();

try {
  // A landlord with an identity check waiting on the fee.
  const landlord = await api('POST', '/api/auth/register', {
    email: `refund+${stamp}@mastande.test`,
    password: 'SmokeTest123',
    fullName: 'Thabo Mokoena',
    role: 'LANDLORD',
  });
  const LT = landlord.body.accessToken;

  const submitted = await api('POST', '/api/verification',
    { type: 'identity', documentPath: `private/verification/refund-${stamp}.jpg` }, LT);
  ok('a landlord identity check waits for the fee', submitted.body?.status === 'pending_payment',
    `status ${submitted.body?.status}`);
  const requestId = submitted.body.id;

  // Rejecting an UNPAID check must owe nobody anything. The obligation
  // attaches to money actually taken, never to a request.
  const unpaidReject = await api('PATCH', `/api/verification/${requestId}/review`,
    { status: 'rejected', reviewNote: 'Not paid, should owe nothing.' }, ADMIN);
  ok('an unpaid check cannot be reviewed at all', unpaidReject.status === 400,
    `got ${unpaidReject.status}`);

  const start = await api('POST', `/api/payments/verification/${requestId}`, null, LT);
  if (start.status !== 200 && start.status !== 201) {
    skip(`PayFast is not configured on this API (${start.status}) — set PAYFAST_MERCHANT_ID/KEY`);
  }

  // The gateway leg. handleItn cannot be reached from here (see the header),
  // but everything it does to the verification is one call, and that call is
  // the compiled service rather than a copy of it — so this covers the real
  // code that a real ITN runs.
  let verification;
  try {
    const { VerificationService } = require('../backend/dist/modules/verification/verification.service');
    verification = new VerificationService(prisma);
  } catch {
    skip('backend is not built (npm --prefix backend run build)');
  }

  await prisma.payment.update({
    where: { id: start.body.paymentId },
    data: { status: 'paid', paidAt: new Date(), providerReference: `pf-${stamp}` },
  });
  const moved = await prisma.$transaction((tx) =>
    verification.confirmPaid(tx, requestId, start.body.paymentId));
  ok('the fee moves the check into the review queue', moved === true);

  // PayFast retries. A retry must not write the payment onto the trail twice.
  const replay = await prisma.$transaction((tx) =>
    verification.confirmPaid(tx, requestId, start.body.paymentId));
  ok('a gateway retry changes nothing', replay === false);

  const queued = await api('GET', '/api/verification/pending', null, ADMIN);
  ok('and it is now in the admin queue',
    (queued.body ?? []).some((r) => r.id === requestId));

  const paidTrail = await api('GET', `/api/verification/mine/${requestId}/history`, null, LT);
  const paidSteps = (paidTrail.body ?? []).filter((e) => e.step === 'paid');
  ok('the payment itself is on the trail, exactly once', paidSteps.length === 1,
    `${paidSteps.length} paid events`);
  ok('and it names the amount that was actually charged',
    /R149/.test(paidSteps[0]?.detail ?? ''), paidSteps[0]?.detail);

  // Reject it. This is the moment the promise either exists or does not.
  const rejected = await api('PATCH', `/api/verification/${requestId}/review`,
    { status: 'rejected', reviewNote: 'The ID photo is too blurry to read.' }, ADMIN);
  ok('admin rejects the paid check', rejected.status === 200, JSON.stringify(rejected.body)?.slice(0, 120));

  const payment = await prisma.payment.findUnique({ where: { id: start.body.paymentId } });
  ok('the refund is owed the moment it is rejected', payment.refundDueAt !== null);
  ok('the money has not moved yet, and the status still says so',
    payment.status === 'paid' && payment.refundedAt === null, `status ${payment.status}`);

  const trail = await api('GET', `/api/verification/mine/${requestId}/history`, null, LT);
  const steps = (trail.body ?? []).map((e) => e.step);
  ok('the fee appears on the audit trail', steps.includes('awaiting_payment'));
  ok('so does the refund we now owe', steps.includes('refund_due'), steps.join(' → '));

  // The queue an admin actually works.
  const mine = await api('GET', '/api/payments/refunds-due', null, LT);
  ok('a landlord cannot read the refunds queue', mine.status === 403, `got ${mine.status}`);

  const queue = await api('GET', '/api/payments/refunds-due', null, ADMIN);
  ok('admin can read it', queue.status === 200);
  ok('and this refund is in it',
    (queue.body ?? []).some((p) => p.id === start.body.paymentId));

  // Record the money going back.
  const refunded = await api('PATCH', `/api/payments/${start.body.paymentId}/refund`,
    { reason: 'Could not verify identity — refunded in full per the pricing page.' }, ADMIN);
  ok('the refund is recorded', refunded.status === 200, JSON.stringify(refunded.body)?.slice(0, 120));

  const after = await api('GET', '/api/payments/refunds-due', null, ADMIN);
  ok('it leaves the queue once paid back',
    !(after.body ?? []).some((p) => p.id === start.body.paymentId));

  const finalTrail = await api('GET', `/api/verification/mine/${requestId}/history`, null, LT);
  ok('and the person can see the promise was kept',
    (finalTrail.body ?? []).some((e) => e.step === 'refunded'),
    (finalTrail.body ?? []).map((e) => e.step).join(' → '));
} finally {
  await prisma.$disconnect();
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
