# Design brief — Mastande

For an external design-system and information-architecture engagement.

Both source documents are now in `source-documents/` and are quoted directly
below. Everything else is quoted from the repository, cited per quotation.

> **One naming note before anything else.** The brand document is titled
> *RentBoard ZA* and says "RentBoard" throughout. The product rebranded to
> **Mastande** and the codebase is fully converted — one mention of the old name
> survives, in a code comment. Treat the brand document's *substance* as current
> and its *name usage* as superseded. Section 2 lists three places where its
> substance is stale too.

---

## 1. Positioning

Verbatim from `source-documents/RentBoard-ZA-Brand-Positioning-Messaging.md`:

> **Why we exist —** South Africans looking for a room to rent are stuck
> choosing between two bad options: pay an estate agent commission neither party
> asked for, or scroll endless, unmoderated Facebook groups and Gumtree ads
> hoping the listing (and the landlord) is real.

> **Positioning statement —** For South African landlords and tenants who are
> tired of agent fees and unsafe classifieds, RentBoard is the room-letting
> notice board that connects them directly — because unlike Property24, Private
> Property, or Facebook Marketplace, RentBoard is **built specifically for
> rooms**, is **free at the core**, and is **fully aligned with South African
> law** (POPIA, Rental Housing Act, PIE Act).

> **One-line version —** *RentBoard — South Africa's room-letting notice board.
> Direct from landlords. No agent fees. Ever.*

### The four messaging pillars, verbatim

> **Pillar 1 — "No Agent Fees, Ever"** The founding promise. Tenants never pay
> to apply. Landlords get 2 free listings for life. This is the wedge against
> Property24/Private Property's agent-driven model.

> **Pillar 2 — "Built for South Africa, Not Translated Into It"** 11 official
> languages, ZAR throughout, province-based search, Rental Housing Tribunal
> numbers in every disclaimer, POPIA compliance front and centre — not GDPR with
> the labels swapped.

> **Pillar 3 — "Safer Than a Facebook Group"** Verified landlord badges,
> Renter's Passport (ID/income/credit verification), moderated listings, no
> upfront payment required to view a room. Directly answers the #1 fear: rental
> scams.

> **Pillar 4 — "Whatsapp-Simple"** Landlords who don't want another app to learn
> can just reply on WhatsApp. Meets non-tech-savvy landlords where they already
> are.

### Voice — the part that most constrains design

> **Personality:** Straight-talking neighbour who happens to know the law. Warm,
> plain-spoken, a little proudly South African — never corporate, never preachy.

| We are | We are not |
|---|---|
| Direct and plain-English | Jargon-heavy or "corporate legal speak" |
| Warm, community-minded | Cold or transactional |
| Confidently South African (local references, all languages, ZAR) | A generic UK/US template with the currency swapped |
| Reassuring about safety, without fear-mongering | Alarmist about scams |
| Helpful first, sales second | Pushy or hype-driven |

> **Words we use:** free, direct, verified, your room, your rules, sorted, no
> middleman
> **Words we avoid:** disrupt, revolutionize, seamless, leverage, best-in-class,
> ecosystem

Also binding on any new surface, verbatim from §9 Terminology:

> - Say **"room-letting"**, not "room rental listing platform"
> - Say **"landlord"** and **"tenant"**, not "host"/"guest" (avoids Airbnb confusion)
> - Say **"apply"**, not "book" or "reserve"
> - Always **"free to apply"** — repeat this everywhere, it's the core hook
> - Currency always **"R"** prefix with space-separated thousands (R 5 500), never "ZAR" in consumer copy

### What that means for design

The single promise is **no fee and no agent**. A visual language that reads as
premium, gated or agency-like works against the one reason somebody leaves a
Facebook group. Trust here is not conveyed by polish — it is conveyed by
**saying what the platform does not do**, out loud, on screen. Three standing
rules in `CLAUDE.md` exist to keep that honest: the platform never holds rent or
a deposit; nothing signed here has legal effect; documents are deleted and only
outcomes persist. Those sentences are product, not footer boilerplate.

---

## 2. ⚠️ Three places the brand document and the shipped product disagree

Checked against the code, not assumed. A designer working from the brand
document alone would get all three wrong.

### 2a. "2 free listings for life" — the product gives unlimited

Pillar 1 and §4 both say landlords get **2 free listings**. The live pricing
page says:

> Free to list. Free to apply. · **Unlimited listings** · Unlimited applications

`frontend/src/app/core/config/feature-flags.ts` confirms it is deliberate:

> Every landlord is on an unlimited free tier (unlimited listings, 20
> photos/room, one-click relist), and that is the product, not a pause.

And `CLAUDE.md` makes it a standing constraint: *"No landlord listing fee and no
tenant application fee, ever."* **The product is more generous than the
marketing.** Any new copy should say unlimited.

### 2b. "Renter's Passport (ID/income/credit verification)" — there is no credit check

Pillar 3 names credit verification. Phase 1 of the implementation prompt
explicitly replaced it, and the code agrees. From
`frontend/.../passport-verify.ts`:

> The checks are deliberately not a credit check. A bureau record needs a credit
> history, and most people looking for a room here do not have one.

The real proofs are SASSA confirmation, employer confirmation, bank-app
screenshots and a structured prior-landlord reference. **This is a positioning
asset, not a gap** — it is precisely the "built for South Africa, not translated
into it" pillar made concrete, and the brand document undersells it.

### 2c. Two different competitive sets

The brand document positions against **Property24, Private Property and Facebook
Marketplace**. `CLAUDE.md` and the implementation prompt both name **RoomKing
and AmaRoom** as the direct competitors:

> It competes with RoomKing and AmaRoom on verification depth, landlord tooling
> and trust-tied monetisation.

Both are probably true at different altitudes — Property24 is the category
incumbent, RoomKing/AmaRoom are the direct rivals. But they imply different
design priorities, and nothing reconciles them. **Worth settling before any
visual direction is chosen.**

---

## 3. Who this is for

The brand document's two personas, verbatim:

> **Landlord persona: "Thandiwe, the Side-Income Landlord"**
> - Owns 1–3 rooms/units, not a full-time property manager
> - Currently uses WhatsApp groups, Facebook, word of mouth
> - Pain: vetting tenants is stressful and time-consuming; agents take a cut she
>   can't justify for one room
> - Wants: qualified applicants, fast replies, doesn't want to learn new software

> **Tenant persona: "Sipho, the Relocating Professional/Student"**
> - Moving cities for work or study, needs a room fast
> - Pain: scared of scams (pay-before-you-view), tired of "no DSS/SASSA" style
>   exclusion, agent fees eat into deposit budget
> - Wants: verified listings, ability to filter by what matters (bills included,
>   pet-friendly, near transport), speed

`CLAUDE.md` states the same person more bluntly, and this is the line the whole
codebase is written against:

> the person it is built for has **four back rooms and a cheap Android phone**,
> not a portfolio and a spreadsheet.

### Township- and informal-economy-inclusive

Not a value statement — a set of decisions already taken in the schema:

- **`User.email` is nullable.** The schema comment: *"Many township landlords
  are WhatsApp-first and do not use email at all."*
- **The Renter's Passport accepts informal-economy proofs** — SASSA payment
  confirmation, employer confirmation, bank-app screenshots, a prior-landlord
  reference — because, per Phase 1, *"the target market largely doesn't have
  bureau credit history."*
- **Tone is non-judgmental about SASSA/DSS status.** The brand document makes
  this explicit for tenant-facing copy. It is a design constraint on empty
  states and error messages as much as on marketing.

### Eleven official languages

Every public route is mounted twice — bare for English, under `/:lang/` for the
other ten. English is deliberately unprefixed. Copy length varies a lot between
languages and the layouts must take it.

### WhatsApp-first — and currently switched off

The most important nuance in this brief. Pillar 4 is "Whatsapp-Simple" and
Phase 7g builds phone-number signup on it. `CLAUDE.md` records where that now
stands:

> **WhatsApp-first is still the goal.** It is switched off because of cost, not
> because it was the wrong idea, and it goes back on when the business can carry
> it. Treat it as paused work, not dead code.

Meta bills per message (≈ USD $0.0095 + VAT per sign-in code to a South African
number, from the first one, no free allowance) and the product is free to use —
a per-head cost with no revenue behind it. **Design for it coming back.** Phone
sign-in screens still exist and refuse with an honest message; `wa.me` share
links were kept throughout, because they open the person's own WhatsApp and cost
nothing.

⚠️ **The open consequence:** today a person with **no email address has no way
into the product at all** — exactly the user Phase 7g was written for, and
exactly the user the schema was shaped around. Known and accepted
(`docs/OUTSTANDING.md` §29). **This is the single most valuable thing an IA
engagement could help solve.**

⚠️ Note also that Phase 7g specifies *"SMS as fallback if WhatsApp delivery
fails."* **No SMS provider was ever built.** WhatsApp is the only delivery a
phone code has ever had, which is why switching it off closed the door
completely rather than degrading.

### Not assumed tech-savvy — what that means concretely here

- A tap target under **44px** is a defect (WCAG 2.5.8); one audit found 29
  inputs between 30px and 37px.
- Horizontal page scroll is the first item on the mobile checklist.
- Urgency is never conveyed by colour alone — every urgent row says so in words.
- There is a per-screen first-use hint system and a walkthrough, because
  "nobody remembers a card about applicants when they reach the applicants
  screen a week later."

---

## 4. Known UX issues — Phase 7, verbatim

What follows is **Phase 7 of `source-documents/Mastande-ClaudeCode-Implementation-Prompt.md`
reproduced in full and unedited.** Status annotations follow it; nothing inside
the quotation has been changed.

> ## Phase 7 — Dashboard & navigation UX audit (landlord and tenant portals)
>
> Goal: the yard/property grouping is unclear, and the same clarity problem
> likely exists across other dashboard tabs. Not every user is tech-savvy — the
> whole portal experience needs to be frictionless, self-explanatory, and
> forgiving of mistakes. Work through this phase in the sub-order below; each
> step depends on the one before it.
>
> ### 7a — Route/nav-link integrity check (do this first, before any visual work)
> - Audit every nav link (desktop dropdown, mobile drawer, mobile portal-nav
>   strip) in the landlord portal against `landlord.routes.ts`, and the same
>   for the tenant portal against `tenant.routes.ts`.
> - Known discrepancies to verify specifically: the landlord nav links to
>   `/landlord/billing` and `/landlord/my-rooms`, but the routes file only
>   defines `dashboard`, `rooms/new`, `rooms/:roomId/edit`,
>   `rooms/:roomId/applicants`, `verification`, `upgrade` — confirm whether
>   `billing`/`my-rooms` routes exist elsewhere, are dead links, or the nav
>   needs updating to point at real routes (e.g. `upgrade` instead of
>   `billing`). Also confirm whether a `messages` route exists for either
>   portal, and whether `verification` (landlord) and `passport` (tenant) are
>   reachable from the nav at all, not just by direct URL.
> - Fix any dead links found before proceeding. Report the full list of
>   mismatches found, even ones already fixed, so there's a record of what was
>   wrong.
> - Pick one consistent label for anything found under two names (e.g.
>   "Billing" vs. "Upgrade") and use it identically in the nav label, the route
>   path, and the page heading.
>
> ### 7b — Yard/property management (from the earlier discussion)
> - Add a dedicated "My Properties" screen/route, in the main nav, not hidden
>   inside room creation.
> - Each property shown as a card: editable nickname (not just raw address),
>   full address in smaller text, thumbnail photo, room count badge (e.g. "4
>   rooms — 2 vacant").
> - Tapping a card opens the property's detail view: every room listed
>   underneath with its own status, and clear per-room actions.
> - Explicit, separately visible actions: "+ Add a new property" (primary
>   button), "+ Add a room to this property" (from within a property's detail
>   view, pre-filling the address), Edit (property nickname/address/shared
>   amenities/house rules, separate from editing an individual room), Remove a
>   room from a property (moves it to standalone, does not delete the
>   listing), Delete a property (only with zero active rooms, or with an
>   explicit choice about what happens to rooms still attached — never
>   silently).
> - Plain-language confirmation text for every destructive action, naming
>   exactly what will and won't happen — not a generic "Are you sure?"
> - A first-time empty state that teaches the concept in one sentence plus one
>   button, not a wall of text (e.g. "A property groups rooms at the same
>   address — like 'my backyard on Vilakazi Street.' Add your first property
>   to get started.").
> - During room creation, add a visual property picker (photo + nickname cards
>   of existing properties) instead of a plain address dropdown, with an
>   explicit "Is this room at an address where you already have another room
>   listed?" prompt — this is likely where grouping currently breaks down,
>   since landlords are probably creating rooms one at a time without
>   realizing there's a grouping concept to opt into.
> - Allow a landlord with only one address to ignore properties entirely and
>   see a flat room list — don't force structure on someone who doesn't need
>   it.
>
> ### 7c — Portfolio-wide views (applicants and messages)
> - Applicants are currently scoped per-room only (`rooms/:roomId/applicants`),
>   forcing a multi-room landlord to check every room individually. Add a
>   portfolio-wide "All Applicants" view, filterable by room/property, sortable
>   by newest/unread.
> - Confirm whether messages are similarly locked per-application or already
>   unified. If locked, add a single unified message inbox across all
>   rooms/tenants.
> - In the unified inbox, visually distinguish which channel a message came in
>   on (`rentboard` vs. `whatsapp`, per the existing `MessageChannel` enum) —
>   a landlord replying in the wrong channel is a real confusion risk worth
>   designing against explicitly, not an edge case to skip.
>
> ### 7d — Dashboard home redesign (both portals)
> - Redesign the dashboard home screen around one question: "What needs my
>   attention right now?" — effectively pulling the Phase 5a task-inbox concept
>   forward to be the dashboard's top section rather than a separate screen,
>   with everything else (rooms, earnings, messages) secondary.
> - Audit every number shown against the "plain English" principle already
>   established in the UX spec doc (e.g. "Your room has been viewed 47 times
>   this week. 3 people applied.") — confirm this is actually implemented in
>   the real components, not just present in the original design doc.
> - Add persistent, obvious "Add a room" / "Add a property" entry points on the
>   landlord dashboard home, not nested inside a sub-screen.
>
> ### 7e — Mobile portal navigation fix
> - Fix the existing known issue: `.portal-nav` sidebar is hidden below 768px
>   with no adequate replacement — confirm the mobile horizontal nav strip
>   (`.mobile-portal-nav`) is fully implemented and includes every real nav
>   item from 7a (not a stale/incomplete subset), for both landlord and tenant
>   portals.
>
> ### 7f — Tenant-side status clarity
> - Application status values (`pending`/`viewed`/`shortlisted`/`accepted`/
>   `rejected`/`withdrawn`) must display as warm, plain-English phrases to
>   tenants, not raw enum values — e.g. "The landlord has seen your
>   application" rather than "Viewed."
> - Confirm the "Withdraw application" action has the same reversibility
>   safety net (30-minute undo) promised elsewhere in the UX spec, or add it —
>   don't leave this one action silently irreversible while others aren't.
> - Confirm "My Passport" (verification/Renter's Passport) is reachable from a
>   clearly labeled nav entry, not only via direct URL to `tenant/passport` —
>   rename the generic "My profile" link if that's currently the only path to
>   it, or add a second, clearly labeled entry point.
>
> ### 7g — Phone/WhatsApp signup and login (no email required)
> Goal: many township landlords are WhatsApp-first and may not have or use
> email. Today registration requires first name, last name, email and
> password, and email drives magic-link login, password reset and
> notifications. Add a phone-number path so a landlord can sign up and log in
> with just their mobile number.
>
> **Decision point — confirm before writing migrations (flag back, do not
> decide unilaterally):** making email optional touches the `User` model
> (email uniqueness/nullability, phone uniqueness), auth guards, the email
> service, and every flow that assumes an email exists. Recommended default:
> email becomes optional, phone becomes an alternative unique login
> identifier, and at least one of the two is required at signup. Confirm this
> before touching the schema, and report every place in the code that
> assumes `user.email` is present.
>
> - **Signup and login by one-time code:** user enters their mobile number,
>   receives a 6-digit code via WhatsApp (SMS as fallback if WhatsApp delivery
>   fails), enters it, and is signed in. This is the phone equivalent of the
>   existing magic link and should mirror its security properties: single use,
>   short expiry (e.g. 10 minutes), only a hash of the code stored, a new code
>   invalidates older ones, and an identical response whether or not the
>   number already has an account (no account-enumeration).
> - **Rate limiting and abuse controls:** limit code requests per number and
>   per IP, lock out after repeated wrong codes, and cap daily sends so this
>   can't be used to spam numbers or run up messaging costs. Cross-check with
>   the rate limiting work in Part 6 of the Full Program.
> - **Number format:** normalise all South African numbers to E.164
>   (+27...) on input, accepting 0-prefixed local formats.
> - **WhatsApp template:** the OTP message needs an approved WhatsApp Business
>   authentication template — check what's already approved/wired (per
>   `.env.example` and the existing WhatsApp service) and document any Meta
>   approval step still needed as a launch dependency.
> - **Consent is captured by the user, not the helper:** the signup screen
>   must show the Terms and Privacy Policy acceptance and the POPIA consent
>   line, and the user must tick it themselves. Never allow an account to be
>   created on someone's behalf without their own acceptance.
> - **Assisted signup mode (supports the cold-call/white-glove onboarding
>   flow):** a person helping a landlord sign up should be able to hand over
>   their phone or stay on a call while the landlord enters their own number
>   and code. No shared credentials and no admin-created accounts in the
>   landlord's name.
> - **Notification fallback:** anywhere the app currently sends an email
>   (application received, new message, verification result, reminders from
>   Phase 4a), a user with no email must receive the equivalent via WhatsApp
>   (or in-app). Audit every email send point and add the fallback, otherwise
>   a phone-only landlord will silently miss applications.
> - **Account recovery for phone-only users:** a lost or changed number needs
>   a recovery path (e.g. verify by code to a previously added second contact,
>   or admin-assisted recovery with identity checks logged in the Part 4 audit
>   trail). Design this now, since a phone number is easier to lose or
>   recycle than an email address.
> - **Optional email later:** let a phone-only user add an email afterwards
>   (with verification) from account settings, so they can gain magic link and
>   email receipts without being forced to at signup.
> - **Keep existing flows intact:** email/password, Google sign-in and magic
>   link must continue to work unchanged — this is an additional path, not a
>   replacement. Add tests for both paths and update `scripts/smoke-test.sh`.
> - Update the registration copy (already short and plain) to offer "Sign up
>   with your phone number" as a clear, equal-weight option, not a hidden
>   link.
>
> ### Notes for Phase 7
> - Do not start 7b–7g until 7a is complete and reported — fixing dead links
>   first prevents wasted design/build effort on screens layered on top of a
>   broken route.
> - This phase is UX/information-architecture work as much as code — where a
>   redesign is non-trivial (7b, 7d in particular), produce a short written
>   description or simple wireframe of the proposed layout and check it back
>   before implementing, rather than shipping a full redesign unreviewed.
> - Apply the same plain-English, reversible-by-default, one-clear-primary-
>   action-per-screen principles throughout, consistent with
>   `RentBoard-UX-WhatsApp-Data.html`.

---

## 5. Phase 7 — where each item actually stands

Checked against the code, not against the plan. The prompt's ordering rule —
*"Do not start 7b–7g until 7a is complete and reported"* — was followed.

| | Status | What the repository records |
|---|---|---|
| **7a** route/nav integrity | ✅ Done, and the audit itself was the bug | `route-audit.mjs` compared **only the first path segment**, so `/landlord/billing` and `/landlord/my-rooms` — the two dead links the prompt names — both passed, because `landlord` is a real area. It printed *"every internal routerLink resolves to a declared route"* while being structurally incapable of checking the claim. Replaced by `nav-audit.mjs`: full-path resolution of 111 links. |
| **7b** property grouping | ⚠️ Partly | `/landlord/properties` with cards, a detail view, and a teaching empty state all exist. But grouping stayed **optional**, so the IA still has two shapes for one concept, and the ungrouped case is reached by a **sentinel path segment** (`/landlord/properties/ungrouped` is `:propertyId` with a magic string). A room could also be taken *out* of a property and never put back — a one-way door, reported twice before it was found. |
| **7c** portfolio-wide views | ✅ Done | `/landlord/applicants` and `/account/messages`. Before this, *"a landlord with six rooms and eleven applicants had seventeen screens to open."* One inbox for both roles, in `/account`, because a sub-lessor is a tenant who also lets a room. Channel is shown per message, as 7c requires. |
| **7d** dashboard home | ✅ Done | "Needs you" leads both dashboards. The three overlapping stat boxes ("Applications / Shortlisted / Awaiting reply", where the last two summed to the first) are gone, replaced by a sentence. |
| **7e** mobile portal nav | ⚠️ Fixed, still the weakest area | The strip exists — then measured at **2,251px of nav inside a 359px window**, showing two of fourteen items with no cue it scrolled. A fade and scroll-into-view were added. Separately, a signed-in person on a public page had **no way back to their portal** except the hamburger. |
| **7f** tenant status clarity | ✅ Done | Plain-English statuses; "Needs you" rows carry the action. |
| **7g** phone/WhatsApp signup | 🔴 **Built, then switched off** | Fully implemented — OTP, E.164 normalisation, rate limiting, assisted signup, self-captured consent. Then disabled on cost (§3). ⚠️ The prompt specifies *"SMS as fallback if WhatsApp delivery fails"* — **that fallback was never built**, which is why switching WhatsApp off closed the door completely instead of degrading. |

### The two highest-value IA problems left

1. **Portal navigation on a phone.** Fourteen items in a horizontally
   scrolling strip is a workaround. This is 7e's unfinished half and the most
   reported area in the product.
2. **What "a property" means to someone with four back rooms behind one
   house.** 7b shipped the screens but not the concept. Optional grouping plus
   a sentinel route is the symptom.

---

## 6. Constraints a design cannot override

From `CLAUDE.md`, which calls breaking any of these *"a product decision, not a
refactor"*:

| | |
|---|---|
| **Free to list, free to apply** | No landlord listing fee, no tenant application fee, ever. Third-party fees (advertisers, contractors receiving leads) are separate. The prompt repeats this: *"Do NOT introduce any landlord listing fee or tenant application fee — this breaks the core 'free to list, free to apply' positioning."* |
| **No money custody** | The platform never holds rent or deposits. The rent tracker is the landlord's own record and says so on screen. |
| **No legal execution** | No digital signature has legal effect. *"Mastande does not verify or execute the lease."* |
| **POPIA** | Documents stay private, deleted on a retention schedule, only outcomes persist. Prefer not collecting a field to collecting and hiding it. |
| **Mobile-first, verified** | 360 / 390 / 768 / 1280px; breakpoints 900 / 768 / 480. A design is not done if desktop works and the phone does not. |
| **Eleven languages** | Every public route exists under `/:lang/` as well as bare. |

---

## 7. What else is in this folder

| File | What it is |
|---|---|
| `ROUTE-INVENTORY.md` | All 73 routes parsed from `*.routes.ts`, with components and inherited guards. |
| `TOKENS-CURRENT.md` | Every colour, font, spacing, radius and shadow **actually in use**, counted — 33 tokens used 671 times beside 158 literal colours used 330 times, 106 of them exactly once, plus 14 clusters of perceptually identical values. |
| `COMPONENT-INVENTORY.md` | All 83 standalone components by portal, described in their own doc comments. |
| `source-documents/` | The brand positioning guide and the full implementation prompt, unmodified. |
| `tools/` | The three generators. Re-run them; do not hand-edit their output. |

`docs/FLOW-AUDIT.md` maps the state machines and `docs/OUTSTANDING.md` is the
running list of known gaps with the reasoning behind each. Both are more current
than any summary of them.

---

## 8. The habit this codebase was built around

Worth knowing, because it will shape what "done" means. From `CLAUDE.md`:

> This codebase has repeatedly shipped **controls that only look like controls**:
> a `MAX_ATTEMPTS` nothing read, a `documentDeletedAt` that deleted nothing,
> nineteen `@Throttle` decorators with no guard registered, a `Message.readAt`
> nobody wrote, a notice channel nobody could read, a nav audit structurally
> incapable of seeing a dead link, and a rent-reminder control on a screen with
> no route.
>
> So: **change it, drive it, then reintroduce the bug and confirm the check
> fails.** A check that cannot fail is not a check.

7a is that habit's own origin story — the nav audit was itself one of these.

A design handed over as static artwork will meet this culture. A design handed
over with a rule that can fail a build — a token lint, a contrast gate, a
target-size check — will survive contact with it. The repo already runs
`scripts/css-coverage-audit.mjs`, `scripts/a11y-drive.mjs` and
`scripts/layout-ui-drive.mjs`, so that enforcement has somewhere to land.
