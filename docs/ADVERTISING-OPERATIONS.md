# Advertising — Operations

Who does what, at which point, and against what standard. Written 1 Sep 2026.

---

## 1. The funnel

```
  business finds /advertise
          ↓
  enquiry form  →  AdEnquiry (status: new)  →  admin alerted by email
          ↓
  ADMIN: reply, agree placement and rate       [enquiry: contacted]
          ↓
  ADMIN: invoice and get paid — outside the platform
          ↓
  ADMIN: create Advertiser                     [enquiry: won]
          ↓
  ADMIN: create Campaign                       [campaign: pending_review]
          ↓
  ADMIN: review creative against §3            [approved → active | rejected]
          ↓
  served contextually, impressions and clicks counted
          ↓
  1st of the month: performance email to the advertiser
          ↓
  renew, change targeting, or let it end
```

**Nothing is automatic between "enquiry" and "served".** Every step is a person
deciding. That is deliberate at this scale — the volume does not justify
automation, and an unreviewed ad on a platform where people are deciding who to
trust with a deposit is a serious risk.

---

## 2. Who does what

Today this is **one person: whoever holds the admin account.** Being honest
about that matters more than drawing an org chart for a team that does not
exist. The responsibilities are separable when there is someone to separate
them to:

| Responsibility | Who | Where |
|---|---|---|
| Answering enquiries | Admin | `/admin/advertising` |
| Agreeing rates, invoicing | Admin | Outside the platform |
| Creating advertisers and campaigns | Admin | `/admin/advertising` |
| **Approving creatives** | Admin | `/admin/advertising` |
| Pausing or ending campaigns | Admin | `/admin/advertising` |
| Monthly reports | Automatic | 08:00 on the 1st |

**Payment is not in the platform.** Ad revenue is invoiced and settled outside
it, because a handful of monthly advertisers do not justify a billing system,
and the alternative — building one — is weeks of work to save a spreadsheet.
Revisit when there are more than roughly twenty concurrent advertisers.

---

## 3. Creative review — the standard

Every campaign enters `pending_review` and is served only after approval. The
reviewer checks all of the following. Any single failure is a rejection with a
reason.

### Reject outright

- **Anything that could be mistaken for a listing.** An ad styled as a room on
  a room board is the most dangerous thing that could run here. The
  "Advertisement" label is enforced in code, but a creative that reads like a
  listing still fails.
- **Upfront payment before viewing.** Any offer requiring money before someone
  sees a property, in any form.
- **Rental scams and adjacent bait** — "guaranteed approval", "no deposit
  needed, pay a fee", advance-fee anything.
- **Unregistered credit offers.** Credit providers must be registered under the
  National Credit Act; ask for the NCR number and check it.
- **Discriminatory targeting or wording** — anything excluding people on the
  grounds in s.9 of the Constitution or PEPUDA.
- **Debt-relief and "blacklist removal" operators** targeting people who are
  already financially stressed.
- **Non-https destinations.** Enforced by the API, listed here because it is a
  trust issue rather than a technical one.

### Check before approving

- Does the destination page match the ad's claim? Follow the link.
- Is the business real — registered, reachable, and trading?
- Are price claims specific and honest? "From R650" needs an actual R650 option.
- Would this embarrass the platform beside a warning about deposit scams?

### Record

Rejections require a reason, which is stored and shown to the advertiser. That
is not politeness: it is the difference between a fixable creative and a lost
customer, and it is the audit trail if a decision is ever questioned.

---

## 4. What advertisers get

**Automatically, on the 1st of each month:** impressions, clicks and
click-through rate per campaign, emailed to their contact address.

**On request:** the same figures at any time, from `/admin/advertising`.

**What they never get, and are told so plainly in the report:** anything about
who saw the ad. There is no per-view record, no visitor id, no profile — not
withheld, but never collected. The report says this explicitly, because an
advertiser used to behavioural platforms will assume the data exists and is
being kept from them.

That constraint is a selling point. An audience that trusts the board is worth
more than one that has been profiled, and the `/advertise` page says so.

---

## 5. Allocation and competition

- Targeting is contextual: suburb, city, province, room type — matched against
  the page, never the person.
- **Most specific wins.** Suburb beats city beats province beats room type.
  Whoever bought the narrowest targeting gets the slot.
- **Equally specific campaigns rotate**, chosen at random per request, so one
  advertiser cannot monopolise a placement.
- Three placements: sidebar (one per search page), in-grid (**after every sixth
  room card**, so a long search carries several), and room detail.
- Repeated in-grid slots step through the eligible campaigns, so a visitor
  scrolling a long board sees different advertisers rather than the same ad
  four times.

**If you change how often a placement repeats, change the rate card.** In-grid
went from one slot to one-per-six in v1.28.1, roughly quadrupling impressions
for the same money. The `/advertise` page was updated the same day. Selling a
slot and delivering four is a happy surprise; selling four and delivering one
is a refund and a lost customer.

**There is no auction and no bidding.** Flat monthly rates, sold directly. An
auction needs volume to work, and pretending to run one at this scale would
mean advertisers paying variable prices for inventory nobody else wants.

---

## 6. What is not built

- **No self-service portal.** Advertisers cannot log in, upload creatives or
  see live stats themselves. Everything routes through the admin and the
  monthly email. Correct at this volume; the first thing to build if
  advertisers exceed roughly twenty.
- **No billing.** Invoiced outside the platform.
- **No frequency capping.** Someone browsing thirty rooms may see the same ad
  thirty times. Worth adding once inventory is sold out enough to matter.
- **No creative image upload in the admin form.** `imagePath` is set via the
  API; text-only ads work fine in the meantime.
