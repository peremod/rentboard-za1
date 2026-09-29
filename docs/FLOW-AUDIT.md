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

## 2d. Rent period state machine (v1.57.0)

```
   (no record) ──► unpaid ──┬──► paid
                     │      ├──► partial
                     │      └──► waived        (landlord is not chasing)
                     │
                     └──► reminder sent (once) ──► tenant disputes ──► reminders stop
```

A period is **one party's unverified word**, which is why the reminder is
phrased as "your landlord has marked this unpaid" and why the tenant's
dispute sits beside the status rather than replacing it. Mastande does not
know whether money arrived and does not claim to.

`periodStart` is normalised to the first of the month at midnight UTC. The
unique constraint is [tenancyId, periodStart], and two rows for "September"
differing by a timezone offset would defeat it — leaving a landlord with two
Septembers disagreeing.

### Gaps

**Y1 — no way to move a room into a yard from the room itself.** The yard
screen can pull rooms in; the listing wizard and the room edit screen do not
offer a property picker, so a new room always lands ungrouped and has to be
grouped afterwards from the other screen.

**~~Y4 — a landlord could not set or switch off their own reminder window.~~
Closed in v1.73.0.** `PATCH /properties/rent/settings` had existed since rent
tracking shipped, `PropertiesService.setGraceDays()` had existed in the
frontend for just as long, and **no screen called either** — so the per-
landlord grace period, the whole reason the field is per landlord rather than
a constant, could not be changed by the landlord it belongs to, and reminders
could not be turned off by the person whose tenants receive them. The yard
screen now carries the control, the dashboard response carries the current
value (it was never read back either, and a control you cannot see the current
value of is not a control), and 0 is stated on the screen as "off". Found by
driving the yard as a landlord and looking for it, not by reading the router.

**Y2 — rent reminders are WhatsApp only.** A tenant with no verified mobile
number gets nothing, and the period is marked handled so the nightly job does
not rescan it. The landlord still sees it unpaid, but the tenant is never
told. Email is the obvious second channel and is not wired.

**~~Y3 — the tenant has no screen for rent.~~ Closed in v1.71.0.**
`/tenant/rent` shows every month the landlord has recorded, attributed to
them, with the platform's own position stated plainly — Mastande has not
checked any of it. Disagreeing is one tap and the note is optional, because
being able to say "I paid" matters more than being able to say why. The
answer is stored beside the landlord's record rather than replacing it, and
it stops further reminders for that month.

Driven end to end at 360px: landlord marks a month unpaid, tenant clicks
through from the nav, disputes it with a note, and the API is then checked
directly — the dispute and note persisted, the landlord's `unpaid` was NOT
overwritten, and `reminderSentAt` was set so the nightly job will not chase
them again.

---

## 2e. WhatsApp draft state machine (v1.58.0)

```
   (first inbound message) ──► collecting ──┬──► ready        ("DONE")
                                            │        │
                                            │        └──► claimed ──► Room (draft)
                                            │
                                            └──► abandoned    (14 days quiet)
```

A draft is created only for a number matching a landlord whose
`phoneVerified` is true. An unrecognised number gets one reply explaining how
to link and is then ignored — no draft, no record, nothing to enumerate.

`claimed` is terminal and creates exactly one Room: the unique index on
`roomId` is what makes a double claim impossible, and a claim of an
already-claimed draft returns the same room rather than a second one.

**The Room is created in `draft`, never `active`.** Publishing stays a
deliberate act on the web, after the landlord has seen what the parser read.

### Gaps

**W1 — no voice notes.** A landlord who sends a voice note is told the bot
reads photos and text. Transcription would mean an ASR provider: personal
information leaving the country under POPIA s.72, and current ASR quality for
isiZulu, Sesotho, Setswana and Xitsonga is poor enough that a confident wrong
transcript is worse than asking for text. Open decision, not an oversight.

**W2 — the claim screen cannot pick a yard.** Same cause as Y1: the wizard
has no property picker, so a claimed draft always lands ungrouped.

**W3 — one draft at a time per landlord.** A landlord collecting photos for
two rooms at once has them merged into one draft, and has to claim and finish
the first before starting the second. Threading by room would need the
landlord to name each room in the chat, which is more ceremony than the
feature is worth until someone asks for it.

---

## 2f. Verification payment state machine (v1.59.0)

Only ever a landlord's identity check. Nothing a tenant submits reaches this
machine at all, and neither does listing a room or applying for one.

```
   submitted ──► pending_payment ──► (PayFast ITN) ──► pending ──┬──► approved
                       │                                        │
                       │                                        └──► rejected
                       │                                                │
                       └──► never reviewed while unpaid                 ▼
                                                              refundDueAt set
                                                                        │
                                                        admin refunds in PayFast
                                                                        │
                                                                        ▼
                                                                  refundedAt set
```

`refundDueAt` is separate from `status` deliberately. Status stays `paid` until
the money moves, because that is where the money is; the obligation is a
different fact from the transaction. **Paid + refundDueAt + no refundedAt** is
the admin queue.

The ITN is the only thing that moves a check into the review queue, and
`confirmPaid` is its single writer — status change and trail entry together, so
neither can happen without the other, and a gateway retry does neither twice.

### Gaps

**M1 — a rejection refunds, and trying again costs again.** Someone whose ID
photo was too blurry pays R149 twice in effect and the business pays two
PayFast transaction fees. One free resubmission against the existing payment
would be kinder and cheaper. A pricing decision, stated plainly on the
verification page rather than discovered at the second checkout.

**M2 — refunds are recorded, not issued.** PayFast has no refund API, so an
admin moves the money in their dashboard and records it here. Nothing detects
a refund that was promised and never paid beyond the queue not emptying.

**M3 — nobody is emailed about a refund.** The landlord sees it on the
verification page and on their audit trail when they next look. The rejection
notification does not mention the money.

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
| Landlord groups rooms into a yard → vacancy and applicants roll up | ✅ (v1.57.0): `/landlord/yard` shows every property, room states per yard, and applicants across the whole property. Rooms not in a yard appear under their own heading rather than being dropped |
| Landlord marks rent unpaid → tenant is reminded | ✅ (v1.57.0): a daily 09:00 SAST pass WhatsApps tenants whose landlord has marked the month unpaid, once per month per tenancy, verified numbers only. The message says it is the landlord's record and that Mastande has checked nothing |
| Tenant disputes a month → reminders stop | ✅ (v1.57.0): the dispute is recorded beside the landlord's status, never overwriting it, and suppresses further reminders for that month |
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
The disclaimer tells tenants to email `safety@umastande.co.za`, so the promise
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

### 5.5 Landlord research survey — ✅ built in v1.80.0

Phase 0. Nothing in the product had ever asked a landlord what is hard about
the job, so the yard-management tiers rested on an assumption. The survey is
what turns that into data before the engineering is spent.

Two surfaces, never both at once: one question straight after a landlord marks
a room let, and the full seven as a skippable card on the dashboard. A skip is
recorded server-side and honoured for 30 days — not in `localStorage`, because
a dismissal that lives in one browser means being asked again on the next
device, which teaches people to clear the prompt without reading it.

Eligibility is decided on the server and never by the client. `audience`
supports `minRooms`, which counts rooms the landlord actually has; the point of
targeting "2+ rooms" is to reach people whose situation the product does not
know, and a client that decides its own eligibility can be asked to lie.

Results are at `/admin/surveys`, segmented by the room-count question, counts
rather than percentages, and with the number who answered beside each question.
Nobody is named: the landlord link exists so the same person is not asked twice
and so answers can be segmented, not so opinions can be read back against an
individual.

❌ **Not built: WhatsApp delivery.** Deferred to Phase 7g, and not for
scheduling reasons — see checklist row 40. Every outbound message in this
codebase is free-form `type: 'text'`, which Meta permits only inside the
24-hour customer service window. Reaching a landlord who does not open the
portal is business-initiated by definition and needs an approved template,
which does not exist here. The same defect already affects `sendOtp`, so the
template work is shared and is better done once, in 7g.


### 5.6 Yard shared-living details — ✅ built in v1.81.0

Phase 2 Tier 1. A yard now carries what the whole address shares: house rules
in the landlord's own words, shared facilities, how many people already live
there, and what kind of household it is.

On `Property` rather than `Room` because four rooms at one address have one
kitchen, one set of rules and one group of housemates. Held per room they get
typed four times and the copies drift — in front of tenants deciding where to
live.

`housemateProfile` defaults to `unstated`, which is a distinct value from
`mixed` and is never rendered. `mixed` is a claim about who a person would be
living with; silence is not one, and a default that made the claim would put a
description on a listing that no landlord wrote.

The room detail page shows all of it under "The rest of the house" — and does
not show the yard's `name`, which is the landlord's own dashboard label.

Bulk relist puts every relistable room in a yard back on the board in one
action, skipping what it cannot relist and naming why per room.

❌ **Not built: Tier 2** (rent roll beyond what already exists, days-to-fill
analytics, maintenance log). The brief gates Tier 2 on the Phase 0 survey
confirming rent tracking and trust are the top pain points, and no survey
responses exist yet. Building it now would be the assumption the survey was
written to test.


### 5.7 Expense tracking — ✅ built in v1.82.0 (Phase 4b)

What the landlord spends, against what came in. Rent tracking already said what
arrived; without the other half, "how am I doing this month" could only be
answered halfway, and half an answer about money is worse than none.

An `Expense` hangs off the **property**, not the room, because that is how the
money is actually spent: one municipal bill, one plumber, one gate motor for the
whole address. `roomId` narrows it when a cost genuinely belongs to one room and
stays null otherwise; forcing every expense onto a room would make the common
case a lie.

The yard's money card shows rent in, spent, and left over, with the **basis
line** stating which rent months are counted. A money figure whose rules are
invisible is one someone plans around and is wrong about. Rent on rooms in no
yard is reported separately so the per-yard rows need not silently fail to sum.

Amounts render through `zarCents: 'exact'` — two decimals. The rounded default
is right for a listing price and wrong for a reconciliation.

❌ **Deliberately not built: shares.** Nothing stores `paidBy` or
`sharePercent`. Phase 6 wants co-tenants splitting a bill, and the way not to
block that is to keep an expense a record of a *cost* and let any future split
be its own table pointing here, rather than guessing at semantics nobody has
specified.

**POPIA.** A receipt is the landlord's own business record, not information
about a tenant, so unlike a verification document it is kept rather than deleted
on a decision — they need it at tax time. No tenant is named on an expense, and
it is never shown to anyone but its owner.

### 5.8 Lease renewal and notice — ✅ built in v1.82.0 (Phase 4c)

`Tenancy` gained `leaseEndDate`, `noticePeriodDays`, `noticeGivenAt` and
`noticeGivenById`. A yard panel lists the tenancies about to free up a room:
fixed terms inside the lead window, and tenancies under notice. A month-to-month
tenancy with nothing happening to it appears in neither, because nothing is.

`leaseEndDate: null` means month-to-month — a real answer, not an unset field.
The API decides *why* a tenancy needs attention (`lease_ending` or
`notice_given`) and the screen does not re-derive it. Countdowns read "in 12
days" rather than a raw date, and a lease already past shows as overdue rather
than being hidden: an overdue relist is the urgent one.

A second notice does not overwrite who gave the first, and notice can be
withdrawn.

❌ **Not built: lease documents** (Phase 4e) — see the checklist. Storage only
when it comes; **no e-signature**, which is document execution.

⚠️ **No money, no legal execution.** Nothing here signs, renews or enforces
anything. It is a record of dates the landlord and tenant agreed between
themselves, and a reminder that one is approaching.

### 5.9 Contractor directory — ✅ built in v1.82.0 (Phase 4d)

Who to call when something breaks. Five trades, admin-curated.

**Admin-curated deliberately.** There is no landlord-facing way to add a
provider. An open directory of tradespeople is a directory of whoever registered
fastest, and recommending a stranger to someone's tenants is a reputational risk
this platform would be taking on with no way to manage it.

**No booking, no payment.** The product's job ends at "here is the number" —
`tel:` to call, `wa.me` to message, and the landlord and the plumber arrange it
between themselves. Taking a booking would make Mastande a party to the job;
taking a payment would put it in the money, which Phase 4 is scoped to avoid.

Numbers are stored normalised to E.164, because 082 123 4567 and +27821234567
are one tradesperson and a directory that lists them twice is one nobody trusts.
`whatsapp` is stored, never inferred: a `wa.me` link to a number that is not on
WhatsApp lands the landlord on an error page blaming them. Providers are **off
by default** — a half-entered provider that is live by accident is worse than
one nobody can find.

`sponsoredUntil` exists and nothing reads it. A paid placement here would charge
an **advertiser**, not a landlord, so it does not touch "free to list, free to
apply" — and it costs one nullable column now versus a migration later.


### 5.10 Lease documents — ✅ built in v1.83.0 (Phase 4e)

Storage. Not signing.

`LeaseDocument` holds a file, its kind, a label and who uploaded it, against a
tenancy. Either party may upload; only the uploader may rename or remove their
own, so one side cannot quietly delete the other's copy of what was agreed. Both
parties see the same list from one component — the landlord's yard behind a
per-tenancy toggle, the tenant's rent page directly.

⚠️ **No e-signature, deliberately, and asserted.** There is no
`signedByTenantAt`, no signature image, no hash chain and no trusted timestamp.
Signing is execution of a legal document: under the ECT Act an "advanced
electronic signature" is a specific accredited thing, and a product that files a
finger-drawn squiggle next to a lease invites both parties to believe something
about enforceability nobody here has advice to support. A half-built e-signature
is worse than none because it looks like one.

That line is held by tests rather than intentions.
`scripts/storage-drive.mjs` checks no field on a stored document matches
`/sign|witness|execut|notar/` and that `POST .../sign` answers 404;
`scripts/lease-docs-ui-drive.mjs` checks the rendered panel never says "is
signed", "legally binding", "verified by", "e-signature" or "we have checked",
and does say that Mastande does not sign anything. A later commit adding any of
it has to walk past a failing check.

**No admin route.** The only document store in the codebase without one. A lease
names two people, what they pay and where they sleep, and no support task
requires reading it — unlike a verification, where an admin must check an ID
against a claim.

**Retention differs from verification, on purpose.** A lease is personal
information about both parties (s.1), not special personal information (s.26):
it is a contract, not an identity document, and both need it for as long as it
can be disputed. Deleting the only copy of an agreement would be the harm.
Removal is a real deletion through `FileDeletion` — see §5.11.

Opening a document returns a **signed URL that expires in five minutes**, minted
per read, so a location is not sitting in every list response or in a link pasted
into a chat.

### 5.11 Files are actually deleted now — ✅ fixed in v1.83.0

🔴 **The worst defect this codebase has had, found while building §5.10.**

Nothing had ever deleted a stored file. Deciding a verification cleared
`documentPath`, set a column named `documentDeletedAt`, and wrote an audit event
reading *"The uploaded document was deleted. Only this outcome is kept — POPIA
s.26."* There was no ImageKit SDK in `package.json` and no call to its delete
API anywhere in the repository. The reference went. The ID photograph stayed,
indefinitely.

Three live statements said otherwise, one of them statutory:

| Where | What it said |
|---|---|
| Privacy policy, ImageKit row | "deleted once reviewed — only the outcome is kept" |
| PAIA manual | "Documents are deleted on decision" |
| `/tenant/passport`, at the moment of upload | "deleted as soon as someone has looked at it" |

The person relying on those is the one who handed over their identity document.

**Why nobody caught it.** The one smoke assertion covering the promise read
`documentDeletedAt != null` — true, and proof of nothing but that we had written
our own timestamp. It also sat behind `ADMIN_TOKEN`, so it had never run. And
the admin queue's "Open document ↗" linked to the bare stored path, which
resolved against the app's own origin and 404'd, so no reviewer could see a
document either way. Every private upload was effectively write-only.

**The fix.**

- `FileDeletion` is a durable queue. The row is written in the **same
  transaction** as the change that orphans the file, so a committed decision
  always has a pending deletion behind it and a rolled-back one deletes nothing.
- `deletedAt` is set from ImageKit's response and **never optimistically**. A
  failure is recorded as a failure and the row stays outstanding; it is retried
  hourly, with an attempt cap so the queue depth keeps meaning something.
- `documentDeletedAt` is renamed `documentWithdrawnAt`, because that is the
  promise that timestamp can keep. The audit trail now records two facts:
  `document_withdrawn` when the document leaves view, `document_deleted` only
  once storage confirms the bytes are gone.
- `GET /admin/storage/status` makes the promise **checkable** — outstanding,
  stuck, and the age of the oldest thing still waiting, with no path or filename
  in the payload. An unfalsifiable claim about someone's ID document is not
  acceptable, which is how this happened.
- `StorageService.signedUrl` fixes the write-only problem. The admin queue now
  gets a signed 15-minute URL instead of a path.

**How it is verified.** `scripts/storage-drive.mjs` **is** an ImageKit stub. The
API is pointed at it, so the assertion is that a `DELETE` arrived for the right
file — not that the code contains a `fetch`. It also drives the case that
matters most: with the stub returning 500, the drive checks the queue reports a
failure, does **not** stamp the row deleted, and that a retry completes it.
Reverting the fix makes three assertions fail and the script exit 1; that was
checked, not assumed.

One thing it cannot settle: whether ImageKit **accepts** our signature. The
algorithm matches their SDK and the drive recomputes it independently, but only
a real key proves acceptance — see PRE-LAUNCH-CHECKLIST.


### 5.12 Landlord task inbox and portfolio health — ✅ built in v1.84.0 (Phase 5a/5d)

The two questions a landlord opens the app with: what needs doing, and how is it
going. Both are **pure aggregation** over what Phases 1–4 already record — no new
tables.

**One list, ordered once.** The rows are unlike each other: an applicant waiting
nine days, a lease ending in ten, a tenant saying your rent record is wrong.
Ranking those is a judgement, and it is made server-side. `urgency` comes from
the API and the screen renders in the order given, because two places sorting the
same list is two places that can disagree — and the landlord would trust
whichever they saw first.

The ranking, most pressing first: a **disputed** month (somebody is telling you
your record is wrong, and every day it stands unread is a day of bad feeling),
then anything dated, by days remaining and with overdue items negative, then
**unmarked rent** last — rent admin has no deadline, and putting it above a lease
ending next week is how people learn to ignore a list.

**Every row is actionable**, carrying its own `actionPath` and `actionLabel`, so
a new kind needs no template change. Actions carry a fragment where they target a
section, so the landlord lands on the thing rather than the top of a long page.

**Nothing renders when nothing needs doing.** No empty "Needs you" panel.

❌ **The brief's fourth source does not exist.** It lists "unresolved maintenance
items (Phase 2 Tier 2)" — there is no maintenance log. Tier 2 was deliberately
not started (§5.6 — the brief gates it on survey data that does not exist yet).
Three of four sources are aggregated and the fourth is not faked. When a
maintenance log lands it adds a `kind` and nothing else changes.

**5d says what it cannot know.** Every figure ships with its denominator, and one
with too little behind it is `null` rather than a rounded guess — `null`
occupancy means nothing has been measured, not that nothing is occupied. Payment
reliability needs three recorded months before it is quoted at all; below that a
landlord would read "0%" as "my tenants never pay". At small volumes the summary
gives counts rather than percentages: "two of your three rooms are taken" is the
same fact as "67% occupancy" without the false precision. `waived` months are
excluded from both sides — counting them as unpaid makes a kindness look like a
bad tenant.

The paragraph is built server-side beside the numbers, because its wording
changes with the data and that logic does not belong spread across a template.

**Verified two ways.** `inbox-drive.mjs` builds a landlord with several competing
situations at once and checks the ordering between them;
`inbox-ui-drive.mjs` checks the panel leads the dashboard, that every action
resolves to a real route rather than a 404, and that no two accessible names are
identical — "Mark it" three times down a list names nothing. Inverting the
urgency makes both fail independently; that was checked.

One assertion in the first drive originally had `ok()` on **both** branches, so
it could not fail. Same shape as a check asserting its own timestamp, and it read
green until a second reading.


### 5.13 Landlord storefront — ✅ built in v1.84.0 (Phase 5b/5h)

A public, indexable page per landlord, carrying the badges 5h asks for.

⚠️ **It lives at `/landlords/:slug`, and the brief said `/landlord/[slug]`.**
That route cannot work. `/landlord` is the authed portal: guarded by `authGuard` +
`landlordGuard`, and carrying `seo: { noIndex: true }`. A public page under it
would be unreachable to visitors and told not to be indexed — the opposite of the
point — and `dashboard`, `yard`, `verification` and `services` would every one of
them be a valid slug shadowing a real screen. So: a separate public top-level
route, plural.

**Off until its owner turns it on.** The slug is minted when the landlord first
opens the settings screen, so there is a URL to show them; `storefrontLive` stays
false until they press the switch. A page about a person, indexable by Google, is
not something to create on their behalf — and nothing reaches the sitemap before
they publish.

**The slug is stable and not editable.** It is in the sitemap and in whatever
anyone has shared; changing it would 404 every link that pointed at the page, and
the landlord who renamed it would be the last to find out. A rename needs a
redirect table, which is a bigger thing than 5b. Collisions resolve by counting —
`thabo-mokoena`, `thabo-mokoena-2` — so the second one is still a URL a person can
read out, which is the whole reason for not using the id.

**Hidden and never-existed are indistinguishable.** Both answer 404 with the same
message, never 403. A distinguishable refusal would let anyone enumerate which
landlords exist and which have hidden their page, and that is information about a
person.

**Nothing on the page is a claim the landlord made.** Badges are computed from
usage and each carries its own `basis` string, so the page says why rather than
showing a shiny thing. The response time is a **median** — one application left
over a long weekend must not define someone — and is absent below three answered
applications: a tenant is using this to decide whether to bother applying, and one
fast reply is not a habit. The bio is labelled as their own words, unchecked by us, in the copy.

**SEO, treated as such.** Server-rendered, `RealEstateAgent` JSON-LD with the
rooms as `makesOffer`, in the sitemap at priority 0.6 — below a room page, which
is what people search for, above the marketing pages. `/storefronts` is added to
`SSR_PUBLIC_PREFIXES`, without which the server render would skip the fetch and
deliver "Loading…" to a crawler.

No hreflang cluster, for the same reason room pages have none: the bio is never
translated, so localised URLs would serve identical text.

**What could not be verified locally, and why it is asserted differently.**
Canonical and `robots` depend on the request's host, and **no local host is the
canonical host** — the built dev server serves `noindex, nofollow` and omits the
canonical for *every* page on it, a room page included. The production build could
be asked as the real site, but it points at `api.umastande.co.za`, which does not
resolve off production. So `verify-build.sh` asserts the **static** fact that
would actually regress — that the storefront route carries no `noIndex` and is
`RenderMode.Server` — and adding `noIndex` to that route makes the suite red,
which was checked.


### 5.14 Private tenant notes and the calendar — ✅ built in v1.84.0 (Phase 5e/5f)

**5e — notes.** `LandlordNote`: an author, a person it is about, free text.
Keyed on the **tenant**, not a tenancy, because the value is remembering what you
wrote about someone two years ago when their application comes round again.

Every read is scoped by the author **in the WHERE clause**, not fetched and then
checked. A permission check after the fact is one refactor from being dropped; a
query that cannot return the row is not. `LandlordGuard` admits `ADMIN`, so an
admin passes the guard — and gets `[]`, because the query scopes to the caller.
That is the property the drive asserts: no *data*, whatever the status code.

A note can only be written about someone who has **applied to one of your rooms
or rented from you**. Without that limit the endpoint is a way to keep a private
file on any account id you can guess.

❌ **No score, no stars, no flag, nothing structured.** A private rating collected
across landlords is a shadow credit score assembled from opinions, which is
exactly what Phase 1 rejected the bureau check to avoid. Nothing here feeds
reviews, the Tenant Passport, or Phase 1's landlord-reference flow — that flow is
a separate, *consented* exchange where a previous landlord knowingly answers a
specific question. This model must never be wired into it.

**POPIA.** Both foreign keys cascade. The author's account going takes their
notes; **the tenant's account going takes them too**, because they are about a
person with a s.24 right to erasure — without that cascade, deleting a tenant
would leave notes about somebody who asked to be forgotten. A tenant cannot read
notes about themselves through the API: the s.23 right of access is against the
landlord, and self-service would turn a memory aid into a channel for arguing
with it. That path is admin-assisted and logged.

The screen says all of this in the copy, every time — only you can see these, the
tenant cannot, it is not a rating. A landlord who believes otherwise writes
differently, or writes nothing useful.

**5f — the calendar.** Rent dates, lease endings, notice deadlines and the day a
room frees up, grouped by month.

⚠️ **Dates are days, not instants.** Every entry is a plain `YYYY-MM-DD` built in
UTC, and the browser parses it by **splitting the string**. `new Date('2026-10-01')`
parses as UTC midnight then renders in local time, so a landlord east of
Greenwich sees the 30th of September. Handing the API's deliberate day-string to
the `Date` constructor is how the off-by-one-day calendar gets reintroduced.

Rent dates are **generated** from live tenancies rather than stored — there is no
`RentSchedule` table. Storing them means a row per tenancy per month that goes
stale the moment a tenancy ends, plus a job to clean it up. Every rent entry
carries "Mastande does not collect rent", because a calendar row that looks like a
bill is exactly where someone would assume otherwise.

❌ **No inspection category** — the brief lists it "(if built)" and it is not.
An empty category is a heading with nothing under it.

❌ **No .ics feed, and that is a decision rather than a missing afternoon.** A
subscribable feed is a URL that answers with no session, because Google Calendar
fetches it server-side with no cookies. That means a long-lived capability token
in a URL exposing tenancy dates and tenant names to anyone the link reaches — and
calendar URLs get pasted into shared calendars routinely. Doing it properly needs
a revocable per-landlord token, a way to see and rotate it, and a decision about
what the feed may contain. The brief marks it a stretch and says to check the
effort first; this is that check.

### 5.15 Phase 5g was already built

`ReferralCode` and `Referral` exist, with rewards on a **qualifying action**
rather than signup — *"Signups are not rewarded on their own — that is how
referral schemes fill with fake accounts"*, in `referrals.service.ts`. A
`ReferralPanel` is on the landlord dashboard. Checked against the brief before
building anything: unique code per landlord ✓, trackable through signup ✓, both
parties rewarded on the referred landlord's first completed action ✓. Nothing to
do.


## 6. What "verified" means here

`./scripts/smoke-test.sh` exercises the API against a live server: **461
passing checks, 3 skipped** with a full environment at v1.84.0 — up from 340/14,
because 92 checks had never run at all (see below), across auth, room lifecycle,
applications, messaging, alerts, verification, cross-tenant isolation, rent, the
WhatsApp bot, refunds and the listing wizard's validation. The skips are loud and
named; each states what to set to include it.

Some features are driven by their own script rather than folded in here, where
the fixtures are expensive or the assertions are about a browser:

| Script | What it proves |
| --- | --- |
| `phase-drive.mjs` | each phase's screens are *reachable* — the defect three releases shipped with routes that were fine and nav that was not |
| `lease-drive.mjs` | lease windows and notice as **dates**: 20 days is inside the window, 200 is not, backdated notice is already overdue |
| `lease-ui-drive.mjs` | the yard panel, and that the two Phase 4 cards order correctly on one screen |
| `services-drive.mjs` | directory filtering, number normalisation, off-by-default |
| `services-ui-drive.mjs` | the `tel:`/`wa.me` links, and that errors are not reported twice |
| `mobile-drive.mjs` | the five bugs found on a real phone, at 390px |
| `inbox-drive.mjs` | the task inbox's ORDERING between competing situations, and what the health card refuses to quote |
| `inbox-ui-drive.mjs` | it leads the dashboard; every row resolves to a real route and is distinctly named |
| `storefront-drive.mjs` | published only when asked; hidden is indistinguishable from nonexistent; slug collisions; the sitemap entry |
| `storefront-ui-drive.mjs` | that a crawler is served CONTENT, not "Loading…", plus the JSON-LD in the raw HTML |
| `notes-calendar-drive.mjs` | that a private note is private — from another landlord, the tenant AND an admin — and that calendar dates are days, not instants |
| `storage-drive.mjs` | **that deleting really deletes** — it IS an ImageKit stub, so it checks a DELETE arrived, and that a 500 is not recorded as success |
| `lease-docs-ui-drive.mjs` | both parties see the lease, and nothing on screen claims it was signed here |
| `a11y-drive.mjs` | 25 pages: heading order, accessible names, contrast at rest, on hover and on focus |
| `refund-drive.mjs` | the refund promise |
| `verify-build.sh` | what the production build and the deploy artefact actually *serve* |

It is an integration check, not a test suite. It does not cover:

- concurrency — two tenants applying to the last room at the same moment
- failure paths — what a half-finished transaction leaves behind
- load, backup, restore

Two things worth knowing about the shape of this coverage, both learned the hard
way in this codebase:

- **A green check on an empty screen proves nothing.** An accessibility run
  passed 23 pages while the admin queues were empty, and a heading defect on a
  populated queue survived it. Where a drive covers something the a11y run
  cannot see, it says so in its own header.
- **A check can be true and prove nothing.** The retention promise was covered by
  `documentDeletedAt != null` — our own timestamp, asserting our own claim, with
  no file deleted anywhere. It was also behind `ADMIN_TOKEN` and had never run.
  When a check is about something leaving our control, it has to observe the
  thing leaving: see §5.11.
- **Ninety-two checks had never run once.** Seven sections were gated on
  `ADMIN_TOKEN`, which nobody ever set, and more on `WHATSAPP_APP_SECRET`,
  `RESEND_WEBHOOK_SECRET` and an unseeded survey. `skipped: 14` gave a reader no
  way to know that the one assertion about a tenant's identity document was among
  them. Two changes: the suite now **derives** `ADMIN_TOKEN` from
  `ADMIN_EMAIL`/`ADMIN_PASSWORD` when it can, and the summary **names** every
  skip instead of counting them, then lists exactly what to set for a release
  run. A skip you can read is a decision; a skip you can only count is a hole.
- **A check can fail for its own reasons and blame the product.** A phase-drive
  assertion reported "the new yard is not on the screen" for a working feature,
  because its loose selector matched "Delete yard" and then the rent-reminder
  form's "Save". It was pressing a destructive button while claiming to test
  creation. Selectors are anchored on the element being exercised now.
- **No single `verify-build.sh` run clears every skip.** The room and sitemap
  checks need an API on port 3000; the hanging-API check has to black-hole that
  same port. Run it both ways before tagging.

Treat green as "the happy path and the obvious guard rails hold", not as proof
of correctness.
