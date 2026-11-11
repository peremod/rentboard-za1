# E2E browser audit — Phase 0: what the 42 drives actually do

Status as of 11 November 2026. This is the baseline the rest of the E2E work is
built on: **no drive is wired into a gate, repaired or written until its current
verdict is known and trusted.**

## Why a baseline at all

This repository has 42 browser drives. They were written one at a time, each
alongside the feature it covers, and none of them has ever been run as a suite
against a known-good stack — `phase-drive` and `a11y-drive` are the only two CI
runs. "The drives pass" was therefore an assumption, not a measurement.

## How it was measured

A fresh `mastande_e2e` database (39 migrations, seeded with
`ADMIN_EMAIL=ci-admin@mastande.test` and `SEED_LAUNCH_CODES=true`), the API on
:3000, the SSR frontend on :4200 — the same shape as CI's E2E job. Every drive
run on its own, **with the API restarted immediately before it**, and its full
log kept.

### ⚠️ The first pass was void, and the reason matters

A first pass reported 31 of 41 drives failing. That result was wrong. The
in-memory rate limiter (60 registers/hour, 30 logins/15min — v1.86.0) was
exhausted by the drives themselves, and a drive that cannot register its
throwaway accounts dies on its first line with a 429 that reads exactly like an
auth bug.

The tell that it was not a product collapse: **`phase-drive` was among the
"failures"** — the one drive CI runs and passes on every push. A result that
condemns a check which demonstrably passes elsewhere is a result about the
harness. Hence the restart-before-each-drive in the method above.

### The honest verdict is the exit code AND the log

A drive's exit code alone is not its verdict, because a drive can count
failures, print them, and exit 0. So each exit code was cross-referenced against
the `❌` count in that drive's own log. Exactly one drive disagreed — see
"Could not fail" below. A static sweep for drives lacking a `process.exit(1)`
was tried first and is useless: it flags 42 of them, because most write
`process.exit(fail?1:0)` without spaces and the pattern misses it.

## Results

| Bucket | Count |
| --- | --- |
| Sound and green | 30 |
| Sound and red — real signal | 9 |
| Could not fail | 2 |
| Not measured in this pass | 1 |

### Could not fail (2)

- **`assisted-signup-ui-drive`** — counted 2 failures, printed
  `❌ 2 failure(s)`, and **exited 0**. One missing line; its sound sibling
  `services-ui-drive.mjs` ends with exactly the line it lacked. Fixed, and
  proven in both directions: with its real failures present it now exits 1, and
  with `fail` forced to 0 it exits 0. **The 2 failures it was hiding are real
  and still open** (see below).
- **`font-paint-drive`** — 39 seconds, zero assertions of any kind: no `✅`, no
  `❌`, no `PASS`, no `FAIL`. It is a measurement harness and says so itself
  ("This box cannot adjudicate an LCP difference of this size"). It cannot pass
  and cannot fail. Either it asserts the things it says it *can* answer —
  whether font requests begin before the headline paints, and whether a variant
  is really the variant it claims to be — or it is not a check and must never
  sit in a gate pretending to be one.

### Sound and red (9)

Every one of these exited non-zero with its failures named in its log, so each
is a working check reporting something. Three different things, though:

**Drive is stale against a deliberate product decision (3)**

- `messages-inbox-ui-drive` — throws `WHATSAPP_APP_SECRET is not set in
  backend/.env` before it opens a browser. It cannot run with WhatsApp off,
  which is the configured state.
- `phone-signup-ui-drive` — prints *"nothing on /auth/register links to the
  phone sign-up — it is unreachable in practice"*, then times out on `#phone`.
- `phone-only-ui-drive` — times out on `#phone` in the same way.

  The last two are not drive bugs. They are **`docs/OUTSTANDING.md` §29 stated
  as a test failure**: a person with no email address has no way in while
  WhatsApp is off. The drives were written when that route was reachable. They
  are correct about the product and the product is knowingly in this state.

**Candidate real product bugs (6)** — named here, not yet diagnosed:

| Drive | ❌ | What it says |
| --- | --- | --- |
| `token-render-drive` | 20 | Every failure is `… is var(--border)` — storefront section rules, storefront footer note, badge box, applicant notes left bar, note rules — at all four widths (360/390/768/1280) |
| `nav-sheet-drive` | 9 | The close control is not inside the mobile nav sheet at all, and focus does not move into the sheet when it opens — repeated at three widths. A11y, WCAG |
| `lease-ui-drive` | 2 | Notice attribution missing after logging it; relist action missing — then a 30s click timeout |
| `assisted-signup-ui-drive` | 2 | No confirmation after starting an assisted sign-up; no assisted row created for the admin |
| `notes-calendar-drive` | 1 | No notes toggle on the applicant card |
| `services-ui-drive` | 1 | The recorded check did not appear on the row |
| `search-drive` | 1 | No removable chip rendered for a search read |

`notes-calendar`'s missing notes toggle and `token-render`'s applicant-notes
failures both point at the applicant notes UI, so they may share one cause.
Unverified.

### Not measured (1)

`a11y-drive` was skipped in this pass — it runs for about 13½ minutes on its
own. Its verdict is unknown here; it passes in CI on every push.

## What this does not establish

- Nothing about the drives' **coverage**. A green drive proves its own
  assertions hold, not that the journey it covers is tested. The gaps the brief
  asks about (session expiry mid-journey, duplicate submission, a browser-side
  API failure) are untouched by any of this.
- Nothing about the 9 reds **as product bugs**. Six are candidates. A drive
  being sound means its complaint is worth reading, not that it is right.
