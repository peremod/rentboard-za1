# WhatsApp Business API — setup

> ## ⚠️ WhatsApp is OFF, deliberately
>
> `WHATSAPP_ENABLED=false` is the default and the decision. Meta bills **per
> message** — about **USD $0.0095 + VAT** per sign-in code to a South African
> number, from the first one, with no free allowance — and this product is free
> to list and free to apply. That is a per-head cost with no revenue behind it.
>
> **Nothing has been deleted.** The listing bot, the webhook, the templates, the
> landlord opt-in and the whole phone sign-in flow are all still here. Setting
> that one variable to `true`, with the credentials below in place, brings the
> channel back.
>
> **What is off while it is false:** no Cloud API call is ever made; the webhook
> handshake is refused; phone sign-in, sign-up, number verification, number
> change and lost-number recovery all answer **503** telling people to use an
> email address; the rent-reminder pass does not run (so it does not mark months
> as reminded that nobody was reminded about).
>
> **What is NOT off:** `wa.me` links. Sharing a room, or tapping "WhatsApp" on a
> plumber in the directory, opens the person's **own** WhatsApp — Meta bills
> nobody for that, and in this market it is free distribution. Those stay.
>
> **Check which state you are in:** the API says so at boot, and
> `node scripts/whatsapp-off-drive.mjs` proves nothing reaches Meta.
>
> The rest of this page is how to turn it on when that cost is worth carrying.

What this covers: getting Meta credentials, pointing the webhook at the API,
and getting a template approved so sign-in codes actually arrive.

**Read this too.** Credentials alone do **not** make WhatsApp work, even with
the switch on. Meta permits free-form text only inside the **24-hour customer
service window** — within 24 hours of the person messaging you. A sign-in code
goes to somebody who has not messaged you, by definition, so without an approved
template every one is rejected with **error 131047**. The API logs a warning at
boot if you set credentials and leave the template name blank.

## 0. Turning it on

```
WHATSAPP_ENABLED=true          # on the API
```
and in `frontend/src/app/core/config/feature-flags.ts`:
```ts
export const WHATSAPP_ENABLED = true;
```

⚠️ **Both, and the API one first.** The frontend flag only decides whether the
buttons are shown; the API decides whether anything is sent. Frontend-on with
API-off is a button that looks like it works — the API answers 503 so it is an
honest error rather than silence, but it is still the wrong way round.

---

## 1. What you need from Meta

All of this is in the [Meta App Dashboard](https://developers.facebook.com/apps)
and [WhatsApp Manager](https://business.facebook.com/wa/manage/).

| Variable | Where it comes from |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | App Dashboard → WhatsApp → API Setup → **Phone number ID** (the long number, not the phone number) |
| `WHATSAPP_ACCESS_TOKEN` | Same page. ⚠️ The one shown there is a **24-hour test token**. For production create a System User token (Business Settings → Users → System Users → Generate token, with `whatsapp_business_messaging` + `whatsapp_business_management`) and set it to never expire |
| `WHATSAPP_VERIFY_TOKEN` | **You invent this.** Any random string. Meta echoes it back once, during the webhook handshake, and never again |
| `WHATSAPP_APP_SECRET` | App Dashboard → Settings → Basic → **App Secret**. This signs every inbound delivery |
| `WHATSAPP_TEMPLATE_OTP` | The name of your approved template — step 3 |
| `WHATSAPP_TEMPLATE_LANG` | The language that template was approved under. `en` unless you chose otherwise |

⚠️ **`WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET` are different things and
are easy to swap.** The verify token proves the URL is yours, once. The app
secret proves every later POST came from Meta. With the app secret missing or
wrong, the webhook refuses **every** delivery — inbound replies and WhatsApp
listing drafts simply stop arriving, with no error anywhere a user can see.

---

## 2. The webhook

App Dashboard → WhatsApp → Configuration → Webhook → Edit.

| Field | Value |
|---|---|
| Callback URL | `https://api.umastande.co.za/api/whatsapp/webhook` |
| Verify token | whatever you put in `WHATSAPP_VERIFY_TOKEN` |

Then **Manage** the webhook fields and subscribe to **`messages`**. Without that
subscription the handshake succeeds and nothing is ever delivered — which looks
exactly like a working setup.

Staging uses `https://api-staging.umastande.co.za/api/whatsapp/webhook` and its
own verify token.

Meta calls the URL immediately to verify it, so **deploy the env vars before you
save the webhook**, or the handshake fails and you have to come back.

### Check it

```bash
# Handshake — should echo the challenge back.
curl "https://api.umastande.co.za/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=hello"
# → hello

# Unsigned POST — should be refused. If this returns 200, the app secret is
# not set and anyone who finds the URL can write into private conversations.
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://api.umastande.co.za/api/whatsapp/webhook \
  -H 'Content-Type: application/json' -d '{}'
# → 403
```

---

## 3. The template — this is the part that takes time

WhatsApp Manager → **Message templates** → Create template.

| Field | Value |
|---|---|
| Category | **Authentication** |
| Name | `mastande_signin_code` (lower case and underscores only) |
| Language | English — and whatever you pick goes in `WHATSAPP_TEMPLATE_LANG` |

Meta writes the body of an authentication template; you do not. You choose:

- **Code expiration** — set it to **10 minutes**, which is what the API tells
  people (`OTP_TTL_MINUTES`). ⚠️ Nothing links these two numbers. If you set 5
  here, the app will keep saying 10 and nobody will find out from a log.
- **Button** — **Copy code**. (One-tap autofill needs an Android app and a
  signing-key handshake; there is no Mastande app.)
- **Add security recommendation** — on. It appends "For your security, do not
  share this code".

Submit. Authentication templates are usually approved in minutes, occasionally
hours. **Wait for APPROVED, not Submitted** — sending against a template Meta
does not yet hold fails with **132001**, which reads like a typo in the name.

Then set, on the API:

```
WHATSAPP_TEMPLATE_OTP=mastande_signin_code
WHATSAPP_TEMPLATE_LANG=en
```

and redeploy. Config is read at boot.

---

## 4. Prove it end to end

There is no substitute for a real handset — nothing in this repository has ever
delivered a message to one.

1. Open the site, choose **"💬 Use my phone number instead"**, enter your own
   number.
2. The code should arrive on WhatsApp within seconds, with a **Copy code**
   button.
3. If it does not, read the API log. The error message names what was sent and
   quotes Meta's own reply:

| Meta error | What it means |
|---|---|
| **131047** | No template was used (or it was not approved) and you are outside the 24-hour window. `WHATSAPP_TEMPLATE_OTP` is blank or wrong |
| **132001** | Template name or language does not match anything Meta holds. Check `WHATSAPP_TEMPLATE_LANG` before assuming the name is wrong |
| **131026** | The number cannot receive WhatsApp messages |
| **190** | The access token expired — you are probably still on the 24-hour test token |

Before touching production you can check the **shape** of what gets sent,
without Meta and without credentials:

```bash
cd backend && npm run build && cd ..
node scripts/whatsapp-template-drive.mjs
```

It stands up a stub Cloud API and reads the actual request. ⚠️ It cannot check
that your template is approved — that is the one thing only a real send proves.

---

## 5. What still will not work, and why that is survivable

Only the sign-in code uses a template. These four are still free-form text and
still fail outside the 24-hour window. Each **degrades honestly** rather than
breaking, which is why none of them is urgent:

| Path | What happens when WhatsApp declines |
|---|---|
| A tenant applied / wrote | the email notification still goes |
| Rent reminder | nothing is sent; the landlord's own record is unaffected |
| Reference request | the screen says it could not reach them; an admin phones instead |
| Notice to a phone-only account | the in-app notice is written **first**, and `whatsappError` records the reason |

The listing bot's replies are **genuinely fine** — the landlord messaged you
first, so those are inside the window by construction.

Making the other four work means a **Utility** template each, approved
separately, and each one costs per message. That is a decision about money and
is not made here: see `docs/OUTSTANDING.md` §27.

---

## 6. Cost — WhatsApp sign-in is NOT free

⚠️ **Every sign-in code costs money, from the first one.** There is no free
allowance that covers it.

Meta charges **per message**, not per conversation — that changed in July 2025
— by category and by the **recipient's** country. The four categories are
Marketing, Utility, Authentication and Service.

### What Mastande actually sends

| What | Category | Charged? |
|---|---|---|
| Sign-in code (`sendOtp`) | **Authentication** | **Yes, every one.** No free tier applies |
| Listing-bot replies to a landlord | Service | First **1,000 per number per month** free, then charged |
| Landlord notifications, rent reminders, reference requests, notices | Utility (once templated) | Charged. Today they are free-form text and mostly fail — §5 |

The 1,000 free **service** messages a month are per business phone number, do
not carry over, and **do not cover Authentication, Utility or Marketing** —
those are billed from message one.

### Rough figures for South Africa

Authentication to a South African number is about **USD $0.0095 per message**
as of the 1 October 2026 rate change (it was $0.0076 before), **plus 15% VAT**.

At roughly R18/USD that is about **R0.17 + VAT ≈ R0.20 per sign-in code**, so
about **R200 per 1,000 codes**. A person who mistypes and asks for a second
code costs twice.

⚠️ **Verify before you budget.** Meta reviews rates quarterly — 1 January,
1 April, 1 July, 1 October — and the figures above are read off third-party
summaries, because Meta's own docs are not reachable from the environment this
was written in. The authoritative number is on Meta's WhatsApp pricing page and
in WhatsApp Manager → Billing for your own account, in your own currency.

### What that means for the product

This is a cost to **Umastande**, not to a landlord or a tenant, so it does not
touch the "free to list, free to apply" rule. But it is a **real per-head cost
on a free product**, and it scales with sign-ins rather than with revenue.

Two things follow:

- **Email magic links cost nothing and already work.** WhatsApp sign-in is for
  the person who has no email address — which is a real and important part of
  this market, and exactly who the product is built for — not the default for
  everybody who happens to have a phone.
- **Watch the service-message allowance** if the WhatsApp listing bot takes
  off. A landlord listing a room is a back-and-forth of several messages, so
  1,000 free a month is roughly a hundred or two listings, and after that each
  reply is billed at the same rate as a utility message.
