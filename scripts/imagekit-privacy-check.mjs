#!/usr/bin/env node
/**
 * Is ImageKit actually keeping verification documents private? — finding B-02.
 *
 * ── Why this exists
 *
 * The whole document-confidentiality model rests on one assumption the code
 * cannot see: that the ImageKit account stores these files as PRIVATE and
 * refuses to serve them without a valid `ik-s` signature. The backend signs
 * correctly (storage.service.signedUrl, proven self-consistent by
 * storage-drive.mjs) and strips the raw path from every payload — but if the
 * ImageKit account's "restrict unsigned URLs" / private-file default is OFF,
 * a document on a guessable path is world-readable no matter what this code
 * does. That is a dashboard setting, so no unit test in this repo can assert
 * it. This probe can.
 *
 * ── What it does
 *
 *   1. ALWAYS: a self-check of its own pure logic (classifyUnsigned, the signed
 *      URL shape). No network. Runs everywhere, including CI, and fails loudly
 *      if the logic is wrong — a probe whose own verdict function is broken
 *      would pass an exposed bucket.
 *   2. WITH CREDENTIALS (IMAGEKIT_PRIVATE_KEY, IMAGEKIT_PUBLIC_KEY,
 *      IMAGEKIT_URL_ENDPOINT): uploads a throwaway PRIVATE test file, fetches it
 *      WITHOUT a signature and asserts it is refused (401/403), fetches it WITH
 *      a signature and asserts it is served, then deletes it. A 200 on the
 *      unsigned fetch is the finding: privacy is not enforced.
 *
 * Without credentials it SKIPS the live half (exit 0) and says so — it never
 * reports "private" on the strength of never having checked.
 *
 * ── How to run it (operator, once per environment)
 *
 *   IMAGEKIT_PRIVATE_KEY=... IMAGEKIT_PUBLIC_KEY=... IMAGEKIT_URL_ENDPOINT=... \
 *     node scripts/imagekit-privacy-check.mjs
 *
 * Record the result in PRE-LAUNCH-CHECKLIST.md. See docs/SECURITY-ASSESSMENT-PENTEST.md B-02.
 */
import crypto from 'node:crypto';

const green = (s) => `\u001b[32m${s}\u001b[0m`;
const red = (s) => `\u001b[31m${s}\u001b[0m`;
const grey = (s) => `\u001b[90m${s}\u001b[0m`;

/**
 * The verdict on an unsigned fetch of a private file. Pure, so the self-check
 * can prove it treats a served file as a FAILURE rather than a pass.
 *
 *   enforced     — the CDN refused it (401/403). Privacy is on. This is PASS.
 *   exposed      — the CDN served it (2xx). Privacy is OFF. This is the finding.
 *   inconclusive — anything else (404, 5xx, network): the probe could not tell,
 *                  and must not round that up to "enforced".
 */
export function classifyUnsigned(status) {
  if (status === 401 || status === 403) return 'enforced';
  if (status >= 200 && status < 300) return 'exposed';
  return 'inconclusive';
}

/**
 * The signed URL, byte-for-byte as storage.service.signedUrl builds it:
 * HMAC-SHA1 over `${cleanPath}${expiry}`, keyed with the private key, with the
 * endpoint prefix removed before signing. Duplicated here on purpose — this
 * probe must not import the Nest app, and the two agreeing is part of what it
 * checks.
 */
export function buildSignedUrl(endpoint, privateKey, path, validForSeconds = 300, now = Date.now()) {
  const base = endpoint.replace(/\/+$/, '');
  const clean = path.replace(/^\/+/, '');
  const expiry = Math.floor(now / 1000) + validForSeconds;
  const signature = crypto.createHmac('sha1', privateKey).update(`${clean}${expiry}`).digest('hex');
  return `${base}/${clean}?ik-t=${expiry}&ik-s=${signature}`;
}

/* ── Self-check: the logic, before any network ─────────────────────────────── */

function selfCheck() {
  let failed = 0;
  const is = (label, got, want) => {
    const ok = got === want;
    if (!ok) failed++;
    console.log(`  ${ok ? green('✅') : red('❌')} ${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
  };

  console.log('\n── Self-check: does the probe judge correctly before it trusts the network? ──');
  // The one that matters: a served private file is a FAILURE, never a pass.
  is('200 on an unsigned private fetch is EXPOSED', classifyUnsigned(200), 'exposed');
  is('206 (range) is still EXPOSED', classifyUnsigned(206), 'exposed');
  is('401 is ENFORCED', classifyUnsigned(401), 'enforced');
  is('403 is ENFORCED', classifyUnsigned(403), 'enforced');
  is('404 is INCONCLUSIVE, not enforced', classifyUnsigned(404), 'inconclusive');
  is('500 is INCONCLUSIVE, not enforced', classifyUnsigned(500), 'inconclusive');

  // The signed URL is deterministic for a fixed clock and carries ik-t/ik-s.
  const u1 = buildSignedUrl('https://ik.imagekit.io/acct/', 'priv_key', '/verification/u/x.jpg', 300, 1_000_000_000_000);
  const u2 = buildSignedUrl('https://ik.imagekit.io/acct', 'priv_key', 'verification/u/x.jpg', 300, 1_000_000_000_000);
  is('leading slashes on endpoint and path do not change the URL', u1, u2);
  is('the signed URL carries an ik-s signature', /[?&]ik-s=[0-9a-f]{40}(&|$)/.test(u1), true);
  is('the signed URL carries an ik-t expiry', /[?&]ik-t=\d+/.test(u1), true);
  is('a different private key changes the signature',
    buildSignedUrl('https://ik.imagekit.io/acct', 'other_key', 'verification/u/x.jpg', 300, 1_000_000_000_000) !== u1,
    true);

  return failed;
}

/* ── The live probe ────────────────────────────────────────────────────────── */

const UPLOAD_BASE = process.env.IMAGEKIT_UPLOAD_BASE ?? 'https://upload.imagekit.io';
const API_BASE = process.env.IMAGEKIT_API_BASE ?? 'https://api.imagekit.io';
const TIMEOUT_MS = 10_000;

function basicAuth(privateKey) {
  return `Basic ${Buffer.from(`${privateKey}:`).toString('base64')}`;
}

async function uploadPrivateTestFile(privateKey) {
  // A 1-pixel payload is enough; the bytes are irrelevant, the ACL is the point.
  const bytes = Buffer.from('mastande-privacy-probe', 'utf8');
  const form = new FormData();
  form.append('file', new Blob([bytes]), 'privacy-probe.txt');
  form.append('fileName', `privacy-probe-${Date.now()}.txt`);
  form.append('folder', 'privacy-check');
  form.append('useUniqueFileName', 'true');
  form.append('isPrivateFile', 'true');

  const res = await fetch(`${UPLOAD_BASE}/api/v1/files/upload`, {
    method: 'POST',
    headers: { Authorization: basicAuth(privateKey) },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  return { fileId: data.fileId, filePath: data.filePath };
}

async function deleteTestFile(privateKey, fileId) {
  try {
    await fetch(`${API_BASE}/v1/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: basicAuth(privateKey) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    console.log(grey(`  (could not delete the probe file ${fileId}: ${String(e)} — delete it by hand)`));
  }
}

async function fetchStatus(url) {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.status;
  } catch (e) {
    console.log(grey(`  (fetch error: ${String(e)})`));
    return 0;
  }
}

async function main() {
  if (selfCheck() > 0) {
    console.error(red('\n❌ the probe cannot judge its own fixtures — refusing to report on the live account.\n'));
    process.exit(1);
  }

  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
  const endpoint = process.env.IMAGEKIT_URL_ENDPOINT;
  if (!privateKey || !endpoint) {
    console.log(grey('\n⏭  SKIPPED the live check — IMAGEKIT_PRIVATE_KEY and IMAGEKIT_URL_ENDPOINT are not set.'));
    console.log(grey('   The logic above is verified; whether the account enforces privacy is NOT.'));
    console.log(grey('   Run this with real credentials against each environment and record it in'));
    console.log(grey('   PRE-LAUNCH-CHECKLIST.md. This exits 0 so it does not fail a credential-less CI,'));
    console.log(grey('   which is also why it can never, on its own, prove the setting is correct.\n'));
    process.exit(0);
  }

  console.log('\n── Live check against the real ImageKit account ────────────────');
  let file;
  try {
    file = await uploadPrivateTestFile(privateKey);
    console.log(grey(`  uploaded a private probe file at ${file.filePath}`));
  } catch (e) {
    console.error(red(`\n❌ could not upload a probe file: ${String(e)}\n`));
    process.exit(1);
  }

  let verdict = 1;
  try {
    const unsignedUrl = `${endpoint.replace(/\/+$/, '')}/${file.filePath.replace(/^\/+/, '')}`;
    const unsignedStatus = await fetchStatus(unsignedUrl);
    const unsigned = classifyUnsigned(unsignedStatus);

    const signedUrl = buildSignedUrl(endpoint, privateKey, file.filePath);
    const signedStatus = await fetchStatus(signedUrl);

    console.log(`  unsigned fetch → HTTP ${unsignedStatus} (${unsigned})`);
    console.log(`  signed fetch   → HTTP ${signedStatus}`);

    if (unsigned === 'exposed') {
      console.error(red('\n🔴 FINDING CONFIRMED (B-02): the private file was served WITHOUT a signature.'));
      console.error(red('   ImageKit is not enforcing private files. Every verification and lease'));
      console.error(red('   document on a guessable path is readable by anyone. Turn on "restrict'));
      console.error(red('   unsigned URLs" / private-file default on the ImageKit account NOW.\n'));
      verdict = 1;
    } else if (unsigned === 'enforced' && signedStatus >= 200 && signedStatus < 300) {
      console.log(green('\n✅ Private files are enforced: refused unsigned, served signed. B-02 clear for this account.\n'));
      verdict = 0;
    } else if (unsigned === 'enforced') {
      console.error(red(`\n⚠️  Unsigned was refused (good) but the SIGNED fetch returned ${signedStatus}, not 2xx.`));
      console.error(red('   Privacy may be fine, but signing is not serving documents — reviewers cannot'));
      console.error(red('   open them. Investigate before relying on this result.\n'));
      verdict = 1;
    } else {
      console.error(red(`\n⚠️  Inconclusive: unsigned fetch returned ${unsignedStatus}. The probe could not`));
      console.error(red('   prove enforcement. Do not treat this as a pass; re-run and investigate.\n'));
      verdict = 1;
    }
  } finally {
    await deleteTestFile(privateKey, file.fileId);
    console.log(grey('  probe file deleted.'));
  }
  process.exit(verdict);
}

// Importable for unit tests without running the probe.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
