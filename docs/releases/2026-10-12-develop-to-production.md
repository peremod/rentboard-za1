# Release note — develop → staging → production, 12 October 2026

⚠️ **`docs/RUNBOOK.md` is authoritative, not this file.** This is a dated
snapshot of one release: the branch and commit state as it was on 12 October,
and the three items that were outstanding at the time. It is written down
because that state is what makes the order of the commands below correct, and
because a release with known-outstanding items is worth a record rather than a
chat message.

Do not maintain this file. If a command here disagrees with `RUNBOOK.md`,
`RUNBOOK.md` wins — a second copy of a runbook that drifts is the defect this
repository keeps finding, and this one is deliberately a snapshot so that it
cannot pretend to be current.

State at the time of writing:

| | value |
|---|---|
| `origin/develop` HEAD | `2264b11` (the CI-fix merge) |
| `origin/master` HEAD | `d1cdb20`, 7 October |
| develop ahead of master by | **26 commits** |
| master ahead of develop by | 3 commits — all merge commits, **no unique content**, nothing to port back |
| Branch → environment | `develop` → **staging**, `master` → **production** (`docs/ENVIRONMENTS.md`) |

⚠️ **There is no `main` branch on the remote, only `master`.** `docs/DEPLOYMENT.md`
line 50 says "`main` to production" and `docs/ENVIRONMENTS.md` says "`master`
(and `main`)". Only `master` exists. Use `master`.

⚠️ **Order matters, and it is the same on both environments: schema first, then
code.** Render deploys on push, out of band, and does **not** run migrations.
Code arriving before its columns shows up as a 500 on one endpoint rather than
an unhealthy service, which is why it reads as a bug rather than a missed step.

---

## 0. Get the merged work locally

```bash
git fetch origin --tags
git checkout develop
git pull origin develop
git log --oneline -1          # expect 2264b11
```

---

## 1. Staging

### 1a. Migrate staging FIRST

Two migrations in the repo may not be on staging yet:
`20261005160000_screen_hints` and `20261008095150_tenancy_archive_and_report_scope`.

Both strings come from the Neon dashboard. **The direct one is not optional** —
migrating through the pooled host fails with an advisory-lock error that reads
like a permissions problem and is not one. Pooled is the host *with* `-pooler`
in it; direct is the one *without*.

```bash
export NEON_POOLED="postgresql://…-pooler….neon.tech/…?sslmode=require"
export NEON_DIRECT="postgresql://….neon.tech/…?sslmode=require"

npm run migrate:staging
```

It prints which database it is about to change and asks before doing it. It
**refuses** rather than guesses if the target is missing or local — that refusal
is the whole point of the script, because `npx prisma migrate deploy` with those
variables unset silently migrates your laptop and prints
"No pending migrations to apply."

For a scripted run: `CONFIRM=yes npm run migrate:staging`.

### 1b. Push develop, let Render deploy

`develop` is already pushed — the merge landed there. If Render did not pick it
up, push an empty-handed re-sync:

```bash
git push origin develop
```

### 1c. Check staging came up on the new build

```bash
curl -s https://<staging api host>/health | jq .
```

Expect `"status":"ok"`, `"db":"connected"`, `"env":"staging"`. The `version`
field is what the **Staging configuration** CI job compares against
`backend/package.json` — see §3 below, which is still red.

### 1d. Run the suite against staging

```bash
API=https://<staging api host> \
ADMIN_TOKEN=$(ADMIN_EMAIL=<staging admin> ADMIN_PASSWORD=<their password> \
              API=https://<staging api host> ./scripts/admin-token.sh) \
  ./scripts/smoke-test.sh
```

617 assertions passed here against a freshly seeded database. Without
`ADMIN_TOKEN` about 70 admin checks skip themselves — and a skipped check reads
exactly like a passing one, so set it.

---

## 2. Production

### 2a. Merge develop into master

```bash
git fetch origin
git checkout master
git pull origin master
git merge --no-ff origin/develop -m "Merge develop into master — tenancy lifecycle as states, and the gates that can see it"
```

`--no-ff` keeps a merge commit, which is how the previous three develop→master
merges were done. There should be **no conflicts**: master carries no unique
content.

Sanity-check before pushing:

```bash
git diff --stat origin/develop HEAD     # expect no output
```

### 2b. Migrate production FIRST, before pushing master

Same script, pointed at production. There is no `migrate:prod` npm script —
`scripts/migrate-remote.sh` is environment-agnostic and reads whatever you
export, which is why it prints the target and asks.

```bash
export NEON_POOLED="postgresql://…-pooler….neon.tech/…?sslmode=require"   # PRODUCTION
export NEON_DIRECT="postgresql://….neon.tech/…?sslmode=require"           # PRODUCTION

bash scripts/migrate-remote.sh
```

**Read the `Database:` line it prints before answering yes.** It shows host and
database name only; the password is never printed.

❗ Never run `npx prisma migrate deploy` directly against a remote database.
`schema.prisma` declares `directUrl = env("DIRECT_URL")`, so exporting only
`DATABASE_URL` leaves `DIRECT_URL` coming from `backend/.env` — the migration
lands on localhost while reporting *"All migrations have been successfully
applied."* That is how production stayed down for an extra hour on 5 October.

### 2c. Push master

```bash
git push origin master
```

### 2d. Check production

```bash
curl -s https://api.umastande.co.za/health | jq .
```

Expect `"env":"production"` and `"db":"connected"`.

```bash
curl -s https://api.umastande.co.za/robots.txt
```

Production **must** be crawlable — the opposite of staging. If it shows
`Disallow: /`, `APP_ENV` is wrong on Render.

---

## 3. The one thing still failing, and it is yours not the code's

**`Staging configuration`** is red on `develop` and was red before any of this
work — byte-identical annotation before and after. The check itself is sound: it
polls `/health` for eight minutes, then compares the served `version` against
`backend/package.json` (`1.81.0`, and root/backend/frontend all agree).

It fails because either the staging deploy has not landed or the service is
suspended. That needs the Render dashboard, which the cloud container cannot
reach. Once §1 above is done it should go green on its own; to force a re-run:

```bash
gh workflow run verify-deployment.yml --ref develop
```

If it still fails, check `STAGING_API_HOST` under
**Settings → Secrets and variables → Actions → Variables**. Note that *any*
`*.onrender.com` name resolves whether or not a service exists behind it, so a
typo there looks exactly like an outage.

---

## 4. House adverts — the advertiser still reads "RentBoard ZA"

The bug that made this unfixable is fixed (the script's `upsert` had
`update: {}`, so it only ever applied on create and reported *"Nothing to
change"*). The script now works, but **it has only been run locally** — the
production and staging rows are still wrong.

Dry run is the default and writes nothing. Run it on **each** environment:

```bash
cd backend

# 1. Dry run — prints which database, then current copy beside new copy.
DATABASE_URL="<target pooled URL>" npx ts-node prisma/seed-house-ads.ts

# 2. Read the diff. If the host on the `Database:` line is not the one you
#    meant, STOP. Without DATABASE_URL it reads backend/.env and reports a
#    calm, accurate result about your local database.

# 3. Write.
DATABASE_URL="<target pooled URL>" npx ts-node prisma/seed-house-ads.ts --apply
```

Use this rather than `prisma/seed.ts`: the full seed **resets the admin
account's password** to whatever you pass as `ADMIN_PASSWORD`, and seeds the
whole place taxonomy on the way past. Changing three lines of advert copy should
not cost you your admin password.

---

## 5. Tags — and a discrepancy worth knowing about

The documented command is:

```bash
./scripts/sync-tags.sh           # show what is missing
./scripts/sync-tags.sh --push    # create and push it
```

**It currently reports "Every release tag on develop is already on origin", and
that is misleading.** It derives versions from `package.json` bumps on develop's
first-parent line — and `package.json` has been stuck at `1.81.0` while tags ran
to `v1.115.0`, so it has nothing to find.

In fact **`v1.114.0` and `v1.115.0` are missing from the remote** (highest there
is `v1.113.0`). Both tagged commits exist. Only the older script creates them:

```bash
bash scripts/push-release-tags.sh
```

Safe to re-run: a tag already on the remote is skipped, never overwritten, and
each keeps its original message and date. It prints its own count and range at
startup, so you can see whether your copy is behind.

⚠️ **Two gaps I did not close, so you know rather than discover them:**

1. **Phases A–K and these CI fixes have no tag entries at all.** CLAUDE.md says
   "a tag per phase in `scripts/push-release-tags.sh`"; the script tops out at
   `v1.115.0`, from 7 October. Adding entries for the newer phases is a decision
   about version numbers that is yours, not mine.
2. **`package.json` has not been bumped since `1.81.0`**, which is what broke
   `sync-tags.sh`'s ability to see anything. The checklist rows I wrote are
   labelled `v1.129.0`/`v1.130.0` by the docs convention; no tag or
   `package.json` version corresponds to them. Fixing the bump habit is what
   makes `sync-tags.sh` work again.

---

## 6. Also still outstanding, from earlier in the session

- **The Neon password rotation** — unchanged, still owed.
- **`control-contrast-audit.mjs`** — asserted in a comment, never written
  (`docs/OUTSTANDING.md` §41). The defect it describes has reached a phone:
  a white-on-white button measured at 1.00:1.
- **§31, the five-index schema drift**, and a `var(--surface2, …)` fallback
  standing in for a token that is not defined.
- **DM Mono is not in the font request** — a cost decision for you.
- The PR's Notion copy checkbox was left unticked.

Full detail for all of it is in `docs/OUTSTANDING.md` §§29–56 and
`PRE-LAUNCH-CHECKLIST.md`.
