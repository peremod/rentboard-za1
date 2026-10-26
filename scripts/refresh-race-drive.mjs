#!/usr/bin/env node
/**
 * One rotation, one credential — the refresh token under a concurrent refresh.
 *
 * ── Why
 *
 * `auth.service.ts refresh()` says in its own comment that two refresh calls
 * are often in flight at once: "a page load and an interceptor retry, say,
 * both carrying the token that was valid when they were sent". It has a grace
 * window for exactly that.
 *
 * What it did NOT have was a conditional rotation. Both requests read
 * `revokedAt` as null, both passed, and both minted a refresh token. One
 * rotation, two valid credentials — the browser keeps whichever response
 * arrived last, so the other is live until it expires with nobody holding it.
 * And `replacedById` recorded only one of them, so the grace path could hand
 * back the token the browser does not have.
 *
 * ── What is asserted
 *
 * Counted in the database, because the HTTP responses cannot show it: after
 * N concurrent refreshes of one token, how many live refresh tokens does the
 * account have? One rotation must leave exactly one usable credential.
 *
 *   node scripts/refresh-race-drive.mjs
 */
import { registerUser, apiCall, dbQuery, dbRows } from './lib/drive-session.mjs';

const API = process.env.API ?? 'http://localhost:3000';
const ROUNDS = Number(process.env.ROUNDS ?? 5);
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

/** The refresh cookie, which is where the raw token lives. */
async function loginRaw(email, password) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const jar = setCookie.map((c) => c.split(';')[0]).join('; ');
  return { body: await res.json(), cookie: jar };
}

const refreshWith = (cookie) =>
  fetch(`${API}/api/auth/refresh`, { method: 'POST', headers: { Cookie: cookie } })
    .then(async (r) => ({ status: r.status, setCookie: r.headers.getSetCookie?.() ?? [] }));

const user = await registerUser(API, 'TENANT');
console.log('\n── One rotation, one credential ────────────────────────────');
console.log(`  ${ROUNDS} rounds, two refreshes fired together each time.`);

let worstLive = 0;
const rows = [];
for (let i = 0; i < ROUNDS; i++) {
  // A clean session each round: every token revoked, then one fresh login.
  dbQuery(`UPDATE refresh_tokens SET "revokedAt" = now() WHERE "userId" = '${user.id}' AND "revokedAt" IS NULL`);
  const { cookie } = await loginRaw(user.email, user.password);

  const [a, b] = await Promise.all([refreshWith(cookie), refreshWith(cookie)]);

  const [live] = dbRows(
    `SELECT count(*) FROM refresh_tokens WHERE "userId" = '${user.id}' AND "revokedAt" IS NULL AND "expiresAt" > now()`,
  );
  const n = Number(live);
  worstLive = Math.max(worstLive, n);
  rows.push(`${a.status}/${b.status}→${n}`);
}

console.log(`  rounds (status/status→live tokens): ${rows.join(', ')}`);

// One rotation hands the browser one refresh token. Two means one was minted
// and never delivered to anybody — a credential with no holder.
worstLive <= 1
  ? ok(`never more than one live refresh token after a rotation (worst: ${worstLive})`)
  : bad(`${worstLive} live refresh tokens after ONE rotation — a credential nobody holds`);

// And the session must survive: the race must not sign anybody out.
const { cookie: fresh } = await loginRaw(user.email, user.password);
const [r1, r2] = await Promise.all([refreshWith(fresh), refreshWith(fresh)]);
[r1, r2].every((r) => r.status < 400)
  ? ok(`a double refresh is absorbed, not treated as theft (${r1.status}, ${r2.status})`)
  : bad(`a benign double refresh was refused: ${r1.status}, ${r2.status} — this signs people out`);

const stillThere = dbRows(
  `SELECT count(*) FROM refresh_tokens WHERE "userId" = '${user.id}' AND "revokedAt" IS NULL`,
);
Number(stillThere[0]) >= 1
  ? ok('the account still has a usable session afterwards')
  : bad('every session was revoked by a benign race');

console.log('\n═══ Summary ═══');
console.log(fail === 0
  ? '  ✅ one rotation leaves one credential, and a double refresh costs nobody their session.'
  : `  ❌ ${fail} assertion(s) failed.`);
console.log('════════════════════════════════════════════════════════════\n');
process.exit(fail === 0 ? 0 : 1);
