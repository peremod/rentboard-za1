# Authentication — what exists and what is worth adding

Written 3 Sep 2026, prompted by a good observation: Mastande is used intensely
for a few weeks and then not for a year. By the time someone returns to leave a
review or find their next room, the password is gone — and a forgotten password
is where people give up rather than reset.

---

## 1. What exists now

| Method | Status | Notes |
|---|---|---|
| Email + password | ✅ | Any email provider, not just Gmail |
| Google | ✅ | Any Google account, not only @gmail.com addresses |
| **Magic link** | ✅ **v1.40.0** | Passwordless. The answer to the problem above |
| Password reset | ✅ | Hashed single-use token, one hour |

**A clarification worth making:** the site was never Gmail-only. Google OAuth
accepts any Google account, including work accounts on custom domains, and
email/password has always worked with any address. The gap was not which
provider — it was that both paths need a credential someone has to remember.

## 2. Magic link, and why it is the real fix

The email address is the account. Enter it, get a link, tap it, you are in. No
password to forget, nothing to reset.

- Link is single-use and expires in 15 minutes
- Using one invalidates every other outstanding link for that account, so an
  older email sitting in the inbox is dead
- Only a SHA-256 hash of the token is stored
- The response is identical whether or not the address has an account —
  otherwise the form becomes a way to test whether someone is on the platform,
  which on a room-letting site discloses something about them

This does not weaken security. Any account with password reset is already
recoverable by whoever controls the inbox; magic link just removes the
pretence that the password added a second factor.

## 3. The social providers, honestly

### Google — setting it up

Google sign-in is built and wired; it refuses to start the handshake until
credentials exist, returning a 503 that names the two variables. That is
deliberate — the alternative is a redirect to a Google error page that tells
the visitor nothing.

**1. Create the project and credentials**

1. Google Cloud Console → create a project (or reuse one)
2. **APIs & Services → OAuth consent screen**
   - User type: **External**
   - App name, support email, developer contact
   - Scopes: `email` and `profile` only. Nothing else is requested, and asking
     for more triggers a verification review you do not need
   - While in **Testing**, only accounts listed under Test users can sign in.
     Publish before launch, or real users hit "app is blocked"
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorised redirect URIs — add one per environment:

```
http://localhost:3000/api/auth/google/callback
https://<staging-api-host>/api/auth/google/callback
https://api.mastande.co.za/api/auth/google/callback
```

The path is not configurable by accident: it is the `@Get('google/callback')`
route under the global `api` prefix. A mismatch produces `redirect_uri_mismatch`
and nothing else.

**2. Set the variables**

```bash
GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback
```

`GOOGLE_CALLBACK_URL` must match the environment it runs in. It defaults to
localhost if unset, which works in development and silently breaks staging —
so set it explicitly on every deploy target, exactly as registered above.

**3. Check it**

Restart the backend and click "Continue with Google". A 503 means the
credentials are not loaded; `redirect_uri_mismatch` means the URI in the
console does not match `GOOGLE_CALLBACK_URL` character for character, including
scheme, port and trailing path.

**One behaviour worth knowing.** Signing in with Google for an email that
already has a password account links the two rather than creating a duplicate.
The reverse is also true: a Google-created account can add a password later
through the reset flow, because the email is proven either way.

### Facebook — worth adding

Real OAuth, widely used in South Africa, works. The cost is Meta's app review
(days, not hours) and a privacy policy URL, which you have.

Add when there is evidence people want it. The provider structure is already
generic — `authProvider` is a string, not an enum, so no migration is needed.

### X / Twitter — probably not worth it

Technically possible via OAuth 2.0, but:

- API access is paid, and the free tier does not reliably cover login
- X usage in South Africa is a fraction of Facebook or WhatsApp
- The audience — people looking for a room to rent — is not concentrated there

Cost is ongoing and the reach is small. If social login is wanted, Facebook
covers far more of this audience for a one-off review process.

### WhatsApp — the important correction

**There is no "Sign in with WhatsApp".** Meta does not offer WhatsApp as an
identity provider, so it cannot be added the way Google or Facebook can.

What exists, and is genuinely the best fit for this market, is **phone OTP
delivered over WhatsApp**: the user enters a number, receives a code in
WhatsApp, and enters it. That is phone authentication using WhatsApp as the
delivery channel.

It is a strong option here — nearly universal in South Africa, no password, and
the platform already has WhatsApp Business API integration for notifications.
It needs:

- A verified `phoneVerified` flag, since signing someone in on an unverified
  number would let anyone claim an account by typing a number they do not own.
  The column is in the schema
- An OTP token type, already added
- Rate limiting per number, because each send costs money and an open endpoint
  is an easy way to run up a bill
- Consideration of number reuse: South African numbers get recycled, so a
  dormant account attached to a reassigned number is a real risk

Not built yet. It is the next thing worth doing, ahead of any social provider.

## 4. Recommended order

1. **Magic link** — done. Solves the stated problem directly
2. **WhatsApp OTP** — highest value for this market, reuses existing WhatsApp integration
3. **Facebook** — add if signups suggest people want it
4. **X** — likely never

## 5. What to tell people

The login page now offers "Email me a sign-in link instead" beneath the
password field. That phrasing matters: it is not presented as a fallback for
people who failed to log in, but as an equal option, because for this usage
pattern it is the better one.

---

## 6. Session persistence across a reload

Reloading a guarded page used to sign people out. It took a long time to fix
because it was six separate faults presenting as one symptom, and fixing any
one of them changed the behaviour without resolving it.

| Fault | Effect | Fixed in |
|---|---|---|
| Login sent no credentials | Browser discarded the `Set-Cookie`, so the refresh cookie was never stored | v1.46.2 |
| Guards read `isAuthenticated()` synchronously | Decided before the refresh returned | v1.46.0 |
| Refresh rotation had no grace window | Two in-flight refreshes looked like token theft, revoking every session | v1.47.0 |
| The 401 handler called `logout()` | Revoked the session it was about to restore, and navigated home | v1.47.2 |
| Login redirects used `router.url` | Nested `returnUrl` inside itself, needing four reloads to unwind | v1.47.1 |
| Dashboard calls fired before the refresh | Four guaranteed 401s per load, each triggering a redirect | v1.47.6 |

### The shape of the fix

Requests to our own API now **wait** for the startup refresh to settle before
being sent, rather than racing it and handling the fallout downstream. Every
earlier attempt treated a symptom of that race.

Two supporting rules:

- **A 401 that arrives while authenticated is stale.** It is a reply to a
  question asked before the session existed, and must not sign anyone out.
- **Nothing authenticated is fetched during SSR.** There is no cookie on the
  server, so those requests can only fail. Guarded routes are client-rendered,
  so the browser loads the data a moment later.

### What made this hard to diagnose

Three different consoles were in play — the browser, the API server, and the
frontend dev server, which prints SSR output. "The log" meant a different one
at different times, and the same message appearing in a different console
meant something completely different.

The thing that finally resolved it was three `console.info` lines in the
client, added late. They showed the refresh succeeding, the guard passing, and
the redirect happening anyway — which located the fault in the interceptor in
a single reload, after several rounds of reasoning about cookie attributes that
were never the cause.
