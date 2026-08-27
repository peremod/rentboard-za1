# Flow & State Audit — RentBoard ZA

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
| active → reserved | `POST /rooms/:id/reserve` | ⚠️ **endpoint exists, no UI, no semantics** — see gap R1 |
| active/reserved → let | `POST /rooms/:id/let` | ✅ verified — closes and notifies open applicants |
| let → active | `POST /rooms/:id/undo-let` | ✅ verified (30-minute window) |
| let/paused → active | `POST /rooms/:id/relist` | ✅ verified — archives the old cycle, increments `relistCount` |
| any → paused | *none* | ❌ **gap R2** — `paused` is accepted by relist but nothing sets it |
| any → deleted | *none* | ❌ **gap R3** — the `deleted` status is never used; drafts are hard-deleted instead |

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
| Saved room is let → tenant told | ❌ **gap X1** — a saved room silently becomes unavailable |
| Landlord verified → badge appears | ✅ end to end (v1.8.1): landlord submits at /landlord/verification, admin reviews at /admin/verifications, approval sets idVerified and the badge appears |

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

## 5. What "verified" means here

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
