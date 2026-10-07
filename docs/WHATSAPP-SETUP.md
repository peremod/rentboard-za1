# WhatsApp Business API — setup

What this covers: getting Meta credentials, pointing the webhook at the API,
and getting a template approved so sign-in codes actually arrive.

**Read this first.** Credentials alone do **not** make WhatsApp work. Meta
permits free-form text only inside the **24-hour customer service window** —
within 24 hours of the person messaging you. A sign-in code goes to somebody who
has not messaged you, by definition, so without an approved template every one
is rejected with **error 131047**. The API logs a warning at boot if you set
credentials and leave the template name blank.

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

## 6. Cost

Meta charges per conversation, by category and country. Authentication
conversations in South Africa are billed per delivered message.

This is a cost to **Umastande**, not to a landlord or a tenant — it does not
touch the "free to list, free to apply" rule. But it is a real per-sign-in cost
and it scales with sign-ins, so watch it in the WhatsApp Manager billing page
before turning phone sign-in on for everybody. Email magic links cost nothing
and already work.
