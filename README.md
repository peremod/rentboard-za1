# RentBoard ZA

South Africa's dedicated room-letting notice board. Landlords list free, tenants apply free — no estate agent, no fees, fully POPIA-compliant, all prices in ZAR.

**Stack:** Angular 21 (zoneless, SSR, signals) · NestJS 11 · Prisma 6 + PostgreSQL (Supabase) · ImageKit · Stripe · Resend · WhatsApp Business API.

This is the **v0.1.0 foundation release** — repo scaffold, auth-free bootstrap, CI/CD, and the health/DB plumbing everything else is built on. It mirrors "Part 1" of the project's build docs. See **Roadmap** below for what ships next and where the reference code for each part already lives in the project's planning artifacts.

---

## 1. Prerequisites

```bash
node --version   # must be 22.x
npm --version    # must be 11.x
git --version
docker --version # for local Postgres via docker-compose
```

If you need to install/switch Node:
```bash
nvm install 22 && nvm use 22
```

## 2. Clone & install

```bash
git clone https://github.com/YOUR_ORG/rentboard-za.git
cd rentboard-za
npm run install:all        # root (husky) + frontend + backend
```

## 3. Local database

```bash
docker compose up -d postgres
cp backend/.env.example backend/.env
# edit backend/.env — for local dev, DATABASE_URL and DIRECT_URL can both point at:
# postgresql://rentboard:rentboard_dev@localhost:5432/rentboard_dev

cd backend
npm run db:generate
npm run db:push          # or: npm run db:migrate -- --name init
npm run db:studio        # optional — visual DB browser at http://localhost:5555
```

## 4. Run locally

```bash
# Terminal 1 — API
cd backend && npm run start:dev
# → http://localhost:3000/health
# → http://localhost:3000/api/docs (Swagger, dev only)

# Terminal 2 — Frontend
cd frontend && npm start
# → http://localhost:4200
```

## 5. Environments

RentBoard runs identically across three environments via Angular file-replacement configs and NestJS `NODE_ENV`/`.env` files. **Never** point `staging` or `production` at the same Supabase project as `development`.

| Env | Frontend command | Frontend env file | Backend `NODE_ENV` | Deploys to |
|---|---|---|---|---|
| Development | `ng serve` | `environment.ts` | `development` | localhost |
| Staging | `ng build --configuration staging` | `environment.staging.ts` | `staging` | `staging.rentboard.co.za` (Vercel preview/staging) + Railway `staging` |
| Production | `ng build --configuration production` | `environment.prod.ts` | `production` | `rentboard.co.za` (Vercel) + Railway `production` |

```bash
# Staging build
cd frontend && npm run build:staging

# Production build
cd frontend && npm run build:prod
cd backend  && npm run build && npm run start:prod
```

Backend environment selection is via the `.env` file present in the deploy target (Railway env vars) — `configuration.ts` is the single read point, see `backend/src/config/configuration.ts`.

## 6. Docker (backend)

```bash
cd backend
docker build -t rentboard-api .
docker run -p 3000:3000 --env-file .env rentboard-api
```

## 7. Git workflow, commits, releases

Full policy in [`CONTRIBUTING.md`](./CONTRIBUTING.md) — branch naming, Conventional Commits (enforced by Husky/commitlint), rebase-before-PR, squash-merge to `develop`, `--no-ff` to `main`, semver tags.

```bash
git checkout develop
git pull origin develop
git checkout -b feat/rooms-notice-board

git add .
git commit -m "feat(rooms): add public room listing endpoint"   # husky validates via commitlint

git fetch origin
git rebase origin/develop
git push origin feat/rooms-notice-board --force-with-lease
# open PR: feat/rooms-notice-board → develop
```

Tagging a release:
```bash
git checkout -b release/v0.2.0 develop
# bump version in frontend/package.json and backend/package.json
git commit -m "chore(release): bump version to 0.2.0"
git checkout main && git merge --no-ff release/v0.2.0
git tag -a v0.2.0 -m "RentBoard ZA v0.2.0 — notice board + filters"
git push origin main --tags
git checkout develop && git merge --no-ff release/v0.2.0 && git push origin develop
```

This repo's first commit is tagged **`v0.1.0`**.

## 8. Lighthouse / Core Web Vitals & SEO

Target ≥95 (mobile) on Performance, Accessibility, Best Practices, SEO before each release. Full checklist: [`SEO-LIGHTHOUSE-CHECKLIST.md`](./SEO-LIGHTHOUSE-CHECKLIST.md) (already in the project docs — copy it into `docs/` here once the notice-board UI lands). Foundation-release choices already in place to support this:

- **Zoneless change detection** (`provideExperimentalZonelessChangeDetection`) — no Zone.js payload, faster TTI.
- **SSR + prerender** on static routes (`serverRoutes` in `app.routes.ts`, `RenderMode.Prerender`) — fast LCP, crawlable HTML, no client-JS dependency for indexing.
- **Route `title`** set per-route for unique `<title>` tags (SEO checklist §5).
- **Bundle budget enforced in CI** — build fails over 500KB gzip main bundle (see `.github/workflows/ci.yml`).
- **Helmet CSP + compression** on the API — Best Practices score, smaller payloads.
- Next pass adds: `NgOptimizedImage` on the room card (LCP + CLS), dynamic `sitemap.xml`/`robots.txt` controller, per-room JSON-LD + Open Graph meta — reference implementations already exist in the project's `RentBoard-Fresh-Part5-UI-CICD.html` and `SEO-LIGHTHOUSE-CHECKLIST.md` artifacts and just need porting into this repo.

## 9. User-flow / link integrity

Before every release, run the manual pass in `SEO-LIGHTHOUSE-CHECKLIST.md` §6 (navbar links, room card → detail, Mark as Let → board update, Relist → same slug, footer legal links, `returnUrl` post-login redirect, wildcard 404). Automate with:
```bash
npx broken-link-checker https://staging.rentboard.co.za -ro
```
Route slugs are UUIDs (`/rooms/:id`) and are never regenerated on edit — see `schema.prisma` `Room.id`. This is deliberate: it keeps every shared link and SEO backlink stable across relists.

## 10. Roadmap — build order for subsequent passes

Each pass below has a full reference implementation already written in the project's planning artifacts; this repo scaffold is the target to port that code into (updating for Angular 21 signal APIs and the ZAR/POPIA specifics, not the UK/GBP originals). Work through them as `feat/*` branches per §7.

| Pass | Adds | Reference artifact |
|---|---|---|
| 0.1.0 ✅ | Repo scaffold, health check, Prisma foundation, CI, Docker | *v0.1.0 commit* |
| 0.2.0 ✅ | Auth (JWT + Google OAuth), guards, interceptors, working login/register/callback + guarded dashboards | `RentBoard-Fresh-Part3-Auth-Guards-Services.html` — *v0.2.0 commit* |
| 0.3.0 ✅ | Legal pages (POPIA/PAIA), cookie consent, Rooms API (backend) + RoomsService (frontend), SCSS legal styles, ZarCentsPipe | `RentBoard-Fresh-Part4-Legal-API-Styles.html`, `RentBoard-ZA-*` legal artifacts — *v0.3.0 commit* |
| 0.4.0 | Navbar/footer, home notice board, room card, CI/CD deploy workflows | `RentBoard-Fresh-Part5-UI-CICD.html` |
| 0.5.0 | Rooms service full lifecycle, WhatsApp bridge, email templates | `RentBoard-Fresh-Part6-Services-README.html` |
| 0.6.0 | Create-room wizard, photo upload, filters, room detail + apply | `RentBoard-Sprint2-Code.html` |
| 0.7.0 | Tenant/landlord dashboards, applicant manager, messaging | `RentBoard-Sprint3-Code.html` |
| 0.8.0 | Stripe subscriptions/boosts, Renter's Passport, screening | `RentBoard-Sprint4-Code.html` |
| 0.9.0 | 11-language i18n, capacity hardening (PgBouncer, cache headers, graceful shutdown) | `RentBoard-ZA-i18n-Languages-1.html`, `RentBoard-ZA-Capacity-Analysis.html` |
| 1.0.0 | Audit fixes applied, SAHRC/Information Regulator filings done, launch | `RentBoard-ZA-All-Fixes.html`, `RentBoard-ZA-MVP-Summary.html` |

Operational cadence (on-call, weekly/monthly checks, incident escalation) is documented in `OPERATIONS.md`.

## 11. Project structure

```
rentboard-za/
├── frontend/            Angular 21 — SSR, zoneless, signals
│   └── src/app/
│       ├── core/        AuthService (signals), guards, interceptors, User model
│       ├── shared/      reusable components (error-page)
│       └── features/    home, auth (login/register/callback), tenant + landlord dashboards
├── backend/              NestJS 11 — REST API
│   └── src/
│       ├── config/       typed env access (configuration.ts)
│       ├── prisma/       PrismaService/Module
│       ├── common/       guards (JWT/roles/admin/landlord), decorators
│       └── modules/      health, auth (JWT + Google OAuth)
├── .github/workflows/    CI
├── docker-compose.yml    local Postgres
└── CONTRIBUTING.md       git workflow, commit rules, release process
```

## 12. Testing the auth flow locally

```bash
# Generate a real JWT secret and put it in backend/.env
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Google OAuth is optional for local dev — email/password works without it.
# To test Google sign-in, create OAuth credentials in Google Cloud Console and
# set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL in backend/.env.
```

Manual flow check (mirrors `SEO-LIGHTHOUSE-CHECKLIST.md` §6, applied to auth):
- [ ] `/` → "Log in" and "…get started free" links resolve
- [ ] Register as tenant → lands on `/tenant/dashboard`
- [ ] Register as landlord → lands on `/landlord/dashboard`
- [ ] Visiting `/landlord/dashboard` as a tenant → redirected to `/tenant/dashboard`, not a 403
- [ ] Visiting `/tenant/dashboard` unauthenticated → redirected to `/auth/login?returnUrl=/tenant/dashboard`, and lands back on `/tenant/dashboard` after login
- [ ] Log out → returns to `/`, protected routes now redirect to login again

## 13. Legal & Rooms API (v0.3.0) — what to check, what's still a placeholder

- All five legal pages (`/legal/privacy`, `/legal/terms`, `/legal/disclaimer`, `/legal/cookies`, `/legal/paia`) resolve from the Home footer links and are prerendered (`serverRoutes: 'legal/**'`) — verify with `curl -s http://localhost:4200/legal/paia | grep "PAIA Manual"` after a prod build.
- **`[PLACEHOLDER]` values in the legal pages are not optional** — company name, CIPC number, registered address, Information Officer name must be filled in, and the PAIA manual **must be filed with the SAHRC** (paia@sahrc.org.za, Form 2, no fee), before this repo can go to production. Tracked in the roadmap's 1.0.0 row.
- Rooms API is testable via Swagger (`/api/docs`) once you have a landlord JWT: register a `LANDLORD` account, `POST /api/rooms`, then `POST /api/rooms/:id/publish` (requires `heroImagePath` + a 50+ char `description` — upload flow itself lands in pass 0.6.0, so publish will 400 until then; `POST`/`PATCH`/draft lifecycle all work today).
- `ZarCentsPipe` (`shared/pipes/zar-cents.pipe.ts`) is the only sanctioned way to render `rentCents`/`depositCents` — never hand-divide by 100 in a template (this is exactly the class of bug the project's Audit Report flagged under "ZarCentsPipe not imported").
