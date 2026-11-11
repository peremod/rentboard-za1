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

| Bucket | At baseline | After the first two repairs |
| --- | --- | --- |
| Sound and green | 30 | **32** |
| Sound and red — real signal | 9 | **7** |
| Could not fail | 2 | 2 (1 fixed, 1 open) |
| Not measured in this pass | 1 | 1 |

`token-render-drive` (20 red) and `nav-sheet-drive` (9 red) were the two biggest
reds and **neither was a product bug**. Both are now green, and every assertion
changed or added was proven to fail when the thing it guards is broken. See
"The two biggest reds" below.

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

**Drive is stale against a deliberate product decision (5, of which 2 are repaired)**

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
| `lease-ui-drive` | 2 | Notice attribution missing after logging it; relist action missing — then a 30s click timeout |
| `assisted-signup-ui-drive` | 2 | No confirmation after starting an assisted sign-up; no assisted row created for the admin |
| `notes-calendar-drive` | 1 | No notes toggle on the applicant card |
| `services-ui-drive` | 1 | The recorded check did not appear on the row |
| `search-drive` | 1 | No removable chip rendered for a search read |

`notes-calendar`'s missing notes toggle is now the only red touching the
applicant notes UI — `token-render`'s applicant-notes failures, which looked
like they might share a cause, turned out to be the stale palette value.

## The two biggest reds — both false alarms

### `token-render-drive`: 20 red lines, every border painted correctly

The drive hardcoded `const BORDER = 'rgb(224, 213, 196)'` (#E0D5C4). Commit
`0ea8874` ("white surfaces") deliberately moved `--border` to #E5E0D7, which is
`rgb(229, 224, 215)` — exactly what the drive measured and reported as a
failure, twenty times, across both screens at all four widths. Its companion
`painted` check (`border-style: solid`, width ≥ 1px) was green throughout: the
borders this drive exists to protect have been drawn, in the right token, the
whole time.

A check that goes red on a deliberate palette change is measuring the palette,
not the thing it claims to measure, and it teaches whoever reads it to discount
the colour. So the token is now resolved **from the live document** — a hidden
probe element given `color: var(--border)`, read back as the browser's own
normalised rgb — and compared against the measured border colour. A palette
change is invisible here, which is right. A border drawn in some other colour
still fails.

That introduced its own vacuous mode, so it is guarded: if `--border` stopped
being defined, `color: var(--border)` is invalid at computed-value time, the
probe falls back to the inherited text colour, and an **unpainted** border's
`border-color` is `currentcolor` — the same text colour. The comparison would
have passed on precisely the bug the drive was written for. The new assertion
is that `--border` resolves at all and resolves to something other than the body
text colour. That is 8 assertions added (two screens × four widths); the drive
went from 51 checks to 59.

**Proven, not assumed.** Both mutations were applied to the served bundle and
the drive re-run each time:

| Mutation | Result |
| --- | --- |
| `.store-section` border → `var(--line)` (the original 2026 bug: a dangling custom property) | ❌ `is painted (none 0px)` at all four widths, exit 1 |
| `--border` renamed out of the served stylesheet | ❌ `--border resolves to a colour of its own (rgb(28, 22, 14), body rgb(28, 22, 14))` ×8, exit 1 |
| bundle restored byte-identical | 59 passed, 0 failed, exit 0 |

⚠️ The first falsification attempt was void and is worth recording: the edit was
made to `frontend/src/...` and the drive stayed green. :4200 is served by a
**prebuilt SSR bundle** (`node dist/mastande-frontend/server/server.mjs`), not
`ng serve` — there is no watcher, so source edits are invisible. Same shape of
mistake as the rate-limiter pass. The mutations above were applied to the built
artefact, which is what the browser actually loads.

### `nav-sheet-drive`: 9 red lines, all from one button that was removed on purpose

Three assertions, each failing at three widths. All three depended on
`.nav-sheet-close` existing:

1. `and a close inside it, reachable by a thumb that has scrolled`
2. `the close is not in the sheet at all` (the contrast loop)
3. `focus moves into the sheet when it opens` — which asserted that
   `document.activeElement` carried the class `nav-sheet-close`

`navbar.ts` records why the button is gone: **removed at the owner's request
after they saw it on a phone.** The sheet opens at the top with the burger a
thumb's width above it, already showing an ✕ and already labelled "Close menu";
the scrim closes it and Escape closes it. Four ways out, one of which took the
first screen of the menu and pushed the links people came for further down.

Failure 3 was the damaging one — it reported "focus does not move into the
sheet", a real WCAG failure, when nothing of the kind was happening. Measured in
Chromium: `activeElement` is the sheet's first link, "Browse rooms", inside
`#nav-sheet`.

Repaired to match the decision and to keep each claim falsifiable:

- the close assertion is **reversed** — `.nav-sheet-close` must be absent at
  mobile width too. Not hypothetical in either direction: that button once
  shipped unconditional for a commit and a red "✕ Close" sat in the desktop
  header beside the logo. The desktop section already guarded that leak; this is
  the same guard where the person who asked for its removal would see it.
- the contrast loop no longer looks for it.
- the focus assertion checks **both** halves: focus is inside `#nav-sheet` *and*
  is the sheet's first link. "Inside" alone would pass on the legal links at the
  bottom; "first link" alone would pass on an element outside the open sheet.

**Proven, not assumed.** Both mutations applied to the served bundle:

| Mutation | Result |
| --- | --- |
| the class `nav-sheet-close` added to an element inside the sheet (the button coming back) | ❌ the new mobile assertion ×3 **and** the existing desktop-leak assertion, exit 1 |
| focus-on-open neutralised (`firstFocusable()?.focus()` → `?.blur()`) | ❌ `focus moves into the sheet … (BUTTON)` ×3, exit 1 |
| bundle restored byte-identical | all checks passed, exit 0 |

The second mutation also took the focus-trap assertion ("20 Tabs later it has
not escaped") red with it — so that check was never vacuous either; it works
because focus enters the sheet first.

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
