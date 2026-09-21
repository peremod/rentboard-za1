# Data, Monetisation & Payments — Mastande ZA

Written 26 Aug 2026. Covers what the platform collects, what may lawfully be
done with it, and how the business can make money without breaking the promise
it is built on.

This is not legal advice. The POPIA sections cited are real and the reasoning
is sound, but an attorney must sign off before any of the revenue models here
go live.

---

## 1. What we collect today

Taken from `schema.prisma`, not from memory.

### Tenants

| Data | Where | Why we have it |
|---|---|---|
| Full name, email, phone | `User` | Account, contact between parties |
| Password hash | `User` | Authentication. Never reversible |
| Avatar path | `User` | Profile display |
| Employment status | `TenantProfile` | Optional, strengthens an application |
| Annual income (cents) | `TenantProfile` | Optional, strengthens an application |
| ID verified flag | `TenantProfile` | Currently nothing sets it |
| Applications + cover notes | `Application` | The core transaction |
| Messages | `Message` | Landlord/tenant conversation |
| Saved searches | `SavedSearch` | Alerts. Reveals budget, area, timing |
| Saved rooms | localStorage | Device-local, never reaches the server |
| Tenancy history | `Tenancy` | Rent paid, dates, which room |
| Reviews written and received | `Review` | Reputation |

### Landlords

| Data | Where | Why |
|---|---|---|
| Name, email, phone, company | `User`, `LandlordProfile` | Account and contact |
| ID document | `VerificationRequest` | **Special personal information, POPIA s.26.** Deleted on decision |
| Room details, photos, location | `Room` | The listing |
| WhatsApp number | `LandlordWhatsappConfig` | Notifications |
| Rating and review history | `LandlordProfile`, `Review` | Reputation |
| Payment identifiers | `LandlordProfile` | Stripe references only. **No card data is stored** |

### Not collected, deliberately

No ID numbers, no bank details, no card numbers, no browsing history, no
device fingerprints, no location coordinates, no third-party trackers.

That last row is an asset. It is the reason the platform can honestly say
"POPIA compliant" on the homepage, and it is worth more than any single data
deal on the table.

---

## 2. The legal frame, briefly

Five sections decide almost everything below.

- **s.10 minimality** — collect only what the stated purpose requires.
- **s.13 purpose specification** — data collected for one purpose cannot be
  quietly repurposed for another.
- **s.11(1) lawful grounds** — consent, contract, legal obligation, legitimate
  interest. Legitimate interest does **not** cover selling data.
- **s.69 direct marketing** — electronic marketing to someone who is not an
  existing customer requires **prior opt-in consent**. Opt-out is not enough.
  Each message must identify the sender and offer an opt-out.
- **s.26/s.27 special personal information** — ID documents, biometrics,
  health. Higher bar, and we hold ID documents during verification.

Penalties are real: up to R10 million or ten years, and the Information
Regulator has been actively enforcing since 2023.

---

## 3. Monetisation, sorted by whether it is lawful

### ✅ Advertising on the board — **built in v1.17.0**

Implemented exactly as described below: contextual only, no personal data
leaves the platform, sold as flat monthly placement.

- Three placements: `board_sidebar`, `board_inline`, `room_detail`
- Targeting is province / city / room type — matched against the **page**, never
  the viewer. No profile is built and no identifier is sent
- Every ad carries an "Advertisement" label. The CPA requires advertising to be
  identifiable, and on a platform where people decide who to trust with a
  deposit, an ad that reads like a listing is actively dangerous
- Clicks route through `/ads/:id/click` so they can be counted without a
  third-party tracking script, with `Referrer-Policy: no-referrer` so the
  advertiser does not learn which page sent the visitor
- Impressions and clicks are **aggregate counters on the campaign row**. There
  are deliberately no per-view records: knowing which tenant saw which ad is
  information we have no need for, and s.10 minimality says do not collect it
- Creatives are reviewed before going live, and destinations must be https

What an advertiser can see: their own impressions, clicks and click-through
rate. Nothing about who saw it.

#### Seeing it work

Campaigns are created by an admin, so the slots are empty on a fresh database.
To render demo campaigns across all three placements:

```bash
cd backend
SEED_DEMO_ADS=true ADMIN_EMAIL=you@example.co.za ADMIN_PASSWORD='...' \
  npx ts-node prisma/seed.ts
```

Every seeded record is prefixed `[DEMO]` so it is obvious in the admin list.
The flag is opt-in because nobody wants fake adverts on a production board.

#### The front door — built in v1.19.0

`/advertise`, linked from the footer, with an enquiry form that alerts an admin
by email and lands in a queue at `/admin/enquiries`.

**Rates are stated on the page, not hidden behind "contact us".** A regional
advertiser deciding whether to bother emailing wants to know whether this is a
R2,000 or a R20,000 conversation, and most will not ask. Opening figures:

Rates scale with reach, because targeting changes what a placement delivers:

| Placement | Nationwide | Province | City | Suburb |
|---|---|---|---|---|
| Sidebar | R2,500 | R1,250 | R700 | R450 |
| In-grid | R4,000 | R2,000 | R1,100 | R600 |
| Room detail | R3,000 | R1,500 | R850 | R450 |

**A flat rate per placement was wrong**, and it took a direct question to spot
it. A nationwide sidebar runs on every search; a Sandton one runs only on
Sandton searches. Charging both R2,500 meant the national buyer got perhaps ten
times the impressions for the same money, and the suburb buyer was badly
overpaying.

Rates scale with reach but **not linearly**. A suburb campaign reaches roughly
3% of traffic and pays 15% of the national rate — several times the price per
impression. That premium is the point: an advert for storage in Sandton, shown
to people moving into Sandton, is worth more than the same advert shown
nationally.

There is a floor of R450. Reviewing a creative, invoicing and reporting cost
the same whether a campaign is national or one suburb, so below that a
placement costs more to administer than it earns.

**In-grid changed in v1.28.1** and the rate card was updated to match. It used
to be a single slot after the sixth card; it now repeats every six rooms, so a
24-room search shows four. That is roughly four times the impressions for the
same money, which makes R4,000 look cheap rather than premium.

Two ways to handle that, and the choice is yours:

- **Leave it.** More impressions at the same price is a good first-customer
  story, and you have no impression history to price against yet.
- **Raise it once you have data.** After a month of real traffic you can say
  "the in-grid slot delivered 40,000 impressions" and price from that. Raising
  a rate on evidence is straightforward; raising it on a guess is not.

The rule that matters either way: **the rate card must describe what is
actually served.** Selling "an ad in the grid" and delivering four is a happy
surprise; selling four and delivering one is a refund.

Rates are per placement, not per impression. An advertiser buys a slot for the
month, so a busier board means more views at the same price — worth saying on
the page, because it makes early advertisers beneficiaries of your growth
rather than people who bought before a price rise.

The page states plainly what an advertiser does and does not get: contextual
targeting, aggregate performance for their own campaign, no user data, no
third-party trackers, every ad labelled. That is a selling point as much as a
constraint — it is the reason the audience trusts the board enough to be worth
advertising on.

An enquiry never auto-creates a campaign: placement is sold after a
conversation and an invoice, and an unreviewed creative going live on a rental
platform is precisely the risk the review step exists for.

#### Original reasoning

Selling placement is not a data question at all. Nothing about a user is
disclosed to an advertiser.

**Contextual targeting only.** An ad slot on a Gauteng search results page can
be sold as "Gauteng, room seekers" without transmitting a single personal
detail. That is inventory, not data.

Who buys it, roughly in order of fit:

| Advertiser | Why they want this audience |
|---|---|
| Fibre/ISP resellers | A confirmed move is the single best moment to switch provider |
| Furniture and appliance rental | Rooms are often let unfurnished |
| Moving companies, van hire | Obvious |
| Self-storage | Downsizing into a room creates storage demand |
| Insurers (contents) | New address, new policy |
| Student services near campus suburbs | Concentrated demand, seasonal |

**Pricing model.** Start with flat monthly placement rather than CPM. You will
not have the volume to make impressions-based pricing credible, and a flat
"R2,500/month for the Gauteng sidebar" is easier to sell and to invoice. Move
to CPM once you can honestly report 100k+ monthly impressions.

**How to get them:** direct outreach, not an ad network. Networks will pay
cents and will inject third-party trackers, which destroys the compliance
position. Approach regional fibre resellers and moving companies directly —
they buy locally and have small, reachable marketing teams.

### ✅ Consent-based partner referrals — the actually valuable one

This is what you are really asking about, and it is lawful **if** the user
opts in at the moment of relevance.

The moment is precise: an application is accepted. That person is definitely
moving, on a known date, to a known suburb, at a known rent. That is the most
valuable moment in the whole product.

What it looks like:

> **You're moving on 1 June.**
> Want free quotes from movers, or fibre availability at the new address?
> ☐ Yes, send me moving quotes
> ☐ Yes, check fibre at my new address
> We'll only share your details with partners you tick.

That is s.11(1)(a) consent, specific and informed. Everything about it is
defensible.

**Value.** A confirmed-mover lead is worth far more than a cold one — the
person is not researching, they are moving on a date. Rates in South Africa
vary and you should validate them by asking two or three partners directly
rather than trusting any figure I give you. Expect fibre/ISP referrals to pay
best, movers next, insurance third.

**Frequency.** Once per tenancy, at acceptance. Possibly a second touch at
move-out for storage and cleaning. Anything more and consent starts to look
like a pretext, and unsubscribes will tell you the same thing.

### ❌ Selling leads without consent — do not

Passing a tenant's details to a moving company because they applied for a room
is repurposing data collected under contract for direct marketing. That
requires s.69 opt-in you do not have. It is the single fastest way to lose both
the Information Regulator's goodwill and the "no agent fees, we're on your
side" position the whole brand rests on.

The consent version above earns nearly as much and is defensible.

### ❌ Selling the user database — do not

There is no lawful basis. Do not entertain it regardless of the offer.

### ⚠️ Behavioural ad targeting — considered, not built

The proposal was to target ads by inferred situation: a first-time tenant, a
tenant relocating from another city, a tenant moving within the same area.

**Not built, and the reason matters.** Each of those is an inference about a
person, drawn from their history rather than the page in front of them. That
crosses the line this document has held throughout: contextual targeting reads
the page, behavioural targeting reads the person. Once we build a profile of
"this tenant is relocating from Durban", we hold personal information collected
for one purpose and used for another (s.13), and the "no third-party trackers,
no profiling" claim on the Advertise page stops being true.

What is built instead reaches most of the same advertisers without any of that:

- **Suburb, city, province and room type targeting** (v1.27.0), matched against
  the page. A storage company wanting people moving into Sandton buys Sandton.
- **Price band and room type** are already in the query, so an advertiser
  selling budget furniture can target studios under R4,000 without knowing
  anything about who is looking.

If behavioural targeting is ever wanted, it needs explicit opt-in consent at
collection, a stated purpose, and a way to withdraw — the same shape as the
alerts consent, not a silent default. That is a product and legal decision
before it is an engineering one.

### ⚠️ Tracking tenants who move out without re-letting through us

You asked specifically. Technically you can see it: a tenancy ends and no new
application follows.

Lawfully, inferring "this person is moving somewhere else" and acting on it is
behavioural profiling for a purpose the tenant never agreed to. Under s.13 it
is a new purpose, so it needs its own consent.

There is a clean version: ask. *"Moving on? We can send you rooms in your new
area."* Same information, consented, and it keeps the person in the product
rather than quietly monetising their departure.

### ⚠️ Location permission for maintenance and services

Precise geolocation is a large step up in sensitivity from "Sandton, Gauteng",
which you already have and which is enough to match a plumber or an
electrician. Under s.10 minimality, asking for GPS when a suburb suffices is
hard to justify.

Recommendation: use the suburb you already hold. Do not request device
location.

---

## 4. Suggested revenue mix

Ordered by how quickly each can start and how defensible each is.

| Stream | Start when | Notes |
|---|---|---|
| Verification fee, R149 once-off | Now | Built, priced, and refundable in practice as well as on the pricing page (v1.59.0) |
| Board advertising, flat monthly | ~500 daily users | No data leaves the platform |
| Consent-based move referrals | After first 50 tenancies | Needs volume to interest partners |
| Featured listings | Anytime | `isFeatured` and `RoomBoost` already exist in the schema |
| Landlord subscriptions | Probably never | You chose free, and free is the differentiator |

The last row matters. "Free to list, free to apply" is the reason a landlord
tries you instead of the incumbents. Do not trade it for subscription revenue
that advertising and referrals can replace.

---

## 5. Payments for verification

### Which provider

Stripe is already scaffolded in the codebase but currently disabled behind
`BILLING_ENABLED`. Before committing to it, confirm its current South African
availability and settlement terms — that has changed more than once, and the
answer determines whether the existing scaffolding is reusable.

South African alternatives, all of which settle to a local bank account and
support instant EFT (which matters here — many South Africans do not use
credit cards):

| Provider | Notes |
|---|---|
| **Yoco** | Simple, strong local brand, good for once-off online payments |
| **PayFast** (Network9) | The most widely recognised SA gateway. Supports instant EFT, card, Mobicred |
| **Peach Payments** | Broad method coverage, more enterprise-oriented |
| **Paystack** | Good developer experience, Africa-wide, Stripe-owned |
| **Ozow** | Instant EFT specialist. Cheap per transaction, no card needed |

For a single R149 charge, **instant EFT matters more than card support**.
PayFast or Ozow will convert better than a card-only flow.

### The flow

A once-off payment is much simpler than the subscription machinery already
scaffolded:

```
landlord uploads document
        ↓
verification request created (status: pending_payment)
        ↓
redirect to gateway  →  pays R149  →  webhook confirms
        ↓
status: pending  →  enters the admin review queue
        ↓
approved  →  idVerified = true, badge appears
rejected  →  refund issued in full
```

Points that matter:

- **Charge before review, refund on failure.** Reviewing first and charging
  after means chasing payment from someone you just told no.
- **Refund in full if you cannot verify them.** The pricing page already
  promises this, so it must be operationally real.
- **The webhook is the source of truth**, not the browser redirect. A user who
  closes the tab after paying must still get their verification.
- **Idempotency.** Gateways retry webhooks. Keyed on the gateway's transaction
  id so a retry does not double-approve.
- **CPA s.16 cooling-off** — five business days if sold through direct
  marketing. Already stated on the pricing page.

### What is already built

**Built and driven end to end as of v1.59.0.** PayFast, not Stripe: for a
single R149 charge instant EFT matters more than card support, which is what
the table above concluded.

Every point in the list above is now code rather than intent:

| Point | Where |
|---|---|
| Charge before review | `status: 'pending_payment'`, and `listPending()` excludes it |
| Refund in full if we cannot verify | `review()` sets `refundDueAt` on rejection; the queue is on the admin dashboard |
| The webhook is the source of truth | `handleItn`; the return URL only sets a message |
| Idempotency | `confirmPaid` returns false on a retry and writes nothing twice |
| CPA s.16 cooling-off | Stated on the pricing page |

The fee also appears on the verification's own audit trail, which is what lets
a landlord see why a badge was granted — or, on a rejection, that their money
is on the way back.

**One trade-off left open.** A rejection refunds in full, and a fresh attempt
is a fresh R149. Someone whose ID photo was simply too blurry therefore pays
twice in effect, and the business pays two PayFast transaction fees to end up
where it started. Allowing one free resubmission against the existing payment
would be kinder and cheaper. That is a pricing decision, not an engineering
one, and the verification page states the current rule plainly rather than
letting someone discover it at the second checkout.

`RoomBoost` and the Stripe module still contain the subscription-shaped
payment-session pattern, and both remain paused: `BILLING_ENABLED` is false and
`StripeModule` is not registered in `app.module.ts`.

---

## 6. What to do next, in order

1. **Nothing that touches data until the Information Regulator registration is
   done.** Operating a data-driven revenue model while unregistered is the
   worst possible sequence.
2. Turn on the verification payment. It is priced, promised, and needs no
   personal data beyond what verification already requires.
3. Add board advertising once traffic justifies a rate card.
4. Build the consent-based referral prompt only after you have tenancies
   completing, and build the consent UI before approaching any partner — a
   partner will ask how you obtained the lead, and "they ticked a box on this
   screen" is the answer that closes the deal.

---

## 7. Measuring UX without becoming a tracking company

Built in v1.30.0. The constraint is self-imposed and worth keeping: the
`/advertise` page says there are no third-party trackers and no profiling, and
that claim is a selling point. This is how to learn about usage anyway.

### What was built

**Aggregate counters.** One row per event per day, incremented. No user id, no
session id, no IP, no timestamp beyond the date. It answers "how many people
left at step 3" and can never answer "did this person leave" — including for
anyone who obtains the database.

**Signals from data already held.** Rooms with no photo, rooms with 20+ views
and no applications, drafts stalled over a week. These needed no tracking at
all and are often more actionable than a funnel: a room viewed forty times with
no applications has a listing problem you can name and fix.

**Instrumented:** the listing wizard step by step (landlord drop-off is the most
valuable thing here — an abandoned wizard is a room the board never gets),
the apply funnel, and feature use.

### What was deliberately not built

| Not built | Why |
|---|---|
| Google Analytics / Meta Pixel | Third-party trackers. Contradicts the advertising promise directly, and sends South African personal data offshore under s.72 |
| Session replay (Hotjar, FullStory) | Records what an individual does on screen, including what they type. The most invasive option available, and impossible to square with the no-profiling claim |
| Per-user event streams | Reconstructs an individual's journey. Once it exists it can be subpoenaed, breached, or quietly repurposed |
| Cross-session identity | Would need a persistent identifier, which is the thing being avoided |

### The honest limitation

Aggregate counters tell you **where** people leave, never **why**. Nothing here
replaces watching someone use the site.

For a board this size that gap is best closed by talking to people, and it is
cheap: five landlords walked through listing a room will teach you more than a
month of funnels, and the funnels tell you which five minutes to watch. The
counters are for noticing a problem; a conversation is for understanding it.

### If you ever want more

Self-hosted Plausible or Umami is the next step that stays defensible —
cookieless, aggregate, on your own infrastructure, no data leaving the country.
It would add page-level traffic data the counters do not cover. Anything beyond
that starts trading the trust position for insight, and on a platform where
people are deciding who to trust with a deposit, that is a bad trade.
