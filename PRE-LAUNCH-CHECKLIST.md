# RentBoard ZA — Pre-Launch Checklist

Consolidates every `[PLACEHOLDER]`, deferred item, and audit finding scattered across `README.md §1–19` and your `RentBoard-ZA-Audit-Report.html`, in one place. Nothing here is new — it's a merge. Each item was checked against the actual repo (not assumed) before being listed, so "already fixed" means genuinely verified, not guessed.

Legal counts as much as code here: several of these are compliance-critical, not just security-critical.

---

## 🔴 Critical — must fix before launch

| # | Item | Status | Where |
|---|---|---|---|
| 1 | ~~JWT stored in `localStorage`~~ | ✅ **Fixed in v0.9.2** | Access token now lives only in an in-memory Angular signal, never persisted. Confirmed by grep — zero `localStorage` references for tokens/user data anywhere in the frontend. |
| 2 | ~~No refresh token rotation~~ | ✅ **Fixed in v0.9.2** | Access token shortened to 15 min. New `RefreshToken` model — opaque random value, stored only as a sha256 hash, delivered as an httpOnly+secure+sameSite cookie, rotated on every use. Reuse of an already-rotated token (theft signal) revokes every session for that user, not just documented as a risk. See `README §20`. |
| 3 | ~~No input sanitisation on free-text fields~~ | ✅ **Fixed in v0.9.1** | `sanitizeText()` (strips all markup) now applied at every write: `Room.title`/`description`, `Application.coverNote`/rejection `reason`, `Message.body` (both in-app and inbound WhatsApp). **Also fixed a sharper version of the same bug found while tracing this:** every `NotificationsService` email template interpolated user text directly into raw HTML with zero escaping — the actual exploitable path, since mail clients render HTML by default. `escapeHtml()` is now applied to every dynamic value in all 6 templates. |
| 4 | ~~Missing PAIA manual route~~ | ✅ **Already fixed** | Built in pass 0.3.0 — `frontend/src/app/features/legal/paia/paia.ts`, routed at `/legal/paia` |

## 🟡 Important — fix before launch

| # | Item | Status | Where |
|---|---|---|---|
| 5 | **Git squash-merge not enforced** — `CONTRIBUTING.md` documents the policy, but nothing enforces it. This is a GitHub branch-protection setting, not something fixable in files | ⬜ Open — manual GitHub setup | Repo Settings → Branches → `develop`/`main` protection rules |
| 6 | **Rebase-before-PR not documented in README** — only in `CONTRIBUTING.md` | ⬜ Open, low effort | `README.md §7` |
| 7 | **Admin guard not wired at module level** | ✅ **Not applicable yet** | No `AdminModule`/admin endpoints exist in this repo at all — nothing to leave unguarded. Flag this again the moment an admin module is built, not before. |
| 8 | ~~`ZarCentsPipe` not imported in components~~ | ✅ **Already fixed** | Used consistently in `RoomCard`, `RoomDetail`, `LandlordDashboard`, `TenantDashboard` since pass 0.3.0/0.4.0 — verified by grep, not assumed |
| 9 | **Dashboards not fully mobile-responsive** | ⬜ Open, but smaller than the original finding | `LandlordDashboard`/`TenantDashboard`/`Applicants` use flexbox rows, not the rigid two-column grid the audit describes — but still unverified below ~400px |

## 🟢 Minor — nice to fix

| # | Item | Status | Where |
|---|---|---|---|
| 10 | ~~Missing `track` in `@for` loops~~ | ✅ **Already fixed** | Verified by grep — every `@for` in the repo has `track`, zero exceptions |
| 11 | **No error boundary on lazy-loaded routes** — a failed chunk load (network error) shows a blank screen | ⬜ Open | `frontend/src/app/app.config.ts` |

---

## Legal — compliance placeholders (not optional, separate from the audit)

| Item | Where | Action needed |
|---|---|---|
| `[YOUR COMPANY NAME]`, CIPC registration number, registered address, Information Officer name | `PrivacyPolicy`, `Paia` components | Fill in real values — have a South African attorney review the legal pages generally, not just these fields |
| **PAIA manual must be filed with the SAHRC** | — | Form 2, paia@sahrc.org.za, no fee — this is a legal filing obligation, not a code task |
| Information Regulator registration number | `Paia` component | Register with the Information Regulator (South Africa) per POPIA, get the number, add it |

## Stripe — every placeholder from §18

| Item | Where |
|---|---|
| `STRIPE_PRICE_PRO_MONTHLY`/`_ANNUAL`, `STRIPE_PRICE_AGENCY_*` | `backend/.env.example` — create real Products/Prices in Stripe Dashboard; **must match** the illustrative amounts hardcoded in `Upgrade`'s template (R349/R2,999/R1,499/R12,999) or the UI will show a different price than what's charged |
| `STRIPE_PRICE_PASSPORT_MONTHLY`/`_ANNUAL` | Same — must match `Passport`'s template (R89/R799) |
| `STRIPE_PRICE_ROOM_BOOST` | Same — `LandlordDashboard`'s boost button hardcodes "R99" as display text |
| `STRIPE_WEBHOOK_SECRET` | From Stripe Dashboard → Webhooks → signing secret |
| Renter's Passport **verification** (not payment) | Third-party KYC integration (e.g. Smile Identity, Youverify) — not built, not on the roadmap yet. `Passport` component's copy is deliberately explicit that verification is manual/reviewed, not instant |

## Third-party credentials needed for a real deploy

| Service | Env vars | Notes |
|---|---|---|
| Supabase Postgres | `DATABASE_URL`, `DIRECT_URL` | Pooled (6543) vs direct (5432) — see `README.md §19` |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | Optional — email/password login works without it |
| ImageKit | `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT` | Required for the photo-upload flow (pass 0.6.0) to actually work |
| Resend | `RESEND_API_KEY` | Required for any of the 6 email templates (pass 0.5.0) to actually send |
| WhatsApp Business API | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN` | Optional — email notifications never depend on this |
| Stripe | see table above | Required for pass 0.8.0's payment flows |
| Vercel / Railway deploy secrets | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `RAILWAY_TOKEN` | GitHub Actions secrets, not `.env` |

## i18n — translation status (from §19, repeated here so it's not missed)

English is authoritative. Afrikaans and isiZulu are real attempts flagged for native-speaker review. **isiXhosa, Sesotho, Setswana, Sepedi, Xitsonga, siSwati, Tshivenda, and isiNdebele are English-fallback stubs** — the app runs correctly, but the language switcher cannot honestly claim to support those 8 until real translation happens.

---

## Suggested order of work for pass 1.0.0

1. ~~Input sanitisation (#3)~~ ✅ Done — v0.9.1
2. ~~Auth hardening (#1, #2)~~ ✅ Done — v0.9.2
3. Error boundary on lazy routes (#11) — small
4. Mobile responsive pass on the three dashboard-style pages (#9) — small
5. README rebase note (#6) — trivial
6. Everything else in this file is either a manual step outside the codebase (branch protection, SAHRC filing, Stripe Dashboard config) or a future pass (KYC integration, remaining 8 translations) — not blocked on code changes here.
