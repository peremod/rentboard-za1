# Email — Setup & Lifecycle

Every email the platform sends, how it is tracked, and what to configure before
launch. Written 28 Aug 2026.

---

## 1. Setup, in order

### 1.1 Verify a sending domain

Do **not** send from a shared or unverified domain. Mail will land in spam and,
worse, password resets will not arrive.

1. Resend dashboard → **Domains** → add `umastande.co.za`
2. Add the DNS records it gives you at your registrar:
   - **SPF** (TXT) — authorises Resend to send as your domain
   - **DKIM** (CNAME ×3) — signs each message so receivers can verify it
   - **DMARC** (TXT) — tells receivers what to do with mail that fails the
     above. Start at `p=none` and watch reports before tightening to
     `p=quarantine`, or you will silently drop your own mail.
3. Wait for verification. Usually minutes, sometimes hours.

```
RESEND_API_KEY=re_...
RESEND_FROM=noreply@umastande.co.za
RESEND_FROM_NAME=Mastande
```

Use a real, monitored reply-to eventually. `noreply@` is acceptable to start,
but a landlord who replies to an application notification and gets silence will
assume the platform is dead.

### 1.2 Wire the delivery webhook

Without this, bounces and complaints are invisible and the suppression list
stays empty — which is how a sending domain gets blacklisted.

1. Resend dashboard → **Webhooks** → add endpoint
2. URL: `https://api.umastande.co.za/api/notifications/webhook/resend`
3. Subscribe to `email.delivered`, `email.bounced`, `email.complained`
4. Copy the signing secret:

```
RESEND_WEBHOOK_SECRET=whsec_...
```

The endpoint rejects unsigned requests once this is set. Leaving it unset in
production would let anyone suppress any address — a denial of service on
somebody else's password reset.

### 1.3 Confirm it works

```bash
./scripts/smoke-test.sh          # section 2 registers accounts, which sends mail
```

Then check the Resend dashboard for delivery, and:

```
GET /api/notifications/admin/failures   # admin only
```

---

## 2. The lifecycle

```
  send() called
      ↓
  EmailLog row created (status: queued)
      ↓
  Is the address suppressed?  ──yes──►  status: suppressed, stop
      ↓ no
  Is this marketing, and has the user opted out?  ──yes──►  suppressed, stop
      ↓ no
  RESEND_API_KEY set?  ──no──►  status: failed, logged, stop
      ↓ yes
  Resend accepts it  ──►  status: sent, providerId stored
      ↓
  Webhook: delivered / bounced / complained
      ↓
  bounce or complaint  ──►  address added to EmailSuppression
```

Two ordering decisions worth keeping:

- **Suppression is checked before consent.** A hard-bounced address must not be
  mailed even if the person is opted in — the address does not work, and
  retrying damages deliverability for everyone.
- **`send()` never throws.** An email failure must not fail the operation that
  triggered it. A room still gets let if the notification bounces.

---

## 3. The fifteen emails

Transactional mail is part of the service and has no opt-out: someone who
applied for a room must be told the outcome. Marketing does, and carries an
unsubscribe footer appended centrally so a new template cannot forget it.

| Template | To | Category | Trigger |
|---|---|---|---|
| `new_application` | Landlord | transactional | Tenant applies |
| `application_viewed` | Tenant | transactional | Landlord opens it |
| `shortlisted` | Tenant | transactional | Landlord shortlists |
| `accepted` | Tenant | transactional | Landlord accepts |
| `rejection` | Tenant | transactional | Landlord rejects |
| `new_message` | Either | transactional | Message in a thread |
| `room_unavailable` | Tenant | transactional | Room let to someone else |
| `password_reset` | User | transactional | Reset requested |
| `password_changed` | User | transactional | Password changed |
| `google_only_account` | User | transactional | Reset asked for on a Google account |
| `email_change_confirmation` | New address | transactional | Email change started |
| `email_change_alert` | Old address | transactional | Email change started |
| `urgent_report_alert` | Admin | transactional | Serious safety report |
| `new_match` | Tenant | **marketing** | Room matches a saved search |
| `daily_digest` | Tenant | **marketing** | 07:00 SAST, if there are matches |

The two marketing templates are the only ones POPIA s.69 governs. Both check
`user.marketingEmails` before sending, and the toggle lives in
`/account/settings`, which is where the unsubscribe footer links.

---

## 4. What is logged, and why

`EmailLog` records every attempt: recipient, template, category, subject,
status, provider id, timestamps, and the error if it failed.

Three reasons, all practical:

1. **Support.** "Did you tell me about that application?" needs an answer.
2. **Deliverability.** Bounce and complaint rates are only visible if recorded.
3. **POPIA.** s.23 gives a data subject the right to know what you hold and
   what you sent them — `GET /notifications/my-emails` answers that directly.
   s.69 requires showing that marketing was consented to and opt-outs honoured.

Nothing about the message body is stored — only the subject. There is no reason
to retain the contents of a password reset email.

---

## 5. Operating it

**Watch weekly:**

| Signal | Healthy | Act when |
|---|---|---|
| Bounce rate | under 2% | above 5% — check for a broken address field or fake signups |
| Complaint rate | under 0.1% | above 0.3% — people are receiving mail they did not ask for |
| Failed sends | ~0 | any sustained run — usually an expired API key |

**If deliverability degrades:** stop sending marketing first, keep
transactional flowing, and fix the cause before resuming. Password resets
arriving is more important than any digest.

**Suppressions are permanent** until removed manually in the database. That is
deliberate — an address that hard-bounced last month has not started working
because a user tried again.

---

## 6. Related: payment notifications

The PayFast ITN is a separate webhook from Resend's and is documented in
`docs/PAYMENTS.md`. The two are easy to confuse when configuring a deploy:

| Webhook | URL | Secret |
|---|---|---|
| Resend delivery events | `/api/notifications/webhook/resend` | `RESEND_WEBHOOK_SECRET` |
| PayFast payment ITN | `/api/payments/payfast/notify` | signature, not a secret |
