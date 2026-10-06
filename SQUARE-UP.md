# Squaring up — branches, tags, migrations

Run these on **your own machine**, in a clone of `peremod/rentboard-za1`.

Everything below was checked against the remote as it stands now:

| | |
|---|---|
| `origin/master` | `e1a0d4b` — Merge develop into master (Phases 8g + 8h) |
| `origin/develop` | `282ee0d` — Merge Phase 8h into develop |
| `origin/claude/fervent-turing-idztsy` | `cd6d903` |
| Tags missing from the remote | `v1.112.0`, `v1.113.0` |
| Local branches already merged into master | **42** |
| Remote branches already merged into master | **29** (plus the claude branch) |

**Nothing is unmerged.** `git branch --no-merged origin/master` and
`git branch -r --no-merged origin/master` both come back empty, so no work is
lost by any delete below.

---

## 0. Start from the truth

```bash
cd /path/to/rentboard-za1
git fetch origin --prune --tags
git checkout master && git pull --ff-only origin master
git checkout develop && git pull --ff-only origin develop
```

`--ff-only` on purpose: if either refuses, something diverged locally and you
want to know before merging anything, not after.

---

## 1. Tags

The two missing tags are **not** in your clone — they were created in a cloud
container whose credentials GitHub refuses for `refs/tags/*` (HTTP 403, twice).
The script recreates them from the recorded commits, which are all on the remote
already, and pushes them.

```bash
bash scripts/push-release-tags.sh
```

Safe to re-run: a tag already on the remote is skipped, never moved. Expect
`Created 2 tag(s), skipped 43 — of 45 entries in this file.`

Verify:

```bash
git ls-remote --tags origin | grep -E 'v1\.11[23]\.0'
```

Two lines back = done. Nothing = the push was refused again, and it is a
credentials problem, not a script problem.

---

## 2. Migrations — ⚠️ do this BEFORE the next deploy

`20261005160000_screen_hints` adds `users.hintsSeen`, and `auth.service.ts`
already selects it in `getMe`. Until the migration lands, **every login answers
500** (Prisma P2022). That is live right now.

### 2a. Look before you touch

```bash
export NEON_POOLED='postgresql://…-pooler…/neondb?sslmode=require'
export NEON_DIRECT='postgresql://…/neondb?sslmode=require'     # no -pooler

DATABASE_URL="$NEON_POOLED" DIRECT_URL="$NEON_DIRECT" \
  node scripts/migration-preflight.mjs
```

Read **§0 of its output first** — it prints the host `migrate deploy` will
actually reach. That section exists because the 5 October migration reported
"All migrations have been successfully applied" against `localhost`.

### 2b. Apply

```bash
DATABASE_URL="$NEON_POOLED" DIRECT_URL="$NEON_DIRECT" \
  bash scripts/migrate-remote.sh
```

It prints the target and asks before doing anything. `CONFIRM=yes` skips the
prompt — only once you have read the target.

**Never `npx prisma migrate deploy` directly.** `schema.prisma` declares
`directUrl = env("DIRECT_URL")`, so exporting only `DATABASE_URL` leaves
`DIRECT_URL` resolving from `backend/.env` and the migration lands on localhost
while reporting success. That cost an hour of downtime on 5 October
(`docs/OUTSTANDING.md` §5a).

### 2c. Both environments

There are two remote databases — staging and production
(`docs/ENVIRONMENTS.md`). Run 2a and 2b **once per environment**, with that
environment's pair of URLs. The preflight's §0 is how you confirm which one you
are about to touch.

### 2d. Confirm it took

```bash
DATABASE_URL="$NEON_POOLED" DIRECT_URL="$NEON_DIRECT" \
  node scripts/migration-preflight.mjs        # expect 0 pending
```

Then sign in on the site. A successful login is the only proof that matters
here — the 500 is what a person hits.

---

## 3. Branches

### 3a. See what would go (run this first)

```bash
echo "── local ──"
git branch --merged origin/master | sed 's/^[* ] //' \
  | grep -vE '^(master|develop|claude/fervent-turing-idztsy)$'

echo "── remote ──"
git branch -r --merged origin/master | sed 's#^ *origin/##' \
  | grep -vE '^(master|develop|HEAD|claude/fervent-turing-idztsy)'
```

Expect 42 local and 29 remote.

### 3b. Delete the merged local branches

```bash
git checkout master
git branch --merged origin/master | sed 's/^[* ] //' \
  | grep -vE '^(master|develop|claude/fervent-turing-idztsy)$' \
  | xargs -r -n1 git branch -d
```

`-d`, not `-D`: git refuses anything not actually merged, so this cannot throw
work away even if the filter above is wrong.

⚠️ **13 of those exist only on your machine** — there is no remote copy to
recover them from. All 13 are merged into `master`, so the commits survive in
master's history; only the branch names go. They are:

```
backup/pre-msg-rewrite          feature/portal-layout
chore/sync-tags                 feature/yard-dashboard
feature/dashboard-home          fix/accessibility-pass
feature/informal-verification   fix/three-phase-audit
feature/mastande-rebrand        fix/vercel-ssr-routing
feature/messages-inbox          fix/whatsapp-webhook-signature
feature/onboarding
```

### 3c. Delete the merged remote branches

**This is the irreversible one.** It removes 29 branches from GitHub. Every
commit is in `master`, and GitHub keeps deleted branches restorable for a while
from the branches page, but check 3a's output before running it.

```bash
git branch -r --merged origin/master | sed 's#^ *origin/##' \
  | grep -vE '^(master|develop|HEAD|claude/fervent-turing-idztsy)' \
  | xargs -r -n20 git push origin --delete
```

Then:

```bash
git fetch origin --prune
```

### 3d. What to keep

| Branch | Why |
|---|---|
| `master` | production |
| `develop` | staging |
| `claude/fervent-turing-idztsy` | the designated branch these sessions develop on — merged, but deleting it just means the next session recreates it |

If you would rather start each session clean, it is safe to delete
(`git push origin --delete claude/fervent-turing-idztsy`); nothing depends on
it existing.

---

## 4. Final check

```bash
git fetch origin --prune --tags
git branch -a
git ls-remote --tags origin | grep -E 'v1\.11[23]\.0'
git log --oneline -1 origin/master
```

Expected: three branches, two tag lines, `e1a0d4b` on master.

---

## Still outstanding, separately

- **Rotate the Neon password.** The connection string was pasted into a chat
  transcript.
- `ns.dns1.co.za` SOA serial — re-check with the registrar.
- The initial bundle is **6.41 kB over its 450 kB budget**. It was already
  4.75 kB over before this phase; not introduced here and not fixed here.
