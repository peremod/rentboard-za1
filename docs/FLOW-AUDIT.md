# Flow & State Audit — Mastande ZA

Written 26 Aug 2026, against v1.7.0. The question this answers is "have we
thought of every flow?", and the honest answer at the time of writing was
**no**. This document enumerates the state machines exhaustively, marks what is
verified, and lists what is missing — so the gaps are visible rather than
discovered by a landlord.

Anything marked ✅ is covered by `./scripts/smoke-test.sh`. Anything marked ⚠️
or ❌ is not, and should not be assumed to work.

---

## 1. Room state machine

```
                  publish            reserve
   draft ──────────────────► active ─────────► reserved
     │  (needs cover photo)    │  ▲               │
     │                         │  │ undo-let      │
   discard                  let│  │ (30 min)      │ let
   (delete)                    ▼  │               ▼
                              let ─┴──── relist ──► active (cycle + 1)
```

| Transition | Endpoint | Status |
|---|---|---|
| → draft | `POST /rooms` | ✅ verified |
| draft → active | `POST /rooms/:id/publish` | ✅ verified (cover photo + 50-char description enforced) |
| draft → deleted | `DELETE /rooms/:id` | ✅ verified (drafts only) |
| active → reserved | `POST /rooms/:id/reserve` | ✅ verified (v1.7.1) — stays visible, refuses new applications, `/unreserve` reverses it |
| active/reserved → let | `POST /rooms/:id/let` | ✅ verified — closes and notifies open applicants |
| let → active | `POST /rooms/:id/undo-let` | ✅ verified (30-minute window) |
| let/paused → active | `POST /rooms/:id/relist` | ✅ verified — archives the old cycle, increments `relistCount` |
| active/reserved → paused | `POST /rooms/:id/pause` | ✅ verified (v1.7.1) — off the board, applications left open |
| published → deleted | `POST /rooms/:id/remove` | ✅ verified (v1.7.1) — soft delete; open applicants closed and emailed |

### Gaps

**R1 — `reserved` is a dead end.** `markReserved` sets the status and nothing
else. Open questions never answered: does a reserved room stay on the public
board? Can tenants still apply? Are existing applicants told? Right now it
stays visible and keeps accepting applications, which is misleading. Either
give it real semantics or remove it.

**R2 — `paused` unreachable.** A landlord who wants to stop applications for a
week (travelling, unit being repaired) has no option but to mark it let, which
closes and emails every applicant.

**R3 — `deleted` unused.** Published rooms can never be removed, only let. A
landlord who posts a room by mistake, or in the wrong city, is stuck with it.

---

## 2. Application state machine

```
   pending ──► viewed ──► shortlisted ──► accepted
      │           │            │              (room → let, others auto-rejected)
      └───────────┴────────────┴──────► rejected
      │
      └──► withdrawn (tenant)
      │
      └──► archived (relist, or room let to someone else)
```

| Transition | Trigger | Status |
|---|---|---|
| → pending | tenant applies | ✅ verified — scoped to `room.relistCount` |
| pending → viewed | landlord opens applicant | ✅ verified |
| → shortlisted | landlord shortlists | ✅ verified |
| → accepted | landlord accepts | ✅ verified — room → let, others auto-rejected |
| → rejected | landlord rejects | ✅ verified |
| → withdrawn | tenant withdraws | ✅ verified — blocked once accepted |
| → archived | relist, or room let | ✅ verified — tenant sees the reason, can re-apply |

### Gaps

**A1 — no "undo accept".** Accepting marks the room let and auto-rejects
everyone else, irreversibly. If a landlord mis-clicks, or the accepted tenant
pulls out an hour later, there is no recovery path. `undo-let` restores the
room but does not restore the rejected applications.

**A2 — messaging is not scoped to application state.** A tenant whose
application was rejected or archived can still post into the thread. It is not
a security hole — cross-tenant isolation is verified — but a landlord who has
let the room keeps receiving messages about it.

**A3 — price and detail changes are silent.** A landlord can edit rent on a
live listing with applications pending; nobody is told. A tenant may be
waiting on a decision for a room whose rent went up R800.

---

## 2b. Verification state machine (v1.56.0)

```
                    (landlord identity only)
   submitted ──► pending_payment ──► pending ──► approved
       │              (R149)            │   └──► rejected
       └──────────────────────────────► ┘
                (everything else, free)
```

| Transition | Trigger | Status |
|---|---|---|
| → pending_payment | landlord submits identity | ✅ verified — the only paid check |
| → pending | anyone submits anything else | ✅ verified — including every tenant proof |
| pending → approved | admin | ✅ verified — document deleted, trail written |
| pending → rejected | admin, reason required | ✅ verified — document deleted either way |

Every transition appends a `VerificationEvent` in the same transaction, so a
step cannot exist for a change that rolled back, nor a change land untraced.

**The Passport rule:** identity AND one income proof. Recomputed from the
approved requests on every decision rather than incremented, so a rejection or
an expiry cannot leave a Passport standing on a check that no longer holds.

### Reference sub-machine

```
   awaiting_contact ──► contacted ──┬──► confirmed
     (tenant named      (WhatsApp   ├──► disputed
      a referee)         sent)      └──► unreachable (14-day expiry)
```

`unreachable` is not `disputed` and must never be displayed as one. A busy
previous landlord who did not reply has told us nothing about the tenant, and
both the tenant's page and the admin queue say so in words.

## 2c. Post-tenancy flag state machine (v1.56.0)

```
   open ──┬──► upheld      (stays counted against the account)
          ├──► dismissed   (counter decremented immediately)
          └──► withdrawn   (by the person who raised it, while open)
```

Only from a tenancy in `ended`. One flag per party per tenancy. `againstId` is
derived from the tenancy, never supplied, so nobody can flag a stranger.

### Gaps

**F1 — no admin review screen.** The endpoints and the queue exist and are
admin-guarded; there is no dedicated page yet. Flags are reviewable through
the API but not through the UI, so in practice they will sit `open` — and an
open flag costs someone visibility. This is the one piece of the flag feature
that is not finished, and it should be built before flags are offered to
users.

**F2 — neither party is notified.** Raising a flag emails nobody, and a
decision reaches nobody. `reviewNote` exists and is stored to be shown to both
parties, but nothing shows it yet.

---

## 3. Cross-actor flows

| Flow | Status |
|---|---|
| Tenant applies → landlord notified by email | ✅ verified (email logged when Resend is unset) |
| Landlord shortlists → tenant notified | ✅ verified |
| Landlord accepts → tenant notified, others auto-rejected | ✅ verified |
| Landlord lets room → waiting applicants closed and told | ✅ verified |
| Landlord relists → old cycle archived, tenant sees why | ✅ verified |
| Tenant withdraws → landlord's list updates | ✅ verified |
| Two-way messaging within an application | ✅ verified |
| New matching room → tenant alerted | ✅ instant on publish and relist; ✅ daily digest at 07:00 SAST (v1.8.1). A digest with no matches is not sent — a daily "nothing today" is how people learn to ignore, then unsubscribe |
| Saved room is let → tenant told | ❌ **gap X1** — still open. The dashboard drops rooms that 404, but nobody is told the room they saved has gone |
| Landlord verified → badge appears | ✅ end to end (v1.8.1): landlord submits at /landlord/verification, admin reviews at /admin/verifications, approval sets idVerified and the badge appears |
| Tenant verified → Passport badge appears to landlords | ✅ end to end (v1.56.0): tenant submits at /tenant/passport, admin reviews in the same queue, identity + one income proof sets `hasPassport`, and the badge shows on the applicant card with its basis one tap away |
| Previous landlord asked for a reference → answers | ✅ end to end (v1.56.0): admin sends from the queue, referee answers at /reference/:token with no account, outcome lands on the audit trail. An unanswered request expires to `unreachable`, which is explicitly not a negative signal |
| Post-tenancy problem → reduced visibility | ✅ (v1.56.0): either party flags after the tenancy ends, `openFlagCount` increments, the board ranks that landlord's rooms last. Dismissal restores it immediately. ⚠️ No dedicated admin review screen yet — the queue is at `GET /tenancies/flags/open` |

**X1 — saved rooms go stale silently.** The dashboard drops rooms that 404,
but a tenant is never told the room they saved has gone. This is the same
class of problem as A-series: state changes that one party can see and the
other cannot.

---

## 4. Admin

✅ **Built in v1.8.0.** `/admin/dashboard` (platform counts, account search,
suspend and restore) and `/admin/verifications` (the review queue). Admins are
created with `npm run db:seed`, deliberately not through an API — a "create the
first admin" endpoint is a standing privilege-escalation risk, and requiring
database credentials to mint an admin is the safer trade.

Scope is intentionally narrow: no access to private messages between a landlord
and tenant. POPIA's minimality principle (s.10) means a power we do not need is
itself a liability. Suspension is reversible and destroys nothing — a suspended
landlord's rooms are paused, while applications and messages survive because a
tenant may need that history in a dispute.

Previously:

❌ ~~There is no admin surface at all.~~ `AdminGuard` and the `ADMIN` role
exist, `GET /verification/pending` is admin-only, but:

- there is no admin route in the frontend
- there is no way to create an admin user except editing the database directly
- the verification queue is therefore unreachable, so no landlord can be
  verified in practice

This makes landlord verification non-functional end to end despite the backend
being complete.

---

## 5. Not built — enumerated so they are not mistaken for oversights

These are known absences, not bugs. Listed in the order I would build them.

### 5.1 Account recovery — ✅ built in v1.9.0
Password reset, signed-in password change, and email change with confirmation
at the new address. Before this, a forgotten password meant a permanently lost
account with no recovery path at all.

### 5.2 Reviews — ✅ built (v1.11.0 / v1.12.0)

The blocker is resolved: `Tenancy` now records a letting that actually
happened, so there is something for a review to hang off.

```
accepted application -> pending -> active -> ended -> reviews open 30 days
                           \-> cancelled (never produces reviews)
```

Decisions worth keeping:

- **Confirmed, not automatic.** A tenancy is created `pending` on acceptance
  and only becomes `active` when a party confirms the move-in. Accepted
  lettings fall through often, and an unconfirmed one must not prompt for
  reviews or feed a rating.
- **Either party may confirm or end it.** This records a fact, not a mutual
  decision. Requiring both would leave tenancies stuck whenever one side stops
  logging in, and would let either side block the other from ever reviewing.
- **Rent is snapshotted** onto the tenancy, because the room's rent changes on
  relist and a review should reflect what was actually paid.
- **A 30-day review window** stops a grudge review appearing two years later
  and gives the double-blind reveal a deadline.

**Visibility differs by type, and that is the important decision:**

| Type | Written by | Visible to |
|---|---|---|
| Room | Tenant | Public, on the room page |
| Landlord | Tenant | Public; feeds `LandlordProfile.rating` |
| Tenant | Landlord | **Only a landlord with a live application from that person** |

A landlord's review of a tenant is a *reference*, not a public record. It does
not appear on any profile, cannot be browsed, and becomes unavailable again
once the application is decided. Publishing it openly would attach a permanent,
searchable judgement to an individual that follows them between lettings — the
platform's largest defamation exposure, and the harder thing to defend under
PEPUDA if it were ever used to screen people out.

Where there are no references, the API says so explicitly, so a landlord does
not read "none" as a negative signal.

**Double-blind** holds until both sides submit. A nightly job releases whatever
exists once the 30-day window closes, because otherwise simply never writing
your own review would suppress the other person's forever — exactly what
someone expecting a bad review would do.

**Moderation**: admins can hide a review with a recorded reason, and hiding
recalculates the landlord rating. The subject of any review may post one reply,
which does not change the rating.

**UI (v1.13.0):** a prompt on both dashboards after a tenancy ends, showing the
review window's closing date because a deadline that passes silently is one
people miss; published reviews on the room detail page; and references behind a
toggle on the applicants page, fetched on demand rather than eagerly — pulling
them with the list would mean requesting personal information about people
whose applications the landlord may never open.

Previously:

### 5.2 Reviews — superseded, see above
`LandlordProfile.rating` and `ratingCount` exist and **the room card renders a
star rating**, but there is no `Review` model and nothing can ever set them.
This is the same shape of problem `idVerified` had before v1.8.0: a field that
implies a system behind it.

Three distinct review types are needed, and they are not symmetric:

| Review | Written by | About | When |
|---|---|---|---|
| Room review | Tenant | The room and the house | After the tenancy ends |
| Landlord review | Tenant | The landlord's conduct | After the tenancy ends |
| Tenant review | Landlord | The tenant | After the tenancy ends |

Hard parts, which is why this is not a quick build:
- **There is no tenancy record.** An accepted application is the closest thing,
  but nothing marks a tenancy as having *ended*, so nothing can decide when a
  review becomes due.
- **Retaliation.** If each side sees the other's review before writing, ratings
  become negotiation. The usual answer is double-blind: neither is published
  until both are in, or a window closes.
- **Defamation.** A landlord review naming an individual carries real legal
  exposure in South Africa. Needs a moderation and right-of-reply path, which
  ties into the admin surface.

### 5.3 Reporting fraudulent listings — ✅ built in v1.10.0
`Report` model, a report button on every room detail page, and an admin queue
at `/admin/reports`. Reasons are written in plain language and ordered by the
South African scam patterns the disclaimer warns about — "they asked for money
before I viewed the room" is first because it is the one that costs people
money.

Deliberately open to signed-out visitors: requiring an account suppresses
exactly the reports worth having. Rate limited to 5 per hour instead.

Urgent reasons (upfront payment demanded, agent posing as landlord, listing not
real) are escalated by email to the safety address published in the disclaimer,
rather than waiting in a queue. The admin view shows prior-report counts for
the same room and the same landlord, because a single report is weak evidence
and a pattern across several is the actual signal.

Previously:

### 5.3 ~~Reporting fraudulent listings~~ — ~~not built~~
The disclaimer tells tenants to email `safety@mastande.co.za`, so the promise
is kept, but there is no in-app report button, no `Report` model and no admin
queue. Given the disclaimer explicitly warns about agents posing as landlords
and deposit scams, an in-app path with an audit trail is the more serious gap
of the two remaining.

### 5.4 How it works / Pricing pages — ✅ built in v1.9.1
`/how-it-works` and `/pricing`, both prerendered and linked from the navbar and
footer.

Pricing deliberately does **not** follow the three-tier table in the visual
spec, which predates the decision. The model is: free for tenants, free for
landlords, one once-off verification fee (R149). The page states what the fee
buys and what it does not — verification means a person checked a document, not
a credit or criminal check.

The How it works page carries the deposit-safety guidance from the disclaimer,
because a tenant reading it is the one most likely to be about to pay money to
a stranger.

---

## 6. What "verified" means here

`./scripts/smoke-test.sh` exercises the API against a live server: 70+ checks
across auth, room lifecycle, applications, messaging, alerts, verification,
cross-tenant isolation, and the listing wizard's validation.

It is an integration check, not a test suite. It does not cover:

- the UI — every flow above was clicked manually, once
- concurrency — two tenants applying to the last room at the same moment
- failure paths — what a half-finished transaction leaves behind
- load, backup, restore

Treat green as "the happy path and the obvious guard rails hold", not as proof
of correctness.
