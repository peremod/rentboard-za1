# Security scanning

Dependency vulnerabilities, secrets, and the container image. Four tools, each
earning its place, plus the repository's own scanner.

Established by the audit of 17 November 2026. The state before it: **none** of
`npm audit`, OSV, Trivy, Snyk, Gitleaks, TruffleHog, CodeQL, Semgrep,
`dependency-review` or even this repository's own `scripts/secret-scan.mjs` ran
in CI. There was no `dependabot.yml`. The secret scanner existed but lived only
in `.husky/pre-commit` — a client-side hook, skipped by `git commit --no-verify`
and absent for anyone who had not run husky.

---

## Running the scans locally

```bash
# Dependency gate — the same thing CI blocks on.
# Self-checks itself first, then audits all three workspaces.
node scripts/audit-gate.mjs

# Secrets: the in-repo scanner, tracked files at HEAD. Fast; also pre-commit.
node scripts/secret-scan.mjs

# Secrets: gitleaks. Not installed by default — it is a CI tool, fetched here
# only when you want to reproduce a CI finding.
curl -sSL -o /tmp/gl.tar.gz \
  https://github.com/gitleaks/gitleaks/releases/download/v8.30.0/gitleaks_8.30.0_linux_x64.tar.gz
mkdir -p /tmp/gl && tar -xzf /tmp/gl.tar.gz -C /tmp/gl

# the whole history — this is the one that finds a credential that was
# committed and later deleted, which removal does not revoke
/tmp/gl/gitleaks git . --config .gitleaks.toml --redact

# the working tree, including files git ignores
/tmp/gl/gitleaks dir . --config .gitleaks.toml --redact

# Container image, as Render builds it.
docker build -f backend/Dockerfile -t mastande-api:scan ./backend

# what BLOCKS: the OS layer only — see "Three things the first run corrected"
trivy image --severity CRITICAL,HIGH --ignore-unfixed --pkg-types os mastande-api:scan

# what REPORTS: everything, including the base image's bundled npm tooling
trivy image --severity CRITICAL,HIGH --ignore-unfixed mastande-api:scan
```

⚠️ **`gitleaks dir` reports `backend/.env`, and that is correct.** That file
holds a real local development secret. It is untracked and `.gitignore`d, so it
is not a repository exposure, and it does not exist in a CI checkout. It is
deliberately **not** allowlisted: a scanner that learns to ignore `.env` is a
scanner that will ignore the day somebody commits one.

---

## What blocks, and what only reports

| Scan | Runs on | Blocks? |
| --- | --- | --- |
| `audit-gate.mjs` — critical/high in the **production** tree | push, PR, weekly | **yes** |
| `audit-gate.mjs` — everything else | push, PR, weekly | no, printed and counted |
| OSV-Scanner — all three lockfiles | push, PR, weekly | no, reports |
| `dependency-review` — what the PR adds | — | **not configured**, see below |
| `secret-scan.mjs` — tracked files | push, PR, weekly | **yes** |
| Gitleaks — PR diff | PR | **yes** |
| Gitleaks — full history | weekly, manual | no, reports |
| Trivy — **OS packages** in the image | push, PR, weekly | **yes**, critical/high |
| Trivy — everything else in the image | push, PR, weekly | no, reports |

Two of those choices are deliberate and worth defending.

**The build chain does not block.** It currently carries 3 high and 19 moderate
transitives under `@angular/cli`'s own npm tooling, with no fix inside any range
this project controls. Blocking on them would make the gate red on the day it
landed and switched off the day after. CLAUDE.md lists what that road ends in: a
`MAX_ATTEMPTS` nothing read, nineteen `@Throttle` decorators with no guard
registered, a nav audit incapable of seeing a dead link. The gate blocks on what
reaches production, which is the code that answers requests.

**The full-history secret scan reports instead of blocking.** This history
contains a real exposure — commit `b4c9852`, two Neon connection strings,
20 October 2026 — and no scan can un-expose it. Rotation is the remedy. Making
that job permanently red would train everyone to ignore it; reporting keeps the
finding visible and keeps the blocking signals meaningful.

---

## Three things the first CI run corrected

The workflow had never executed when it was written — no runner existed in the
audit environment — and its first run on PR #9 failed three jobs. All three were
configuration, and the corrections are more interesting than the mistakes.

**1. OSV blocked on findings the gate deliberately does not.** OSV scans a
lockfile whole; it has no `--omit=dev` equivalent for npm. It reported **54
advisories and exited non-zero** — and every one of the 54 was dev-flagged,
with **zero** in production. So it simultaneously corroborated
`audit-gate.mjs`'s verdict and proved that blocking on it reintroduces exactly
what that gate exists to prevent. It reports now.

**2. Trivy was pinned to an invented version.** `aquasecurity/trivy-action@0.33.1`
does not exist; the job died in *Set up job* with "unable to find version". The
audit environment cannot query any GitHub repository but this one, so no action
version could be verified — and guessing twice would be the same mistake. The
workflow now downloads the **Trivy binary at a pinned v0.70.0**, which was
fetched, unpacked and run before being written down. That also removes a
third-party action from the supply chain.

**3. Trivy's scope was wrong, and would have been red on arrival.** Scanning all
package types in `node:22-alpine` reports **10 CRITICAL/HIGH findings with
fixes available**, every one of them `lang-pkgs/node-pkg` — the npm tooling
bundled inside the upstream Node image (`ip-address`, `pacote`, `picomatch`,
`sigstore`). Those are neither this project's dependencies nor its OS packages,
and nothing here can patch them. The **OS layer scanned alone is clean**, and it
is the one layer nothing else looks at — the application's npm tree is already
covered twice, by the gate for production and OSV for breadth. So Trivy blocks
on exactly what it uniquely sees, and reports the rest.

⚠️ **`dependency-review` was removed, and that is a finding.** It failed with
"Dependency review is not supported on this repository. Please ensure that
Dependency graph is enabled" — a setting under Settings → Code security, not
something a workflow can switch on. A check that structurally cannot run is
noise, not security.

**The same setting gates Dependabot alerts.** Until Dependency graph is enabled,
`.github/dependabot.yml` only proposes scheduled version bumps — it will not
raise a security update when an advisory lands. Enabling it is worth more than
the removed job was, and `.github/workflows/security.yml` carries the exact
snippet to restore.

---

## Accepting a risk

`scripts/audit-exceptions.json`. An entry needs three things, and all three are
**enforced by the gate, not by convention**:

```json
{ "package": "some-pkg",
  "reason": "at least twelve characters saying why this is tolerable",
  "expires": "2026-12-31" }
```

- a missing or short reason → the entry is **rejected** and the finding still blocks
- a missing, unparseable or **past** expiry → rejected, and the finding still blocks
- a package that does not match → no effect

Both rules are falsified in the gate's own self-checks, so the enforcement is
demonstrable rather than claimed. The list is empty today because every
production critical and high was fixed within its existing semver range.

**Reviewing a false positive.** Reproduce it locally with the commands above.
If it is a fixture, add a *narrow, context-anchored* allowlist entry to
`.gitleaks.toml` with a comment saying why — anchor to the key name or the call,
never to a whole path that could later receive a real secret. If it is a real
finding with no fix, use an exception with an expiry.

---

## Reporting

Each run prints: the workspace, blocking count, advisory count, accepted risks
with their review dates, and rejected exception entries. Trivy and OSV print
their own tables; the weekly Gitleaks run uploads its report as an artifact.

⚠️ **Scan output can contain secrets.** `secret-scan.mjs` redacts by
construction, and the gitleaks commands above all pass `--redact`. Do not commit
a raw scan report.

---

## What the weekly history scan reports, and why it is left reporting

Six findings, all understood. Nobody should have to re-derive them:

| count | rule | verdict |
| --- | --- | --- |
| 2 | `neon-database-password` in `scripts/migrate-targets.json` @ `b4c9852` | **REAL.** Two Neon connection strings, staging and production, 20 October 2026, in a public repository. Remedy is rotation; see the audit report |
| 4 | `stripe-access-token` in the deleted `backend/src/modules/stripe/stripe.service.ts` | **False positive**, characterised rather than assumed: the suffix is 11 characters at 3.10 bits/char and matches dummy patterns, where a real Stripe test key is far longer and high-entropy. It was a `secretKey ?? 'sk_test_…'` fallback — which is still worth noting, because "never defaulted to a working value in code" is a standing rule in CLAUDE.md, and that is the shape it forbids |

The four false positives are **deliberately not allowlisted.** The obvious
exemption would be path-anchored on that file, and the file is deleted — so the
entry would sit there permanently, exempting any real key that a future Stripe
module put at the same path. Four understood lines in a report-only weekly job
is the cheaper mistake.

---

## Known limitations

- **Third-party actions are pinned by tag, not commit SHA.** A tag is mutable,
  so whoever controls it controls what runs in CI. `.github/dependabot.yml`
  watches them, which is the mitigation one maintainer can keep up. To harden:
  replace `uses: owner/action@v2` with `uses: owner/action@<40-char-sha> # v2`.
  The SHAs could not be resolved during the audit because that session's GitHub
  access was scoped to this repository alone, and inventing one would have been
  worse than a tag.
- **GitHub-native scanning is not configured from the repository.** Secret
  scanning and **push protection** are free for public repositories and are the
  only control that stops a credential server-side, before it is ever pushed.
  They are enabled in Settings → Code security, not in a file here. This is the
  highest-value remaining item and takes about two minutes.
- **No SAST.** CodeQL and Semgrep were considered and declined: this brief
  covered dependencies and secrets. Application-logic flaws are out of scope.
- **The gate trusts `npm audit`'s advisory data**, which is as current as the
  run. OSV is there to disagree with it.
- **Trivy scans the image, not the running host.** Render's platform is outside
  anything this repository can see.
