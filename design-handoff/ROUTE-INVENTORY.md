# Route inventory — Mastande

**Generated from the code, not from documentation.**
`node design-handoff/tools/routes.mjs --md`

Every row below was parsed out of the actual `*.routes.ts` files at
`frontend/src/app/`. Nothing here was transcribed by hand or read off a design
doc, and that is deliberate: a previous audit of this codebase found the
navigation **defined six times and disagreeing with itself**, and nine nav items
pointing at destinations that did not exist. A hand-written route list is the
single artefact most likely to be wrong in a project like this.

Re-run the tool rather than editing this file.

---

## How to read it

- **Path** is the real URL a person reaches. Lazy-loaded children are resolved
  through their mount, so a landlord screen reads `/landlord/properties`, not
  `properties`.
- **Guards** are inherited. A guard on a mount applies to everything beneath it,
  and is repeated on each row rather than left implicit.
- **`(mount)`** is a route that renders no page of its own — it exists to host
  children. Where it names a component, that component is the **shell** (the
  portal chrome: sidebar, header) every child renders inside. Those shells are
  design surfaces and are listed for that reason.
- **`→ /something`** is a redirect. People land on these, so they belong in the
  information architecture even though they render nothing.

## Four things a designer needs to know before reading the table

**1. Every public route exists twice.** Routes are declared once and mounted
twice: bare for English, and under `/:lang/` for the ten other official South
African languages. `/pricing` and `/zu/pricing` are the same screen. English is
deliberately unprefixed — `/en/pricing` does not exist, because two URLs serving
identical content is the duplication `hreflang` exists to prevent.

**2. `/landlord/properties/ungrouped` is not in this table, and it is a real
screen.** It is `properties/:propertyId` with the literal string `ungrouped`
passed as the id — a sentinel, not a route. It renders the rooms belonging to no
property. Any IA diagram drawn from route declarations alone will miss it.

**3. The portal shells are three copies of one idea.** `/tenant`, `/landlord`,
`/account` and `/admin` each mount `PortalLayout` with a different nav. The
chrome is shared; the contents of the sidebar are not.

**4. `/account` is deliberately role-neutral.** Messages, notices, settings and
account closure live there because a landlord and a tenant need the identical
screen, and two copies would be two things to keep in sync. It carries
`authGuard` only — no role guard.

---


### Public — 20 route(s)

| Path | Renders | Guards |
|---|---|---|
| `/` | Home | — |
| `/rooms` | → / | — |
| `/rooms/:id` | RoomDetail | — |
| `/` | (mount) | — |
| `/how-it-works` | HowItWorks | — |
| `/advertise` | Advertise | — |
| `/pricing` | Pricing | — |
| `/templates` | (mount) | — |
| `/templates` | TemplatesList | — |
| `/templates/:slug` | TemplateDocument | — |
| `/legal` | (mount) | — |
| `/legal` | → /privacy | — |
| `/legal/privacy` | PrivacyPolicy | — |
| `/legal/terms` | Terms | — |
| `/legal/disclaimer` | Disclaimer | — |
| `/legal/cookies` | Cookies | — |
| `/legal/sublet` | Sublet | — |
| `/legal/paia` | Paia | — |
| `/reference/:token` | ReferenceRespond | — |
| `/**` | ErrorPage | — |

### Landlord — 16 route(s)

| Path | Renders | Guards |
|---|---|---|
| `/landlords/:slug` | Storefront | — |
| `/landlord` | PortalLayout (shell) | authGuard + landlordGuard |
| `/landlord/templates` | TemplatesList | authGuard + landlordGuard |
| `/landlord/templates/:slug` | TemplateDocument | authGuard + landlordGuard |
| `/landlord/dashboard` | LandlordDashboard | authGuard + landlordGuard |
| `/landlord/rooms/new` | CreateRoom | authGuard + landlordGuard |
| `/landlord/rooms/:roomId/edit` | CreateRoom | authGuard + landlordGuard |
| `/landlord/properties` | Properties | authGuard + landlordGuard |
| `/landlord/properties/:propertyId` | Yard | authGuard + landlordGuard |
| `/landlord/yard` | → /properties | authGuard + landlordGuard |
| `/landlord/applicants` | ApplicantsInbox | authGuard + landlordGuard |
| `/landlord/rooms/:roomId/applicants` | Applicants | authGuard + landlordGuard |
| `/landlord/verification` | LandlordVerification | authGuard + landlordGuard |
| `/landlord/public-page` | StorefrontSettings | authGuard + landlordGuard |
| `/landlord/services` | LandlordServices | authGuard + landlordGuard |
| `/landlord` | → /dashboard | authGuard + landlordGuard |

### Auth — 10 route(s)

| Path | Renders | Guards |
|---|---|---|
| `/auth` | (mount) | — |
| `/auth/login` | Login | — |
| `/auth/register` | Register | — |
| `/auth/register-phone` | RegisterPhone | whatsappOnlyGuard |
| `/auth/magic` | MagicLink | — |
| `/auth/lost-number` | LostNumber | — |
| `/auth/forgot-password` | ForgotPassword | — |
| `/auth/reset-password` | ResetPassword | — |
| `/auth/callback` | AuthCallback | — |
| `/auth` | → /login | — |

### Tenant — 8 route(s)

| Path | Renders | Guards |
|---|---|---|
| `/tenant` | PortalLayout (shell) | authGuard + tenantGuard |
| `/tenant/dashboard` | TenantDashboard | authGuard + tenantGuard |
| `/tenant/passport` | PassportVerify | authGuard + tenantGuard |
| `/tenant/rent` | TenantRent | authGuard + tenantGuard |
| `/tenant/sublet/new` | CreateRoom | authGuard + tenantGuard |
| `/tenant/sublet/:roomId/edit` | CreateRoom | authGuard + tenantGuard |
| `/tenant/sublet/:roomId/applicants` | Applicants | authGuard + tenantGuard |
| `/tenant` | → /dashboard | authGuard + tenantGuard |

### Account (both roles) — 6 route(s)

| Path | Renders | Guards |
|---|---|---|
| `/account` | PortalLayout (shell) | authGuard |
| `/account/settings` | AccountSettings | authGuard |
| `/account/notices` | Notices | authGuard |
| `/account/messages` | MessagesInbox | authGuard |
| `/account/close` | CloseAccount | authGuard |
| `/account` | → /settings | authGuard |

### Admin — 13 route(s)

| Path | Renders | Guards |
|---|---|---|
| `/admin` | PortalLayout (shell) | authGuard + adminGuard |
| `/admin/dashboard` | AdminDashboard | authGuard + adminGuard |
| `/admin/recoveries` | AdminRecoveries | authGuard + adminGuard |
| `/admin/verifications` | AdminVerifications | authGuard + adminGuard |
| `/admin/reports` | AdminReports | authGuard + adminGuard |
| `/admin/disputes` | AdminDisputes | authGuard + adminGuard |
| `/admin/advertising` | AdminAdvertising | authGuard + adminGuard |
| `/admin/referrals` | AdminReferrals | authGuard + adminGuard |
| `/admin/surveys` | AdminSurveys | authGuard + adminGuard |
| `/admin/services` | AdminServices | authGuard + adminGuard |
| `/admin/analytics` | AdminAnalytics | authGuard + adminGuard |
| `/admin/users/:id` | AdminUserDetailPage | authGuard + adminGuard |
| `/admin` | → /dashboard | authGuard + adminGuard |

_73 routes. :lang mirror: true_

---

## What this inventory cannot tell you

- **Whether a route is reachable by clicking.** A route resolving is not the
  same as a person being able to find it. This project has shipped screens with
  no navigation entry at all, and nav entries pointing at paths that 404.
  `scripts/nav-audit.mjs` is the check for that; this file is only the map.
- **Whether a screen is finished.** `/landlord/services` and
  `/admin/advertising` resolve and render; so does a page with one heading on it.
- **Conditional visibility.** `/auth/register-phone` carries
  `whatsappOnlyGuard`, which redirects to `/auth/register` while
  `WHATSAPP_ENABLED` is false — which it currently is. The route exists; today
  nobody can reach it.
