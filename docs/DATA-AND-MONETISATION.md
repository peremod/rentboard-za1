# Data, Monetisation & Payments — RentBoard ZA

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

### ✅ Advertising on the board — clean, do this first

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
| Verification fee, R149 once-off | Now | Already built and priced |
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

`RoomBoost` and the Stripe module contain a working payment-session pattern,
including webhook handling. Whichever gateway you choose, that shape is
reusable — only the provider SDK and signature verification change.

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
