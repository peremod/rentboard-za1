# Mastande — Consolidated Implementation Prompt for Claude Code

Paste this whole document into Claude Code in the repo. It covers Phases 0–6,
to be worked through in strict order, each ending in a summary checkpoint
before moving on.

---

I need you to implement a set of product differentiators for this room-rental
platform (formerly RentBoard, rebranding to **Mastande**) so it beats two
direct South African competitors — **RoomKing** and **AmaRoom** — on trust/
verification depth, landlord tooling, and monetization. Both competitors are
basic listing portals with manual moderation only; neither has real
verification infrastructure, portfolio-level landlord tools, or a
monetization model tied to actual trust.

## Before writing any code

1. Read these project docs in full to ground yourself in what already exists
   and what's already decided, so you don't duplicate or contradict prior work:
   - `RentBoard-PRE-LAUNCH-CHECKLIST.md` (outstanding gaps table)
   - `RentBoard-DATA-AND-MONETISATION.md` (revenue mix, POPIA constraints,
     payment flow already scoped)
   - `RentBoard-FLOW-AUDIT.md` (includes the "no formal tenancy record" gap
     relevant to Phases 4 and 6)
   - `RentBoard-ZA-Brand-Positioning-Messaging.md` (voice/tone, "free to list,
     free to apply" is non-negotiable — do not introduce landlord listing fees)
   - `RentBoard-UX-WhatsApp-Data.html` (plain-English, WhatsApp-first UX
     pattern to match for anything new)
   - The Prisma schema (`User`, `UserRole`, `LandlordProfile`, `TenantProfile`,
     `Property`, `Room`, `VerificationRequest`, `SavedSearch` models) and
     `StripeService`
2. Confirm current git branch and status. Create a feature branch per phase
   (not one giant branch) — e.g. `feature/landlord-survey`,
   `feature/informal-verification`, `feature/yard-management`,
   `feature/whatsapp-listing-bot`, `feature/sublet-listings`.
3. Confirm dev/staging/prod environment config (`.env.example`, any
   `environment.*.ts` files) before touching anything that reads env vars —
   new features must work identically across all three, with any new secrets
   added to `.env.example` with comments, never hardcoded.
4. Work through phases in **strict order**. Stop and summarize what changed
   and what's still open after each phase, rather than running all of them
   silently to the end.

---

## Phase 0 — Landlord pain-point survey

Goal: validate assumptions behind Phase 2 (yard management) before committing
engineering time to it, and build reusable infrastructure for future surveys.

- Add `Survey` and `SurveyResponse` Prisma models. A survey has a title, a set
  of questions (structured as JSON: multiple-choice with options, or open
  text), an active/inactive flag, and a target audience filter (e.g.
  landlords only, landlords with 2+ rooms only). A response is tied to a
  `LandlordProfile` (or anonymous/unauthenticated if triggered pre-login) and
  stores answers as JSON keyed by question id.
- Seed one initial survey with these questions:
  1. How do you currently find tenants for a vacant room? (word of mouth /
     Facebook / Gumtree / a sign outside / other)
  2. What's the most stressful part of dealing with tenants? (getting rent on
     time / tenants damaging property / vetting who to trust / tenants
     leaving without notice / paperwork or record-keeping)
  3. How many rooms/units do you currently rent out? (1 / 2-4 / 5-9 / 10+)
  4. How do you currently track who's paid rent this month? (memory /
     notebook / spreadsheet / nothing formal)
  5. Have you ever had a tenant scam or seriously mislead you? (yes/no + open
     text)
  6. What would make you trust an online platform to find a tenant? (open
     text)
  7. What's one thing you wish existed to make managing your rooms easier?
     (open text)
- Build two trigger points: (a) a contextual micro-survey shown once after a
  landlord marks a room "let" (single relevant question only), and (b) a link
  to the full survey from the landlord dashboard, dismissible and not
  re-shown for 30 days if skipped.
- Build a WhatsApp-delivery variant reusing the existing WhatsApp Business API
  integration — check what interaction pattern the existing webhook handler
  already supports before designing this.
- Build a simple admin view to read aggregate responses (counts per
  multiple-choice option, list of open-text answers), segmented by room-count
  bracket (question 3). A plain table view is fine for v1.
- Keep this quick — do not build a generic form-builder. Hardcode this
  survey's structure; keep the model general enough to add a second survey by
  hand later.

---

## Phase 1 — Verification depth, adapted for the informal economy

Goal: finish the half-built verification system, replacing the UK-style
credit-check assumption with proof mechanisms that fit informal-economy
income (the target market largely doesn't have bureau credit history).

- Finish the landlord verification UI (submission form + admin review queue)
  — backend (`VerificationRequest` model) already exists, only the UI is
  missing.
- Finish the Renter's Passport UI/flow for tenants, changing verification
  inputs from "credit check" to informal-economy-appropriate proofs: SASSA
  payment confirmation upload, employer confirmation (WhatsApp/SMS screenshot
  or a simple employer-contact verification step), bank app statement
  screenshots (3 months), and a structured prior-landlord reference (name +
  phone + short rating, contacted by admin or via automated WhatsApp
  confirmation request).
- Add a lightweight two-sided model: a "Tenant Passport" badge visible to
  landlords, separate from the existing landlord-facing verification, so
  trust signals flow both directions.
- Add a persistent audit trail on each verification: what was checked, when,
  by whom (admin) or which automated step.
- Add a post-tenancy dispute/flag mechanism: either party can flag a problem
  after a tenancy ends; flagged accounts get reduced visibility pending
  review. Design the data model now even if the review-queue UI is a stretch
  goal.
- Respect POPIA throughout: documents stay private, deleted per the existing
  `VerificationRequest` retention pattern — only outcomes persist.

---

## Phase 2 — Yard/portfolio management (tiered)

Goal: most real landlords in this market run multi-room "yards," not single
rooms — neither competitor supports this. Build in tiers, and check Phase 0
survey results (question 3 distribution, question 2/7 pain points) before
starting Tier 2/3 — if data doesn't support the assumption, scale back rather
than building anyway.

**Tier 1 (build regardless — low cost, clear value):**
- A "Property/Yard" dashboard view: all rooms under one `Property`, vacancy
  status per room, pending applicants across the whole yard.
- Bulk actions: relist, boost, or update house rules across every room in a
  property at once.
- Surface the property-level vs. room-level split that already exists in the
  schema (`propertyAmenities`, `houseRules`, `currentHousemates`,
  `housemateProfile` on `Property`) properly end-to-end — check whether this
  data is actually rendered today or just stored.

**Tier 2 (build only if survey confirms rent-tracking/trust are top pain
points):**
- Rent roll view: per room, tenant name, rent amount, paid/unpaid this month,
  days until lease review. Manual toggle, no payment processing in this
  phase.
- Turnover/vacancy analytics: average days-to-fill per room using existing
  data (`relistCount`, views, applications).
- Maintenance/issue log: simple per-room, timestamped log entry
  (open/resolved), not a full ticketing system.

**Tier 3 (stretch — only after Tier 1/2 are live and data supports it):**
- Multi-property support for landlords running more than one yard.
- Staff/caretaker access: limited-permission login without financial
  visibility.
- Simple financial summary: total monthly rent roll, occupancy rate,
  month-over-month trend across the whole portfolio.

Stop after Tier 1 and report back before deciding whether Tier 2 is
justified — don't assume it without checking survey data, or flag clearly if
no survey data exists yet.

---

## Phase 3 — Monetization tied to real trust

Goal: don't compete with RoomKing/AmaRoom on ad-supported free listings —
compete on the verification fee actually meaning something, per the R149
flow already scoped in `RentBoard-DATA-AND-MONETISATION.md`.

- Wire the verification fee flow (pay → admin review → approve/refund) to the
  new informal-economy verification checks from Phase 1, not the old
  credit-check assumption.
- Confirm room boost and board advertising remain unchanged — no regressions.
- Do NOT introduce any landlord listing fee or tenant application fee — this
  breaks the core "free to list, free to apply" positioning. Flag loudly if
  any change risks this.

---

## Phase 4 — Landlord retention features

No payment custody, no deposit holding — deliberately scoped to avoid
trust-account/PSP compliance questions. Give landlords recurring reasons to
open the platform beyond "I have a vacancy." No money moves through Mastande
in this phase.

### 4a — Automated invoicing / rent reminders to tenants
- `RentSchedule` model tied to an accepted tenancy: rent amount, due day,
  tenant, room/property.
- Scheduled job (reuse existing `ScheduleModule` pattern) generates a
  WhatsApp reminder before rent is due, in the existing plain-English style.
- Landlord marks each tenant paid/unpaid manually — no payment link, no
  gateway integration.
- One automatic follow-up reminder if marked unpaid after a configurable
  grace period — do not send more than one follow-up without landlord action.
- Dashboard shows current month's collection status across all tenants,
  building on the Tier 1 yard dashboard.

### 4b — Expense tracking per property
- `Expense` model: property (or room, optional), category
  (municipal/water/electricity/maintenance/other), amount, date, optional
  receipt photo (reuse ImageKit pattern), optional note.
- Simple add/edit/delete UI on the property/yard dashboard.
- Per-property and portfolio-wide monthly total (rent collected minus
  expenses). Prioritize a clean, glanceable summary over feature completeness
  — this is the single feature most likely to pull a landlord in with no
  vacancy and no rent due that day.
- Stretch: basic CSV export per property per year for SARS purposes — not a
  full tax-reporting feature.
- Design with a future "split between co-tenants" capability in mind (ties to
  Phase 6) without building the splitting logic yet.

### 4c — Lease renewal / notice-period automation
- Resolve the "no formal tenancy record" gap noted in `RentBoard-FLOW-AUDIT.md`
  — needed here and by the reviews feature and Phase 6. Add a lightweight
  `Tenancy` model (or extend `Application` post-acceptance) with
  `leaseStartDate`, `leaseEndDate` (nullable — many tenancies are
  month-to-month), `noticePeriodDays`.
- Scheduled check flags leases approaching `leaseEndDate` (configurable lead
  time, e.g. 30 days) on the dashboard: confirm renewal or start relisting.
- For month-to-month tenancies, surface `noticePeriodDays` reminders only
  when either party gives notice (a landlord-loggable "tenant gave notice"
  action starts a countdown and pre-schedules the relist prompt).

### 4d — Contractor/service directory
- `ServiceProvider` model: category (plumber/electrician/locksmith/
  cleaner/other), name, phone/WhatsApp, area/suburb coverage, optional note.
  Admin-curated list, not open submissions.
- Tap-to-contact (WhatsApp deep link or `tel:` link), no in-app
  booking/payment.
- Surface from the maintenance log (if built) and as its own directory page.
- Include a `sponsoredUntil`-style field now, unused in v1 — future ad/
  referral revenue line, cheap to account for at schema stage.

### 4e — Digital lease storage (storage only, no e-signature/legal execution)
- `LeaseDocument` model tied to the `Tenancy` record: file reference (reuse
  upload pattern), uploadedAt, uploadedBy, status (draft template generated /
  signed copy uploaded).
- Generate a downloadable standard lease template from existing Rental
  Housing Act / POPIA-aligned legal language already in the codebase.
  Landlord gets it signed however they currently do, then uploads the signed
  copy back.
- Do NOT build in-app e-signature or make Mastande a signing party — storage
  and organization only. UI must state clearly that Mastande does not verify
  or execute the lease.
- Surface alongside verification documents and maintenance records so there's
  one place per tenancy holding everything.
- Tie the lease's effective end date into the 4c renewal flag so both
  reference the same date rather than tracking it twice.

## Explicitly out of scope for Phase 4 (revisit later, with legal/compliance
review before building)
- Collecting or holding rent payments through the platform
- Deposit collection, holding, or release
- Digital lease signing/document generation with legal effect
- Anything that makes Mastande a party to holding tenant or landlord money

Do not let scope creep pull payment processing into this phase.

---

## Phase 5 — Business identity, organization, and status features

Goal: make the landlord feel like they're running a visible, organized
business — a distinct retention lever from Phase 4's task-based utility. Same
compliance boundary as Phase 4: no money custody, no deposits, no legal
document execution. Flag explicitly before building anything that would cross
that line.

### 5a — Unified landlord task/action inbox
- Single prioritized list at the top of the dashboard, aggregating: new
  applications pending response, leases renewing soon (4c), tenants not yet
  marked paid (4a), unresolved maintenance items (Phase 2 Tier 2).
- Primarily an aggregation/UI layer over existing models — not new core data.
- Each item actionable directly from the inbox (tap to confirm renewal, tap
  to mark paid), not just links.

### 5b — Landlord storefront / public profile page
- Public page per landlord (`/landlord/[slug]`): verified badge, active
  listings, rating (once reviews exist), years active, average response
  time (from existing message/application timestamps).
- Human-readable, stable slug generated from name/business name, with
  collision handling.
- Include in the sitemap and meta-tag properly (check existing
  `SitemapModule` pattern) — real SEO surface, not just a retention feature.
- Optional short bio/business name, optional profile photo/logo.

### 5c — Social-share and print flyer generator
- Multiple format outputs from one listing:
  - WhatsApp Status / Instagram Story shape (vertical 9:16), room photo
    background, price/details overlaid, contact number, short link/QR code
  - Facebook feed/group post shape (square or 4:5), same info, sized for how
    Facebook actually renders shared images
  - Print flyer shape (A4/A5) for physical use
- One-tap native share via the Web Share API where supported, so tapping
  "Share to WhatsApp Status" or "Share to Facebook" opens the native share
  sheet with the image pre-attached — not a manual download-then-post flow.
- Every generated asset is branded (small Mastande logo) and carries a QR
  code/short link back to the live listing or storefront page — every share
  is simultaneously free brand distribution and a lead-gen surface.
- Optional "posted to" log button (Facebook groups / WhatsApp status) purely
  for the landlord's own activity record — no verification that it happened.
- Test Web Share API image support across target devices — prioritize
  Android WhatsApp behavior as the primary test target; desktop can fall back
  to download-only.
- No new backend model needed — this is a rendering/export layer over
  existing room data.

### 5d — Portfolio health summary
- Composite plain-English summary card: occupancy rate across all
  properties, average days-to-fill (from existing data), payment reliability
  rate (from 4a). Present as a readable sentence/card, not a raw numeric
  dashboard, matching the existing plain-English UX pattern.

### 5e — Tenant CRM notes
- `LandlordNote` model: landlord, tenant, free-text note, timestamp. Visible
  only to the landlord who wrote it.
- Persist across a tenant's full history, even after move-out, for
  continuity if the tenant reapplies or a reference check comes in from
  another landlord (tie-in point for Phase 1's reference verification — don't
  build that integration now, just don't block it).

### 5f — Shared calendar view
- Aggregate rent due dates (4a), lease renewals (4c), inspection dates (if
  built) into one calendar view on the dashboard.
- Stretch: exportable `.ics` feed for Google Calendar/native calendar
  subscription — check effort before committing; the in-app view alone
  delivers most of the value.

### 5g — Landlord referral program
- `Referral` model: referring landlord, referred landlord, status
  (invited/joined/rewarded), reward type (credit toward verification fee or
  room boost — reuse existing Stripe scaffolding for issuing credit, no new
  payment path).
- Unique referral link/code per landlord, trackable through signup.
- Reward both parties on the referred landlord's first completed action
  (first listing published or first verification completed), not on signup
  alone.

### 5h — Longevity/reliability badges
- Small, automatically-awarded badges from real usage data ("On Mastande
  since [year]", "X tenants placed", "Verified landlord") on the storefront
  page. No generic achievements system — a short, meaningful, non-gimmicky
  set only.

**Priority note:** 5a and 5d are the highest-leverage, lowest-cost items —
pure aggregation over data Phases 1–4 already generate. Prioritize these if
time is constrained. 5b has real SEO value beyond retention — treat its
metadata/sitemap integration as seriously as any other public-facing page in
the Technical SEO work.

---

## Phase 6 — Tenant sub-letting / shared-lease listings

Goal: support tenants who hold a lease and want to sublet or co-lease extra
rooms (the shared-house/flatshare model — students, young professionals
splitting a lease), distinct from the landlord-owns-the-property model the
platform is built around today. **This phase includes an architectural
decision that needs sign-off before implementation — see the flagged
decision point below.**

### Decision point — resolve before building (flag back to the person, do
not decide unilaterally)
The current `UserRole` enum is `TENANT | LANDLORD | ADMIN`, with
`LandlordProfile` existing only for the `LANDLORD` role and `Room.landlordId`
pointing at a `LANDLORD`-role user. A tenant subletting a room in their own
leased house doesn't fit either bucket cleanly. Two options:
- **Option A (recommended default, smaller blast radius):** Allow a
  `TENANT`-role user to also create room listings, adding a `listerType`
  field (`owner_landlord` | `sublessor`) on the listing or a lightweight
  lister profile, reusing most existing `Room`/`Property`/verification
  infrastructure.
- **Option B (cleaner long-term, larger change):** Generalize "Landlord" into
  a "Room Provider" concept, with ownership/sublet status as an attribute
  rather than a separate role — touches guards, dashboards, and copy more
  broadly.
Implement Option A unless told otherwise, but confirm this assumption
explicitly before writing migration code.

### Legal/trust requirements
- New verification document type on `VerificationRequest`: proof of a valid
  lease **and** either lease terms permitting subletting or written landlord
  consent. This is a new, distinct check from existing landlord-owner
  verification.
- New disclaimer content, separate from the existing landlord disclaimer:
  Mastande does not confirm or guarantee a sub-lessor's legal right to
  sublet. Surface this plainly to applicants, not just as platform
  liability-protection language — the applicant carries real risk if the
  sub-lessor's right turns out to be invalid.
- Route this disclaimer copy past the same South African attorney review
  already planned for the other legal pages — do not treat this as
  boilerplate to copy from the existing landlord disclaimer.

### Product features specific to this use case
- Surface `Property.housemateProfile` and related fields (already in schema:
  "professionals"/"students"/"mixed"/"couples") prominently for this listing
  type — compatibility matters more here than in a landlord-owned backroom
  listing.
- Add filterable compatibility fields for applicants: lifestyle
  (student/professional/mixed), schedule preference, cleanliness
  expectations, social vs. quiet household — extending what
  `housemateProfile` already gestures at.
- Tie into Phase 4b's expense-tracking model for future shared-bill-splitting
  between co-tenants — don't build the splitting logic now, just don't design
  `Expense` in a way that blocks it later.

### Positioning
- Confirm with the person whether this should launch as part of the same
  search/listing surface as backroom rentals, or as a clearly distinct
  category/filter — it targets a different segment (students/young
  professionals in shared housing vs. the informal backroom/township core
  market) and mixing them without a clear filter could dilute both.

---

## Phase 7 — Dashboard & navigation UX audit (landlord and tenant portals)

Goal: the yard/property grouping is unclear, and the same clarity problem
likely exists across other dashboard tabs. Not every user is tech-savvy — the
whole portal experience needs to be frictionless, self-explanatory, and
forgiving of mistakes. Work through this phase in the sub-order below; each
step depends on the one before it.

### 7a — Route/nav-link integrity check (do this first, before any visual work)
- Audit every nav link (desktop dropdown, mobile drawer, mobile portal-nav
  strip) in the landlord portal against `landlord.routes.ts`, and the same
  for the tenant portal against `tenant.routes.ts`.
- Known discrepancies to verify specifically: the landlord nav links to
  `/landlord/billing` and `/landlord/my-rooms`, but the routes file only
  defines `dashboard`, `rooms/new`, `rooms/:roomId/edit`,
  `rooms/:roomId/applicants`, `verification`, `upgrade` — confirm whether
  `billing`/`my-rooms` routes exist elsewhere, are dead links, or the nav
  needs updating to point at real routes (e.g. `upgrade` instead of
  `billing`). Also confirm whether a `messages` route exists for either
  portal, and whether `verification` (landlord) and `passport` (tenant) are
  reachable from the nav at all, not just by direct URL.
- Fix any dead links found before proceeding. Report the full list of
  mismatches found, even ones already fixed, so there's a record of what was
  wrong.
- Pick one consistent label for anything found under two names (e.g.
  "Billing" vs. "Upgrade") and use it identically in the nav label, the route
  path, and the page heading.

### 7b — Yard/property management (from the earlier discussion)
- Add a dedicated "My Properties" screen/route, in the main nav, not hidden
  inside room creation.
- Each property shown as a card: editable nickname (not just raw address),
  full address in smaller text, thumbnail photo, room count badge (e.g. "4
  rooms — 2 vacant").
- Tapping a card opens the property's detail view: every room listed
  underneath with its own status, and clear per-room actions.
- Explicit, separately visible actions: "+ Add a new property" (primary
  button), "+ Add a room to this property" (from within a property's detail
  view, pre-filling the address), Edit (property nickname/address/shared
  amenities/house rules, separate from editing an individual room), Remove a
  room from a property (moves it to standalone, does not delete the
  listing), Delete a property (only with zero active rooms, or with an
  explicit choice about what happens to rooms still attached — never
  silently).
- Plain-language confirmation text for every destructive action, naming
  exactly what will and won't happen — not a generic "Are you sure?"
- A first-time empty state that teaches the concept in one sentence plus one
  button, not a wall of text (e.g. "A property groups rooms at the same
  address — like 'my backyard on Vilakazi Street.' Add your first property
  to get started.").
- During room creation, add a visual property picker (photo + nickname cards
  of existing properties) instead of a plain address dropdown, with an
  explicit "Is this room at an address where you already have another room
  listed?" prompt — this is likely where grouping currently breaks down,
  since landlords are probably creating rooms one at a time without
  realizing there's a grouping concept to opt into.
- Allow a landlord with only one address to ignore properties entirely and
  see a flat room list — don't force structure on someone who doesn't need
  it.

### 7c — Portfolio-wide views (applicants and messages)
- Applicants are currently scoped per-room only (`rooms/:roomId/applicants`),
  forcing a multi-room landlord to check every room individually. Add a
  portfolio-wide "All Applicants" view, filterable by room/property, sortable
  by newest/unread.
- Confirm whether messages are similarly locked per-application or already
  unified. If locked, add a single unified message inbox across all
  rooms/tenants.
- In the unified inbox, visually distinguish which channel a message came in
  on (`rentboard` vs. `whatsapp`, per the existing `MessageChannel` enum) —
  a landlord replying in the wrong channel is a real confusion risk worth
  designing against explicitly, not an edge case to skip.

### 7d — Dashboard home redesign (both portals)
- Redesign the dashboard home screen around one question: "What needs my
  attention right now?" — effectively pulling the Phase 5a task-inbox concept
  forward to be the dashboard's top section rather than a separate screen,
  with everything else (rooms, earnings, messages) secondary.
- Audit every number shown against the "plain English" principle already
  established in the UX spec doc (e.g. "Your room has been viewed 47 times
  this week. 3 people applied.") — confirm this is actually implemented in
  the real components, not just present in the original design doc.
- Add persistent, obvious "Add a room" / "Add a property" entry points on the
  landlord dashboard home, not nested inside a sub-screen.

### 7e — Mobile portal navigation fix
- Fix the existing known issue: `.portal-nav` sidebar is hidden below 768px
  with no adequate replacement — confirm the mobile horizontal nav strip
  (`.mobile-portal-nav`) is fully implemented and includes every real nav
  item from 7a (not a stale/incomplete subset), for both landlord and tenant
  portals.

### 7f — Tenant-side status clarity
- Application status values (`pending`/`viewed`/`shortlisted`/`accepted`/
  `rejected`/`withdrawn`) must display as warm, plain-English phrases to
  tenants, not raw enum values — e.g. "The landlord has seen your
  application" rather than "Viewed."
- Confirm the "Withdraw application" action has the same reversibility
  safety net (30-minute undo) promised elsewhere in the UX spec, or add it —
  don't leave this one action silently irreversible while others aren't.
- Confirm "My Passport" (verification/Renter's Passport) is reachable from a
  clearly labeled nav entry, not only via direct URL to `tenant/passport` —
  rename the generic "My profile" link if that's currently the only path to
  it, or add a second, clearly labeled entry point.

### 7g — Phone/WhatsApp signup and login (no email required)
Goal: many township landlords are WhatsApp-first and may not have or use
email. Today registration requires first name, last name, email and
password, and email drives magic-link login, password reset and
notifications. Add a phone-number path so a landlord can sign up and log in
with just their mobile number.

**Decision point — confirm before writing migrations (flag back, do not
decide unilaterally):** making email optional touches the `User` model
(email uniqueness/nullability, phone uniqueness), auth guards, the email
service, and every flow that assumes an email exists. Recommended default:
email becomes optional, phone becomes an alternative unique login
identifier, and at least one of the two is required at signup. Confirm this
before touching the schema, and report every place in the code that
assumes `user.email` is present.

- **Signup and login by one-time code:** user enters their mobile number,
  receives a 6-digit code via WhatsApp (SMS as fallback if WhatsApp delivery
  fails), enters it, and is signed in. This is the phone equivalent of the
  existing magic link and should mirror its security properties: single use,
  short expiry (e.g. 10 minutes), only a hash of the code stored, a new code
  invalidates older ones, and an identical response whether or not the
  number already has an account (no account-enumeration).
- **Rate limiting and abuse controls:** limit code requests per number and
  per IP, lock out after repeated wrong codes, and cap daily sends so this
  can't be used to spam numbers or run up messaging costs. Cross-check with
  the rate limiting work in Part 6 of the Full Program.
- **Number format:** normalise all South African numbers to E.164
  (+27...) on input, accepting 0-prefixed local formats.
- **WhatsApp template:** the OTP message needs an approved WhatsApp Business
  authentication template — check what's already approved/wired (per
  `.env.example` and the existing WhatsApp service) and document any Meta
  approval step still needed as a launch dependency.
- **Consent is captured by the user, not the helper:** the signup screen
  must show the Terms and Privacy Policy acceptance and the POPIA consent
  line, and the user must tick it themselves. Never allow an account to be
  created on someone's behalf without their own acceptance.
- **Assisted signup mode (supports the cold-call/white-glove onboarding
  flow):** a person helping a landlord sign up should be able to hand over
  their phone or stay on a call while the landlord enters their own number
  and code. No shared credentials and no admin-created accounts in the
  landlord's name.
- **Notification fallback:** anywhere the app currently sends an email
  (application received, new message, verification result, reminders from
  Phase 4a), a user with no email must receive the equivalent via WhatsApp
  (or in-app). Audit every email send point and add the fallback, otherwise
  a phone-only landlord will silently miss applications.
- **Account recovery for phone-only users:** a lost or changed number needs
  a recovery path (e.g. verify by code to a previously added second contact,
  or admin-assisted recovery with identity checks logged in the Part 4 audit
  trail). Design this now, since a phone number is easier to lose or
  recycle than an email address.
- **Optional email later:** let a phone-only user add an email afterwards
  (with verification) from account settings, so they can gain magic link and
  email receipts without being forced to at signup.
- **Keep existing flows intact:** email/password, Google sign-in and magic
  link must continue to work unchanged — this is an additional path, not a
  replacement. Add tests for both paths and update `scripts/smoke-test.sh`.
- Update the registration copy (already short and plain) to offer "Sign up
  with your phone number" as a clear, equal-weight option, not a hidden
  link.

### Notes for Phase 7
- Do not start 7b–7g until 7a is complete and reported — fixing dead links
  first prevents wasted design/build effort on screens layered on top of a
  broken route.
- This phase is UX/information-architecture work as much as code — where a
  redesign is non-trivial (7b, 7d in particular), produce a short written
  description or simple wireframe of the proposed layout and check it back
  before implementing, rather than shipping a full redesign unreviewed.
- Apply the same plain-English, reversible-by-default, one-clear-primary-
  action-per-screen principles throughout, consistent with
  `RentBoard-UX-WhatsApp-Data.html`.

---

## Throughout all phases

- Angular CLI: use `ng generate component/service/guard` for anything new
  rather than hand-rolling boilerplate, matching existing project
  conventions. Run `ng build --configuration=production` before considering
  any phase done, to catch prod-only build errors early.
- Every new user-facing flow needs a corresponding update to
  `scripts/smoke-test.sh` if it touches the API.
- Update `RentBoard-PRE-LAUNCH-CHECKLIST.md` and `RentBoard-FLOW-AUDIT.md` as
  each gap closes, matching the existing pattern (mark items done, note
  version).
- Add/update JSDoc or docblocks on new services and components, consistent
  with the existing style (see `TenantProfile` schema comments as the model).
- Commit with conventional commit messages (`feat:`, `fix:`, `docs:`) at each
  meaningful checkpoint, not one commit per phase. Tag a release (e.g.
  `v1.10.0`) at the end of each completed phase, and update the version
  reference in the README's changelog-style sections.
- Run the existing smoke test suite before merging each feature branch.
- Flag anywhere Lighthouse/performance could regress (e.g. new dashboard
  views with heavy data tables) and address before merging, not after.
- Any point where a phase would touch money custody, deposits, or legal
  document execution — stop and flag explicitly rather than proceeding.
