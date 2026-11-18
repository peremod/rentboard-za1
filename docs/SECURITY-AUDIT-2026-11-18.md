# Full-stack security audit — initial report (AUDIT ONLY)

**Target:** Mastande / Umastande (Pty) Ltd — Angular 21 SSR frontend, NestJS 11 +
Prisma 6 backend, Neon Postgres, ImageKit storage, Vercel (frontend) + Render (API).
**Repository / branch:** `peremod/rentboard-za1` @ `develop` `3f75442` (v1.191.0).
**Date:** 18 November 2026. **Assessor role:** senior application-security engineer.
**Method:** source-level (white-box) review of `backend/src`, `frontend/src`,
deployment wiring (`main.ts`, `server.ts`, `tools/vercel-build.mjs`, `vercel.json`),
and the two prior security deliverables. **No active testing against live hosts.**
**Standards applied:** OWASP Top 10 (2021), OWASP API Security Top 10 (2023),
OWASP ASVS v4, OWASP WSTG, relevant Cheat Sheets, NIST SSDF; framework-specific
(Angular SSR host-header/trust-proxy, NestJS guards/pipes, Prisma parameterisation).

> **STATUS: AUDIT COMPLETE. REMEDIATION DONE (per approval 18 Nov 2026).**
> Sections A–F are the original Phase 1–4 deliverable and are unchanged below.
> **Section G records the remediation that followed the user's "do all" approval
> and their note that the Neon credentials were already rotated.**

---

## G. Remediation status (added 18 Nov 2026, after approval)

The user approved "do all" and stated **F-01 (Neon credential rotation) was
already done on their side.** Code-side fixes were implemented one finding at a
time, TDD (RED→GREEN→prove-the-check-can-fail), suites/drives after each,
weakening no existing control.

| ID | Status | What shipped / what remains |
|---|---|---|
| **F-01** | ✅ **Operator-done (rotation).** | User rotated both Neon creds. Verified corollary: the pre-commit gate confirms **no credential in any tracked file** (720 files) — the exposure is history-only, so rotation is the correct and sufficient control. Still worth: confirm repo visibility + enable push protection (F-04). |
| **F-02** | ✅ **Fixed (code).** | CSP added to the frontend origin (`tools/vercel-build.mjs`) + `verify-build.sh` assertion. `script-src`/`style-src` keep `'unsafe-inline'` (prerender + event-replay bake inline scripts a per-request nonce can't cover — confirmed by scanning built HTML); policy still blocks external script/style origins, `eval`, plugins, framing, `<base>`, and allow-lists `connect-src`/`form-action` to traced origins. Driven: 8/8 CSP assertions pass; no built-HTML resource is blocked; sabotage proves the gate fails. |
| **F-03** | ✅ **Fixed (code).** | PayFast ITN signature now uses a pure, exported `signaturesMatch` (length guard + `crypto.timingSafeEqual`). Unit spec + sabotage. Backend units 136/136. |
| **F-05** | ✅ **Tooling shipped; one operator run.** | SHAs can't be resolved in this sandbox (GitHub scoped to this repo; `api.github.com` refuses action repos) and guessing is forbidden, so `scripts/pin-actions.mjs` resolves + rewrites where GitHub is reachable. Offline `--selfcheck` passes and fails under sabotage. **Operator:** `node scripts/pin-actions.mjs --write` locally/CI, commit the result. |
| **F-04** | ⏳ **Operator-owned (settings); code already ready.** | Enable Dependency graph + Secret scanning + Push protection (Settings → Code security). The `dependency-review` job snippet is already in `security.yml` (commented) to uncomment once the setting is on — deliberately NOT re-added live, because a job that cannot pass until a setting is flipped is the "check that cannot run" this repo rejects. |
| **B-02** | ⏳ **Operator-owned (run); probe already exists.** | `npm run audit:imagekit-privacy` self-falsifies offline; **operator** runs it with `IMAGEKIT_*` against staging+prod and records `PRE-LAUNCH-CHECKLIST.md` row 171, flipping "restrict unsigned URLs" if EXPOSED. No new CI plumbing added speculatively (same "no checks that can't run" principle). |

**Net:** every finding with a safe, verifiable code fix is fixed (F-02, F-03) or
has tested tooling ready (F-05). The rest are operator actions on
settings/credentials/account config that code cannot perform, each with its tool
or snippet already in place.

> **Original Phase 1–4 report follows unchanged.** It still reads "audit only";
> that was true when written. Section G above is the post-approval update.

This round **builds on** the 17 November 2026 white-box pentest
(`docs/SECURITY-ASSESSMENT-PENTEST.md`) and the scanning baseline
(`docs/SECURITY-SCANNING.md`) rather than repeating them. It re-verifies the prior
fixes still hold and extends coverage into the areas the prior round explicitly
declared out of scope: **frontend security, web-security headers/CSP, the SSR
server, the payment/WhatsApp webhook paths, logging, and supply-chain/secrets
operational posture.**

---

## A. Executive summary

Mastande is, by the standard of most applications of its size, **well secured**.
The authorization model is consistent and verifiable ("a guard says who may try;
the WHERE clause says whose rows they get"), authentication hygiene is textbook,
input validation is enforced globally, raw SQL is parameterised throughout, and
the team has a visible, documented culture of distrusting "controls that only look
like controls." The two prior findings that warranted code changes (B-01, B-02)
were remediated, and B-01's uploader↔path binding is **confirmed still present**
(`verification.service.ts:234`).

This audit found **no new Critical or High vulnerability in application code.**
The material residual risks are **operational**, not code defects, and the most
important one is carried over and still open:

1. **A real, confirmed credential exposure in git history** (two Neon Postgres
   connection strings, commit `b4c9852`, 20 Oct 2026). Removal does not revoke;
   the remedy is **rotation**, which this audit cannot verify has happened.
   *This is the single highest-impact item and it is operator-owned.*
2. **ImageKit private-file enforcement (B-02) is an account setting invisible to
   the repo.** The code signs read URLs correctly; whether ImageKit actually
   rejects unsigned requests for verification/lease documents is unconfirmed. A
   self-falsifying probe was shipped but the operator run against staging/prod is
   still outstanding. *If this setting is off, sensitive ID/SASSA/bank documents
   could be world-readable regardless of the app's checks.*
3. **No `Content-Security-Policy` on the user-facing frontend origin** (defence-in-
   depth gap, Low). Every other recommended header is present. Residual XSS risk is
   low because Angular's contextual escaping is intact and the frontend contains
   **zero** `bypassSecurityTrust*`, `innerHTML`, or `DomSanitizer` sinks.

Everything else found is Low/Informational and several items were already
risk-accepted with documented review triggers. The recommended posture is: close
the two operational items (#1, #2) as a priority, add a frontend CSP, and leave the
accepted risks accepted.

---

## B. Findings register

Fields: ID · Vulnerability · Severity · Priority area · Component · Evidence ·
Attack scenario · Impact · Root cause · Recommended fix · Dependencies ·
Verification.

### F-01 — Historical credential exposure in git history (Neon DB connection strings)
- **Severity:** High (confirmed exposure; → Critical if the credentials are still live and the repo is public).
- **Priority area:** (4) Database security & sensitive data / Secrets.
- **Component:** git history, commit `b4c9852` (`scripts/migrate-targets.json`), 20 Oct 2026.
- **Evidence:** documented in `docs/SECURITY-SCANNING.md` ("What the weekly history scan reports"): two Neon connection strings (staging + production), flagged REAL by the weekly Gitleaks history scan. Re-confirmed as a standing, unresolved item there. Not re-extracted here (no secret printed).
- **Attack scenario:** anyone with read access to the history (anyone, if the repo is public) recovers the connection strings and connects directly to the Postgres databases, bypassing the entire application and its authorization model.
- **Impact:** full read/write to production tenant/landlord PII and documents metadata; complete compromise of the data tier.
- **Root cause:** a secret was committed; deletion from a later commit does not remove it from history and does not revoke it.
- **Recommended fix (operator-owned):** **rotate** both Neon credentials (staging + production) now; confirm the current repo visibility; enable GitHub secret scanning + **push protection** (Settings → Code security) so this cannot recur server-side. Optionally purge history, but rotation is the control — purging without rotating is theatre.
- **Dependencies:** none (do first).
- **Verification:** new credentials in the deployment secret stores; old strings fail to authenticate against Neon; push-protection blocks a test commit carrying a dummy key of the same shape.

### F-02 — No Content-Security-Policy on the user-facing frontend origin
- **Severity:** Low (defence-in-depth).
- **Priority area:** Web security configuration (headers/CSP).
- **Component:** `frontend/tools/vercel-build.mjs` (Build Output API `config.json` route headers); `frontend/src/server.ts` (SSR response headers).
- **Evidence:** the generated `config.json` sets `strict-transport-security`, `x-content-type-options: nosniff`, `referrer-policy`, `x-frame-options: SAMEORIGIN`, `permissions-policy` on `^/(.*)$` — but **no `content-security-policy`**. `server.ts` sets only `X-Robots-Tag` and `Cache-Control`. (The backend `helmet` CSP in `main.ts` applies to the **API** host only, which serves JSON.)
- **Attack scenario:** if a stored-XSS sink were ever introduced (e.g. a future `[innerHTML]` binding over a room description or message), there is no CSP to blunt script execution or exfiltration. Also no `frame-ancestors` (though `X-Frame-Options: SAMEORIGIN` covers legacy clickjacking).
- **Impact:** no first-order impact today; raises the blast radius of any future XSS.
- **Root cause:** CSP was not included in the header set; Angular's own escaping was (correctly) relied on as the primary control.
- **Recommended fix:** add a `content-security-policy` to the same `^/(.*)$` route. Start report-only (`content-security-policy-report-only`) to measure, then enforce. A tight policy is feasible because the app loads scripts from self + `ik.imagekit.io` images; verify against the actual third-party origins (fonts, any analytics) before enforcing. Include `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`.
- **Dependencies:** none.
- **Verification:** `curl -I` the production origin shows the header; a deliberately-injected inline `<script>` in a test build is blocked and reported; Angular hydration still functions (no `unsafe-inline` needed for scripts — confirm styles).

### F-03 — PayFast ITN signature compared with a non-constant-time equality
- **Severity:** Informational.
- **Priority area:** (3) Backend API security / business logic (payments).
- **Component:** `backend/src/modules/payments/payfast.service.ts:120` — `this.signature(rest) !== signature`.
- **Evidence:** every other signature/OTP/token comparison in the codebase uses `crypto.timingSafeEqual` with a length guard (`phone-otp.service.ts:335`, `phone-signup.service.ts:279`, `notifications.controller.ts:187`, `whatsapp.service.ts:263`). The PayFast MD5 signature check uses `!==`.
- **Attack scenario:** a remote timing side-channel to forge a signature. Not practically exploitable here: the ITN is additionally gated by an **amount check** against the DB-expected value and a **server-to-server confirmation callback** to PayFast (`confirmWithPayfast`), so a forged ITN that squeaked past the signature still fails confirmation.
- **Impact:** none in practice; a consistency/hardening gap.
- **Root cause:** the compare predates or diverges from the timing-safe convention used elsewhere.
- **Recommended fix:** compare with `crypto.timingSafeEqual` over equal-length buffers, matching the house pattern.
- **Dependencies:** none.
- **Verification:** unit test asserting the compare rejects a one-byte-different signature; confirmation callback path unchanged.

### F-04 — GitHub-native secret scanning / push protection & Dependency graph not enabled
- **Severity:** Low (operational / supply-chain).
- **Priority area:** Dependencies & supply-chain; secrets.
- **Component:** GitHub repo settings (Settings → Code security), per `docs/SECURITY-SCANNING.md` "Known limitations".
- **Evidence:** the scanning doc records that `dependency-review` was removed because Dependency graph is off, Dependabot therefore only does scheduled bumps (not security alerts), and push protection is not enabled.
- **Attack scenario:** a future secret is committed with nothing to stop it server-side (directly related to F-01's recurrence); a dependency advisory lands with no alert.
- **Impact:** removes the one control that blocks a credential *before* it is pushed, and the one that raises security updates automatically.
- **Root cause:** settings-level toggles, not expressible in a repo file.
- **Recommended fix (operator-owned):** enable Secret scanning + Push protection and Dependency graph; `security.yml` already carries the snippet to restore `dependency-review`.
- **Dependencies:** pairs with F-01.
- **Verification:** push-protection blocks a dummy-key commit; `dependency-review` runs green on a PR.

### F-05 — Third-party GitHub Actions pinned by tag, not commit SHA
- **Severity:** Low (supply-chain).
- **Priority area:** Dependencies & supply-chain.
- **Component:** `.github/workflows/*` (per `docs/SECURITY-SCANNING.md`).
- **Evidence:** documented known limitation; tags are mutable, so a compromised tag changes what runs in CI.
- **Attack scenario:** an upstream action's tag is repointed to malicious code that runs in CI with repo/secret access.
- **Impact:** CI compromise / secret theft.
- **Root cause:** convenience pinning.
- **Recommended fix:** pin `uses: owner/action@<40-char-sha> # vX`; Dependabot already watches them for bumps. (The prior round could not resolve SHAs because its GitHub access was scoped to this repo alone; the user's environment can.)
- **Dependencies:** none.
- **Verification:** workflows reference 40-char SHAs; Dependabot PRs update them.

### Carried-over findings (re-verified this round)

| ID | This round's status | Severity | Note |
|---|---|---|---|
| **B-01** — verification `documentPath` not bound to uploader | ✅ **Remediated, re-verified present** (`verification.service.ts:234` → `assertOwnDocumentPath`; prefix + `..`-traversal + non-empty-filename guards; unit + integration specs present). | Low (closed) | No action. |
| **B-02** — document confidentiality depends on an ImageKit account setting | ⚠️ **Probe shipped; operator run still OUTSTANDING.** `npm run audit:imagekit-privacy` exists and self-falsifies; the staging/production run and the `PRE-LAUNCH-CHECKLIST.md` row 171 record are not done. | Informational → **High if misconfigured** | **Priority operational item (see A#2).** |
| **B-03** — per-IP throttling is in-memory backstop | ✅ Accepted, trigger recorded (§107): a second backend instance. | Low | Leave accepted. |
| **B-04** — ImageKit upload token TTL/scope | ✅ Accepted; real risk closed by B-01. | Informational | Leave accepted. |
| **B-05** — unauthenticated read endpoints unthrottled | ✅ Accepted; cached, local-table reads. | Informational | Leave accepted. |

---

## C. Severity classification

| ID | Severity | CVSS 4.0 (indicative) | Confidence |
|---|---|---|---|
| F-01 | High (→Critical if live+public) | `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H` (≈9.3) *if unrotated & reachable*; N/A if already rotated | **Confirmed exposure**; live-status unverified |
| F-02 | Low | `CVSS:4.0/AV:N/AC:H/AT:P/PR:N/UI:P/VC:L/VI:L/VA:N` (≈2–3) | Confirmed absent; impact contingent on a future sink |
| F-03 | Informational | n/a (not practically exploitable) | Confirmed; mitigated by amount + confirmation |
| F-04 | Low | n/a (process control) | Confirmed from docs |
| F-05 | Low | n/a (supply-chain posture) | Confirmed from docs |
| B-02 | Informational → High if misconfigured | up to `…/VC:H/VI:N/VA:N` if private-file enforcement is off | **Config-concern; needs operator verification** |

No Critical or High finding was confirmed **in application code**. The two items
that can reach High (F-01, B-02) are both operational/configuration, not code.

---

## D. Remediation plan (proposed order — for approval, not yet executed)

| Order | Finding | Severity | Risk if unaddressed | Proposed fix | Regression/verification test |
|---|---|---|---|---|---|
| 1 | **F-01** | High | Direct DB compromise | **Operator:** rotate both Neon creds; confirm repo visibility | Old strings fail auth against Neon |
| 2 | **B-02** | High-if-wrong | Sensitive-document exposure | **Operator:** run `npm run audit:imagekit-privacy` vs staging+prod; record row 171; flip ImageKit "restrict unsigned URLs" if EXPOSED | Unsigned fetch → 401/403; signed → 2xx |
| 3 | **F-04** | Low | F-01 recurrence; no advisory alerts | **Operator:** enable secret scanning + push protection + Dependency graph; restore `dependency-review` | Push-protection blocks dummy-key commit |
| 4 | **F-02** | Low | Future XSS blast radius | Add CSP (report-only → enforce) to `config.json` `^/(.*)$` route | `curl -I` shows header; injected inline script blocked; hydration intact |
| 5 | **F-05** | Low | CI compromise | Pin actions to SHAs | Workflows show 40-char SHAs |
| 6 | **F-03** | Informational | None in practice | `timingSafeEqual` for PayFast signature | Unit test: 1-byte-diff signature rejected |

Order rationale: operator-owned exposures that need no code first (1–3), then the
one code change with real defence value (4), then two hardening items (5–6). Each
code change would follow the house TDD rule in CLAUDE.md — RED (reintroduce/show
the gap, test fails) → GREEN → prove the check can fail — one finding at a time.

---

## E. Audit limitations (confirmed vs suspected vs config-concern vs untested)

- **Confirmed (read in source this round):** guards (`admin`/`jwt`/`landlord`/`lister`/`optional-jwt`/`roles`) and `JwtStrategy` per-request user re-fetch; global `ValidationPipe` (`whitelist + forbidNonWhitelisted`); no `*Unsafe` raw SQL (only 3 tagged-template `$queryRaw`/`$executeRaw` + the health `SELECT 1`); frontend has **zero** `bypassSecurityTrust*`/`innerHTML`/`DomSanitizer` sinks and stores **no token** in `localStorage` (only a `HAS_SESSION_KEY` boolean; access token in memory, refresh in httpOnly+sameSite:strict cookie); auth/credentials interceptors scope token + credentials to the API origin only (no leak to ImageKit/third parties); error interceptor logs path without query string; SSR `allowedHosts`/`trustProxyHeaders` hardening present; frontend headers (HSTS/nosniff/referrer/X-Frame-Options/Permissions-Policy) present; webhook signatures (WhatsApp HMAC-256, PayFast signature+amount+server-confirmation) verified; B-01 fix present.
- **Suspected / contingent:** F-02's impact depends on a future XSS sink that does not exist today.
- **Config-concern (cannot be settled from the repo):** B-02 (ImageKit private-file enforcement) and F-01's "is it still live / is the repo public" — both need operator action/visibility. F-04/F-05 are settings/CI posture read from the prior scanning doc, not re-inspected in the GitHub UI this round.
- **Untested (would need explicit authorisation):** no dynamic testing against staging or production was performed; no credentials to staging/prod data were used; the integration suite (`backend/test/*.int-spec.ts`, synthetic accounts in `mastande_integration_test`) is the safe place for any dynamic PoC and was **not** run as part of this read-only audit. The PayFast ITN and WhatsApp webhook were reviewed at source but not exercised end-to-end. ImageKit/PayFast/Resend/Meta account settings are outside the repository.

---

## F. Approval checkpoint

**The initial audit is complete. No implementation has started. No application
code, schema, configuration or infrastructure was changed.**

I am waiting for your explicit approval before beginning any remediation
(Phase 5). When you approve, please also tell me:

1. Which items you want **me** to implement in code — realistically **F-02 (CSP)**
   and **F-03 (timing-safe PayFast compare)**; F-05 (SHA-pinning) I can do if you
   confirm you want it.
2. Which items you will own as **operator** actions I cannot perform from here —
   **F-01 (rotate Neon creds), B-02 (run the ImageKit probe + flip the setting),
   F-04 (GitHub settings).** I can write/stage the supporting checks and docs, but
   the rotations and dashboard toggles are yours.

I will implement only what you approve, one finding at a time, TDD (RED→GREEN→prove
the check can fail), running the suites and drives after each, weakening no existing
control — per CLAUDE.md.
