# Tenancy lifecycle — architecture audit

**Status: audit only. No application code changed in this pass.**

Read with `docs/FLOW-AUDIT.md` (per-screen gaps) and `docs/OUTSTANDING.md`
(carried debt). This document is the *system* view those two deliberately do
not take.

Every claim below names the file and line it rests on. Where something could
not be proven in this container, it says so by name.

---

## A. Current architecture — what actually handles tenancy state

There is one owner of the state, and it is correct.

| Concern | Owner | Verdict |
|---|---|---|
| The state itself | `Tenancy.status` (`TenancyStatus`), `backend/prisma/schema.prisma:757` | Sound |
| Transitions | `TenanciesService.confirmStart` / `cancel` / `end`, `backend/src/modules/tenancies/tenancies.service.ts:72,89,107` | Sound, guarded |
| Creation | `TenanciesService.createFromApplication:27` — idempotent on `applicationId` | Sound |
| Lease terms, notice | `LeaseService`, `backend/src/modules/tenancies/lease.service.ts` | Sound, but landlord-only (see C7) |
| Rent | `RentService`, `backend/src/modules/properties/rent.service.ts` | Does not read the state (C2) |
| Reviews | `ReviewsService` + `reviews.release.ts` cron | Sound |
| Disputes | `TenancyFlag` + `tenancy-flags.service.ts` | Sound |
| Frontend state | `TenanciesService` signal store, 4 consumers | Thin (see E) |

**The transition layer is not the problem.** `confirmStart`, `cancel` and `end`
each refuse an illegal source state with a sentence a person can act on, set
every field the transition implies in one update, and log it. `end()` opens the
review window in the same write. That is better than most of this codebase.

**The problem is that almost nothing downstream reads the result.** The state
is recorded correctly and then consulted by four frontend files and two backend
queries. Everything else in the product is keyed off `Room.status`,
`Application.status`, or nothing at all.

### The structural reason

`Application.status` and `Tenancy.status` are **parallel, independently
mutating state machines over the same real-world event**, and nothing
reconciles them.

```
Application:  pending → viewed → shortlisted → accepted ──────────► stays `accepted` forever
                                                   │
                                                   ▼
Tenancy:                                        pending → active → ended
```

An `Application` is `accepted` from the moment a landlord says yes until the
row is deleted. It does not change when the tenant moves in, and it does not
change when the tenant moves out. `Tenancy.status` carries all of that. So any
screen reading `Application.status` alone is reading a value that was true
once and has not been true for a year.

That single fact generates most of section C.

---

## B. The actual lifecycle, as the code implements it

Not the states in the brief — the states in the enums.

### Room (`RoomStatus`, schema:40)

```
draft ──publish──► active ──accept/markLet──► let ──relist──► active (relistCount++)
                     │  ▲                       │
                  pause│  │unpause              └──undo (≤ N min)──► active
                     ▼  │
                   paused
                     │
                  deleted ──relist──► active
```

`reserved` is in the enum and is read by the landlord dashboard
(`landlord-dashboard.ts:562`) and the status-dot CSS, but **nothing ever writes
it**. `grep -rn "'reserved'" backend/src` returns only reads. It is a sixth
state the product cannot enter.

### Application (`ApplicationStatus`, schema:497)

```
pending → viewed → shortlisted → accepted
   │         │          │            │
   └─────────┴──────────┴──► rejected / withdrawn
```

Orthogonal to status: `archivedAt` (set only by relist/let, not by tenancy
end) and `cycle` (the room's `relistCount` at apply time).

### Tenancy (`TenancyStatus`, schema:757)

```
                  ┌──cancel──► cancelled   (never produces reviews)
                  │
accept ──► pending ──confirmStart──► active ──end──► ended
                                       │                │
                            giveNotice │                └─► reviewsCloseAt = +30d
                            (sets noticeGivenAt only;      (reviews.release cron publishes)
                             does NOT end anything)
```

**`ended` is terminal and there is nothing after it.** No `archived` state, no
archival timestamp beyond `endDate`, no distinction between "ended last week,
reviews open" and "ended in 2024". The review window is the only thing that
ages, and it ages on `reviewsCloseAt`, not on the tenancy.

### What `end()` actually writes (`tenancies.service.ts:118–128`)

```
status = 'ended'
endDate, endedById, endReason
reviewsCloseAt = now + 30 days
```

**That is the entire effect of a tenancy ending.** Four columns on one row.

It does not touch the Room. It does not touch the Application. It writes no
`Notice`. It does not close the rent record. It does not prompt a relist. Every
consequence in sections 1–4 of the request is a consequence this transition
does not have.

---

## C. State-transition problems

Ordered by how wrong the screen is, not by how hard the fix is.

### C1 — An ended tenancy reappears as a live application *waiting on the tenant*

`frontend/src/app/features/tenant/dashboard/tenant-dashboard.ts:613`

```ts
activeApplications() {
  return this.applications().filter(
    (a) => !a.isArchived && a.status !== 'withdrawn' && a.status !== 'rejected'
      && a.tenancy?.status !== 'active',
  );
}
```

The filter excludes `active`. It does not exclude `ended` or `cancelled`.

So when a tenancy ends:
- `tenancy.status` becomes `'ended'`, which satisfies `!== 'active'`
- `Application.status` is still `'accepted'`
- `archivedAt` is still null (nothing archived it — see C3), so `isArchived` is false

The row falls straight back into **"Your applications"**. And
`activeApplicationsNote():634` counts `accepted` as *yours*:

> "The landlord has moved on this one — it is waiting on you."

A tenant who moved out six months ago is told their old room is waiting on
them. `currentHomes():621` correctly requires `'active'`, so the room
simultaneously vanishes from "Where you live now". **Moving out moves the room
backwards through the tenant's own dashboard.**

This is the same class of defect the comment three lines above it was written
to fix — the fix covered `active` and stopped there.

### C2 — The rent screen renders an ended tenancy as an active one

`frontend/src/app/features/tenant/rent/rent.ts:189`

```ts
const live = list.filter(
  (t) => t.status === 'active' || t.status === 'ended' || t.status === 'pending',
);
```

Three states, one loop, no branch on which. An ended tenancy gets:

- the same `<h2>` as a current room, with **`{{ t.rentCents | zarCents }}/mo`** — present tense, for rent nobody owes
- the full month list with no end marker
- **the "I've paid this" dispute button, live.** `canDispute():213` checks
  `p.status !== 'paid' && !p.tenantDisputedAt` and never looks at the tenancy
- the `insight-banner` reading "This is what your landlord has recorded… if a
  month is wrong, say so here"
- `<app-lease-documents>` presented as current paperwork

Nothing on the screen says the tenancy is over. This is the user's report,
and the architecture is the cause: one component is the *only* representation
of rent, so it has to be both things.

The backend is no better. `RentService.mark():65` blocks `cancelled` and
**not `ended`** — a landlord can mark rent on a tenancy that finished in 2024,
and `upsert` will create the month. `RentService.history():122` returns periods
with no tenancy status in the payload at all, so the frontend *cannot* know
without a second call.

`dispute():103` has the same hole: no status check, so a dispute can be filed
against an ended tenancy and `reminderSentAt` stamped on it.

### C3 — Ending a tenancy does not free the room

`end()` does not touch `Room`. So:

- the room stays `let` indefinitely
- it is invisible on the public board (`rooms.service.ts:143` filters `status: 'active'`) and absent from the sitemap (`seo.controller.ts:128`)
- the landlord must find "relist" themselves, with nothing telling them to
- `applications.service.ts:145` has a `closureReason` branch reading **"This tenancy ended and the room has been relisted."** — reachable only when `archivedAt` is set, which only a relist does. The string describes a transition the system does not perform.

`calendar.service.ts:125` emits a `room_free` notice — but from
`LeaseService.upcoming()`'s horizon logic, which selects
`status: { in: ['pending','active'] }`. It fires **before** a known end date.
Once the tenancy is actually `ended`, it no longer matches, so there is no
notice at the moment the room genuinely becomes free.

### C4 — The biggest event in the lifecycle notifies nobody

32 distinct `Notice.kind` values exist across the backend. There is no
`tenancy_started`, no `tenancy_ended`, no `review_window_closing`, no
`room_needs_relisting`.

Verified: `grep -rno "kind: '[a-z_]*'" backend/src | sort -u` — 32 kinds, none
of them a tenancy beginning or ending.

`confirmStart` and `end` log to the server console and write nothing a user can
read. A tenant who moves out learns about their review window only by opening
the dashboard and noticing `<app-review-prompt>`.

### C5 — The landlord side has the opposite bug: history is simply gone

`backend/src/modules/properties/properties.service.ts:221`

```ts
tenancies: { where: { status: { in: ['pending', 'active'] } }, ... }
```

Correct for "who lives here now" — and it is the **only** place a landlord can
see a tenancy. There is no past-tenant list anywhere in the product.
`grep -rni "past tenan|former tenan|tenancy histor|archived tenanc"` across
`backend/src` and `frontend/src` returns **zero** matches outside review copy
and the PAIA manual.

So the moment a tenancy ends, a landlord loses: who lived there, when, what
they paid, the rent record, the lease documents, the notes. The rows all still
exist. Nothing renders them.

Worth noting: `frontend/src/app/features/legal/paia/paia.ts:82` lists
"tenancy history and rent records" among the personal information this
platform holds. That is accurate about the database and there is no screen
behind it.

### C6 — The frontend reads tenancy state in four files, and the landlord portal is not one of them

Exhaustive (`grep -rn "tenancy?.status\|t.status ===" frontend/src/app`):

| File | Reads |
|---|---|
| `shared/components/tenancy-lifecycle/tenancy-lifecycle.ts:176` | `pending`, `active` |
| `shared/components/dispute-panel/dispute-panel.ts:161` | `ended` |
| `features/tenant/rent/rent.ts:189` | all three, undifferentiated (C2) |
| `features/tenant/dashboard/tenant-dashboard.ts:615,621` | `active` only (C1) |

`landlord-dashboard.ts` reads `Room.status` and never `Tenancy.status`. The
landlord's dashboard has no concept of a tenancy at all.

### C7 — A tenant cannot give notice

`tenancies.controller.ts:59` is documented
`@ApiOperation({ summary: 'Record that notice was given, by either side' })`.

`LeaseService.giveNotice():116` calls `assertLandlordOwns():47`, which throws
`ForbiddenException` unless `tenancy.landlordId === userId`.

`GiveNoticeDto.givenBy: 'tenant'` lets a **landlord record** that the tenant
gave notice. The tenant has no route. The documented capability is refused by
the code that documents it.

Consequence: `tenant-inbox.service.ts:361` emits a `notice_given` notice, so a
tenant can be *told* notice was given on their home and has no way to give it.

### C8 — Notice elapsing does nothing

`noticeGivenAt + noticePeriodDays` is computed for display in
`LeaseService.upcoming():169` and nowhere else. No job watches it. A tenancy
under notice whose period expired six months ago is still `active`, still
generating rent reminders (`rent.service.ts:188` selects
`tenancy: { status: 'active' }`), still occupying the room.

`upcoming()` marks it `overdue: true` with the comment "an overdue relist is
the urgent one" — correct, and it is a landlord-only screen with no escalation
behind it.

### C9 — The existing drive proves the column changed and nothing else

`scripts/tenancy-lifecycle-drive.mjs:193`

```js
check(status === 'ended', `…ending it records 'ended' (got '${status}')`);
```

48 checks. One mention of `ended`. Nothing about the room, the application, the
rent screen, the dashboard, a notice, or an archive. By this repo's own
standard — *"change it, drive it, then reintroduce the bug and confirm the
check fails"* — **every defect C1 through C8 is invisible to it.** A check that
cannot fail is not a check.

---

## D. Data model problems

The model is in better shape than the UI. Most of what the request asks for is
already correctly scoped.

### Already correct — do not change

| Record | Scoping | Note |
|---|---|---|
| `RentPeriod` | `tenancyId` + unique `[tenancyId, periodStart]` | schema:1901. Snapshots `amountCents` so August keeps saying what August cost |
| `Review` | `tenancyId` + unique `[tenancyId, authorId, type]` | schema:781 |
| `TenancyFlag` | `tenancyId` | schema:1709 |
| `LeaseDocument` | `tenancyId` | schema:2855 |
| `Tenancy.rentCents` | snapshot, not a reference | schema:735 — deliberate, correct |
| `Message` | `applicationId`, and `Tenancy.applicationId` is `@unique` | Transitively tenancy-scoped. Fine |
| `RoomViewing` | `applicationId` | Same. Fine |

**The "Tenancy #1 / #2 / #3 must not mix" requirement is already met** for
rent, reviews, disputes and lease documents. Three tenancies for one tenant
cannot bleed into each other, because every one of those tables keys on
`tenancyId`, not on the landlord–tenant pair.

### D1 — `Report` has no `tenancyId` *(real gap)*

`schema:613`. A report carries `roomId` and/or `reportedUserId` and nothing
else. So "problems reported during this tenancy" cannot be answered: a report
filed by tenant A about room X is indistinguishable from one filed by tenant B
about room X two tenancies later.

`ReportReason` makes it concrete — `already_let`, `upfront_payment_demanded`,
`room_not_as_described` are all tenancy-period claims filed against a room.

Needs a **nullable** `tenancyId`. Nullable is not laziness: `reporterId` is
already nullable for signed-out visitors, and most reports come from people
with no tenancy at all. Backfill is possible but lossy and should not be
attempted — infer nothing; leave historical rows null and say so on screen.

### D2 — No archival state, and `ended` is doing two jobs

`ended` means both "finished last week, reviews open, both parties still acting
on it" and "finished in 2024, closed, read-only". Those want different UI and
different permissions, and today they are one value.

Two candidate shapes:

1. **Derive it.** `reviewsCloseAt < now()` ⇒ archived. Needs no migration, and
   every consumer has to re-derive it identically — which this codebase has a
   documented history of getting wrong in exactly that situation (see the
   `landlordNav` comment on three nav definitions that disagreed).
2. **Store it.** `Tenancy.archivedAt DateTime?`, set by the cron that already
   runs for review release (`reviews.release.ts`). One value, one writer, every
   consumer reads the same thing.

**Recommendation: (2).** The cron exists, it already wakes on `reviewsCloseAt`,
and the repo's own history argues against derived state with many readers. Do
*not* add a fifth `TenancyStatus` value — `archived` is orthogonal to how a
tenancy ended, and folding it in would make `cancelled → archived` lose the
reason it was cancelled.

### D3 — `Room.reserved` — ⚠️ **this section was wrong, corrected in Phase C**

**What it said:** "Read in two places, written nowhere… an unreachable state."

**What is actually true:** `reserved` *is* written —
`RoomsService.markReserved` (`rooms.service.ts:533`) sets it, behind
`POST /rooms/:id/reserve`, with `unreserve` to undo. I grepped for the string
`'reserved'`, read the matches as reads, and missed the write two lines into
one of them. The conclusion was wrong and the recommendation that followed it
("wire it or delete it") was answering a question that was not open.

**The real defect is one layer up, and it is the audit's own through-line:** a
complete feature with no way in. Built and working:

| | |
|---|---|
| `POST /rooms/:id/reserve`, `/unreserve` | work |
| `applications.service.ts:43` | a tailored refusal — "reserved for another tenant while they finalise. It may become available again" |
| `room-card.ts:59` | renders a **Reserved** badge |
| `landlord-inbox.service.ts:419`, `properties.service.ts:249` | count it as occupied |
| `admin.service.ts:449,467`, `account-lifecycle.service.ts:76` | count it as live |
| `rooms.service.ts:572,659,763` | pause, let and the working-on list all handle it |
| **a button anywhere in the portal** | **none** |

So the status dot does have a colour nobody ever sees — but because no screen
can set the status, not because nothing can.

The frontend service had carried **two** methods for that one endpoint,
`markReserved` and `reserve`, identical but for the name. That is what happens
to code nobody calls: neither copy was ever wrong, because neither was ever
used. `markReserved` is deleted; the gap is recorded as `OUTSTANDING` §34.

**Still not done:** the one screen it needs. Deliberately not built in Phase C —
a landlord control belongs with the rest of the landlord side in Phase E, and
inventing it here would be the scope creep this plan exists to avoid.

### D4 — `Notice` has no tenancy link

`schema:2987`. Free-text `kind` and an in-app `link`. A notice about a tenancy
that has since ended still links into a live-looking screen. Lower priority
than D1 — a notice is an event log entry, and dating it is arguably enough —
but worth a nullable `tenancyId` if the archive view is to show a lifecycle
timeline.

### D5 — Nothing to change for history preservation

Worth stating plainly, because the request assumes otherwise: **no migration is
needed to stop losing historical data, because none is being lost.** Every
tenancy-scoped table keys on `tenancyId` and nothing cascades on a status
change. `onDelete: Cascade` fires on row deletion, and `end()` deletes nothing.

The data is all there. **The product just has no screen that reads it.** That
reframes the whole task from a migration problem to a read-path problem, which
is a much smaller and much safer change.

---

## E. Component dependency matrix

`✅` reacts correctly · `⚠️` reacts, wrongly · `❌` does not react · `—` not applicable

| Component | Active | Notice given | Ended (reviews open) | Archived | New tenancy on same room |
|---|---|---|---|---|---|
| Tenant rent screen | ✅ | ❌ no sign of it | ⚠️ **renders as active** | ⚠️ identical to active | ✅ separate `tenancyId` |
| Tenant dashboard — Where you live | ✅ | ❌ | ✅ drops out | ✅ | ✅ |
| Tenant dashboard — Your applications | ✅ excluded | ❌ | ⚠️ **reappears as "waiting on you"** | ⚠️ same | ⚠️ both rows show |
| `tenancy-lifecycle` panel | ✅ | ❌ no notice UI | ✅ hidden | ✅ hidden | ✅ |
| `dispute-panel` | — | — | ✅ reads `ended` | ⚠️ no window check | ✅ |
| `review-prompt` | — | — | ✅ `reviewsCloseAt` | ✅ closes | ✅ |
| Landlord dashboard | ❌ reads `Room` only | ❌ | ❌ | ❌ | ❌ |
| Landlord `needs-attention` inbox | ✅ | ✅ `lease_ending` | ❌ | ❌ | ✅ |
| Landlord calendar | ✅ | ✅ `room_free` | ❌ fires only *before* | ❌ | ✅ |
| Property detail (yard) | ✅ | ✅ | ❌ **tenancy disappears** | ❌ gone | ✅ |
| Rent backend `mark()` | ✅ | — | ❌ **still writable** | ❌ writable | ✅ |
| Rent backend `dispute()` | ✅ | — | ❌ **still writable** | ❌ writable | ✅ |
| Rent reminder cron | ✅ `active` only | ⚠️ keeps reminding | ✅ excluded | ✅ | ✅ |
| Room availability | ⚠️ `let` | ❌ | ❌ **stays `let` forever** | ❌ | ✅ on relist |
| Applications list (landlord) | ✅ cycle-scoped | — | ❌ stays `accepted` | ❌ | ✅ |
| Viewings | ✅ | — | — | — | ✅ |
| Messages | ✅ | — | ❌ thread stays open | ❌ | ✅ per application |
| Lease documents | ✅ | — | ⚠️ presented as current | ⚠️ | ✅ |
| Notices | ✅ | ✅ | ❌ none emitted | ❌ | ✅ |
| Reports / problems | ⚠️ | — | ❌ **not tenancy-scoped** (D1) | ❌ | ⚠️ indistinguishable |
| Tenant notes (landlord) | ✅ | — | ❌ | ❌ | ✅ |
| Analytics | — | — | ❌ no tenancy metrics | ❌ | — |
| Admin portal | — | — | ❌ no tenancy view | ❌ | — |
| Navigation | — | — | ❌ no archive route | ❌ | — |
| Account closure | ✅ blocks on `pending`/`active` | ✅ | ✅ allows | ✅ | ✅ |

**Count: 14 components do not react to a tenancy ending. 6 react incorrectly.**

The one that does it best is `account-lifecycle.service.ts:124` — it blocks
account deletion on `status: { in: ['pending','active'] }` and permits it once
ended. That is the pattern the rest should follow.

---

## F. Historical data strategy

### The architecture question, answered

The request asks whether `Active Rent` and `Rent History` should be separate
concepts rather than one component doing both. **Yes — but not as two rent
components.** Splitting rent alone would fix the reported screen and leave the
same hole for reviews, documents, problems and notes, each of which has the
identical active/historical split.

The right seam is one level up: **a tenancy is the historical entity, and it
needs a view of its own.**

```
Active  →  /tenant/rent            — the current letting, actions live
           /landlord/properties/:id — the current letting, actions live

Archive →  /account/tenancies      — every tenancy either side has had, read-only
           /account/tenancies/:id  — one complete tenancy record
```

`/account/` rather than `/tenant/` or `/landlord/`, for the reason
`/account/messages` already lives there (see `landlord-nav.ts`): a person can
be a landlord of one room and a tenant of another, and their history is one
list. A sub-lessor is both by definition (Phase 6), so this is not a corner
case in this market.

### What the archive view renders

Everything already exists and is already correctly scoped (section D). The
record is assembled from:

| Section | Source | Permission |
|---|---|---|
| Room, dates, rent, how it ended | `Tenancy` + `room` | Both parties |
| Rent ledger, chronological | `RentPeriod[]` incl. disputes | Both parties |
| Reviews, both directions | `Review[]` where `publishedAt != null` | Both; tenant-type reviews stay non-public per schema:781 |
| Disputes | `TenancyFlag[]` | Both — raiser sees own; resolution visible to both |
| Lease documents | `LeaseDocument[]` | Both, read-only |
| Application + viewings | `Application` + `RoomViewing[]` | Both |
| Message thread | `Message[]` via `applicationId` | Both, read-only |
| Notes | `LandlordNote[]` | **Landlord only** — private by design, do not surface |
| Problems | `Report[]` | Blocked on D1 |

### Three rules the archive must hold

1. **Enforced server-side, not by hiding buttons** — and "read-only" is the
   wrong word, which Phase A established. Removing a button from an archived
   screen is never the fix; the API must refuse. But the archive is *not*
   inert: a tenant disputing the final month is a write that belongs there,
   and it is the single most consequential thing either party does after a
   move-out. So the rule is **bounded, not frozen**: `mark()` is bounded to
   the months the tenancy covered, `dispute()` is not bounded at all, and
   nothing else writes. What the archive must stop being is *present tense* —
   that is a presentation problem (Phase D), not a permissions one.
2. **It is a record, not a resurrection.** No "message your old landlord", no
   relist shortcut, no rent toggle. The permissions follow the facts: both
   parties were there, so both may read; neither may now change what happened.
3. **POPIA still applies.** Documents already follow the
   `VerificationRequest` retention pattern and only outcomes persist. The
   archive renders what is retained — it must not become a reason to retain
   more, and in particular must not display a document whose
   `documentDeletedAt` is set.

### Retention — open, and the owner's call

No retention period is defined for an ended tenancy. Rent records support
a landlord's own bookkeeping and a tenant's own reference; both argue for
years, not months. SARS keeps records for five. **That is a business and legal
decision, not an engineering one, and I am not making it here.** Flagged for
`docs/OUTSTANDING.md`.

---

## G. UX problems — why it feels generic

Measured, not opined. `node design-handoff/tools/tokens.mjs --md` produced
`design-handoff/TOKENS-CURRENT.md`; the figures below are from it.

### The palette is not the problem — and that matters

`frontend/src/styles/_variables.scss` defines cream `#FAF7F0`, terracotta
`#AD4222`, sage `#3D7040`, gold `#C8902A`, Playfair Display over DM Sans. That
is a distinctive, warm, specifically-not-SaaS system. **There is no purple, no
blue gradient and no white page background anywhere in the token file.**

So "it looks like generic AI SaaS" is not a brief to replace the palette. It is
evidence that **the palette is not reaching the screen.** Which is measurable:

| | Distinct values | Total uses |
|---|---:|---:|
| Tokens referenced as `var(--x)` | 33 | 671 |
| **Literal hex written inline, bypassing tokens** | **158** | **330** |

**One third of this product's colour is written outside its own design system.**

And the literals are not exotic:

- `#FFF` is written **52 times across 21 files** while `--white` exists
- `#DDD5C8` is used **19 times** and is **not** `--border` (`#E0D5C4`). ΔE 2.40 — invisible on a phone, two values to maintain, and the impostor is used more often than the token
- `#F2EDE3` ×11 **is exactly** `--cream2`. `#3A3228` ×10 is exactly `--ink2`. `#3D7040` ×8 is exactly `--sage`. The token's own value, retyped
- **106 of the 158 literals appear exactly once**
- 14 near-identical clusters by CIE Lab ΔE

The cause is structural: **53 components carry inline `styles:` blocks**, and
an inline block cannot see a SCSS variable. `tenancy-lifecycle.ts` is a clean
example — `#DDD5C8`, `#5A5047`, `#6B6055`, `#B23B3B` hardcoded, where
`$color-border`, `$color-ink-soft`, `$color-slate` and `$color-danger` all
exist and three of the four are *near misses* rather than matches.

**That is precisely the "assembled from different templates" feeling.** Every
component is 2 ΔE away from every other. Nothing is wrong enough to point at;
everything is slightly off; the whole reads as nobody's product.

### G2 — Spacing, radius and shadow have the same shape

`$sp-1…6` and `$r4/8/12/20` are defined. Component blocks use `.85rem`,
`.9rem`, `1.15rem`, `.82rem`, `.78rem`, `.72rem` — values on no scale. Radii
appear as bare `4px`, `6px`, `8px`. `.hint__close` used `6px`, which is in no
system.

### G3 — The logo cannot be placed on a light background, and exists twice

```
navbar.ts:27   <a class="nav-logo"    routerLink="/">Mas<span>tande</span></a>
footer.ts:15   <a class="footer-logo" routerLink="/">Mas<span>tande</span></a>
```

```scss
_spec.scss:93   .nav-logo    { color: var(--cream); }   // light text
_spec.scss:99   .nav-logo span    { color: var(--terra2); }
_spec.scss:651  .footer-logo { color: var(--cream); }
_spec.scss:655  .footer-logo span { color: var(--terra2); }
```

Four findings:

1. **There is no logo component.** Two copies of the markup, two copies of the
   rule. This repo's own `landlordNav` comment documents what happens next:
   six copies that disagreed.
2. **The split is `Mas` / `tande`, not `MA` / `stande`.** The request's
   constraint is that the **MA** portion holds its colour. Today "MA" is part
   of an unnamed span-less text node that simply inherits whatever `color` the
   class sets.
3. **The stem colour is `--cream`, which assumes a dark background.** Both
   current homes are dark (`--ink` header, `--ink` footer). Render the same
   markup on cream — an auth screen, a portal sidebar, a light modal — and
   "Mas" goes invisible while "tande" stays terracotta. The logo is one
   placement away from breaking, and nothing prevents that placement.
4. ~~**The portal shell has no wordmark at all.** `portal-shell.ts` contains no
   logo — a signed-in landlord never sees the brand.~~

   **⚠️ Wrong, corrected 11 October in Phase I.** `app.ts` renders
   `<app-navbar/>` above `<router-outlet/>`, so the global header — and its
   logo — is on every portal screen at every width. A signed-in landlord sees
   the brand on every page. I read `portal-shell.ts` and concluded from its
   absence there, without reading the component that wraps it.

   A wordmark was added to the sidebar and then removed: a second one puts the
   brand on screen twice, and below 900px that sidebar is a horizontally
   scrolling tab strip where `.portal-user` is already hidden for taking room
   from navigation that this repo fought to keep visible.

### G4 — Navigation: the two hard constraints are already met

Worth saying so rather than re-doing work.

- **Login and Get Started stay in the mobile header.** `navbar.ts:26` sets
  `[class.is-signed-in]` so CSS can distinguish a visitor from a signed-in
  user, and `_responsive.scss` hides ghost actions only for the signed-in case.
  A visitor keeps both buttons in the header at 360px; the drawer carries a
  second copy via one `ng-template` rendered twice, not duplicated markup.
- **The portal submenu is consistently available.** `landlordNav()` is a single
  definition in `landlord-nav.ts`, rendered by `portal-shell`, and the file's
  comment records the three disagreeing copies it replaced.

Remaining navigation gaps are information architecture, not visual:

- **Four of twelve landlord nav items are dashboard fragments**, not pages:
  Active listings, Drafts, Needs you. A sidebar where a third of the entries
  scroll the page you are on reads as more product than there is.
- **No archive destination exists** — nothing in either nav points at tenancy
  history, because there is nothing to point at (C5, F).
- `/landlord/yard` → `/landlord/properties` redirect is correct and should stay.

### G5 — Empty, loading and error states are per-component prose

No shared empty-state, skeleton or error-state component beyond
`skeleton-card`. Each screen writes its own `<p class="muted">Loading…</p>` and
its own empty copy. The copy is good — genuinely better than most — but there
is no system, so the twentieth screen will invent a twenty-first phrasing.

---

## H. Design direction

### The thesis

**Do not redesign the palette. Make the existing one reach the screen, then
push it harder than a SaaS template would dare.**

The tokens already describe something specific: a warm, printed, South African
letting board — cream paper, terracotta ink, a serif display face. Nothing
about that is generic. The product reads generic because 330 inline literals
sand the edges off it, every component is 2 ΔE from its neighbour, and the
distinctive moves (Playfair at weight 900, the terracotta accent bar, the
cream-on-ink header) survive only in the few places that were built from the
original spec.

### What to do

**1. Close the hole, with a check that can fail.**
`scripts/css-coverage-audit.mjs` already exists and proves this repo can fail a
build on CSS. Add a rule: no literal hex in a component `styles:` block where a
token within ΔE 3 exists. That is `design-handoff/tools/tokens.mjs`'s existing
clustering, inverted into a gate. Without it, any new design system inherits
the same hole on day one.

**2. Give components the tokens they cannot currently see.**
The 53 inline-styles components can't read SCSS variables. They *can* read CSS
custom properties — `--border`, `--ink2` and the rest already exist at
`:root`. The migration is mechanical and ΔE-ordered: start with `#DDD5C8` ×19
and `#FFF` ×52, which are 71 of the 330.

**3. Commit to three identity moves and use them everywhere.**
A distinctive product is usually three decisions applied without exception, not
twenty applied once. Candidates the tokens already support:

- **Playfair Display, heavy, for every number that matters** — rent, the rand
  figure, the count on a dashboard card. Numerals in a serif display face on a
  letting board is immediately not-SaaS, and `--font-display` is already loaded.
- **The terracotta rule, not the terracotta card.** A 3px left or top edge in
  `--terra` to mark state, instead of another rounded white box with a shadow.
  The OG card already uses exactly this device.
- **Cream surfaces, ink structure, one radius.** `--card` on `--cream`, hairline
  `--border`, `$r4` for controls and `$r12` for surfaces, and *nothing else*.
  Every `6px` and `8px` in a component block goes.

**4. Build the state vocabulary the lifecycle needs.**
This is where the two halves of the request meet. The archive view (F) needs
visual language the system does not have: *past*, *read-only*, *closed*,
*disputed*, *awaiting you*. There is a start — `.status-dot--active/reserved/let`,
`.app-card--archived`, `.app-card--closed` — ad hoc and partial. One state
treatment, defined once, is what makes an archived tenancy legible without a
banner explaining it.

**5. One `<app-logo>` component.**
Takes a `surface` input (`dark` | `light`). The **MA** glyphs get their own
span with their own token so they cannot be recoloured by a parent, and the
wordmark becomes placeable on cream without going invisible. Then delete both
copies of the markup and both pairs of rules.

I am not going to pretend a design direction can be settled in an audit. What
this section can honestly claim is: the system is real, it is bypassed one time
in three, the bypass is measurable, and the fix is a gate plus a mechanical
migration — not a new palette.

---

## I. Implementation plan

Ordered so that each phase is provable before the next depends on it, and so
nothing user-visible ships before the backend refuses the action behind it.

### Phase A — Make the backend refuse what the UI will stop offering
*No visible change. Everything after this depends on it.*

**Done — v1.116.0.** With two corrections to what this section originally
said, both found by implementing it:

- `RentService.mark()` — **not** "refuse `ended`". The invariant is a *window*:
  a rent period belongs to the months the tenancy actually covered. Refusing
  every write on an `ended` tenancy would break the most ordinary thing there
  is — a tenant moves out on the 30th owing that month, the landlord records it
  on the 5th. `assertRentWindow` bounds the months and leaves a finished
  letting correctable. It also now refuses `pending`, which the tenant's rent
  screen has always claimed and the API never enforced (C2)
- `RentService.dispute()` — **the original instruction here was wrong.**
  "Refuse when the tenancy is not `active`" would remove the tenant's answer at
  exactly the moment it matters most: the final month, marked unpaid after they
  moved out, with `TenancyFlag.unpaid_rent` able to rest on it. Only `cancelled`
  is refused. A dispute is never locked (C2)
- `RentService.history()` — returns `{ tenancy, periods }` (C2)
- `LeaseService.giveNotice()` — the OpenAPI summary is corrected to say
  landlord-only, rather than the guard relaxed. Admitting the tenant needs
  `Tenancy.noticeRecordedById`, because `noticeGivenById` records who notice is
  *attributed to*, not who entered it — so there is no safe rule for who may
  withdraw it, and a landlord clearing a tenant's notice resets a countdown that
  frees a room. A half-right tenant path is worse than an honest refusal. Phase
  B/G (C7, `docs/OUTSTANDING.md` §30)

Also found while driving it: **a tenancy is opened fire-and-forget.**
`ApplicationsService.accept` calls `createFromApplication(...).catch(...)`
unawaited so it cannot fail the acceptance, and nothing retries — if it throws,
the application is `accepted` with no tenancy and nothing would notice. It also
made this drive flaky in a way that read as a broken accept flow. The drive now
polls; the fire-and-forget stands and is recorded in §30.

**Proof — done.** `scripts/tenancy-lifecycle-drive.mjs` section 7, 18 checks.
Each guard was then reintroduced and confirmed to fail:

| | |
|---|---|
| window guards reverted to the shipped `cancelled`-only behaviour | **7 failed, 50 passed** |
| `history()` reverted to a bare array | **3 failed, 54 passed** |
| both restored | **57 passed** |

The "still correctable once ended" check stays green under the first revert, by
construction — it tests the opposite direction. Anybody can write a guard that
refuses everything, so each pair of checks has one half that proves the guard
is a window and not a freeze.

`scripts/smoke-test.sh` §46 carries the same three assertions. Production build
clean; the 456.40 kB bundle warning is byte-identical at HEAD (verified by
stashing), so it is pre-existing and this change adds nothing to it.

### Phase B — `archivedAt`, one writer
**Done — v1.117.0**, migration `20261008095150_tenancy_archive_and_report_scope`.

- `Tenancy.archivedAt DateTime?` (D2), set by `ReviewsRelease.archiveClosed`
  once `reviewsCloseAt` passes — **on its own query**, because the review
  release selects only tenancies with something held back and most tenancies
  never get a review
- `TenanciesService.cancel` archives immediately: a cancelled letting never
  gets a `reviewsCloseAt`, so it would otherwise sit unarchived forever
- `Report.tenancyId String?` (D1), `SetNull`, settable only by a party to that
  tenancy, never backfilled
- **`Tenancy.noticeRecordedById`**, which was not in this plan — Phase A
  established it as the blocker on the tenant notice path (C7). With it the
  withdrawal rule is decidable, so **a tenant can now give notice**, and that
  item is closed rather than carried
- `POST /reviews/release-closed`, admin-only: the pass had no operator route,
  so nothing could drive it, check it after a deploy or re-run it

**Proof — done.** Drive section 8, 17 checks (74 in the file). All five
behaviours reintroduced at once gave **8 red, 66 passed**; restored, 74 passed.
`migration-preflight` clean, and it **correctly refused first** because only
`DATABASE_URL` was exported and not `DIRECT_URL` — the exact trap from 5
October. The migration was hand-edited to strip five unrelated index
drop/recreates that `prisma migrate dev` added; they are pre-existing drift
(`docs/OUTSTANDING.md` §31), and dropping an index on `users` has no business
riding along with a feature migration.

⚠️ **Nothing reads `archivedAt` yet** — one writer, no readers, until Phase F.

### Phase C — Close the loop on `end()`
**Done — v1.118.0.**

- `tenancy_ended` to both parties, worded for who did it — a notice that tells
  somebody about their own action reads as a system not paying attention — and
  naming the 30-day review window, because a notice that omits it costs
  somebody their review (C4)
- `room_needs_relisting` to the landlord, **only while the room is still
  `let`**: one who has already paused, removed or relisted it has said
  something more recent (C3)
- **Prompt, not auto-relist**, as recommended and for the reason given: relist
  republishes old photos at an old price and archives every open application
- **A letting that fell through now frees the room immediately** — not in the
  original plan, found while reading `cancel()`. Accepting sets the room `let`
  and nothing set it back, so a room nobody ever moved into stayed off the
  board and out of the sitemap for good. Straight to `active`, not a relist:
  there is nothing to archive, because `autoRejectOthers` already rejected the
  others at accept time and they stay rejected, which is what happened (C3)
- `closureReason`'s "This tenancy ended and the room has been relisted" is
  gone. It asserted one of three possible histories as fact; it now says what
  is true in all of them (C3)
- D3 — see the corrected section above. The audit was wrong; `reserved` is
  written, and the defect is that no screen can reach it

**Proof — done.** Drive section 9, 14 checks (88 in the file). All three
behaviours reintroduced and confirmed to fail, revert 3 in isolation because
revert 2 masked it:

| Reverted | Result |
|---|---|
| `cancel()` no longer frees the room | ❌ reads `let` |
| `end()` announces nothing | ❌ 9 red |
| the relist prompt ignores the room's status | ❌ (isolated) prompt fires on a paused room |

⚠️ **And one check was passing for the wrong reason.** "The tenant is not told
THEY ended it" is a negative assertion, and with the announcement disabled
there was no notice at all — the empty string matches no phrase, so it went
green. It now requires the notice to exist first. A negative check has to prove
the thing it reads is there.

### Phase D — Tenant-side correctness
**Done — v1.119.0.** With one correction to what this section said:

- `activeApplications()` — **a whitelist, not the blacklist proposed here.**
  "Exclude `ended` or `cancelled`" is what I wrote and it is what I first
  built, and it **dropped the existing `active` exclusion**, putting the room
  the tenant lives in back under "it is waiting on you" — the very defect being
  fixed. `tenancyHasMovedOn` keeps only `pending`, so a status nobody thought
  of excludes itself (C1)
- `activeApplicationsNote()` — nothing in that list can be a finished letting
  now, so an `accepted` row genuinely is waiting on the person (C1)
- Rent screen — **two sections, not "a single line and a link to its archive"**
  as planned. The archive does not exist until Phase F, and the owner asked
  that previous payments not disappear, so the full ledger stays on this screen
  in a past-tense section. The dispute button stays too, per Phase A (C2)
- A pointer on the dashboard, which was not in the plan: excluding finished
  lettings from "Your applications" left them matching **no** section, so they
  vanished from the screen altogether

**Proof — done.** Drive section 10, 24 checks (112 in the file), every one
reading **rendered text** rather than a filter. Both defects reintroduced gave
**13 red, 99 passed**; restored, 112. Responsive verified at 360 / 390 / 768 /
1280 — no horizontal scroll, every control in the past section over 44px.

⚠️ A negative check passed on absence for the third time in this file: with the
past section gone, `pastText` is `''` and matches no pattern, so it went green
with the defect fully in place. Every negative assertion in section 10 now
proves its subject exists first.

### Phase E — Landlord-side parity
**Done — v1.120.0.**

- Past tenants on the property screen, collapsed, newest first, capped at six
  per room — who, the date range, what they paid, their paperwork, and whether
  a review is still open (C5)
- The landlord side now reads `Tenancy.status`: `room_vacant` is derived from
  `tenancies: { none: ['pending','active'] }` rather than from `Room.status`
  alone, which is what makes it catch a room marked let by hand with no tenancy
  behind it (C6)
- **A `room_vacant` TASK rather than a second `room_free` calendar entry**,
  which is a change from the plan. The calendar is date-based and fires
  *before* a known end date; what was missing is something that keeps asking
  afterwards. A notice fires once; a task persists until the state changes,
  which is what "this room is empty and nobody can find it" needs (C3)
- **Reserve / Unreserve**, closing §34 — the control the feature never had

**Proof — done.** Drive section 11, 30 checks (142 in the file), reverted in
two halves because the backend revert masked the frontend one: **11 red** then
**5 red**; restored, 142. Responsive at 360 / 390 / 768 / 1280.

⚠️ Three findings about the drive rather than the product: it **killed itself**
on a click for a control the revert had removed (same defect as §28, now
guarded); a **fourth** vacuous pass, where "a paused room draws no task"
asserted zero and zero is also what a missing feature returns (now a
before/after comparison); and the file is now large enough to exhaust the
60-registers-per-hour limit in two runs, so it needs an API restart between
them.

⚠️ And the initial bundle grew **1,501 bytes** of global CSS on a budget already
exceeded by 6.42 kB. Recorded in §37 as a trade to decide rather than quietly
made.

### Phase F — The archive, both sides
**Done — v1.121.0.** `/account/tenancies`, with the record expanded in place
rather than at a separate `/:id` screen — one list, the detail fetched on open
so nine past lettings do not pull nine full records to render nine rows.

- `GET /tenancies/archive` and `GET /tenancies/archive/:id`, both declared
  **before** every `:id` route in the controller: Nest matches in declaration
  order, so otherwise "archive" is handed to `ParseUUIDPipe` and the route 400s
  on its own name
- `TenancyArchiveService` assembles rent, reviews, your reports, paperwork, the
  application and the viewings in one round of parallel queries
- **`LandlordNote` excluded for both parties**, including its author — this is
  a shared screen
- `cancelled` lettings listed and labelled "Never started": a letting that fell
  through explains a gap in somebody's history
- Nav entry in both `landlordNav()` and `tenantNav()`, one definition each

⚠️ **This section's permission table was wrong on one row.** It said disputes
were visible to "both — raiser sees own; resolution visible to both". The second
half contradicts the defamation reasoning the schema already records, and the
code follows the existing stricter rule: **only your own**.

⚠️ **`documentDeletedAt` does not exist on `LeaseDocument`.** It is hard-deleted
along with its file, so there is no soft-delete to respect — that column is on
`VerificationRequest`, which this screen does not touch. What the record does
withhold is the storage `path`, so a private file is never one guess from
public.

**Proof — done.** Drive section 12, 44 checks (206 in the file). Every rule
reverted and confirmed to leak: the party check (a stranger read the record),
the published-review gate (the tenant read a held review **and its words were
in the payload**), the flag filter (the subject of a report read it), and the
document select (`secret-lease.pdf` in the payload). **7 red, 199 passed;
restored, 206.**

⚠️ And a **fifth** vacuous pass: the document-path check read an empty
`documents` array, so it went green with the path deliberately leaked. It now
inserts a row first.

`a11y-drive` audits the screen for both roles — 19 portal pages, not 17.

### Phase G — Notice elapsing
**Done — v1.122.0, and ⚠️ C8 described the wrong defect.**

C8 said an elapsed notice produced nothing and that no job watched it. **Both
inboxes already escalated it** — the countdown is computed on read, both
services sort by a negative day count, and both already said "This date has
already passed". The audit looked for a job and concluded there was no
handling, when the handling is computed per read on purpose and
`LeaseService`'s own header says so. Rent reminders continuing is not a defect
either: if nobody recorded a move-out, the person may still be there.

**The real hole was the action the landlord was pointed at.** Their row said
"get the room back on the board", and `relist()` checked the room's status and
nothing about who was in it — so an occupied room went back on the **public
board**, which is `ReportReason.already_let`, while archiving every open
application and bumping `relistCount`. Phase E's empty-room task could not see
it either, because the room was no longer `let`. Measured at 200 before the
fix.

- `relist()` refuses while a `pending` or `active` tenancy exists, naming whose
  move-out is missing. `relistAll` inherited it — it calls `relist()` per room
  and carries each reason back
- Once the countdown runs out, both inboxes change their action to recording
  the move-out, at `#moving-in-out` on each side. A row whose action 400s is
  its own defect, so the guard and the action landed together
- **It still does not end the tenancy**, as this section insisted: the drive
  asserts `status` is `active` and `endDate` null after the period elapses

**Proof — done.** Drive section 13, 24 checks (230 in the file). Three
behaviours reverted: **13 red, 217 passed**; restored, 230. The cascade under
revert is the argument — with the guard gone the room is relisted at the
*pending* stage, so everything downstream collapses.

### Phase H — The CSS gate
- Fail the build on a literal hex within ΔE 3 of an existing token (H1). `css-coverage-audit.mjs` is the precedent; `tokens.mjs` is the clustering
- Then migrate `#DDD5C8` ×19 and `#FFF` ×52 — 71 of 330 in two passes

**Done — and the plan above understated what was there.**

`scripts/token-lint.mjs`, in `npm run audit` and in CI. 57 literals migrated
across 20 files; `--white` went from 22 uses to 59, `--border` from 131 to 145;
literal colour uses fell from 314 to 258. 59 remain, carried in
`scripts/token-baseline.json` as a ratcheting baseline keyed by file, value and
count — debt, not permission.

**⚠️ The gate's second assertion found a worse defect than the one it was
written for.** `var(--line)` is referenced **14 times across 9 components** and
defined **nowhere**. An unresolved custom property is not a CSS error: the
declaration is dropped, every longhand becomes `unset`, and `border-style`
falls back to its initial value of `none`. Measured in Chromium:

```
border-bottom: 1px solid var(--line)    →  style "none",  width "0px"
border-bottom: 1px solid var(--border)  →  style "solid", width "1px"
```

So 14 separators did not exist — the public storefront ran as one unbroken
column, the lease panel had no rule above its sections, the landlord's private
notes had no left bar, and every task row touched the next, on both dashboards.
`ng build` is green over it (an unknown custom property is valid CSS), `tsc`
never reads a `styles:` block, and `css-coverage-audit.mjs` asks whether a
CLASS has a rule — not whether the rule's values resolve.

That is this audit's own §G finding one level deeper than §G stated it. §G said
the tokens were sound and bypassed; it did not consider that a bypass could
name a token that does not exist, and that the failure mode of that is
*silence* rather than a wrong colour.

**Proof — done.** `scripts/token-render-drive.mjs`, 51 checks at
360 / 390 / 768 / 1280 on the two screens carrying the only width-changing
cases. Five reintroductions, each reverted: a migrated `#fff`, a count above
the baseline, `--update-baseline` refusing to launder it, a `var(--bordre)`
typo, and the gate pointed at a directory with no tokens (exit 2, "refusing to
pass vacuously"). Reverting one `var(--border)` to `var(--line)` turns the
drive red in eight places.

**Three more phantom controls, all the same shape** (`docs/OUTSTANDING.md`
§§ 40–41): `tokens.mjs` had a `$`-definition filter that could never fire, so
twenty palette definitions were counted as literal colour uses and the
handoff's headline figure was wrong for the life of the file;
`scripts/control-contrast-audit.mjs` is asserted in a component comment and has
never existed; and `template-literal-lint.mjs`, written in Phase F, was wired
into no npm script, no workflow and no hook. Both real gates are now in
`npm run audit` and in `ci.yml`.

**And one Phase F miss, mine:** `.arc-review__by` on the archive screen had no
rule at all. `css-coverage-audit.mjs` named it on this phase's build, which
means it was red at `cc12db1` and I reported Phase F's gates as green without
rerunning it against the build.

**Already landed early, from Phase D:** `scripts/template-literal-lint.mjs`.
Not a CSS gate, but the same argument — a backtick inside an inline
`template:` literal terminates the template, it has happened eight times, and
a note in CLAUDE.md has not stopped it. A grep finds in milliseconds what a
production build finds in half a minute.

### Phase I — `<app-logo>`
- One component, `surface` input, **MA** in its own span with its own token
- Delete both markup copies and both rule pairs (G3)

**Done, and the plan's `surface` input was a worse design than what shipped.**

An input with two values has a wrong value, and here the wrong value renders
cream on cream or ink on ink — an invisible wordmark, which is the exact
failure G3 was about. So the stem is `currentColor`: it follows the
surrounding text colour, which is by definition right for the surface it is on
and is already measured there by `a11y-drive`. There is no input to get wrong.

**⚠️ That required fixing a defect one level up.** `.nav` and `.footer` are
`background: var(--ink)` and set **no `color`** at all; `.portal-nav` is
`background: var(--ink2)` and the same. Every child needing light text has
been declaring it individually — `.nav-logo`, `.footer-desc`, `.footer-popia`,
`.footer-col h2`, `.portal-user-name`, one `color: var(--cream)` at a time.
That is the `:where(button)` defect one level up: a background without a
foreground is one decision taken half way, and it reached a phone once already
as white text on a white button at 1.00:1. All three now declare their
foreground, in `styles.scss` (the port forbids hand-editing).

**The MA colour had to change, and the number was searched rather than
chosen.** One fixed value must be legible on `--ink` AND on
`--cream`/`--card`/`--white`. Every existing terracotta fails one side:
`--terra` is 3.06:1 on ink, `--terra2` is 3.33:1 on cream, `--terra-deep` is
2.28:1 on ink. The best achievable minimum across those five surfaces is
**3.92:1** — anything light enough for #1C160E is too light for #FFFFFF.
`--logo-ma: #C4522C` reaches that ceiling and is the closest to the brand of
the values that do (ΔE 7.6 from `--terra`, 8.7 from `--terra2`).

3.92 clears WCAG's **large-text** threshold of 3:1, not the 4.5:1 small-text
one, and that holds only while the wordmark is 18.66px bold or larger. So the
justification is asserted rather than trusted: `scripts/logo-drive.mjs`
measures the rendered font size and weight at every placement and width.

**Proof — done.** 76 checks. Three reintroductions, each reverted:

| Reintroduced | Result |
|---|---|
| `.logo__ma` loses its token and inherits | ❌ 17 checks, including MA = stem = `rgb(250,247,240)` |
| a smaller `--lg` size (1rem) | ❌ "16px at weight 900, floor 18.66px bold" at 768 and 1280 |
| `.nav, .footer` stop declaring a foreground | ❌ stem at **1.00:1** on `--ink` — the invisible-text failure, caught |

**And the drive caught my own design claim being false on its first run.** The
header said the stem "inherits the surrounding text colour". It did not: the
logo's root is an `<a>`, and the global `a { color: $color-terracotta }` has
specificity (0,0,1) on that very element, so `currentColor` resolved to
`--terra` — 3.06:1 on `--ink`, passing the 3:1 floor by 0.06 and nothing like
what was designed. `.logo { color: inherit }` fixes it; it is 16.77:1 now.

**⚠️ And the backtick trap, for the eighth time — in a place the lint could not
see.** Five backticked identifiers in a comment inside the component's
`styles:` block terminated the literal; the production build produced twenty
errors including `TS2304: Cannot find name 'color'`.
`scripts/template-literal-lint.mjs` read **green** over it, because it looked
only at `template:` literals and only at the first one per file. It now covers
`template:`, `styles:` and each element of a `styles: [...]` array, every
occurrence — 141 literals across 85 files. Proven by diffing the two versions
against the same defect: old exit 0, new exit 1.

### Phase J — Design system consolidation
- State vocabulary for the archive (H4)
- Shared empty / loading / error components (G5)
- Spacing and radius onto the scale
- The three identity moves (H3)

#### J1 — the state vocabulary. **Done, and §H4 understated it.**

§H4 called the state treatments "ad hoc and partial". Counted, there were
**four parallel systems**, and three of the duplicates were written by Phases
D, E and F — by me, in this session:

| Duplicate | Where |
|---|---|
| the "Past letting" chip, written **three** times | `.arc-row__badge` (archive), `.rent-past__badge` (rent), `.yard-past__review` (yard) — differing by `.12rem` vs `.15rem` of padding |
| `.status--accepted` / `.status--rejected`, identical, raw hexes | `applicants.ts` AND `applicants-inbox.ts` |
| a naming fork | `.status-accepted` (spec layer, one hyphen) vs `.status--accepted` (components, BEM) — neither shadows the other |
| a fourth convention | `.app-status status-{{ p.status }}` on the rent ledger |

**⚠️ Two of those rules were under the contrast floor, and the accessibility
drive could not see it.** Measured: `.status--accepted` (#3D7040 on sage 15%)
is **4.12:1** over `--cream2` and `.status--rejected` (#D63B3B on red 10%) is
**3.46:1** — the chip is .65rem at weight 700, so the threshold is 4.5:1.
`a11y-drive.mjs` has never accepted or rejected an application, so neither
chip has ever been on screen while contrast was being measured. *A page passes
that audit by not containing the failing element* — the five-vacuous-passes
lesson, in the gate that exists to prevent it. The drive now accepts one
application and rejects another on a second room, and audits the per-room
applicants screen, which was not in its page list at all.

Five meanings, defined once in `styles.scss`, each measured over `--cream`,
`--cream2`, `--card` and `--white` because a translucent tint composites over
whatever is beneath it:

| state | ink | fill | worst of four surfaces |
|---|---|---|---:|
| live | `--sage-deep` | sage 12% | 5.21 |
| waiting | `--ink2` | gold 14% | 9.64 |
| past | `--terra-deep` | `--cream2` | 6.73 |
| closed | `--slate` | `--cream2` | 4.74 |
| disputed | `--terra-deep` | red 10% | 5.89 |

The obvious picks all fail: `--gold-text` on its own gold tint is **4.10** —
and `_spec.scss`'s comment claims it "clears both… 4.61:1 on the tint", which
was measured against the tint over `--card` only, so `.status-pending` has
been under the threshold on `--cream2` all along. `--sage` on the sage tint is
4.29, `--terra` on the terra tint 4.38, `--slate` on any tint 4.05–4.23. Hence
deep inks throughout, and `waiting` carrying its meaning in the FILL with
near-black ink, because no gold close enough to `--gold` to still read as gold
clears 4.5:1 as small text (the nearest that does is ΔE 23 away and reads
brown).

`.state-edge` is §H3's second identity move — a 3px rule in the state's own
ink rather than another tinted box. Both devices read the same two custom
properties, so a meaning is defined once and rendered two ways. The rent
ledger now marks a **disputed month** with it: that was prose with a raised
hand in it, so on a year of rows the one month somebody queried looked exactly
like the eleven they did not.

And the mapping is a typed function in `core/models/state.model.ts`, not a
string per template, because two copies of a mapping is the same defect as two
copies of a rule: the inbox folded `withdrawn` in with `rejected` — the same
red — so an applicant who stopped read as one the landlord had refused. A new
status added to either union is now a type error.

**Proof — done.** `scripts/state-lint.mjs`, in `npm run audit` and CI. Four
reintroductions, each reverted: a sixth meaning invented on a screen
(`state--expired`, named with its file:line); a component declaring the
treatment itself again (named with the properties it set); a declared name
losing its rule (the chip would render unmodified grey); and the lint pointed
at a directory where nothing uses the vocabulary (exit 2, "refusing to pass").
Its first run also found two false positives of its own — it matched the tail
of `landlord-trust__state--ok`, which turned out to be a real finding anyway:
those two modifiers were in the CSS-coverage baseline as styled nowhere, and
are now deleted.

#### J2 — loading, empty and error. **Done, and §G5 named the wrong defect.**

§G5 said "the copy is good… but there is no system, so the twentieth screen
will invent a twenty-first phrasing." Counted, the copy was *already*
consistent — 23 of 38 loading states were the identical paragraph. The real
defect was elsewhere:

**⚠️ Not one of the 38 was announced.** No `role`, no `aria-live`, so a
paragraph replaced by content when a request lands is silent to a screen
reader. 81 live regions exist in this app; 68 are `role="alert"` on field
errors and exactly 11 paragraphs carry `role="status"`, none of them a loading
state in a template. **`axe` does not flag a missing live region**, so
`a11y-drive` has never reported this and never could — a gap in the gate, not
in the screens.

**Three screens used ONE element for three states.** `notices`, `messages` and
`applicants-inbox` each had `<p class="{notices,msg,ai}-empty" role="alert">`
doing error, loading *and* empty. So "Loading…" was announced as an **alert**,
and "we could not reach the server" looked exactly like "you have nothing" —
which on an applicants screen means a landlord concludes nobody applied. Each
of those screens carries a comment reading "Three states, not two"; the markup
then used one element for all three.

Three components now: `<app-loading>` (`role="status"`, `aria-live="polite"`,
`ng-content` fallback so the ten screens with better wording keep it),
`<app-error-state>` (`role="alert"`, a `retry` output, the vocabulary's edge,
`var(--danger)`), and `<app-empty-state>` — deliberately thin, because §G5 is
right that the copy is good, so what it adds is a slot for the ACTION several
empty states lacked.

**⚠️ `--danger` did not exist, and eight components had each typed a worse
red.** `$color-danger: #B23B3B` has been in `_variables.scss` from the start at
5.48:1 on `--cream`; an SCSS variable is invisible to an inline `styles:` block
— §H2 — so eight components typed `#D63B3B`: **4.32:1 on cream, 3.96:1 on
cream2** at .82rem. Eight contrast failures caused by a token they could not
reach. This is §H2's finding with a measurable cost attached.

`.link-button` was declared in four component scopes and nowhere global — the
`.btn-danger` defect `css-coverage-audit`'s own header records. The fifth
component to use it got an unstyled `<button>` mid-sentence, and the audit
named it on the first run.

**Proof — done.** `scripts/feedback-lint.mjs`, three reintroductions and two
vacuous-pass guards, all reverted. And two gates had false positives of their
own: `css-coverage-audit` read class names out of **comments** (four, from the
error component's own documentation of the screens it replaced), and
`feedback-lint`'s first assertion matched its own doc comment, so it stayed
green with `role="status"` deleted. Both fixed; both verified still able to
fail.

The four source-only gates now run in the **pre-commit hook** — 0.516s
measured, no build, no API, no browser. The backtick trap has happened
thirteen times, five on 11 October alone, in the phases that wrote the lint
for it.

#### J3 — radius and spacing. **Radius done; spacing ratcheted, deliberately.**

28 distinct radius values for 174 uses → **15 for the same 174**, every
remaining one legitimate. The mapping is by what the element IS, not by
arithmetic: controls → `--r4` (every `6px`, `5px`, `2px`, `.4rem`), small
surfaces → `--r8`, panels → `--r12`, chips → `--r-full`.

**⚠️ I kept `--r8` where §H3 said "r4 and r12 and nothing else."** 21 existing
uses is not a rounding error and 8px is a real step between a control and a
panel; removing it would be a 21-site visual change to satisfy the letter of a
sentence in this document.

Spacing is 60 values over 1073 uses, so it is RATCHETED rather than migrated:
39 off-scale values over 536 uses baselined, drift stopped. A thousand-site
spacing migration is churn with real visual risk and nothing reviewable.

`scripts/scale-lint.mjs`, four reintroductions. Its own first run counted
`.6rem` and `0.6rem` as two values — 11 of the 49 entries were a second
spelling of another.

#### J4 — the money figure. **§H3's first move applied, and half of it refused.**

§H3 wanted Playfair for "every number that matters". It is right for the
DISPLAY figures and wrong for the LEDGER ones: the rent ledger and the
archive's month list are columns that must line up, the monospace stack gives
fixed-width digits and a proportional serif does not. `.stat-box .val` and
`.room-detail__price` take the display face at 900; `.app-rent` and
`.arc-month__amount` keep monospace.

**⚠️ And the monospace in question was never fetched.** `--font-mono` named
`'DM Mono'`; `index.html` has never requested it, so every money figure in
this app has rendered in Courier New since the token was written — while this
project's own design handoff reported DM Mono as one of "three real faces".
`scripts/font-lint.mjs` now fails on a token naming a family nothing asks for.
`docs/OUTSTANDING.md` § 47, including why that check has to be static (no
webfont loads in this container at all — a bogus family and Playfair render
identically) and which of my own Phase I claims it weakens.

#### ⚠️ J2 also found nine on-screen WhatsApp promises, and the drive for them was blind

`CLAUDE.md`: *"Nothing on screen may promise a WhatsApp message while it is
off."* `WHATSAPP_ENABLED` is false. Nine sentences across five screens say it
anyway — four of them onboarding card titles and bodies, one the copy
explaining what the messages screen is for.

`whatsapp-off-drive.mjs` checked **four hardcoded files**. The rule is a claim
about every template. It now sweeps all of them. Two promises inside the empty
states this phase was rewriting were fixed; the other nine are baselined and
**handed to the user** — rewriting onboarding copy is a decision about what the
product claims to be, and WhatsApp-first is the stated goal, paused for cost.
`docs/OUTSTANDING.md` § 45.

#### ⚠️ J1 also retired a phantom control I had been quoting

`_spec.scss`'s header said *"DO NOT hand-edit. This is a direct copy… so it
can be re-synced when the preview changes."* **`RentBoard-ZA-Visual-Preview.html`
is not in this repository and never has been** — `git log --all` for it is
empty, and `README.md` lists it under "Historical source documents… files that
existed at a point in time". There is nothing to re-sync from. The file was a
one-time port and has been hand-edited in **22 commits** since, one of them
mine three commits ago (`8c94aed` added the whole `.yard-past*` block while
citing that header).

So a rule that could not be enforced, was routinely broken, and was still
being quoted as a reason to leave defects in place. **I used it twice**: Phase
H left 13 literal `#FFF` there and Phase I left four dead `.nav-logo` /
`.footer-logo` rules, both justified by a re-sync that can never happen. The
header now says what is true, and both are fixed — the token baseline ratchets
from 59 to 31.

### Phase K — Visual polish
Last, as asked. Nothing here is blocking.

### Mandatory for every phase
Per CLAUDE.md, and these are not optional:

- Responsive verification at **360 / 390 / 768 / 1280**, breakpoints 900/768/480
- `ng build --configuration=production`
- `scripts/smoke-test.sh` updated for any API change
- `PRE-LAUNCH-CHECKLIST.md` and `docs/FLOW-AUDIT.md` updated
- **Reintroduce the bug and confirm the check fails.** Phase A ships a gate that
  can fail or it has not shipped

### Not in scope, flagged rather than done
- **Money.** Nothing here moves toward holding rent or deposits. The archive
  renders a record; it does not become a ledger (CLAUDE.md)
- **Retention period for ended tenancies.** Business and legal; not mine (F)
- **Report backfill.** Inferring which tenancy a historical report belonged to
  would manufacture facts. Historical rows stay null

---

## Tooling — what was used, and what does not exist

The request asks that available skills and plugins be used rather than
reinvented. Honestly:

**No skills or plugins are installed in this repository** — there is no
`.claude/skills/`, no `.claude/plugins/`, no plugin manifest. Nothing was
ignored; there is nothing there.

What this repo *does* have is better, and was used:

| Tool | Used for |
|---|---|
| `design-handoff/tools/tokens.mjs` | Every figure in section G. CIE Lab ΔE clustering across 5 stylesheets and 53 inline `styles:` blocks |
| `design-handoff/tools/components.mjs`, `routes.mjs` | Component and route inventory |
| `scripts/tenancy-lifecycle-drive.mjs` | Read, to establish what it does *not* cover (C9) |
| `scripts/css-coverage-audit.mjs` | Cited as precedent for the Phase H gate |
| `scripts/migration-preflight.mjs` | Named as the Phase B gate |
| `scripts/dashboard-ui-drive.mjs`, `a11y-drive.mjs` | Named as Phase D proof |

**What was not run, and so is not claimed:** no drive was executed in this
pass. No database was stood up, no API started, no browser driven. Every
finding above is from reading source and from `tokens.mjs` output committed
earlier in `design-handoff/TOKENS-CURRENT.md`. The behaviours in section C are
read off the control flow, not observed on a running instance — C1 and C2 are
plain enough in the filter expressions to state, and the rest are named with
the line that causes them so they can be checked. **Phase A's first job is to
make them reproducible in a drive before anything is fixed.**

---

## Separately: the house ads

Raised alongside this request. It is not a code defect.

`backend/prisma/house-ads.ts:39` reads `headline: 'New to Mastande?'`. The code
is correct and has been since the rename. **Production's `ad_campaigns` row
still holds the pre-rename string**, because the row is seed data and the seed
has not been re-run against production.

The tool for it already exists and is deliberately narrow — it touches the
three `[HOUSE]` campaigns and the house advertiser row and nothing else,
because the full seed resets the admin password on the way past:

```bash
cd backend
DATABASE_URL='<production>' npx ts-node prisma/seed-house-ads.ts            # dry run, prints the diff
DATABASE_URL='<production>' npx ts-node prisma/seed-house-ads.ts --apply    # writes
```

Dry run is the default and prints the current value beside the new one. It also
prints which database it is about to change before changing anything.

**I cannot run this** — this container has no production `DATABASE_URL`, and it
is an ops action against live data.
