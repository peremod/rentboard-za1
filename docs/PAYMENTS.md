# Payments

> **Stripe was removed in v1.54.0.** Stripe does not operate in South Africa
> for *receiving* payments — a ZA-registered business cannot accept money
> through it. It had been wired for subscriptions, room boosts and the Renter's
> Passport, none of which could ever have taken a rand. PayFast is the provider.
>
> What that leaves: PayFast handles one-off verification payments, and that
> works. Recurring billing — landlord plans, boosts, Passport — is **not
> built**. PayFast supports subscriptions via its recurring billing API, so the
> path exists, but the pages behind BILLING_ENABLED are stubs that say nothing
> has been charged rather than taking money through a provider that cannot
> receive it.

# Payments — PayFast

The once-off R149 landlord verification fee. Written 28 Aug 2026.

---

## 1. Why PayFast

Instant EFT matters more than card support here: a large share of South African
landlords either do not have a credit card or will not use one online. PayFast
covers instant EFT, card, and Mobicred, settles to a local bank account, and is
a brand people recognise — which itself reduces abandonment at the payment step.

## 2. Setup

```
PAYFAST_MERCHANT_ID=
PAYFAST_MERCHANT_KEY=
PAYFAST_PASSPHRASE=          # optional on PayFast, but see the warning below
PAYFAST_SANDBOX=true
API_URL=https://api.mastande.co.za
```

**The passphrase is the most common cause of a working integration suddenly
failing.** It is optional in PayFast, but if it is set on the account it must
also be set here — it is included in the signature, and a mismatch rejects
every payment with an unhelpful error.

**`API_URL` must be reachable from the internet.** PayFast calls the ITN
server-to-server, so `localhost` will never receive one. Use ngrok or similar
when testing locally, or payments will complete at PayFast and never be
confirmed on our side.

Sandbox credentials for testing: merchant `10000100`, key `46f0cd694581a`.

## 3. The flow

```
landlord uploads ID document
        ↓
VerificationRequest created — status: pending_payment
        ↓  (not in the admin queue yet)
landlord clicks "Pay R149"
        ↓
POST /payments/verification/:id  →  signed form fields
        ↓
browser POSTs to PayFast, user pays
        ↓
        ├── browser returns to /landlord/verification?payment=success
        │   (cosmetic only — proves nothing)
        │
        └── PayFast POSTs the ITN to /payments/payfast/notify
                ↓
            validated → Payment: paid, VerificationRequest: pending
                ↓
            appears in the admin review queue
                ↓
            approved → idVerified = true, badge appears
            rejected → refund issued from the PayFast dashboard
```

**The ITN is the source of truth, not the browser return.** A user who closes
the tab after paying must still get what they paid for, and a user who visits
the return URL without paying must get nothing.

## 4. ITN validation

Four checks, all required. PayFast's own guidance is explicit that the
signature alone is not enough:

1. **Signature** — MD5 over the received parameters in the order received, plus
   the passphrase. Parameters are *not* sorted; sorting them will not validate.
2. **Amount** — `amount_gross` must equal what we expected. Without this, a
   tampered form could offer to pay R1 for a R149 service.
3. **Source IP** — checked against PayFast's resolved hostnames. A soft check,
   logged rather than fatal, since their ranges change.
4. **Server confirmation** — the whole payload is posted back to PayFast, which
   replies `VALID` only if it really sent it. This is what makes a forged ITN
   useless, and is why check 3 can afford to be soft.

**Idempotency:** PayFast retries. A payment already marked `paid` short-circuits
on arrival, so a retry cannot approve twice.

**Always returns 200.** Anything else triggers a retry storm. Failures are
recorded against the payment row instead.

## 5. Refunds

The pricing page promises a full refund if verification fails, so this must be
operationally real.

PayFast does not expose a refund API — refunds are issued from their dashboard.
`PATCH /payments/:id/refund` records the outcome so support has a trail; it does
not move money. The order of operations is:

1. Refund in the PayFast dashboard
2. Record it via the endpoint, with a reason
3. The landlord keeps their rejection email explaining what to fix

## 6. Testing

```bash
./scripts/smoke-test.sh          # section 25
```

The smoke test covers what can be checked without PayFast: that an identity
request starts as `pending_payment`, that a tenant cannot start a landlord's
payment, that the signed form has the right amount, that a forged ITN is ignored,
and that an unpaid request stays out of the review queue.

**What it cannot cover, and what must be tested in sandbox before going live:**

- that the signature is accepted by PayFast at all
- the ITN round trip end to end
- the passphrase being set on one side only
- refund handling

Signature construction is the part most likely to be wrong on first contact.
Test in sandbox with a real payment before switching `PAYFAST_SANDBOX=false`.
