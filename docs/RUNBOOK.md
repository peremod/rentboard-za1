# Runbook — the commands, in order

Nothing to decide, nothing to look up. Development first, then staging.

Every command here was run against this repository before it was written down.

---

## Development

### First time, or after any `git pull`

```bash
cd ~/Downloads/rentboard-za1
git pull origin develop

npm run install:all       # root, frontend and backend
```

`install:all` regenerates the Prisma client for you — `backend` has a
`postinstall` that runs `prisma generate`. Skipping the install after a pull
that added a migration is what produces a wall of *"property does not exist on
PrismaService"* errors. They are not code errors; they mean the generated
client is older than the schema.

### Apply any new migrations

```bash
cd backend
npx prisma migrate deploy
cd ..
```

Safe to run when there is nothing to apply — it says so and exits.

### Run it

Two terminals.

```bash
npm run backend           # API on :3000
```

```bash
npm run frontend          # site on :4200
```

`start:dev` lives in `backend/package.json`, so `npm run start:dev` only works
from inside `backend/`. From the repository root the script is `backend`.

### Check it

```bash
curl -s http://localhost:3000/health
```

Expect `"status":"ok"`, `"db":"connected"`, and a `version` matching
`package.json`. A version older than the repository means a stale build is
running — stop it and start it again.

Then the full API suite:

```bash
ADMIN_TOKEN=$(./scripts/admin-token.sh) ./scripts/smoke-test.sh
```

It prompts for the admin email and password. Expect **~397 passed, 0 failed**;
some sections skip depending on what earlier sections left behind, which is
normal. Any number in the FAILED column is not.

No admin account yet:

```bash
cd backend
ADMIN_EMAIL=you@example.co.za ADMIN_PASSWORD='choose-a-strong-one' npx ts-node prisma/seed.ts
cd ..
```

### Before pushing anything

```bash
npm run audit             # routes, i18n, environment parity
npm run verify            # builds all three configurations, 27 assertions
```

`verify` is the one that refuses to let a release be tagged — unfilled
`[PLACEHOLDER]` text, a non-indexable production build, a missing canonical.

---

## Tags

Release tags are created on whichever machine cut the release, so yours may be
missing some. Do not hand-write a push list: `git push origin v1.a v1.b v1.c`
aborts the **whole** push if any one ref does not resolve locally, so a single
missing tag silently blocks every other tag with it.

```bash
./scripts/sync-tags.sh           # show what is missing
./scripts/sync-tags.sh --push    # create and push it
```

It reads the versions out of the history rather than taking a list: every
release commit on `develop`'s first-parent line bumps `package.json`, so the
version and its commit are both already recorded. It pushes one ref at a time,
so a failure on one tag cannot take the others down.

---

## Staging

Staging is disposable and has its own database. Running the smoke suite against
it is expected — that is what it is for.

**The order matters: schema first, then code.** Render deploys on push, out of
band and without running migrations, so code can arrive before the columns it
needs. That failure looks like a 500 on one endpoint rather than an unhealthy
service, which is why it is easy to misread.

### 1. Migrate, before the deploy lands

```bash
export NEON_POOLED="postgresql://…-pooler….neon.tech/…?sslmode=require"
export NEON_DIRECT="postgresql://….neon.tech/…?sslmode=require"

npm run migrate:staging
```

Both strings come from the Neon dashboard. **The direct one is not optional.**
Migrating through the pooled string fails with an advisory-lock error that
reads like a permissions problem and is not one — the pooled host is the one
with `-pooler` in it, the direct host is the one without.

### 2. Environment variables on Render

Set these on the staging environment. Nine of them were missing from the
deployment guide until v1.61.0, so check rather than assume:

```
APP_ENV=staging
SITE_URL=https://<staging frontend host>
FRONTEND_URL=https://<staging frontend host>
API_URL=https://<staging api host>
REFRESH_TOKEN_TTL_DAYS=30
RESEND_FROM_NAME=Mastande
WHATSAPP_API_VERSION=v19.0
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
```

`SITE_URL` is required — **the API refuses to start without it**, deliberately,
so a misconfigured box fails loudly instead of quietly publishing production
URLs in a staging sitemap.

`WHATSAPP_APP_SECRET` is the Meta App Secret, not the verify token. Without it
the inbound webhook refuses every delivery by design, and rent reminders,
previous-landlord references and WhatsApp listing are all silently dark.

The full list is `docs/DEPLOYMENT.md` §3, which is now checked against what the
code actually reads — `npm run audit:env` fails if they drift apart again.

### 3. Let Render deploy, then check it

```bash
curl -s https://<staging api host>/health
```

Same three things as development: `ok`, `connected`, and a `version` matching
what you pushed. A stale version means the deploy has not landed or failed.

### 4. Run the suite against it

```bash
API=https://<staging api host> \
  ADMIN_TOKEN=$(API=https://<staging api host> ./scripts/admin-token.sh) \
  ./scripts/smoke-test.sh
```

### 5. Let CI do step 3 for you

Set one repository variable and `Verify deployment` does the health, version,
database and crawler checks on every push:

**Settings → Secrets and variables → Actions → Variables**

| Name | Value |
|---|---|
| `STAGING_API_HOST` | the staging host, hostname only — no `https://`, no trailing slash |

Unset, it skips and says so.

---

## When something is wrong

| Symptom | Cause |
|---|---|
| Dozens of *"property does not exist on PrismaService"* | Generated client older than the schema. `npm run install:all`, then `npx prisma migrate deploy` in `backend/` |
| `Missing script: "start:dev"` | You are in the repository root. `npm run backend`, or `cd backend` first |
| Everything that touches the database 500s, but `/health` is fine and validation still returns 400 | Migrations have not been applied to that environment. Step 1 of staging |
| API will not start, no obvious error | `SITE_URL` is unset. It refuses on purpose |
| `/health` reports an older version than you pushed | Stale build. Locally, restart; on Render, check the deploy |
| Advisory-lock error during migration | You used the pooled connection string. Use the direct one |
| Deploy check skips with "No STAGING_API_HOST" | Expected until you set the variable |
