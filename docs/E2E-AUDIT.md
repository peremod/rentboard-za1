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
| Sound and green | 30 | **37** |
| Sound and red — real signal | 9 | **3** — all three stale against the WhatsApp-off decision |
| Could not fail | 2 | **1** (`font-paint-drive`) |
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
| `assisted-signup-ui-drive` | 2 | No confirmation after starting an assisted sign-up; no assisted row created for the admin |
| `notes-calendar-drive` | 1 | No notes toggle on the applicant card |
| `services-ui-drive` | 1 | The recorded check did not appear on the row |
| `search-drive` | 1 | No removable chip rendered for a search read |

**Every one of these four was investigated and none was a product bug in the
sense its message claimed.** `assisted-signup` exposed a real rule violation
behind the refusal (below); the other three were drives asserting a sentence
instead of a behaviour (also below). The reds that remain are the three stale
against the WhatsApp-off decision, which are correct about the product.

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

### `lease-ui-drive`: the one that found a product bug

Two failures and a 30-second timeout, all downstream of one thing: after the
drive confirmed "Yes, they gave notice", the panel showed
**"That did not save. Check your connection and try again."**

The request behind it answered `400 This tenancy has not started yet. If it has
fallen through, mark it as such instead.`

Two defects, both real:

1. **A control that could only fail.** `LeaseService.upcoming()` deliberately
   lists `pending` tenancies — a short let that has not started still needs
   relisting attention — and it *selected* `status` without *returning* it. So
   the panel could not tell a row nobody had moved into from a live one, and
   offered "They are leaving" on both, where `giveNotice()` refuses a pending
   tenancy outright.
2. **An error message that blamed the wrong thing.** All three handlers in the
   panel set the same connection line for every failure, including the ones the
   API explains in a sentence written for a person. The signal was fine; the
   message sent the landlord to the one place the fault was not.

The gate is deliberately narrow: **renew and "let it roll on" are not hidden**
on a pending row. The API allows lease terms to be edited before move-in on
purpose, and both drive green — hiding them would have been a product decision
the evidence did not support.

The drive's own fixture was also wrong: it never confirmed a move-in, so it had
been driving that dead button for four releases. It now confirms the start and
checks the pending state first, which is where the three new assertions live.

**Proven, not assumed.** 12 checks → 22, and each fix falsified separately:

| Mutation | Result |
| --- | --- |
| the button ungated (shown on pending rows again) | ❌ "'They are leaving' offered on a pending tenancy"; ❌ "no move-in action offered on a pending row" |
| the error handler reverted to the constant string | ❌ "the refusal was not surfaced — the panel said: 'That did not save…'"; ❌ "a 400 is reported as a connection problem" |
| **`status: t.status` removed from the backend alone** | ❌ the first two — so the server half is load-bearing, not decoration |
| both halves restored | 22 passed, exit 0 |

The refusal wording is provoked the way it actually happens: notice is given,
the row renders its undo, and the notice is then withdrawn behind the screen's
back — a second tab, or the tenant — so the stale "Notice was a mistake"
answers 400 "No notice has been given on this tenancy."

`scripts/smoke-test.sh` gained the matching API-level checks: that notice is
refused on a tenancy that never started, and that each `upcoming` row carries
the status the panel gates on. ⚠️ The second sets a lease end date first,
because `upcoming()` lists a tenancy only when a fixed term is inside the lead
window or notice has been given — without that the array comes back empty and
the assertion passes having seen nothing.

## The drive that was red in its own log

`assisted-signup-ui-drive` printed `❌ 2 failure(s)` and exited 0 for as long as
WhatsApp has been switched off. Both failures — "no confirmation after starting
one" and "no assisted row was created for this admin" — were the API refusing
with `503`, which is correct: assisted sign-up delivers the code over WhatsApp,
and `WHATSAPP_ENABLED` is off because Meta bills per message.

So the drive was stale, like the other two WhatsApp drives. **But the reason it
was stale was itself a defect**, and a standing-rule one:

> Nothing on screen may promise a WhatsApp message while it is off.

The admin dashboard offered the assisted sign-up form unconditionally, promising
in bold that *"The code goes to their handset, not yours"*. An admin sitting
with a landlord typed their real number, pressed send, and only then learned the
feature was off — from a message addressed to the wrong person entirely:

> Signing in with a phone number is not available yet. Use your email address —
> and if you do not have one on your account, ask us to add it.

The admin has an email and an account. It is the landlord who cannot get in.
This is the same fault the landing page had to be fixed for when it advertised
"WhatsApp Notifications" to every visitor.

### The fix

`GET /admin/stats` now reports `capabilities.phoneCodes`, read through
`WhatsappService.isEnabled()` so there is one answer rather than a second look
at the environment variable. With it false the dashboard shows a notice in place
of the form — naming that the channel is switched off, and saying plainly that
somebody with no email address has no way in until it is back on. The flag is
read as `=== true`, so an older API that does not send `capabilities` reads as
OFF: the screen stops offering rather than promises.

The drive asks the **API** for the capability, not the screen — the screen is
the thing under test — and then checks the state that actually applies. 23
checks → 28 with codes on, 19 with codes off, and the skipped section names its
reason rather than vanishing.

**Both branches were run.** 28 green with `WHATSAPP_ENABLED=true` (the whole
assisted flow works end to end, including that the six digits never reach the
admin's screen), 19 green with it off. A branch that is never executed is not
coverage.

| Mutation | Result |
| --- | --- |
| the form ungated (shown with codes off) | ❌ 8 — all four off-state assertions, plus "2 assisted control(s) still on screen" at each of the four widths |
| `capabilities` removed from the backend alone, with WhatsApp genuinely ON | ❌ "stats carries no capabilities.phoneCodes", and the screen reads OFF while the API is on — the safe direction, and still a loss of truth |
| both restored | 28 green (on) / 19 green (off) |

⚠️ **Falsification caught one of my own assertions being worthless.** "…naming
the reason" was written as a test over the whole page text, and with the fix
reverted it stayed GREEN while the three assertions beside it went red: the
admin dashboard contains the words "paused" and "switched off" elsewhere, so it
was never evidence about this notice. It reads `#assist-off`'s own text now, and
fails with the fix reverted.

## The last three candidates — none of them the product

Three drives, one failure each, three different ways of asserting a sentence
instead of a behaviour.

### `search-drive`: the assertion depended on what other drives had left behind

`❌ no removable chip rendered for "rooms to rent in Sandton"`.

`knownPlaces()` groups by the city of **active** rooms, so a city with no live
listing is not a recognised place, no city is parsed out of the phrase, and no
chip renders. That is deliberate, and the service says so: it "degrades to the
old behaviour rather than to nothing".

Hardcoding Sandton therefore made the check depend on the database. ⚠️ **It
passed four times running for me and failed on the fresh one — which is the
database CI gets, so the one run that mattered was the red one.** And the
message named a missing control rather than an absent fixture.

The city now comes off the live board, and the assertion is the invariant:
**if the API parsed a city, the screen must offer a way to remove it.** The
premise is checked rather than assumed. 33 checks → 34.

| Mutation | Result |
| --- | --- |
| a city the board does not have | ❌ "the API parses … it answered city=null", and the chip itself is skipped with its reason |
| the chip's class renamed in the served bundle (the control gone) | ❌ "the API parsed the city 'Sandton' and the screen rendered no removable chip for it" |

⚠️ Falsification improved the fix: the first version reported **two** failures
for one cause, the second of them untrue — claiming the API had parsed a city
when it had parsed nothing. The chip is now asserted only once the premise
holds.

### `notes-calendar-drive`: the check was testing the violation, not the fix

`❌ no notes toggle on the applicant card`. The toggle was there the whole time.

Its accessible name used to read "Show your private notes about Thandi". A WCAG
2.5.3 (Label in Name) fix deliberately changed it to start with the **visible**
text, so it is now one of "Add a private note about X", "My notes (n) about X"
or "Hide my notes about X". The drive asked for `/private notes about/i` —
plural — and matched none of them.

🔴 **So the old check passed on the accessibility violation and failed on the
fix.** It was pointing the wrong way round.

What the check is for survives, asserted as the rule rather than the sentence:
the accessible name must contain the visible text, and must name the person
(six open cards needed disambiguating, which is why the name is there). 1
assertion → 3; measured name: `Add a private note about Drive Tenant`.

| Mutation | Result |
| --- | --- |
| `" about " + tenantName()` dropped from the label | ❌ "does not name the applicant" — and the 2.5.3 check correctly still passes |
| the pre-fix label restored (`"Show your private notes about …"`) | ❌ "accessible name … does not contain the visible 'Add a private note'" — and the naming check correctly still passes |

### `services-ui-drive`: it was looking for a character that became an icon

`❌ the recorded check did not appear on the row`. The button works perfectly.

The assertion looked for a literal `✓` in the checks list. That tick stopped
being a character in `78cd8bc` ("clear the emoji backlog — 226 down to 1"): it
is `<app-icon name="check"/>` now, an SVG with no text content. The check had
been red since that commit while naming a control that was never broken.

The row's actual state is asserted instead — what a person sees: "Record it"
goes, a tick appears, the row stops being marked missing, and the date it was
recorded shows. A tick rendered as an icon, a character or a word all pass; the
recording failing to stick does not. 1 assertion → 4.

| Mutation | Result |
| --- | --- |
| `this.load()` dropped from `recordCheck`'s success path (the write lands, the screen never reflects it) | ❌ all four |

**No product code changed for any of the three.** Every mutation was applied to
the served bundle, and all six touched chunks were restored byte-identical,
checked with `diff` rather than assumed.

## Where the baseline stands

| | |
| --- | --- |
| Sound and green | **37** |
| Sound and red, and correct about the product | **3** — `messages-inbox-ui`, `phone-signup-ui`, `phone-only-ui`, all three the WhatsApp-off decision and §29 |
| Cannot fail | **1** — `font-paint-drive`, which asserts nothing |
| Not measured here | **1** — `a11y-drive`, ~13½ minutes, green in CI on every push |

Of the nine reds and two unfalsifiable drives the baseline found, **one was a
product defect** (the lease panel's dead button, and the error message that
blamed the connection) and **one was a standing-rule violation** (the admin
screen promising a WhatsApp code with the channel off). The other nine were
checks that had stopped measuring what they claimed.

