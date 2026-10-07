# Design brief — Mastande

For an external design-system and information-architecture engagement.

> ## ⚠️ Read this first: two named source documents are not in this repository
>
> The request for this handoff asked for brand positioning pulled from
> **`RentBoard-ZA-Brand-Positioning-Messaging.md`**, and for Phase 7 of
> **`Mastande-ClaudeCode-Implementation-Prompt.md`** quoted verbatim, with a
> copy of that prompt included in this folder.
>
> **Neither file exists here.** Not in the working tree, not in `docs/`, and not
> anywhere in git history — `git log --all` finds no trace of either having been
> tracked. Nothing in the repository references them by name.
>
> So this brief does **not** quote them, and nothing below is reconstructed from
> memory of what they might say. Every quotation is from a file that is in this
> repository, and each one is cited. If you have those two documents, add them
> to `/design-handoff/` and treat them as authoritative where they differ from
> what follows.

---

## 1. Positioning

Quoted from `README.md`, which states that this wording is canonical and
deliberately not paraphrased:

> **Rooms to rent, direct from landlords. Free to apply, always.**

> **Mission —** Mastande ZA gives South African landlords and tenants a direct
> line to each other. Landlords post rooms in minutes; tenants apply for free,
> always. No estate agent in the middle, no application fees, all prices in
> Rand, and every step built to South African law.

> **Vision —** To be the first place anyone in South Africa looks for a room —
> and the standard the rest of the world copies for direct, agent-free room
> letting.

> **North Star:** rooms successfully let per month. It is the only metric that
> requires both sides of the marketplace to have worked.

From `CLAUDE.md`, on who the competition is and why anyone switches:

> It competes with RoomKing and AmaRoom on verification depth, landlord tooling
> and trust-tied monetisation.

> **No landlord listing fee and no tenant application fee, ever.** That is the
> position against RoomKing, AmaRoom, Facebook and Gumtree, and it is the reason
> anybody switches.

### What that means for design

The product's single promise is **no fee and no agent**. Any visual language
that reads as premium, gated, or agency-like works against the one reason
somebody leaves a Facebook group for this. Trust here is not conveyed by polish —
it is conveyed by **saying what the platform does not do**, out loud, on screen.
Three standing rules in `CLAUDE.md` exist purely to keep that honest:

- the platform never holds rent or a deposit, and the rent screen says so;
- nothing signed here has legal effect, and the lease screen says so;
- documents are deleted and only outcomes persist (POPIA s.10 minimality).

Those sentences are product, not legal boilerplate. They need to be designed,
not hidden in a footer.

---

## 2. Who this is for

From `CLAUDE.md`, the one-line definition the whole codebase is written against:

> the person it is built for has **four back rooms and a cheap Android phone**,
> not a portfolio and a spreadsheet.

Expanded, because every one of these has already changed a decision in the code:

**South African, township- and informal-economy-inclusive.**
`User.email` is nullable. The schema's own comment explains why:

> Many township landlords are WhatsApp-first and do not use email at all.

The Renter's Passport accepts **informal-economy proofs** of income, not
payslips. Prices are in Rand everywhere, with no currency switcher. The product
is aligned to the Rental Housing Act 50 of 1999 and POPIA, and says so.

**Eleven official languages.** Every public route is mounted twice — bare for
English and under `/:lang/` for the other ten. English is deliberately
unprefixed. Any new surface inherits this; copy length will vary a lot between
languages and the layouts have to take it.

**WhatsApp-first — and currently switched off.** This is the most important
nuance in the brief. `CLAUDE.md`:

> **WhatsApp-first is still the goal.** It is switched off because of cost, not
> because it was the wrong idea, and it goes back on when the business can carry
> it. Treat it as paused work, not dead code.

Meta bills per message (≈ USD $0.0095 + VAT per sign-in code to a South African
number, from the first one, no free allowance) and the product is free to use,
so it is a per-head cost with no revenue behind it. **Design for it coming
back.** Phone sign-in screens still exist and currently refuse with an honest
message; `wa.me` share links were kept throughout because they open the
person's own WhatsApp and cost nothing.

⚠️ **The open consequence, stated plainly:** today a person with **no email
address has no way into the product at all.** That is the exact user the schema
was shaped around. It is a known, accepted gap (`docs/OUTSTANDING.md` §29), and
it is the most important thing an IA engagement could help solve.

**Not assumed tech-savvy.** Concretely, in this codebase:

- A tap target under **44px** is a defect (WCAG 2.5.8), and a past audit found
  29 inputs between 30px and 37px.
- Horizontal page scroll is the first item on the mobile checklist.
- Urgency is never conveyed by colour alone — every urgent row says so in words.
- There is a per-screen first-use hint system and a walkthrough, because
  "nobody remembers a card about applicants when they reach the applicants
  screen a week later."

---

## 3. Known UX issues

⚠️ **Source note.** The request asked for Phase 7 of the implementation prompt
quoted verbatim. That document is not in this repository (see the box at the
top). What follows quotes the repository's **own record of what Phase 7 found**
— `PRE-LAUNCH-CHECKLIST.md` rows 61–63 and `frontend/src/styles/_responsive.scss`
— which cover the four areas the request names. These are the findings as
written at the time, not a summary of them.

### 3a. Route and nav mismatches

`PRE-LAUNCH-CHECKLIST.md` row 61, verbatim:

> **Phase 7a: the audit that was supposed to catch dead nav links could not see
> them.** `route-audit.mjs` compared only the FIRST SEGMENT of each link against
> the set of known areas — `routerLink="/([a-z0-9-]+)"` — so `/landlord/billing`
> and `/landlord/my-rooms`, the two dead links the brief names, would both have
> passed because `landlord` is a real area. It printed "every internal
> routerLink resolves to a declared route" while being structurally incapable of
> checking the claim.

> **Real findings, after that:** "My Rooms" opened a section headed "Active
> listings" (two names, and a landlord whose rooms were all drafts read "No
> rooms listed yet" while holding three — Drafts now has an id, a nav entry and
> a count); "Applicants" pointed at `#active-listings`, naming a destination
> that does not exist […]

**Status: fixed, and the class recurs.** Later phases found a "Needs you" tab
pointing at an element that did not exist, and three drives auditing a URL that
had become a redirect four releases earlier. **For the engagement:** nav labels
and destination headings must agree, and a fragment-linked section that renders
conditionally is a dead link waiting to happen.

### 3b. Unclear property grouping

`PRE-LAUNCH-CHECKLIST.md` row 62, verbatim:

> **Phase 7b: grouping existed and nobody could find it.** It was reachable only
> from inside the yard screen, below the rent tracking and the expenses, behind
> a button reading "+ Group rooms into a yard" — so the concept was something a
> landlord discovered while doing something else, if they scrolled far enough,
> under a word used nowhere else in the product. That is the brief's diagnosis
> of why landlords create rooms one at a time without grouping them, and the
> screen bore it out.

**Status: partly fixed, still the weakest concept in the product.** There is now
a list at `/landlord/properties` and a detail view per property. But grouping
remains **optional** — a room can belong to no property — which means the IA has
two parallel shapes for the same thing, and the "ungrouped" case is reached
through a **sentinel path segment** (`/landlord/properties/ungrouped` is
`:propertyId` with a magic string, not a route). A later phase also found that
a room could be taken *out* of a property but never put back: a one-way door,
reported twice by the owner before it was found.

**For the engagement:** this is the clearest candidate for an IA rethink. What
is a "property" to someone with four back rooms behind one house?

### 3c. Missing portfolio-wide views

`PRE-LAUNCH-CHECKLIST.md` row 63, verbatim:

> 🔴 **Applicants and messages had no home, and building one found two defects
> that could not error.** Both lists lived only inside a single room or a single
> application, so a landlord with six rooms and eleven applicants had
> **seventeen screens** to open before they knew whether anybody had written to
> them — and both portal navs listed "Messages" greyed out with a "Soon" chip
> […] because the entry was a promise nothing kept.

**Status: fixed.** `/landlord/applicants` and `/account/messages` now exist.
**For the engagement:** the per-entity-only pattern is a recurring trap in this
product. Rent, documents and viewings each still live mostly inside one tenancy.

### 3d. Mobile navigation gaps

`frontend/src/styles/_responsive.scss`, verbatim:

> The sidebar becomes a horizontal strip, it does not disappear.
>
> This was `display: none` with nothing replacing it, and the top hamburger
> carries only public links plus a Dashboard button — so on a phone **every
> portal screen except the dashboard was unreachable**: Rent, the Renter's
> Passport, My property, Verification, Settings. On a product built for people
> on cheap phones that is most of the app.

**Status: fixed, and still the most-reported area.** The replacement is a
horizontally scrolling strip — and measurement found it **2,251px of nav inside
a 359px window**, showing two of fourteen items with no cue that it scrolled, so
a fade and a scroll-into-view had to be added. Separately, a signed-in person on
a public page had **no way back to their own portal** except the hamburger,
because one rule hid every ghost button.

**For the engagement: portal navigation on a phone is the single biggest open
design problem.** Fourteen items in a scrolling strip is a workaround, not a
solution.

---

## 4. Constraints a design cannot override

These are decided, and `CLAUDE.md` calls breaking them "a product decision, not
a refactor":

| | |
|---|---|
| **Free to list, free to apply** | No landlord listing fee, no tenant application fee, ever. Third-party fees (advertisers, contractors receiving leads) are separate. |
| **No money custody** | The platform never holds rent or deposits. The rent tracker is the landlord's own record and says so on screen. |
| **No legal execution** | No digital signature has legal effect. The lease screen says nothing was signed here. |
| **POPIA** | Documents stay private, are deleted on a retention schedule, and only outcomes persist. Prefer not collecting a field to collecting and hiding it. |
| **Mobile-first, verified** | 360 / 390 / 768 / 1280px. Breakpoints are 900 / 768 / 480. A design is not done if desktop works and the phone does not. |
| **Eleven languages** | Every public route exists under `/:lang/` as well as bare. |

---

## 5. What else is in this folder

| File | What it is |
|---|---|
| `ROUTE-INVENTORY.md` | All 73 routes, parsed from `*.routes.ts`, with components and inherited guards. |
| `TOKENS-CURRENT.md` | Every colour, font, spacing, radius and shadow **actually in use**, counted — including 158 literal colours bypassing 33 design tokens, and 14 clusters of perceptually identical values. |
| `COMPONENT-INVENTORY.md` | All 83 standalone components by portal, described in their own words. |
| `tools/` | The three generators. Re-run them; do not hand-edit their output. |

The repository's own `docs/FLOW-AUDIT.md` maps the state machines, and
`docs/OUTSTANDING.md` is the running list of known gaps with the reasoning
behind each. Both are more current than any summary of them.

---

## 6. The habit this codebase was built around

Worth knowing, because it will shape what "done" means for the engagement.
From `CLAUDE.md`:

> This codebase has repeatedly shipped **controls that only look like controls**:
> a `MAX_ATTEMPTS` nothing read, a `documentDeletedAt` that deleted nothing,
> nineteen `@Throttle` decorators with no guard registered, a `Message.readAt`
> nobody wrote, a notice channel nobody could read, a nav audit structurally
> incapable of seeing a dead link, and a rent-reminder control on a screen with
> no route.
>
> So: **change it, drive it, then reintroduce the bug and confirm the check
> fails.** A check that cannot fail is not a check.

A design handed over as static artwork will meet this. A design handed over with
a rule that can fail a build — a token lint, a contrast gate, a target-size
check — will survive contact with it. The repo already runs
`scripts/css-coverage-audit.mjs`, `scripts/a11y-drive.mjs` and
`scripts/layout-ui-drive.mjs`, so that kind of enforcement has somewhere to land.
