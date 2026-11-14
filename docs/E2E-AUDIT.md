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
| Sound and green | 30 | **38** |
| Sound and red — real signal | 9 | **3** — all three stale against the WhatsApp-off decision |
| Could not fail | 2 | **0** |
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
  sit in a gate pretending to be one. **It asserts them now**; see
  "`font-paint-drive`: 39 seconds, no verdict" below.

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
| Sound and green | **38** |
| Sound and red, and correct about the product | **3** — `messages-inbox-ui`, `phone-signup-ui`, `phone-only-ui`, all three the WhatsApp-off decision and §29 |
| Cannot fail | **0** |
| Not measured here | **1** — `a11y-drive`, ~13½ minutes, green in CI on every push |

Of the nine reds and two unfalsifiable drives the baseline found, **one was a
product defect** (the lease panel's dead button, and the error message that
blamed the connection) and **one was a standing-rule violation** (the admin
screen promising a WhatsApp code with the channel off). The other nine were
checks that had stopped measuring what they claimed.

## `font-paint-drive`: 39 seconds, no verdict

The last of the two that could not fail. No `✅`, no `❌`, no `PASS`, no `FAIL`,
and the process ended on whatever code Node chose — while it sat in the drive
list being counted as a check.

It is right that the numbers are not a check: the box cannot adjudicate a
300ms LCP difference and the script says so in its own output. But it also says
what it *can* answer — "whether the font requests begin before the headline
paints, and whether a variant is really the variant it claims to be" — and
neither of those was asserted either.

So the numbers stay a report and the **structure** became the check. Every
assertion added is something that was already wrong once while the harness was
being written, recorded in its own comments:

- all three variants ran, and the largest paint is still `H1.hero-headline` —
  the premise of the entire measurement;
- the control is a control: with every `@font-face` stripped, **zero** font
  requests. It once made two, because the strip had silently failed and the
  variant was a duplicate of the one above it;
- the other two really load fonts, and the request begins before the first
  paint in every run;
- the strip empties the document's **inlined** `@font-face`. It once reported
  4 → 0 and still made two requests, because only the external stylesheet was
  being rewritten and Angular SSR inlines the critical CSS.

### ⚠️ The precondition it had never stated

`optimization.styles.inlineCritical` is set under the **production**
configuration only — `development` sets `optimization: false`. So against a
development build the served document carries no `@font-face`, `faceCount`
reads `0 -> 0`, and the inlined-critical-CSS finding this harness exists to
record is **not exercised at all**. The E2E audit ran it against a development
build and that line printed a bare "0 -> 0" with nothing to say it meant "not
measured". It now skips that half by name and points at the configuration.

**Run on both builds.** Development: 9 assertions pass, the inlined half
skipped with its reason. Production: 10 pass, and the inlined half measures
`4 -> 0` — exactly the figure the comment recorded historically.

| Mutation | Result |
| --- | --- |
| the `@font-face` strip made a no-op (the silent failure that happened) | ❌ "really has no webfont: 2 font request(s)" **and** "the strip empties … (4 -> 4)" |
| only the external stylesheet rewritten, document route skipped (the other historical bug) | ❌ "really has no webfont: 2 font request(s)", and the inlined half correctly reports itself not measured |
| clean | 10 pass on production, 9 on development, exit 0 |

**No drive in the repository is now unfalsifiable.**

## The suite, and what the first full run of it said

All thirty-seven are now one step in CI's browser job, run by
`scripts/ui-drives.sh` from the list in `scripts/ui-drives.txt`.

**The first complete run of the repaired suite: 37 of 37 green, and zero `❌`
lines across all thirty-seven logs** — 1,800-odd assertions. The per-drive
counts are the ones quoted throughout this document (`tenancy-lifecycle` 298,
`layout-ui` 259, `logo` 97, `nav-ui` 79, `nav-sheet` 71, `token-render` 60,
`lease-ui` 23 …).

⚠️ **Honest limit on that number.** The run was stopped at its background time
limit moments after the last drive finished, so the runner's own summary line
and exit code were lost with the stopped process. Every drive's log survived
and is the evidence above; the runner's own green/red reporting was proven
separately, end to end, on a four-drive subset (`ONLY=…`), which exercises the
restart loop, the table, the ran-equals-listed count and the exit code.

### The runner cannot pass vacuously

Five guards, each one driven rather than assumed:

| Guard | What it printed |
| --- | --- |
| empty list | "lists no drives — nothing would have run" |
| a listed name with no file | names the ghost entry |
| `ONLY=` matching nothing | "matched nothing in scripts/ui-drives.txt" |
| API not answering on :3000 | "the drives cannot run" |
| **`DATABASE_URL` unset while it restarts the API** | refuses, naming the fallback |

That last one is the one that matters. The runner restarts the API between
drives, and without `DATABASE_URL` the API falls back to `backend/.env`, comes
up **healthy** against a different database, and all thirty-seven drives run
against the wrong data with nothing on screen to say so.

It also compares drives-executed against drives-listed at the end, because a
runner that silently runs nothing is the same defect as a drive that asserts
nothing.

### Why the restarts

`/auth/register` allows 60 an hour, counted in memory (v1.86.0), and each drive
registers three to eight throwaway accounts. Without a restart between them
every drive past the twelfth or so dies on `register LANDLORD failed: 429` —
which reads exactly like a broken registration endpoint, and is how the first
pass of this audit came to report 31 of 41 failing. **The limiter is not raised
or disabled for the suite's convenience**: it is a deliberate control, and a
harness that switches off the thing under test is not a harness. The restarts
cost about two minutes across the suite, against roughly twenty of drives.

### One drive still narrows itself

`lost-number-ui-drive` ends on `⏭ SKIP the admin sections — no phone_signups
row` and asserts only 5 things. It is green and it is not lying, but most of
what it covers did not run. That is the same shape as the fixture problems
found above and is **recorded here as open**, not fixed.

---

# Phase 3 — the coverage that did not exist

Phases 0 to 2 audited, repaired and gated what was already written. This part
is the gaps: journeys with no test of any kind.

## `session-expiry-drive` — a session running out mid-task

Nothing covered it. `refresh-race-drive` counts refresh tokens in the
**database** under a concurrent rotation; `auth.interceptor.spec.ts` covers
which reads may travel without credentials. The browser journey — a 401
arriving while somebody is working, and what they are shown — had no test, and
`error.interceptor.ts`, which decides all of it, **has no spec at all**.

It matters most for the person this product is built for: a cheap Android on a
connection that drops for a second, with four back rooms to let.

**15 assertions, three sections, and the product is sound in all three.**

| Section | What was measured |
| --- | --- |
| a 401 on a guarded read mid-journey | they stay on the page, are not told they are signed out, and the refused read is re-issued once and succeeds (`landlord/calendar: 401, 200`) |
| arriving at a guarded URL with the session gone | sent to `/auth/login?returnUrl=/landlord/properties`, not nested, and logging in puts them back on that page |
| a save refused mid-edit | they stay on the form, **what they typed is still in the field**, the save is re-issued once and goes through, and no false "signed out" message |

### What falsification changed about the drive itself

Three times, and each one is the reason to do it:

1. **The retry assertion passed with the retry removed from the interceptor.**
   It 401'd whichever guarded read went first — `landlord/health`, which the
   dashboard requests *twice* a load — and then asserted "some call to that
   path came back 200". A later unrelated call satisfied it. Now it targets a
   single-request path (`landlord/calendar`, measured) and asserts the exact
   sequence `401, 200`: two requests, nothing but a retry can produce that.
2. **The mid-form section had no subject and passed while forcing no 401 at
   all.** `window.dispatchEvent(new Event('focus'))` provokes nothing.
3. **A mutation killed the drive instead of being reported.** Section 2's own
   `signIn` threw, and the run ended there with sections 2 and 3 silent. Each
   section is wrapped now, so one failure reports and the rest still run.

### A finding about the listing wizard

The mid-form section was first aimed at the listing wizard, on the theory that
a background poll could 401 while somebody was half way through it. **Measured,
and the theory is wrong**: the wizard makes its guarded reads on load and then
nothing at all — no autosave, no polling, no refetch on focus or
`visibilitychange`, across 45 seconds of waiting. It holds the form in memory
and talks to the API only when the person acts.

That moves the risk rather than removing it: the dangerous moment is the
action, not a background read. Hence the refused save.

### ⚠️ What it does not cover

- The expired-arrival section exercises the **route guard**, not
  `error.interceptor.ts`'s own `redirectToLogin`. Proven: dropping the
  returnUrl from the interceptor changes nothing there, while dropping it from
  the guard reds two assertions. Two pieces of code build that returnUrl and
  only one is under test.
- The interceptor's "Signed out — your session has expired" **alert** branch is
  not exercised. It fires only when `restoreSession()` returns no user, and
  with a live in-memory session that call returns the cached user without going
  near the network, so a synthetic 401 cannot reach it. Driving it needs a dead
  refresh cookie and a dead access token at the same moment, which this drive
  cannot arrange without its own server configuration.

Named rather than left to be assumed covered — that is the §6 mistake this
repository has made six times.

## `duplicate-submission-drive` — the second tap, and a 500 that should have been a 409

`double-let-drive` races two acceptances of the same **room** — two different
applicants — because that is the expensive one. What nothing covered was one
person pressing one button twice, which is the common one: a cheap Android with
a laggy screen, a tap that does not seem to have registered, so you tap again.

🔴 **It found a real defect.**

| | before | after |
| --- | --- | --- |
| sequential duplicate apply | `409 You have already applied for this room` | unchanged |
| **two applies arriving together** | **`500 Internal server error`** | **`409`, the same sentence** |

`applications.service.ts create()` read "has this tenant applied?" with
`findUnique` and then wrote with `create`. Two requests both read "no", both
inserted, one won, and the other violated `roomId_tenantId_cycle` — and nothing
caught the Prisma error.

The data was never wrong: the constraint held and exactly one application
existed. But the tenant was told the server had broken when what had happened
was that they had already applied — **a situation this service has a sentence
for one branch above**. And a 500 in the log is indistinguishable from a real
fault, which is the reasoning `rooms.controller.ts` already records for turning
a bad `?placement=` into a 400.

Fixed with the pattern the codebase already uses for this —
`phone-signup.service.ts`'s `P2002` catch, whose comment calls it "doing the
job the check above cannot do without a lock". Verified: 201 and 409, one
application, and `applicationCount: 1`, so the losing request does not count an
applicant the room does not have.

**The sibling was checked and is already right.** Two concurrent accepts of one
application answer `200` and `400 This application has already been decided`,
with one tenancy — `accept` uses a conditional write. So this was one instance,
not a pattern, and the drive asserts both so it stays that way. 16 assertions.

### ⚠️ What section 1 does not isolate, and why I stopped

It asserts the **outcome** — one application from two taps — not which
mechanism produces it. Removing `[disabled]="applying()"` from the apply button
and rebuilding changes nothing at thumb speed: still one POST, measured three
ways (a held element reference, a re-queried element, and two ordinary
Playwright clicks 80ms apart). Something else in `room-detail.ts` is doing the
work — the label becomes "Sending…", so a re-queried button no longer matches,
and the component renders more than one apply control.

Measured at three speeds, for the record:

| | POSTs |
| --- | --- |
| two clicks in one JS task | 2 — the signal has not been rendered to the attribute yet |
| 80ms apart (a real thumb) | 1 |
| 250ms apart | 1 |

The end-to-end claim is the one a person cares about and it is true. Anybody
reading this drive for "the disabled binding is under test" would be wrong, and
isolating that needs a component unit test rather than a browser drive.

### One of my own traps, recorded

I restored the backend source, rebuilt, and read three failures as a finding —
they were the old `dist`, because I had not restarted the API. The same
stale-artefact mistake as the `ng serve` one earlier in this document, from the
other direction.

## `api-failure-drive` — a request that fails after the page rendered

`error.interceptor.ts` makes a distinction that was paid for:

> "Something went wrong on our end. Please try again shortly." was the answer
> to every status at or above 500, and it is three different situations wearing
> one sentence.

The three: the phone losing its connection (status 0), the platform answering
instead of the API because it was asleep (502/503/504 — this deployment's API
sleeps when idle, reported on a landlord dashboard **at 04:38**, exactly the
hour it would be cold), and the API itself throwing (a real 500, which will not
fix itself on a retry). "Try again shortly" is right for the first two and
wrong for the third.

🔴 **Nothing asserted any of it.** The strings "No connection", "Waking up" and
"quote this" appeared nowhere outside the interceptor — not a drive, not a
spec, not a smoke line. So the distinction could collapse back into one
sentence with every gate still green, and the next 04:38 report would be
unreadable again.

**26 assertions, and the product is right in all three cases.** Measured after
the dashboard had rendered, which is the case that matters: a screen that never
loaded is obviously broken, while one that looks fine and then quietly fails to
fetch gets reported as "it does not work" with no detail.

| Forced | Shown | Console |
| --- | --- | --- |
| `route.abort('connectionfailed')` — a genuine status 0 | **No connection** — "could not reach Mastande. Check your data or wi-fi" | `[http] GET /api/properties/dashboard failed with 0` |
| `503` | **Waking up** — "idle and is starting up. Wait a few seconds" | `… failed with 503` |
| `500` | **Server error** — and it quotes `GET /api/properties/dashboard (500)` | `… failed with 500` |

Each case also asserts it is **not** either of the other two titles, and a
final section asserts the three messages are pairwise different — because the
defect being guarded is one sentence for three situations, and without that the
three could collapse back while every other assertion still passed.

The console line is asserted too. It is the half of the fix a person never
sees and the half a report depends on: "the one line that would have turned a
screenshot into a diagnosis."

**Falsified by committing the original defect**: `describeServerFailure`
collapsed to a single "Server error / try again shortly" and rebuilt → **10
named failures**, including all three "told apart" assertions.

⚠️ The failures are faked in the browser, because a cold start cannot be
arranged on demand and a dropped connection even less so. The interceptor
branches on the status, so a status is a status however it arrived, and
`route.abort('connectionfailed')` produces a real status 0 rather than a
simulation of one.

## Phase 3 is complete

Three gaps named at the start, three drives, **57 assertions**, and the suite
is 40 drives. Two of the three found the product already sound and locked it
in; one found a real defect:

| Gap | Drive | Outcome |
| --- | --- | --- |
| session expiry mid-task | `session-expiry-drive` (15) | sound — and `error.interceptor.ts` had no spec at all |
| duplicate submission | `duplicate-submission-drive` (16) | 🔴 a racing duplicate apply answered **500**; now 409 |
| a browser-side API failure | `api-failure-drive` (26) | sound — and nothing had ever asserted the three-way distinction |

---

# The first CI run of the suite, and what it caught

Run 385 on `develop`, 14 November. The suite ran on a runner for the first
time: **21 minutes 41 seconds, 37 of 38 drives green, one red.** Every other
step in the job passed, including the a11y sweep, `phase-drive`, and both SEO
passes. The Chromium install that had failed the previous run took 17 seconds
this time, so that was infrastructure flake rather than anything structural.

The one failure is the reason the step exists.

```
❌ property A's "rent marked paid" is R3 — expected its own 3000, not the portfolio's 7500
❌ property B shows R000 — it is being handed somebody else's money
```

Those read like a scoping bug — one property showing another's money — and they
are not. `dashboard-ui-drive` parsed the rendered figure with

```js
const randOf = (text) => (text.match(/R\s?([\d,]+)/)?.[1] ?? '').replace(/,/g, '');
```

digits and **commas**. South Africa groups thousands with a **space** and uses
the comma as the decimal separator, so `R 3 000,00` gives the regex `R`, one
optional space, and then `3`. The parser had never met that format, because it
had only ever run here.

**It passed every local run and failed the first time it met a runner, and only
the runner was right.** A drive asserting on money, in a product for South
Africans, had been checking an American format for its whole life.

### ⚠️ It cannot be reproduced on this container, and that is the finding

Playwright's Chromium here answers `R 3,000.00` for
`(3000).toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' })` — even
though `Intl.NumberFormat('en-ZA').resolvedOptions().locale` reports `en-ZA`.
The build's ICU data for the locale is not there, so it formats with en-US
patterns whatever it is asked for. Node in the same container, with full ICU,
gives `R 3 000,00`.

Pinning Playwright's `locale: 'en-ZA'` changes `navigator.language` and
**nothing else** — checked rather than assumed, and it is why that line is not
in the fix. It would have been a line that does nothing under a comment
claiming it mattered.

So the parser is grouping-agnostic now, and it is proven **by its own cases on
every run** rather than by the environment: nine of them, covering both
groupings, NBSP and narrow-NBSP spacing, the no-decimals form, zero, an amount
inside a sentence, and text with no money in it. Whichever format the browser
produces, the parser is under test.

### And five failures that were not real

Re-running the repaired drive here produced five *different* failures,
including the `R0` its own comment already names as a timing flake it had added
a wait for. They were **local database pollution** — a session of heavy drive
runs, and this drive writes directly with SQL. Against a freshly created,
migrated and seeded database it is green at 43 assertions.

Worth recording as a property of the suite rather than of the drive: **its
verdict depends on a fresh database**, which is what CI gives it and what a
developer's long-lived dev database does not. The same lesson `search-drive`
taught from the other direction.

## Run 386: 39 of 40, and a wait for the wrong thing

The repaired suite, with the two new Phase 3 drives in it. One red, and a
different drive: `search-drive`, four failures.

```
❌ a room page opened — http://localhost:4200/?q=Accommodation%20in%20Johannesburg
❌ going back restores the search in the URL — ?q=studio in Pretoria
❌ going back restores the text in the search box
❌ going back restores the same results (11 -> 0)
```

**One cause, four failures.** The click on a room card was followed by
`waitForLoadState('networkidle')` — the wrong thing to wait for after a click
the *router* handles. There is no document load, and `networkidle` can resolve
at once because the network was already idle, so the assertion read
`page.url()` while the navigation was still in flight. The three checks after
it are about coming *back*, and none of them can pass if the room never opened;
the second even quotes the previous section's search, `?q=studio in Pretoria`,
which reads like a second bug and is not.

It waits for the URL it is asserting now, and the three back-checks are skipped
by name when the room did not open — so one cause reports as one failure, and
sections 4 to 8 still run. Proven by forcing the never-opened state: **1
failure and the skip, where it used to be 4.**

⚠️ **Not reproducible on this container.** It passes against the e2e database
and against a freshly created, migrated and seeded one. The trigger is inferred
to be a slower, busier box, not proven. What is certain is that the old wait
could not keep its promise.

⚠️ The artifact could not be read from here either — `blob.core.windows.net` is
refused by this container's egress policy — so the diagnosis came from the job
log's own `❌` lines rather than from the full drive log.

### What the two CI runs together say about the suite

Both reds were drives whose verdict depended on the machine rather than on the
product: a money format that only this container produces, and a wait that only
this container was fast enough to satisfy. Neither could have been found here.
That is the argument for the step, made twice in two runs.

