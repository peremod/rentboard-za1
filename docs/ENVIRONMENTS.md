# Environments & CI

Three environments, what differs between them, and what the pipeline checks
before anything reaches them.

---

## 1. The matrix

| | Development | Staging | Production |
|---|---|---|---|
| Branch | any feature branch | `develop` | `master` (and `main`) |
| Frontend | `localhost:4200` | `staging.rentboard.co.za` | `rentboard.co.za` |
| Backend | `localhost:3000` | `api-staging.rentboard.co.za` | `api.rentboard.co.za` |
| Build | `ng build --configuration development` | `npm run build:staging` | `npm run build:prod` |
| Env file | `environment.ts` | `environment.staging.ts` | `environment.prod.ts` |
| `APP_ENV` | `development` | `staging` | `production` |
| `NODE_ENV` | `development` | **`production`** | `production` |
| `production` (frontend) | `false` | `false` | `true` |
| `indexable` | `false` | `false` | `true` |
| Optimisation | off, sourcemaps on | on | on |
| Search engines | blocked | blocked ×3 | allowed |
| Payments | PayFast sandbox | PayFast sandbox | live |
| Database | local Postgres | Neon / Render branch | Supabase |

Staging is blocked from indexing three independent ways — meta tag,
`robots.txt`, and the `X-Robots-Tag` header in `vercel.json`. A byte-identical
copy of the site under a second indexable domain would compete with production
for production's own keywords, so this is over-engineered on purpose.

---

## 2. The rule that keeps them honest

Each environment file is compiled in isolation, because Angular swaps them at
build time via `fileReplacements`. TypeScript therefore **never compares
them**: a key present in `environment.prod.ts` and missing from
`environment.staging.ts` produces no error anywhere. It produces `undefined` at
runtime, on staging only, usually in the least-exercised code path.

`scripts/env-parity.mjs` is what catches it. It asserts:

1. All three files export the same key set.
2. `production` and `indexable` hold the right value per environment.
3. No two environments share an `apiUrl` or `siteUrl` — pointing staging at the
   production database is a copy-paste slip, not a hypothetical.
4. Every `process.env` / `config.get()` key the backend reads is documented in
   `backend/.env.example`.

Check 4 found `ADMIN_ALERT_EMAIL` on its first run: read by
`config/configuration.ts`, set in `render.yaml`, and absent from
`.env.example` — so anyone provisioning a new environment from that file alone
would have had operational alerts silently disabled.

```bash
npm run audit          # routes + i18n + env, all three
npm run audit:env
```

---

## 3. NODE_ENV is not APP_ENV

The single most important distinction in this document.

**`NODE_ENV` is a build concern.** Nest, Express and most libraries want it set to `production` on staging too, for performance and to suppress verbose error output. `render.yaml` sets exactly that on the `develop` branch, and it is correct to.

**`APP_ENV` is a deployment concern.** Which of the three environments is this actually? Everything that must differ between staging and production keys off this: search indexability, CORS origins, payment sandbox mode.

Gating deployment behaviour on `NODE_ENV` had two real consequences on the Render staging box, both invisible in every config file:

1. **It was fully crawlable.** `robots.txt` allowed everything and the sitemap advertised production URLs, so staging competed with production for production's own keywords.
2. **Its CORS list was production-only.** The staging frontend could not talk to the staging API at all.

`scripts/env-parity.mjs` now fails the build if any deployment behaviour is gated on `NODE_ENV`. Reading it to *log* it is fine — the bootstrap line prints both side by side, which is the fastest way to confirm the distinction is working.

```
[Environment] Environment OK — APP_ENV=staging, SITE_URL=https://staging.rentboard.co.za, indexable=false
[Bootstrap]   RentBoard API on port 3000 — APP_ENV=staging NODE_ENV=production
```

---

## 4. The environment guard

`backend/src/config/environment.ts` runs before `app.listen()` and refuses to start on a misconfigured environment. It catches the quiet failures — the ones that throw nothing and are worse to find later:

| Refuses to start | Why |
| --- | --- |
| `SITE_URL` unset | The old fallback was the production origin, so a misconfigured staging box published production URLs and looked fine in every log. There is now no fallback. |
| `SITE_URL` has a trailing slash | Canonical URLs are built by concatenation |
| Non-production `SITE_URL` pointing at the production domain | Duplicate-site signal to search engines |
| `PAYFAST_SANDBOX=true` in production | Real payments would go to the sandbox |
| Missing `IMAGEKIT_PRIVATE_KEY`, `RESEND_API_KEY` or `ADMIN_ALERT_EMAIL` in production | Silent feature loss |

It warns, rather than refusing, when `APP_ENV` is unset (defaults to `development`, the safe direction) or when a non-production environment is not using the payment sandbox.

The backend deploy workflow asserts the outcome after every deploy: production `robots.txt` must allow crawling and advertise the right sitemap; staging must return `Disallow: /`. A staging deploy that becomes crawlable now fails the pipeline instead of quietly ranking.

---

## 5. Required per-environment variables

Beyond `backend/.env.example`, these **must** differ per target or something
breaks quietly:

| Variable | Why it must differ |
|---|---|
| `APP_ENV` | `development` / `staging` / `production`. Gates indexability, CORS and payment mode. |
| `SITE_URL` | Builds `sitemap.xml` and `robots.txt`. Required — the API will not start without it. |
| `NODE_ENV` | Build concern only. `production` on staging too. Never gate behaviour on it. |
| `DATABASE_URL` | Obvious, and the most expensive to get wrong. |
| `PAYFAST_SANDBOX` | `true` everywhere except production. |
| `FRONTEND_URL` | CORS origin and email link targets. |

---

## 6. Pipeline

### `ci.yml` — every push and PR

**This workflow had never run.** It triggered on `main` and `develop`; the
repository only has `master`. All 148 tags to date were cut without a single
CI check. `master` is now included, with `main`/`develop` retained so the
branch rename in `CONTRIBUTING.md` §8 can happen without a gap.

| Step | Catches |
|---|---|
| Route & guard audit | Unreachable route, unguarded private area, `routerLink` to nowhere, `/admin` endpoint without `AdminGuard` |
| i18n & locale audit | Malformed bundle, placeholder dropped in translation, frontend/backend locale lists drifting |
| Lint | Style and common errors |
| Typecheck | Type errors in code only staging or development reaches |
| Test | Unit regressions |
| Build ×3 | A broken staging environment file, which is otherwise invisible until a staging deploy fails |
| Environment parity | The whole of §2 above |
| Prerender sanity | A page that silently stopped prerendering; canonical/hreflang/robots missing from served HTML |
| Bundle budget | Main bundle over 500KB gzipped |
| Commitlint | Non-conventional commit messages |

The prerender step is the one worth understanding. It asserts that
`canonical`, `hreflang` and `robots` appear in the **served HTML file on
disk** — not in the rendered page. Metadata applied after hydration is
invisible to a crawler that runs no JavaScript, and that failure looks
identical to success in a browser.

### `lighthouse.yml` — frontend PRs, plus weekly

Split from `ci.yml` on purpose: a Lighthouse run takes minutes and is mildly
non-deterministic, so a flaky run should block a merge visibly rather than make
the whole CI job look broken.

Budgets in `lighthouserc.json`, mobile with simulated slow 4G — desktop scores
flatter and would hide the regressions that matter to people on phones.
Core Web Vitals are asserted individually, not just via the rolled-up score,
which can stay green while one vital degrades.

The weekly run also walks every URL in the live `sitemap.xml` and fails if any
returns something other than 200.

### `deploy-frontend.yml`

Push to `master`/`main` → production. Push to `develop` → staging. Deploys the
frontend to Vercel, and needs `VERCEL_TOKEN`, `VERCEL_ORG_ID` and
`VERCEL_PROJECT_ID` set as Actions secrets. **None of them are set, so every
run of this workflow has failed** — `Error: You defined "--token", but it's
missing a value`. Nothing has ever deployed from it.

### Backend deploys — no workflow

There is no backend deploy workflow. Railway was dropped and `deploy-backend.yml`
and `backend/railway.json` were removed with it; Render deploys `develop` on
push straight from the repo via `render.yaml`, without GitHub.

That means GitHub sees nothing for a backend deploy — no job, no status, no
log. `verify-deployment.yml` puts one signal back: after a push to `develop` it
waits for the Render deploy and asserts that staging is healthy and refuses
crawlers.

Production has no backend deploy path at all — `render.yaml` defines only the
free-tier staging service.

---

## 7. Local commands

```bash
# Install everything
npm run install:all

# Run both apps
npm run backend                    # localhost:3000
npm run frontend                   # localhost:4200

# Build each environment exactly as CI does
npm --prefix frontend run build:prod
npm --prefix frontend run build:staging
npx --prefix frontend ng build --configuration development

# Serve the production build with SSR, as Lighthouse sees it
cd frontend && npm run build:prod && node dist/rentboard-frontend/server/server.mjs

# All audits
npm run audit
npm run audit:i18n:strict          # release gate — fails on any untranslated key

# End-to-end
npm run e2e
npx playwright test e2e/locale-and-seo.spec.ts

# Lighthouse against a local production build
npm run lighthouse
```

---

## 8. Release

Per `CONTRIBUTING.md` §8. The order matters: tag only after CI is green on the
merge commit, never before.

```bash
git checkout master && git pull
npm run verify          # full check: audits, all three builds, prerender, metadata, env guard
git tag -a v1.49.0 -m "Technical SEO, locale-scoped URLs, CI repair"
git push origin master --tags
```

Then confirm: production smoke test, `sitemap.xml` returns 200 for every URL,
and `robots.txt` allows crawling on production and forbids it on staging.
