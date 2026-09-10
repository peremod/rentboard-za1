# RentBoard ZA — Changeset v1.49.0 → v1.51.0

Everything produced across this work, in one bundle. **Paths already match your repo**, so extracting over the repo root puts every file where it belongs.

```bash
cd /path/to/rentboard-za
unzip -o /path/to/rentboard-changeset-v1.51.0.zip
# the extracted folder mirrors the repo — move its contents up if needed:
#   cp -r rentboard-changeset-v1.51.0/. .
npm run verify
```

> **On `.ts` files downloading as video:** `.ts` is registered at OS level as MPEG Transport Stream, which wins over TypeScript. The files are plain text and fine. Extracting from this zip bypasses the MIME guess entirely.

---

## Apply and tag

```bash
git checkout -b feat/seo-i18n-ops master
cp -r rentboard-changeset-v1.51.0/. .
npm run verify                      # audits, 3 builds, prerender, metadata, env guard
git add -A
git commit -m "feat: technical SEO, locale URLs, environment guards, company OS"
git tag -a v1.51.0 -m "Technical SEO, locale-scoped URLs, CI repair, environment separation"
git push origin feat/seo-i18n-ops --tags
```

Do not tag before `npm run verify` passes. None of this was built against real Angular dependencies — see "What is unverified" below.

---

## New files (17)

### SEO and metadata
| File | Purpose |
| --- | --- |
| `frontend/src/app/core/services/seo.service.ts` | Canonical, description, Open Graph, Twitter, robots, JSON-LD, hreflang, `<html lang>` |
| `frontend/src/app/core/seo/route-seo.ts` | Applies each route's `data.seo` on every navigation |
| `frontend/src/assets/images/og-default.png` | 1200×630 social card, generated |
| `scripts/generate-og-image.py` | Regenerates the card from the brand palette |

### Locale routing
| File | Purpose |
| --- | --- |
| `frontend/src/app/core/i18n/locale-routing.ts` | `:lang` match guard, per-navigation locale, remembered-locale redirect |
| `frontend/src/app/core/i18n/locale-url-serializer.ts` | Keeps the locale on every internal link — **review this one closely** |
| `frontend/src/app/core/i18n/translation-bundles.ts` | Static import map; makes SSR translation work |

### Performance
| File | Purpose |
| --- | --- |
| `frontend/src/app/core/preloading/public-preload.strategy.ts` | Replaces `PreloadAllModules`, which fetched guarded portal chunks on the homepage |

### Environment separation
| File | Purpose |
| --- | --- |
| `backend/src/config/environment.ts` | `APP_ENV` vs `NODE_ENV`, CORS origins, startup validator |

### Audits and verification
| File | Purpose |
| --- | --- |
| `scripts/i18n-audit.mjs` | Bundle parity, placeholder drift, frontend/backend locale sync |
| `scripts/env-parity.mjs` | Environment parity, undocumented config keys, `NODE_ENV` gating |
| `scripts/verify-build.sh` | Everything that needs real dependencies |
| `e2e/locale-and-seo.spec.ts` | Locale preservation, metadata in served HTML |
| `lighthouserc.json` | CI budgets, mobile, slow 4G |

### GitHub tooling
| File | Purpose |
| --- | --- |
| `.github/workflows/lighthouse.yml` | PR budgets + weekly production audit |
| `.github/workflows/labels.yml` | Syncs the label taxonomy |
| `.github/labels.yml` | 30 labels as code |
| `.github/PULL_REQUEST_TEMPLATE.md` | Conditional checklists |
| `.github/ISSUE_TEMPLATE/` | bug, feature, seo-regression, compliance, config |

### Documentation
| File | Purpose |
| --- | --- |
| `docs/SEO.md` | Metadata layer, structured data, locale URLs, hreflang |
| `docs/ENVIRONMENTS.md` | Environment matrix, `APP_ENV` vs `NODE_ENV`, CI, release |
| `docs/OPERATIONS.md` | Mission, North Star, guardrails, M0–M6, cadence |

---

## Modified files (34)

Frontend: `app.routes.ts`, `app.config.ts`, `index.html`, `tsconfig.json`, `vercel.json`, three environment files, `i18n.service.ts`, `language.model.ts`, `room-detail.ts`, `lang-switcher.ts`, `translate.pipe.ts`, plus route files for pages and legal.

Backend: `main.ts`, `seo.controller.ts`, `.env.example`.

Root: `README.md`, `package.json`, `render.yaml`, all four workflows.

---

## The seven real findings

Each was found by tooling reading the source, not by reading code.

1. **CI had never run.** Workflows triggered on `main`/`develop`; the repo is `master`. All 148 tags cut without a single check.
2. **Zero SEO metadata.** No canonical, Open Graph or JSON-LD anywhere. All 41 routes shipped the homepage title and description — every room page competed with every other for the same query.
3. **Eight of eleven "translations" are English stubs.** Publishing them as locale URLs would have been duplication, not localisation. Only `en`, `af`, `zu` are published; the rest are hidden until real.
4. **`/rooms` was in the sitemap with no route** — a soft 404 submitted to Google by us. `/how-it-works`, `/pricing`, `/advertise` were prerendered but never submitted.
5. **`NODE_ENV` overload.** `render.yaml` correctly sets `NODE_ENV=production` on `develop`. Gating indexability on it would have made staging fully crawlable, and gating CORS on it meant the staging frontend could not reach the staging API.
6. **`deploy-backend.yml` branch mismatch.** `master` was handled in the GitHub `environment:` but not the Railway `--environment` flag — production secrets would deploy to the staging service.
7. **Undocumented required config.** `ADMIN_ALERT_EMAIL` and `JWT_REFRESH_SECRET` were read by code and absent from `.env.example`.

---

## What is unverified

`ng build` never ran. The container had no network and no Angular dependencies.

Checked by hand instead: DI chain traced (`UrlSerializer → I18nService → SeoService → Meta/Title/DOCUMENT`, no cycle), `getPrerenderParams` given explicit typing rather than relying on implicit index-signature compatibility, every changed file syntax-checked.

`npm run verify` covers the rest. Two failure modes are pre-diagnosed in that script:

- **`:lang` prerendering fails** → change the four `:lang/...` entries in `app.routes.ts` to `RenderMode.Server`. Pages stay crawlable and translated, just rendered per request.
- **JSON import errors** → confirm `resolveJsonModule: true` in `frontend/tsconfig.json`.

---

## Still needs you

| Task | Where |
| --- | --- |
| Set `APP_ENV` and `SITE_URL` on Railway production and staging | Railway dashboard |
| Push `.github/labels.yml` to `master` once so labels exist | Triggers the sync workflow |
| Add `LHCI_GITHUB_APP_TOKEN` secret | For Lighthouse PR status checks |
| Translate the eight stub language files | `frontend/src/assets/i18n/` — then flip `translated: true` |

Business planning, KPIs, ad campaigns and the strategy documents are in Notion under **RentBoard ZA — Company OS**, not in this bundle. The split is documented in the "Where Things Live" page there and in `README.md`.
