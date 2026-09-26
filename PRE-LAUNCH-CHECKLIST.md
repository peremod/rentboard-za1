# Mastande ZA — Pre-Launch Checklist

## Launch readiness summary (v1.6.0)

**Corrected 26 Aug 2026.** The previous version of this summary claimed
"everything fixable inside this repo is done… each verified before commit."
That was written before the project had ever been executed. Those pre-commit
checks only proved that imports resolved and exported names matched — they
never ran the code. When it was first run end to end, roughly twenty real
defects surfaced that this checklist did not list:

- `@angular/vitest` — a package that does not exist on npm
- Five dependency majors incompatible with their own cores (TypeScript,
  vitest, `@nestjs/config`/`jwt`/`passport`/`swagger`)
- An SSR crash on every page load (`IntersectionObserver` during server render)
- Three services that aborted API bootstrap when optional credentials were
  absent (Resend, Google OAuth, and `esModuleInterop` for compression)
- A cross-user data leak: saved rooms shared one global storage key, so on a
  shared device one account saw another's saved rooms
- Applications had no letting cycle, and a unique constraint that locked a
  tenant out of a room permanently after one application
- Placeholder ImageKit URLs (`mastande-dev`) that 404'd every image
- The visual spec was never wired up: 15 of 132 class names matched, so the
  design in `RentBoard-ZA-Visual-Preview.html` had never actually applied

**Treat this document as a map of known gaps, not as evidence of working
software.** The distinction matters: it is the reason the above went unnoticed.

### What is now genuinely verified

| Area | Evidence |
|---|---|
| API end to end | `./scripts/smoke-test.sh` — 64 checks: auth, room lifecycle, applications, messaging, both dashboards, listing wizard validation |
| Cross-tenant isolation | Four IDOR checks: a second tenant cannot read, post into, accept or list another tenant's application |
| ImageKit | `./scripts/test-imagekit.sh` — live credentials, signed upload confirmed |
| Full UI flow | Manually walked: register → post room → upload photo → publish → browse → apply → message |
| Responsive | Ported from `Visual-Preview-v2.html` (900/768/480), verified in device emulation |

### What is still unverified

- No deployment has been done — staging and production are untested
- No automated test coverage beyond one pipe spec; the smoke test is an
  integration check against a running server, not a unit suite
- Email is unconfigured, so the apply → notify → respond loop has never
  completed with a real message reaching a landlord
- Load, backup and restore have never been exercised

---

| Category | What's left | Blocking launch? |
|---|---|---|
| **Rebrand (v1.55.0, domain changed v1.60.0)** | `umastande.co.za` must be registered and pointed at Vercel; the domain verified in Resend; the Render service and Vercel project renamed. The code rename is done — these three are provider-side and nothing in the repo can detect them | Yes — staging's API host and the production domain do not resolve until they are done |
| **Legal filing** | PAIA manual must be filed with the SAHRC (Form 2, no fee) | Yes — legal requirement |
| **Legal content** | `[PLACEHOLDER]` company name, CIPC number, address, Information Officer name/reg. number in the legal pages. Still rendering live in the footer as `© 2026 [YOUR COMPANY NAME] (Pty) Ltd · CIPC Reg No. [NUMBER]`. The rebrand does not change these — the registered entity is whatever CIPC says, not the trading name | Yes — have an attorney review while you're at it |
| **GitHub settings** | Branch protection rules to actually enforce the squash-merge policy `CONTRIBUTING.md` describes | Recommended, not launch-blocking |
| **Stripe Dashboard** | ~~Create the 7 real Products/Prices; get the webhook signing secret~~ Not needed right now — billing is deliberately paused (see "Temporarily disabled" below), free tier only | No — paused by request |
| **Third-party credentials** | ImageKit, Resend, WhatsApp Business API, Google OAuth | Partial — photo upload and email need theirs; WhatsApp and Google login are optional |
| ~~**KYC integration**~~ | ✅ **Closed in v1.56.0, by not doing it.** The Renter's Passport is no longer payment-only — it is no longer payment at all. A third-party KYC provider was the wrong answer for this market: it screens on a credit history most renters here do not have, and would exclude exactly the people the product is for. Replaced with informal-economy proofs reviewed by a person — SASSA confirmation, employer confirmation, three months of banking-app screenshots, or a previous landlord phoned. See README §22 | No |
| **Translation** | 8 of 11 official languages are honest English-fallback stubs | No — English works, switcher just shouldn't claim those 8 yet |

Full detail on every row above is in the tables below — this summary is the map, not the whole territory.

---

Consolidates every `[PLACEHOLDER]`, deferred item, and audit finding scattered across `README.md §1–19` and your `RentBoard-ZA-Audit-Report.html`, in one place.

A caution on the tables below: "already fixed" in the original text meant the
code had been read, not run. Where a row has not been re-confirmed against a
running system since 26 Aug 2026, treat it as unverified.

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
| 6 | ~~Rebase-before-PR not documented in README~~ | ✅ **Not applicable — already present** | `README.md §7` has documented "rebase-before-PR" in prose and a working `git rebase origin/develop` command example since pass 0.1.0. Re-checked against the actual file rather than assumed. |
| 7 | **Admin guard not wired at module level** | ✅ **Not applicable yet** | No `AdminModule`/admin endpoints exist in this repo at all — nothing to leave unguarded. Flag this again the moment an admin module is built, not before. |
| 8 | ~~`ZarCentsPipe` not imported in components~~ | ✅ **Already fixed** | Used consistently in `RoomCard`, `RoomDetail`, `LandlordDashboard`, `TenantDashboard` since pass 0.3.0/0.4.0 — verified by grep, not assumed |
| 9 | Dashboards not fully mobile-responsive | ⚠️ **Superseded — re-done in v1.3.2–v1.4.3** | The v0.9.3 fix (component `styles: []` with a 480px breakpoint) was itself the problem: Angular's emulated encapsulation makes component styles *more specific* than global CSS, so they silently overrode the entire responsive layer and every breakpoint was ignored. Those styles were removed and both dashboards rebuilt on a shared `PortalShell`. Responsive rules now live in `_responsive.scss`, ported from `Visual-Preview-v2.html` (900/768/480). |
| 12 | **The Lighthouse gate has never been green** — it had run twice, both red. Config faults fixed in v1.58.0 (two `"//1"`/`"//2"` comment keys inside `assertions`, where every key is an audit id; `render-blocking-resources` asserted with `maxNumericValue`, which reads NaN on an opportunity audit; and `"preset": "perf"`, which meant accessibility, best-practices and SEO were never collected at all, so every assertion naming them had no data). The four real findings were fixed in v1.72.0, robots.txt and the soft 404s in v1.73.0–v1.73.1. **Measured on a GitHub runner at v1.73.1, 4 URLs × 3 runs:** performance **0.94** (was 0.84, floor 0.9), accessibility **1.0** (was 0.96–0.98), SEO **1.0** with no failing audits (was 0.92 — `robots-txt` and `is-crawlable` both pass now), LCP **2.16s** (was 3.47s, budget 2.5s), TBT 172ms, CLS 0.035. **One assertion still fails and it is not ours to fix:** best-practices sits at 0.96 on `/` because `errors-in-console` records two `ERR_NAME_NOT_RESOLVED` entries for `https://api.umastande.co.za` — the board's own listing and ad requests, against a domain that is not registered yet. It clears itself the week the domain resolves. Do not lower the floor to make it green sooner | ⚠️ **Green except one assertion waiting on DNS** | `lighthouserc.json`, `frontend/src/server.ts`, `scripts/a11y-drive.mjs` |
| 13 | **Dependency advisories.** `npm audit` reported 10 in production dependencies (1 moderate, 9 high). Patch bumps in v1.63.0 cleared `qs`, `js-yaml`, `@nestjs/swagger`, `prisma` and `@prisma/config` — all within the same major, smoke suite and refund drive unchanged. **The 8 that remain are not on the request path, which is why they are here and not above:** four are `multer` DoS advisories, and this app has no `FileInterceptor` and no `@UploadedFile` anywhere — photos go client-side to ImageKit under a signed token, so multer never processes a request; the rest are the NestJS packages that depend on it, plus `deepmerge-ts`, which arrives through the Prisma **CLI's** config loader rather than anything serving traffic. Clearing them needs NestJS 11 → 12 and Prisma 6 → 8, two major upgrades that deserve their own pass rather than being smuggled into a patch | ⚠️ **Non-breaking fixes applied; two major upgrades deferred** | `backend/package-lock.json` |
| 14 | **The deployment check had never completed once.** Nineteen runs, all stuck in the same step until GitHub killed them at six hours — six hours of runner time per push to report nothing. Four faults: no `--max-time` on any curl (a suspended Render service accepts the connection and never answers, so one call froze the loop), no job `timeout-minutes`, a "not deployed yet" guard that tested DNS when every `*.onrender.com` name resolves whether or not a service exists, and a hostname pointing at a service that was never created. Rewritten in v1.65.0 and driven through eight scenarios including the original hang — old script exit 124 still running at 90s, new script exit 1 at 78s with a diagnosis. It now also asserts the deployed **version matches the pushed commit**, so a pass means the deploy landed rather than that something answered | ✅ **Fixed — needs `STAGING_API_HOST` set to start enforcing** | `.github/workflows/verify-deployment.yml`, `docs/DEPLOYMENT.md` §5 |
| 15 | **Staging silently stopped deploying for five releases, and CI never noticed.** v1.62.0 added `postinstall: prisma generate` to `backend/package.json` — right for a developer's checkout, fatal in the Dockerfile's production stage, which runs `npm ci --only=production` where the prisma CLI is a devDependency and therefore absent. npm exits 127, the image never builds, and Render goes on serving the last good build. Staging sat at v1.61.0 through v1.66.0 while every CI run stayed green, because **nothing in CI had ever built `backend/Dockerfile`** — the backend job runs `nest build` on a full install, which is a different path. Fixed in v1.67.0: `--omit=dev --ignore-scripts` in that stage (it needs no scripts — the Prisma client is copied from the builder, and bcrypt ships prebuilt binaries), plus a CI job that builds the image Render builds and boots it | ✅ **Fixed** | `backend/Dockerfile`, `.github/workflows/ci.yml` |
| 17 | **Nine nav items went nowhere, and two named things that do not exist.** Clicking every item in both portals rather than reading the route table: `My Rooms`, `Applicants`, `Applications`, `Saved Rooms` and `Alerts` all navigated to the dashboard root — and from the dashboard that is indistinguishable from a click that did nothing, even though every one of them names a real section further down the same page. `Messages` in both portals named a screen that has never existed; threads live inside an application. Fixed in v1.70.0: fragments on the section items (`anchorScrolling` was already enabled, the items just never used it), verified by measuring `scrollY` after each click, and `Messages` marked `disabled` so it renders as a greyed “Soon” chip instead of a promise | ✅ **Fixed** | landlord + tenant `navItems`, `portal-shell.ts` |
| 16 | **Two shipped screens had no way to reach them.** `/landlord/yard` had no navigation entry at all, and `/tenant/passport`'s entry was still wrapped in `BILLING_ENABLED` — correct when the Passport sold an R89/month subscription, wrong from the moment Phase 1 made it free, and `BILLING_ENABLED` is false. The routes were fine and both pages rendered when typed into the address bar, which is exactly why a route-level check found nothing. A user clicking around could not get to either. Fixed in v1.69.0 | ✅ **Fixed** | landlord + tenant dashboard `navItems` |
| 18 | **Room pages were never actually server-rendered.** `/rooms/:id` is `RenderMode.Server` precisely so a crawler sees the room, and it served `Loading…` with the site's default title, the site's default description and no JSON-LD — on every room page, for every crawler, since the interceptor was written. `authInterceptor` returned `EMPTY` for *every* request to our own API during SSR, public reads included: `EMPTY` completes without emitting, so neither the `next` nor the `error` handler ran and the page serialised in its loading state. Three consequences, all measured: the prerendered board came out of the build showing its empty state; a room id that does not exist rendered its 200 rather than its not-found branch; and the room page's `aggregateRating` could never appear because the data it reads was never fetched. Fixed in v1.73.0 — `SSR_PUBLIC_PREFIXES` lets `/rooms`, `/reviews`, `/places` and `/ads` GETs through on the server and nothing else. A real room page went from 18,663 bytes of shell to 29,167 bytes with the title, description, room copy and `Product`/`Offer`/`AggregateRating` JSON-LD all in the served HTML | ✅ **Fixed and asserted** | `auth.interceptor.ts`, `scripts/verify-build.sh` |
| 19 | **The site's origin had no robots.txt and no sitemap.xml.** Both are generated by the backend — on the API's origin, where no crawler of the site will ever read them. At the site's own origin both paths fell through to the router's catch-all and answered **200 with the "Page not found" page**, so every `Disallow` was inert and the sitemap URL submitted to Search Console was a 200 with an HTML body. Lighthouse had been reporting it all along: `robots-txt` returned "58 errors found", each a line of our 404 page it could not parse, which is the single audit that held SEO at 0.92 on all four URLs in CI. Fixed in v1.73.0 in both places that answer that URL: a five-minute-cached proxy in `frontend/src/server.ts` (development, `node server.mjs`, the Lighthouse job) and edge rewrites in `frontend/vercel.json` (production, which is static). When the API is unreachable the fallback answers from the build's own `environment.indexable`: production stays crawlable, staging and development disallow. **The first version answered `Disallow: /` on any failure** — which is not the cautious direction but the destructive one, since a missing robots.txt means "crawl freely" while that line is an instruction Google obeys. It made the score it was meant to fix worse (SEO 0.92 → 0.66, `is-crawlable` 0) and the content-type assertion I had just added passed it. Both directions are asserted now, each against the build it belongs to | ✅ **Fixed and asserted** | `frontend/src/server.ts`, `frontend/vercel.json`, `docs/SEO.md` |
| 20 | **Every unknown URL answered HTTP 200.** The catch-all was `RenderMode.Prerender`, and a prerendered route cannot carry a status. So `/anything` was a soft 404 — which keeps the URL in the index, competing with real pages, and is what made `/robots.txt` answer 200 with HTML (row 19). Two halves to the fix, because one is not enough: the catch-alls now carry `status: 404`, and — since a `:lang` server route matches *any* single segment, server route matching happening before `localeMatchGuard` can rule it out — `/foo` and `/xx/pricing` never reach a catch-all at all. Those get their status from a marker the not-found page renders about itself, mapped in `server.ts`. `/rooms` is a declared 301. A room that does not exist answers 404 from the same marker | ✅ **Fixed and asserted** | `app.routes.ts`, `error-page.ts`, `room-detail.ts`, `frontend/src/server.ts` |
| 21 | **The portal navigation was defined six times and the copies disagreed.** The landlord dashboard listed eight items, `/landlord/yard` four, `/landlord/verification` two; the tenant dashboard nine, `/tenant/rent` five, `/tenant/passport` two; `/account/settings` had a third, three-item version per role. So the sidebar *shrank* as a person moved through their own portal: from the verification screen a landlord could not reach their property or their settings, and a tenant who opened their Renter's Passport lost Rent, Browse rooms, Settings, Applications, Saved rooms and Alerts. The admin side already did this correctly with one `ADMIN_NAV` constant — that pattern now covers all three roles, and `ADMIN_NAV` gained the Settings entry it never had (an admin had no way to reach `/account/settings` from any admin screen). `scripts/phase-drive.mjs` compares the rendered sidebar across four screens per role | ✅ **Fixed and asserted** | `landlord-nav.ts`, `tenant-nav.ts`, `admin-nav.ts`, `scripts/phase-drive.mjs` |
| 22 | **The room page said nothing about who was letting the room.** The board's room card showed a `✓ Verified` badge; the page a tenant reads before sending a stranger their details showed no badge, no name and no rating — and the detail endpoint did not even send the landlord, so it could not have. Phase 1's premise is that a badge should have a visible basis, and the basis was missing from the one screen where the decision is made. Fixed in v1.73.0: `PUBLIC_LANDLORD` is one selection shared by the list and the detail query (name, avatar, rating, `idVerified` — no email, no phone, no document), and the page states the verification either way, because silence reads as "fine" and most listings will be unverified for a while yet | ✅ **Fixed** | `rooms.service.ts`, `room-detail.ts` |
| 23 | **A local database behind on migrations reports as 110 product failures.** `scripts/smoke-test.sh` failed 110 checks with `401 Authentication required` everywhere, which reads as a broken auth system; the cause was `users.openFlagCount` not existing, so registration 500d and every authenticated check after it had no session. One `npx prisma migrate deploy` took it to 405 passed, 0 failed. This is the same shape as the remote run that reported 109 failures — **check migrations before reading a smoke run as a product fault.** `docs/RUNBOOK.md` now leads with it | ⚠️ **Environment, not code — documented** | `docs/RUNBOOK.md` |
| 24 | **Production had no SSR, and then had no site at all.** Two settings, both wrong, both live on 22 September: `outputDirectory: .../browser` published the client bundle and discarded `server.mjs`, so the deployment was static and its SPA fallback (pointing at `/index.html`, which `cleanUrls` makes unreachable) 404'd **every deep link** — `/auth/login`, the portals, every room link ever shared. Removing the setting was worse: Vercel read `outputPath` from `angular.json`, published `dist/mastande-frontend`, and **the whole site 404'd** including `/`, until it was reverted. Neither value is right, because the Angular preset does not understand the `browser/` + `server/` split. Fixed in v1.75.0 with `frontend/tools/vercel-build.mjs`, which assembles Vercel's Build Output API — static assets, an `ssr.func` carrying `server.mjs` and the browser bundle, and routes that send every page to it. `verify-build.sh` assembles the artefact, checks its shape and routes, **boots the function entry and asks it for three URLs**. Also found by booting it: Angular 21 answers **400**, not a client-rendered fallback, to a Host it does not recognise — so `server.ts` now trusts the hostnames the platform itself provides (`VERCEL_URL` and friends), which is what stops every preview deployment being half-broken | ⚠️ **Built and driven locally; verify on the preview URL before merging** | `frontend/tools/vercel-build.mjs`, `frontend/vercel.json`, `frontend/src/server.ts`, `docs/DEPLOYMENT.md §4` |
| 25 | **Every production build had failed for three days, and four releases were tagged over the red.** CI has run on `master` and `develop` since v1.68.0, and it went red at **v1.73.0 and stayed red for ten consecutive runs** — v1.73.0, v1.73.1, v1.74.0, v1.74.1, v1.75.0 and v1.75.1 were all cut on a failing run, and the `develop → master` merge carried it to `master` unchanged. Two jobs, and neither failure was what it looked like. **The frontend job's production build** reported `An error occurred while prerendering route '/af'` and `Terminating worker thread` for five more routes; the cause was one line further up and only in the full log: `AbortError: Request for: http://localhost:39047/af was aborted. TimeoutError`. `@angular/build` aborts a route at 30s and tears down the worker pool, so one hanging request fails the **whole build** and names five innocent routes. The hanging request was the board's own listing call: v1.73.0 made public reads real during SSR (row 18) and nothing bounded the wait, and `api.umastande.co.za` resolves on a GitHub runner to something that accepts the connection and never answers. Reproduced locally in 43s against a socket that accepts and never replies, then fixed and re-driven: build succeeds, and a room page answers **503 in 8.3s** instead of never. Fixed with `serverTimeoutInterceptor` — 8s on server-side requests to our own API, raising `504` so it lands on the same branch every component already handles. **A refused API had always been checked; a silent one had not**, which is the whole finding | ✅ **Fixed, asserted twice** | `server-timeout.interceptor.ts` (+ spec, in CI), `app.config.ts`, `scripts/verify-build.sh`, `docs/DEPLOYMENT.md` |
| 26 | **The board's two accessibility defects only exist when there are rooms on it.** `scripts/a11y-drive.mjs` was written in v1.72.0 and reported seven green pages four times; in CI it failed the moment the e2e job's seeded rooms put cards on the board. Both findings were in the room card. **The card's `h3` followed the hero's `h1`** with nothing between — the results region had no heading at all, and the empty state carries an `h2` for exactly this reason while the populated state never got one. The visible count is the heading now. **And the card's `aria-label="View room: {title}"` replaced everything the card shows**: an `aria-label` overrides content, so a screen-reader user tabbing the board heard a list of titles and no rent, no suburb, no availability — every one of which is on the card in text. Removed, so the card is named by its own content and WCAG 2.5.3 holds by construction; the photo's `alt` was the title verbatim two lines above the `h3` that says it, and the avatar's initial stuttered the name beside it. The drive now **fails if the board has no rooms**, because a check that reads the empty state and reports seven green pages is the same as no check. **Still open:** the portal's 51 `dash-section-title` divs are not headings, so the same `h1 → h3` skip exists on the tenant dashboard's saved rooms — unaudited, because the drive covers public pages only | ✅ **Fixed; portal headings still open** | `room-card.ts`, `home.ts`, `_spec.scss`, `scripts/a11y-drive.mjs` |
| 27 | **Two more failures were hidden behind the first ones.** A job stops at its first failing step, so the red build had been concealing the steps after it for ten runs. `e2e/locale-and-seo.spec.ts` asserted `/en/pricing` answers **200** — correct when it was written, and the exact soft-404 defect row 20 fixed; it runs in the CI pass that the accessibility step had been skipping, so the assertion outlived the bug it described by four releases. And `withNavigationErrorHandler` read `sessionStorage` unconditionally, so **any** navigation failure during SSR threw `ReferenceError: sessionStorage is not defined` *from inside the handler for that failure* — turning something the renderer could report into something it could not. Found in this repo's own SSR log, not by reading the code. Both fixed | ✅ **Fixed** | `e2e/locale-and-seo.spec.ts`, `app.config.ts` |

## 🟢 Minor — nice to fix

| # | Item | Status | Where |
|---|---|---|---|
| 10 | ~~Missing `track` in `@for` loops~~ | ✅ **Already fixed** | Verified by grep — every `@for` in the repo has `track`, zero exceptions |
| 11 | ~~No error boundary on lazy-loaded routes~~ | ✅ **Fixed in v0.9.3, guarded for SSR in v1.75.2** | `withNavigationErrorHandler` added to `app.config.ts` — a failed chunk load now triggers one hard reload of the attempted URL (resolves the common stale-deploy case) with a `sessionStorage` guard against looping if the underlying route is persistently broken, not just a stale chunk. That recovery is browser-only and the handler did not say so: it ran during SSR too, where `sessionStorage` and `window` do not exist, so a server-side navigation failure threw a `ReferenceError` out of the handler meant to contain it. See row 27. |

---

## Legal — compliance placeholders (not optional, separate from the audit)

| Item | Where | Action needed |
|---|---|---|
| ~~`[YOUR COMPANY NAME]`, CIPC registration number~~ | `Footer`, `PrivacyPolicy`, `Paia` | ✅ **Filled in v1.59.0** — Umastande (Pty) Ltd, CIPC Reg. No. 2026/757331/07. Rendered as registered but in conventional mixed case rather than the register's all-caps |
| ~~Information Regulator registration number~~ | `Paia` | ✅ **Filled in v1.62.0** — 2026-067370 |
| ~~Registered address, Information Officer name~~ | `Paia`, `PrivacyPolicy` | ✅ **Filled in v1.64.0** — Thebeyapelo Modise, Chief Executive Officer, at 16 Mokgatle Street, Kwa Thema, Springs, Gauteng, 1575. Kwa Thema falls under Springs; a CIPC amendment adding Springs to the register takes effect 29/09/2026, and the pages already state the address as it actually is. POPIA s.56 makes the Information Officer the head of the private body, so the designation is recorded alongside the name. `verify-build.sh` now fails on any `[PLACEHOLDER]` left in a prerendered page — these rendered to real visitors for most of this project's life and nothing looked, because a placeholder is valid HTML |
| **PAIA manual must be filed with the SAHRC** | — | Form 2, paia@sahrc.org.za, no fee — this is a legal filing obligation, not a code task |
| ~~Information Regulator registration number~~ | `Paia` component | ✅ **Done** — registered, number 2026-067370 is on the PAIA page |

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
| ImageKit | `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT` | ✅ **Configured and verified 26 Aug 2026** — uploads confirmed working end to end. `IMAGEKIT_URL_ENDPOINT` must match `imagekitUrl` in the frontend environment files exactly, or every image 404s |
| Resend | `RESEND_API_KEY` | ❌ **Not set.** The API boots and logs `[email skipped]` instead of sending, so nothing breaks — but a landlord is never told an application arrived, which breaks the core loop in practice. Highest-value remaining credential |
| WhatsApp Business API | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | Optional — email notifications never depend on this. `WHATSAPP_APP_SECRET` is the Meta App Secret that signs inbound deliveries; without it the webhook refuses every one, so the listing bot is off rather than open |
| Stripe | see table above | Required for pass 0.8.0's payment flows |
| Vercel (frontend) | none | Vercel's Git integration deploys from the repo. `deploy-frontend.yml` was removed — it needed tokens nobody set and never deployed anything. |
| Render (backend) | none | Render deploys `develop` from `render.yaml` on push, no GitHub secret needed. Railway was dropped. |

## i18n — translation status (from §19, repeated here so it's not missed)

English is authoritative. Afrikaans and isiZulu are real attempts flagged for native-speaker review. **isiXhosa, Sesotho, Setswana, Sepedi, Xitsonga, siSwati, Tshivenda, and isiNdebele are English-fallback stubs** — the app runs correctly, but the language switcher cannot honestly claim to support those 8 until real translation happens.

---

## Temporarily disabled (by request, not a fix)

**Billing (Stripe + Renter's Passport) is paused.** Every landlord is on an unlimited free tier: unlimited listings, up to 20 photos/room, one-click relist. This is a deliberate, reversible flag flip, not a rollback of the v0.8.0 work — nothing was deleted.

| What | How it's disabled | To re-enable |
|---|---|---|
| Stripe module (checkout, webhooks, boosts, passport) | `StripeModule` import + registration commented out in `backend/src/app.module.ts` | Uncomment both lines |
| Room-count cap | `enforcePlanLimit()` commented out in `RoomsService`, call sites removed | Uncomment the method + both call sites (in `create()` and `relist()`) |
| Upgrade / Boost / Passport UI | Gated behind `BILLING_ENABLED` in `frontend/src/app/core/config/feature-flags.ts` | Flip `BILLING_ENABLED` to `true` |
| Upgrade / Passport routes | `billingEnabledGuard` redirects away while the flag is off | Same flag flip — the guard checks it directly |

**Two real bugs found and fixed while doing this work, unrelated to the disable itself:**
1. `UpdateRoomDto` never declared `heroImagePath`/`imagePaths` as valid fields, despite the create-room wizard sending exactly those on the photo-save step. With `forbidNonWhitelisted: true` globally, this meant **every photo save via the wizard should have been rejected with a 400** since pass 0.6.0. Fixed by properly declaring both fields with validation (`@ArrayMaxSize(19)` for the gallery, enforcing the new 20-photo cap at the same time).
2. **One-click relist had no UI at all** — the backend endpoint and the Angular service method both existed since pass 0.3.0/0.4.0, but nothing on any dashboard ever called `relistRoom()`. Built the missing UI: `LandlordDashboard` now shows let (archived) rooms with a working Relist button.

The 20-photo cap is enforced in three independent places: `PhotoUpload` (client, stops accepting uploads at the limit), `CreateRoomDto`/`UpdateRoomDto` (`@ArrayMaxSize`, rejects with a clean validation error), and `RoomsService.assertPhotoLimit()` (defense in depth, technically redundant given the DTO check but kept deliberately).

---

## Suggested order of work for pass 1.0.0 (all done — kept for history)
1. ~~Input sanitisation (#3)~~ ✅ Done — v0.9.1
2. ~~Auth hardening (#1, #2)~~ ✅ Done — v0.9.2
3. ~~Error boundary on lazy routes (#11)~~ ✅ Done — v0.9.3
4. ~~Mobile responsive pass on the three dashboard-style pages (#9)~~ ⚠️ Superseded — the v0.9.3 approach broke responsiveness; re-done properly in v1.3.2–v1.4.3
5. ~~README rebase note (#6)~~ ✅ Not applicable — already present, verified against the file rather than assumed
6. Everything remaining is either a manual step outside the codebase (branch protection, SAHRC filing, Stripe Dashboard config) or explicit future work (KYC integration, remaining 8 translations) — not blocked on code changes. **Every code-fixable item on this checklist is now closed.**

---

## Verification scripts

Two scripts exist so readiness can be re-checked rather than assumed. Run both
after any dependency change, schema migration, or deploy.

```bash
./scripts/smoke-test.sh      # 64 API checks against a running backend
./scripts/test-imagekit.sh   # ImageKit credentials and signed upload
```

`smoke-test.sh` creates real rows using timestamped test emails, so it is safe
to run repeatedly against a dev database. Never run it against production.

## Outstanding product gaps (not bugs)

| Gap | Notes |
|---|---|
| ~~"How it works" and Pricing pages~~ | ✅ **Built.** Both are routed in `pages.routes.ts`, carry SEO metadata, and prerender — verified in the build output. This row said "no routes exist"; that has not been true for some time |
| "Back to all rooms" | Returns to the board but loses scroll position and filters |
| Saved rooms persistence | Device-local (localStorage), correctly scoped per user since v1.4.2. A join table plus two routes would make it follow the account across devices |
| ~~Renter's Passport~~ | ✅ **Built in v1.56.0 and free.** Identity plus any one income proof earns the badge, which a landlord sees on every application with the checks behind it one tap away. Free is the product decision, not a gap: "free to apply, always" is the position against the incumbents, and charging the side of this market with the least money to prove they can afford a room would be the fastest way to lose it. The R89/month subscription page it replaces has been deleted |
| ~~Tenant alerts~~ | ✅ **Built end to end.** `SavedSearch` model, CRUD endpoints, and matching that fires on publish and relist as a single database query rather than in memory. The `daily` digest **does** exist — `AlertsDigest` in `modules/alerts/alerts.digest.ts`, `@Cron('0 7 * * *')` at Africa/Johannesburg, registered in `AlertsModule` with `ScheduleModule.forRoot()` in `AppModule`. The tenant dashboard has the Room alerts section: list, empty state, per-search description and pause toggle. This row previously said the digest did not exist and those tenants received nothing — that was wrong, and it is the kind of error that makes the project look less finished than it is |
| ~~Tenant alerts for new listings~~ | ~~**Not built.**~~ No saved searches, no digest, no push. A tenant must return to the board and re-run their filters. This is the single biggest retention gap: most rooms are let within days, so a tenant who checks weekly misses everything. Needs a SavedSearch model, a scheduled matcher, and email/WhatsApp delivery |
| ~~Landlord verification~~ | ✅ **Built end to end.** `VerificationRequest` model with an admin review queue. Approving an identity check is the only thing that sets `LandlordProfile.idVerified`, so the badge means something. Documents upload privately (`isPrivateFile`) and are **deleted on decision** — only the outcome is kept, per POPIA s.26. Both UIs exist: `features/landlord/verification/landlord-verification.ts`, routed at `/landlord/verification`, and `features/admin/verifications/admin-verifications.ts`. This row said neither was built |
| ~~Landlord verification~~ | ~~**Not built.**~~ `LandlordProfile.idVerified` exists as a boolean and is shown on room cards, but nothing sets it — there is no document upload, no KYC provider, no admin review queue. The disclaimer already tells tenants listings are unverified, which is honest, but the flag implies a check that does not happen |
| ~~Post-tenancy disputes~~ | ✅ **Built in v1.56.0.** Either party can report a problem once a tenancy has ended. An open report reduces the account's visibility — a flagged landlord's rooms rank last — and does not hide listings, close applications or suspend anyone, because a flag is an untested allegation until an admin reads it. Admin endpoints exist; a dedicated admin review screen is the one piece still outstanding, and the queue is readable at `GET /tenancies/flags/open` until it is built |
| ~~Multi-room properties~~ | ✅ **Built in v1.57.0.** A six-room yard was six unrelated listings. `/landlord/yard` groups them, rolls vacancy and waiting applicants up per property, and carries manual rent tracking. Grouping is optional and deleting a yard never deletes its rooms |
| ~~WhatsApp-first listing creation~~ | ✅ **Built in v1.58.0.** A verified landlord sends photos and a sentence to the Mastande number and a draft is waiting on their dashboard. Nothing sent over WhatsApp goes live: the draft becomes a Room in `draft` status only when the landlord claims it on the web, and it still has to pass the ordinary publish rules. Matched on `phoneVerified`, never on `User.phone` alone. The parser is regex and the Place taxonomy, not an LLM — a third-party model would mean personal information leaving the country under POPIA s.72 and would work worst in the languages that need it most. See README §24 |
| ~~Verification fee tied to the new checks~~ | ✅ **Done in v1.59.0.** The R149 is a landlord identity check and nothing else — no listing fee, no application fee, and every tenant proof free, all asserted in the smoke suite rather than trusted. The fee now appears on the verification's own audit trail, and rejecting a paid check sets a refund obligation automatically with a queue on the admin dashboard: the pricing page has promised "refunded in full" since launch and nothing in the code kept it. Boosts and subscriptions remain paused and board advertising is unchanged. Gaps M1–M3 in `docs/FLOW-AUDIT.md` |
| ~~Rent tracking — tenant side~~ | ✅ **Built in v1.71.0.** `/tenant/rent` shows what the landlord recorded and lets the tenant answer it, which is what the overdue reminder has been telling them to do with nowhere to do it. The answer sits beside the landlord's record and stops further reminders for that month. Gap Y3 closed |
| **The portal sidebar was hidden on mobile with nothing replacing it** | ✅ **Fixed in v1.71.0.** `.portal-nav` was `display: none` below 768px and the top hamburger carries only public links plus a Dashboard button — so on a phone every portal screen except the dashboard was unreachable: Rent, the Renter's Passport, My property, Verification, Settings. On a product built for people on cheap phones that is most of the app. Now a horizontal scrolling strip with 44px targets |
| Students-welcome filter | **Removed from the UI.** There is no students flag on the Room model or the filters DTO, so the checkbox could never narrow anything — and it was counted in `activeFilterCount()`, so ticking it told people a filter was active while the board stayed identical. Offering a control that does nothing is worse than not offering it, the same call already made for untranslated locales and the paused pricing links. To build it: a boolean on `Room`, the landlord wizard, the filters DTO, the query, then the checkbox back with a translated label |

## Migration required (v1.6.0)

The Application model gained `cycle` and `archivedAt`, and its unique
constraint changed from `[roomId, tenantId]` to `[roomId, tenantId, cycle]`.
Run before starting the API:

```bash
cd backend
npx prisma migrate dev --name application_letting_cycles
npx prisma generate
```

Existing applications default to `cycle = 0` and `archivedAt = null`, which
matches rooms that have never been relisted. Rooms with `relistCount > 0`
before this migration will show their historical applicants as belonging to
cycle 0 while the room is on a later cycle — those applicants simply drop off
the current list, which is the intended behaviour.
