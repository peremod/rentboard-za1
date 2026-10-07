/**
 * What Mastande actually puts on the wire for WhatsApp — Phase 8i.
 *
 * ── Why this exists
 *
 * Every WhatsApp send in this codebase was written from documentation and
 * **none of it had ever been observed**. There is no test, no drive and no
 * staging exercise anywhere that has seen a single outbound body, because the
 * only way to look was to configure live Meta credentials and send a real
 * message to a real phone.
 *
 * That is how three send paths shipped using a message type Meta rejects.
 * `type: 'text'` is permitted ONLY inside the 24-hour customer service window —
 * within 24 hours of the person messaging the business. A sign-in code goes to
 * somebody who has not messaged us, by definition, so it is always outside the
 * window and always rejected with error 131047. `sendOtp` could never have
 * delivered in production, and looked perfect in development because with no
 * credentials set it logs the code instead of sending it.
 *
 * PRE-LAUNCH-CHECKLIST.md row 40 has recorded this since Phase 0. Recording it
 * is not the same as being able to see it, which is what this drive adds.
 *
 * ── How it looks without Meta
 *
 * `WHATSAPP_GRAPH_BASE_URL` points the Cloud API client at a stub this script
 * runs. The stub records the exact JSON body, the Authorization header and the
 * path, and answers the shape Meta answers. Nothing leaves the machine and no
 * Meta account is needed, so this runs on every checkout rather than on the one
 * where somebody has credentials.
 *
 * ⚠️ It proves the SHAPE, not the approval. A template name Meta has not
 * approved produces a correctly-shaped request that Meta rejects with 132001,
 * and nothing here can tell the difference. Section 4 says so on screen rather
 * than letting a green run read as "WhatsApp works".
 *
 * Needs: a built backend (`cd backend && npm run build`) and a database.
 * It starts its own API on PORT_API below; nothing else need be running.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT_STUB = 4399;
const PORT_API = 3399;
const TEMPLATE = 'mastande_signin_code';
const LANG = 'en';

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

// ── 1. The payload builder, both branches ─────────────────────────────────
//
// Imported from the COMPILED backend, not reimplemented here. A drive that
// rebuilds the thing it is checking checks its own copy, which is how this
// repository's nav audit once passed over a dead link.
console.log('\n── 1. The body we build, text branch and template branch ───');

const require = createRequire(import.meta.url);
let buildOtpSend;
try {
  ({ buildOtpSend } = require(join(ROOT, 'backend/dist/modules/whatsapp/whatsapp.service.js')));
} catch (err) {
  console.log(`⏭  could not load the compiled service: ${err.message}`);
  process.exit(0);
}
if (typeof buildOtpSend !== 'function') {
  console.log('❌ buildOtpSend is not exported from the compiled whatsapp.service');
  process.exit(1);
}

const asText = buildOtpSend({ phone: '+27821234567', code: '482913', ttlMinutes: 10 });
check(asText.type === 'text', `with no template configured the body is type: ${asText.type}`);
check(
  asText.to === '27821234567',
  `…and the number is sent without its + (${asText.to})`,
);
check(
  String(asText.text?.body).includes('482913') && String(asText.text?.body).includes('10 minutes'),
  '…carrying the code and the expiry in the text itself',
);

const asTpl = buildOtpSend({
  phone: '+27821234567', code: '482913', ttlMinutes: 10,
  templateName: TEMPLATE, templateLang: LANG,
});
check(asTpl.type === 'template', `with a template configured the body is type: ${asTpl.type}`);
check(asTpl.template?.name === TEMPLATE, `…naming the approved template (${asTpl.template?.name})`);
check(
  asTpl.template?.language?.code === LANG,
  `…under the language it was approved as (${asTpl.template?.language?.code})`,
);

const body = (asTpl.template?.components ?? []).find((c) => c.type === 'body');
const button = (asTpl.template?.components ?? []).find((c) => c.type === 'button');
check(body?.parameters?.[0]?.text === '482913', '…with the code in the body, which is what a person reads');
// ⚠️ The one people leave out. An authentication template REQUIRES a one-time
// password button, and the code has to be passed to it as well as to the body
// — that is what the copy-code button puts on the clipboard. Omitting it does
// not send a message without a button; it fails.
check(!!button, '…and a button component, which an authentication template requires');
check(
  button?.parameters?.[0]?.text === '482913',
  '…carrying the code too, which is what copy-code copies',
);
check(button?.sub_type === 'url', `…with sub_type url (${button?.sub_type})`);
// A string, not the number 0: some API versions reject the number.
check(button?.index === '0', `…and index as the string "0" (${JSON.stringify(button?.index)})`);

// ⚠️ The expiry must NOT be in the payload. It is baked into the template's
// footer at approval time, so sending it is a second source of truth that can
// disagree with the one Meta holds.
check(
  !JSON.stringify(asTpl).includes('10 minutes'),
  'the TTL is not put in the template payload — Meta holds it, from the approved footer',
);

// ── 2. What the service actually sends ────────────────────────────────────
//
// The builder being right proves nothing about whether the service calls it.
// This runs the real API against a stub Cloud API and reads the request.
console.log('\n── 2. The request the running API makes ───────────────────');

const seen = [];
const stub = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    seen.push({
      path: req.url,
      auth: req.headers.authorization ?? '',
      contentType: req.headers['content-type'] ?? '',
      body: (() => { try { return JSON.parse(raw); } catch { return { unparseable: raw.slice(0, 200) }; } })(),
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.STUB' }] }));
  });
});
await new Promise((r) => stub.listen(PORT_STUB, r));

const api = spawn('node', [built], {
  cwd: join(ROOT, 'backend'),
  env: {
    ...process.env,
    PORT: String(PORT_API),
    WHATSAPP_GRAPH_BASE_URL: `http://localhost:${PORT_STUB}`,
    WHATSAPP_PHONE_NUMBER_ID: '111111111111111',
    WHATSAPP_ACCESS_TOKEN: 'stub-access-token',
    WHATSAPP_TEMPLATE_OTP: TEMPLATE,
    WHATSAPP_TEMPLATE_LANG: LANG,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let apiLog = '';
api.stdout.on('data', (d) => { apiLog += d; });
api.stderr.on('data', (d) => { apiLog += d; });

const stop = async () => {
  api.kill('SIGKILL');
  await new Promise((r) => stub.close(r));
};

let up = false;
for (let i = 0; i < 90; i++) {
  try {
    const r = await fetch(`http://localhost:${PORT_API}/health`);
    if (r.ok) { up = true; break; }
  } catch { /* still starting */ }
  await sleep(1000);
}
if (!up) {
  bad('the API did not start on the drive port — nothing below ran');
  console.log(apiLog.slice(-1500));
  await stop();
  summary();
}

/**
 * The SIGN-UP path, deliberately — not sign-in.
 *
 * ⚠️ `/auth/phone/request-code` sends only when an account already exists, and
 * answers 200 either way on purpose, so that it cannot be used to discover who
 * has one. Pointed at a fresh number it therefore produces a 200, no send, and
 * a drive that cannot tell "the send is broken" from "there was nobody to send
 * to". The first version of this drive did exactly that, and the guard below
 * is what said so rather than passing.
 *
 * Sign-up sends unconditionally, because the whole point is that the number is
 * new. That makes it the only path here where a missing request means a real
 * fault.
 */
// ⚠️ Nine digits after +27, not eight. PhoneCodeDto matches
// /^(\+?27|0)[6-8]\d{8}$/ — the 8 is the first of the nine — and a short
// number is a 400 the drive would otherwise have reported as a broken send.
const PHONE = `+2782${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
const res = await fetch(`http://localhost:${PORT_API}/api/auth/phone/signup/request-code`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: PHONE }),
});
check(
  res.ok,
  `POST /auth/phone/signup/request-code answered ${res.status} for ${PHONE}` +
    (res.ok ? '' : ` — ${(await res.text()).slice(0, 160)}`),
);

// The send is fire-and-forget on that path, so it lands just after the reply.
for (let i = 0; i < 40 && seen.length === 0; i++) await sleep(250);

if (seen.length === 0) {
  // ⚠️ Not silently tolerated. "No request was made" is exactly what a broken
  // send looks like, and it is also what an account-less number looks like on
  // the sign-in path — so the drive says which it could not tell apart rather
  // than passing.
  bad(
    'the API made no request to the Cloud API at all. Sign-up sends to a new number ' +
    'unconditionally, so this is the send being unwired rather than there being ' +
    `nobody to send to. Last of the API log: ${apiLog.slice(-400).replace(/\s+/g, ' ')}`,
  );
} else {
  const r = seen[0];
  check(
    r.path === `/v19.0/111111111111111/messages`,
    `…to ${r.path}, the configured number's messages endpoint`,
  );
  check(r.auth === 'Bearer stub-access-token', '…with the access token as a bearer credential');
  check(/application\/json/.test(r.contentType), '…as JSON');
  check(
    r.body.type === 'template',
    `…and the body is type: ${r.body.type} — a sign-in code is business-initiated, so text would be rejected`,
  );
  check(
    r.body.template?.name === TEMPLATE,
    `…naming the configured template (${r.body.template?.name})`,
  );
  const btn = (r.body.template?.components ?? []).find((c) => c.type === 'button');
  check(!!btn?.parameters?.[0]?.text, '…and the button carries the code');
  check(
    !JSON.stringify(r.body).includes('stub-access-token'),
    '…with the credential in the header only, never in the body',
  );
}

// ── 3. The warning an operator needs at boot ──────────────────────────────
console.log('\n── 3. Credentials with no template say so, at boot ─────────');

await stop();
seen.length = 0;

const api2 = spawn('node', [built], {
  cwd: join(ROOT, 'backend'),
  env: {
    ...process.env,
    PORT: String(PORT_API),
    WHATSAPP_PHONE_NUMBER_ID: '111111111111111',
    WHATSAPP_ACCESS_TOKEN: 'stub-access-token',
    WHATSAPP_TEMPLATE_OTP: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log2 = '';
api2.stdout.on('data', (d) => { log2 += d; });
api2.stderr.on('data', (d) => { log2 += d; });
for (let i = 0; i < 90; i++) {
  try { if ((await fetch(`http://localhost:${PORT_API}/health`)).ok) break; } catch { /* starting */ }
  await sleep(1000);
}
api2.kill('SIGKILL');

// Credentials set and no template is the state that LOOKS configured and
// delivers nothing. It has to be visible where an operator reads, which is the
// boot log, not a per-message error they never see.
check(
  /WHATSAPP_TEMPLATE_OTP is not set|TEMPLATE_OTP/i.test(log2) && /131047/.test(log2),
  'credentials with no template warn at boot, naming the error Meta will answer (131047)',
);

// ── 4. What this did NOT prove ────────────────────────────────────────────
console.log('\n── 4. What a green run here does not mean ─────────────────');
console.log('  ⚠️  The template NAME was never checked against Meta. An unapproved');
console.log('      name produces a correctly-shaped request that Meta rejects with');
console.log('      132001, and nothing above can tell the difference.');
console.log('  ⚠️  notifyLandlord, rent reminders, reference requests and notices are');
console.log('      all still free-form text and still fail outside the 24-hour window.');
console.log('      They degrade honestly rather than breaking — see OUTSTANDING §27.');
console.log('  ⚠️  No message has ever been delivered to a real handset from this');
console.log('      repository. That needs live credentials and a phone.');

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
