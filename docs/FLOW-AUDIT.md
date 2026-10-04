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


### 5.16 Signing up with a phone number — ✅ built in v1.85.1 (Phase 7g)

**The gap it closes.** Phone sign-IN shipped in v1.85.0, which meant a
WhatsApp-first landlord could sign in only if somebody had already created their
account with an email address. The people the feature exists for could not get
through the front door on their own.

**The state machine.** A `PhoneSignup` row, not a `User`:

```
(nothing)
   │  POST /auth/phone/signup/request-code     code sent, row created
   ▼
awaiting code ──── 5 wrong guesses ──▶ burned (codeHash cleared)
   │  POST /auth/phone/signup/verify           code correct
   ▼
proven (ticket, 20 min) ──── ticket expires ──▶ dead, nothing created
   │  POST /auth/phone/signup/complete         + acceptTerms: true
   ▼
consumed → User created, phoneVerified: true, consentAcceptedAt set
```

**Why no `User` until the last step.** A row with `phoneVerified: false` would
be an account on somebody else's handset, created by anybody who can type a
number into a public endpoint: countable in "users", reachable by the
notification and deletion machinery, and in the way when the real owner tries to
sign up. A sign-up attempt is not a person agreeing to anything.

**The consent is the control.** `acceptTerms` must be literally `true`
(`@Equals(true)` plus a service check), and the moment is recorded against the
row that proved the number. This is what makes *assisted* sign-up safe — an
agent or a family member can do every other part, and the acceptance still has
to come from the person holding the handset. The UI drive asserts the box
arrives unticked and the button is dead until it is ticked, which the API cannot
prove.

**Retention.** Abandoned attempts are the mobile number of someone who never
joined, so they are pruned after 24 hours. Completed rows are kept as that
account's consent record and cascade away with the account (POPIA s.24).
`GET /admin/phone-signups/status` reports `overdue` so the promise is checkable,
and `POST .../prune` runs it on demand — the same pattern as the file-deletion
queue, for the same reason: "it is on a cron" is not evidence.

### Gaps

| Gap | Severity |
|---|---|
| 🔴 A new number has by definition never messaged us, so it is **always** outside Meta's 24-hour window. Until the authentication template is approved (`docs/OUTSTANDING.md` §7), a sign-up code can only reach a number that happens to have messaged the business in the last day. The flow is proven end to end; the pipe is half-connected | **Blocking for launch of this flow** |
| A phone-only account cannot pay the verification fee — PayFast requires `email_address`. Refused explicitly with an instruction to add one, rather than given a placeholder | Medium, by decision |
| No assisted sign-up mode yet (an agent-led flow with its own audit trail), no account recovery for a phone-only account, and no "add an email later" screen | Medium — each is listed in `docs/OUTSTANDING.md` |
| This path sets `marketingEmails: false` against the column default, because what the person ticked was the Terms, the Privacy Policy and POPIA processing — marketing is a separate consent under s.69 and was not asked for. ⚠️ **The email registration path still takes the `true` default**, and its page only states the Terms passively rather than asking for a tick. Pre-existing, not introduced here, and worth fixing with the same control | Medium |

### 5.16b The notice channel was write-only — ✅ fixed in v1.85.1

`NoticeRouter` has written `Notice` rows since v1.85.0 as the channel that works
when there is no email address, and **nothing could read them.** Its own comment
calls the notice "the channel that cannot fail for reasons outside our control",
which was true of the write and meaningless without a read: a phone-only
landlord's "you have a new applicant" went into a table, WhatsApp refused it
outside Meta's 24-hour window, and nobody was told anything by any channel.

Fixed in the same release as phone sign-up, because sign-up is what creates the
accounts that depend on it. `GET /notices`, `GET /notices/unread` (count plus
list, so a nav badge is one call), `PATCH /notices/:id/read`,
`POST /notices/read-all` — every one scoped to the caller in the WHERE clause,
so another person's notice is a miss rather than a refusal. `/account/notices`
renders them for both roles, with an unread badge in both sidebars, because a
screen nobody can find is the same as no screen.

The page shows the **WhatsApp outcome per notice** in plain words. A landlord
waiting on WhatsApp and getting nothing should be able to see that the message
was refused rather than conclude that nobody applied.

### Gaps

| Gap | Severity |
|---|---|
| The badge is loaded on the two dashboards and refreshed when the notices page opens, not polled. A notice arriving while a landlord sits on another portal screen shows up on their next navigation, not instantly | Low — real-time delivery is a different feature |


### 5.17 Rate limiting existed only as decoration — ✅ fixed in v1.85.1

Nineteen `@Throttle` decorators across eight controllers had never limited
anything, and `/auth/login` carried no decorator at all. `ThrottlerGuard` was
never registered anywhere, and the root throttler was named `global` while every
decorator keys `default` — a key matching no configured throttler is silently
ignored. Eight requests to a route marked `limit: 5` all returned `200`.

The guard is now paired with every `@Throttle` **per route, not globally**: the
SSR server calls this API for every server-rendered page from one address, so a
global per-IP guard would throttle the whole site under load.

The limits were also re-pitched for this market. Mobile carriers here put very
large numbers of subscribers behind one address, so 5 per 15 minutes can be a
neighbourhood's budget: auth requests are 15 per 15 minutes, verifications 30,
`/auth/login` 30, register 60 per hour, and public scam reporting 20 per hour
(raised from 5 — a false report costs an admin a minute, a suppressed one leaves
a scam listing up).

Register is the one that moved furthest, from 10 an hour to 60, and for a reason
worth stating: an agent helping a row of landlords join on one wifi at a
community event is how this product is meant to grow. Ten an hour refuses the
eleventh person in that queue.

### Gaps

| Gap | Severity |
|---|---|
| No per-ACCOUNT login lockout. The new limit is per IP, so a slow distributed spray against one known email is still possible | Medium — `docs/OUTSTANDING.md` §12 |
| Counters are in memory, per instance. Two instances behind a load balancer roughly doubles every limit | Low until the API scales past one instance |


### 5.18 Tenant sub-letting and shared-lease listings — ✅ built in v1.86.0 (Phase 6, Option A)

**The decision.** `UserRole` keeps its three values; a `TENANT` may hold a
listing whose `listerType` is `sublessor`. Option B — generalising "Landlord"
into "Room Provider" — is cleaner long-term and touches every guard, dashboard
and string in the product. Option A was signed off on 2026-10-03.

⚠️ **Consequence to know:** `Room.landlordId` now sometimes points at a
`TENANT`. The column name is wrong and is left alone deliberately — renaming it
means rewriting every query, index and DTO that mentions it for no behavioural
gain, and a half-done rename is worse than a known misnomer. Read it as "the
account that holds this listing".

**The guard split, which is where the risk was.** Fifty-two endpoints carried
`LandlordGuard`. Widening it to admit tenants would have opened the yard, rent
tracking, expenses, the paid identity badge, the storefront and
listing-by-WhatsApp in a single edit, and the reviewer of that diff would have
had to notice all fifty-two call sites to catch it. So:

| Guard | On what | Admits |
|---|---|---|
| `ListerGuard` (new) | rooms (17), applications' lister side (8), tenant references (2) | LANDLORD, TENANT, ADMIN |
| `LandlordGuard` | yard + rent + expenses (10), inbox (2), notes (2), storefront (2), payments (2), WhatsApp listing (5) | LANDLORD, ADMIN |

Neither guard decides ownership: every service scopes its query by
`landlordId`, which is why a sub-lessor passing `ListerGuard` still gets a miss
on somebody else's room. The drive checks both halves — a sub-lessor can run
their listing, and gets 403 on all five owner surfaces.

**The sub-letting check.** A new `VerificationType.sublet_right`, with a
`roomId` on `VerificationRequest`, because the right to sublet comes from one
lease over one address: being allowed to sublet in Yeoville says nothing about
Soweto. Approval stamps `Room.subletCheckedAt`; a later rejection **clears** it,
because a badge an admin has just disagreed with must not stay up. It is a date,
not a boolean, so the page can say "checked on 14 March" rather than "may
sublet" — the head landlord can withdraw consent the next day and nothing tells
us. **No fee:** a sub-lessor is listing a room, listing is free here, and
charging them would be a landlord listing fee by another name.

**What an applicant is told.** A `Sublet` badge on the card, and on the room page
a notice above the fold (measured at 522px of a 900px phone viewport) saying the
room is let by a tenant, that Mastande does not confirm or guarantee the right to
sublet, and that it is the applicant who can lose the room and the deposit.
Checked listings show the date and what the check did not cover; unchecked ones
say so and say what to ask for. `/legal/sublet` is a new page written from
scratch — addressed to the applicant, not to our liability.

**Positioning: the same board, with an explicit filter.** Splitting the board
halves the inventory each half can show, and at launch volumes a thin board is
what loses both segments. Filters: "Who is letting it", plus four household
filters (who lives there, hours, tidiness, sociable or quiet) stored once on
`Property`.

### Gaps

| Gap | Severity |
|---|---|
| 🔴 `/legal/sublet` is **not attorney-reviewed.** It characterises the effect of a head lease on a sub-tenant and summarises the Rental Housing Act on deposits. `docs/OUTSTANDING.md` §8 names the three sections to ask about | **Blocking for launch** |
| Household filters exclude every listing that has not described itself, which is most of them. Inherent — an `unstated` household can neither match nor be ruled out — and the board says so beside the controls rather than silently returning five rooms | Low, stated |
| Rooms are grouped into a household by `locationDisplay`, a heuristic rather than an identity. Two rooms a sub-lessor describes as "Observatory, Cape Town" are assumed to be one house; if they are not, the second's household facts overwrite the first's. Right for the common case (one person, one place); wants a real address on `Room` if sub-lessors with two houses turn out to be common | Low |
| A sub-lessor has no inbox, no private tenant notes, no calendar and no storefront — all four are owner-shaped (rent periods, yards, a public landlord page). Deliberate for v1; each would need its own thinking for somebody who is not the owner | Medium |
| `listerType` cannot be changed after creation: flipping a listing would change what every applicant who already applied was told about who they are dealing with. Somebody who picked wrong creates the listing again — a draft costs nothing | By design |
| Shared-bill splitting between co-tenants is **not** built, as the brief says. `Expense` stays a record of a cost with no `paidBy` or `sharePercent`, so a future split can be its own table pointing at it | Deferred, unblocked |


### 5.19 Nav-link integrity — ✅ audited and fixed in v1.86.1 (Phase 7a)

The brief asks for the full list of mismatches found, **including ones already
fixed**, so there is a record of what was wrong. Here it is.

#### What the brief asked about, answered

| Named in the brief | Finding |
|---|---|
| `/landlord/billing` | **Gone.** Zero references anywhere in the frontend. It was removed with the paused subscription pages; `landlord-nav.ts` carries a comment where the entry was, saying it pointed at `/landlord/upgrade` and that restoring it means restoring a real page first. |
| `/landlord/my-rooms` | **Gone as a route.** The nav entry now points at the dashboard's `#active-listings` section, which is where a landlord's rooms are. Its LABEL was still wrong — see below. |
| `/landlord/upgrade` | **Deleted.** Two comments mention it, both explaining the deletion: it offered Pro at R349/mo and Agency at R1,499/mo with no payment provider behind them. |
| a `messages` route, either portal | **Does not exist, and is not linked.** Message threads live inside an application (`message-thread` component), reached from that application. Both portal navs carry a `disabled: true` "Messages" entry that renders greyed with a "Soon" chip — which is the truth; listing it as a destination was not. |
| `verification` reachable from the landlord nav | **Yes** — "Verification" → `/landlord/verification`. |
| `passport` reachable from the tenant nav | **Yes** — "Renter's Passport" → `/tenant/passport`. ⚠️ My own audit script reported this one as unreachable at first, because its label is written with double quotes (it contains an apostrophe) and the parser only matched single-quoted labels. The finding was the tool's, not the product's. |

#### What the audit found that the brief did not name

| # | Finding | Fix |
|---|---|---|
| 1 | 🔴 **`route-audit.mjs` could not see dead links at all.** It compared only the FIRST SEGMENT of each link against the known areas, so `/landlord/billing` and `/landlord/my-rooms` would both have passed — the audit printed "every internal routerLink resolves to a declared route" while pointing at routes that never existed. | Replaced by `scripts/nav-audit.mjs`, which parses the route tree with brace matching and resolves every link as a full path, parameters included. The old section now says where the real check lives rather than making a weaker one. |
| 2 | **"My Rooms" opened a section headed "Active listings"** — two names for one place. Worse: a landlord whose rooms are all drafts clicked "My Rooms" and read "No rooms listed yet" while holding three of them. | One name: the nav says **Active listings**, exactly as the section does. **Drafts** got an `id` and its own nav entry with a count, so the other case is reachable rather than inferred. |
| 3 | **"Applicants" in the landlord nav pointed at `#active-listings`** — a label naming a destination that does not exist. There is no applicants screen and no section by that name; applicants are listed per room. | The applicants count moved onto **Active listings**, where they are. The slot now holds **Needs you** → `#needs-attention`, which is a real section, exactly named, and surfaces waiting applications first. |
| 4 | **The footer's "My applications" opened the tenant dashboard root** — the one thing it named was the one thing the person then had to go looking for. | Points at `#your-applications`, as the portal nav already did. |
| 5 | **`/legal/sublet` was in no nav surface.** Phase 6 shipped it reachable only from a sublet room page and the listing wizard, so a tenant who read it while deciding had no way back. | Added to the footer's legal column. English in every locale, deliberately — see the comment there. |
| 6 | **The admin nav had no Notices entry**, so an admin — who is a user the notice router can write to — had nowhere to read one. | Added. It also removed the one odd exception the reachability check had to carry. |
| 7 | **The listing wizard had no `h1`** (found in Phase 6 by adding it to the accessibility drive, fixed there). | Noted here because it is the same class: the most-used form in the portal never said what it was. |

#### What the audit now checks, every release

`scripts/nav-audit.mjs`, wired into `verify-build.sh`:

1. **Full-path resolution** of all 111 internal links — `routerLink`, `[routerLink]` arrays, `navigate([...])` and `navigateByUrl`.
2. **The nav surfaces, enumerated** — navbar (desktop and mobile drawer are one template), footer, and the portal strip for each of the three roles. Printed as a list, because the brief asks for the list and not just a verdict.
3. **Reachability** — every guarded screen is in a nav, or is on a list of exceptions each stating where it is reached from instead.
4. **One name per thing** — every nav label against the heading of the page or section it opens, with light stemming so "Verifications" and "Verification queue" are not reported as two names.

Each of the four was falsified before being trusted: a `/landlord/billing` entry fails it, removing the passport entry fails it, a fragment no page declares fails it, and renaming "Rent" to "Money" warns.

#### Deliberate exceptions, with reasons

Public landing pages whose `h1` is a headline rather than the page's name are
allowed by route, not by area: `how-it-works`, `pricing`, `advertise`,
`admin/dashboard` ("Admin" enters an area, "Overview" is a screen),
`landlord/dashboard` (the footer calls it a portal from outside) and
`admin/analytics` ("Usage" in a nav strip, "How the site is used" on the page —
one word in two grammatical forms). Nobody clicking "Pricing" is confused to
land on "Free to list. Free to apply."; the defect the brief is about is an
in-product destination known by two names.

### Gaps

| Gap | Severity |
|---|---|
| The reachability exception list is hand-maintained. A new screen reached only from a page body has to be added to it, which is the point — but it means the check is as honest as the reasons in it | Low, by design |
| Label comparison reads the first `<h1>` or `pageTitle` it finds per component, and section headings by proximity to an `id`. It cannot read a heading built from a signal, so a page whose title is computed is skipped rather than guessed at | Low |
| Nothing checks the nav against what a given ROLE can see: `landlordNav()` is compared as a list, not as rendered for a landlord with no rooms. The portal strip is covered by the accessibility drive at 412px, which is where it is a scrolling strip | Medium — 7b–7f territory |


### 5.20 Properties: grouping rooms at one address — ✅ rebuilt in v1.87.0 (Phase 7b)

**The diagnosis, which was right.** Grouping existed and nobody used it. It was
reachable only from inside the yard screen, below the rent tracking and the
expenses, behind a button reading "+ Group rooms into a yard" — so the concept
was something a landlord found while doing something else, if they scrolled far
enough, under a word that appeared nowhere else in the product.

**What changed.**

| Before | Now |
|---|---|
| One screen, `/landlord/yard`, nav label "My property" | A list at `/landlord/properties` ("My properties" in the nav) and a detail view at `/landlord/properties/:propertyId`. `/landlord/yard` redirects — it is in landlords' bookmarks |
| Grouping discovered by scrolling | A card per property: the landlord's own name for it, the address under it, a photo borrowed from one of its rooms, and "2 rooms — 1 vacant — 1 let" |
| Nothing taught the concept | An empty state with one sentence and one button, and a line saying grouping is optional when they already have rooms |
| Rooms created one at a time, grouping never mentioned | The wizard asks, in the brief's words, "Is this room at an address where you already have a room listed?", with the existing places as cards — and only when there is at least one |
| Adding a second room meant retyping the suburb | "+ Add a room to this property" carries `?propertyId=` into the wizard, pre-selects it and fills in province, city and location |
| "Delete yard" with a generic warning | A refusal from the API unless the caller confirms, naming the count and saying the listings are NOT deleted; the dialog says what is lost (the grouping, the house rules, the shared facilities) and what is not |
| No way to ungroup one room | "Take out of this property" per room, with a confirmation that names what survives: the photos, the applications, the tenant |

**The private address line.** The brief asks for the full address on the card.
The yard screen had deliberately never collected a street address — the board
shows the suburb and not the street, for the tenant's safety, and the platform
has no function that needs one. So `Property.addressLine` is **optional, free
text, and never leaves the landlord's own screens**: not in
`PUBLIC_ROOM_DETAIL`, not on the board, and the field says so where it is typed.
POPIA s.10 — the purpose is "so a landlord can tell their own properties apart",
which is why it can be left blank and why nothing else reads it. A future
feature needing a verified address is a different field with its own consent.

**Structure is not forced on anybody.** A landlord with one address never has to
create a property: rooms without one are a card of their own, listings behave
exactly as before, the picker is not shown to somebody with no properties, and
"No — somewhere new" is a real answer. The brief is explicit, and it matters
most for the person this product is for.

### 5.21 Applicants and messages had no home — ✅ built in v1.88.0 (Phase 7c)

**The diagnosis.** Both lists existed only inside a single room or a single
application. A landlord with six rooms and eleven applicants had seventeen
screens to open before they knew the answer to the only question they actually
have — "has anybody written to me?" — and no screen anywhere could answer it
across the lot. Both portal navs listed "Messages" greyed out with a "Soon"
chip, which Phase 7a had made them do because the entry was a promise nothing
kept.

**What changed.**

| Before | Now |
|---|---|
| Applicants per room only, at `/landlord/rooms/:roomId/applicants` | `GET /applications/inbox` and `/landlord/applicants`: every applicant across every room, filterable by room or property, sortable newest-first or waiting-on-you-first |
| Messages only inside the application they belonged to | `GET /messages/inbox` and `/account/messages`: every conversation, newest activity first, for both roles |
| Both navs: "Messages", greyed, "Soon" | Both navs: "Messages" → `/account/messages`, a real link |
| The nav's applicants badge was every application ever received | The badge is what is waiting on the landlord, defined once on the server so the dashboard and the applicants screen cannot drift into two answers |
| A row could only land you on the room | `?open=<applicationId>` expands that applicant on the room's screen — a list that tells you somebody is waiting and then makes you find them again has moved the work, not saved it |
| Sending into a closed thread failed and the component swallowed it | The inbox flags the thread closed, the composer is replaced by a sentence saying why, and every other send failure is now shown instead of dropped |

**One screen for both roles, in `/account`.** The same reasoning as the notices
screen, plus a stronger one: a sub-lessor is a TENANT account that also lets a
room, so they hold conversations on **both sides at once**. Two role-scoped
inboxes would split one person's messages in half by a distinction they do not
have. Each row says which side it is, because that changes where a reply goes.

**The channel warning is the point, not decoration.** A tenant's message is
forwarded to the landlord over WhatsApp; if the landlord replies there, the
webhook threads that reply back into the same conversation. So one thread
genuinely mixes channels, and a reply typed on this screen is **always** an
in-app message — a landlord's answer never goes out over WhatsApp, whatever
channel the message they are answering arrived on. Each row shows the channel of
the last message; a thread that has used more than one gets an explicit warning
above the composer, and a thread that has used one gets the quiet version. The
two wordings differ by role because the truth does: a tenant's reply *is*
forwarded to the landlord on WhatsApp when they have it switched on.

🔴 **Two defects were found by building this, and neither would error.**

- **Every WhatsApp reply a landlord typed was stored as though the tenant had
  written it.** `handleIncomingWebhook` set `senderId: originalMessage.senderId`
  — the id of the person whose message we *forwarded*. The tenant opened the
  thread and read the landlord's answer attributed to themselves; the landlord
  saw their own reply apparently coming from the applicant. The sender is now
  resolved from the **number the reply came from**, which is the only
  trustworthy signal: the landlord opted that number in, and
  `LandlordWhatsappConfig` maps it to their profile. A reply from any other
  number is dropped rather than guessed at — attributing by the quoted wamid
  alone meant anyone who could post a signed payload could write into a private
  conversation under the tenant's name.
- **`Message.readAt` had been on the model since messaging shipped and nothing
  ever wrote it.** Any unread badge built on it would have counted every message
  ever sent, for ever — the same defect as a `documentDeletedAt` that deletes
  nothing and a `MAX_ATTEMPTS` nobody reads, and the fourth of its kind in four
  releases. Opening a thread now marks **the other party's** messages read;
  marking your own would make the count on the other side depend on whether you
  had looked at your own words.

Both were falsified before being trusted: reintroduced, driven, and confirmed to
fail the check that is supposed to catch them.

**⚠️ Three findings about the checks, not the code.**

- **The accessibility drive had been auditing every portal screen EMPTY.** A
  fresh account has no rooms, no applicants and no messages, so the drive
  measured each screen's chrome and its "nothing here yet" sentence and reported
  the page green — while the rows, badges, status pills and channel chips people
  actually read were never on screen to be measured. It now seeds one room, one
  application and one message first, and **that change immediately found a live
  contrast failure**: the inbox row is a real `<button>` so it can be reached by
  keyboard, `font: inherit` resets the family and size but not the colour, and
  every row was rendering white-on-cream at 1.06:1. Invisible, and green.
- **An emoji in a CSS comment silently breaks the dev server.** `⚠️` inside a
  component's `styles` block fails esbuild's CSS parser, and `ng serve` then
  keeps serving the previous bundle — so a fix appears not to work and the drive
  keeps reporting the old defect. The production build does fail, which is the
  net that caught it.
- **A Playwright `hasText` filter is case-insensitive.** Selecting the
  single-channel thread by the text "In the app" also matched the mixed-channel
  thread once expanded, because its warning reads "…is sent in the app…". The
  drive reported the warning leaking onto a thread it was never on. Rows are now
  selected by the channel chip's own class. A check that selects the wrong
  element is worse than no check: it invents a defect and sends somebody looking
  for it in the component.

**Two smoke-suite alarms that cried wolf, fixed rather than silenced.** A 429 on
any check that did not ask for one is now a **named skip**: v1.86.0 put real
per-route rate limiting on the auth routes with a 15-minute in-memory window, so
running the suite twice inside it made "login with correct password" fail — the
limiter doing exactly its job, reported as a login bug. And the phone sign-up
enumeration check compares the reply for a taken number against the reply for a
free one using a fixed number, which spends one of its ten daily codes per run;
on the second run of the day the answer became "Too many codes sent to this
number today" and the check read that as an enumeration leak. The cap refusal is
identical whether or not the number is taken, so it leaks nothing — it simply
cannot answer the question today, and now says so.

### 5.22 The dashboard home, and what Phase 7b had quietly broken — ✅ rebuilt in v1.89.0 (Phase 7d)

**The brief's three asks.** Lead the dashboard with "what needs my attention
right now" in BOTH portals; audit every number against the plain-English
principle and **confirm it is in the real components, not just in the design
doc**; and put persistent "Add a room" / "Add a property" entry points on the
landlord home.

**The audit is the part that found things.** The landlord task inbox was already
the top section (Phase 5a), and the health paragraph underneath it is a model of
the plain-English principle — built server-side beside its numbers, every figure
shipping with its denominator, anything computed from too little data saying so.
Directly below it sat a four-box grid reading `412 / 11 / 3 / 2` under the labels
"Total views", "Applications", "Active rooms", "Previously let". Two opposite
designs, one above the other, and the grid was worse than terse:

| Before | Now |
|---|---|
| "Total views: 412" — a LIFETIME counter. A room posted in June could read 200 views without one of them being this month | "Your 3 live rooms were viewed 47 times in the last seven days." Every clause states its window |
| Nothing per room | Per room: "Viewed 12 times this week. 1 person has applied." — the brief's own example sentence, which needed a new table to be true |
| "Landlords who reply within 24 hours get far more viewings" | Advice rather than a statistic, and shown only when somebody is actually waiting. Nobody here has measured that |
| Tenant: three boxes, "Applications / Shortlisted / Awaiting reply", where the last two add up to the first | One sentence that distinguishes "nobody has opened it yet" from "read and not answered", which is the difference the tenant actually feels |
| Tenant: no task list at all | `GET /tenant-inbox` and a "Needs you" section — an acceptance to answer, an unread message, a month the landlord has not recorded, a lease ending, a Passport about to lapse |
| "List a Room" in the shell header, which scrolls away; no "Add a property" anywhere on the home | Both, persistent, on the home screen. The missing property entry point is part of why grouping went unused |

**`room_view_days` is new, and it is the only new table in this phase.** One row
per room per day, a counter rather than a row per view, and **no viewer
identity** — the figure is "how many times", and storing who looked would be
collecting personal data for a purpose that does not need it (POPIA s.10).
`rooms.viewCount` is kept as the lifetime figure because several screens read
it. The owner's own look is not counted, which was already true of the lifetime
counter and is now asserted rather than assumed.

🔴 **Three things Phase 7b had broken, all found by doing this work.**

- **The two most important buttons on the dashboard went nowhere.** Every row of
  the landlord task inbox carries its destination as a string from the API, and
  they said `/landlord/yard#money` and `/landlord/yard#ending-soon`. Phase 7b
  turned `/landlord/yard` into a redirect — correctly, for bookmarks — and **a
  redirect drops the fragment**. So "Mark it" on an unpaid month and "Decide on
  the lease" both put a landlord on a bare list of addresses with no explanation.
  Nothing errored. Nothing could have caught it: the nav audit reads templates
  and route tables, and these paths are string literals in the API.
- **"Rent reminders" became unreachable from every screen in the product.** The
  control whose own code comment records that it was built *because*
  `PATCH /properties/rent/settings` had existed since rent tracking shipped with
  no UI calling it. Phase 7b redirected the only route that rendered the view it
  lived in, so it went straight back to being an API with no screen. It is now
  on `/landlord/properties`, where the landlord-wide things belong.
- **A landlord who never grouped their rooms could not reach their own rent.**
  The only screen that renders rent, lease paperwork and expenses is reached as
  `/landlord/properties/:propertyId`, and they have no property id; the
  properties list sent their "Not grouped" card to the dashboard, and with no
  properties at all they got the teaching empty state with no link in it.
  Phase 7b insisted grouping is optional, so it cannot be the price of seeing
  your own money. `/landlord/properties/ungrouped` is a real destination now,
  and the empty state carries a way in.

**And one the move itself had left behind:** "This month" rendered the
landlord's PORTFOLIO totals inside one property's page, so opening one of four
yards showed the rent and spend of all four under that yard's name. The comment
at the top of the scoped branch had already written down why that must not
happen — "a four-property total shown inside one property is the kind of
half-true number this project keeps having to take back out" — and the section it
described sat outside the branch it was describing.

**The gate that would have caught all of it.** `scripts/nav-audit.mjs` now
resolves **paths the API hands the browser**: it reads `actionPath` literals and
path-returning helpers out of the backend, normalises `${…}` to a parameter,
checks each against the same route table, and holds any path with a fragment to
one extra rule — **a fragment on a route that only redirects can never arrive**.
The app's own fragment links, including the nav items' separate `fragment:`
property, are held to the same rule.

⚠️ **My own tool was blind twice before it worked**, and both times it reported
success. The harvester's regex was written as "anything that is not a quote",
`[^'"\`\n]*` — and the one string this section exists to check,
`/landlord/properties/${propertyId ?? 'ungrouped'}#money`, contains a single
quote *inside* a template literal. So it skipped exactly that path and printed a
green line. The second attempt matched only template literals, so when the
broken `return '/landlord/yard#money'` was put back to prove the check could
fail, the check stayed green and merely reported four paths instead of six. The
exclusion set has to be the delimiter alone, hence one pattern per quote style —
and the section now **fails** if it finds no fragment path at all, because the
API is known to emit two. A check that silently stops looking is worse than no
check: it reports success about something it never read.

⚠️ **One API signature was shaped by the check rather than the other way round.**
`propertyPath(id, section)` emitted `#${section}`, which the audit could only
report as unverifiable. It is two near-identical functions now, `moneyPath` and
`leasePath`, so the fragment is a literal in the string. Six lines, and the
alternative was a check that says "cannot tell" about the exact thing it was
written for.

⚠️ **Three drive faults worth recording**, all of which made the drive describe
a product that was fine:

- The UI drive accepted an application on both of its rooms, which takes a room
  **off the board** — so the landlord it had built had no live rooms, and it
  reported the week sentence broken while the page correctly said "nothing
  listed yet".
- The tenant rent-wording check was pointed at the tenant whose month the same
  drive marks **paid**, so there was no rent row to read and it reported the
  wording wrong about a row that correctly did not exist.
- Two figure checks in the money section **passed for the wrong reason**: with
  only one month marked paid, a property's own rent and the landlord's portfolio
  total were the same number, so breaking the scoping deliberately left both
  green and only the sentence caught it. A third tenancy at a different rent
  outside the property makes them able to fail. And one of them could not have
  failed anyway: `"R7,500.00"` does not contain `"7500"`, because the comma is in
  the way, so a formatted currency string has to be parsed rather than matched.

**The accessibility drive now audits the dashboards with rows on them.** Phase
7c had already given it a seed; this phase is the first release where the
landlord dashboard, the tenant dashboard and the ungrouped property view were
measured with real content rather than their empty states.

**Rate limiting is now the binding constraint on the drives**, which is worth
knowing before chasing a phantom. `/auth/register` allows 60 an hour and
`/auth/login` 30 per 15 minutes, counted in memory; this phase's UI drive needs
nine accounts. Running the suite of drives back to back exhausts it, and the
failure reads as "register failed: 429" or "still on /auth/login" — an auth bug,
to look at. `registerUser` now names the limiter and the remedy, and the UI
drive reuses its signed-in pages for the phone-width pass rather than signing in
twice more.

### 5.23 The sidebar was a thing each page remembered to draw — ✅ fixed in v1.90.0 (Phase 7e)

**The defect.** `PortalShell` was a component every guarded screen imported for
itself, and **two of them did not**: `/landlord/rooms/new` and
`/landlord/rooms/:roomId/applicants`. Those are the two screens a landlord uses
most — posting a room, and deciding on the people who applied for it. On both,
the portal navigation simply was not there; and on a phone, where that sidebar
IS the strip across the top and the header hamburger carries only public links,
there was no way out of either except the browser's back button.

Phase 7a had already fixed the same shape of fault one layer down: the nav's
CONTENTS were defined six times and the copies disagreed, so the sidebar shrank
as a landlord walked through their own portal. That fixed what it said; this
fixes whether it is drawn.

| Before | Now |
|---|---|
| 23 screens each importing a shell; 2 forgetting | `PortalLayout` on the four guarded parent routes, children rendering into its outlet. A new portal screen cannot ship without the navigation |
| Each screen passed its own `navItems`, `roleLabel`, `pageTitle` | Derived once from the role and the route |
| Badges were right only on the screen that happened to fetch them — four screens had grown a `refreshUnread()` call just to stop the sidebar lying on that one page | `PortalBadgesService`, loaded once per portal visit, `refresh()` for a screen that changes a count |
| The sidebar CTA ("+ List a room") was passed by the dashboard alone, so it appeared on one screen in ten | On every landlord screen |
| A screen's name lived in its template, the route said something else in `title` | `data.pageTitle` on the route, next to the `title` it has to agree with — and `nav-audit.mjs` reads the same place |

**Item 23 — Log in and Get started stay in the header on a phone.** They were
`display: none` at ≤480px, so Log in was reachable only by opening the
hamburger: two taps to the thing the header is for. Get started stayed, which
made it worse — the header showed one half of a pair. Both are in the header
now for a VISITOR; a signed-in account's three actions (Dashboard, List a room,
Log out) do not fit beside a logo at 360px and stay in the drawer, which the
CSS can tell apart because the navbar now marks the header with the auth state.

⚠️ **And the pair was 28px tall.** Measured, not read: `btn-sm`'s padding alone
never reached the target, so the two most important buttons on the public site
were both under it, before and after the change. `min-height: 44px` now, matching
what the portal strip already used.

**Item 24 — the footer quick links.** Three faults, none of which the nav audit
could see, because every one of these links resolves to a real route:

- "Landlord portal" and "My applications" were guarded routes, and the footer's
  main reader is a signed-out visitor on the public board. They asked for a
  portal and got a login form with nothing to explain it.
- Pricing was listed twice, under "For Landlords" and under "Business".
- A signed-in person was shown "Create account" and "Post a room free".

Each column now says what is true for whoever is reading it. ⚠️ The first
version of that had two branches, so a **landlord** fell into the visitor one
and was offered "Create account" — the drive caught it. `/legal/sublet` was in
the footer and not in the sitemap; the sitemap has it now.

⚠️ **Two of my own tools were wrong in the same way, and one was a security
check.** `scripts/route-audit.mjs` matched `canActivate` within a 400-character
window of `path:`, so the fifteen-line comment explaining the layout mount
pushed the guard out of range and all four areas were reported as **"everything
under it is public"** — about a file whose guards were untouched. It is brace
matched now, and the failure was reproduced on a genuinely removed guard to
prove the check still bites. `nav-audit.mjs` had the mirror image: it read
`pageTitle` from the FLATTENED route block, which blanks nested objects by
design, so every guarded route fell through and the label count dropped from 48
to 20 — twenty-eight comparisons skipped with all sections still green. The
count is printed for exactly that reason, and it is 49 now.

A proximity window standing in for the structure of the thing being read is the
third time this codebase has paid for it. A security check that cries wolf is
the worst of the three: the fourth time it fires, somebody dismisses a real one.

### 5.24 The social card, and showing somebody round once — ✅ built in v1.91.0 (Phase 7f)

**Item 1 — the default OG image.** It existed, it is the right size (1200×630,
45 KB — measured, not assumed), and `SeoService` did fall back to it correctly
with `??`. Three things were wrong around it:

- 🔴 `index.html` pointed at `https://umastande.co.za/...` — the **apex**. Per
  `environment.prod.ts`'s own note the apex is a different box answering
  `301 → https://www.umastande.co.za/`: a redirect to the site ROOT, not to the
  file. A crawler following it asked for a PNG and would be handed the
  homepage's HTML. That block is served from `index.csr.html`, the shell used
  when server rendering is bypassed, so it is the fallback's fallback — the
  place nobody looks.
- 🔴 No `og:image:width`, `height`, `type` or `alt`. Facebook and WhatsApp use
  the dimensions to choose a large card **without fetching the file first**, and
  WhatsApp is the channel this service's own comment says matters most here:
  landlords share room links over it constantly.
- `SeoService` kept dimensions on the tags between client-side navigations, so a
  route supplying its own image inherited the previous route's size. They are
  removed when unknown now.

⚠️ **The dimensions are stated only for the image whose size is a fact.** A
room's own picture goes through an ImageKit transform asking for 1200×630, and
whether `c-maintain_ratio` returns exactly that or merely fits inside it was
**not verified in this container**. A wrong `og:image:height` is worse than
none: the platform believes it and lays the card out around a size the file does
not have. So callers may declare dimensions, neither existing caller does, and
the drive asserts that a room photo ships none — which is what stops somebody
later "improving" it into a guess.

**Item 2 — the walkthrough.** Four steps, role-appropriate, skippable, and
reachable again from account settings.

| Decision | Why |
|---|---|
| The flag is `User.walkthroughSeenAt`, on the account | localStorage is the obvious choice and wrong twice over: a phone here is shared, borrowed and replaced, so a per-browser flag shows the tour to people who have seen it and hides it from people who have not — and under SSR there is no localStorage to read on the first paint |
| A nullable timestamp, not a boolean | "Show me around again" clears it, so one record serves the first visit and the fifth. A boolean that only goes one way would need a second flag beside it |
| Four steps | The brief says "the main features"; nine is a wall. Every step describes something the product actually does — none promises a feature behind a flag or waiting on a template approval |
| Rendered by `PortalLayout` | The same reason the sidebar is (Phase 7e): one place, so a new portal screen cannot ship without it |
| No step number is recorded | Somebody who closed it on step two has decided they have seen enough. Resuming them mid-tour later would be resuming something they walked away from |

🔴 **The first-run experience had two bottom sheets at once.** The cookie notice
is `position: fixed; bottom: 1rem; z-index: 9999` and the walkthrough sheet is
also bottom-anchored, so **every brand-new account got the notice drawn over the
tour's buttons**. Found by a drive whose click on "Next" was intercepted
thirteen times by `.cookie-notice` — which is exactly what a thumb would have
found. Raising the tour above it would be worse: that buries a notice about
cookies under an advert for the product. So they are sequenced, notice first,
and the sequencing needed the notice's state to move out of the component into
`CookieNoticeService` — ⚠️ reusing **the same storage key**, because a new one
would have re-shown the notice to everybody who had already dismissed it, a
migration hidden inside a refactor.

⚠️ **Escape did nothing.** It was bound as `(keydown.escape)` on the card, with
`tabindex="-1"` and nothing ever focusing the card — so the event had nowhere to
land. A modal that can only be left with a pointer is a trap, and on a phone the
card is the whole screen. It is bound on the document now, and focus moves into
the sheet on open, which a dialog should do regardless.

⚠️ **"Show me around again" broke its own promise.** Clearing the stamp also
cleared the local flag, so the tour opened instantly — on top of the button just
pressed and over the message saying "it will open on your next screen". The copy
was right; the code now keeps it.

⚠️ **The accessibility drive passed for the wrong reason.** It audits sixteen
portal pages, and the walkthrough is a modal over all of them — so the heading
order and contrast it measured would have been the modal's, with the screen
underneath unchecked and the run still green. It passed today only because it
never dismisses the cookie notice, which holds the tour back: luck, not design.
It now marks its accounts as shown round explicitly.

**And the stale-binary trap caught me again.** `/auth/me` was returning no
`walkthroughSeenAt` for two drive runs because the API was serving a `dist`
built before the change, and a `kill` that reported success had not taken — the
old process still held port 3000. CLAUDE.md lists this; checking `dist/` for the
compiled symbol and the process list for the PID is what found it.

### Gaps

| Gap | Severity |
|---|---|
| The detail view is the old yard screen scoped by a route parameter, so it carries rent, expenses, lease documents and notes as well as the property's own details. That is the right content for the screen, but it is a 900-line component doing several jobs | Medium — a split is 7d territory |
| The card's photo is borrowed from the first room at the address that has one. A property with no photographed rooms shows an icon. A real property photo would be a second upload flow and a second thing to delete under POPIA | Low, by choice |
| `Property.addressLine` is not validated or geocoded — it is a note to self. Nothing matches it against the room's `locationDisplay`, so a landlord can type an address in one place and a suburb in another and the two can disagree | Low |
| A landlord with two properties in the same suburb still sees two identical "where" lines unless they filled the address in. The address is the fix and it is optional, so the ambiguity is theirs to resolve | Low |


### 5.25 Pausing an account, and ending one — ✅ built in v1.92.0 (Phase 7g)

Item 3 of the UX brief: *"Account Deactivation/Deletion."* Two different things,
built as two different things.

**The question that had to be answered before any code.** `DELETE FROM users`
looks like the implementation. The foreign keys say otherwise — read out of
postgres rather than guessed:

| Deleting a user row cascades into | Which belongs to |
|---|---|
| their `rooms` → other tenants' `applications`, `saved_rooms`, `reviews` | other people |
| `applications` → `messages` | **both sides of every conversation** |
| `tenancies` → `rent_periods` | the tenant's own proof of payment |
| `reviews.authorId` | the person who was reviewed, and everyone reading |
| `payments` | the accounting record |

So a landlord closing their account would have deleted their tenant's
application, the tenant's rent history, and both halves of the conversation
between them. POPIA s.24 is a right to have **your** personal information
deleted — not somebody else's, and not a right to destroy a record two parties
share.

**The mechanism is a tombstone.** The row stays; the person is erased. Name
becomes `Former member`, email becomes `deleted-<id>@deleted.mastande.invalid`
(a reserved TLD that can never reach anybody), password hash, phone, photo,
verification outcomes, notices and sessions all go, the avatar goes through the
existing `file_deletions` queue rather than merely being unlinked, and the whole
thing is one `$transaction` so the queue row commits with the erasure.

| Decision | Why |
|---|---|
| Pausing does **not** reuse `isActive` | `isActive` is the admin suspension, refused on every sign-in path with "contact support". Reusing it would have looked like one line of work and shipped an account nobody could ever reopen. `deactivatedAt` is separate, and signing in still works — that is the only way back |
| …which forced one shared visibility rule | Because `isActive` stays **true** while paused, every existing `user: { isActive: true }` filter would have kept a paused landlord's public page lit. `PUBLIC_USER` / `SIGN_IN_USER` in `common/prisma/account-visibility.ts`, applied in six places. A pause that leaves the shop window on is not a pause |
| Waking up does **not** republish the rooms | One may have been let while the account slept. Advertising a taken room to people who then apply for it is worse than making the landlord press publish — so it reports how many are waiting instead of silently omitting them |
| The screen is its own route, reached by a **link** from settings | An irreversible control should not be one scroll below "change your name". The drive asserts both halves: the link exists, and the destructive button is **not** on the settings screen |
| The preview is counted from the person's own rows | A landlord with a live tenancy is told something different from a tenant who applied for one room. A generic warning is a warning about nothing |
| Each kept item carries its own `why` | Driven structurally, not by phrase: one explained bullet and three bare labels reads as an explanation and is not one |
| Three things to close it: password, the typed word `DELETE`, an **unticked** box | `@Equals(true)` on the acknowledgement, because a checkbox whose binding never fired ships as *absent*, not false |
| Ten attempts per fifteen minutes, not five | The form's four honest refusals plus one correct attempt is exactly five. A limit that stops the owner before it stops an attacker is the wrong limit |
| The screen clears the device's saved rooms itself, and says so | They are in `localStorage` (see Outstanding §14). Without it, somebody who closed their account would hand the next person to pick up the phone the list of rooms they had been looking at |

**🔴 The defect this phase found, and it was not on this screen.** The step-up
checks answered **401**. The frontend's `errorInterceptor` reads a 401 on any
non-auth endpoint as an expired access token: refresh silently, retry once. The
retry re-sent the same wrong password, got 401 again, and a second failure means
what it says — *"Your session has expired"*, session cleared, login page.

So typing your own password wrong signed you out. And it had been true of
`/account/settings` since that screen shipped: both its forms have an inline
`.field-error` written for a message that could never render, because the
component was gone before it had the chance. Observed in a browser:

```
URL AFTER WRONG CURRENT PASSWORD: /auth/login?returnUrl=%2Faccount%2Fsettings
inline .field-error: []
says session expired: true
```

Now **403** — the request was authenticated; the password typed into the form is
what was refused — plus an `INLINE_ERRORS` HttpContext token so a form that
shows the message itself does not also get a modal over it. The fix is driven on
both screens: section 4 of the account drive for the new one, section 7 for the
settings forms where it had actually shipped.

⚠️ **The smoke suite had a check here and it could not fail.** One line asserted
401 for a wrong current password; another asserted 401 for no auth at all. Both
were 401, so the suite could not distinguish "the password you typed is wrong"
from "you are not signed in" — exactly what the browser could not distinguish.
403 and 401 now, and the pair is the check.

**🔴 And a 34px button, on a screen built this phase.** "Pause my account" and
"Use my account again" measured **34px** at all four widths — under the 44px
target of WCAG 2.5.8 — because the base `.btn` sets padding and `line-height: 1`
and no `min-height`. Fixed here; measured across the public pages and recorded
in Outstanding §13, where it is 13 of 23 visible buttons and as low as 32px.

⚠️ How that was found is the part worth keeping: the **previous** version of the
drive computed the smallest control height, the pause button included, and then
**never asserted it**. The number was measured and thrown away. Same family as a
`MAX_ATTEMPTS` nothing reads.

### What the drives prove

`scripts/account-lifecycle-drive.mjs` — 48 checks. Falsified by replacing the
tombstone with `tx.user.delete()`, which produced **14 failures** naming every
piece of cascade damage: the tenant's application, both sides of the
conversation, the tenancy, the rent history, another tenant's saved room, the
review the person wrote, and the thread 404ing for the tenant.

`scripts/account-lifecycle-ui-drive.mjs` — 51 checks across four widths.
Falsified by putting `UnauthorizedException` back at both step-up sites, which
failed 7 checks and named both screens.

### Gaps

| Gap | Severity |
|---|---|
| A phone-only account has no password, so it cannot close itself from this screen. It is told to set a password first or ask through notices, rather than being offered a weaker confirmation — but "ask us" is a manual process with no admin screen behind it yet | Medium — and item "Admin Cannot Delete User Accounts" in the brief is where it lands |
| Nothing emails a confirmation after closure. The address is erased in the same transaction, so there is nowhere to send it — arguably correct, but it means the only record a person has is the screen they were on | Low, by choice |
| `deletedAt` is set and the row kept forever. Nothing prunes tombstones, because the shared rows they anchor are kept forever too | Low — but it is a POPIA retention question somebody will eventually ask |
| Deactivation does not withdraw applications already sent. Said plainly on screen, because withdrawing cannot be undone and pausing should not do it silently | Low, by choice |


### 5.26 The controls a landlord presses — ✅ fixed in v1.93.0 (Phase 7h)

Brief items 18–22 and 25. They read like styling niceties. Every one of them was
a control that looked like a control, and none was visible to any other gate in
the repository, because each is a question about the **rendered box**.

**Item 18 — the wizard's Back, Cancel and Next.** Measured at 360px: three
**identical solid terra buttons, 33px tall, 6px apart**, one of which abandons
the form. Cancel carried `class="btn btn-ghost-light"` — a real global class,
written to make it a bordered secondary button — and it had **never had any
effect**: a component's own bare `button { background: var(--terra) }` rule
outranks any single global class, because Angular's emulated encapsulation
appends an attribute selector (`button[_ngcontent-x]` = 0,1,1 beats
`.btn-ghost-light` = 0,1,0). The file's own styles block already carried a
comment recording that exact trap, for labels, three lines above the button rule
that was still doing it.

Removing that rule fixed three things at once, each measured before and after:

| | Before | After |
|---|---|---|
| Cancel vs Next | both `rgb(173,66,34)`, 33px | outlined vs solid, 44px |
| The property picker Phase 7b built | solid terra blocks, `border-width: 0`, the dashed "somewhere new" card's dash invisible | white cards, 1px border, dashed where designed |
| Choosing a property | `rgb(142,53,25)` — the `.is-chosen` 6% tint over solid terra, a shade nobody would notice | border goes `rgb(224,213,196)` → `rgb(173,66,34)` |

⚠️ **And it took the `:disabled` styling with it**, because there was none on
`.btn` anywhere in the app — each screen that cared wrote its own. The wizard's
"Next" is disabled until the description reaches 50 characters, so a disabled
primary that looks live is a button somebody taps while nothing happens. Now
global, and driven.

**🔴 Sideways scroll, and the element that got blamed for it.** At 360px the
wizard's step 2 pushed the page 26px wider than the viewport, and the visibly
too-wide element was `nav.portal-nav` at 386px. It was not the cause; it was
the only thing wide enough to notice. Found by hiding each child of the step in
turn and watching which one released the overflow:

1. `fieldset.prop-picker` — a fieldset's default `min-width` is `min-content`
   and it will not shrink below it, a quirk no other element has.
2. `main.portal-main` is a **grid item**, so its `min-width: auto` is its
   min-content width, and a grid **track** is sized by its widest item. One
   screen wanting 354px therefore made the track 386px and stretched the nav
   to match.

Both needed fixing: either alone left the other able to widen the page. `fieldset
{ min-width: 0 }` and `.portal-main { min-width: 0 }`, each with the measurement
in a comment beside it — without the second, every portal screen is one wide
element away from the same bug, and the nav gets blamed again.

**Item 25 — Accept beside Reject.** The applicant action row measured **25–27px
tall, 8px apart**, on the landlord's most consequential screen. 44px and 10px
now. (A size fix rather than a redesign: the decision is reversible for 30
minutes, which the card says.) Its media query was also `max-width: 400px`,
which is not one of this codebase's three breakpoints — at 430px, an iPhone 14
Pro Max, the mobile layout did not apply at all. 480px now.

**🔴 And the applicant card could only be opened with a pointer.** The header
was a `<div>` with a `(click)` handler and no `role`, `tabindex` or key handler,
so a landlord on a keyboard could reach **no** applicant's details, references,
Accept or Reject. Phase 7c fixed exactly this on the unified inbox, for exactly
this reason; this older per-room screen kept the div, and Phase 7e then put the
screen in the nav. It is a real `<button>` with `aria-expanded` and
`aria-controls` now, and the drive opens it with Enter rather than asserting
that it is focusable — a div with `tabindex` is reachable and still silent.

**Item 19 — the add-a-property buttons** were 34px at all four widths. The third
screen in one sitting to need the same local patch, which is what prompted the
global fix (Outstanding §13): `.btn` is 44px app-wide now, and `.link-btn`,
which is not `.btn` and set `padding: 0` on a `.82rem` font, went from **17px**
to 44px. That class carries "Remove" on each expense, which deletes the record.

**Item 20 — the grouped property card.** Measured at all four widths and found
**sound**: 94–114px tall, 167–815px of room for the name and address beside the
96px photo, nothing spilling, no overflow. No change made. Recorded because a
redesign nobody needed is worse than none, and the measurements are in the drive
so the next person can disagree with evidence.

**Item 21 — the save that said nothing.** Saving the shared facilities set
`editing` to null and reloaded, so the form vanished and **nothing** confirmed
it. The failure path had an inline error; the success path had no feedback at
all, while the create-room wizard already had a "Changes saved" panel for the
same job. Now a `role="status"` line where the form was, which **names the
property** — this screen lists several and a bare "Saved" over a list of four
says nothing about which — held until the landlord next opens an edit form
rather than cleared on a timer, because a confirmation that disappears by itself
is one a slow reader never sees. The drive asserts the message, its role, the
name, **and** that the house rules really are on the row, because a confirmation
alone does not prove a save.

**🔴 Item 22 — the money-spent section had no stylesheet.** Not a thin one:
`.yard-shared-form`, `.yard-shared-form__actions`, `.yard-expenses`,
`.expense-list`, `.expense`, `.expense__main`, `.expense-form` and
`.expense-form__actions` had **no rules anywhere in the product**. Measured in
the browser: the receipts rendered `display: list-item` with
`list-style-type: disc`, and the actions row `display: block` with the Add
button and the CSV link separated by a word space. The markup was written with
a stylesheet in mind and the stylesheet was never added. Written now, and the
disclosure gained `aria-expanded`/`aria-controls` so a screen reader is told it
reveals anything.

### What the drive proves

`scripts/layout-ui-drive.mjs` — 130 checks at 360/390/768/1280. Falsified twice:
restoring the wizard's bare `button` rule and the 28px applicant actions failed
24 checks; removing the expense stylesheet, the `.link-btn` tap area and the
saved confirmation failed 30, naming "Remove" at **20px**, the disclosure at
21px, the receipts as a disc list and the action buttons 0px apart.

⚠️ **Three faults in the drive itself, each of which reported something false:**
it waited for `.applicant-card__actions`, which only exists once the card is
opened, and threw a TimeoutError instead of reporting anything; it matched the
edit control with `/rules|facilities|edit/i` and reported "there is no way to
edit the shared facilities" about a screen with two such buttons; and it counted
a locator immediately after page load, before the data arrived, for the same
reason the close-account drive measured an empty kept-list last phase —
`count()` does not auto-wait. It also signed in twelve times a run against a
thirty-per-fifteen-minutes limiter, so two runs read as an auth bug; four now.

⚠️ **A pre-existing flake fixed rather than lived with.** `dashboard-ui-drive`
read `#money .stat-box` as soon as `#money` rendered, and the figures arrive one
request later — so about one run in four it reported "property A's rent marked
paid is R0 — expected its own 3000, not the portfolio's 7500", a scoping bug
about a screen that was right and merely unfinished. It polls until two reads
agree now; a figure that really is 0 still fails. One unexplained failure was
seen immediately after an API restart and did not reproduce in nine subsequent
runs, which is recorded rather than called clean.

⚠️ **Backticks in a CSS comment inside a `styles` block closed the template
literal — twice in this phase**, making it the third and fourth time in this
codebase. CLAUDE.md names it; it is now named again in both comments that
caused it.

### Gaps

| Gap | Severity |
|---|---|
| The grouped-card layout was measured and left alone. If the complaint behind item 20 was aesthetic rather than dimensional, it is unaddressed — the measurements say the card is not broken, not that it is handsome | Low, and deliberate |
| `.link-btn` is now a 44px inline-flex box in all 21 places it is used. All of them are standalone controls today; the first one dropped inside a sentence will take a 44px line box with it | Low — a `.link-btn--inline` variant is the fix when it happens |
| The expenses form is `repeat(auto-fit, minmax(11rem, 1fr))`, so at 1280px inside a wide property card it is two columns with the note field in whichever cell it lands. It reads fine and it is not a designed grid | Low |
| Nothing drives the admin screens' button sizes — the a11y drive skips them without `ADMIN_EMAIL`/`ADMIN_PASSWORD`, so the global 44px change is unverified there | Medium — it is the same global rule, but "unverified" is the honest word |


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
| `dashboard-drive.mjs` | that "viewed 47 times this week" has data under it and counts the right things, that the task buttons point somewhere that exists, and the tenant task list — including what it deliberately leaves out |
| `onboarding-drive.mjs` | that the social card's image is a real 1200×630 file reached by a URL that works, that the fallback falls back and the unverifiable dimensions are NOT claimed, and that the walkthrough appears once per ACCOUNT, is role-appropriate, waits for the cookie notice, and can be left with Escape at 360px |
| `nav-ui-drive.mjs` | that the portal sidebar is on every guarded screen and the same size on all of them, that the mobile header keeps both visitor CTAs at 360/390/430px with a 44px target, that the footer offers a visitor nothing it cannot open, and that nothing scrolls sideways at three widths |
| `dashboard-ui-drive.mjs` | that the task buttons ARRIVE (a click, not a string), that the numbers read as sentences with their window stated, that rent reminders is reachable at all, and that a landlord who never grouped anything can reach their own money |
| `messages-inbox-drive.mjs` | who a WhatsApp reply is actually from, that `readAt` is written by something, and that two new surfaces onto private conversations are scoped by the WHERE clause rather than by a guard |
| `messages-inbox-ui-drive.mjs` | that both navs lead somewhere, that the screen says which channel a reply leaves by, that a closed thread offers no box to type in, and that a failed request does not read as an empty inbox |
| `a11y-drive.mjs` | 25 pages with CONTENT on them: heading order, accessible names, contrast at rest, on hover and on focus. It seeds a room, an application and a message first — before that it audited every portal screen empty and reported it green |
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
  cannot see, it says so in its own header. Phase 7c went further and **seeded
  the portal run**, because the same fault applied to every landlord and tenant
  screen it visited: the first run with rows on the page found a row of text
  rendering white-on-cream at 1.06:1.
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
