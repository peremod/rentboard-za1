/**
 * The WhatsApp kill switch — Phase 8j.
 *
 * ── What this is for
 *
 * `WHATSAPP_ENABLED=false` is a decision about money: Meta bills per message,
 * an authentication message to a South African number is about USD $0.0095
 * plus VAT from the very first one, and there is no free allowance. On a
 * product that is free to list and free to apply that is a per-head cost with
 * nothing behind it.
 *
 * A switch like that is worth exactly what it can be shown to do. The failure
 * everybody imagines is "it is off and something sends anyway" — a bill. The
 * failure this codebase actually keeps producing is the other one: a button
 * that still looks like it works, a code issued that nobody can receive, a
 * screen that says a message went when it did not. Both are checked here.
 *
 * ── How it looks without Meta
 *
 * The API is run against a stub Cloud API on PORT_STUB. If ANY request reaches
 * that stub while the switch is off, that is a request that would have reached
 * Meta and been billed. Nothing leaves the machine.
 *
 * Needs: a built backend (`cd backend && npm run build`) and a database.
 * It starts its own API; nothing else need be running.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT_STUB = 4398;
const PORT_API = 3398;

let pass = 0;
const failures = [];
const ok = (m) => { pass++; console.log('  ✅ ' + m); };
const bad = (m) => { failures.push(m); console.log('  ❌ ' + m); };
const check = (c, m) => (c ? ok(m) : bad(m));

const built = join(ROOT, 'backend/dist/main.js');
if (!existsSync(built)) {
  console.log(`⏭  No build at ${built} — run: cd backend && npm run build`);
  process.exit(0);
}

/** Nine digits after +27, which is what PhoneCodeDto's regex wants. */
const phone = () => `+2782${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

// ── Any request here is a request that would have cost money ──────────────
const reachedMeta = [];
const stub = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    reachedMeta.push({ path: req.url, body: raw.slice(0, 300) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.STUB' }] }));
  });
});
await new Promise((r) => stub.listen(PORT_STUB, r));

/**
 * ⚠️ Credentials ARE set, and a template name with them.
 *
 * That is the whole point. Proving nothing is sent when nothing is configured
 * proves nothing: it was never going to send. The switch has to hold on a
 * deployment that is fully able to send and has simply been told not to —
 * which is exactly the state this product is in now that setup is documented.
 */
const api = spawn('node', [built], {
  cwd: join(ROOT, 'backend'),
  env: {
    ...process.env,
    PORT: String(PORT_API),
    WHATSAPP_ENABLED: 'false',
    WHATSAPP_GRAPH_BASE_URL: `http://localhost:${PORT_STUB}`,
    WHATSAPP_PHONE_NUMBER_ID: '111111111111111',
    WHATSAPP_ACCESS_TOKEN: 'stub-access-token',
    WHATSAPP_TEMPLATE_OTP: 'mastande_signin_code',
    WHATSAPP_VERIFY_TOKEN: 'stub-verify-token',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let apiLog = '';
api.stdout.on('data', (d) => { apiLog += d; });
api.stderr.on('data', (d) => { apiLog += d; });

const stop = async () => { api.kill('SIGKILL'); await new Promise((r) => stub.close(r)); };

let up = false;
for (let i = 0; i < 90; i++) {
  try { if ((await fetch(`http://localhost:${PORT_API}/health`)).ok) { up = true; break; } }
  catch { /* still starting */ }
  await sleep(1000);
}
if (!up) {
  bad('the API did not start — nothing below ran');
  console.log(apiLog.slice(-1500));
  await stop();
  summary();
}

const post = (path, body) =>
  fetch(`http://localhost:${PORT_API}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// ── 1. Every door that issues a code refuses, and says where to go ────────
//
// ⚠️ It must REFUSE, not accept-and-not-send. Accepting burns the per-number
// code budget, writes a row, and leaves somebody watching a handset. The
// status is what distinguishes the two, so it is asserted rather than the
// absence of a send.
console.log('\n── 1. The doors that issue a code ─────────────────────────');

for (const [label, path, body] of [
  ['sign in', '/auth/phone/request-code', { phone: phone() }],
  ['sign up', '/auth/phone/signup/request-code', { phone: phone() }],
]) {
  const res = await post(path, body);
  const text = await res.text();
  check(res.status === 503, `${label}: ${path} answers ${res.status} (want 503)`);
  // ⚠️ The words matter as much as the status. Somebody who has only ever
  // signed in with a number needs the alternative named, not a bare refusal.
  /email address/i.test(text)
    ? ok('…and the message names the way in that works')
    : bad(`${label}: the refusal does not mention email — ${text.slice(0, 200)}`);
  !/whatsapp is too expensive|cost|bill/i.test(text)
    ? ok('…without explaining our billing to the public')
    : bad(`${label}: the refusal leaks why — ${text.slice(0, 200)}`);
}

// ── 2. The webhook cannot be registered or acted on ───────────────────────
console.log('\n── 2. The webhook ────────────────────────────────────────');

const hs = await fetch(
  `http://localhost:${PORT_API}/api/whatsapp/webhook` +
    `?hub.mode=subscribe&hub.verify_token=stub-verify-token&hub.challenge=hello`,
);
const hsBody = await hs.text();
// Refused even with the CORRECT verify token — otherwise Meta could register
// a webhook against a deployment that will never act on a delivery.
check(
  hs.status >= 400 && hsBody !== 'hello',
  `the handshake is refused even with the right verify token (${hs.status})`,
);

// ── 3. Nothing reached the Cloud API ──────────────────────────────────────
console.log('\n── 3. What reached Meta ──────────────────────────────────');

// Fire-and-forget sends land just after the reply, so give them a moment.
await sleep(3000);
reachedMeta.length === 0
  ? ok('not one request reached the Cloud API — nothing was billable')
  : bad(
      `${reachedMeta.length} request(s) reached the Cloud API with the switch OFF — ` +
        `each one is a message Meta would bill: ${JSON.stringify(reachedMeta.slice(0, 2))}`,
    );

// ── 4. The boot log says which state it is in ─────────────────────────────
console.log('\n── 4. What an operator reads at boot ─────────────────────');
check(
  /WhatsApp is OFF/i.test(apiLog) && /WHATSAPP_ENABLED/.test(apiLog),
  'the API says at boot that WhatsApp is off, and names the variable',
);
check(
  /wa\.me/i.test(apiLog),
  '…and says wa.me links are unaffected, so nobody goes looking for a bug there',
);

// ── 5. The browser and the API agree ──────────────────────────────────────
//
// ⚠️ The dangerous drift is the frontend flag being TRUE while the API is off:
// that is a button which looks like it works. Read from the source rather than
// rendered, because this runs without a frontend server.
console.log('\n── 5. The flag the browser reads ─────────────────────────');

const flags = readFileSync(join(ROOT, 'frontend/src/app/core/config/feature-flags.ts'), 'utf8');
const m = flags.match(/export const WHATSAPP_ENABLED\s*=\s*(true|false)/);
check(!!m, 'the frontend exports a WHATSAPP_ENABLED flag at all');
check(m?.[1] === 'false', `…and it is ${m?.[1]}, which agrees with the API being off`);

// The entry points that promise a WhatsApp message must read the flag, not
// their own guess. A hardcoded `true` beside the flag is the drift.
for (const [label, file] of [
  ['the login screen', 'frontend/src/app/features/auth/login/login.ts'],
  ['the sign-up screen', 'frontend/src/app/features/auth/register/register.ts'],
  ['the auth routes', 'frontend/src/app/features/auth/auth.routes.ts'],
  // The landing page's trust strip advertised "WhatsApp Notifications" to
  // every visitor. A promise on the front page is the loudest kind.
  ['the landing page trust strip', 'frontend/src/app/features/home/home.ts'],
]) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  check(
    /WHATSAPP_ENABLED/.test(src),
    `${label} reads the flag rather than deciding for itself`,
  );
}

// ── 6. What is deliberately NOT switched off ──────────────────────────────
//
// wa.me opens the person's own WhatsApp. Meta bills nobody for it, and in this
// market it is free distribution — sharing a room, calling a plumber. Removing
// it would cost the product something and save nothing, so a check guards it
// against a later over-eager sweep.
console.log('\n── 6. The free links, still there ────────────────────────');

for (const [label, file] of [
  ['referral sharing', 'frontend/src/app/core/services/referrals.service.ts'],
  ['the contractor directory', 'frontend/src/app/core/models/service-provider.model.ts'],
]) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  check(/wa\.me/.test(src), `${label} still builds a wa.me link — Meta never bills for those`);
}

await stop();

console.log('\n── What this did NOT prove ───────────────────────────────');
console.log('  ⚠️  Flipping the switch back ON is not exercised here. That path');
console.log('      is scripts/whatsapp-template-drive.mjs, which runs with');
console.log('      WHATSAPP_ENABLED=true and reads the body on the wire.');
console.log('  ⚠️  Nothing here proves a real Meta account is not being charged');
console.log('      for something else — only that this API makes no call.');

summary();

function summary() {
  console.log('\n═══════════════════════════════════════════════════════');
  if (failures.length) {
    console.log(`  ❌ ${failures.length} failed, ${pass} passed.`);
    failures.forEach((f) => console.log(`     ${f}`));
    console.log('═══════════════════════════════════════════════════════\n');
    process.exit(1);
  }
  console.log(`  ✅ ${pass} checks passed.`);
  console.log('═══════════════════════════════════════════════════════\n');
  process.exit(0);
}
