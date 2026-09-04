# Authentication — what exists and what is worth adding

Written 3 Sep 2026, prompted by a good observation: RentBoard is used intensely
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
