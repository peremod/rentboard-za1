# Contributing to Mastande ZA

Git/GitHub workflow for the Angular 21 + NestJS 11 monorepo. Applies to `frontend/` and `backend/`.

## 1. Branch naming

| Prefix | Use for | Merges into |
|---|---|---|
| `feat/*` | New features | `develop` |
| `fix/*` | Bug fixes | `develop` |
| `hotfix/*` | Urgent production fixes | `main` + `develop` |
| `chore/*` | Deps, config, tooling | `develop` |
| `docs/*` | Documentation only | `develop` |
| `ci/*` | Pipeline changes | `develop` |
| `release/*` | Release candidate | `main` |

```bash
git checkout develop
git pull origin develop
git checkout -b feat/room-relist-analytics
```

## 2. Commit messages (Conventional Commits, enforced by Husky)

```
<type>(<scope>): <short description>
```

**Types:** `feat fix docs style refactor perf test chore ci revert`

**Scopes** — domain:
`rooms auth login users tenant landlord messages payments billing screening passport account admin board home ads ui i18n seo`

**Scopes** — platform and tooling:
`api backend frontend ssr router routes cdn db env build deploy e2e ci deps release render vercel docker prisma`

A subject may open with a proper noun (`docs(deploy): Neon setup`) — only
PascalCase and SHOUTING are rejected.

```bash
git commit -m "feat(rooms): add one-click relist"
git commit -m "fix(auth): handle expired JWT gracefully"
git commit -m "perf(seo): add prerender config for legal routes"
```

Husky's `commit-msg` hook + commitlint reject anything that doesn't match.

## 3. Before opening a PR (required)

Rebase — never merge `develop` into your branch.

```bash
git checkout feat/your-feature
git fetch origin
git rebase origin/develop

# on conflict:
#   fix file → git add . → git rebase --continue

git push origin feat/your-feature --force-with-lease
```

`--force-with-lease` fails safely if someone else pushed to the branch since your last fetch.

## 4. Merge strategy

| Branch | Target | Method |
|---|---|---|
| `feat/*`, `fix/*`, `chore/*` | `develop` | **Squash merge** (GitHub "Squash and merge") |
| `release/*` | `main` | `git merge --no-ff` |
| `hotfix/*` | `main` | `git merge --no-ff`, then cherry-pick to `develop` |

```bash
# Hotfix flow
git checkout -b hotfix/jwt-expiry main
# ...fix...
git commit -m "fix(auth): reduce JWT expiry to 24h"
git checkout main && git merge --no-ff hotfix/jwt-expiry
git tag -a v1.0.1 -m "Hotfix: JWT expiry"
git push origin main --tags
git checkout develop && git cherry-pick <hotfix-commit-sha>
git push origin develop
```

## 5. Release & tagging

Semantic versioning: `MAJOR.MINOR.PATCH`.

```bash
git checkout -b release/v1.1.0 develop
# bump version in frontend/package.json and backend/package.json
git commit -m "chore(release): bump version to 1.1.0"

git checkout main
git merge --no-ff release/v1.1.0
git tag -a v1.1.0 -m "Mastande ZA v1.1.0 — room detail + apply flow"
git push origin main --tags

git checkout develop
git merge --no-ff release/v1.1.0
git push origin develop
git branch -d release/v1.1.0
```

Tag naming: `vMAJOR.MINOR.PATCH` (e.g. `v1.2.0`). Draft GitHub Release notes from the CHANGELOG section for that version.

## 6. Branch protection (set once in GitHub → Settings → Branches)

- `main`: require PR, require CI pass (`frontend`, `backend`, `commitlint` jobs), require 1 approval, no force-push.
- `develop`: require CI pass, no force-push.

## 7. Pre-PR checklist

```bash
cd frontend && npm run lint && npm run format:check && npm test -- --run && npm run build:prod
cd backend  && npm run lint && npm test && npm run build
```

CI (`.github/workflows/ci.yml`) re-runs all of this — fix locally first to avoid a slow feedback loop.

## 8. Environment branches → deploy targets

| Git ref | Environment | Frontend | Backend |
|---|---|---|---|
| any branch | Preview | Vercel preview URL (auto per-PR) | — |
| `develop` | Staging | `rentboard-za1.vercel.app` (Vercel) | Render `mastande-api`, via `render.yaml` |
| `master` | Production | `umastande.co.za` (Vercel) | Render `rentboard-api`, via `render.yaml` |

⚠️ **This table said `main`, and there is no `main` branch.** It also said
production had no backend deploy path. Both were true once and neither had been
true for a while — `render.yaml` has defined `rentboard-api` on `branch: master`
since the fix recorded at its own line ("Was `develop`, which is the bug"), and
Vercel's production deployment is served from `master` too, confirmed in the
project's own dashboard on 17 November 2026. A deploy table that names a branch
nobody pushes is worse than no table: it reads as confirmation.

`scripts/migrate-targets.json` is the machine-readable version of the same
mapping, and `verify-deployment.yml` carries the third copy. If you change one,
change all three.

Neither half deploys from GitHub Actions. Railway was dropped and Render deploys
on push straight from the repo; Vercel's Git integration does the frontend the
same way, so `deploy-frontend.yml` was removed too — it needed tokens nobody had
set and had never deployed anything. `verify-deployment.yml` asserts afterwards
that each environment came up configured as itself, which is why both
`STAGING_API_HOST` and `PRODUCTION_API_HOST` must be set; there is no equivalent
signal for the frontend.

**Both** Render services are on the free tier, production included, and the free
tier sleeps after ~15 minutes idle — which is what `scripts/keep-warm-budget.mjs`
and the keep-warm schedule exist to manage. The free tier also rejects
`preDeployCommand`, so **production migrations are run by hand BEFORE the push**,
with `scripts/migrate-remote.sh --env production`, never `npx prisma migrate
deploy`. See `docs/RUNBOOK.md` → Production, and `docs/OUTSTANDING.md` §5a for
the hour production spent down over exactly that distinction.

Staging and production use separate `.env` files and separate **Neon** projects —
never point staging at the production database. ⚠️ Several documents still say
"Supabase" here; the database has been Neon since the migration, and
`scripts/migrate-targets.json` is the one that governs.
