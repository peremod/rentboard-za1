# Outstanding — things only you can do

Everything here needs credentials, a production deploy, a third party, or a
person. None of it can be done from a cloud coding session, which is why it is
written down rather than left in a chat that ends.

**Each item has: the command, how to tell it worked, and what breaks if it is
skipped.** Tick them off by editing this file.

Last updated: 2026-09-29, after Phase 7g's schema and hardening. Repo state: 19
migrations in
`backend/prisma/migrations/`. Check the gap to master with
`git rev-list --left-right --count origin/master...develop` rather than trusting
a number written here.

---

## 1. Push the release tags — ✅ DONE 21 October 2026

✅ **Nothing outstanding.** The operator ran the script from their own clone
and the tags landed. Verified from the container by reading the remote rather
than taking it on trust — and verified by TARGET, not just by presence, since
a tag that exists but points at the wrong commit is worse than one missing:

```
v1.162.0 → 11e1f4fb35cb  ✅ chore(release): v1.162.0 to production
v1.163.0 → b933cce2f5a3  ✅ chore(release): v1.163.0 to production
v1.164.0 → 9f5dc0648982  ✅ chore(release): v1.164.0 to production
```

The remote now holds **276 tags** against the script's **80 entries**.

### The history of this section, kept because it is the lesson

⚠️ It said "nineteen tags" and `Created 19 tag(s)` long after that stopped
being true. Measured on 21 October: the script held 76 entries, the remote 271
tags, and exactly **two** were missing — a two-tag job reading as a large one,
because a number written into prose goes stale and nothing tells you.

⚠️ And it was missing `v1.162.0` entirely — released, deployed and superseded
without ever being tagged. That is why the count was two rather than one, and
it was only found by diffing the script's entries against the release commits
rather than reading the section.

**Pushing `refs/tags/*` cannot be done from a coding container.** Re-measured
on 21 October, four attempts: `git push --dry-run` is ACCEPTED, which is the
trap, while the real push dies with `send-pack: unexpected disconnect while
reading sideband packet` and `git ls-remote` confirms nothing landed. Branch
pushes in the same session succeed. ⚠️ The symptom has changed — this section
used to record an HTTP 403 — so match on the outcome (the tag is not on the
remote) rather than on the error text.

```bash
cd /path/to/rentboard-za1
git fetch origin
bash scripts/push-release-tags.sh
```

**Worked when:** it prints `Created 2 tag(s), skipped 74 — of 76 entries in
this file` and pushes without error. The three numbers must add up; the script
says so itself if they do not, because "Created 0, skipped 19" used to be
indistinguishable from a run that stopped early.

```bash
# Verify
git ls-remote --tags origin | grep -E 'v1[.]16[01][.]'
```

**If skipped:** the two newest releases have no tag, so `git describe` cannot
name the commit that shipped the board's keyword search or its browse
shortcuts — the two changes most likely to need pointing at.

> **Note:** v1.84.0 is NOT in the script. Phase 5 is unfinished — **5c
> (share/flyer generator) is the only part left**, and it needs device testing
> nobody in a container can do; see §10. 5e, 5f and 5h are done, and 5g turned
> out to be already built.
>
> **v1.85.0, v1.85.1 and v1.86.0 ARE in the script** (Phase 7g parts one and
> two, and Phase 6), which is why the count went from fourteen to seventeen.
> Neither phase is finished — 7g still wants assisted sign-up, phone-only
> account recovery and adding an email later; Phase 6 ships without an
> attorney-reviewed sub-letting page (§8) — but each tag marks a release that
> stands on its own, the same way v1.82.0 covered three parts of Phase 4
> without finishing it.

---

## 2. Deploy: `develop` → `master`

31 commits, covering Phases 4b–4e, 5a, 5b, 5d, 5h and the file-deletion fix.
Refused from the coding session as a production deploy.

```bash
git fetch origin
git push origin origin/develop:master
```

**Worked when:** Vercel and Render both build green, and `/` loads.

**Do §5 (migrations) BEFORE this.** Render deploys on push without running
migrations, so code can land before the columns it needs. That failure looks
like a 500 on one endpoint rather than an unhealthy service — easy to misread.

---

## 3. ⚠️ Confirm ImageKit deletion and signed URLs against a real key

**The most important item on this list.** Until v1.83.0 nothing in the codebase
had ever deleted a stored file, while the privacy policy, the statutory PAIA
manual and the tenant upload screen all said uploaded documents were deleted.
That is fixed — but the fix was driven against a *stub* ImageKit, because there
are no credentials in the build container.

Whether ImageKit **accepts** our signature and delete calls is the one thing only
a real key can answer. The algorithm matches their SDK and
`scripts/storage-drive.mjs` recomputes it independently, so the implementation is
self-consistent and correctly shaped. Acceptance is unverified.

```bash
# On staging, with real IMAGEKIT_* set. As an admin:
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://<staging-api>/api/admin/storage/status | jq
```

**Worked when:** `stuck` is `0` and `deleted` climbs after you decide a
verification. Then check the real thing:

1. Submit a verification with a document as a test tenant.
2. Approve it as an admin.
3. Re-read `/api/admin/storage/status` — `deleted` should have gone up and
   `oldestError` should be `null`.
4. Confirm in the **ImageKit dashboard** that the file is actually gone.
5. Open a lease document as a party to a tenancy and confirm the signed URL
   loads rather than 401ing.

**If it fails:** `oldestError` will name the reason. A 401 there means the
signature format is wrong — documents will neither open nor delete, and the
retention promise in the privacy policy is not being kept.

**If skipped:** you are publishing a statutory claim you have not verified.

---

## 4. ⚠️ Confirm storefront indexability on production

New in 5b. Landlord storefronts live at `/landlords/:slug` and are a real SEO
surface. **No local host is the canonical host**, so every local server serves
`noindex` and omits the canonical — a room page behaves identically. This cannot
be checked before deployment.

```bash
# Replace with a slug of a landlord who has published their page
curl -s https://www.umastande.co.za/landlords/<slug> \
  | grep -iE '<meta[^>]*robots[^>]*>|<link[^>]*canonical[^>]*>'
```

**Worked when:** there is a `rel="canonical"` pointing at
`/landlords/<slug>`, and **no** `noindex`.

```bash
# And that it is advertised
curl -s https://www.umastande.co.za/sitemap.xml | grep landlords/
```

**If it fails:** the page is invisible to Google and the whole SEO case for 5b
is void. `verify-build.sh` already asserts the static half (the route carries no
`noIndex` and is `RenderMode.Server`), so a failure here is a server or host
configuration problem, not a routing one.

---

## 5. ✅ Production was down on a missing migration — applied 5 October

**Resolved.** All 15 pending migrations were applied to the production Neon
database on 5 October through `scripts/migrate-remote.sh`, over the direct
(non-pooler) endpoint. `rooms.listerType` and `users.walkthroughSeenAt` exist and
the room queries stopped erroring with no redeploy. ⚠️ **"Who to call" is now
empty** until an admin records a phone check per contractor at `/admin/services`
— the expected, deliberate side effect of
`20261004180000_service_provider_checks`. The section is kept because the
procedure and the two incidents in § 5a are the record.

**The symptom, from the production API log on 5 October:**

```
PrismaClientKnownRequestError:
Invalid `prisma.room.findMany()` invocation:
The column `rooms.listerType` does not exist in the current database.
  code: 'P2022'  at RoomsService.findAll
```

Every room query fails, so the board, "My properties" and anything listing a
room answer 500. The deployed API knows about `listerType`; the database has
never been migrated to match it.

`listerType` is added by `20261003170000_sublet_listings`, which is **migration
21 of 34**. The preflight run against production on 5 October reported **15 pending**, so
the database is 15 migrations behind the code running against it.

### Before you migrate — a read-only preflight

Running fifteen migrations against a live database is the moment to find out
*in advance* whether one of them will fail halfway, because a half-migrated
production database is a worse place to be than the outage.

```bash
export DATABASE_URL='<production, the -pooler endpoint>'
export DIRECT_URL='<production, the NON-pooler endpoint>'
node scripts/migration-preflight.mjs
```

⚠️ **Every statement in it is a SELECT.** It changes nothing, so it is safe to
point at production — which is the only database where the answer matters. It
reports which migrations are pending, anything in the existing data that would
make the run fail, and anything that would deliberately change live rows. It
exits non-zero if the run would break.

**Both variables, and `export`, not an inline prefix.** See § 5a — the first
attempt at this migration failed on exactly that, and reported success.

Verified against a database built by applying production's own 19 migrations to
an empty database, then migrating it forward: all 15 applied, `rooms.listerType`
and `users.walkthroughSeenAt` appeared, no migration row was left unfinished,
and the 3 contractors seeded into it came out un-listed as predicted. Each check
was then falsified — a planted duplicate verified number tripped the blocker, a
mismatched `DIRECT_URL` tripped § 0, and removing the planted rows made the
"applied but not in this checkout" warning go away.

### Two things it will tell you about this particular run

1. **No constraint can fail** on a database that already has
   `20260929090000_phone_login_identity` applied. If yours does not, the partial
   unique index on verified phone numbers is the one real risk — two accounts
   sharing one verified number stops the run.
2. ⚠️ **Every listed contractor will be un-listed.**
   `20261004180000_service_provider_checks` runs
   `UPDATE service_providers SET active = false`, because Phase 7j made `active`
   require a recorded phone check and no existing row has one. This is
   deliberate — the directory told landlords those names were checked and none
   of them were — but **"Who to call" will be empty afterwards** until an admin
   rings each number and records it on `/admin/services`.

### Then

Back it up first. The database is on **Neon**, so the backup is a branch from
the current head — instant, and it is the restore path if a migration goes
wrong. `pg_dump` also works but the client's major version must match the
server's (18) or it refuses outright.

Then, **from the repository root**:

```bash
export DATABASE_URL='<production, the -pooler endpoint>'
export DIRECT_URL='<production, the NON-pooler endpoint>'
bash scripts/migrate-remote.sh --env production
```

It prints which database it is about to migrate, shows the pending list, and
asks before applying. It refuses if either variable is unset, if either resolves
to localhost, if `DIRECT_URL` is a `-pooler` host, if the two URLs are not the
same database, or if the endpoint is not the one recorded for `--env` in
`scripts/migrate-targets.json` — see §77.

⚠️ **Not `cd backend && npx prisma migrate deploy`.** That command has none of
those guards. See § 5a.

Nothing else is needed — the API does not need redeploying, it will simply stop
erroring once the columns exist.

---

## 5a. ⚠️ How the first attempt at § 5 silently migrated the wrong database

On 5 October the preflight was run against production and correctly reported 15
pending migrations. The next command was the one § 5 printed at the time:

```bash
DATABASE_URL='<production>' node scripts/migration-preflight.mjs   # ✅ production
cd backend && npx prisma migrate deploy                            # ❌ localhost
```

Twelve migrations were applied to `localhost:5432/rentboard_dev` and the output
read **"All migrations have been successfully applied."** Production never
moved; the same `P2022` was in the log minutes later. Both commands exited 0 and
nothing in either output contradicted the other.

Two causes, and both of them were in this repository's own documentation:

1. **An inline `VAR=… cmd` prefix applies to that one command.** It does not
   carry to the next command in the chain.
2. **`prisma migrate` connects through `directUrl`, not `url`.**
   `backend/prisma/schema.prisma` declares `directUrl = env("DIRECT_URL")`, so
   exporting only `DATABASE_URL` is not enough — `DIRECT_URL` still comes from
   `backend/.env`, which is local. This is why `migrate deploy` printed
   `rentboard_dev` even with the production `DATABASE_URL` in the environment.

`scripts/migrate-remote.sh` already refused all of this, for the staging version
of the same mistake, and § 5b already documented it. § 5 was written without
reference to either and told the operator to call `prisma` directly.

### ⚠️ And then the fix raised a false blocker on the same database

The v1.104.0 preflight was run against production with both variables exported
and printed:

```
❌ Same database name "neondb" but different migration history ([object Object] rows vs 30).
34 migrations in the repository: 0 applied, 34 pending.
⚠️  1 migration(s) are recorded as applied but do NOT exist in this checkout.
       [object Object]
```

and exited 1 with **"Do NOT run migrate deploy until this comes back clean."**
The operator overrode it, `prisma migrate status` gave the correct answer, and
the migration succeeded. **Had the blocker been believed, production would have
stayed down** — the same failure as § 5 § 4's "do NOT migrate" verdict, which
that section's own comment was written to prevent, reintroduced one commit later.

The cause, reproduced locally on a healthy database: over that pooled connection
`to_regclass('public._prisma_migrations')` answered `t` while
`SELECT count(*) FROM _prisma_migrations` answered `relation
"_prisma_migrations" does not exist`, and `users` did the same. The session's
`search_path` did not include `public`. An earlier run over the same pooled
endpoint had worked, so it is session-dependent — consistent with a pooled
server connection reused with an altered `search_path`. **Why Neon's pooler did
that is not established**, and cannot be from this environment.

Two defects of this script's own, which is what made an unreadable table look
like a verdict:

1. **Unqualified table names.** Every query now carries the schema, and the
   `search_path` is forced through `PGOPTIONS` when the URL does not set its own
   `options`. Qualification is the fix that does not depend on knowing the cause.
2. **`q()` returns `{error}` and the code treated it as a string.**
   `String({error})` is `"[object Object]"`, which went into the applied-migration
   Set, was counted as a row total, and was interpolated into a blocker. A check
   that cannot read its input now says so and names `prisma migrate status` as
   the fallback, rather than inventing an answer.

Falsified both ways: the exact production condition (a `search_path` without
`public`) reproduced byte-for-byte against the committed v1.104.0 script —
`[object Object]`, "0 applied, 34 pending", exit 1 — and passes clean on
v1.105.0; and a genuinely unreadable table (`REVOKE SELECT`) now reports
"This is the SCRIPT failing, not a verdict about the database."

**Fixed in v1.104.0:**

- § 0 of the preflight now blocks when `DIRECT_URL` is unset, naming the host
  `backend/.env` would have sent the migration to instead; and blocks when
  `DATABASE_URL` and `DIRECT_URL` resolve to different databases, or to two
  databases that share a name but not a migration history.
- The preflight's closing instructions now hand over `migrate-remote.sh` rather
  than a bare `prisma migrate deploy`.

Three further defects in the preflight, found by reading the production output
it produced:

- The run against production reported **"29 applied, 15 pending"** of 34 — which
  does not add up. It was counting `_prisma_migrations` rows, including 10 names
  that do not exist in this checkout. Those are now reported by name as their own
  warning, and the three numbers reconcile by construction.
- It warned **"0 contractor(s) are listed and ALL of them will be un-listed"**,
  and counted that nothing as a thing to know about before migrating.
- `?schema=public` is a Prisma-only query parameter and `psql` rejects the whole
  URI over it, so the script **could not be run against development or staging at
  all** — it worked on production only because that URL happens to carry
  `sslmode` and `channel_binding`, which libpq understands. It now keeps the
  libpq parameters, carries `schema` across as a `search_path`, and prints which
  parameters it ignored.

---

## 5b. Staging migrations — before any deploy

Thirty-four migrations are in the repo. How many are unapplied on staging depends on
when it was last migrated, so **ask rather than assume**:

```bash
export NEON_POOLED="postgresql://…-pooler….neon.tech/…?sslmode=require"
export NEON_DIRECT="postgresql://….neon.tech/…?sslmode=require"

# 1. What is pending — from backend/, NOT the repo root.
#    `npx prisma` at the root resolves to a different CLI that has no `migrate`
#    command and suggests `migration` instead. Checked, not assumed.
cd backend
DATABASE_URL="$NEON_POOLED" DIRECT_URL="$NEON_DIRECT" \
  npx prisma migrate status

# 2. Apply — from the repo ROOT, where the script lives
cd ..
npm run migrate:staging
```

`migrate:staging` runs `scripts/migrate-remote.sh --env staging`, which refuses
to run against localhost, with `DATABASE_URL` unset, without `DIRECT_URL`, with
`DIRECT_URL` pointing at a `-pooler` host, with the two URLs naming different
databases, or against an endpoint that is not the one recorded for staging
(§77). **The direct string is not optional** — migrating
through the pooled one fails with an advisory-lock error that reads like a
permissions problem and is not one.

Full context: `docs/RUNBOOK.md` § Staging.

**Recent migrations worth knowing about:**

| Migration | What it does |
|---|---|
| `20260929023500_rename_document_deleted_to_withdrawn` | **Renames** a column. Hand-written `RENAME COLUMN`, not Prisma's generated DROP+ADD — the value survives. Tested on a scratch database. |
| `20260928161204_drop_stripe_remnants` | **Destructive.** Drops `renters_passports`, `room_boosts` and two `landlord_profiles` columns. Export first if you want those rows: `SELECT count(*) FROM renters_passports;` etc. |
| `20260929064000_landlord_storefront` | Adds four nullable/defaulted columns + a unique index. Additive. |
| `20260929090000_phone_login_identity` | Makes `users.email` nullable, adds an email-or-phone CHECK, and a **partial** unique index on verified phones. Prisma reports that index as drift on `migrate dev` — do not let it remove it. |
| `20261003080000_phone_signup` | Creates `phone_signups`. Purely additive: no existing column, index or constraint is touched, so no downtime window is needed. |
| `20261003170000_sublet_listings` | Adds `listerType` and `subletCheckedAt` to rooms, a `roomId` to verification requests, the three household enums and their Property columns, and a `sublet_right` verification type. Additive. |
| `20261003220000_property_address_line` | One nullable column on `properties`. Landlord-private; never in a public payload. |
| `20261004140000_walkthrough_seen` | One nullable timestamp on `users`. Purely additive and **not backfilled** — every existing account correctly reads as "never shown round", which they have not been. Stamping them all as seen would hide the walkthrough from exactly the people already here. |
| `20261004090000_room_view_days` | Creates `room_view_days` (roomId + day + counter). Purely additive, and **it starts empty** — so for the first seven days after the deploy the dashboard honestly says "nobody has looked at your rooms in the last seven days" for rooms that were in fact being viewed before it existed. `rooms.viewCount`, the lifetime figure, is untouched. There is no backfill because there is nothing to backfill from: per-day view data has never been recorded. |

**If skipped:** the API 500s on whichever endpoint needs a missing column.

---

## 6. Re-seed the house ads

```bash
cd backend
DATABASE_URL="<production connection string>" \
  npx ts-node prisma/seed-house-ads.ts            # dry run, writes nothing
DATABASE_URL="<production connection string>" \
  npx ts-node prisma/seed-house-ads.ts --apply
```

**Worked when:** it reports 3 house ads seeded, and ad slots on the board show
Mastande's own fill ads rather than empty space.

---

## 7. Meta / WhatsApp Business template approval

Two things need an approved template before they can work at all. Every outbound
message in the codebase is free-form `type: 'text'`, which Meta permits **only
inside the 24-hour customer service window** — a business-initiated message
outside it is rejected with error 131047 and no template.

| What | Needs | Blocks |
|---|---|---|
| `sendOtp` | An **authentication** template | Phone login for anyone outside the 24-hour window — **and phone sign-UP for everybody** |
| Survey outreach | A **utility** template | The WhatsApp delivery variant of the Phase 0 survey |
| Rent reminders (4a) | A **utility** template | Reminders to tenants who have not messaged in 24h |

Submit in **Meta Business Manager → WhatsApp Manager → Message templates.**
Approval is typically hours to a couple of days.

**Worked when:** the templates show *Approved*, and their names are wired into
the WhatsApp service.

**If skipped:** rent reminders and notification fallbacks silently fail for
anyone who has not messaged in 24 hours — the worst kind of failure, because the
landlord believes the tenant was reminded.

⚠️ **Sign-up is the worst case of this, and it is worth being explicit.** A
person signing up by phone has by definition never messaged us, so they are
*always* outside the 24-hour window. The three-step flow in v1.85.1 is correct
and proven end to end, but until the authentication template is approved, the
code can only be delivered to a number that happens to have messaged the
business in the last day. **Phone sign-up is effectively waiting on this
template** — not on code.

This is why v1.85.0's notification fallback writes an **in-app notice** first and
treats WhatsApp as a best-effort improvement on top: a fallback that only works
inside the 24-hour window is not a fallback. `Notice.whatsappError` records the
refusal so the gap is visible rather than silent.

---

## 8. ⚠️ Attorney review — privacy policy, PAIA manual, sublet page, and now two templates

Both were **changed in v1.83.0** and need a South African attorney's eye. The
PAIA manual is a statutory document.

What changed and why it matters:

- **Privacy policy, ImageKit row** — now distinguishes identity documents
  (*deleted once reviewed*) from leases (*kept, because both parties need them
  for as long as the agreement can be disputed*). Previously it said all uploads
  were deleted after review, which Phase 4e made false in the other direction.
- **PAIA manual** — a new row for lease paperwork, stating that Mastande stores
  the document and does **not** sign, witness, verify or execute any agreement.

And, as of v1.86.0, the one that most needs a lawyer's eye:

- 🔴 **The sub-letting page** (`/legal/sublet`, Phase 6) — **written, live, and
  not reviewed.** It is not a copy of the landlord disclaimer; it is a new page
  addressed to the applicant, telling them what can go wrong when the person
  letting them a room is a tenant, what to ask for before paying a deposit, and
  exactly what the platform did and did not check. It states that we do not
  confirm or guarantee a sub-lessor's right to sublet.

  Why it needs an attorney rather than a careful writer: it characterises the
  effect of a head lease on a sub-tenant and points at the Rental Housing Act
  50 of 1999 on deposits. Both are summarised in plain English from the same
  statutes the rest of the site relies on, and neither should ship to the
  public on my reading of them. Ask specifically about §2 ("What can go
  wrong"), §5 ("Your deposit") and the wording of the banner.

Files: `frontend/src/app/features/legal/privacy-policy/privacy-policy.ts`,
`frontend/src/app/features/legal/paia/paia.ts`,
`frontend/src/app/features/legal/sublet/sublet.ts`.

---

### Added by Phase 8a: the lease agreement and the renewal addendum

`/templates/lease-agreement` and `/templates/lease-addendum` are **downloadable
contracts** and carry the same open review. They ship marked
`awaiting_legal_review`, which puts a warning on the screen **and on the printed
page**, because a warning that vanishes into the PDF is one the person holding
the paper never sees.

They are downloadable on purpose rather than withheld: a landlord who cannot get
one here takes a worse one off a search result with no warning on it at all.
What they must not do is look finished — and the drive asserts the warning
survives printing.

The other two (`move-in-inspection`, `deposit-receipt`) are a checklist and a
receipt, carry no such flag, and need no review.

**When the attorney signs the two contracts off:** change `reviewState` to
`'ready'` in `frontend/src/app/features/templates/template-content.ts`. That one
word removes the banner from both the screen and the print. The drive asserts
exactly two templates are flagged, so it will fail until it is updated with them
— which is the point.

## 9. Delete the merged branches

**25** remote branches are fully contained in `develop` — every one has zero
unmerged commits. Verify before deleting:

```bash
git fetch origin --prune
for b in $(git branch -r | grep -v HEAD | grep -vE 'origin/(develop|master)$' | sed 's| *origin/||'); do
  echo "$b: $(git rev-list --count develop..origin/$b) unmerged"
done
```

Every line must read `0 unmerged`. Then:

```bash
git branch -r --merged develop \
  | grep -v HEAD | grep -vE 'origin/(develop|master)$' \
  | sed 's| *origin/||' \
  | xargs -n 1 git push origin --delete
```

**Do §1 (tags) first.** Some tagged commits are only reachable through these
branches until the tags exist; deleting first could make them unreachable.

**If skipped:** nothing breaks. It is housekeeping.

---

## 11. A phone-only landlord cannot pay the verification fee

PayFast's `email_address` is required by their API. Phase 7g made email optional,
so a landlord with only a phone number is refused at checkout with a plain
instruction to add an email first.

That is deliberate rather than a bug: a placeholder address means the receipt goes
nowhere and a disputed payment has no paper trail, which is worse for the landlord
than being asked for an email. Adding one later is a supported flow.

**Decide before launch:** accept this (a phone-only landlord who wants the
verified badge adds an email), or ask PayFast whether the field can be omitted.
Nothing is broken either way — the refusal is explicit and tells them what to do.

---

## Decisions blocking later phases

Both were answered on 2026-10-03. Kept here with what is left of each, because
one sub-question is still open.

### Phase 6 — the `UserRole` question → **Option A, built in v1.86.0**

A `TENANT` may hold listings, with `listerType` (`owner_landlord` | `sublessor`)
on the listing. `UserRole` keeps its three values and `LandlordProfile` stays
landlord-only.

The part worth knowing: the fifty-two endpoints a lister needs were behind
`LandlordGuard`, and widening that guard would also have opened the yard, rent
tracking, expenses, the paid identity badge, the storefront and
listing-by-WhatsApp — in one edit, invisibly. So there is a second guard
(`ListerGuard`) on what a lister does, `LandlordGuard` stays on what an owner
does, and the drive checks both halves: a sub-lessor can run their listing and
still gets 403 on all five owner surfaces.

**The positioning sub-question was mine to call and I called it: the same board,
with an explicit filter.** Splitting the board halves the inventory each half can
show, and at launch volumes a thin board is what loses both segments. The filter
("Who is letting it": anyone / the owner / a tenant subletting) is how somebody
who only wants one kind says so, and every sublet carries a badge on the card and
a notice on the room page. Say if you would rather it were split — it is a filter
default and a query, not a rewrite.

### Phase 7g — phone/WhatsApp signup → **built**

Email is optional, phone is an alternative login identifier (unique among
*verified* numbers, by partial index), and the database requires at least one of
the two. Signing in by phone shipped in v1.85.0; signing **up** by phone — the
three-step flow with the person's own acceptance of the terms — in v1.85.1.

The in-app notice channel is readable too, as of the same release — it had been
write-only since v1.85.0, which meant a phone-only landlord's notifications were
recorded faithfully and shown to nobody.

**Two of the three remaining items are done in v1.100.0 (Phase 7o)**, and they
turned out not to be features so much as a shipped lockout:

- **Adding an email later** — it was refused with *"This account signs in with
  Google"*, to people who have never seen Google, and that message was the only
  thing between a phone-only landlord and both the verification fee (§11) and a
  second way back in. It works now, with a code to the verified number as the
  step-up instead of a password they do not have, and the address still
  confirmed at the address before it is written.
- **Phone-only recovery** — half of it. What was found was worse than a missing
  feature: `PATCH /api/users/me {"phone": <one digit out>}` returned **200** and
  ended the account, and clearing the number returned a **500**. The number is
  now changed through a flow that proves the new one before the old one stops
  working, and the profile field refuses to touch it when it is the only way in.
  🔴 **The other half is not built and is named:** losing the number entirely —
  stolen phone, dead SIM — still has no route back, because every route needs
  the old number in hand. Recovering without it means proving identity to a
  person, which is the admin and verification machinery, and is a decision
  rather than a patch.
- **Assisted sign-up** — done in v1.101.0 (Phase 7p), admin-recorded, as
  decided. An admin starts it from the overview, the code goes to the person's
  own handset, the person accepts the Terms themselves, and
  `PhoneSignup.assistedByAdminId` records who helped. The reply hands the admin
  no code and no ticket, which is the control: either would let them create an
  account in somebody's name and tick the Terms for them. See FLOW-AUDIT §5.34.

  **Phase 7g is finished, and so is the gap it left.** Lost-number recovery is
  built in v1.102.0 (Phase 7q): an admin looks the account up, records what
  identity document they saw, and approves — which sends a code to the new
  handset that the person enters themselves. Two proofs, neither sufficient
  alone, and the whole flow is refused when the account has an email or a
  password, because then a password reset does the same job and nobody has to be
  trusted. See FLOW-AUDIT §5.35.

  💰 **One decision is yours, and it is not urgent.** A single admin can
  complete a hand-over. The standard control is a **second admin's approval**,
  and it is deliberately not required: Mastande is run by one person, so a
  two-admin rule would make the feature unusable by the only admin there is. If
  the team ever has two people, say so and it is one column plus one check
  (`approvedByAdminId` must differ from `openedByAdminId`).

  ⚠️ **And one thing nothing can fix, named rather than implied:** the real
  owner cannot be warned before the fact. The notice is written the moment a
  request opens, to every channel the account has — and in this case there is no
  email and they cannot sign in to read a Notice. A person with no email, no
  password and no phone has no channel left. The mitigation is the record:
  permanent, attributable to a named admin, and reconstructable in a dispute.

  ⚠️ **If an agent should ever be a real role** rather than an admin, the
  assisted-signup column is already the right shape; what changes is who may
  write it.

---

## 12. Rate limiting: now real, and what a person still has to decide

**What was wrong.** Nothing in the API was rate limited. Nineteen `@Throttle`
decorators across eight controllers did nothing, because `ThrottlerGuard` was
never registered anywhere, and the root throttler was named `global` while every
decorator keys `default`. `/auth/login` had no decorator at all, so password
guessing was unmetered. Found by probing a route marked `limit: 5` eight times
and getting eight `200`s — not by reading the decorator, which looked right.

**What is live now.** The guard sits beside every `@Throttle`,
`scripts/throttle-lint.mjs` fails the build if one is ever added without it, and
both the smoke suite and `phone-signup-drive.mjs` prove a real `429` and that
the window refills. Login is capped at 30 per 15 minutes per IP and register at
60 per hour.

⚠️ **Running the suites repeatedly now matters.** Every limit is per IP and the
test suites share one, so the smoke suite three times inside an hour will start
seeing `429`s on register — which looks like a broken suite and is the limiter
working. Space the runs, or raise the register limit temporarily while you are
hammering it.

**Three things for a person, none blocking:**

1. **There is still no per-ACCOUNT login lockout.** The new limit is per IP, so a
   slow distributed spray against one known email remains possible. The fix is a
   failed-attempt counter on `User` with a cooldown; it was left out of this
   change rather than bundled into a release about phone sign-up.
2. **Counts are in memory, per instance.** Two instances behind a load balancer
   means roughly double every limit. If the API is scaled past one instance,
   point the throttler at Redis (`@nest-lab/throttler-storage-redis`) or accept
   the multiplier knowingly.
3. **The numbers assume carrier NAT, and one assumes a sign-up drive.** Mobile
   carriers here put very large numbers of subscribers behind one address, so the
   auth limits were set at 15/30 per 15 minutes rather than the 5/10 originally
   written — tight enough to stop a single host, loose enough not to lock out a
   township sharing an IP. Register is 60 an hour for a sharper reason: an agent
   helping a row of landlords join at a community event is a growth channel, not
   an attack, and ten an hour refuses the eleventh person in the queue. Scam
   reports went 5 → 20 an hour and advertising enquiries 3 → 15, both because a
   suppressed report or a suppressed lead costs more than the spam does.
   Worth revisiting once there is real traffic to measure: watch for a spike of
   `429`s on `/auth/login` or `/auth/phone/request-code`, which would mean a
   legitimate shared address is being throttled.

---

## 10. Phase 5c needs a real Android phone

The share/flyer generator is the last part of Phase 5 and the only item on this
list that is blocked on **hardware rather than a credential**.

The brief says: *"Test Web Share API image support across target devices —
prioritize Android WhatsApp behavior as the primary test target."* That cannot be
done from a container. `navigator.share()` with a `files` array is supported
unevenly, WhatsApp's Android share-sheet handling of an attached image is its own
behaviour, and a desktop browser tells you nothing about either.

It can be **built** without a phone — the canvas rendering, the three output
shapes, the QR code, the branding, and a download fallback are all verifiable
here. What cannot be verified is whether tapping "Share to WhatsApp Status"
actually attaches the image on a real device, versus silently falling back to a
download.

**So it will ship with the fallback path as the tested one**, and the native
share as best-effort, unless you can test on an Android phone. Say which and it
gets built accordingly.

---

## 13. ⚠️ Buttons were 34px nearly everywhere — and so were the INPUTS

**Both halves are closed now, three releases apart, and the gap between them is
the lesson.** Buttons went to 44px app-wide in v1.93.0. The inputs were not
looked at, and nothing noticed until Phase 7p measured a new admin field at
37px and then measured the rest:

| Screen (360px) | Text controls under 44px | Smallest |
| --- | --- | --- |
| `/` | **12 of 12** | **30px** |
| `/auth/login` | 2 of 2 | 37px |
| `/auth/register` | 4 of 4 | 37px |
| `/auth/register-phone` | 1 of 1 | 37px |
| `/account/settings` | 6 of 6 | 37px |
| `/landlord/rooms/new` | 2 of 3 | 35px |
| `/landlord/properties` | 1 of 1 | 34px |
| `/admin/dashboard` | 2 of 2 | 37px |

⚠️ **`layout-ui-drive` printed "every control clears 44px" the whole time.** Its
`measureRow` selector is `button, a.btn`, so it had never looked at a text box —
a claim about controls measured over a subset of them, in the drive written for
this exact problem. The sentence says "every **button**" now, and a new section 9
sweeps every visible text control on six screens at four widths. Falsified by
removing the global rule: 24 failures.

Fixed in `styles.scss` with a normal-specificity `min-height: 44px` on
`input:not([type=checkbox]):not([type=radio]), select, textarea` — the base look
sits in `:where()` so components can win it, but a tap target is not a look.

**The original note follows, for the buttons half.**

---

Found by the new width checks in `scripts/account-lifecycle-ui-drive.mjs`, then
measured across the public pages:

| Screen (360px) | `.btn` under 44px | Heights seen |
| --- | --- | --- |
| `/` | 4 of 6 | 38, 40, 42px |
| `/rooms` | 4 of 6 | 38, 40, 42px |
| `/how-it-works` | 2 of 4 | 40, 42px |
| `/pricing` | 3 of 5 | **32, 34px** — "List a room", "Create a landlord account" |
| `/auth/login` | 0 of 2 | — |

The base rule in `frontend/src/styles/_spec.scss:107` sets `padding: .55rem 1.2rem`,
`font-size: .875rem` and `line-height: 1`, and **no `min-height`**. That computes
to about 34px, under the 44px target of WCAG 2.5.8. Every button that clears it
today does so because somebody wrote `min-height` by hand on that one button —
`.nav-actions .btn` in `_responsive.scss:276` (the mobile header, fixed in
v1.91.0) and `.btn-danger` on the close-account screen.

Phase 7g fixed **its own** screen: `.ca-paused .btn, .dash-section > .btn` now
carry 44px, because "Pause my account" and "Use my account again" measured 34px
at all four widths and those buttons were built this phase. The drive asserts it
at 360, 390, 768 and 1280.

**✅ Fixed globally in v1.93.0**, with the sweep behind it. `.btn` carries
`min-height: 44px` in `_spec.scss`, and `.link-btn` — which is not `.btn`, sets
`padding: 0` on a `.82rem` font, and measured **17px** — carries a 44px
inline-flex box. The trigger was needing the same local patch on three more
screens in one sitting (the wizard actions, the add-a-property form, the
applicant row): a fix applied four times is a fix in the wrong place.

`min-height` rather than padding, so no button gets wider or re-wraps — it can
only grow a box that was too short. Verified by: the layout drive at four
widths, plus the mobile, nav, a11y, dashboard, properties, account-lifecycle and
messages-inbox drives, the production build and the bundle budget, all clean
after the change.

⚠️ Note how this was found: the previous version of that drive **computed** the
smallest control height, including the pause button, and then never asserted it.
The number was measured and discarded. Same family as a `MAX_ATTEMPTS` nothing
reads.

---

## 14. `saved_rooms` is a table nothing writes to

In the schema. Read in two places, deleted from in one, and **no create, no
upsert, not one write** anywhere in the backend. Saved rooms are entirely
`localStorage`, keyed per user id in `SavedRoomsService` — and that service's own
comment claimed the opposite until this phase corrected it.

So the model says the feature is server-side and it is not. The next person to
read the schema will believe it, which is the same shape of defect as a
`documentDeletedAt` that deleted nothing.

It surfaced twice in Phase 7g:

- `scripts/account-lifecycle-drive.mjs` first POSTed to `/rooms/:id/save` — a
  route that does not exist. The row was never created, the survival check
  passed against nothing, and the drive reported a product bug about a row that
  had never been there. It now inserts the row directly **and asserts the
  precondition**, because a negative check whose setup silently failed proves
  nothing in either direction.
- Closing an account cannot erase a person's real saved rooms, because they are
  on their device. The close-account screen therefore clears every
  `rb_saved_rooms*` key itself (`SavedRoomsService.clearDevice()`) and says so on
  screen — otherwise somebody who closed their account would hand the next
  person to pick up the phone the list of rooms they had been looking at.

**Promoting it** is a create endpoint, an index, and a migration of everybody's
device-local saves — not a line. **Removing it** is a migration and deleting the
two reads. Either is fine; leaving a table in the schema that lies about the
feature is not.

---

## 15. A wrong password used to log you out — fixed, and worth knowing why

Phase 7g. `/auth/change-password`, `/auth/change-email` and `DELETE /account`
answered **401** when the password typed INTO the form was wrong. The frontend's
`errorInterceptor` reads a 401 on any non-auth endpoint as an expired access
token: it refreshed the session silently, retried the request once, re-sent the
same wrong password, got 401 again — and a second failure means what it says.
"Your session has expired", session cleared, login page.

So typing your own password wrong signed you out. The inline
`Your current password is not correct.` written on the settings screen could
never render, because the component was gone before it had the chance. Proven in
a browser, not reasoned about:

```
URL AFTER WRONG CURRENT PASSWORD: /auth/login?returnUrl=%2Faccount%2Fsettings
inline .field-error: []
says session expired: true
```

Those refusals are **403** now — the request was authenticated, the supplied
password is what was refused — plus an `INLINE_ERRORS` HttpContext token so a
form that shows the message itself does not also get a modal over it. Driven in
`scripts/account-lifecycle-ui-drive.mjs` sections 4 and 7, section 7 being the
settings screen where it had actually shipped.

⚠️ **The smoke suite had a check here and it could not fail.** Line 967 asserted
401 for a wrong current password; line 974 asserted 401 for no auth at all. Both
were 401, so the suite could not tell "the password you typed is wrong" from
"you are not signed in" — the same thing the browser could not tell. They are
403 and 401 now, and the pair is the check.

**Nothing to do.** Listed because the same 401 is probably sitting on other
step-up checks added later, and because the pattern to copy is here.

---

## 16. 💰 Contractor money: lead fees and paid placement, both your call

Phase 7k built everything up to the money and stopped. This is the decision
waiting on you, and it is a product decision rather than a technical one.

### What the models forced

**A contractor is not a user.** `ServiceProvider` has no `userId` and no email —
a name, a phone number and the areas they cover. They cannot sign in, cannot
see a bill, cannot accept terms and cannot dispute a charge. There was also no
lead model at all, so nothing recorded that a number had been passed on.

So the product now keeps the **record**: what was passed on, to whom, on what
day, and what it comes to at a rate you set. **Nothing collects**, and the
drives assert that — no `paid`/`invoiced`/`settled` column on a lead, and no
`pay`/`invoice`/`checkout`/`charge` route under the services module.

⚠️ This does **not** touch "free to list, free to apply": the money would come
from a contractor receiving leads, a third party, never from a landlord listing
a room or a tenant applying for one.

### What you can do today, with no code

1. **Set a rate.** Admin → Who to call → "Set what a lead costs". Per trade,
   from a date. There is no default anywhere in the product and no number
   suggested in the form, because the brief said not to assume pricing — until
   you set one, leads are counted and deliberately not priced.
2. **Record that a contractor agreed**, in their own words, on the same screen.
   Nothing is billable without it: charging somebody for leads they never
   agreed to receive is not defensible, and they have no account in which to
   agree.
3. **Read the table and invoice from it.** It reports leads priced, leads
   counted-only, and what the priced ones come to. It says in its own words
   that nothing has been invoiced or paid.

### The three ways forward, and what each costs

| | What it means | What it needs |
|---|---|---|
| **Stay here** | You invoice by hand from the admin screen. Works now | Nothing |
| **Contractor accounts** | They sign in, see their leads, accept terms, dispute a charge, and pay | A portal, auth for a new kind of user, terms, a dispute path. The biggest piece of new product in the backlog |
| **Charge per job, not per introduction** | Fairer, and what a contractor would prefer | The contractor has to tell us a job happened — which needs an account, so it is the row above plus a pricing change |

⚠️ **A bill somebody cannot see is a bill they can reasonably refuse.** That is
the real argument for contractor accounts, and it is why this stopped where it
did rather than wiring PayFast to a phone number.

### The same decision covers paid placement

`sponsoredUntil` has been on `ServiceProvider` since Phase 4, reserved for a
paid placement in the directory. This used to be a separate note headed "also
undecided". It is not separate: **it is blocked on exactly what lead fees are
blocked on.** A placement is sold to the contractor, and Phase 7k established
the contractor is not a user — no account, no email, no way to see what they are
being charged for or to disagree with it. Whatever answers the three options
above answers this too.

It also needs one thing lead fees do not: **a label.** A paid entry in a list
captioned "names we have looked into" has to say it is paid, or the caption is
false for that row. The directory's whole value is that a landlord can believe
it when deciding whether to let a stranger into their tenant's room.

⚠️ **Phase 7m found that the column was writable, and fixed that much.** Both
DTOs accepted it with no rule but `@IsISO8601()`, so an admin could set a
sponsorship — any date, 1999 included — get HTTP 200, see it stored, and have
nothing happen; and it was being sent to every landlord's browser, where a
single client-side sort would have made the directory an advertising surface
without touching the backend decision that says not to. The write is a 400 now,
the field is out of the payload, and existing values were cleared as residue.
The column remains, for whenever this is decided. **Nothing about the decision
itself has been pre-empted** — what changed is that wiring it up now has to be
deliberate rather than one sort call away. See docs/FLOW-AUDIT.md §5.31.

---

## 17. 23 classes are used in a template and styled nowhere

`scripts/css-coverage-audit.mjs` (v1.106.0) checks that every class a template
uses has a rule in the shipped CSS. Switched on, it found **27 across 82
components**. One — `.btn-danger`, which made a destructive button on five admin
screens look identical to an ordinary one — was fixed immediately. The other 26
are in `scripts/css-coverage-baseline.json`.

⚠️ **A baseline, not an allowlist.** The audit names them on every run and fails
on anything that is not among them, so a new one is caught the day it is
written. The existing debt stays in sight and is burned down by deleting lines,
which only goes one way. It is NOT permission — each line is a screen rendering
some unstyled inline content to somebody.

What this costs, from the two that were fixed: `.yard__actions` put "Shared
details" and "Delete this property" on a landlord's phone as one unbroken
string; `.form-error` rendered a failed save, `role="alert"` and all, as
ordinary body text on four screens. Neither was visible to any other check here.

### ✅ Three burned down in v1.113.0 (Phase 8h) — and this is what the baseline cost

`.field`, `.field-label` and `.btn-link` were baselined in Phase 8c and left.
Four months later the owner photographed three screens and called them "bad UI
layout". All three photographs were these three lines.

- **`.field` / `.field-label`** — six uses across lease-documents,
  storefront-settings and tenant-notes. `.field` is a `<label>`, so it got
  `:where(label) { display: block }` and nothing else; a `<select>`, `<input>`
  or `<textarea>` is inline-block with no width, because the base control rule
  leaves layout to the container **on purpose** — and the container was this
  class. So "What is it?" sat on the same line as its dropdown, "Name it"
  beside its box, and the landlord's public-page bio was a `<textarea>` at its
  default twenty-column width: a one-sentence-wide box for 600 characters of
  "in your own words".
- **`.btn-link`** — one use, and it was the loudest thing on the screen. The
  lease-and-paperwork list names each stored document with
  `<button class="btn-link doc-open">`. With no rule it fell through to
  `:where(button)`, the app's bare-button default, and every file a landlord
  had uploaded rendered as a full **terracotta primary button**. A list of
  documents looked like a column of calls to action, and the real action on the
  row (Remove) looked subordinate to it.

The lesson is about the baseline rather than about CSS: it is **debt that
ages**, and nothing was tracking how long a line had been in it. The audit
named all 26 on every run and was read as a pass because the number did not go
up.

The same phase also taught the audit about `:not(.x)`, `:is(.x)` and
`:where(.x)` — a class referenced only from inside a functional pseudo-class
was reported as having no rule at all. The navbar's `.nav-home` is exactly
that: a marker so one responsive rule can say which ghost button stays in the
header on a phone.

The remaining 23, in `scripts/css-coverage-baseline.json`:

| `.ac-sub` |
| `.auth__alt` |
| `.auth__form` |
| `.auth__hint` |
| `.card` |
| `.cover-note` |
| `.detail__facts` |
| `.detail__safety` |
| `.detail__section` |
| `.growth-table` |
| `.landlord-trust` |
| `.landlord-trust__state--none` |
| `.landlord-trust__state--ok` |
| `.lead-agree` |
| `.linkish` |
| `.notice-main` |
| `.photo-upload` |
| `.pill` |
| `.referral-share` |
| `.rent-reminders` |
| `.shared-rules` |
| `.shared-who` |
| `.verify-facts` |

Worth knowing before picking one up: a class that always appears beside another
that does the styling (`class="muted something"`) is a hook, not a defect —
those live in `ALLOWED` in the audit, each with a reason. These 23 are the ones
with nothing carrying them.

**Check it:** `npm run audit:css`, after a production build.

---

## 18. ✅ A tenancy can now start and end — notice and lease terms still cannot

The owner reported the rent screen as confusing: *"how a tenant's move is
confirmed."* It is not a wording problem.

**Accepting an applicant opens a tenancy that nothing can ever move forward.**

`applications.service.ts` opens a `Tenancy` the moment a landlord accepts, with
its own comment: *"It stays 'pending' until someone confirms the move-in."*
`TenancyStatus` is `pending → active → ended`, and `confirmStart` is a real,
working, either-party endpoint:

```
POST /api/tenancies/:id/confirm-start   "Confirm the tenant moved in — either party may confirm"
POST /api/tenancies/:id/cancel          "The letting fell through before move-in. No reviews follow."
POST /api/tenancies/:id/end             "End an active tenancy. This is what opens reviews."
POST /api/tenancies/:id/notice          notice to leave
PATCH /api/tenancies/:id/lease          the agreed terms
```

Every one of them is wired into `tenancies.service.ts` on the client. **No
component calls any of them.** Counted:

| Action | Components calling it |
|---|---|
| `confirmStart` | **0** |
| `cancel` | **0** |
| `end` | **0** |
| `notice` | **0** |
| `updateLease` | **0** |
| `withdrawFlag` | 1 |

### What that costs, in order

1. **Every tenancy is stuck on `pending`.** There is no way, anywhere in the
   product, to say the tenant moved in.
2. **No rent reminder can ever fire.** `rent.service.ts` selects
   `tenancy: { status: 'active' }`. There are no active tenancies, so the
   reminder job has nothing to find — and the rent screen is describing a
   tenancy that never began. That is what reads as confusing, and it is.
3. **No review can ever be written.** Reviews open when a tenancy is `end`ed.
4. **Notice cannot be given**, so the renewal and move-out paths are unreachable
   too.

This is the same shape as `assignRooms` (§19) and `sponsoredUntil` before
it: a complete, correct, tested backend with no way in. It is the largest
instance found so far, because it is not one control — it is the whole middle of
the product's life cycle.

### ✅ Fixed in v1.108.0 (Phase 8c) — the three that mattered

`app-tenancy-lifecycle` on the landlord dashboard, the tenant dashboard and the
tenant rent screen. One component for both sides, because either party may act
and two components would be the copy that misses the next fix.

| Action | Before | Now |
|---|---|---|
| `confirmStart` | 0 | **1** |
| `cancel` | 0 | **1** |
| `end` | 0 | **1** |
| `notice` | 0 | **0** 🔴 |
| `updateLease` | 0 | **0** 🔴 |

So a tenancy becomes `active`, **the rent reminder query can see it at all**,
and ending it opens the 30-day review window. Driven from both sides and
falsified by removing the mount, which reproduces the shipped state exactly:
*"the landlord is NOT asked about it on their dashboard — so no tenancy can
become active, no rent reminder can fire, no review can open."*

### 🔴 Still with no UI

- **`POST /api/tenancies/:id/notice`** — giving notice to leave. `withdrawNotice`
  has a caller; the thing it withdraws cannot be given. A landlord or tenant can
  only end a tenancy outright, with no notice period recorded first.
- **`PATCH /api/tenancies/:id/lease`** — the agreed lease terms (fixed end date,
  escalation). `Tenancy.leaseEndDate` is therefore always null, which is why the
  renewal reminder has nothing to fire on.

Both are smaller than what was fixed, and neither blocks rent or reviews. They
are the remainder of this section, not a new one.

### What was deliberately not fixed in Phase 8b

Phase 8b was the walkthrough and the first-use hints, and this needs its own
phase with its own drives. ⚠️ **It also changed what Phase 8b could honestly
say**: the walkthrough's standing rule is that no step describes something the
app cannot do, so there is no tour step about confirming a move-in, and the
tenant rent hint says only what is true today — the landlord keeps the record,
the tenant can answer a month, and neither overwrites the other.

**Not a money question.** Confirming that somebody moved in is not confirming
that money changed hands, and `confirm-start` already exists and already lets
either party do it. Building the screen for it does not touch rent custody,
deposits or the execution of a document.

---

## 19. ✅ A room could be taken out of a property but never put back

The owner, twice in one list: *"I listed a room that is not in a grouped
property, but now I want to add it to a property — it doesn't work, or can't add
it to a property."*

`POST /api/properties/:id/rooms` — *"Move rooms into this yard"* — has existed
since Phase 7b, with ownership checked as a set so a wrong id fails the call
rather than being silently dropped. `assignRooms` was wired into
`properties.service.ts` on the client. **Nothing called it.**

⚠️ **And `unassignRoom` had a caller.** So the product shipped a one-way door: a
room could be taken *out* of a property and never put back. That asymmetry is
why it reads as broken rather than missing — a landlord who removes a room by
accident cannot undo it.

**Fixed in v1.109.0 (Phase 8d).** On the property screen: *"Add a room you have
already listed (2 not in a property)"*, the loose rooms as 44px rows rather than
13px tick boxes, and a button that names how many will move. The list comes from
the `ungrouped` group the dashboard payload has carried all along — a second
request for a list the client already holds is a second thing to keep in sync.

| | Before | Now |
|---|---|---|
| `assignRooms` | 0 callers | **1** |
| `unassignRoom` | 1 | 1 |

Falsified by removing the section, which reports the shipped state in those
words: *"there is no way to add an existing room to a property — a room could be
taken OUT of a property and never put back."*

### And the button that looked broken

*"When I click add first property it should scroll down."* `startCreate()` set a
signal and stopped. The form renders below the rent-reminder section — **1159px
down a 780px screen**, measured — so the button scrolled nothing and revealed
nothing.

⚠️ The check that would have passed throughout is "the form is in the DOM",
because it always was. The drive asserts its position in the viewport instead,
and falsifying it prints the 1159px.

---

## 20. ✅ `:where(button)` nowrap — fixed where it bit, and now swept app-wide

Right for a button holding a short label. Wrong for one used as a **row or a
card**, because `white-space` inherits: every piece of text inside such a button
is pinned to one line.

Found as the owner's report that *"the description of the room is not moving to
the next line"* in the messages list. `.msg-row__head` is a `<button>` wrapping
the whole row, so at 360px the room title wanted **502px in a 300px column**, the
message preview **993px**, and the document was **1012px wide in a 360px
viewport** — horizontal page scroll and "a single line hundreds of characters
wide", both on the mobile checklist in CLAUDE.md, from one inherited declaration.

⚠️ `font: inherit` does **not** reset it. `font` is family, size, weight, style,
variant and line-height, and nothing else — the same lesson this exact element
had already learned once about `color`.

**Fixed where it bit** (`.msg-row__head { white-space: normal }`, v1.110.0).
Zero specificity means a plain class wins, so one declaration is the whole fix.

### ✅ Swept in v1.111.0 (Phase 8f)

`layout-ui-drive` section 10 walks every screen it visits, at 360 / 390 / 768 /
1280, and fails on any **leaf** whose `scrollWidth` exceeds its `clientWidth` —
text that cannot wrap. Ten screens, including the dashboard, my properties,
messages and all applicants.

⚠️ A bounding-box sweep **cannot see this**. Every element's
`getBoundingClientRect()` sat inside the viewport; the overflow exists only in
the scroll measurement. Every other section of that drive measures boxes, which
is why all of them passed over it.

**Leaves only, and that is a correction.** The first version flagged any element
wider than its box and reported `app-ad-slot 332>328` on the board — a
deliberate full-bleed (`.filter-panel .ad-slot` carries `margin: 0 -.25rem` so
an advert reaches the edges of the sheet). A designed bleed always reads as
overflow, and a check that cries wolf on a deliberate layout is one people learn
to skim. A leaf has no element children, so its overflow is its own text, and no
bleed can produce it.

**One screen was found clean because it was empty.** The sweep reported
`/account/messages` fine with the bug reintroduced: this drive's landlord had no
conversations. It now writes a message, with a long room title and a long body —
a short one wraps by accident and proves nothing — and every page must present
at least five pieces of text or the check fails as "nothing was really
measured".

Falsified: with the fix reverted it reports `span.preview 993>303` and
`p.msg-row__room 537>303` at 360 and 390, and still catches the preview at 1280
where the page does not scroll at all.

---

## 21. Google sign-in: the button is gone, the integration is not

The owner is not paying for it, so "Continue with Google" was removed from the
login screen in v1.112.0 (Phase 8g).

**Deliberately still in place:**

- `GET /api/auth/google` and `/api/auth/google/callback`;
- `GoogleStrategy` and its passport registration;
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in the environment.

An account that signed up through Google still exists, and a callback already in
flight must not meet a 404. Nothing links to the route any more, so nothing new
can start down it.

⚠️ **Removing the code does not stop the billing.** Whatever is being paid for
sits in Google Cloud — the OAuth client and whatever project it belongs to — and
that is a change in their console, not in this repository. Deleting the route
here without doing that would cost the same and break the people still on it.

**Before deleting the rest**, check whether anybody is actually on it:

```sql
SELECT count(*) FROM users WHERE "authProvider" = 'google';
SELECT count(*) FROM users WHERE "authProvider" = 'google' AND "passwordHash" IS NULL;
```

The second number is the one that matters: those accounts have no password yet.
They are not stranded — "Email me a sign-in link" never gated on a password, and
since v1.112.0 "forgot password" issues them a real reset token instead of the
old "you sign in with Google" email, which after this change pointed at a door
that no longer exists. Once that number is zero, the route, the strategy and the
two secrets can go together.

---

## 22. ✅ A button nobody could read, and the gate that could not see it

v1.113.0 (Phase 8h). Reported from a phone as *"the first use hints just has a
big button with no text or instructions"*. The hint panel rendered its heading
and its sentence perfectly; its only control was an empty white box.

Measured: `color: rgb(255,255,255)` on `background: rgb(255,255,255)` — **1.00:1**.
The word "Got it" was in the DOM the whole time.

The cause is this codebase's oldest CSS fault, written down twice already:

```scss
:where(button) { color: #fff; background: $color-terracotta; }   // zero specificity
.hint__close   { background: #fff; /* …and no color */ }          // wins the background only
```

`font: inherit` does not save it — the shorthand resets family, size, weight,
style, variant and line-height, and never colour. `_spec.scss` carries the same
note on `.yard-rent__actions button` ("`color` is explicit, not inherited"), and
`.btn-link` in §17 above is the third instance in one release.
**Setting a background without setting a foreground is the defect; they are one
decision.**

### What matters more: the contrast gate could not see it

`a11y-drive.mjs` visits ten screens that render this hint and prints
*"✅ contrast: every visible text node meets its WCAG threshold"* on each. It
was not lying about what it measured — axe does **not** report text the same
colour as its background as a violation. It buckets it as `incomplete` with
`messageKey: 'equalRatio'`, on the theory that identical colours usually mean a
background image or gradient it could not resolve, so a human should look.
The drive read `run.violations` only.

So the single worst contrast failure there is — text that cannot be seen at all
— was the one case the gate was structurally incapable of seeing.

The drive now promotes `equalRatio` incompletes to failures. Only that one
reason: the others really are "axe could not tell" (text over an image, a
gradient, a video), and failing those would make the gate red on things it has
not measured.

Falsified: with the colour removed it reports
`.hint__close — 1:1, needs 4.5:1  #ffffff on #ffffff` on ten screens. Before
the change, the same run printed a tick on all ten.

⚠️ The drive's hover/focus pass **did** catch it, and reported a resting-state
fault under the labels `:hover` and `:focus` — which sent the first look at it
in the wrong direction.

---

## 23. ✅ The tenant dashboard could not tell an acceptance from a move-in

v1.113.0 (Phase 8h). Reported as: *"in the dashboard page if say I have clicked
moved in, the needs you section — shouldn't the 'you have been accepted talk to
the landlord' message be removed because I have already spoken to the landlord
and moved in?"*

An `Application` stays `accepted` for good. The move-in is a `Tenancy`, which
Phase 8c finally gave a screen to — and **nothing on the tenant's dashboard had
ever read one**. So after agreeing a date, moving in and confirming it, a tenant
saw:

- at the top of "Needs you", at urgency `-2000`: *"You have been accepted — talk
  to the landlord about moving in"*, for the whole duration of the tenancy;
- below it, the room filed under "Your applications" with the standing subtitle
  *"Live — you're waiting on the landlord"*.

Three statements, all false, about the place they were sitting in.

**Fixed:** `tenant-inbox.service.ts` reads the tenancy; `GET /applications/mine`
returns `tenancy: { status, startDate }`; the dashboard gained a **"Where you
live now"** section and a derived sentence under "Your applications" in place of
the hardcoded one.

### The wrong first fix, and what caught it

The first version gave the unconfirmed state its own kind, `tenancy_unconfirmed`,
with its own row. `dashboard-ui-drive` failed on it — because **accepting opens
a `pending` tenancy in the same transaction**, so "accepted with no tenancy" is
a state this product never reaches. The acceptance row would never have
rendered, and the new kind was a branch nothing could run: the exact fault class
this document exists for, introduced while fixing an instance of it.

One row now carries both outstanding things ("agree a date, then record the day
you move in"), and its action points at the lifecycle panel — which Phase 8c
had mounted with **no `id`**, so nothing could link to it. It has one now
(`#moving-in-out`).

---

## 24. ✅ A nav tab that pointed at an element that did not exist

v1.113.0 (Phase 8h). Reported as *"the needs you page looks exactly the same as
the dashboard page, nothing happens when I click the needs you tab"*.

`landlordNav` has carried `{ label: 'Needs you', fragment: 'needs-attention' }`
since Phase 7a. `landlord-inbox` renders nothing when nothing needs doing —
deliberately, and the reasoning is good: an empty queue that still draws the eye
is how people learn to ignore a queue.

Each decision is defensible. Together they made a dead control: for every
landlord who was on top of their work the tab pointed at an element that did not
exist. Measured before the fix — `hasAnchor: false`, `scrollY` 0 before the
click and 0 after.

The nav file's own comment says a fragment exists because *"without it they
navigate to the dashboard root, which from the dashboard is indistinguishable
from a click that did nothing"*. The fault it names was three lines below it.

**Fixed:** the section renders when the fragment asks for it, saying in words
that nothing is waiting — and still renders nothing on an ordinary dashboard
visit. It scrolls itself into view rather than relying on the router's
`anchorScrolling`, which looks for the element once, at NavigationEnd, when this
section does not exist yet because the inbox request has not come back.

`#active-listings` and `#drafts` are unconditional sections and were never
affected.

---

## 25. ✅ A signed-in account on a phone had no way back to its own portal

v1.113.0 (Phase 8h). Reported as *"when I click the browse rooms button I can't
go back to the dashboard without opening the burger menu — that's too much
friction and bad UX"*.

`.nav-inner.is-signed-in .nav-actions .btn-ghost { display: none }` at ≤480px
hid **every** ghost action a signed-in account had. For a landlord that was
Dashboard and Log out; for a **tenant**, whose only two actions are Dashboard
and Log out, it was all of them — so a signed-in tenant on any public page saw a
header holding a logo and a burger.

Dashboard now stays (`:not(.nav-home)`); Log out moves into the drawer, which is
the right half to lose.

⚠️ **Keeping it cost 21px of horizontal scroll at 360px** for a landlord, who
also carries "+ List a room": the budget beside an 80px logo, a 44px burger and
27px of inner padding is about 193px, and the two buttons came to 227px. The
signed-in header is now tightened the same way the visitor's already was. A
tenant has one action and fitted with room to spare — which is exactly how this
would have shipped unnoticed.

The check that should have caught the original fault passed for four releases,
because of what it says rather than what it does: *"signed in, the phone header
is not asked to carry Dashboard, List a room AND Log out"* only ever looked for
Log out. `nav-ui-drive` now measures **both roles at 360, 390 and 768**, asserts
one visible route into the portal with the drawer shut, 44px, no horizontal
scroll — and **clicks it**.

---

## 26. A drive had been auditing the wrong screen since v1.87.0

v1.113.0 (Phase 8h), found while extending `lease-docs-ui-drive.mjs`.

Phase 7b turned `/landlord/yard` into a redirect to `/landlord/properties` (the
list) and moved the yard component to `/landlord/properties/:propertyId` (the
detail). This drive kept going to the old path, so its **entire landlord half**
— eleven checks about the paperwork panel — had been auditing a list of property
cards for a toggle that only exists on the detail screen.

It also never created a property, and a room can sit in none, so even the right
URL would have shown it the teaching empty state.

Both fixed. Two other places in this repo already carry a comment about that
redirect dropping a fragment; nothing had ever checked that a drive still
arrived where it thought it did.

### Two more found by looking, in the same sitting

- **`lease-ui-drive.mjs`** — same cause, and it was **red right now**. Its first
  check, *"no card when nothing is ending"*, passed because `#ending-soon` can
  never be on a list of property cards; the four after it failed. A drive that
  is red for a structural reason teaches people to ignore it being red. It now
  goes to the detail screen, groups its rooms, and — the part worth keeping —
  asserts that the screen the card is **absent from** is the yard, so the
  absence proves something.
- **`phase-drive.mjs`** — two faults, neither to do with the redirect. Its
  selector still named the Phase 7b copy ("+ Group rooms into a yard"), so it
  reported *"the yard screen offers a way to add one"* as a FAILURE against a
  screen whose entire job is offering that. And Province became a `<select>`;
  `fill()` on a select throws after thirty seconds, **crashing the drive before
  its summary** rather than failing a check. Both fixed; 52/52 pass.

`properties-ui-drive.mjs` goes to `/landlord/yard` deliberately, to assert the
redirect, and is correct as it stands.

**The pattern, three times in one sitting:** a check anchored on remembered copy
fails on a rename and blames the product; a check anchored on a moved URL passes
on the wrong page and proves nothing. Both read as the product being wrong.

---

## 27. WhatsApp: the sign-in code can now be sent, and four other paths still cannot

v1.114.0 (Phase 8i). Row 40 of `PRE-LAUNCH-CHECKLIST.md` has recorded since
Phase 0 that every outbound WhatsApp message is free-form `type: 'text'`, and
that Meta permits that **only inside the 24-hour customer service window** —
within 24 hours of the person messaging the business. A business-initiated
message outside that window is rejected with **error 131047** unless it uses a
pre-approved template.

Recording it is not the same as being able to see it. Nothing in this
repository had ever observed a single outbound WhatsApp body: the only way to
look was to configure live Meta credentials and send a real message to a real
phone, so every send path here was written from documentation and never checked
against anything.

### What changed

- `buildOtpSend()` is exported and pure, so the body can be asserted without
  Meta, a network, or a running API.
- `sendOtp` sends an **AUTHENTICATION template** when `WHATSAPP_TEMPLATE_OTP` is
  set, and free-form text when it is not.
- `WHATSAPP_GRAPH_BASE_URL` exists for one reason: `whatsapp-template-drive.mjs`
  points the client at a stub and reads what we actually put on the wire. An
  operator never sets it.
- **Credentials with no template now warn at boot**, naming 131047. That is the
  state that looks configured and delivers nothing, and before this the code had
  no notion of a template at all, so it could not say so.

### The text branch is not a lesser fallback

Against real credentials it does not deliver **at all**. It stays because it is
right in development, where nothing is sent and the code is logged, and because
an operator mid-setup should see Meta's own error rather than a silent no-op.

### What is still broken, and why it is survivable

Four paths remain free-form text and still fail outside the window. Each
degrades honestly rather than breaking, which is why they are listed rather than
fixed in the same phase — each needs its own **UTILITY** template and its own
Meta approval:

| Path | What it is | What happens outside the window |
|---|---|---|
| `notifyLandlord` | a tenant applied, or wrote | returns null; the email still goes |
| `sendToNumber` (rent) | a rent reminder | returns false; the landlord's own record is unaffected |
| `sendToNumber` (references) | asking a previous landlord | returns false; falls back to an admin phoning |
| `sendToNumber` (notices) | a notice to a phone-only account | the `Notice` row is written first and `whatsappError` records the reason |

The notice router already wrote that reason in words before this phase —
"Most likely outside the 24-hour window with no approved template" — which is
the one place the product had already admitted this out loud.

The **listing bot's replies are genuinely fine**: the landlord messaged us
first, so they are inside the window by construction. That is the only
free-form send here that was ever correct.

### What a green drive does NOT mean

`scripts/whatsapp-template-drive.mjs` proves the **shape**, not the approval.
A template name Meta has not approved produces a correctly-shaped request that
Meta rejects with **132001**, and nothing in this repository can tell the
difference. Section 4 of the drive prints that on screen rather than letting a
green run read as "WhatsApp works". **No message has ever been delivered from
this repository to a real handset.**

⚠️ `name + language` is the identity of a template. Sending `en_US` to one
approved as `en` fails with 132001, which reads like a typo in the name and is
not one. Hence `WHATSAPP_TEMPLATE_LANG`, separate and documented.

⚠️ `ttlMinutes` is deliberately **absent** from the template payload. The expiry
is baked into the template's footer at approval time
(`code_expiration_minutes`), so Meta already holds it; sending it too would be a
second source of truth that can disagree with the first. The TTL the API quotes
in its reply ("expires in 10 minutes") and the one on the approved template are
**not linked by anything**, and a mismatch would be invisible — a real gap,
named here rather than papered over.

---

## 28. ✅ A drive died mid-run on its own rate-limiter check

v1.114.0 (Phase 8i), found while regression-testing §27 and **pre-existing** —
it fails identically at HEAD, which is how it was told apart from the WhatsApp
work rather than assumed to be.

`phone-signup-drive.mjs` has a section that deliberately provokes a 429, to
prove the throttler is not decoration. Nest closes the connection when it
answers 429; Node's `fetch` keeps connections alive and reuses them, so the next
call picked up a socket the server had already finished with and failed with
`SocketError: other side closed`.

That is a **thrown TypeError, not a status**, so it took the whole drive down
nine checks in. `curl` over the same 26 requests answers 200×15 then 429×11 with
the API healthy throughout, which is what proved it was the client and not the
product.

A drive that dies mid-run reports neither a pass nor a failure. It reports
nothing, which is worse than either.

`apiCall` in `scripts/lib/drive-session.mjs` now retries **once**, and only when
fetch threw with a connection-level cause — never on an HTTP status. Retrying a
429 or a 500 would paper over exactly the thing a drive exists to find. The
drive now completes: 17 checks, green.

---

## 29. ✅ WhatsApp switched off — one flag, nothing deleted

v1.115.0 (Phase 8j). The owner's decision, once the cost was on the table:
*"for now we don't need a sign in code and everything that uses WhatsApp needs
to be removed and reserved for later stages when we can pay for these costs."*

Meta bills **per message**. An authentication message to a South African number
is about **USD $0.0095 + VAT**, from the first one, with **no free allowance** —
the 1,000-a-month free tier is service messages only. On a product that is free
to list and free to apply, that is a per-head cost with no revenue behind it.

### Removed, or switched off?

Switched off. `WHATSAPP_ENABLED` defaults to false — including when the line is
missing entirely — and nothing was deleted. Deleting 1,000 lines of working
code (the listing bot, the parser, the webhook, the signature verification, the
landlord opt-in) and rebuilding it in six months is waste, and the owner's own
words were "reserved for later stages".

Two decisions were put to the owner rather than assumed, because both change
who can use the product:

1. **Phone-only accounts.** `sendOtp` is the *only* delivery for a phone code —
   there is no SMS provider, and even **assisted sign-up**, where an admin sits
   with a landlord, sends the code over WhatsApp and deliberately does not
   return it in the response. So switching the channel off closes sign-up,
   sign-in, number change and lost-number recovery for anybody with no email
   address, and `User.email` is nullable precisely because, in the schema's own
   words, *"many township landlords are WhatsApp-first and do not use email at
   all."* Chosen: **keep the flows, disable delivery**, and say so on screen.
2. **The free links.** `wa.me` opens the person's own WhatsApp and Meta bills
   nobody. Sharing a room and tapping "WhatsApp" on a plumber are free
   distribution in this market. Chosen: **keep them**, and a drive now guards
   them against a later over-eager sweep.

### What the switch does

| | While `WHATSAPP_ENABLED` is false |
|---|---|
| `sendOtp` | **throws** — a silently unsent sign-in code leaves somebody watching a handset |
| `sendToNumber` | returns false; every caller already had another route |
| `notifyLandlord` | returns null; the email still goes |
| Webhook handshake | refused, so it cannot be registered against a deployment that will not answer |
| Inbound deliveries | ignored — acting on one means *replying*, which is billable |
| Phone sign-in / sign-up / verify / change | **503**, naming email as the way in |
| Lost-number recovery | **503** before the row is marked approved |
| Rent reminder pass | does not run at all |
| `wa.me` links | untouched |

### Two things that would have gone wrong quietly

- **The rent reminder would have lied in the database.** `reminderSentAt` is
  stamped on every candidate whether or not the send succeeded, and that stamp
  is what excludes a period from the next pass. With the channel off, every
  unpaid month would have been marked as reminded while nothing was sent — and
  would then **never be reminded again, including after WhatsApp came back**. A
  silent permanent hole, created by a feature flag. The pass now returns before
  the loop.
- **The notices screen would have accused itself.** `sendToNumber` returning
  false makes the notice router write *"WhatsApp declined the message. Most
  likely outside the 24-hour window with no approved template"*, which the
  notices screen renders as "WhatsApp could not deliver this one" — against
  every notice ever written, with a reason that is false, because nothing was
  declined and nothing was sent. The router now returns before the attempt, so
  the column stays null, which is the distinction it exists to preserve.

### The refusal is before the code, not after

Every guarded entry point refuses **before** a code is issued. Issuing one that
cannot be delivered still burns the per-number code budget, still writes a row,
and still leaves a person watching a handset — a control that looks like it
works, which is this codebase's oldest defect.

### Proof

`scripts/whatsapp-off-drive.mjs` runs the API against a **stub Cloud API**: any
request reaching that stub is a request that would have reached Meta and been
billed. ⚠️ It runs with credentials and a template name **set** — proving
nothing is sent when nothing is configured proves nothing, since it was never
going to send. Falsified: with the gates removed, a real billable template
message lands on the stub and the drive prints the payload.

It also asserts the frontend flag agrees with the API, because the dangerous
drift is frontend-on/API-off: a button that looks like it works.

`otp-drive` and `phone-signup-drive` now **stop loudly** when they meet the
503, naming which drive covers which state, and exit 0 — a deliberate decision
should not make a suite run red, and a skip presented as a pass is the defect
this file exists for.

`smoke-test.sh` asserts **both** states, and keeps the no-enumeration guarantee
inside the off state: a 503 for an unknown number and a 200 for a known one
would leak exactly what the neutral message exists to hide.

### ⚠️ Deferred, not abandoned — and the open consequence

The owner's words, recorded because an off switch left alone for six months
starts to look like a decision nobody remembers making:

> *"WhatsApp-first is still a goal, but since we can't afford it at the moment
> we will use it once it's feasible for us to do so."*

So this is **paused work**. Do not delete the WhatsApp code to tidy up, and do
not quietly design around its absence as though the channel were never coming.
`CLAUDE.md` carries the short version so every future session reads it.

**The gap that is open right now:** a person with **no email address has no way
in at all.** `User.email` is nullable precisely for the WhatsApp-first landlord
the product is built for, and `sendOtp` is the only delivery there has ever
been for a phone code — no SMS provider, and even assisted sign-up goes over
WhatsApp. Today such a person needs somebody to put an email on their account
by hand.

That is accepted for now and it is not free. Three ways out, when it matters
more than it costs:

1. **Turn WhatsApp back on** — the intended answer, and the cheapest per
   message of the three.
2. **An admin-read code for assisted sign-up.** `requestCodeAssisted`
   deliberately does not return the code in its response, which is the right
   call against a compromised admin account but is also what makes the
   in-person path impossible with the channel off. A deliberate, audited
   admin-only variant would close the gap for nothing per head — and would need
   thinking about carefully, because it is a way to create an account for
   somebody else.
3. **SMS.** Works, and costs roughly R0.20–0.40 a message in South Africa —
   the same or worse than WhatsApp authentication, plus a new integration. No
   saving, so no reason, unless deliverability turns out to differ.

### Turning it back on

`docs/WHATSAPP-SETUP.md` §0. Both flags, API first, and an approved
AUTHENTICATION template before any of it delivers (§27).

---

## 30. The rent ledger did not know whether the letting was still running

**Phase A of the tenancy-lifecycle work. Fixed, with two exceptions recorded
below that are deliberately still open.**

### What was wrong

`Tenancy.end()` writes four columns on one row — `status`, `endDate`,
`endedById`, `reviewsCloseAt` — and that is the entire effect of a tenancy
ending. Nothing downstream read them. Three consequences on the rent path:

- **`RentService.mark()` refused `cancelled` and nothing else.** So a landlord
  could record rent against a tenancy that finished two years ago, against a
  month before the tenant moved in, or against next March. `upsert` created the
  row, with `amountCents` snapshotted off a tenancy that was not running.
- **`dispute()` checked the period's own status and never the tenancy's.**
- **`history()` answered a bare `RentPeriod[]`.** A caller holding a rent ledger
  had no way to tell a finished letting from a running one, so the tenant's rent
  screen rendered an ended tenancy exactly like a current one: present-tense
  heading, a `/mo` rent figure, live actions. Reported by the owner.

### The invariant, which is not "the tenancy is active"

A rent period belongs to **the months the tenancy actually covered**. That is
as true of a finished letting as a live one, and the distinction matters:
refusing every write on an `ended` tenancy would break the most ordinary thing
in this product — a tenant moves out on the 30th owing that month, and the
landlord records it on the 5th. Freezing the ledger at move-out makes the record
wrong in the one case it is most needed.

So `assertRentWindow` bounds the months and does not freeze the record:

| | |
|---|---|
| `cancelled` | refused — the letting never ran |
| `pending`, or no `startDate` | refused, naming the move-in. The tenant's rent screen has always said this; the API accepted the write anyway |
| before the start month | refused |
| after the current month | refused — the month has not begun |
| after the end month, once ended | refused |
| **inside the window, even once ended** | **accepted** |

`dispute()` is deliberately **not** bounded by that window. The most
consequential mark a tenant ever receives is the final month, entered after
they moved out, and `TenancyFlag.unpaid_rent` can be raised off it. Taking
their answer away at exactly that moment would leave the landlord's unverified
word as the only record.

### Still open — a tenant cannot give notice

`tenancies.controller.ts` documented `POST /tenancies/:id/notice` as *"Record
that notice was given, by either side"*, and `LeaseService.giveNotice` calls
`assertLandlordOwns`, so a tenant gets a 403. A documented capability the code
refuses — the same shape as the `@Throttle` decorators with no guard and the
`documentDeletedAt` that deleted nothing.

**The summary is corrected rather than the guard relaxed, and that is a
decision, not a shortcut.** Admitting the tenant needs one column this model
does not have. `noticeGivenById` records who notice is *attributed to*, not who
entered it, so there is no way to distinguish a landlord's record of a tenant's
verbal notice from a tenant's own act — and therefore no safe rule for who may
withdraw it. Letting a landlord clear a tenant's notice resets a countdown that
frees a room; letting a tenant clear a landlord's does the same in reverse.

**What it needs:** `Tenancy.noticeRecordedById`, then the tenant route, with
withdrawal restricted to whoever entered it. Phase B/G of
`docs/TENANCY-LIFECYCLE-AUDIT.md`.

### Still open — a tenancy is opened fire-and-forget

`ApplicationsService.accept` calls
`this.tenancies.createFromApplication(applicationId).catch(...)` — deliberately
not awaited, so a failure there cannot fail the acceptance. Defensible, and
nothing retries: if that call throws, the application is `accepted` and no
tenancy exists, which no screen and no job would ever notice.

It also made the drive flaky. `tenancy-lifecycle-drive.mjs` read the row with a
bare query straight after accept and intermittently reported *"accepting opens
a tenancy, and it starts 'pending' (got '')"* — which reads exactly like a
broken accept flow and is not one. The drive now polls (`tenancyFor`). **The
flake is fixed; the fire-and-forget is not.**

### What the first pass got wrong — found by review, not by any check here

Phase A shipped green: the drive passed 57 checks, the smoke suite passed, both
typechecks were clean and `ng build --configuration=production` succeeded. A
code review then found seven defects. Six are worth recording because each one
is a shape this codebase keeps producing.

**1. A runtime crash on the landlord's property screen.** The rent endpoint has
**two** consumers — `RentService.history` for the tenant's screen and
`PropertiesService.rentHistory` for the yard — and only the first was migrated
to the envelope. The generic on `http.get` is an **unchecked cast**, so
declaring `RentPeriod[]` over a response that is now an object passes `tsc` and
`ng build` without complaint. `loadRent` put the envelope into the `rent`
signal and `currentLabel(periods)` called `.find` on it: a TypeError on a screen
every landlord uses.

Fixed by declaring `RentLedger` **once**, in `core/models/property.model.ts`
beside the `RentPeriod` it carries, imported by both services. Adding the shared
type made the yard an immediate compile error, which is the point.

**⚠️ And the check that was supposed to cover this could not.** A new section in
`yard-layout-drive.mjs` opens the rent panel and reads the rendered label. Three
of its five checks stay **green** with the bug reintroduced:

| | |
|---|---|
| a `pageerror` listener | green — Angular catches a template expression's error and logs it, so it never reaches `window.onerror` |
| the Paid / Not yet toggle renders | green — the `@if (rent()[id]; as periods)` guard passes, because **an object is truthy** |
| the rendered label reads "paid" | **red** — the only visible trace |

Measured: reintroducing it gives 2 failed, 39 passed, and both failures are the
content checks. A drive that watched for errors and counted controls would have
called this screen healthy.

**2. An unrecoverable lockout.** `LeaseService.updateTerms` wrote
`startDate: null` on request, including for an `active` tenancy. Harmless until
the rent window started reading `startDate` — then `mark()` answers "Confirm the
move-in first" while `confirmStart()` refuses because the tenancy is already
active. Neither route can put the date back. It is also untrue: `confirmStart`
sets status and startDate in one update, so a live tenancy that started on no
particular day is a state the product cannot otherwise reach. `updateTerms` now
refuses to clear it, and refuses a future date on an active tenancy, as
`confirmStart` does.

**3. Three drives were fabricating an impossible tenancy.**
`account-lifecycle-drive`, `dashboard-drive` and `dashboard-ui-drive` each force
`UPDATE tenancies SET status='active'` in raw SQL and left `startDate` null —
a row the API cannot produce. The guard exposed the fabrication; the drives were
what was wrong, and they now set both columns.

**4. A check that could no longer fail.** `inbox-drive.mjs` read
`(periods.body || [])[0]` — indexing the envelope object, so `period` was always
undefined and the entire `if (period)` block (the tenant disputes a month,
`rent_disputed` sorts to the top) was **silently skipped with no `bad()`**. It
now reads `.periods` and says so when there is nothing to dispute.

**5. A pre-existing impossible expectation.** `dashboard-drive` asked one
tenant's inbox for `application_accepted` **and** `rent_unrecorded`. Those are
mutually exclusive by construction: `tenant-inbox.service.ts` drops the
acceptance row for any tenancy that is not `pending`, while a rent item needs a
tenancy that has started. Both assertions were right about the product and
wrong about the fixture. Verified pre-existing — 2 failures before Phase A, 4
at Phase A, 2 again once the drives were fixed. The acceptance rule now has a
letting of its own, left pending, and tenantA additionally proves the row is
**gone** once the move is confirmed.

**6. A timezone trap in the new drive, of the kind its own comment warns
about.** Section 7 found a period with
`date_trunc('month', now() - interval '2 months')`: `now()` is `timestamptz`,
so `date_trunc` truncates in the **session's** timezone, while `periodStart` is
a `timestamp` at UTC midnight. Confirmed against Postgres — UTC gives
`2026-08-01 00:00:00+00`, `Pacific/Auckland` gives `2026-08-01 00:00:00+12`, and
the equality misses. It passed only because this container runs UTC. The month
now comes from the JS value already computed, with a `bad()` if nothing is
found, and the drive is green under both `TZ=UTC` and `TZ=Pacific/Auckland`.

### Proof

`scripts/tenancy-lifecycle-drive.mjs` section 7 — 18 checks. Then, as this
repo requires, each guard was reintroduced and the check confirmed to fail:

- window guards reverted to the shipped `cancelled`-only behaviour → **7 failed, 50 passed**
- `history()` reverted to a bare array → **3 failed, 54 passed**
- both restored → **57 passed**

The "still correctable once ended" check stays green under the first revert, by
construction: it tests the opposite direction, and anybody can write a guard
that refuses everything.

`scripts/smoke-test.sh` §46 carries the same three assertions against the API.

**Not proven:** nothing here reads the rent *screen*. The API refuses what it
should and accepts what it must; the tenant's rent page still presents an ended
tenancy as a current one. That is Phase D.

---

## 31. Pre-existing schema drift, kept out of a feature migration

**Open. Needs a migration of its own.**

`prisma migrate dev` generates five DROP INDEX / CREATE INDEX pairs on top of
whatever you asked for:

```
account_recoveries_status_createdAt_idx
phone_signups_assistedByAdminId_createdAt_idx
service_providers_lastCheckedAt_idx
users_deactivatedAt_idx
users_deletedAt_idx
```

They are **drift between the schema and the database**, not part of any current
work — confirmed by running `prisma migrate diff` with the pending schema
changes stashed, which emits the same five pairs on its own. Two of them differ
only by sort order: the database holds `"createdAt" DESC`, the schema declares
plain `createdAt`.

They were stripped out of `20261008095150_tenancy_archive_and_report_scope` by
hand. **Dropping and recreating an index on `users` is a real operation on the
busiest table in this database** — a lock, and a window with no index — and it
has no business riding along with a feature migration where nobody reviewing
that feature would think to question it.

**What this costs:** the next `prisma migrate dev` offers those five pairs
again, because the drift is still there. Expected. Do not fold them into
whatever you are working on either.

**What it needs:** one migration that does only this, with the two `DESC`
indexes either declared as `@@index([status, createdAt(sort: Desc)])` in the
schema or rebuilt ascending — a decision about whether those queries actually
read newest-first — and a runbook line, because two of the five are on `users`.

**Not urgent.** The drift costs nothing while it sits there; the indexes work.
It matters only in that it makes every future migration diff noisy, which is
how something real gets waved through.

---

## 32. The tenancy archive — Phase B

**Three columns, each with a writer. Fixed.**

### What was missing

`ended` was doing two jobs: "ended last week, reviews open, both parties still
acting on it" and "ended in 2024, read-only". They want different screens and
different permissions, and there was one value for both.

Separately, `Report` carried `roomId` and `reportedUserId` and nothing else, so
"what went wrong during this letting" could not be answered — a complaint by
one tenant about a room was indistinguishable from one by the next tenant two
lettings later, and `ReportReason` is full of tenancy-period claims
(`already_let`, `misleading_details`, `upfront_payment_demanded`).

### What landed

| Column | Written by |
|---|---|
| `Tenancy.archivedAt` | `ReviewsRelease.archiveClosed` once `reviewsCloseAt` passes; `TenanciesService.cancel` immediately |
| `Tenancy.noticeRecordedById` | `LeaseService.giveNotice`, from the caller |
| `Report.tenancyId` | `ReportsService.create`, only for a party to that tenancy |

**`archivedAt` is a column, not a derived `reviewsCloseAt < now()`.** Derived
state with many readers is how this codebase ended up with three navigation
definitions that disagreed, and the archive will have several readers. One
writer, one value.

**It is not a fifth `TenancyStatus`.** Archival is orthogonal to how a letting
finished; folding it in would make `cancelled` lose the reason it was cancelled
the moment it aged.

**Archiving runs on its own query, not as a field on the review release.**
`releaseClosedWindows` selects `reviews: { some: { publishedAt: null } }`, and
most tenancies never get a review — so hanging `archivedAt` off that query
would have archived only the minority that happened to have one held back. A
column set for some rows and not others is worse than no column.

**`cancelled` archives at once.** It never gets a `reviewsCloseAt` (the drive
asserts that), and the nightly pass waits for one, so it would have sat
unarchived forever: finished, but never reading as finished.

**Archived does NOT mean frozen.** A tenant may still answer a rent month on an
archived letting — see §30 for why that is the one write which has to outlive
the letting.

### A tenant can now give notice — §30's open item, closed

`noticeRecordedById` is what the tenant path waited on. `noticeGivenById` is who
notice is *attributed to*; this is who *entered* it. A landlord logging "my
tenant told me they are leaving" and a tenant giving notice produce the same
attribution and are not the same act — and without the distinction there was no
safe withdrawal rule, because a landlord who could clear a tenant's notice
could keep them on the books.

The rule is now: **whoever recorded it may withdraw it.** Rows written before
the column have none, and those were all entered by a landlord — the only
caller the route ever had — so a null reads as the landlord.

A landlord may record either side. **A tenant may only record their own**: a
tenant setting `givenBy: 'landlord'` would be fabricating that they had been
served notice to leave, which is a materially different fact.

### An operator route for the nightly pass

`POST /reviews/release-closed`, admin-only, mirroring
`POST /properties/rent/run-reminders`. The pass publishes reviews and sets
`archivedAt`, and **a cron nobody can trigger cannot be driven, checked after a
deploy, or re-run when it fails** — the only evidence it works is that nobody
has complained, which is how this codebase ended up with a rent-reminder
control on a screen with no route. Admin-only because it publishes ratings, and
that is not a button for a landlord with an opinion about a tenant's review.

It returns `{ archived, released }` even when both are 0, rather than a bare
`return`: an operator running it after a deploy needs to see "0 and 0" and know
it ran.

### Two things the drive caught that the code had wrong

**`POST /tenancies/:id/notice` answered 201 while its own withdraw answered
200.** Every other lifecycle route here — `confirm-start`, `cancel`, `end`,
`notice/withdraw` — carries `@HttpCode(OK)`. Giving notice is a state change on
an existing tenancy, not a creation. Fixed on the route; and the drive's check
was tightened from `200 || 201` to exactly 200, because **the tolerance is what
let it drift in the first place.**

**`ReportReason` and `TenancyFlagReason` overlap but are not the same enum.**
`room_not_as_described` is a flag reason, not a report reason. Small trap, cost
one red check.

### Proof

`scripts/tenancy-lifecycle-drive.mjs` section 8 — 17 checks, 74 in the file.
All five behaviours were then reintroduced at once and confirmed to fail:

| Reverted | Result |
|---|---|
| `cancel()` no longer archives | ❌ `archivedAt` reads `f` |
| the nightly pass no longer archives | ❌ and `{"archived":0}` |
| withdrawal open to either party | ❌ landlord cleared the tenant's notice (200, want 403) |
| a tenant may claim the landlord served notice | ❌ 201, want 400 |
| reports accept any `tenancyId` | ❌ a stranger attached one (201, want 403) |

**8 red, 66 passed. Restored: 74 passed.**

`scripts/smoke-test.sh` carries the four notice assertions. `migration-preflight`
clean — and it correctly refused the run first, because only `DATABASE_URL` was
exported and not `DIRECT_URL`: the exact trap that kept production down for an
extra hour on 5 October (§5a). The gate works.

### Not proven

**No screen reads `archivedAt`.** The column is written and nothing renders it —
the archive view is Phase F. Until then this is a column with one writer and no
readers, which is half of the defect this repository keeps producing, and it is
recorded here rather than implied away.

**`Report.tenancyId` is not backfilled and never will be.** Inferring which
letting a historical report belonged to from a room id and a date would
manufacture facts about a complaint, and a complaint attached to the wrong
tenancy is worse than one attached to none. Historical rows stay null and the
archive has to say so on screen.

---

## 33. Ending a letting now tells both parties — Phase C

**Fixed, with one gap named below rather than implied away.**

### What was wrong

`end()` wrote four columns on one row and that was the entire effect of a
tenancy ending.

- **The room stayed `let` indefinitely.** Off the public board
  (`rooms.service` filters `status: 'active'`), out of the sitemap, with
  nothing telling the landlord to relist.
- **A letting that FELL THROUGH did the same.** Accepting sets the room `let`;
  nothing set it back. So a room **nobody ever moved into** went invisible for
  good, and the landlord had to find "relist" themselves.
- **32 `Notice.kind` values existed and not one was for a letting starting or
  ending.** The biggest event in the lifecycle logged a console line and
  produced nothing a person could read. A tenant learned their review window
  had opened only by happening to open the dashboard inside 30 days.

### What it does now

`tenancy_ended` to **both** parties, worded for who actually did it — a notice
that tells somebody about their own action reads as a system not paying
attention — and naming the 30-day review window, because a notice that omits
it costs somebody their review.

`room_needs_relisting` to the landlord, **and only while the room is still
`let`**. One who has already paused, removed or relisted it has said something
more recent, and overwriting that would be the code deciding it knows better.

**A prompt, not an automatic relist, and that is a product decision.**
`relist()` republishes the room with its old photos, its old price and its old
description on the day a tenant moves out, and it archives every open
application and increments `relistCount`. Destructive, and not asked for.
Whether to let the room again, and at what rent, is the landlord's. But a room
going quietly invisible is not an option either — so: one notice, with the
room's own screen on the end of it.

**A cancelled letting frees the room at once**, straight to `active` rather
than through `relist()`. There is nothing to archive: `autoRejectOthers`
rejected the other applicants when this one was accepted and they stay
rejected, which is what actually happened. This is the shape of `undoLet` —
the room simply was not let.

`closureReason` no longer reads *"This tenancy ended and the room has been
relisted."* `archivedAt` is set by a relist and nothing else, so that branch is
reached whenever a landlord relists a room they had let to this person — after
a tenancy ended, after one that fell through, or after a letting never
recorded. It asserted the first of three as fact. It now says what is true in
all of them.

### ⚠️ The gap: no email

`NoticeRouter.deliver` sends an email when it can and then returns **without**
writing a notice row. Passing no email function therefore guarantees the in-app
notice exists for everybody — including the phone-only landlord, for whom it is
the only channel there is.

That is the right trade, and it has a cost: **somebody who does not sign in
within 30 days misses the review window entirely.** A review window is the one
notification here with a deadline, which is exactly the case an email is for.

**What it needs:** a `sendTenancyEndedEmail` template beside the sixteen that
already exist, passed to `deliver` as its email function — at which point the
in-app notice stops being written for anyone with an address, so the two
channels need thinking about together rather than one bolted on.

### Proof

Drive section 9 — 14 checks, 88 in the file. All three behaviours reintroduced
and confirmed to fail:

| Reverted | Result |
|---|---|
| `cancel()` no longer frees the room | ❌ room reads `let` |
| `end()` announces nothing | ❌ **9 red** |
| the relist prompt ignores the room's own status | ❌ fires on a paused room |

Revert 3 had to be run **in isolation**: with the announcement disabled nothing
fires at all, so "a paused room draws no prompt" passed for the wrong reason.

⚠️ **And one check was green when it should have been red.** *"The tenant is not
told THEY ended it"* is a negative assertion, and with no notice at all the
empty string matches no phrase — so disabling the announcement made it pass. It
now requires the notice to exist first. **A negative check has to prove the
thing it is reading is there.**

### Not proven

Nothing here reads the landlord **dashboard**. The notice row exists; whether
the relisting prompt surfaces as a task in the inbox is Phase E.

---

## 34. The Reserved status: a complete feature with no button

**✅ Closed in v1.120.0 (Phase E).** The control is on the room row on the
property screen — "Reserve for someone" on an active room, and a Reserved block
with the way back on a reserved one. Proof is drive section 11e, which clicks
it and reads the status back; reverted, the button is absent and the check goes
red. The rest of this entry is the record of what was built and unreachable.

`Room.reserved` means "a tenant is lined up but nothing is signed" — the room
stays visible with a badge, takes no new applications, and existing applicants
are left open deliberately as the landlord's fallback.

All of it is built:

| | |
|---|---|
| `POST /rooms/:id/reserve`, `/unreserve` | work |
| `RoomsService.markReserved` | writes the status |
| `applications.service.ts:43` | refuses new applications with a tailored sentence — "reserved for another tenant while they finalise. It may become available again" |
| `room-card.ts:59` | renders the **Reserved** badge |
| `landlord-inbox`, `properties.service` | count it as occupied |
| `admin.service`, `account-lifecycle.service` | count it as live |
| `rooms.service` pause / let / working-on | all handle it |
| **a control in the portal** | **none** |

So the badge, the refusal sentence and the gold status dot are all unreachable,
and a landlord with somebody lined up has only "mark as let" — which closes and
emails every other applicant, the destructive action for a non-destructive
reason that `pause()` was added to avoid.

`frontend/.../rooms.service.ts` also carried **two** methods for that one
endpoint, `markReserved` and `reserve`, identical but for the name. That is
what happens to code nobody calls: neither copy was ever wrong, because neither
was ever used. `markReserved` is deleted.

**⚠️ `docs/TENANCY-LIFECYCLE-AUDIT.md` §D3 got this wrong** and said nothing
wrote the status at all. The write is at `rooms.service.ts:533`, two lines into
a match I read as a read. Corrected in place rather than quietly.

**What it needs:** a Reserve / Unreserve control on the room row, next to the
existing let and pause actions. Phase E.

---

## 35. The rent screen described a finished letting as a running one — Phase D

**Fixed. This is the defect the owner reported, and the first phase visible on
a screen.**

### What was wrong, in two opposite directions

**The rent screen** looped over `active`, `ended` and `pending` tenancies with
no branch on which. A letting that finished two years ago rendered
**identically to the room somebody lives in**: the same heading, the same
present-tense "R3 000/mo", the same banner asking them to say so if a month was
wrong, the same paperwork offered as current.

The cause was architectural rather than cosmetic. One component was the only
representation of rent, so it had to be both things at once.

**The tenant dashboard** excluded only `active` from "Your applications":

```ts
&& a.tenancy?.status !== 'active',
```

So when a tenancy ENDED it fell straight back into that list — `tenancy.status`
became `'ended'` (which satisfies `!== 'active'`), the Application stays
`accepted` for good, and nothing archives it, because `archivedAt` is set by a
relist and ending a tenancy does not relist the room. The derived note counts an
acceptance as waiting on the tenant, so a person who had moved out six months
earlier read:

> The landlord has moved on this one — it is waiting on you.

Meanwhile `currentHomes` requires `'active'`, so the room vanished from "Where
you live now" in the same render. **Moving out moved the room backwards through
their own dashboard.**

### What it does now

Two sections on the rent screen, and the past one is written in the past tense:
a **Past letting** label, "Lived there 4 Jun to 1 Sep", and "Rent was R1 800 a
month" instead of a live monthly figure.

**What deliberately does NOT change for a finished letting:**

- **The ledger stays, in full.** Previous months, amounts, dates and disputes
  are what a person needs most once they have left. The owner asked for exactly
  this in as many words: previous payments must not disappear.
- **The answer button stays.** `RentService.dispute` refuses only a cancelled
  letting, because the most consequential mark a tenant ever receives is the
  final month — entered after they moved out, with `TenancyFlag.unpaid_rent`
  able to rest on it.

So the change is what the screen **says**, not what it permits. "It is over, so
lock it" would have been the easy wrong fix.

One ledger template rendered twice rather than two copies of the markup: the
rows mean the same thing either way, and this repository has already paid for
the other choice with a navigation defined six times that disagreed with itself.

### A pointer, because excluding it from both lists made it vanish

An ended tenancy's application is `accepted` and unarchived, so once it was out
of "Your applications" it matched **no** section and disappeared from the
dashboard entirely. The record belongs on the rent screen — a dashboard is for
what needs doing — but a room somebody used to live in vanishing without trace
is the same complaint as the hidden way back. So: one line, with the link on it.

### ⚠️ Two mistakes worth recording

**I reintroduced the defect I was fixing.** The first version replaced
`!== 'active'` with `!isFinished(status)`, matching `ended` and `cancelled` —
and in doing so **dropped the active exclusion**, so the room the tenant lives
in came back into "Your applications" under "it is waiting on you". The drive
caught it.

The fix is a **whitelist, not a blacklist**: `tenancyHasMovedOn` returns true
for any status except `pending`. Naming the one state that stays cannot fail
that way — a status nobody thought of excludes itself.

**A negative check passed on absence, for the third time in this file.** With
the past section removed entirely, `pastText` is `''` and matches no pattern,
so "the finished one does not show /mo" went **green** with the defect fully
reintroduced. Every negative assertion in section 10 now proves its subject
exists first.

### Two traps this hit

**Backticks in a template comment, twice** — the seventh and eighth occurrences
in this codebase. `TS1005: ',' expected` points hundreds of characters past the
cause, because everything after the stray backtick parses as code, and the
backtick is almost always in a comment quoting an identifier.

It is in CLAUDE.md and that has not been enough, so there is now
**`scripts/template-literal-lint.mjs`** — a grep, essentially, which finds in
milliseconds what a production build finds in half a minute. Verified: exits 1
with a stray backtick naming the file and line, exits 0 clean, 83 inline
templates checked.

**`tsc --noEmit` does not check templates.** Passing `headingLevel="4"` to a
component whose input is typed `2 | 3` is a template type error that **only
`ng build` reports**. A clean typecheck says nothing about a component's
inputs. (`LeaseDocuments.headingLevel` now accepts 4, which the past-lettings
hierarchy needs: an h2 section, an h3 per letting, so the paperwork inside one
is an h4.)

### Proof

Drive section 10 — 24 checks, 112 in the file. Every check reads **rendered
text**, not a filter; a check on the filter would have passed before this phase
as easily as after it. Both defects reintroduced:

| Reverted | Result |
|---|---|
| the rent screen loops everything together | ❌ |
| the dashboard excludes only `active` | ❌ — and the check printed the owner's own words back: *"Your applications… it is waiting on you. Old room"* |

**13 red, 99 passed. Restored: 112 passed.**

Responsive verified at **360 / 390 / 768 / 1280**, per CLAUDE.md: no horizontal
scroll, and every control in the past section clears 44px at all four.

### Not proven

**The landlord still has no past-tenant view at all** — the opposite failure to
the one fixed here. `properties.service` filters to `pending` and `active`, so
their side loses the tenant, the dates and the ledger the moment a letting
ends. Phase E.

**No archive screen exists.** The rent record is on the rent screen because
that is where it has always been; reviews, documents and problems per tenancy
are Phase F.

---

## 36. A role button whose text was invisible on hover — the `:where()` trap again

**Fixed. Pre-existing, found by a red gate rather than reported.**

### What was wrong

`scripts/a11y-drive.mjs` was failing two checks on `/auth/register-phone`, and
had been before any of the lifecycle phases — confirmed by stashing them and
re-running:

```
contrast 4.34:1, needs 4.5:1 at .auth__role-sub
:hover contrast 1.17:1 (needs 4.5) on .auth__role
```

**1.17:1 is white on cream — text that cannot be seen at all.** The same class
of defect as the 1.00:1 white-on-white button in §22, in the same session that
found that one.

### Why, exactly

Asked the browser which rules won, with the `:hover` state forced through CDP:

| Rule | Specificity | Sets |
|---|---|---|
| `.auth__role` | (0,1,0) | `color: #1C160E`, `background: #FFF` |
| `:where(button):hover:not(:disabled)` | **(0,2,0)** | `color: #fff`, `background: --terra-deep` |
| `.auth__role:hover:not(.is-active)` | (0,3,0) | `background: #F2EDE3` — **and nothing about colour** |

`:where()` contributes **zero** specificity, so the global button-hover rule is
only (0,2,0) — its `:hover` and `:not(:disabled)`. The auth rule at (0,3,0)
therefore wins the **background** and overrides it to cream… and by saying
nothing about `color`, leaves the global rule's **white** sitting on top of it.
The resting `.auth__role` colour is (0,1,0) and loses.

**So: overriding a `:where(button):hover` background without also overriding its
colour is how a control ends up with invisible text in one state.** The resting
state measures 15.6:1 and says nothing about it.

The second failure is arithmetic: `rgba(255,255,255,.8)` over `--terra`
composites to `#EFD9D3`, which is 4.34:1 against the `#AD4222` behind it — just
under the 4.5 that size of text needs. `.9` gives 5.07:1 and keeps the
sub-label quieter than the title, which is what the alpha is for; solid white
would pass and flatten the hierarchy instead.

### Proof

Both reintroduced, gate red with the same two lines; restored, gate green —
**10 public + 17 portal pages, 11 distinct control styles hovered, 38 focused,
all over threshold.**

⚠️ **The gate needed demo rooms to say that.** Without them it reports "the
board had no rooms, so the room card was never checked" and an H2-before-H1 on
a room built by a drive fixture, and neither is a real finding. Seed first:

```bash
cd backend
ADMIN_EMAIL=… ADMIN_PASSWORD=… SEED_DEMO_ROOMS=true npx ts-node prisma/seed.ts
```

A gate that reports two fixture artefacts alongside two real defects is a gate
people learn to skim.

### What this says about the rest of the app

Only two other rules override a hover background without a colour
(`.spark__bar`, a chart bar with no text, and `.prop-card__link`, which is not
a `button` so `:where(button)` never applies to it). The gate hovers every
distinct control style on 27 pages and passes, which is better evidence than a
grep.

---

## 37. The landlord lost the tenant the moment a letting ended — Phase E

**Fixed. The mirror image of §35, failing the opposite way.**

### What was wrong

**`properties.service.ts` asked for tenancies `['pending','active']`, and that
was the only place a landlord could see a tenancy at all.** So the moment a
letting ended they lost the tenant, the dates, the rent paid and the whole
ledger. A search across both codebases for "past tenant", "former tenant" or
"tenancy history" returned nothing but review copy and the PAIA manual — which
tells the public this platform holds "tenancy history and rent records".

The rows were always there. Nothing rendered them. Where the tenant's screen
said too much about a finished letting, the landlord's said nothing.

**The room stayed `let` with nobody in it**, and the status chip beside it read
"let" — the opposite of help. The Phase C notice fires once, and a notice read
and not acted on is gone.

**Reserved had no button anywhere.** The route, the API write, a tailored
application refusal, the board badge and five occupancy counts were all built
and working (§34).

### What it does now

| | |
|---|---|
| Past tenants on the property screen | collapsed, newest first, capped at six per room by the API |
| Each row | who, the date range, what they paid, their paperwork, and whether a review is still open |
| A room marked let with nobody in it | marked as empty on the room itself, with the relist action on the marker |
| `room_vacant` inbox task | persists until the state changes, which a notice cannot |
| Reserve / Unreserve | the control the feature never had |

**`room_vacant` is a task and not another notice, deliberately.** A notice
fires once; a task list persists until the state changes, and "this room is
empty and nobody can find it" is a state, not an event.

Its urgency **rises the longer it sits** — `max(300, 450 - days * 5)` — which is
the opposite of how the dated items work and is right: an empty room is lost
rent every day, and one invisible for a month is worse than one empty since
yesterday. Floored at 300 so it can never outrank a tenant disputing their rent
record.

**It asks `tenancies: { none: ... }`, not "is there an ended tenancy".** The
latter would miss a room marked let by hand through `markLet()` with no tenancy
behind it — a real path, and every bit as invisible. The question is not "did a
letting end here", it is "is anybody actually in this room".

**A paused room draws no task.** `pause()` exists so a landlord can stop
enquiries without the destructive alternative; nagging them about a room they
deliberately took down is how a list becomes something people stop reading.

### ⚠️ Three things about the drive, not the product

**It killed itself.** With past tenants reverted, section 11 reported nine
failures and then **died** on `locator.click: Timeout 30000ms exceeded` for a
control that was no longer there — taking the remaining sections and the whole
summary with it. Same defect as §28. Every click in that section now checks
first and reports rather than throwing.

**A fourth vacuous pass.** "A room the landlord paused draws no empty-room
task" asserted zero, and zero is also the answer when the feature does not
exist — so it passed with the task fully reverted. It now compares **before and
after** pausing, because the claim is that pausing *removes* it.

**This drive is now one run per API restart.** Eleven sections register about
35 accounts against a limit of 60 per hour counted in memory. One run fits;
two back to back do not, and the second dies with a 429 that reads like an auth
bug. Recorded in the file's own header.

### ⚠️ The bundle budget got worse, and that is mine

The initial bundle went from **456.42 kB to 457.92 kB** — `+1,501 bytes`, which
is exactly the growth in `styles.css` (58,091 → 59,592) and therefore entirely
the new rules in `_spec.scss` and `_responsive.scss`. Measured by stashing and
rebuilding.

The budget (`maximumWarning: 450kb`) was already exceeded by 6.42 kB before
this, so it is a warning and not a build failure — but it is moving the wrong
way and this is the first phase that moved it.

The yard's styles live in the global sheet by this repo's convention, and
`_spec.scss` records why: Angular's emulated encapsulation makes component
styles more specific than the global sheet, which is how the responsive layer
was silently overridden once before. Moving these rules into the yard's own
(lazy) chunk would take them off the initial bundle and reopen that. **That is
a trade worth a decision rather than a quiet choice**, so it is recorded here
rather than made.

### Proof

Drive section 11 — 30 checks, 142 in the file. Reverted in two halves, because
the backend revert masked the frontend one:

| Reverted | Result |
|---|---|
| the API's tenancy filter back to `['pending','active']`, and the inbox task removed | **11 red** |
| the yard's vacant marker, Reserved control and past-tenant list | **5 red** |

Restored: 142 passed. Responsive at 360 / 390 / 768 / 1280 — no horizontal
scroll, every new control over 44px.

Everything else green: `inbox-drive`, `yard-layout-drive` (41),
`properties-ui-drive`, `dashboard-ui-drive`, the smoke suite, `a11y-drive`
(10 public + 17 portal pages), `template-literal-lint`, `env-parity`,
`throttle-lint`, `route-audit`.

### Not proven

**Six past lettings per room is the API cap and nothing says so on screen.** A
room on its tenth tenant shows the six most recent silently. The full record is
the archive view, Phase F.

**Nothing reads reviews, problems or viewings per tenancy.** The past-tenant row
carries dates, rent and paperwork only.

---

## 38. The archive — Phase F

**Done. `/account/tenancies`, one list for both roles.**

### What was missing

Everything this screen shows was already in the database and **none of it was
on a screen**. `RentPeriod`, `Review`, `TenancyFlag` and `LeaseDocument` all
key on `tenancyId`, so three lettings for one tenant could never bleed into
each other — and the only two places that read a tenancy were the tenant's rent
screen and the landlord's property screen, both asking for live ones.

So `/legal/paia` told the public this platform holds *"tenancy history and rent
records"* with nothing behind it. Phases D and E fixed the two live screens.
This is the record.

### Why `/account` and not `/tenant` or `/landlord`

The same reason `/account/messages` is there, and one stronger: **a person can
be the landlord of one room and the tenant of another, and their history is one
list.** A sub-lessor is both by definition (Phase 6), which in this market is
not a corner case. Splitting the list by role would split one person's past by
a distinction they do not have.

### ⚠️ The permission rules are not uniform, and must not be made uniform

This is a screen that assembles six private tables into one payload for two
different people. Flattening the rules into "both parties were there, so show
everything" would make it the product's largest POPIA and defamation exposure
in a single step. Each rule, and why:

| Rule | Why |
|---|---|
| Reviews: `publishedAt != null, isHidden: false` | **The double-blind rule.** A review is withheld until both sides have written one or the window closes. If the archive showed a held one, either party could read the other's before writing theirs, which turns a rating into a negotiation and stops honest criticism. `isHidden` is moderation — a review an admin took down must not come back through a different screen |
| `TenancyFlag`: **only ones you raised** | The schema's own words: showing an unreviewed accusation to its subject is *"this platform's largest defamation exposure in South Africa."* Matches `TenancyFlagsService.listMine` rather than inventing a looser rule for a screen where both parties happen to be authorised |
| `Report`: **only ones you filed** | Same reasoning. The admin's resolution is included, because whoever reported it is owed the outcome |
| `LandlordNote`: **not at all** | *"The moment a note could be read by anyone but its author it stops being a memory aid and becomes an unregulated reference that follows a person around."* Excluded for **both** parties, including the landlord who wrote it — this is a shared screen, and a private note has no business being assembled into one |
| `LeaseDocument.path`: never returned | An ImageKit path; the only way to read a document is a signed URL from `openUrlFor`, which re-checks the party. A path in the payload is a private file one guess away from public |
| Messages: not here | They live at `/account/messages`, keyed on the application. A second copy means two places to get read-state wrong |

**⚠️ My own audit got one of these wrong.** Section F's table said disputes were
visible to "both — raiser sees own; resolution visible to both". The second
half contradicts the defamation reasoning the schema already records. The code
follows the existing stricter rule: **only your own**.

### Two things said out loud rather than left as absences

The API returns an `excluded` block naming what the record does not contain and
why. And when there are no reviews the screen distinguishes **"none were
published"** from **"not shown yet, because neither of you has written one"** —
an empty list cannot tell those apart, and a reader who knows a review exists
and cannot find it assumes it was lost.

### `cancelled` lettings are listed, labelled "Never started"

A letting that fell through is part of what happened and explains a gap in
somebody's history. Phase D excluded it from the rent screen because there is
no rent; here the job is completeness, so it is shown and labelled rather than
hidden.

### Performance: counts in the list, record on open

The list carries `monthsRecorded` and `documentCount` and nothing else. A
landlord with nine past lettings would otherwise pull nine full records — every
rent month, every review, every document — to render nine collapsed rows.

### Proof

Drive section 12 — 44 checks, 206 in the file. **Every permission rule was
reverted and confirmed to leak:**

| Reverted | Result |
|---|---|
| the party check | ❌ a stranger opened the record (200, want 403) |
| the published/hidden review gate | ❌ the tenant read a held review about them, and its words were in the payload |
| the `raisedById` flag filter | ❌ the person a report was about read it |
| the document `select` | ❌ `secret-lease.pdf` in the payload |

**7 red, 199 passed. Restored: 206.**

⚠️ **And a FIFTH vacuous pass.** The document-path check read `documents` on a
fixture that had none — an empty array, so the regex matched nothing and it
went **green with the path deliberately leaked back in.** It now inserts a
`lease_documents` row first. A negative assertion needs its subject to exist,
and this file has now paid for that lesson five times.

Also caught by the drive: an inline link at **14px** against the 44px target
this codebase holds everything to (WCAG 2.5.8 exempts a link inside a sentence,
but the destination is the useful part of that block and deserves to be
tappable), and an `href` where a `routerLink` belongs — an `href` reloads the
whole application in an SPA, which on this market's connections is seconds and
a white screen.

`scripts/a11y-drive.mjs` now audits the screen for **both** roles — 19 portal
pages, not 17. A new screen outside the gate's list is a new screen the gate
cannot see.

### A useful data point for §37

The initial bundle grew **+154 bytes** (457.92 → 458.07 kB), and `styles.css`
is **byte-identical** at 59,592. The archive's ~2 kB of CSS cost the initial
bundle nothing, because it is an **inline component style** and therefore lands
in that route's lazy chunk.

Phase E's `+1,501 bytes` went into the global sheet by the yard's convention.
This is direct evidence that moving those rules into the yard's own chunk would
recover all of it — which is the trade §37 left open.

### Not proven

Nothing here downloads a document. The payload carries no path, which **is**
checked; that a signed URL re-checks the party is `lease-docs-ui-drive`'s job.

A tenancy with an admin-hidden review is not exercised. `isHidden: false` sits
in the same `where` clause as the published filter, which **is** exercised.

---

## 39. A room could be relisted with somebody living in it — Phase G

**Fixed. And my own audit described the wrong defect.**

### ⚠️ What C8 got wrong

`docs/TENANCY-LIFECYCLE-AUDIT.md` §C8 said an elapsed notice period produced
nothing: *"No job watches it… still active, still generating rent reminders."*

**Both inboxes already carried an escalating item.** `LeaseService.upcoming`
computes the countdown on read, both inbox services sort by a negative day
count so an overdue row goes first, and both already said "This date has
already passed". The audit looked for a job and concluded there was no
handling, when the handling was computed per read on purpose — which the file
it was reading says in its own header.

And "still generating rent reminders" is not a defect either. If nobody has
recorded a move-out the person may still be there and rent may still be owed.
The escalation asks; it does not decide.

### The real hole, which was worse

The landlord's row said *"X is leaving — get the room back on the board"* and
pointed at relisting. `RoomsService.relist` checked the **room's** status and
nothing about who was in it — and `let` passes that check.

**Measured before the fix:** relist returned 200, the room went `active`, the
tenancy stayed `active`, and the room was **on the public board**. Three things
follow:

- **Tenants apply for a room somebody else lives in.** That is
  `ReportReason.already_let` — the product generating the exact complaint its
  own report enum exists for.
- **`relist()` archives every open application and increments `relistCount`**
  on the way past, so it is not undone by setting the status back.
- **Phase E's empty-room task cannot see it**, because that asks for rooms
  still marked `let` and this one is now `active`.

So the product *suggested* the step that put it into an inconsistent state.

### The fix

`relist()` refuses while a `pending` or `active` tenancy exists, and names the
step rather than refusing blankly:

> Drive Tenant is still recorded as living in this room. Record the move-out
> first — then it can go back on the board.

`pending` counts too: an accepted applicant who has not moved in is somebody
expecting that room, and relisting it out from under them is the same defect
wearing a different hat.

**`relistAll` needed no change.** It calls `relist()` per room and catches each
reason into `skipped`, so the bulk path inherited the guard and the landlord is
told which room and why. A good seam.

### And the action changes once the clock runs out

While the countdown runs, relisting is the right thing to be getting ready for.
Once it has run out, the step that unblocks everything is recording the
move-out — the room cannot go back on the board until it exists. So:

| | While running | Once elapsed |
|---|---|---|
| Landlord | "Get it back on the board" → the property screen | **"Record the move-out"** → `/landlord/dashboard#moving-in-out` |
| Tenant (landlord gave notice) | "Start looking" → the board | **"Say you have moved out"** → `/tenant/rent#moving-in-out` |

A row whose action 400s is its own defect, so the guard and the new action
landed together.

The tenant's change matters for a reason worth stating: sending somebody to
browse at that point leaves a letting open behind them, and the next thing they
hear about it is a rent reminder for a room they left.

### ⚠️ What it deliberately does NOT do

**An elapsed notice does not end the tenancy.** Where somebody lives is a
record of fact, and inferring a move-out from a date is how this product would
start asserting things it does not know — the same reasoning that keeps the
countdown computed on read and never written. The drive asserts the tenancy is
still `active` and `endDate` still null after the period runs out.

### Proof

Drive section 13 — 24 checks, 230 in the file. All three behaviours
reintroduced: **13 red, 217 passed**; restored, 230.

The cascade under revert is itself the argument. With the guard gone the room
is relisted at the **pending** stage, so by the time the drive reaches the
active case the room is no longer `let` and everything downstream collapses —
which is the inconsistent state the guard exists to prevent.

`smoke-test.sh` carries the guard; `room-grouping-drive` (16),
`properties-drive`, `lease-drive`, `yard-layout-drive` (41), `inbox-drive`, the
smoke suite and every gate are green. The bundle is unchanged — this phase is
backend only.

### Not proven

Nothing here reads either **inbox on screen**. The rows and their actions are
checked through the API; that they render is `inbox-drive` and
`dashboard-ui-drive`.

---

## 40. Fourteen borders that were never drawn — Phase H

**Fixed, and the gate that found it is now in CI.**

### What was wrong

`var(--line)` is referenced **fourteen times across nine components** and is
defined **nowhere**. Not a wrong value: no definition at all.

An unresolved custom property is not a CSS error. The declaration is dropped,
every longhand of the shorthand becomes `unset`, and `border-style` falls back
to its initial value of `none`. Measured in Chromium rather than read off the
spec:

```
border-bottom: 1px solid var(--line)    →  style "none",  width "0px"
border-bottom: 1px solid var(--border)  →  style "solid", width "1px"
```

So fourteen separators did not exist:

| Component | Declaration | What a person saw |
|---|---|---|
| `storefront` | `.store-section` / `.store-room` / `.store-foot` border, `.badge` all four sides | the public landlord page ran as one unbroken column; the badges had no box |
| `lease-panel` | `border-top` | no rule above the lease sections |
| `lease-documents` | `border-bottom` | documents listed with nothing between them |
| `task-rows` | `border-bottom` | every task row touched the next, on both dashboards |
| `tenant-notes` | `.notes-body` `border-left: 3px`, `.note` `border-bottom` | the private-notes panel had no bar marking it off |
| `landlord-calendar` | `border-bottom` | calendar rows ran together |
| `admin/services`, `admin/surveys`, `landlord/services` | `border-top` / `border-bottom` | provider and survey rows with no separators |

**Nothing in this repository could see it.** `ng build` succeeds — an unknown
custom property is valid CSS. `tsc` never reads a `styles:` block.
`css-coverage-audit.mjs` asks whether a CLASS has a rule, not whether the
rule's values resolve. Every one of those gates was green over it.

All fourteen now say `var(--border)`.

### The other half of the phase: a literal that duplicates a token

`--border` is `#E0D5C4`. The styling also wrote `#DDD5C8` nineteen times
across nine files — **2.40 apart in CIE Lab**, which is a difference nobody has
ever seen on a phone in daylight. `#FFF` appeared 52 times beside
`--white: #FFFFFF`. The copies do not move when the token does, and this
palette moves: `--terra` has been changed twice for contrast (once because
`#C04E28` measured exactly 4.50:1 on cream and subpixel rendering tipped it
under), `--gold-text` twice, `--slate` once. Each of those fixed the token and
left the hand-written copies behind.

Migrated: **57 literals in 20 files** (`#FFF`/`#FFFFFF` → `var(--white)`,
`#DDD5C8` → `var(--border)`). 59 remain, carried in
`scripts/token-baseline.json` as debt.

### The gate

`scripts/token-lint.mjs`, wired into `npm run audit`, `npm run audit:tokens`
and CI. Two assertions:

1. **A literal hex within ΔE 3 of a defined token fails.** Ratcheting baseline
   keyed by file AND value AND count, the same design as
   `css-coverage-baseline.json`: a new file reaching for `#FFF` fails, and so
   does a twentieth `#DDD5C8` in a file that already had nineteen.
   `--update-baseline` refuses to write a baseline worse than the one on disk.
2. **A `var(--x)` with no fallback, naming a token defined nowhere, fails.**
   This is the assertion that found `var(--line)`.

Proven able to fail, four ways, each reverted afterwards:

| Reintroduced | Result |
|---|---|
| one migrated `#fff` in `cookie-consent` | ❌ named `line 53 (color) → var(--white) #FFFFFF, ΔE 0.00` |
| a fourth `#3A3228` in `messages` (baseline allows 3) | ❌ `#3A3228 × 4 (baseline allows 3)` |
| `--update-baseline` run with that extra literal present | ❌ refused: *"only ratchets down"* |
| `var(--bordre)` typo in `task-rows` | ❌ named the file, the line and the name |
| `STYLES` pointed at a directory with no tokens | ❌ exit 2, *"Refusing to pass vacuously"* |

`scripts/token-render-drive.mjs` is the other half — 51 checks, the borders
measured as PAINTED on two real screens at 360 / 390 / 768 / 1280. Reverting
one `var(--border)` to `var(--line)` turns it red in eight places.

### Three things found on the way, all of the same shape

- **`design-handoff/tools/tokens.mjs` had a filter that could never fire.** Its
  declaration pattern was `([-\w]+)` with `.filter(m => !m[1].startsWith('$'))`
  behind it — but `[-\w]` does not match `$`, so on
  `$color-cream-2: #F2EDE3;` the match simply began one character later and
  `m[1]` was `color-cream-2`. Twenty SCSS palette definitions in
  `_variables.scss` were counted as literal colour USES, and the file's own
  header claimed definitions were excluded. The headline count was 159
  literals / 332 uses; it is 150 / 314.
- **`stripComments` cannot see a CSS comment inside an inline `styles:`
  block.** The block is a template literal, so the moment the backtick opens it
  is in string state and leaves everything to the closing backtick alone —
  correct for a string. The design-handoff count never noticed because it
  EXTRACTS the CSS first and strips the extract. The first version of the token
  gate read the `.ts` in place and rewrote `#fff` inside screen-hint's comment
  explaining why that very declaration exists. One wrong edit in 57, invisible
  to `tsc` and to `ng build`. Both consumers now share
  `scripts/lib/css-values.mjs`, whose `cssSource()` blanks them.
- **`scripts/control-contrast-audit.mjs` has never existed.** A comment in
  `screen-hint.ts` asserted *"now fails on any rule that sets one of the pair
  without the other"* — a gate claimed in prose and never written, which is the
  same defect as a control that cannot fail, one step earlier. The comment now
  says so. **The gate is still wanted and is not written** (see § 41).
- **`.arc-review__by` had no rule at all.** Phase F shipped it; the review
  attribution inherited `--ink` and read as loudly as the review itself.
  `css-coverage-audit.mjs` found it on this phase's build, which means it was
  red at `cc12db1` and I reported Phase F's gates as green without rerunning
  it after the build. Now `color: var(--slate)`.

### Still open from this phase

- **`var(--surface2, #F4F1EC)`** in `storefront.ts`: a fallback standing in for
  a token that does not exist. It renders correctly, so the gate allows it by
  design — a `var(--x, fallback)` resolves either way. It is still a colour
  outside the system, and `--surface2` should either be defined or the usage
  should name an existing token.
- **`_spec.scss` carries 13 of the 59 baselined literals** and its own header
  forbids hand-editing it (it is a verbatim port of the visual preview). Those
  cannot be burned down from here; the preview has to change first. They stay
  in the baseline so a re-sync that introduces a NEW off-token colour still
  fails, which is the signal.
- **The initial bundle budget.** 458.07 kB before this phase, 458.19 kB after —
  **measured by stashing and rebuilding**, not assumed. The 8 kB overrun of the
  450 kB budget is pre-existing; this phase added 0.12 kB, because
  `var(--white)` is eight characters longer than `#fff`.

## 42. The wordmark existed twice, and MA had nothing to pin it to — Phase I

**Fixed.** One component, `frontend/src/app/shared/components/logo/logo.ts`.

### What was wrong

```
navbar.ts:27   <a class="nav-logo"    routerLink="/">Mas<span>tande</span></a>
footer.ts:15   <a class="footer-logo" routerLink="/">Mas<span>tande</span></a>
```

Two copies of the markup, two copies of the rule (`.nav-logo` /
`.nav-logo span`, `.footer-logo` / `.footer-logo span`). This repo's own
`landlordNav` comment records where that ends: the portal nav was defined six
times, the copies disagreed, and the sidebar shrank as a person moved through
their own portal.

**The split was `Mas` / `tande`, not `MA` / `stande`.** The requirement is that
the **MA** portion holds its colour wherever the logo appears — and "MA" was
part of an unnamed text node with no element of its own, inheriting whatever
`color` the surrounding class set. There was nothing to pin.

**The stem colour was `--cream`, which assumes a dark background.** Both homes
are dark; render the same markup on cream and "Mas" goes invisible while
"tande" stays terracotta.

### What shipped, and where it differs from the plan

The audit called for a `surface: 'dark' | 'light'` input. **An input with two
values has a wrong value**, and here the wrong value renders cream on cream or
ink on ink — the invisible wordmark the finding was about. So the stem is
`currentColor` and there is no input to get wrong. MA is `.logo__ma` with
`color: var(--logo-ma)` in the component's own scoped styles, which Angular
rewrites with an attribute selector — more specific than anything a parent
stylesheet can say, and declared rather than inherited, so a parent setting
`color` moves the stem and cannot touch MA.

### ⚠️ Three dark surfaces declared a background and no foreground

`currentColor` only works if the surface says what its foreground is. It did
not: `.nav` and `.footer` are `background: var(--ink)` with **no `color`**;
`.portal-nav` is `background: var(--ink2)`, the same. Everything inside them
has been naming its own colour one declaration at a time — `.nav-logo`,
`.footer-desc`, `.footer-popia`, `.footer-col h2`, `.portal-user-name`.

That is the `:where(button)` defect one level up, and the first measurement
after the swap proved the cost: with the foreground undeclared the stem came
back at **1.00:1** on `--ink` — the invisible-text failure this codebase has
already shipped once as white text on a white button. All three surfaces now
declare their foreground in `styles.scss` (the port forbids hand-editing, and
the now-redundant per-child colours are left alone, because deleting rules
inside a verbatim port is how a re-sync becomes a conflict).

### The MA colour had to change, and the number was searched

One fixed value has to be legible on `--ink` (header, footer) **and** on
`--cream` / `--card` / `--white`. Every existing terracotta fails one side:

| Token | on `--ink` | on `--cream` |
|---|---:|---:|
| `--terra` #AD4222 | **3.06** | 5.48 |
| `--terra2` #E06038 | 5.04 | **3.33** |
| `--terra-deep` #8E3519 | **2.28** | 7.34 |
| **`--logo-ma` #C4522C** | **3.92** | **4.28** |

Searched across the five surfaces rather than chosen: the best achievable
minimum is **3.92:1**, because anything light enough for #1C160E is too light
for #FFFFFF. #C4522C reaches that ceiling and is the closest to the brand of
the values that do — ΔE 7.6 from `--terra`, 8.7 from `--terra2`, sitting
between the two terracottas it replaces.

**⚠️ 3.92 clears WCAG's LARGE-text threshold of 3:1, not the 4.5:1 small-text
one.** That holds only while the wordmark is 18.66px bold or larger. It ships
at 1.6rem / 1.5rem / 1.25rem at weight 900 — 25.6 / 24 / 20px — so the
smallest has 1.34px of margin. **A fourth, smaller size added without changing
the colour would be a contrast failure that looks like a styling tweak**, so
the floor is measured rather than trusted.

### The gate

`scripts/logo-drive.mjs`, 76 checks, two placements × four widths. MA is
#C4522C and the **same** value at all eight combinations, compared rather than
asserted one at a time; MA is not the stem's colour; the rendered size and
weight clear the floor; MA's contrast against the backdrop it is actually
painted on is measured by walking up to the first opaque ancestor; the
accessible name contains the visible text (WCAG 2.5.3); there is exactly one
wordmark per page; and the drive sets `color` on the host from outside, the way
a future stylesheet would, to prove MA does not move and the stem does.

Proven able to fail, three ways, each reverted:

| Reintroduced | Result |
|---|---|
| `.logo__ma` loses its token and inherits | ❌ 17 checks; MA and stem both `rgb(250,247,240)` |
| `--lg` dropped to 1rem | ❌ "16px at weight 900, floor 18.66px bold" at 768 and 1280 |
| `.nav, .footer` stop declaring a foreground | ❌ stem at **1.00:1** on `--ink` |

### ⚠️ And the drive caught my own claim being false, on its first run

The component header said the stem "inherits the surrounding text colour". It
did not. The logo's root is an `<a>`, and the global
`a { color: $color-terracotta }` in `styles.scss` has specificity (0,0,1) on
that very element, so `currentColor` resolved to `--terra`: **3.06:1 on
`--ink`**, passing the 3:1 floor by 0.06 and nothing like what was designed.
`.logo { color: inherit }` fixes it — 16.77:1 now. Nothing but a measurement
would have found this; the wordmark looked entirely plausible.

### ⚠️ The backtick trap, for the eighth time, where the lint could not see it

Five backticked identifiers in a comment inside the component's `styles:`
block terminated the literal. The production build produced twenty errors,
among them `TS2304: Cannot find name 'color'` and `TS2552: Cannot find name
'_responsive'`.

**`scripts/template-literal-lint.mjs` read green over it.** It looked only at
`template:` literals, and only at the first one in each file. A lint that
covers one of the two places a trap occurs is a lint that will be trusted in
the other. It now covers `template:`, `styles:` and every element of a
`styles: [...]` array, at every occurrence — 141 literals across 85 files.
Proven by running both versions against the same defect: old exit 0, new exit
1, naming `logo.ts:107 (styles:)`.

### Also in this phase

- **`scripts/nav-ui-drive.mjs` queried `.nav-logo`** for its overcrowding
  check. It would have gone red rather than silent, which is the right
  failure mode — but note the trap it now documents: `app-logo`'s host is
  `display: contents`, so the host's own rect is 0×0 and measuring it would
  report every header as a 0px logo. The selector is
  `.nav app-logo .logo`, scoped because the footer carries a second wordmark.
- **The responsive size moved into the component.**
  `_responsive.scss` had `.nav-logo { font-size: 1.25rem }` inside the 480px
  block, where the component could not see it.

### Still open from this phase

- **`.nav-logo`, `.nav-logo span`, `.footer-logo` and `.footer-logo span` are
  now dead rules in `_spec.scss`** — roughly 0.2 kB in the initial bundle.
  Deliberately left: that file is a verbatim port and hand-editing it turns the
  next re-sync into a conflict, for 0.04% of a 459 kB bundle.
- **The initial bundle grew 1.56 kB** — 458.19 kB to 459.75 kB. A new
  component in the app shell is not lazy, because the navbar and the footer are
  on every route. The 450 kB budget was already over by 8.07 kB before Phase H
  (§ 40); it is now over by 9.75 kB. `bundle-budget.mjs`, which measures
  gzipped initial JS per prerendered page, still passes with 122.1 KB to spare.
- **`--logo-ma` is the only colour in the system chosen for a 3:1 threshold.**
  If the brand ever wants the wordmark small — a favicon wordmark, a compact
  header — it needs a second, darker value for light surfaces, and then MA is
  no longer one colour everywhere. Worth knowing before that request arrives.

## 43. Four parallel state systems, three of the duplicates mine — Phase J1

**Fixed.** Five meanings, defined once in `styles.scss`; the mapping is a
typed function in `core/models/state.model.ts`; `scripts/state-lint.mjs` is
the gate.

### What was wrong

§H4 called the state treatments "ad hoc and partial". Counted, there were four
parallel systems:

| Duplicate | Where |
|---|---|
| the "Past letting" chip, written **three times** | `.arc-row__badge` (archive), `.rent-past__badge` (rent), `.yard-past__review` (yard) — differing only by `.12rem` vs `.15rem` of padding |
| `.status--accepted` / `.status--rejected`, identical, raw hexes | `applicants.ts` **and** `applicants-inbox.ts` |
| a naming fork | `.status-accepted` (spec layer, one hyphen) vs `.status--accepted` (components, BEM). Neither shadows the other |
| a fourth convention | `app-status status-{{ p.status }}` on the rent ledger |

**Phases D, E and F wrote three of those duplicates** — this session, mine.

### ⚠️ Two of those rules were under the contrast floor, and the gate for that could not see it

Measured: `.status--accepted` (#3D7040 on sage 15%) is **4.12:1** over
`--cream2`; `.status--rejected` (#D63B3B on red 10%) is **3.46:1**. The chip is
.65rem at weight 700, so the threshold is 4.5:1. Both failed, on two screens,
for every release.

**`a11y-drive.mjs` has never accepted or rejected an application.** Neither
chip has ever been on screen while contrast was being measured. *A page passes
that audit by not containing the failing element* — the five-vacuous-passes
lesson, inside the gate that exists to prevent it, and the drive's own comment
about the viewing invitation already names the pattern.

Fixed by seeding the states: a second room (so accepting does not turn the
first one `let` and change what every other panel renders) and a second tenant
(because one applicant cannot be both accepted and rejected).

**Proven**: with the old `#D63B3B` on red-10% restored, the enriched fixture
catches it on both screens — `/landlord/applicants` at **3.75:1** and the
per-room screen at **3.86:1**, each measured against the surface it actually
renders on. Before this phase, the same colour on the same two screens
produced zero failures.

### ⚠️ And the per-room applicants screen had never been audited at all

`LANDLORD_PAGES` is static paths and that route needs a room id, so
`applicants.ts` was not in the list. `/landlord/applicants` is a **different**
component (`applicants-inbox.ts`), so auditing one never covered the other.
Pushed onto the list from inside the seed, which is the only place that knows
the id.

**The first run of it found a real defect**: H3 straight after H1 — "Decided
(2)", "New and viewed", "⭐ Shortlisted". The portal shell supplies the only
`h1`, so every section heading on that screen skipped a level. Three `<h3>` →
`<h2>`.

### The vocabulary

Each pair measured over `--cream`, `--cream2`, `--card` and `--white`, because
a translucent tint composites over whatever is beneath it:

| state | ink | fill | worst of four |
|---|---|---|---:|
| live | `--sage-deep` | sage 12% | 5.21 |
| waiting | `--ink2` | gold 14% | 9.64 |
| past | `--terra-deep` | `--cream2` | 6.73 |
| closed | `--slate` | `--cream2` | 4.74 |
| disputed | `--terra-deep` | red 10% | 5.89 |

The obvious picks all fail. **`--gold-text` on its own gold tint is 4.10:1** —
and `_spec.scss`'s comment claims it "clears both… 4.61:1 on the tint", which
was measured against the tint over `--card` only; over `--cream2` it is 4.10,
so `.status-pending` has been under the threshold on that surface all along.
`--sage` on the sage tint is 4.29, `--terra` on the terra tint 4.38, `--slate`
on any tint 4.05–4.23. Hence deep inks throughout, and `waiting` carrying its
meaning in the FILL with near-black ink: no gold close enough to `--gold` to
still read as gold clears 4.5:1 as small text (the nearest that does is ΔE 23
away and reads brown).

**Colour is never the only channel.** Every chip carries a word — "Past
letting", "Never started", "Disputed" — so the ink reinforces the meaning
rather than conveying it (WCAG 1.4.1). That is also what frees the palette from
having to make five maximally-distinct hues out of one warm family.

`.state-edge` is §H3's second identity move: a 3px rule in the state's own ink
instead of another tinted rounded box. Both devices read the same two custom
properties, so a meaning is defined once and rendered two ways, and the 480px
behaviour (indent out, rule on top) moved out of `rent.ts` into the vocabulary.
The rent ledger now marks a **disputed month** with it — that was prose with a
raised hand in it, so on a year of rows the one month somebody queried looked
exactly like the eleven they did not.

The mapping is a typed function because **two copies of a mapping is the same
defect as two copies of a rule**: the inbox folded `withdrawn` in with
`rejected` — the same red — so an applicant who *stopped* read as one the
landlord had *refused*. A new status added to either union is now a type error.

### The gate

`scripts/state-lint.mjs`, in `npm run audit` and CI. Four reintroductions, each
reverted:

| Reintroduced | Result |
|---|---|
| a sixth meaning (`state--expired`) | ❌ named with file:line |
| a component declaring the treatment again | ❌ named with the properties it set |
| a declared name losing its rule | ❌ "the chip renders unmodified grey" |
| pointed where nothing uses the vocabulary | ❌ exit 2, "refusing to pass" |

Its own first run produced two false positives — it matched the tail of
`landlord-trust__state--ok` — which turned out to be a real finding anyway:
both modifiers were in the CSS-coverage baseline as styled nowhere, and are now
deleted (baseline 23 → 21).

`.pill--*` is deliberately **not** governed: here a pill is an attribute, not a
state ("✓ Verified", "🛂 Passport", "Couples welcome"), and forcing those into
`live / waiting / past / closed / disputed` would mean picking a state for
"Couples welcome". Measured on the way past: `.pill--green` (#3D7040 on sage
10%) is 4.42:1 over `--cream2` and `.pill` is .6rem — under the floor on that
surface, though it renders on `--card` (4.90) and `--cream` (4.80) today.

## 44. `_spec.scss`'s "DO NOT hand-edit" was a phantom control, and I quoted it twice

**Header corrected. Both defects it was shielding are fixed.**

It said: *"DO NOT hand-edit. This is a direct copy of the project's
authoritative visual spec so it can be re-synced when the preview changes."*

**`RentBoard-ZA-Visual-Preview.html` is not in this repository and never has
been.** `git log --all -- '*Visual-Preview*'` is empty, and `README.md` lists it
under *"Historical source documents… files that existed at a point in time"*.
There is nothing to re-sync from. The file was a one-time port in `e28a035`
and has been hand-edited in **22 commits** since — one of them mine three
commits ago (`8c94aed` added the entire `.yard-past*` block while citing that
header as the reason not to touch the file).

So: a rule that looked like a constraint, could not be enforced, was routinely
broken, and was still being quoted as a reason to leave real defects in place.
Exactly the defect class CLAUDE.md names, one level up from a control that
cannot fail — a control that was never wired to anything.

**I used it twice in the last two phases:**

- § 40 (Phase H) left **13 literal `#FFF`** there, "because the preview has to
  change first". Now `var(--white)`.
- § 42 (Phase I) left **four dead `.nav-logo` / `.footer-logo` rules** there,
  "because hand-editing a verbatim port turns the next re-sync into a
  conflict". Now deleted.

The token baseline ratchets **59 → 31** as a result (the two applicants
screens contributed the rest, migrated on the way past).

The header now says what is actually true: it is ordinary source; it is the
global layer and is loaded first, so a component's own `styles:` block beats it
(Angular's emulated encapsulation — the real constraint, and the reason
PRE-LAUNCH-CHECKLIST #9 exists); `styles.scss` is still *preferred* for new
app-only rules, as a preference rather than a prohibition; and breakpoints
belong in `_responsive.scss`, which is loaded last.

### ⚠️ One blind gate quietly corrupted another gate's baseline

Also found in this phase, and the most instructive thing in it.
`template-literal-lint.mjs` accepted a stray backtick that happened to be
followed by a comma, because that looks exactly like a correct close:

```
both 'closed`, in one place, for both screens.
```

The lint went green. The **token gate**, which reads the same `styles:` ranges
through `cssSource`, then silently stopped seeing nine literals in the
truncated remainder — and `--update-baseline` wrote a baseline nine entries
short. A gate that cannot see its subject is one thing; a gate that *feeds a
wrong subject to another gate* is worse, because the second one reports
success.

The lint now requires that what follows a candidate close is plausible too:
`})`, `],`, or another `@Component` key, with comments stepped over. That last
part matters — without it, six components that correctly close `template:` and
then explain in a comment why there is no `styles:` block all failed, and a
gate with six false positives gets switched off.

Instances nine through twelve of the backtick trap all occurred in this phase
and all were named by the lint before any build.

## 45. Eleven on-screen promises of a WhatsApp message that is never sent

**Fixed. All of them read the flag now, and there is no baseline — the
tolerance is zero.**

CLAUDE.md is unconditional: *"Nothing on screen may promise a WhatsApp message
while it is off."* `WHATSAPP_ENABLED` is `false` on both the API and the
browser. Eleven sentences across six screens said otherwise:

| File | × | What it said | What it says while the channel is off |
|---|---:|---|---|
| `walkthrough.ts` | 3 | two onboarding cards **titled** "Messages reach you on WhatsApp too", and "send the photos to us on WhatsApp and finish it later" | "Every conversation in one inbox" / "Your conversations, in one place"; "A listing saves as you go, so you can add the photos later" |
| `messages.ts` | 2 | the screen hint, and `replyGoesTo()` — **both branches** named WhatsApp, and neither was true | the hint describes the inbox; the reply line says "sent in the app and emailed to them" and stops |
| `account-settings.ts` | 3 | "Used for WhatsApp notifications"; "you can sign in with a WhatsApp code"; "Verifying lets you sign in with a WhatsApp code" | "Used to verify who you are…"; "Signing in with a code is switched off at the moment, so use your email"; "Verifying needs a code sent to this number, which is switched off — there is nothing you need to do" |
| `passport-verify.ts` | 1 | "We send them one WhatsApp asking two questions" | "Somebody from Mastande phones them and asks two questions" |
| `close-account.ts` | 1 | "closing it needs a code on WhatsApp" | "codes to a number are switched off at the moment — so closing it here needs a password" |
| `register-phone.ts` | 2 | the whole page | **unchanged, and exempt** — see below |

### Gated, not deleted, and that is the point

Every one reads `WHATSAPP_ENABLED`, the way `login.ts`, `register.ts`,
`home.ts` and `auth.routes.ts` already do. So the honest sentence shows while
the channel is off and **the WhatsApp sentence returns by itself when the flag
flips** — which is what CLAUDE.md asks for: *"WhatsApp is deferred, not
abandoned… one variable brings the channel back; rebuilding it later is
waste."* Deleting the copy would have been the wrong fix.

**Verified both ways.** With the flag `true`, "Messages reach you on WhatsApp
too" is back in the production bundle. With it `false`, the landlord tour was
walked card by card at 390px — all eight cards read, card 1 "A listing saves
as you go", card 3 "Every conversation in one inbox", **no WhatsApp anywhere**
— and the settings screen shows "Used to verify who you are" with the
WhatsApp hint absent.

### Two things the fix uncovered

- **`account-settings.ts` had a dead control, not just wrong copy.** The
  "Verify this number" button calls `requestPhoneVerification`, which sends the
  code over WhatsApp, and the API refuses with a 503. A button that can only
  fail is worse than no button, so while the channel is off the sentence says
  so and **the button is not rendered**.
- **`passport-verify.ts` was telling a tenant their referee had been
  contacted when nobody had.** `ReferencesService` attempts WhatsApp, gets
  `delivered: false`, records `reference_send_failed`, and the admin screen
  tells an operator to phone the referee instead. The tenant-facing copy now
  says a person phones them, which is what actually happens.

### `register-phone.ts` is exempt, by a rule rather than a list

Its whole page describes a WhatsApp sign-up — and the route is behind
`whatsappOnlyGuard`, which redirects to `/auth/register` while the flag is
false. The copy cannot be on screen while the promise is untrue.

So the sweep reads the guarded component paths **out of `auth.routes.ts`**
rather than carrying a hardcoded exemption or a baseline entry. A baseline
would be permanent debt for copy that is already correct; a hardcoded
exemption would go stale the moment the guard was removed. **Proven**:
deleting `canActivate: [whatsappOnlyGuard]` makes that page's two promises
fail the sweep immediately.

### The drive that guards this rule could not see any of them

`scripts/whatsapp-off-drive.mjs` checked **four hardcoded files** —
`login.ts`, `register.ts`, `auth.routes.ts`, `home.ts` — and asserted each read
the flag. A check structurally incapable of seeing the thing it exists for,
which is this repo's signature defect: a nav audit that could not see a dead
link, nineteen `@Throttle` decorators with no guard, a `documentDeletedAt` that
deleted nothing.

It now sweeps every component, skipping comments, files that read the flag, and
components behind the guard. **The promise pattern had to be widened once**:
the first version matched `account-settings.ts` on "Used for WhatsApp
notifications" and missed two more claims in the same file, because a promise
is not only "we send" — it is any claim that something will arrive *or that a
WhatsApp-dependent thing can be done*.

Proven able to fail three ways, each reverted: a new promise anywhere
(`properties.ts`); the route guard removed; and the sweep pointed at a
directory with no WhatsApp text, which **refuses** rather than passing — the
vacuous-pass guard had to be rewritten to count *files scanned* rather than
*findings*, because zero findings is now the correct answer.

`scripts/whatsapp-promise-baseline.json` is **deleted**. It existed for a few
hours.

### Deliberately not swept

The privacy policy naming Meta as a processor, every `wa.me` link, the
close-account page listing "no WhatsApp messages" among what stops, the admin
screens an operator drives, and the deferred backend code. Those are mentions,
not promises, and CLAUDE.md protects the `wa.me` links explicitly.

## 50. A first-use hint that could never be dismissed — Phase F, found today

**Fixed.** `scripts/hints-drive.mjs` exists for exactly this, and I did not run
it during Phase F.

The archive screen shipped with `key="account-tenancies"`, and that key was
never added to `SCREEN_HINTS` on the server. So the panel showed, "Got it"
posted to `/users/me/hints/account-tenancies`, the API answered **400**, the
optimistic patch rolled back, and the hint came straight back on the next
visit. `screen-hint.ts`'s own header says it: *"a hint you cannot put away is
worse than no hint at all."*

Found by running the drive while verifying something else. Proven by removing
the key again: *"1 key(s) the server would reject, so the hint never goes away:
account-tenancies"*.

## 46. Loading, empty and error were thirty-eight paragraphs — Phase J2

**Fixed.** Three components, `scripts/feedback-lint.mjs` is the gate.

### What was wrong

§G5 said there was "no system, so the twentieth screen will invent a
twenty-first phrasing". Counted, the copy was *already* consistent — 23 of the
38 loading states were the identical paragraph. The real defect was different
and worse:

**⚠️ Not one of the 38 was announced.** A paragraph replaced by content when a
request lands is silent to a screen reader: no `role`, no `aria-live`, so
nothing says a screen is busy and nothing says it has finished. There are 81
live regions in this app; 68 are `role="alert"` on field errors and exactly 11
paragraphs carry `role="status"`, none of them a loading state in a template.
**`axe` does not flag a missing live region, so `a11y-drive` has never
reported this and never could.**

**Three screens used ONE element for three states.** `notices`, `messages` and
`applicants-inbox` each had `<p class="{notices,msg,ai}-empty" role="alert">`
doing the error, the loading state *and* the empty state. Two consequences:
"Loading…" was announced as an **alert**, the politeness level reserved for
something going wrong; and "we could not reach the server" looked exactly like
"you have nothing" — which on an applicants screen means a landlord concludes
**nobody applied**. The screens' own comments say "Three states, not two", and
the markup then used one element for all three.

**The whole-screen error had no error styling at all** — muted body text, the
same defect `.form-error` had before `css-coverage-audit` found it.

### What shipped

- **`<app-loading>`** — `role="status" aria-live="polite"`, with `<ng-content>`
  **fallback content** so the ten screens with better wording keep it. 38 call
  sites in 28 components.
- **`<app-error-state>`** — `role="alert"`, a `retry` output, the state
  vocabulary's edge treatment, and `var(--danger)`.
- **`<app-empty-state>`** — deliberately thin. §G5 says the copy is "genuinely
  better than most" and it is, so the copy stays projected; what the component
  adds is a slot for the ACTION, which several empty states lacked entirely.

### ⚠️ `--danger` did not exist, and eight components had each typed a worse red

`$color-danger: #B23B3B` has been in `_variables.scss` from the start and is
**5.48:1** on `--cream`. But an SCSS variable is invisible to an inline
`styles:` block — the audit's §H2 finding — so eight components typed a red
from memory and every one of them landed on `#D63B3B`: **4.32:1 on `--cream`,
3.96:1 on `--cream2`**, at .82rem. Eight independent contrast failures caused
by a token the components could not reach.

`--danger` is now a custom property with the same value, and all eight say
`var(--danger)`. Adding the token immediately made the gate see a ninth
literal (`#B23B3B` in `tenancy-lifecycle.ts`) that had been invisible because
nothing matched it — defining a token is what makes its bypasses visible.

### `.link-button` was declared in four component scopes and nowhere global

The `.btn-danger` defect again, which `css-coverage-audit`'s own header
records. Four identical bodies in `close-account`, `messages`, `notices` and
`applicants-inbox`; no global rule. So the fifth component to write
`class="link-button"` got an unstyled `<button>` — default chrome, default
padding, in the middle of a sentence. Phase J2's error-state was that fifth,
and the audit named it on the first run. Now global, once, with the four copies
deleted.

### ⚠️ And two gates had false positives of their own

- **`css-coverage-audit` read class names out of COMMENTS.** The error-state
  component documents the three screens it replaced, including
  `<p class="notices-empty" role="alert">`, and the audit reported
  `.notices-empty`, `.msg-empty`, `.ai-empty` and `.link-button` as used and
  unstyled. Four false positives from one explanatory comment, in the gate
  whose entire job is to be trustworthy about missing rules. It now reads
  `onScreenSource()` — JSDoc, `//` comments and HTML comments inside the
  template blanked, offsets preserved. Verified still able to fail: a real bare
  class (`.err--loud`) is still caught.
- **`feedback-lint`'s own first assertion could not fail.** It checked that the
  loading component carries `role="status"` by searching the whole file — and
  the component's header *explains* why it carries `role="status"`, so the
  check matched its own documentation. Verified by deleting the attribute: the
  lint stayed green. It now strips comments first, and deleting the attribute
  produces two failures.

### The gate

`scripts/feedback-lint.mjs`, in `npm run audit`, CI **and the pre-commit hook**.
Three reintroductions, each reverted: a screen writing its own loading state
(named with file:line and the tag); the loading component losing `role="status"`
and `aria-live`; a component declaring a feedback treatment itself (named with
the properties it set). Plus two vacuous-pass guards: no loading component on
disk, and nothing using the three components, both exit 2.

### The pre-commit hook now runs the four fast gates

`template-literal-lint`, `token-lint`, `state-lint` and `feedback-lint`:
**0.516s for all of them**, measured. None needs a build, an API or a browser.

The backtick trap is why. It has now happened **thirteen times** in this
repository — five of them on 11 October alone, in the phases that wrote and
widened the lint for it. A note in CLAUDE.md did not stop it and a CI job
reports it ten minutes later; the hook reports it at the moment it is written.

## 47. ⚠️ DM Mono has never been fetched, and every money figure rendered in Courier New

**Fixed by naming the truth, with the alternative left to you.**

`--font-mono: 'DM Mono', 'Courier New', monospace`. `index.html` has **never
requested DM Mono**: the Google Fonts link asks for `Playfair+Display:wght@700;900`
and `DM+Sans:wght@400;500;600;700` and nothing else. Readable from the file; no
browser needed.

So every money figure in this app — the room price, the hero statistic, the
rent ledger, the archive's month amounts — has rendered in **Courier New or the
platform monospace** since the day the token was written, while the design
system said DM Mono and `design-handoff/TOKENS-CURRENT.md` reported it as one
of "three real faces, plus the same three again as SCSS variables".

**Nothing here could see it.** The token resolves, so `token-lint` is
satisfied. The production build does not fetch fonts.
`getComputedStyle().fontFamily` echoes the **declaration** back, so a drive
reading it "confirms" a font that is not there.

⚠️ **Which means one of my own claims was weaker than it read.** Phase I's
`logo-drive` reports the wordmark's `fontFamily` as
`"Playfair Display", Georgia, serif`. That proves the declaration, not the
glyphs. Its load-bearing assertions — the 18.66px bold floor and the measured
contrast — stand; the family is not evidence and is not treated as such.

### Why this cannot be checked in a browser here

Measured on 11 October: the strings `"DM Mono"`, `"Playfair Display"`, and two
deliberately bogus family names all render at **identical width** in this
container's Chromium — 292.03px for the same test string at 48px. Only the
generic `monospace` and locally-installed `Courier New` differ. **No webfont
loads here at all**, because `fonts.googleapis.com` is unreachable through the
agent proxy. A rendered check would report every family as missing, including
the two that work in production.

So `scripts/font-lint.mjs` is a **static** check against the markup, which is
where the truth is:

1. Every family named in a `--font-*` token is either requested in
   `index.html` or is a generic / system family that needs no request.
2. Every weight used alongside `--font-display` is in the requested range — a
   900 that was never fetched is **synthesised**, and a synthesised heavy serif
   is the difference between a wordmark and a smeared one.

Proven able to fail: putting `'DM Mono'` back → *"names "dm mono" — nothing
requests it, so it never renders"*; changing the logo to weight 800 →
*"display weight(s) 800 are used but NOT requested — the browser synthesises
them"*; stripping the font request from `index.html` → refuses rather than
passing.

### The fix, and the decision left to you

`--font-mono` now names
`ui-monospace, 'Roboto Mono', Menlo, Consolas, 'Courier New', monospace` —
honest, and the system monospace on Android is Roboto Mono, on iOS Menlo, both
tabular, which is the only property this token is relied on for (a column of
rand amounts has to line up).

**If you want DM Mono, it has to be added to the font request** — naming it in
a token does not fetch it. I did not add it: a third webfont family, for the
digits in a rand figure, on a product built for a cheap Android on a metered
connection, is a cost/identity call rather than a bug fix. One line in
`index.html` if you want it.

## 48. Twenty-eight radius values, and the 6px that §H3 said had to go — Phase J3

**Fixed. Radius tolerance is now zero; spacing is ratcheted.**

§H3's third identity move: *"Cream surfaces, ink structure, one radius. `--card`
on `--cream`, hairline `--border`, `$r4` for controls and `$r12` for surfaces,
and nothing else. Every `6px` and `8px` in a component block goes."*

Measured before: **28 distinct radius values for 174 uses.** The tokens existed
and were used — `var(--r4)` 40, `var(--r8)` 21, `var(--r-full)` 18 — and beside
them:

| Value | × | What it actually is |
|---|---:|---|
| `8px` | 15 | **is** `--r8` |
| `6px` | 13 | on no scale — every one a control (button, select, input, toggle) |
| `10px` | 10 | on no scale — six of them pills, four surfaces |
| `4px` | 6 | **is** `--r4` |
| `12px` | 3 | **is** `--r12` |
| `20px`, `999px`, `5px`, `2px`, `0.4rem`, `0.6rem` | 1 each | — |

Now **15 values for the same 174 uses**, and every remaining one is
legitimate: the five tokens (147 uses), `50%` for circles (8), `0` for
deliberately square (3), the SCSS `$r*` layer in stylesheets (10), and four
one-side compound forms.

Mapping, by what the element IS rather than by arithmetic: controls → `--r4`
(so every `6px`, `5px`, `2px`, `0.4rem` went there); small surfaces → `--r8`;
panels → `--r12`; chips at .6rem with .1rem padding → `--r-full`, which also
makes them consistent with the state vocabulary's chip.

**⚠️ I kept `--r8`, where §H3 said "r4 and r12 and nothing else".** 21 existing
uses is not a rounding error and 8px is a real step between a control and a
panel; removing it would be a 21-site visual change to satisfy the letter of a
sentence in an audit I wrote myself.

### The gate

`scripts/scale-lint.mjs`. Radius: **zero tolerance**, because the migration is
done. Spacing: **ratcheted**, because it is 60 values over 1073 uses and
migrating it would be churn with real visual risk and no way to review it. The
rhythm is `.25 / .5 / .75 / 1 / 1.25 / 1.5 / 2 / 2.5 / 3rem`; 39 off-scale
values over 536 uses are baselined, led by `.6rem` ×101, `.4rem` ×66,
`.85rem` ×45.

Proven able to fail four ways, each reverted: a radius off the scale (`7px`); a
**compound** radius with one off-scale part (`var(--r4) 3px 0 0` — the laxer
first version of the rule let `2px 2px 0 0` through, which is how that value
survived); a new off-scale spacing value (`.47rem`); and one MORE use of a
value already baselined (`.6rem ×102`, baseline 101).

Its own first run had a counting bug worth noting: `.6rem` and `0.6rem` were
counted as two values (87 and 14), which made the tail look longer than it is
and would have let a file switch spelling to get under a baseline. Normalised —
**11 of the original 49 entries were a second spelling of another.**

## 49. The money figure, in the display face — Phase J4 (§H3's first identity move)

§H3: *"Playfair Display, heavy, for every number that matters — rent, the rand
figure, the count on a dashboard card. Numerals in a serif display face on a
letting board is immediately not-SaaS."*

**Applied to the display figures, and deliberately NOT to the ledger ones.**

The audit is right about the first and wrong about the second, and the reason
is tabular numerals. The rent ledger and the archive's month list are columns
of amounts that have to line up. The monospace stack gives fixed-width digits;
Playfair, a proportional serif, does not. A column of rand figures that does
not align is worse than a generic one.

So:

- **`.stat-box .val`** (the hero statistic) and **`.room-detail__price`** take
  `--font-display` at weight 900 — one per screen, at size, the thing a person
  looks for first.
- **`.app-rent`** in a list and **`.arc-month__amount`** keep the monospace
  stack, because alignment is the job.
- **`.dash-count`** stays as it is: at `.85em` in slate inside a heading it is
  a label, not a figure.

`font-variant-numeric: lining` on both, because **Playfair ships old-style
figures by default**: without it the 2 and the 5 in "R2 500" drop below the
baseline like lower-case letters, which on a price reads as a rendering fault.

`.figure` is a class in `styles.scss` so the next display figure gets the same
treatment without a fourth opinion about it.

## 51. ⚠️ "by RentBoard ZA" under every house ad — and the script to fix it could not

**Fixed, three defects deep. My earlier advice to you was wrong and would not
have worked.**

You reported the advertiser name still reading RentBoard. It was on a public
page: `ads.service.ts` returns `advertiser: campaign.advertiser.companyName`
and `ad-slot.ts` renders `by {{ advert.advertiser }}` under **every** advert,
so three house adverts whose own copy had been correct since the rename were
each signed with the old brand.

I had told you to run `npx ts-node prisma/seed-house-ads.ts --apply`. **That
would have printed a calm success and changed nothing.** Reproduced, before
fixing anything, by setting the local row back to `RentBoard ZA`:

```
[HOUSE] How it works — sidebar
  unchanged
[HOUSE] List a room — in-grid
  unchanged
[HOUSE] Safety — room detail
  unchanged

Nothing to change — the house ads already match the code.
```

…and the advertiser was still `RentBoard ZA`.

### The chain of three

1. **`prisma.advertiser.upsert` said `update: {}`.** So `companyName:
   'Mastande'`, which has been correct in `house-ads.ts` all along, applied
   **only on create**. Any database where the row already existed kept its old
   name for ever. Present in `seed-house-ads.ts` *and* `seed.ts`.
2. **The change detection never looked at the advertiser.** It compared four
   fields of the CAMPAIGNS — `headline`, `body`, `ctaLabel`, `targetUrl` — and
   nothing of the advertiser row. So the dry run reported "Nothing to change"
   while the name was wrong: a report structurally unable to see its subject.
3. **And because of (2), `if (!changes) return` fired first**, above the
   advertiser upsert — so the write was never reached at all. **Fixing (1)
   alone would have changed nothing**, which is why the second defect matters
   more than the first.

All three fixed. The dry run now prints the advertiser diff and counts it as a
change; the upsert carries the fields; and applying it moves the row.

### Why nothing in this repository could see it

Every rebrand check here reads **source**. This value is a database row: not in
the code, not in a template, and the code that governed it was correct the
whole time. The rebrand audit, the i18n audit, the route audit and the nav
audit all pass over a database whose rows say RentBoard, because none of them
reads one.

`scripts/house-ads-drive.mjs` reads what the **API serves**, at all three
placements — `board_sidebar`, `board_inline`, `room_detail` — because an advert
is only on screen if something asks for its placement, and a sweep of one
placement would have missed two. It asserts the advertiser name and the copy,
since "is the row in THIS database right" is a different question from "is
`house-ads.ts` right", and the answer differed for weeks.

Proven able to fail three ways, each reverted:

| Reintroduced | Result |
|---|---|
| the advertiser set back to `RentBoard ZA` | ❌ 3 failures, one per placement, each naming what it reads |
| stale advert copy in the row (`New to RentBoard?`) | ❌ named the headline and the placement |
| the house adverts paused, so none is served | ❌ *"0 advert(s) were actually served and read"* — it refuses rather than passing over nothing |

That last one is the point: every other assertion in the file is a **negative
over served text**, so with no adverts they would all pass. Five vacuous
passes have shipped in this repository; this one is guarded.

### Found on the way: an unknown placement was a 500

`?placement=board_grid` — a plausible guess, and the one this drive made on its
first run — went straight into a Prisma `where` on an enum column and threw
inside the query. A bad query parameter is the caller's mistake and must read
as one: a 500 says the server is broken, sends somebody looking in the wrong
place, and is indistinguishable from a real fault in a log. Now a 400 naming
the valid values.

### ⚠️ Still yours to run, and now it will work

```bash
cd backend
DATABASE_URL=<production> npx ts-node prisma/seed-house-ads.ts            # dry run first
DATABASE_URL=<production> npx ts-node prisma/seed-house-ads.ts --apply
```

The dry run will now show the advertiser diff. No redeploy is needed — the
adverts are read from the database. The same applies to staging.

## 52. ⚠️ A terracotta retired for failing contrast was still in use, 15 times — Phase K

**Fixed.** And the token gate could not see any of them, by its own design.

`#C04E28` was `--terra` until it was measured at **4.50:1 on `--cream`** — the
WCAG AA minimum to two decimal places, so subpixel rendering tipped it to 4.49
and the accessibility audit failed. The token moved to `#AD4222`.
`_spec.scss` records the whole story in a comment.

**Fifteen translucent uses of the retired value stayed behind**, plus two of
`#7A6E60`, the slate retired for measuring 4.26:1 on `--cream2`. Seventeen in
all, across six files: button lifts, focus rings, gradient stops, tinted
backgrounds, card borders.

### Why `token-lint` was blind to them, correctly

Its header says so: *"Translucent `rgba()`/`hsla()`. `rgba(28,22,14,.07)`
cannot be replaced by `var(--ink)` — it is a different value, not a copy of
one."* That exemption is **right** for substitution and it leaves a hole: a
colour the project deliberately retired can live on indefinitely inside an
`rgba()`, because nothing compares the opaque *base* of a translucent value
against anything.

### The fix, measured rather than assumed

All seventeen retinted to the current tokens' rgb. Before changing anything, the
cost was measured — worst case over `--cream`, `--cream2`, `--card` and
`--white`, with the matching token as the text colour:

| Tint | retired | current | delta |
|---|---:|---:|---:|
| terracotta, text `--terra` | 4.81 / 4.43 / 4.94 / 5.12 | 4.75 / 4.38 / 4.89 / 5.07 | **−0.06** at worst |
| slate, text `--slate` | 4.57 / 4.21 / 4.69 / 4.90 | 4.56 / 4.20 / 4.65 / 4.85 | **−0.04** at worst |

So retinting is free. The historical comment in `_spec.scss` that *cites*
`rgba(192,78,40,.15)` as what was replaced is untouched — the migration works
off comment-blanked offsets, so prose about the old value survives while the
value itself does not.

### ⚠️ A pre-existing margin this surfaced, and I have not changed

Both tints sit **under 4.5:1 on `--cream2`** — terracotta 4.38, slate 4.20 —
and they carry small text in `.tpl-flag`, `.ec`, `.status-rejected` and
`.status-withdrawn`. That was true before the retint (4.43 and 4.21) and the
retint costs 0.05 of it. **Today they render on `--cream` and `--card`, where
they pass**, which is why `a11y-drive` is green on them. If one of those chips
is ever moved onto `--cream2` it fails, and nothing would say so — the drive
measures where things are, not where they might go.

## 53. Eighteen shadows for 32 uses, and three kinds of thing wearing one property — Phase K

**Fixed.** Shadows now have zero tolerance, like radius.

`--shadow-sm/md/lg/xl` existed and were used 8 times. The other 24 uses were
`none` ×11 (legitimate) and **thirteen one-offs that were not all elevation**:

- **Six focus and selection RINGS** — a spread with no blur — at **1px and
  3px**, in four tints at `.15` / `.18` / `.2` / `.3`. Forcing these onto
  `--shadow-*` would have been wrong; a ring is not a shadow. Now four
  `--ring-terra/danger/sage/gold` tokens, **all 3px, all one alpha**. WCAG
  2.4.11 wants a focus indicator findable, and a ring whose thickness depends
  on which control you tabbed into is the kind of inconsistency nobody reports
  and everybody feels.
- **Four overlay shadows for modals**, all **black** where every token is
  ink-tinted — and two of them *the same value written with and without spaces
  inside the `rgba()`*. All `--shadow-xl` now: black at .22 and ink at .18 are
  indistinguishable over a scrim, and "nothing else" is the point.
- **A lift on the primary button**, twice, again in two spellings, tinted with
  the **retired** terracotta (§52). Now `--shadow-lift`, retinted.

**18 values → 11**, same 32 uses, and every one is a token, a composition of
tokens, or `none`.

### The gate

`scale-lint.mjs` grew two dimensions. Shadows at zero tolerance; **font size
ratcheted** — 49 values for 438 uses, with the top ten inside a 0.28rem band
(`.78`, `.8`, `.82`, `.85`, `.88rem` each used 25–55 times). 28 off-scale
values over 222 uses baselined.

Proven able to fail three ways, each reverted: a shadow off the scale; a
**composition** where one part is off the scale (`var(--ring-terra), 0 1px 2px
rgba(0,0,0,.1)`); and a new off-scale font size.

### ⚠️ Three bugs in the lint's own first run

- **`--update-baseline` refused a first write for a new dimension**, because
  every font size was above an empty map. A dimension with no key in the file
  has nothing to ratchet against — the same first-write allowance
  `token-lint` already makes.
- **The refusal printed the wrong base map**, reporting "`.6rem` 101 → 6" by
  comparing a font size against the *spacing* baseline. A message that invents
  a regression out of two unrelated numbers is worse than no message.
- **`.82rem !important` counted as a distinct value from `.82rem`**, and four
  `clamp(1.9rem, 8vw, 2.6rem)` hero sizes were reported as off-scale when a
  fluid size is a deliberate choice no fixed scale can express.

## 41. A contrast gate that is claimed in a comment and does not exist

**✅ WRITTEN on 14 October as `scripts/control-contrast-audit.mjs`, after the
defect it describes reached a phone a second time — see §63. The rest of this
entry is kept as it stood, because the three years between describing a gate
and writing one is the finding.**

`screen-hint.ts` carried the sentence *"scripts/control-contrast-audit.mjs now
fails on any rule that sets one of the pair without the other."* That file has
never existed in this repository.

The defect it describes is real and has reached a person's phone: the app's
base rule is `:where(button)` with `color: #fff` on a terracotta background at
**zero specificity**, so a class that sets only `background` wins the
background and INHERITS white — white text on a white button, measured at
1.00:1, and the panel's only control rendered as an empty box.

What the gate would have to assert: a rule that sets `background` or
`background-color` on an interactive selector, and does not set `color` in the
same rule, fails. The hard part is deciding what counts as an interactive
selector without a false-positive rate that makes people add exemptions —
which is how an allowlist becomes the place defects go to be forgotten.

Until it is written, the only thing standing between that pairing and the next
white-on-white button is somebody reading the comment.

## 54. Three red CI jobs on `develop`, and only one of them was a failure

The merge of Phases A–K (`1098abe`) landed with three red checks. Comparing
them step-for-step and annotation-for-annotation against the pre-merge
`develop` head (`7e13122`) separated them into three different things, which
is the point of writing this down: a job name is not a failure.

**1. `E2E — browser journeys` — mine, and new.** Pre-merge this job failed at
step 12 (the a11y drive). Post-merge it failed earlier, at step 10, so step 12
never ran — a *different* failure wearing the same job name.
`e2e/account-settings.spec.ts:33` asserted `getByText(/verify this number/i)`
was visible. Commit `a047c18` ("eleven on-screen WhatsApp promises now read the
flag") had put that button behind `@if (whatsappOn)`, correctly: the control
cannot work while the channel is off, because `requestPhoneVerification` sends
over WhatsApp and the API refuses with a 503. So the spec was asserting a
button the product had deliberately stopped offering.

Fixed by asserting the test's actual intent — that saving a number does not
verify it — in a form that holds in both flag states: the "Not verified"
sentence is on screen either way, the `✅ Verified` branch must be absent, and
the button's count is asserted against `WHATSAPP_ENABLED` imported from the
frontend's own `feature-flags.ts` rather than hardcoded. Reproduced locally
first (same error, same line), then fixed, then the bug reintroduced —
`@if (auth.user()?.phoneVerified || auth.user()?.phone)`, which is exactly
"saving verified it" — and the spec failed again. 3/3 app journeys pass.

**2. `Backend — Typecheck, Test, Build` — pre-existing, and three of its four
red steps were not failures at all.** Only step 7, `Lint`, was: two errors,
`'code' is assigned a value but never used` in `phone-signup.service.ts:512`
(from `c5cec47`, 5 October) and `The value assigned to 'propertyId' is not used
in subsequent statements` in `rooms.service.ts:317` (from `f73b8f9`,
3 October). Both predate this branch; both are two-line fixes and are fixed
here, because a lint error blocks the whole job including the smoke suite.

The other three red steps are a cascade, and a dishonest one. Steps 8–10
(Typecheck, Test, **Build**) skip when Lint fails. The two environment-guard
steps carry `if: ${{ !cancelled() }}` so that a test failure cannot hide a
broken production config — correct in intent, but they then ran
`node dist/main.js` against a `dist/` the skipped Build had never produced.
MODULE_NOT_FOUND exits non-zero, the grep misses, and the step reported

> `the guard failed, but not on the placeholder API_URL`

about a guard that had never been invoked. The other reported *"a correct
production config did not pass the guard"* on the same basis. That is this
repository's signature defect — a check reporting a conclusion it has no
standing to reach — so both steps now assert `dist/main.js` exists first and
say *"Build was skipped, so the environment guard could not be driven at
all"* instead. Proven by moving `dist/main.js` aside and watching it fire.
With a real `dist/`, both guards pass locally.

`API log on failure` (step 16) was the fourth red row: a diagnostics step
`cat`-ing a `/tmp/api.log` that the never-started API had not written. It now
falls back to a message, so a diagnostics step cannot add a failure of its own.

**3. `Staging configuration` — pre-existing, and not a code failure.** Same
step, same annotation, before and after. `STAGING_API_HOST` is set, so the
check is enforcing, and it fails on either `/health` not answering within
eight minutes or a `version` other than `1.81.0` — root, backend and frontend
`package.json` all agree on that number, so the check itself is sound. This
needs the Render dashboard, which is not reachable from this container, and it
is **for the operator, not for code**: either the staging deploy has not landed
or the service is suspended.

**What was not run locally, and is still only asserted by CI:** the backend has
no unit tests (`npm test` is an honest stub), and of the e2e job only step 10
(3 app journeys) and step 12 (the a11y drive, 40 pages, green here) were driven
in this container. The mobile-board project, `phase-drive.mjs` and the
production-build locale/SEO pass were not.

## 55. Fixing one lint error exposed two more failures that had never run

§54 fixed the Lint error that was failing the backend job. CI then failed at
**Typecheck**, which had been *skipped* behind that lint error — so the cascade
was hiding real failures, not just producing fake ones. Three errors:

```
prisma/inspect-board.ts(57,15): error TS18047: 'u.email' is possibly 'null'.
prisma/inspect-board.ts(57,29): error TS18047: 'u.email' is possibly 'null'.
prisma/purge-test-data.ts(104,22): error TS18047: 'u.email' is possibly 'null'.
```

Both files are **byte-identical to the pre-merge head** (checked with a
worktree at `7e13122`), so these predate the branch entirely. They are also
only reachable through `tsconfig.seed.json`, the second project in
`npm run typecheck` — the one whose own header comment records that it used to
check zero seed files.

**`inspect-board.ts` was not a type complaint, it was a crash.** `User.email`
is nullable on purpose, for the WhatsApp-first landlord who signed up by phone,
and `u.email.slice(u.email.lastIndexOf('@'))` throws on the first such account.
This database has **39 of them**, so the script was failing outright every time
it ran: confirmed by executing the old expression against it and getting
`Cannot read properties of null (reading 'slice')`. They now get their own
bucket — `(no email — phone-only)` — because "how many accounts have no email"
is exactly the number that breakdown is read for, and dropping them would have
answered the question wrongly rather than loudly.

`purge-test-data.ts` selects by `email endsWith TEST_DOMAIN`, so the value
cannot be null there in practice; it is named rather than asserted, so if it
ever does print `(no email)` the query has changed.

### And then the smoke suite, 352 assertions that had never run either

With Typecheck green, `Start API` → `API smoke test` ran for the first time and
failed three assertions in **§17f, assisted sign-up**:

```
FAIL  an admin can start one  (expected 200, got 503)
FAIL  nothing in the reply says the acceptance is the person's
FAIL  a record claims acceptance with no account, or the list is not an array
```

The 503 is **correct**. Assisted sign-up delivers its code over WhatsApp and
there is no other channel, so with `WHATSAPP_ENABLED=false` the API refuses and
names email — which is the behaviour this repository deliberately chose, and
which CLAUDE.md records as the open consequence. §17f asserted a flat 200, and
the two follow-on failures were cascades of the ticket that was never created.

This is the same defect as the e2e failure in §54 and the eleven on-screen
promises in `a047c18`: **a check still asserting a WhatsApp flow succeeds after
the channel was switched off.** §18 had already been given two states for
exactly this reason — *"the suite must mean something whichever way the switch
is set, or it stops being run on the deployment it matters most on"* — and
§17f was simply never brought in line with it.

So §17f now has the same two branches, and the off branch is **not a skip**: it
asserts the 503, that the refusal names email, and that the read-back route is
still real and still an array. Accepting an assisted sign-up and sending
nothing is the exact failure the 503 exists to prevent — an admin would tell
somebody standing in front of them that a code was on its way.

Proven able to fail: the refusal message was doctored to say *"Use another way
in"* instead of naming email, and the suite reported
`FAIL  the 503 does not name email: …`, then passed again once reverted.

**The lesson worth keeping:** a cascade does not only invent failures (§54), it
*hides* them. Three steps' worth of real coverage — a typecheck project, 616
smoke assertions and an 18-check refund drive — had been dark behind two lint
errors from 3 and 5 October, and nothing in the job output said so.

## 56. Two checks that had been passing on leftover state, not on evidence

§55 got the smoke suite to the point where CI ran it. It then failed twice, on
assertions that had passed locally minutes earlier:

```
FAIL  the directory leaks checkedByAdminId to landlords, or did not return a list of providers
FAIL  the directory ships sponsoredUntil to landlords, or did not return a list of providers
```

Both guard a real POPIA boundary: a landlord sees outcomes, never which admin
signed a provider off, and never a sponsorship field they could sort on to turn
a directory captioned *"names we have looked into"* into a paid placement.
Their own comments record that each was written the wrong way round first and
**passed on a 401 body**, so both now require `type=="array" and length>0`.

That requirement is right, and it is why they failed: **nothing in this
repository had ever created a live provider.** Every create the suite attempts
is one it expects to be refused — 400 before the number is rung, 400 for a
sponsorship with no placement — and `prisma/seed.ts` seeds none. So the two
checks were reading providers left behind by earlier drives. On this
container's development database, 3977 accounts deep, they passed. On a freshly
migrated and seeded database they fail, which is what CI did the first time it
ever reached that step.

Reproduced by building CI's database here: dropped and recreated
`mastande_test`, `prisma migrate deploy`, then the seed with `SEED_DEMO_ADS`,
`SEED_DEMO_ROOMS` and `SEED_LAUNCH_CODES` — the same three flags the workflow
sets. Both failures appeared immediately.

**The fix is that the checks now carry their own subject.** One live provider is
created through the admin route first, with `phoneConfirmedAt` set so it can be
active at all (201, and the admin's own response does carry `checkedByAdminId`
— so there is something real to withhold). Without an `ADMIN_TOKEN` creating
one is impossible, and the two checks then **skip with the reason named**
rather than failing on an empty directory or, worse, passing on one.

Proven able to fail: `checkedByAdminId: true, sponsoredUntil: true` added back
to the explicit `select` in `services.service.ts`, and both checks reported the
leak; reverted, and 617 pass with 0 failures on the fresh database.

**This is the state-dependence trap, and it is the same family as the rest.** A
check whose subject comes from whatever happened to be in the database is not
a check of the code — it is a check of the database, and it reports on the code
anyway. It had been reporting success for every release in which these two
columns could have started leaking. The rule this file keeps arriving at now
has a third form:

1. A check must be able to fail (§54, the guard that reported without running).
2. A check must be able to see its subject (§55 and the fourteen before it).
3. **A check must create its subject, not inherit it.**

## 57. The house-ad fix did not converge, and said it had — again

§51 fixed three chained defects that left every house advert reading *"by
RentBoard ZA"*. It was reported still wrong on a live board afterwards, and the
reason is a fourth defect of the same shape in the same file.

`seed-house-ads.ts` keys everything on the fixed uuids in `house-ads.ts` —
`…0000b0` for the advertiser, `…b1/b2/b3` for the three campaigns. A database
seeded **before those ids existed** holds its house ads under random uuids, so
every lookup misses, all four rows report *"not in this database — will be
created"*, and `--apply` creates a correct SECOND set beside the wrong one.

Both sets are `status: active`. `ads.service.ts` ranks the house ads and serves
the top one, so a legacy row can win, and the board still reads *"by RentBoard
ZA"* after a run that announced *"✅ 3 house ads written"*.

Reproduced on a copy: three legacy campaigns under random uuids pointing at a
`RentBoard ZA` advertiser, then `--apply`, and the table went from three house
ads to **six — three Mastande, three RentBoard, every one of them active.**

Worse, and verified rather than inferred by running the pre-fix file against
that state: once the canonical rows exist and match, the dry run and the apply
both print

> `Nothing to change — the house ads already match the code.`

while a RentBoard advert is live. That is the **third** time this one file has
produced a report structurally unable to see its subject — §51 defect 2 was the
advertiser fields, defect 3 was `if (!changes) return` firing before the
advertiser upsert, and this is the campaigns themselves.

**The fix is to stop treating the fixed ids as the identity.** House ads are
identified by `isHouseAd`, a flag this script sets itself; the fixed ids are
only the canonical row. Any `isHouseAd` campaign outside the canonical three is
now found, reported with its id, status and advertiser, and **counted into
`changes`** — that last part deliberately, because `if (!changes) return` is
exactly what hid the previous one and the same shape must not be repeated.

On `--apply` they are set to `status: 'ended'`, not deleted: a campaign carries
impressions and clicks, and retiring one is a lifecycle change rather than a
reason to destroy the record. Already-ended rows are excluded, so the script
stays idempotent — after the fix the same database reports *"Legacy house ads
under other ids: none"*.

**What this cost, and the lesson.** The advertiser name was reported wrong by a
person looking at the live site, twice, after two rounds of fixes that each
reported success. Every round was verified against a database seeded from the
current code — the one shape of database in which the bug cannot occur. A fix
for production data has to be rehearsed on a copy of **production's** shape,
not on a freshly seeded one, and "seeded before this id existed" is the
commonest way those two differ.

## 58. The preflight could not check a pooled URL, and said the database was unreachable

Run against both Neon branches on 13 October, `migration-preflight.mjs`
answered:

```
❌ Cannot reach that database:
   psql: ... ERROR:  unsupported startup parameter in options: search_path.
   Please use unpooled connection or remove this parameter
```

about databases that were reachable, healthy and — for production — fully
migrated. `prisma migrate status` reached the same host seconds later and
answered *"Database schema is up to date!"*.

Neon's pooled endpoint is PgBouncer, and PgBouncer **rejects** the `options`
startup parameter rather than ignoring it. The preflight sets
`PGOPTIONS=-c search_path=<schema>`, so psql exits non-zero and the check
reports the target unreachable.

That is a false negative on the one check whose whole job is to say whether the
target is sound — and it fires on the pooled string, which is the one an
operator actually pastes. §79's third defect was the same shape (`?schema=public`
made the script unrunnable against two of three environments); this is the
fourth environment-shaped way the same script could not see its subject.

The fix is small because the design already anticipated it: **every table
reference in this script is schema-qualified**, precisely so nothing depends on
`search_path`. PGOPTIONS was belt and braces, so on a pooler host it is dropped
rather than allowed to fail the connection.

⚠️ **Verified only on the direct path.** The regression run is against a local
database; the pooler branch is reasoned from Neon's error and unit-tested on
six hostnames, not executed against Neon, because this container's network
policy does not resolve `neon.tech`.

## 59. Production was not in the blueprint, and the gate that would have caught it couldn't see it

`render.yaml` described one service. Production — `rentboard-api`, carrying
`APP_ENV=production` and the production Neon branch — was created by hand and
existed nowhere in the repository, so nothing recorded which branch it tracked.
It tracked `develop`. A push to `master` deployed nothing; every push to
`develop` went straight to production; staging and production took the same
commit at the same moment, so staging gated nothing.

Production is now a second service in the blueprint, with `branch: master`.

**And adding it broke `env-parity.mjs`, which is the more interesting half.**
That check read the whole file as text:

```js
if (/key: APP_ENV\s*\n\s*value: production/.test(render) && /branch: develop/.test(render))
```

With one service, testing the file was the same as testing the pair. With two
it is not: `APP_ENV=production` matched the production block, `branch: develop`
matched the **staging** block, and the gate failed a file in which every
service was correctly configured. A cross-service false positive is the mirror
of the vacuous pass this repository keeps finding, with the same cause — a
check that cannot tell which subject it is looking at.

It parses the YAML and checks each service against its own branch now, and
names the offending service. Driven to failure three ways, each naming the
right one: staging claiming production, production left on `develop`, and
production mislabelled `staging` (which would make it refuse every crawler —
the reverse fault, which the old single-direction check never covered).

⚠️ **The second case is the one worth noting: the gate now catches the exact
misconfiguration that was live in the dashboard**, and could not have before,
because the service it concerned was not in the file. A check cannot see a
subject the repository does not describe.

⚠️ **Not yet synced, and the first sync is the dangerous one.** The service
already exists, Render matches a Blueprint service on its `name`, and two
fields were guesses this repository had no record of.

### ✅ `plan: free` confirmed by the owner, 20 October 2026

Both services are on the free plan. The downgrade risk is gone — `free` in
the blueprint matches what is running, so a sync cannot change the instance
class. The remaining field is not a guess: `JWT_SECRET` is `sync: false`
rather than `generateValue: true` **deliberately**, because a regenerated
secret invalidates every live session and refresh token, as it signs them.

🔴 **What the confirmation makes concrete rather than hypothetical: the free
tier sleeps, and production is on it.** After roughly fifteen minutes of no
traffic the next request takes 30–60 seconds to wake the service. The
blueprint header called that "a poor experience for real users" while
arguing production should therefore not be on Render at all — and production
has been on Render, on the free plan, since §59 added it.

So the first person to open `umastande.co.za` after a quiet quarter-hour
waits up to a minute for a room board, on a cheap Android, on mobile data.
That is the person this product exists for, and they close the tab. **It is
a plan decision, not a defect**, and it is recorded here so it is one
somebody made rather than one that happened. Options, in increasing cost: a
keep-warm ping against `/health` every ten minutes (a cron, free, and
explicitly against the spirit of the free tier); Render's cheapest paid
instance; or a different host for the API.

⚠️ **The blueprint header was also false for several releases**, saying
"there is NO PRODUCTION SERVICE defined here yet" while `rentboard-api` sat
170 lines below it with `branch: master`. A header that contradicts its own
file is worse than none: somebody reading the top of `render.yaml` would
conclude production is not deployed from here and stop looking. Corrected in
v1.157.0.

## 60. Three files, three different answers, none of them where staging is

Staging serves from `https://rentboard-za1.vercel.app` — the `develop`
deployment of the Vercel project, confirmed from the dashboard on 13 October.
The repository said otherwise in two places, differently:

| | claimed |
|---|---|
| `environment.staging.ts` | `https://mastande.vercel.app` — **a host that has never existed** |
| `render.yaml` → `SITE_URL` | `https://staging.umastande.co.za` |
| the live Render service | `https://staging.umastande.co.za` |
| reality | `https://rentboard-za1.vercel.app` |

`mastande.vercel.app` came from the rebrand: the API service was renamed and
the Vercel project was not, and nothing compared the two. The file's own header
said the Vercel project "must be renamed, which is what moves the *.vercel.app
alias" — true, and it never happened, so the value described an intention
rather than a deployment.

`SITE_URL` builds `sitemap.xml`, `robots.txt` and every canonical URL, so a
wrong one points an environment's whole SEO surface at a host that does not
answer. **The API starts perfectly well with it**, which is why it survived.

Fixed in `environment.staging.ts`, `render.yaml`, the `corsOrigins()` staging
fallback in `backend/src/config/environment.ts`, `backend/.env.example` and
seven docs.

**And the gate that should have caught it did not exist.** `env-parity.mjs`
checked that `SITE_URL` was *declared* per service, and that `APP_ENV` matched
the branch, but never that `SITE_URL` equalled the string the frontend actually
builds — the one comparison that would have caught all three disagreements at
once. It does now, keyed on `APP_ENV` rather than service name so renaming a
service cannot quietly drop it. Driven to failure three ways: render.yaml back
to `staging.umastande.co.za`, the frontend back to `mastande.vercel.app`, and
production drifting to the apex domain.

⚠️ **The live service still has to be changed by hand** — `SITE_URL` *and*
`FRONTEND_URL` on `mastande-api`. See §61: `FRONTEND_URL` is the more urgent of
the two.

## 61. 🔴 Staging's FRONTEND_URL is the production site

On the live `mastande-api` service, `FRONTEND_URL=https://www.umastande.co.za`.
That is production. It drives four things, and the first is the serious one:

* **`auth.controller.ts:123`** — `res.redirect(\`${process.env.FRONTEND_URL}/auth/callback#${params}\`)`.
  A Google sign-in against **staging** redirects the browser to **production**,
  with the tokens in the URL fragment. Staging-minted JWTs are handed to the
  live site.
* **CORS** — `corsOrigins()` returns `[frontend]` for staging, so staging's
  only permitted origin is production. The real staging frontend cannot call
  its own API; production can.
* **`references.service.ts:74`** — reference-verification links sent to **real
  people over WhatsApp** are `${FRONTEND_URL}/reference/${token}`. A staging
  token in a link to production, where it does not exist.
* Message notifications, application emails, PayFast return URLs, ad
  click-throughs.

`environment.ts`'s own header warns about *"an unset SITE_URL that used to fall
back to the production origin"*. This is that defect in the variable next door,
set by hand rather than by a fallback — so the guard written for one did not
cover the other.

⚠️ **Not fixed here: it is dashboard state, not repository state.** Set
`FRONTEND_URL` and `SITE_URL` on `mastande-api` to
`https://rentboard-za1.vercel.app`.

⚠️ **And nothing in this repository can detect it**, because `FRONTEND_URL` is
`sync: false` by design — it is per-deployment and the blueprint never sees its
value. A check would have to read the running service. Logged rather than
built.

### ✅ Detected as of v1.156.0 — the API now refuses to start

That conclusion was true of the **blueprint** and not of the **running
process**, which can read its own environment. `environment.ts` already had a
"cross-environment contamination" check and it covered `SITE_URL` **alone** —
the guard written for one variable, not the one next door, which is the same
sentence this section opens with.

It now covers both, as an **error** rather than a warning: a warning is a line
in a log nobody reads on a box nobody is watching, and the failure mode is
live tokens in a URL fragment. Measured against the three cases:

| `APP_ENV=staging` with | result |
|---|---|
| `FRONTEND_URL=https://www.umastande.co.za` (the shipped state) | **refuses to start** |
| `FRONTEND_URL=https://rentboard-za1.vercel.app` | boots |
| `FRONTEND_URL=https://staging.umastande.co.za` | boots |

⚠️ **Which means staging will not come up until the dashboard is fixed**, and
that is the point: it was already broken — CORS returns `[frontend]`, so the
real staging frontend could never call its own API — and this makes an
invisible failure visible. Set `FRONTEND_URL` and `SITE_URL` on `mastande-api`
to `https://rentboard-za1.vercel.app` **before** deploying this.

**Still dashboard state**: the repository can now detect the mistake, but it
cannot correct it.

## 62. The wordmark renamed the company, and the gate required the new name

The logo read **MAstande** on every screen for three days. Reported from a live
page on 14 October.

Phase I's requirement was that *"the MA portion of the logo must remain the
same colour and styling wherever the logo appears"*. That is a statement about
colour. Giving the first two letters their own element to pin `--logo-ma` to
was the right implementation — and while doing it this file wrote their
contents as `MA`, in capitals, changing the brand name on screen. The element
is what pins the token; its contents were never part of the requirement.

**The gate did not merely miss it. It required it.**

```js
check(L.text === 'MAstande', `@${width}: ${where} reads "MAstande" ...`);
```

`logo-drive.mjs` was written alongside the component, from the component, so it
inherited the component's mistake and then enforced it: a correct wordmark
would have failed the drive. Seventy-six checks passed at four widths in two
placements, every run, while the name was wrong in all eight.

This is a new shape. The others in this file are checks that could not see
their subject, could not fail, or inherited a subject from the database. This
one saw its subject perfectly, could fail, and was simply **pointed at the
wrong answer** — because it was derived from the thing it was meant to judge.
A check written from the implementation can only ever confirm the
implementation.

⚠️ **The accessible name was right the whole time.** `aria-label` has always
been `Mastande` / `Mastande, home`, so a screen reader said the brand correctly
while the eye read `MAstande` — and no contrast, heading or accessible-name
check compares the two. WCAG 2.5.3 Label in Name wants the visible text inside
the accessible name; here the accessible name was correct and the visible text
was not, which that rule does not catch.

Fixed: `Ma` / `stande`, so the wordmark reads Mastande with the first two
letters still carrying `--logo-ma`. Driven in a browser at 360/390/768/1280 in
header and footer — 76 checks, including that MA is still `#C4522C`, still
differs from the stem, and still cannot be recoloured by a parent. Then the
misspelling was reintroduced and the drive failed all eight text checks.

## 63. Two controls were blank boxes on a phone, and §41 was the reason

Reported from a live landlord screen on 14 October: on a shortlisted
applicant's card, **Shortlist** / **Remove from shortlist** and **Invite to
view** rendered as empty white rectangles. The calendar emoji showed and the
words did not, because emoji carry their own colour.

`applicants.ts` has:

```css
.applicant-card__actions button {
  border: 1px solid var(--border); background: var(--white); cursor: pointer;
}
```

`styles.scss` declares `:where(button)` with `color: var(--white)` on
terracotta. `:where()` has zero specificity, so this rule wins the background
and leaves the white foreground: **white on white, 1.00:1**. `.accept` and
`.reject` both set `color`, which is why those two rendered correctly in the
same row — the failure looked like two missing labels rather than a stylesheet
fault.

**The lesson was already written in this file, forty lines above the bug.**
The comment on `.applicant-card__header` reads: *"⚠️ A button needs its
inherited text put back BY NAME... which is how Phase 7c shipped inbox rows
rendering white-on-cream at 1.06:1, present and invisible."* That rule sets
`color: var(--ink)`. The next button rule in the same component does not.

So the gate finally exists. §41 described it in 2026 as wanted-and-not-written,
and `screen-hint.ts` had asserted in a comment that it already did — meaning
for several releases the only thing between that pairing and the next invisible
control was somebody reading a sentence.

`scripts/control-contrast-audit.mjs` asserts one thing: in a component's
`styles:` block, a rule whose selector names a button or `.btn` and which sets
`background`/`background-color` must also set `color`. Transparent, `none` and
`inherit` are exempt — they repaint nothing, so the inherited colour is still
right.

It is deliberately narrower than §41's ambition of "any interactive selector".
That was the hard part — naming those without a false-positive rate that drives
people to add exemptions, which is how an allowlist becomes the place defects
go to be forgotten. Buttons are the surface this has actually failed on, twice.

Proven able to fail by reverting the one-line fix: it named
`applicants.ts:312`, the selector, and the reason. 8 rules checked, and it
refuses to pass vacuously — if no rule anywhere repaints a control it exits 1
saying nothing was checked, rather than printing a tick.

Wired into `npm run audit` and `.husky/pre-commit`.

⚠️ **What I could not drive.** I measured the fix by injecting the markup into
a running page and got 5.87:1 — which was **vacuous**: Angular's emulated
encapsulation scopes that rule to the component's own attribute, so the
injected DOM never matched it and I had measured the global `:where(button)`
default instead. The real proof is the static gate plus the token arithmetic:
`--ink` `#1C160E` on `--white` is **17.94:1**, against **1.00:1** before.
Driving the actual card needs a landlord account with a shortlisted applicant,
which this container has no path to.

## 64. One global `nowrap`, two squashed controls, and no check for width at all

Reported from a live phone on 14 October: **"Remove from shortlist"** rendered
wider than its own button, the text spilling past both borders; and the past
letting card's header was clipped at both edges — the state pill read `TING`,
the room title lost its first word, `Reviews still open` read `ill open`.

**One cause.** `styles.scss` declares `:where(button) { white-space: nowrap }`.
Right for a short label. Both of these are buttons whose content is prose:

* `.applicant-card__actions button` — at ≤480px the mobile rule gives it
  `flex: 1; min-width: 90px`, two to a row, and a label that cannot wrap
  overflows its box.
* `.arc-row__head` — the whole archive card header is a `<button>`, so `nowrap`
  cascaded into a room title and five facts.

Fixed with `white-space: normal` on both, plus `overflow-wrap: anywhere` on the
title, because a single long unbroken word cannot be wrapped by `white-space`
alone.

### And nothing in this repository measured width

CLAUDE.md requires checking for *"horizontal page scroll … and text that
becomes a single line hundreds of characters wide"* at 360/390/768/1280.
`mobile-drive.mjs` is a regression suite for five specific reported bugs and
never measures width; no other drive did either. Both defects were therefore
invisible to every check while being obvious to anyone holding the phone.

`a11y-drive.mjs` now measures it on all 40 pages it already signs in and
visits. **Per element, not just per document** — neither of these produced a
page-level scrollbar, because the overflow was clipped inside a card, so a
document-level check would have passed on both.

It found **three more real defects** immediately, none of which anything had
ever reported:

| route | |
|---|---|
| `/` | the advert slot is 4px wider than its column — public, a tenant sees it |
| `/admin/advertising` | the rate card forces the page **63px** wide; it scrolls sideways on a phone |
| `/admin/analytics` | a stat row overflows 18px, pushing the page 2px |

Those are admitted in `scripts/overflow-baseline.json`, by route, with a
sentence each on what is wrong — a **ratchet, not an allowlist**: a route not
listed fails, a listed one prints `⏳ known` every run, and the list may only
shrink.

⚠️ **Its first finding was a false positive**, and worth recording: the
visually-hidden pattern is a 1px box that deliberately clips its own text, so
`surveys.ts`'s `<caption class="sr-only">` "spilled" 604px. Exempted by shape
— a box 1px or smaller — rather than by class name, so a differently-named
utility is covered too.

⚠️ **AND IT DOES NOT COVER THE TWO CARDS THAT WERE REPORTED.** Proven, not
assumed: the archive fix was reverted, the drive re-run, and it passed. The
drive's account has no past letting with a long room title and no shortlisted
applicant, so neither card renders — a check cannot see a subject the fixture
never creates, which is §56's rule a third time. The gate is real (three
findings prove it can fail) and its coverage of these two specific cards is
**nil**. Giving the drive a long-titled archived letting and a shortlisted
applicant is the work that would close it, and it is not done.

## 65. Two pages had their own wordmark, and the drive that said otherwise only read one route

Reported from a live phone on 14 October: the logo on **/auth/login** and
**/auth/register** was not the one everything else uses. Both carried

```html
<div class="auth__brand">Mas<span>tande</span></div>
```

— the pre-Phase-I markup, split `Mas` / `tande` rather than `Ma` / `stande`,
and **styled by no rule anywhere in the repository**, so it inherited its
colours from whatever was nearby and rendered with the terracotta on the wrong
half.

Phase I's stated requirement was *"the MA portion is the same colour and
styling **wherever the logo appears**"*, and I shipped it having converted the
header and the footer.

**`logo-drive.mjs` only ever loaded `/`.** Eighty-odd checks at four widths in
two placements, and its closing line claims *"one wordmark component"* — a
claim about everywhere, measured on one route. A check scoped more narrowly
than its own headline is the §62 shape again: not blind, not unable to fail,
just never pointed at the rest of its subject.

Both pages use `<app-logo size="lg" [link]="false">` now, and the drive visits
both routes, asserting four things each: the component is present, the text
reads `Mastande`, MA is `#C4522C` and differs from the stem — and that **no
wordmark is built from raw spans outside the component**, which is the check
that actually catches a regression. Proven by putting the old markup back: the
first check still passed, because the header and footer supply two `<app-logo>`
hosts, and only the raw-span check failed. That is why both exist.

⚠️ **Its first run had a false positive**: `.footer-brand` is a `<div>`
wrapping one `<app-logo>`, which reads as a one-child element whose text is the
brand name. Skipping descendants of the component was not enough; ancestors had
to be skipped too.

⚠️ **And I hit the backtick trap writing this.** The explanatory comment quoted
the old markup inside backticks, inside an inline `template:` literal, which
terminates it — 20 build errors, the trap CLAUDE.md names by number. The
production build caught it before `template-literal-lint.mjs` did, because that
lint runs on commit and I had not committed yet.

## 66. A shortlist that outlived its letting, on both sides

Reported from a live dashboard on 14 October, and the contradiction was in one
screenshot: **"A landlord wants to meet you — message them to set up a
viewing"** above **"None of your applications are still open"**, naming a room
the same page listed lower down as a *past letting*.

One `Application` row, three readers, two of them right.

`activeApplications()` on the tenant dashboard was taught every finished state
by Phase D. `tenant-inbox.service.ts` was not — and its `shortlisted` branch
had **no state check of any kind**: not the tenancy, not the room. The
`accepted` branch directly above it has checked the tenancy since Phase D:

```ts
if (tenancy && tenancy.status !== 'pending') continue;   // accepted
…
out.push({ kind: 'application_shortlisted', … });        // shortlisted, unguarded
```

So Phase D fixed the frontend's definition of "open" and left the backend's
alone — the same fault the whole tenancy audit was about, one layer down.

**And the landlord side carried the mirror of it.** `waitingApplications()`
asked only about the application, so a room already `let`, `paused` or
`deleted` kept producing *"&lt;name&gt; is waiting to hear from you"* for every
pending applicant — chasing a landlord about people who cannot have the room,
with the only offered action being "Open the application" on a closed letting.

Both now ask what state the **room** is in, which is the question neither side
was asking: `active` is the only status on the board. The tenant side also
skips when a tenancy exists at all — shortlisting is behind them whatever
happened next.

### Three things the drive taught me while proving it

⚠️ **The first scenario proved nothing.** It accepted a competing applicant to
take the room off the board — but accepting **auto-rejects** the others, so the
shortlist was excluded on `status` alone and the check passed *without the
fix*. Confirmed by reading the row: `rejected|t|let`. The scenario now pauses
the room instead, which strands a live `shortlisted` row, and the row is
asserted untouched afterwards: this is a read fix, not a write.

⚠️ **The first assertions were vacuous in both directions.** They did
`JSON.stringify(body).includes('application_shortlisted')`, and the payload
carries a `counts` map whose **keys are every kind the inbox can emit** — so
that string is in every response this endpoint has ever returned, including an
empty one. The negatives failed against a working fix and the positives passed
for the wrong reason. They read `items` now, and the badge count beside it.

⚠️ **A third check had been failing since Phase J1 and nothing acted on it.**
`…and flags that they can still be reviewed` asked for `.yard-past__review`, a
class `81d7a23` deleted when the five-name state vocabulary replaced the
per-screen ones. A check pinned to a class name is pinned to an implementation
detail; it now asks for the state vocabulary **and the words a landlord reads**.

Proven able to fail: with the room check disabled the drive reports
`application_shortlisted` present and the badge count `1`. 238 checks pass with
it in place.

## 67. Giving the drive the two subjects it was missing — and what that found

§64 ended with the overflow check unable to see either defect it was written
for, proven by reverting a fix and watching the drive pass. `a11y-drive.mjs`'s
fixture had no shortlisted applicant and no finished letting, so neither card
rendered.

Both now exist: a room with a **long title** and a shortlisted applicant, and a
second long-titled room whose tenancy is written to `ended`. Long titles on
purpose — the defect was a global `white-space: nowrap`, and a label that fits
its box measures nothing.

**The archive card is now covered, and that is proven.** With the fix reverted
the drive reports `/account/tenancies: 1 element(s) wider than their box at
412px (arc-row__head)`. Before the fixture it passed.

### It found a third overflow immediately, on the page most tenants see first

`/rooms/:id` scrolled sideways **171px** at 412px. `.gallery__main` measured
**563px inside a 412px viewport**.

`.gallery` is `grid-template-columns: 2fr 1fr`, and a grid item defaults to
`min-width: auto` — it refuses to shrink below its content's intrinsic size, so
the hero image's natural width won the column. The image's own `width: 100%`
cannot help: 100% of a column that is already too wide is still too wide.
`min-width: 0` on the grid children fixes it; the hero now measures 372px and
the page is exactly 412.

This had nothing to do with the long title. It needed a room with a **hero
image** on a phone-width viewport, which the fixture happened to produce — the
public room page has presumably been scrolling sideways for anyone whose room
has photos.

### What is still NOT covered, and why

⚠️ **The applicant action row.** Reverting its fix does **not** fail the drive.
The applicant cards render **collapsed**, so `.applicant-card__actions` is not
in the DOM at all when the page loads; the drive would have to expand a card
first. The screenshot that reported it was of an expanded card.

> **Closed in v1.141.0 — see §69.** The drive now expands a card before
> measuring, and reverting the fix reports `Remove from shortlist` spilling
> 32px.

So of the two cards §64 named, one is now covered and one is not, and the
uncovered one is uncovered for a different reason than before — not a missing
record, a missing interaction. Expanding a card before measuring is the work
that would close it, and it is not done.

⚠️ **The seed guard earned its keep.** The first version of the fixture wrote
`endedAt`, a column that does not exist — the schema keeps `endDate` and
`endedById`. The UPDATE failed, and the drive refused to audit the portal
screens rather than reporting them clean: *"the portal screens were audited
EMPTY — the seed failed"*. A fixture that fails silently is a check that passes
for free.

## 68. A viewing that had been and gone, and a panel that kept saying "they are coming"

A viewing was proposed, accepted, and then the day came and went. Nothing
happened. `RoomViewing` had no vocabulary for an agreed time that had passed:
the row stayed `accepted` for ever, the tenant's dashboard kept saying "✅ You
said you are coming" about a Saturday three weeks gone, the landlord's
applicant card said "✅ They are coming", and **neither side was ever asked what
became of it** — so the two commonest real answers, *we met at a different time
we arranged between ourselves* and *I took another room*, were unrecordable and
the product learned nothing from either.

### What was added

`ViewingOutcome` — five values, recorded once, by **either side**, and only on
a viewing that both agreed to and whose time has passed:

| value | closes the application | why |
| --- | --- | --- |
| `happened` | no | it went ahead; the application carries on |
| `rearranged_privately` | no | they met at another time, which is the single most common answer |
| `no_answer` | no | it did not happen, and nobody is deciding why |
| `fell_through_other_room` | **yes — `withdrawn`** | the tenant walked |
| `fell_through_other_tenant` | **yes — `rejected`** | the landlord ended it |

The two closing values reuse `withdrawn` / `rejected` rather than inventing a
sixth status: the existing vocabulary already records *who* ended it, and
"ended at a viewing" would be a third name for a thing two names cover.

### ⚠️ "Found another tenant" is an acceptance by another route — and must not be one in the database

The owner's own framing. It is true of what the landlord has decided and must
not be true of what the system does: `fell_through_other_tenant` **accepts
nobody**. Accepting a person decides where they live, and it is a deliberate
action with a thirty-minute undo; inferring it from a dropdown would bypass
that entirely. The reply names the two honest next steps instead — accept the
person you chose, or pause the listing — in the API payload as well as on
screen, so an integration is told the same thing a person is. The drive asserts
the other applicant is still `pending`, no tenancy exists, and the room is
still on the board.

### The notice is derived, never stored

"The agreed time has passed" is a fact about the clock. A column holding it
needs a job to keep it true, which is how `documentDeletedAt` deleted nothing.
Both inboxes derive the `viewing_elapsed` row from `startsAt` and a null
`outcome`, exactly as Phase G derives an elapsed notice period.

### The defect this nearly shipped with: a branch over a row that could not arrive

`GET /applications/viewings/mine` filtered `startsAt >= now`. The tenant panel
is drawn from that endpoint — so the notice had a branch for a state **the API
could never hand it**, this codebase's own recurring failure in its second
form: a check that cannot see its subject. The endpoint now also carries
accepted viewings whose time has passed with no outcome, and the drive asserts
the row is in the payload and leaves it once answered.

A second one of the same kind: `invite()` refused a new viewing while any
`proposed`/`accepted` one existed, so **"offer another time" would have been a
button that always failed**. A past viewing gives nobody anywhere to be, so it
no longer counts as an arrangement; two times still to come is still refused,
and both halves are asserted.

### Proven by reintroduction, three times

* Backend reverted (both clauses): `the tenant's own viewings list still
  carries the one that has passed` and `the landlord can offer another time`
  fail, and the tenant panel renders nothing at all.
* The tenant branch removed: the four tenant text checks fail — including the
  negative one, because every negative check in §15c proves its subject
  exists first.
* The landlord branch removed: `6 failed, 270 passed`.

The first two negative runs also exposed a flaw in the drive itself: an
unguarded `click()` on a control that no longer exists **threw**, ending the
run before the landlord half, so a crash was reported where a list of failures
belonged. Both clicks are now guarded by a count. A drive that stops at the
first missing control cannot tell you what else is missing.

### What this does NOT do

⚠️ Nothing emails or notifies on a schedule when a viewing elapses. The notice
is on both dashboards and in both inboxes, and it appears when somebody looks.
A scheduled chase would be a new job, and — while `WHATSAPP_ENABLED` is false —
a promise of a message that nobody can be sent.

## 69. The measurement now opens the card — and found a label nobody could speak

§67 left one of the two reported width defects uncovered, and was explicit
about why: `.applicant-card__actions` is not in the DOM until a card is
expanded, so a fixture could supply the missing *record* but not the missing
*interaction*. `a11y-drive.mjs` loaded the page, measured six collapsed cards,
and reported clean.

### What was added

A `REVEAL` table — route pattern → an async step run after the load and before
any measurement. One entry so far: expand the first applicant card on
`/landlord/rooms/:id/applicants`.

**It is proven both ways.** With `white-space: normal` removed from
`.applicant-card__actions button` the drive now reports:

```
⚠️  clipped: <button> spills 32px — "Remove from shortlist"
⚠️  clipped: <button> spills 11px — "📅 Invite to view"
```

Before the reveal, the same revert passed. That is §64's second card, covered.

### ⚠️ The per-route version of the check was wrong, and failed a correct screen

The first version required the action row on **every** applicants route. One of
the two fixture rooms exists to produce a *finished tenancy*, so its applicant
is `accepted` — and the action row is correctly absent on an accepted,
rejected or withdrawn application. The drive failed a screen that was right.

What has to hold is weaker and is asserted **once, at the end**: across every
applicants route audited, the action row was on screen at least once, and a
shortlist control with it. Driven to failure by pointing the counter at a class
that does not exist: *"the applicant ACTION ROW was never on screen across 2
applicants route(s) — the width and contrast checks measured nothing there,
which reads as clean"*. A reveal that quietly stops working now fails the run
instead of shrinking it.

### It found a WCAG 2.5.3 defect on its first run

Expanding the card brought `tenant-notes` under the audit for the first time,
and its toggle failed **Label in Name**: `aria-label` read *"Show your private
notes about Thandi"* over a button whose visible text is *"Add a private
note"*. Somebody using voice control says what they can read, and nothing
matched. The name now starts with the visible label and adds the person —
*"Add a private note about Thandi"* — which keeps the disambiguation six open
cards needed it for.

⚠️ That defect was reachable from the moment the component shipped in Phase 5e.
It was not found by reading the code; it was found by opening something.

### What is still NOT covered

⚠️ Only the FIRST card is expanded, and only on this one route. A defect that
needs two cards open, or that lives behind another collapsed region (the
references block, the invite form, the outcome form added in §68), is still
unmeasured. The pattern for closing each is now one entry in `REVEAL`.

⚠️ The three overflow defects in `scripts/overflow-baseline.json` are still
ratcheted, not fixed: `/admin/advertising` 63px, `/admin/analytics` 18px, and
`app-ad-slot` 4px on the landing page.

## 70. `display: contents` ate the class, and the auth checks were reading the navbar

Reported from a phone: the wordmark on **Log in** and **Get started** had moved
to the left edge of the card and come out smaller than before. Both are mine,
from v1.137.0.

### Why a class did nothing at all

The conversion put the old class on the component — `<app-logo size="lg"
[link]="false" class="auth__brand">`. `app-logo` declares `:host { display:
contents }`, deliberately, so that dropping it into a flex row behaves exactly
as the bare `<a>` it replaced. **An element with `display: contents` generates
no box**, so `.auth__brand`'s `text-align: center` and `margin-bottom: .4rem`
styled nothing: the inline wordmark fell to the left of `.auth__card`, which is
the only box left, and the title closed up under it.

The class is back on a real `<div>` wrapper. The rule is now layout only —
`text-align`, `margin-bottom`, and `color` because the stem reads
`currentColor`. Its `font-family`, `font-size` and `font-weight` are gone,
because the component owns those; so is its `span { color: $color-terracotta }`,
which would have repainted **both** halves of the component's wordmark and was
inert only by specificity. A rule that looks like a control and is not one is
this repository's oldest habit.

⚠️ And my v1.137.0 commit message said that wordmark was "unstyled by any rule
in the repository". It was wrong: `styles.scss` has always carried
`.auth &__brand` with the size, the centring and the gap. I grepped for
`auth__brand` and SCSS nesting writes it `&__brand`.

### The shrink belonged to the nav row, not to the size

`@media (max-width: 480px) { .logo--lg { font-size: 1.25rem } }` exists because
the header has to fit **Log in** and **Get started** on one line beside the
wordmark. The auth placement is alone in its card and was being shrunk for no
reason. The selector is now `a.logo--lg`: the linked form is the header, the
footer is `md`, and the auth pages pass `link=false`. Both halves are asserted
— the auth wordmark is 25.6px at 390px, the header is 20px and still an `<a>` —
because deleting the media query would have fixed the auth pages and broken the
nav row, which is a defect `mobile-drive.mjs` exists for.

### 🔴 The real finding: every auth check was measuring the HEADER

`logo-drive.mjs` read `readLogo(page, 0)`. The navbar renders on the auth routes
too, so `app-logo` resolves to **three** hosts and index 0 is the header's. So
the checks v1.137.0 added — *"/auth/login: MA is #C4522C"*, *"MA differs from
the stem"* — were true of a wordmark **in the navbar**, and would have stayed
green with the card's wordmark any colour at all. The route was in the loop; the
subject never was.

It surfaced only because the new placement checks disagreed with it: the card's
"centre" was 141px out and the stem came back cream (`--cream` on the header's
dark bar) on a page whose card is light. The checks now resolve the host inside
`.auth__card` and assert that index exists first.

That is the fifth form of this codebase's recurring defect in two weeks: a check
that cannot fail, one that cannot see its subject, one whose subject came from
leftover data, one derived from the implementation, one scoped more narrowly
than its claim — and now one pointed at the right PAGE and the wrong ELEMENT.

### Proven by reintroduction, three ways

* Class back on the `display: contents` host → *centred … off by 102.0px*, and
  the gap check *(5px)*.
* `@media` scoped back to `.logo--lg` → both auth size checks fail at 20px.
* `@media` deleted → the header check fails at 25.6px.

⚠️ The gap threshold was wrong on its first pass: `>= 4` passed at the 5px the
title's own margin gives, with the defect fully reintroduced. The two states are
5px and 12px, so the line sits at 9px.

## 71. A room on the board that refused everyone, and a record nobody wrote

Three things reported from a live portal on 15 October. Two of them turned out
to be the same shape as every other defect in this file.

### 🔴 A letting that fell through reopened the room and nothing else

`cancel()` did one half of its job: it archived the tenancy and put the room
back to `active`, with a long comment explaining why that is right. The
application it belonged to stayed **`accepted` and un-archived**, and the
letting cycle never moved.

So, reproduced exactly:

* the tenant's own list showed an acceptance for a letting that had fallen
  through, while the inbox row for it was suppressed — one state, two readers,
  disagreeing;
* the landlord's applicant card offered no action at all, because the action
  row is hidden on an accepted application;
* and **nobody could apply.** Applications are unique per
  `(roomId, tenantId, cycle)`. The accepted tenant got *"You have already
  applied for this room"*, and every applicant `autoRejectOthers` had rejected
  when the acceptance happened was locked out too. A listing on the board,
  taking no applications from anybody who had ever wanted it, with nothing on
  either screen saying so.

The cycle now ends with the letting, exactly as `relist()` ends one: the
application closes as `withdrawn` or `rejected` depending on **who** called it
off (the same split `recordOutcome` uses for a viewing), what is left of the
cycle is archived, and the counter moves. Nobody is silently reinstated —
`undoAccept` is the 30-minute path for that — but everyone can apply again,
which is the honest state of a room that is genuinely free.

### 🔴 The notices screen was empty for almost every account

The screen says, on itself: *"This screen is the record — nothing is sent
anywhere else."* `NoticeRouter.deliver` **returned as soon as an email had
been handed off**, so no notice row was written for anybody with an email
address.

⚠️ And `NotificationsService.send` does **not throw** when email is
unconfigured: with no `RESEND_API_KEY` it logs `[email skipped — no API key]`,
records a failed `EmailLog` and resolves. So the hand-off "succeeded", the row
was skipped, and the person was told **nothing at all, anywhere**. That is the
owner's report — a shortlisted tenant who was never notified — and it
reproduced with one shortlist and an empty `GET /api/notices`.

The row is now always written; email is an extra channel, never a replacement
for the record.

### ⚠️ What that fix then exposed: an invisible button

The "Mark all as read" control only renders when something is unread — and
nothing was ever unread, because nothing was written. The moment notices
started existing, `a11y-drive` measured it at **1.00:1**: it carries
`.btn-ghost`, which is the navbar's (cream at 75% on transparent, right on the
dark header, invisible on a cream page). `.btn-ghost-light` has existed all
along. `lease-documents.ts` had the same latent mistake and is fixed with it.

A control nobody could see, behind a row nobody wrote, under a screen that
promised to be the record.

### A letting that never started is not a past letting

The archive counted both kinds together, so a tenant who had rented one room
read "Past lettings 2". Both records are kept — losing one would be the easy
wrong fix — but the called-off one now sits under **"Lettings that never
started"**, with its own count and a line saying no rent was ever owed on it.
One row template serves both sections; two copies of two hundred lines is how
the portal nav came to be defined six times.

### Notices open one at a time

Every notice rendered fully expanded, with body text running past the edge of a
phone. The head is now a real `<button>` with `aria-expanded` and
`aria-controls` (44px tall), the body opens on a tap, opening marks it read —
and `min-width: 0` on the growing flex child is what actually stops the spill,
the same property that was pushing the room page sideways by 171px.

### Proven by reintroduction, both ways

* Backend reverted → 7 checks fail, among them *"the same tenant can apply
  again to the reopened room (409)"* and *"…and it is written into their
  notices (empty)"*.
* Frontend reverted → 5 fail, among them *"only ONE of them is a past letting
  ('Past lettings 2')"* and *"collapsed, not a screen of open panels"*.

⚠️ **The first frontend negative was a false green**, and it is worth recording
why: my reverted code did not compile, `ng serve` kept serving the previous
bundle, and the drive reported 297 passed against a screen whose source was
broken — while deliberately proving those checks could fail. The drive now
looks for the build-error overlay on each screen it measures, not only at
sign-in, because a stale bundle makes every UI check in the file meaningless.

## 72. The survey could not have asked a tenant anything — Phase 9a

The owner asked for surveys to move into onboarding for BOTH roles and off the
dashboard. The audit found the first half was not a missing screen: it was
unstorable.

### 🔴 `SurveyResponse` was keyed on a landlord profile

`submit()` opened by looking up a `landlordProfile` and threw *"Only a landlord
account can answer this survey"* for anybody without one; `promptFor()` did the
same and returned null. So a tenant survey was not unbuilt — there was nowhere
to put a tenant's answer, and no way to ask.

Responses and dismissals are keyed on the **user** now, carry the **role they
answered as** (copied at answer time, so an account that changes role later
does not move its old answers into the other group's counts), and the
migration backfills the old column rather than dropping it. It fails loudly on
a row it cannot map instead of deleting it.

### The three things the old model could not express

| Missing | What it cost |
| --- | --- |
| `completedAt` | A row existed or it did not, so "answered two and left" and "finished" were the same state. Nothing could offer to resume, and no completion rate could be computed |
| `version` | Questions are JSON and answers are keyed by question id, so rewording a question in place changed what every existing answer MEANT. New wording is a new row now, and old answers stay attached to the questions actually asked |
| a tenant survey | See above |

### Where the questions are asked, and why not in the form

A dedicated route, `/welcome`, **after** the account exists. The account is
created by one POST and this is simply the next screen, so a refresh, a lost
signal, a closed tab or a skip cannot cost anybody their sign-up — the brief's
"do not disrupt account creation", enforced by sequence rather than by care.

One question per step with a progress bar, **every step saved on the server**,
so an interrupted sign-up resumes where it stopped, on a different device if
need be. Every question is optional and the screen says so before the first
one. "I will do this later" records a dismissal, honoured for 30 days, and
keeps what was already answered — a skip is not a withdrawal.

### The tenant questions are not the landlord ones with the nouns swapped

The landlord survey asks what is HARD about a job somebody already does. The
tenant survey asks what they are looking for and what goes wrong while they
look: what kind of place, when they must move, what they can pay **as a band**,
where they search now, the hardest part, what has gone wrong, and what a
listing must carry before they will spend taxi fare on a viewing. The drive
asserts the two sets share **no question id at all**.

⚠️ No exact budget figure, deliberately. A band answers the product question;
an exact number on somebody looking for a place to live is sensitive and buys
nothing — POPIA s.10, the same reasoning that keeps `room_view_days` a count
with no viewer in it.

### What came off the dashboard

Both `app-survey-prompt` mounts. In their place, ONE row at the bottom of the
task inbox — below everything where somebody is actually waiting on this
person — that reads "Finish the questions you started — 3 of 7" and disappears
when they finish or say not now. The dashboard is where you come to do your
work; it is not a place to be asked the same question weekly.

### The admin screen's own comment came true

It hardcoded one slug behind *"a second survey would need a picker; the brief
is explicit that v1 does not build one."* A second survey now exists, so
without the picker every tenant answer would have been collected and shown to
nobody. There is a picker, a date range, a landlord/tenant split that is never
added together, a completion rate (finished over started, null when nobody has
started — 0% and "nobody asked yet" are different), and a CSV export.

⚠️ The export is **counts and open text, not a row per person**. A per-
respondent file would hand away the one promise this feature makes, through a
download button.

### Three things found by running it

⚠️ **`dbQuery` returns only the first line.** A check that said "two answers
are on the server" printed one — the query was right and the reader truncated
it. Every multi-row check in every drive has been reading row one. `dbRows` now
exists beside it, and the one check that needed it uses it.

⚠️ **A negative check passed on a 401.** "The export carries no person in it"
was true of an error body. It proves the CSV is there before asserting what is
not — the same rule §67 had to learn.

⚠️ **The first negative run died on a click.** Reverting the role resolution
left nothing to click on `/welcome`, and the unguarded click threw, ending the
run before the checks below it. Guarded, as the tenancy drive already is.

### What this deliberately does NOT do

⚠️ Answers change nothing. No tenancy, application, rent record or room state
is touched by a survey answer, and nothing reads them to decide what somebody
may do — the brief's section G, left uncrossed. They are research, and the one
feature that reads them is the admin aggregate.

⚠️ The post-letting micro question is gone from the dashboard with the card.
`microQuestion` still exists per survey and the API still names it, so the
contextual prompt can come back as its own deliberate workflow — which is
what the brief asks for periodic updates, rather than re-showing the
onboarding set.

## 73. One question, at the one moment it is worth asking — Phase 9b

§72 took both survey cards off the dashboard and left a decision open: the
contextual question — one question asked at the moment it is relevant — was
removed with the card it lived in. The brief asks for exactly that to exist, as
"a separate, intentional workflow rather than repeatedly displaying the
original onboarding survey". This is that workflow.

### Two moments, one question each

**A landlord who has just marked a room let** is asked what the most stressful
part of dealing with tenants is. That is the moment it is a memory rather than
a guess. ⚠️ Q1 — how do you usually find tenants — would be the obvious
alternative and is the wrong one: asking it moments after somebody found a
tenant through Mastande invites the answer the product wants to hear.

**A tenant who has just applied for a room** is asked when they need to move.
They are thinking about moving right then, and it is the one answer that
changes what the board should show them.

### The three rules that keep it from becoming the card again

1. **It asks only a question that is unanswered.** Somebody who answered it in
   the welcome questions never sees it — the owner's rule that a survey
   answered at sign-up does not come back.
2. **Answering it is what stops it.** There is no counter and no cooldown to
   get wrong.
3. **"Not now" on one question does not silence seven.** In full mode that
   button is a 30-day dismissal; in micro mode it only closes the card.
   Silencing a whole survey because somebody waved away one question, while
   busy finishing something else, would be the prompt deciding more than the
   person did.

### ⚠️ The bug this would have shipped with

`submit()` marks a response **complete**. The card's existing send path used
it, so answering the single contextual question would have recorded a
seven-question survey as **finished with six questions never asked** — and the
inbox row offering to finish them would have disappeared along with them.
`submitMicro()` saves with `complete: false`, so the answer merges into the
same open set and the inbox still says "1 of 7 done".

### And the check that could not see it

The first version of the drive asserted the API contract — POST with
`complete: false` leaves the set open — and that check passed happily with the
component reverted to `submit()`. **The component is the caller; a check on
the endpoint cannot see which call it makes.** So the drive now applies for a
room in a browser, answers the card, and reads the database: the set must
still be open with one answer.

Removing rule 1 then produced a *green* run too, because nothing exercised it:
`GET /prompt` rightly still returns the survey (six questions are open), and
only the card decides to render nothing. The drive now applies for a SECOND
room and asserts the question is not asked again.

Both of those are the same lesson in two coats: a check pointed at the thing
below the defect passes while the defect ships.

## 74. Searching by when you can move — Phase 10

The board could answer "is this free more or less now?" and nothing else. The
question people actually arrive with is a date: *I have to be out of my place
by the 1st of December.*

### What already existed, and what did not

`Room.availableFrom` has always existed, is **required** on create and is NOT
NULL in the database — so every listing already carries a date. What was
missing was any way to search on it: one boolean, `availableNow`, defined as a
fortnight's window, and a card badge that agreed with it. No date, no window,
and a board that said "available now" on some cards and nothing at all on the
rest.

### The matching rule, in one line

A room qualifies when it is free **on or before** the date asked for. The
owner's own example, asserted to the day: for a 1 December search, a room free
on 25 November qualifies, a room free on the 1st qualifies, and a room free on
15 December does not — however well it matches on everything else.

For somebody flexible, a window. ⚠️ **The far end is the bound, not the near
one.** Somebody free to move any time in December will take a room that frees
up on the 15th *and* one standing empty today; what disqualifies a room is
becoming free after the last day they can move. A clause keyed on the window's
start would have hidden every empty room — most of what they want to see — and
the drive fails on exactly that if the bound is moved.

### ⚠️ Timezone, which is a whole day in both directions

`availableFrom` is stored from a date-only string, so it lands at **midnight
UTC** — 02:00 in Johannesburg. A tenant asking for 1 December means any time on
the 1st where they live. So the comparison is against the **last instant of
that day in SAST**, written explicitly as `+02:00` rather than taken from the
server (UTC) or the browser (wherever the person happens to be). SAST has no
daylight saving, so a fixed offset is correct all year. `ViewingsService`
pins Africa/Johannesburg for the same reason.

### One clause, built once

`availableNow` and `moveIn` both constrain `availableFrom`. Two keys of that
name in the same object literal keep only the last — the exact defect the
household filters above carry a warning about, a filter that looks set and
does nothing. They are combined into one bound, the tightest of those set.

On screen the two are made exclusive anyway: picking "as soon as possible"
clears a typed date and typing a date unticks the chip. Both *work* together,
but a chip left lit beside a date in March tells somebody their search is
narrower than it is.

### Every card says when, not just the immediate ones

"⚡ Available now" as before, and "📅 From 25 November" on everything else. A
board that marks the immediate rooms and stays silent about the rest leaves a
reader to guess, and the guess is always "probably now".

⚠️ **There is no "availability date not confirmed" badge, because there is no
such state.** The field is required by the DTO and the column is NOT NULL: a
listing without a date cannot be created through the API or stored if it were.
Building a label for it would be a branch nothing can reach — the fault this
file keeps recording. The drive asserts the refusal and reads
`information_schema` for the NOT NULL, so if the field ever becomes optional
those checks fail and the label becomes real work.

### Clearing the date without losing the search

The empty state names the date, offers **"Search without a date"** as its main
button, and says the other filters stay. Making somebody clear every filter to
loosen one is how a search gets abandoned instead of widened.

### What searching does NOT do

A move-in date is a **search criterion**. Nothing is reserved, no tenancy
starts, no landlord is told — the drive asserts the room is byte-for-byte
unchanged after a search. And a landlord moving their own date reaches the
board immediately **without touching applications**: the drive applies for a
room, pushes the date back a month, and asserts the application is still
`pending`.

### Three reintroductions

* Window keyed on its start → *"widening the window brings in the room that
  frees up later"* fails, and the count check fails at 3 vs 3.
* Comparison inverted (`gte`) → all four boundary checks fail.
* The card's future-date badge removed → *"one that is not says WHEN it will
  be (none)"*, and 2 badges for 12 cards.

⚠️ And two faults in the drive itself, both found by running it: a count
comparison between two filters was comparing **capped pages** (50 versus 50,
proving nothing) until every search was scoped to the run's own rooms; and the
drawer "opener" was matched by the word *filter*, which also finds "Clear all
filters" **inside** the panel — so the drive clicked a button that cannot
close the sheet and timed out against an overlay that was never going away.

## 75. The two repository variables the deploy verifier reads

**Status: not done as of 20 October.** This was reported as done and it is not,
which is worth stating plainly because the thing that reported otherwise was a
green tick.

Neither value can be set or even read from a coding session: `gh variable list`
returns `HTTP 403: Access to this GitHub Actions path is not permitted through
this proxy`, and the GitHub MCP server exposes no variables API. The only
evidence available from here is a workflow log, which is how both faults below
were found.

### What to set

Settings → Secrets and variables → Actions → Variables:

| Variable | Value | Branch it verifies |
|---|---|---|
| `STAGING_API_HOST` | `mastande-api.onrender.com` | `develop` |
| `PRODUCTION_API_HOST` | `api.umastande.co.za` | `master` |

That mapping comes from `render.yaml` and nowhere else: `mastande-api` carries
`branch: develop` and `APP_ENV=staging` (line 51); `rentboard-api` carries
`branch: master` and `APP_ENV=production` (line 197). Host only — no scheme, no
trailing slash; the workflow prefixes `https://`.

### Confirmed still unset at 18:11 UTC on 20 October

Runs 90 (`master`) and 91 (`develop`), dispatched after the fix landed. Both
logs print the variables GitHub actually holds:

```
PRODUCTION_API_HOST:
STAGING_API_HOST: rentboard-api.onrender.com
```

Run 91 then reached the live service and the new assertion did its job:

```
Verifying staging at https://rentboard-api.onrender.com
{"status":"ok","db":"connected","version":"1.158.0","env":"production",...}
✅ serving 1.158.0, which is the version in this commit
❌ STAGING_API_HOST points at a production service, but this run is
   verifying staging.
```

The service says `"env":"production"` itself. That is the whole fault, in the
service's own words, and the check now stops there instead of carrying on to
blame `APP_ENV`.

### The two faults this replaced

**`PRODUCTION_API_HOST` was never set, and the check went green anyway.** Run
88 on `master` is `success` in the Actions list. Its log reads:

```
TARGET_BRANCH: master
PRODUCTION_API_HOST:
⏭️  No PRODUCTION_API_HOST repository variable is set.
```

The skip path was `exit 0`, so every push to `master` since §59 reported a pass
while verifying nothing — the green tick *was* the unset variable. It is `exit
1` now. An unset variable can no longer look like a verified deployment.

**`STAGING_API_HOST` held the production host.** It was
`rentboard-api.onrender.com`. Run 89 on `develop` failed with:

```
❌ STAGING IS CRAWLABLE. Check APP_ENV — it must be 'staging', not 'production'.
```

`APP_ENV` was correct. The check had fetched **production's** `robots.txt` —
`Sitemap: https://www.umastande.co.za/sitemap.xml`, crawlable, exactly as
production should be — and blamed a variable that was right. A check that
misdiagnoses costs more than one that stays quiet, because somebody then goes
and changes `APP_ENV` on a working service.

The verifier now reads `env` from `/health` and asserts the service identifies
as the environment the branch claims, before anything judges how it behaves. A
wrong host says so and names the variable.

**And the comment telling you what to set it to gave the production host.** It
read "to the host staging actually serves from — today
`rentboard-api.onrender.com`". That was true before the 13 October rename, when
one service served everything, and nothing came back to it afterwards; the
file's own header said the same thing three paragraphs higher. Both now carry
the table above and are marked as history. The wrong value was set because the
repository asked for it.

### How to tell it worked

Actions → Verify deployment → Run workflow, once on `develop` and once on
`master`. Each log should contain:

```
✅ serving <version>, which is the version in this commit
✅ the service identifies as staging        (or production)
✅ database is connected
✅ staging is healthy, current, and refuses all crawlers
```

The second line is the new one and it is the one to look for. If a run says
`points at a production service, but this run is verifying staging`, the
variable still holds the wrong host.

### What breaks if it is skipped

Nothing visible, which is the problem. Render deploys out-of-band, so GitHub
reports nothing about a deploy on its own; this workflow is the only signal
there is. Unset, `master` now goes red rather than falsely green — and a
production deploy that failed, or came up labelled `staging` and therefore
invisible to every search engine, would otherwise be indistinguishable from a
healthy one from inside GitHub.

---


## 76. A stale Prisma client blames the file that uses it

**Hit on 20 October, immediately after staging was migrated.** The survey seed
failed with six TypeScript errors, every one of them pointing into
`prisma/seed-survey.ts`:

```
prisma/seed-survey.ts:100:14 - error TS2353: Object literal may only specify
  known properties, and 'slug_version' does not exist in type 'SurveyWhereUniqueInput'.
prisma/seed-survey.ts:140:39 - error TS2339: Property '_count' does not exist
  on type '{ id: string; slug: string; title: string; … }'
```

Nothing was wrong with the seed script, the schema, or the database.
`node_modules/.prisma/client` was generated from a schema older than
16 October, so it had never heard of `Survey.version` or the
`@@unique([slug, version])` that `slug_version` is the client's name for.

### The fix, if you hit it

```bash
cd backend && npx prisma generate
```

Then re-run whatever failed. One command, no migration, no reinstall.

### Why it happens, and why it will happen again

`prisma migrate deploy` does **not** regenerate the client — only
`migrate dev` does. `postinstall` regenerates it, but only on install. So the
ordinary sequence of `git pull` → migrate → run leaves the client exactly one
step behind the schema, and every error names a caller.

**Note what the type in the error message actually lists.** It prints the
Survey model the *client* knows — `{ id, slug, title, intro, questions,
audience, active, createdAt, updatedAt }`, with no `version` and no relations
at all. That object is the evidence, and it says the client is old rather than
the code being wrong. Worth reading rather than scrolling past, because six
errors in one file read as a broken file.

### What now prevents it

`npm run seed:survey` and `npm run seed:house-ads` run `prisma generate`
first, so the documented path cannot meet a stale client. Use those rather
than `npx ts-node prisma/seed-survey.ts`; pass `--apply` as
`npm run seed:survey -- --apply`, which is verified to forward (`Mode: WRITE`).

`scripts/prisma-client-check.mjs` is the diagnosis for everything else — the
API build, `db:seed`, the drives. It compares every model, field, enum and
enum value in `schema.prisma` against the generated client's own DMMF and
names what is missing:

```
❌ The generated Prisma client is STALE.
   schema.prisma declares these, and the client does not:
     · Survey.version
     · SurveyResponse.completedAt
     · SurveySource.onboarding
   Fix it with one command:
     cd backend && npx prisma generate
```

Run it with `cd backend && npm run prisma:check`.

⚠️ **It cannot be a guard inside the seed script, and that is the whole
design constraint.** The seed script does not *compile*, so ts-node rejects it
before a line of it runs — a check written at the top of the file can never
execute, because the thing it would report is what stops it running. It has to
be a separate process that does not import the generated types at all, which
is why it reads the DMMF (plain runtime JSON, present whatever state the types
are in) rather than the client's types.

Falsified by reproducing the exact state: generated the client from the
pre-16-October schema, restored the current schema, and confirmed the checker
reports `Survey.version` and ten others including an enum value. Confirmed the
same stale client reproduces all six original errors at identical lines,
columns and codes (`[2353, 2353, 2339, 2339, 2339, 2353]`).

---


## 77. Record the two database endpoints in migrate-targets.json

**One assertion, twice, and then the migrate script can check itself.**
`scripts/migrate-targets.json` ships with both endpoints `null`, and
`scripts/migrate-remote.sh` **refuses** on `null` rather than skipping — an
unrecorded environment is the state in which there is no check, so it must not
also be the state in which the script quietly proceeds.

### What to do

```bash
bash scripts/migrate-remote.sh --env staging
```

It prints the endpoint it was handed and refuses. **Do not paste that value in
on the strength of that message.** Get it from the environment's own service in
the Render dashboard — Environment → `DATABASE_URL`, on `mastande-api` for
staging and `rentboard-api` for production — and record it:

```json
"staging":    { "endpoint": "ep-…", "service": "mastande-api",  "branch": "develop" },
"production": { "endpoint": "ep-…", "service": "rentboard-api", "branch": "master"  }
```

An endpoint is the first label of the hostname with any `-pooler` removed, so
one value covers both URLs of the same database:

```
ep-x-y-123-pooler.c-5.eu-central-1.aws.neon.tech  ->  ep-x-y-123
ep-x-y-123.c-5.eu-central-1.aws.neon.tech         ->  ep-x-y-123
```

Commit it. Every run after that is checked.

⚠️ **Recording the value is the one step nothing can check for you.** Nothing
in a Neon hostname says which environment it is — that is the fact being
written down. Take it from the dashboard rather than from whichever shell you
last exported, because a wrong value recorded confidently is worse than a
`null` that refuses.

A hostname is not a credential. The password lives in the connection string
you export and is never printed, logged or stored.

### Why, and what it already caught

Before this the script could tell a remote database from a local one, and a
pooled host from a direct one, but **not staging's Neon branch from
production's**. Both are `ep-*.neon.tech`; both passed every check. So the one
command in this repository that WRITES printed `✅ Applied to ep-…` without
ever saying which environment that was. §5a is the hour of downtime that shape
of mistake already cost.

🔴 **And it printed a host it was not writing to.** `Apply these to $WHERE?`
and `✅ Applied to $WHERE` both came from `DATABASE_URL` — the *pooled* url —
while `prisma migrate deploy` connects through `directUrl`, i.e. `DIRECT_URL`.
Hand it one environment's pooled url and another's direct url and it would
name the first, migrate the second, and report success. Nothing checked the two
were even the same database. They are now required to be, and every line it
prints names the connection the migration actually uses.

All six paths driven with fake endpoints before the real ones were recorded:
no `--env` refuses; `--env dev` refuses; an unrecorded endpoint refuses and
prints what to do; **asking for staging while handing it production's database
refuses with "🔴 THAT IS THE production DATABASE"**; a mixed pooled/direct pair
refuses naming both endpoints and what it would have claimed; and a recorded,
matching pair reaches the prompt, which now reads
`Apply these to <direct host> (staging)? [y/N]`.

⚠️ One defect found by driving it rather than reading it: `TARGETS` was built
with a relative `$(dirname "$0")` **after** the script's own `cd` into
`backend/`, so the lookup died with a `MODULE_NOT_FOUND` stack trace instead of
the message it was written to print. It failed safe — exit 1, nothing migrated
— but a guard that reports itself as a crash is one nobody trusts next time.
`SCRIPT_DIR` is resolved absolutely before the `cd` now.

---


## 78. Both Neon database passwords were committed — ✅ ROTATED 20 October

**✅ DONE. Both passwords were rotated in Neon, both Render services updated
and redeployed, and both verified serving with the new credential** — runs 97
and 98 at 19:37 UTC:

```
production  {"status":"ok","db":"connected","version":"1.159.0","env":"production","uptime":172}
staging     {"status":"ok","db":"connected","version":"1.159.0","env":"staging","uptime":39}
```

`db: connected` on both is the assertion that matters: a mis-pasted string
would have come back `"db":"unavailable"` with `status: degraded`, and the
short uptimes line up with the redeploys. ⚠️ That proves the NEW credential
works. It does not prove the old one is dead — only Neon's role history shows
that, and a leaked credential should not be tested even to confirm it is
revoked.

The rest of this section is the record of what happened and what now prevents
it. Nothing here is outstanding.

**Both database passwords went into public git history.**

On 20 October `scripts/migrate-targets.json` was filled in with the full
`DATABASE_URL` of both databases — user, password, host and query string —
copied from the Render dashboard, and pushed to `origin/develop` in commit
`b4c9852`. The `endpoint` field wanted a hostname fragment.

### What is exposed

Both Neon roles, for the staging and the production database. Each string
carries `neondb_owner` and its password, which is full read-write on that
database: every landlord, every tenant, every phone number, every application,
every verification outcome. Under POPIA that is a reportable personal-data
exposure if it was accessed.

### Rotate, do not delete

```
Neon console → the project → Roles → neondb_owner → Reset password
```

Production first. Then update `DATABASE_URL` and `DIRECT_URL` on the matching
Render service (`rentboard-api` for production, `mastande-api` for staging) and
redeploy, or the API will come up unable to reach its database.

⚠️ **Deleting the line is not a fix and neither is a revert.** The blob stays
in the history, in every clone and every fetch, and GitHub serves it by SHA
indefinitely — a commit that is no longer reachable from any branch is still
served at its URL until GitHub garbage-collects, which can be asked for but
not relied on. Rotation is the remedy. Assume the strings are known.

### What limits the damage

When first measured the leak was on `develop` only: `b4c9852` was not an
ancestor of `master`, and `origin/master`'s tip had never carried the file
with credentials in it. Verified with `git merge-base --is-ancestor`.

⚠️ **That is no longer true, deliberately.** `develop` was merged to `master`
later the same evening and `b4c9852` is now in `master`'s ancestry too. That
was judged acceptable rather than overlooked: the passwords were already
rotated and dead, and GitHub serves a blob by SHA regardless of which branch
references it, so the merge changed the reachability and not the exposure. The
alternative — a squash merge to keep that one commit out of `master` — would
have left `develop` carrying it anyway and made every later merge diverge.

The reason this paragraph was rewritten rather than left: it said "the leak is
on develop only", and a document that goes on asserting a narrower blast
radius than is true is the same failure as the comment that handed out the
production host for a week.

The values are replaced with endpoint ids, which is what the field was always
for and which carry no credential:

```
staging     ep-flat-flower-b1my1tch
production  ep-royal-hill-b1vy1vmt
```

Those also confirm, incidentally, that the 20 October staging migrate and
survey seed did reach **staging** — `ep-flat-flower-b1my1tch` is the staging
endpoint, and it is the one both of those runs printed.

### Why it happened, and what now stops it

This file told the operator to get the value from "Environment →
`DATABASE_URL`", and what you find there is a connection string. A field that
invites a secret will eventually be given one, so two guards now exist rather
than a sterner comment:

- `scripts/migrate-remote.sh` **refuses** a recorded value containing `://`
  or `@`, names the rotation as the remedy, and shows the endpoint-id form.
- `scripts/secret-scan.mjs` fails the commit, in the pre-commit hook. It
  flags Neon `npg_` passwords, database URLs carrying a password for a
  non-local host, and private-key blocks, and it prints the line **redacted**
  so the gate's own output does not become a second copy.

⚠️ It is calibrated rather than guessed: `localhost` credentials are not
secrets and are in this repository legitimately (`README.md`,
`scripts/lib/drive-session.mjs`), and a gate that flagged those would be
switched off within a day. Eleven patterns classified correctly, including
both real leaked lines, both legitimate localhost strings, the documented
`postgresql://…-pooler…` placeholder, and an elided `npg_...` in prose.
Falsified by putting the real leaked value back and watching both guards fire.

---


## 79. Two defects the integration tests found — both fixed, residue VERIFIED CLEAR

✅ **CLOSED 21 October 2026.** Both defects fixed, both fixes deployed to
production in v1.164.0, and both residues measured against the production
database rather than assumed away.

The residue check was run in the Neon SQL editor against `neondb` on the
production endpoint `ep-royal-hill-b1vy1vmt`:

```
control_users 4 · control_rooms 2 · control_properties 1 · control_tenancies 2
orphaned_tenancies 0 · bad_province_yards 0 · db neondb
```

⚠️ **The controls are the point, and the first attempt had none.** Run as two
bare `SELECT`s, both came back "Statement executed successfully" — which is
what Neon shows for a query returning no rows, and also what you would see on
a branch holding no data at all. A zero-row grid and a query that never
reached the real tables are indistinguishable. The rewritten check returns one
row of counts, including four totals that must be non-zero for the findings to
mean anything, and `current_database()` so the answer carries its own label.

**What the controls also say:** production holds 4 users, 2 rooms and 1
property. The §79a exposure — two people told they have the same back room —
was therefore almost certainly never realised on a live letting. The fix was
still right, and far better shipped before the board fills up than after.


Both are recorded as passing tests that assert **what the code does**, with the
reasoning beside them. Neither was fixed, because both are changes to business
behaviour and that is not a test engineer's call to make alone.

### 79a. ✅ FIXED — undoing an acceptance left a live tenancy

`ApplicationsService.undoAccept` runs a transaction that puts the application
back to `shortlisted`, reinstates the applicants the acceptance rejected, and
returns the room to the board. **It does not touch the tenancy**, which
`accept` opened.

Measured end to end, every step over HTTP:

```
undo-accept                    200
confirm-start on the orphan    200     ← the move-in can still be confirmed
tenancy status                 active
room status                    active
rooms on the public board      1       ← a taken room, publicly listed
a different tenant applies     201     ← and they can apply to it
```

So after an undo the room is **let and advertised simultaneously**, and a
second acceptance would open a second tenancy: two people told they have the
same back room. For a product whose whole position is trust, that is the
expensive kind of wrong.

**Fixed 21 October.** The tenancy is now deleted inside that same
transaction, scoped to `status: 'pending'` so the path can never remove a
letting somebody has moved into.

⚠️ **Deleted rather than cancelled, and the code decided it.**
`createFromApplication` is idempotent on `applicationId` — it returns any
existing tenancy rather than opening a new one. A row left behind as
`cancelled` would therefore be handed straight back when the same applicant
is accepted again, letting the room against a cancelled tenancy: one
inconsistency traded for another. `cancelled` also means "fell through before
move-in" and feeds the review and rating rules, and an acceptance reversed
inside thirty minutes is not a letting that fell through — it is one that
never happened.

Four tests in `backend/test/failure-modes.int-spec.ts` cover it: the tenancy
is gone after an undo, the move-in can no longer be confirmed, accepting the
same applicant again opens a FRESH pending tenancy (the case that decided
delete over cancel), and a confirmed letting survives a later undo attempt.
Falsified by removing the fix — three of the four fail; the fourth guards the
`pending` scoping rather than the fix, and correctly passes either way.

### ⚠️ The fix prevents new orphans. It does not repair existing ones.

Any tenancy already left behind by an undo before v1.163.0 is still there,
still `pending`, still confirmable. The fix changes `undoAccept` from that
release onward and touches no existing row.

Run this against production to find them — it is a SELECT and safe:

```sql
SELECT t.id, t."roomId", t."applicationId", t."createdAt"
FROM   tenancies t
JOIN   applications a ON a.id = t."applicationId"
WHERE  t.status = 'pending'
AND    a.status <> 'accepted';
```

Each row is a room that may be let and advertised at once. If any come back,
the repair is to delete those tenancy rows — the same thing the fix now does
at the moment of the undo — but look at them first: a `pending` tenancy whose
application is `withdrawn` or `rejected` for some other reason is the same
shape and may have a different cause.

⚠️ There is no way to count them from a coding session: production is not
reachable from here (`connect_rejected` by the egress policy), so this is a
query for somebody with the Neon console, not a number this document can
state.

### 79b. ✅ FIXED — a yard could be created in a province that does not exist

`PropertyDto.province` is `@IsString() @MinLength(2) @MaxLength(120)`.
`CreateRoomDto.province` and `RoomFiltersDto.province` are both
`@IsIn(SA_PROVINCES)`. Three handlings of one field, two of which agree.

Not cosmetic: the board's province filter accepts only the nine real
provinces, so a yard stored as "Atlantis" can never be reached by the filter
that exists to find it, while looking saved.

**Fixed 21 October.** Both `CreatePropertyDto.province` and
`UpdatePropertyDto.province` are `@IsIn(SA_PROVINCES)` now. They are separate
classes rather than a `PartialType`, so each had to be changed — and each is
falsified separately: reverting create fails one test, reverting update fails
a different one.

⚠️ **The risk I flagged turned out to be much smaller than it looked, and
measuring it is what showed that.** I expected tightening this to start
refusing edits to yards already stored outside the list. It cannot break the
landlord's form: the province control is a `<select>` bound to
`SA_PROVINCES`, so the UI has never been able to submit anything else. Only a
direct API call could, which is exactly what this now refuses. An edit that
does not mention the province is unaffected, and there is a test for that
because it is the ordinary case.

Five tests in `backend/test/properties.int-spec.ts`: an invalid province
refused on create, **all nine real provinces accepted** (so the fix cannot
have narrowed the list by accident), the room side agreeing, an invalid
province refused on update with the record left alone, and an ordinary edit
still working.

⚠️ **Prevents new ones; repairs none.** Any yard already stored outside the
list keeps its province until somebody edits it. To find them:

```sql
SELECT id, name, province FROM properties
WHERE province NOT IN (
  'Eastern Cape','Free State','Gauteng','KwaZulu-Natal','Limpopo',
  'Mpumalanga','Northern Cape','North West','Western Cape');
```

Any row that comes back is a yard the board's province filter cannot find.
Editing it through the landlord's form repairs it, because the select offers
only valid values.

---


## 80. Phase 3 of the integration suite — private documents and account lifecycle

73 further integration tests: viewing invitations (19), reviews and safety
reports (18), private documents (17) and the account lifecycle (19). The
suite now stands at **91 unit + 137 integration, all executed**, and every
one of the new specs was falsified by reintroducing the defect it exists to
catch — twelve mutations in all, each one caught by the test named beside it.

### 80a. What the document specs assert, and why not a unit test

CLAUDE.md states the POPIA position as "documents stay private, are deleted
per the existing retention pattern, and **only outcomes persist**". No single
function holds that promise: the path is stored by `VerificationService`,
withheld by two different response shapes, signed with an expiry at the
storage edge, cleared inside a transaction, queued in a second table, and
drained after the commit. A unit test of any one of those passes while the
promise is broken — and this repository has already shipped both broken
halves. `documentPath` once went raw to the admin screen (a relative path
with no endpoint, so no reviewer could open a document at all), and
`documentDeletedAt` was a column that deleted nothing.

So the assertions are on the **effect**, never on the wording of a response:
a committed `file_deletions` row carrying the path and the request id, a
`documentPath` that is null and a `documentWithdrawnAt` that is not, a signed
URL that is not the stored path and that was asked for with a bounded
expiry, and an immediate deletion pass rather than a wait for the hourly
cron — because the screen says "as soon as someone has looked at it", not
"within the hour".

Falsified five ways, each against the real build: echoing `documentPath`
back to the submitter, leaving the path in place on review, never queueing
the deletion, leaving it to the cron, and handing the admin queue the raw
path. All five were caught.

`StorageService.enqueueDelete` is **kept real in the test double**, and that
is deliberate: it is not a network call, it is the durable row that is the
whole retention guarantee. Stubbed, the POPIA assertion becomes a test of
the stub.

### 80b. A fixture whose subject was already in the end state

The first run of the account-lifecycle spec "failed" on deactivation not
pausing a landlord's listing. It was the test that was wrong, and in a way
this file has a name for: `createLetting` accepts the application, which
moves the room to **`let`** — and a let room is already off the public board
and is correctly **not** paused by deactivation, whose filter is
`active`/`reserved`. The tenant lives there.

So the fixture handed the test a room that could not demonstrate the thing
under test, and a greener-looking version of the same test (asserting only
"not on the board") would have passed without ever pausing anything. The
pausing specs build a published, un-let room of their own.

### 80c. My own check pointed at a column that does not exist

Two report assertions read `row.resolvedAt`, and the `Report` model has no
such field — the resolution state is `status` plus `reviewedAt`,
`reviewedById` and `resolutionNote`. `expect(undefined).toBeNull()` failed
loudly, which is the only reason it was caught; written as `toBeFalsy()`,
the same mistake would have passed for ever against a report that arrived
already dismissed. They now assert all four real columns, and the mutation
that stamps a new report `dismissed` fails them.

### 80d. The rate limiter is real enough to break the suite

`DELETE /account` allows ten attempts per quarter hour, counted per IP in
memory, and the deletion specs need more than ten accounts ended — so the
suite arrives as one very busy person and the failure reads as a 429 in a
test about erasure. `resetRateLimits(ctx)` clears the counters **between**
cases, which is the test-time equivalent of the API restart CLAUDE.md
already prescribes for the browser drives.

⚠️ A reset like that is one step from switching a control off, which is the
defect this repository keeps shipping. So one case asserts the limit still
bites — eleven refused attempts inside a single test, where no reset
intervenes, expecting ten 403s and a 429 — and it was falsified by raising
the decorator's limit to 100000, which failed it. The limit is in full force
for the duration of every test; only the carry-over between tests is
cleared.

### 80e. Correction to the record in commit `15fbacc`

That commit message says workflow run 116 "was still polling when the
15-minute ceiling reached it". It was not: it completed in about 8m20s,
roughly 15.3 seconds per attempt, and printed its diagnostic. The conclusion
drawn from it — that Render never started a deploy for `b94814c` — stands on
runs 114 and 116 both reporting production on 1.162.0 with `uptime` rising
2536 → 3084 across 51 continuous minutes, which is unaffected. Recorded here
because a wrong fact in a commit message cannot be edited out of history.

---


## 81. 🔴 v1.163.0 never deployed, and CI had said so for four runs

**Found 21 October, by reading CI instead of guessing at Render.** Both
services — staging `mastande-api` and production `rentboard-api` — were
serving **1.162.0** while `master` carried 1.163.0. I had reported the
release as shipped and gone looking for an explanation in the Render
dashboard. The explanation was in this repository, in a red CI run I had not
opened.

### What actually broke

`backend/package-lock.json` and `package-lock.json` were regenerated with
`--legacy-peer-deps` (the workaround for an npm `edgesOut` crash while
installing the test tooling). That flag **omits the peer tree**, so the
lockfiles shipped without `react`, `react-dom` and `scheduler` — peers of
`@react-email/render`, a production dependency of the backend — and without
`typescript@7.0.2` at the root.

`npm ci` refuses an out-of-sync lockfile. So:

```
> [builder 4/8] RUN npm ci
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json … are in sync.
npm error Missing: react@19.3.1 from lock file
…
Dockerfile:37
ERROR: failed to build … exit code: 1
```

Render builds that Dockerfile. A failed build leaves the previous image
serving, which is **exactly** the failure the Dockerfile's own comment
records from v1.62.0 — `postinstall: prisma generate` broke the production
stage and "Render went on serving v1.61.0 through five releases". Same
mechanism, two lockfiles instead of one script.

Four CI jobs were red on every run from v1.163.0 onwards:

| Job | Step that failed | Cause |
|---|---|---|
| Backend image builds and boots | `Build the production image` | backend lockfile, `Dockerfile:37` |
| Backend — Typecheck, Test, Build | `Install` | backend lockfile |
| E2E — browser journeys | `Install (root, for Playwright)` | root lockfile |
| Frontend — Typecheck, Test, Build | `Environment parity`, `CSS coverage` | two separate defects, below |

### ⚠️ The gate worked. I did not read it.

This is not a missing check — the docker job added in v1.67.0 exists for
precisely this, and it caught the breakage on the first run that contained
it. Every conclusion I drew about the stuck deploy ("Render never started a
deploy", "check the dashboard Events") was reasoning about a remote system
whose answer was sitting in a workflow run I could have opened at any point.
**Reading CI is part of pushing, not a separate task**, and a release is not
shipped because a push succeeded.

Fixed by regenerating both lockfiles with plain `npm install
--package-lock-only`. The diffs add nothing but the four missing packages.
Falsified both directions, in a staged copy of the Docker build context:
the shipped lockfile exits 1 on `npm ci` and on `npm ci --omit=dev
--ignore-scripts`, the regenerated one exits 0 on both.

### 81a. env-parity needed a dependency its CI job never installed

`Environment parity` runs in the frontend job, which installs `frontend`
only. The script was builtins-only like every other audit there until §77
had it parse `render.yaml` per service — at which point it imported
`js-yaml`, a ROOT devDependency, and from that commit on the step died with:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'js-yaml'
  imported from .../scripts/env-parity.mjs
```

It reads as a broken environment check and was a missing install. The job
now installs the root dependencies (`--ignore-scripts`, because the root
`prepare` runs husky and exits 127 on a runner with no hooks path) before
the step. Reproduced in a clean `git archive` checkout with no root
`node_modules`: ERR_MODULE_NOT_FOUND and exit 1 before, exit 0 after.

⚠️ A script that grows a dependency silently changes which jobs can run it.
Nothing in the workflow stated that the audits in that job are
builtins-only, and nothing checked it.

### 81b. `.sr-only` had no rule, so screen-reader text rendered on screen

The search chips added in checklist row 104 use `class="sr-only"`. A rule for
it exists only inside the scoped `styles` of `star-rating.ts` and
`surveys.ts`, so in `home.ts` it has **no rule at all** — and "Remove the
location Johannesburg", "Remove the province Gauteng" and "Remove the room
type" rendered as visible text beside every chip on the board.

This repository already has the global class for it, `.visually-hidden`,
whose comment records the same bug shipping once before: welcome-survey wrote
`class="visually-hidden"` before any rule defined it, "so the prompt appeared
twice on every free-text step. The class did the exact opposite of what it
says." `home.ts` now uses `.visually-hidden` — one vocabulary, one rule.

`scripts/css-coverage-audit.mjs` caught it (`1 NEW class(es) … styled
nowhere`), which is the gate doing its job in a run nobody opened. It reports
0 new after the fix.

### 81c. Two concurrent integration runs silently destroyed each other

Found while re-verifying this fix: a background run and a foreground run of
the same suite produced **40 failures across four files** — missing
applications, missing tenancies, 404s on rows that had just been created.
Every one read as a product bug. Run alone, the same commit was 137 passed.

The suite truncates every table between cases, so two runs sharing one
database delete each other's fixtures mid-test. `fileParallelism: false`
does not cover it: that serialises files within one vitest process and says
nothing about a second process.

`global-setup.ts` now takes a session-level Postgres advisory lock with
`pg_try_advisory_lock` and refuses by name when it cannot get it. Session
level, so a crashed run cannot wedge the suite. Driven: the holder passes
21/21 while a second run refuses with "Another integration run already holds
mastande_integration_test", and the next run after it passes 17/17.

---


## 82. CI had been red since before the test work, and three things were hiding in it

Reading CI properly (§81) showed the lockfiles were not the only thing in
there. Job by job, back through the runs:

| Runs | What was failing | Whose |
|---|---|---|
| 248–250 | `E2E — app journeys`, `CSS coverage`, `Environment parity` | all three pre-date the test work |
| 251 | + backend `Test`, root `Install (for Playwright)` | the unit-suite commit |
| 254 onwards | + **`Build the production image`** | the lockfiles — the one that stopped deploys |

So the docker job, the only one that gates a deploy, was green until 254 and
red from then on, which is exactly when releases stopped landing. The other
three had been red for days with nobody reading them, which is how a gate
stops being a gate.

### 82a. Three e2e specs failed on a redirect that changed five days earlier

`e2e/helpers.ts` asserted that creating an account lands on
`/{role}/dashboard`. Since `5061bc3` (16 October, "surveys for both roles,
asked at sign-up instead of on the dashboard") it lands on **`/welcome`** —
deliberately, and the component says why: the account exists and the session
is set by the time that screen appears, so skipping, refreshing or closing
the tab there costs nothing.

Every spec that registers a user goes through that helper, so
`account-settings`, `application-lifecycle` and `listing-wizard` all failed
with `unexpected value "http://localhost:4200/welcome"` — a stale test, not
a broken app.

Fixed by walking the journey a person walks: assert `/welcome`, press "I
will do this later", then assert the dashboard. **Not** by widening the
pattern to accept either destination, which is the tempting one-character
fix and would leave a helper that no longer notices if the redirect broke.

Reproduced and fixed locally against the real app (API on :3000, a
development build served on :4200): 3 failed → 3 passed. Falsified by
pointing the register component at `/` instead of `/welcome`, rebuilding,
and proving the bugged build was the one answering — the spec failed with
`unexpected value "http://localhost:4200/"`. The mobile board suite passes
alongside it, 3 of 3.

### 82b. An unused import was an ERROR, not a warning

`signUp` was imported into `failure-modes.int-spec.ts` and never used.
`@typescript-eslint/no-unused-vars` reports that as an error, and the lint
step deliberately runs without `--fix` so CI reports on the code that was
pushed. 1 error 45 warnings → 0 errors 44 warnings; the remaining warnings
are pre-existing `no-explicit-any` in fixtures and are not gating.

The same pass removed an `eslint-disable-next-line no-console` in
`global-setup.ts` that had nothing to disable — the rule does not fire
there, so the directive was itself reported. A control with no subject, in
the file whose whole job is to refuse before the suite can do damage.

---


## 83. Five accessibility findings, and why none of them could be seen locally

The sweep is `scripts/a11y-widths.sh` — 33 pages at 360 / 390 / 768 / 1280.
Run with the house ads seeded and with admin credentials, it found five
things. **Every one was invisible for a DATA reason**, which is §56 in this
list under a different hat: a check whose subject comes from whatever
happened to be in the database.

| Finding | Why nothing saw it |
|---|---|
| `/` went H1 → H4 | house ads live in the database; a dev database with no campaigns renders no slot |
| `/admin/services` label 380×22 | a local sweep without `ADMIN_EMAIL` prints "SKIP the admin screens" and reports clean |
| `/admin/analytics` scrolled sideways 14px at 360px | the spill depends on how long the numbers are; a freshly seeded database has short ones |
| `/admin/reports` link reported under 24px | the page has no rows until something is reported |
| `/admin/disputes` links reported under 24px | same — and these two turned out not to be failures at all, see 83c |

The first two are recorded in checklist row 110 and §83a–b; the rest follow.

### 83a. The board skipped a heading level

`AdSlot.headingLevel` exists for exactly this and carries a comment about the
identical bug being fixed on the room page — the board was simply never given
a level, so the slot defaulted to H4 under the hero's H1. The board's own H2s
are the filters title and the results count, and at phone widths the drawer
is closed and the count is not rendered until results arrive.

**Level 3 would not have fixed it**: H1 → H3 skips a level just the same. The
input takes `2 | 3 | 4` now. The sidebar slot declares 2 — it sits beside the
board's sections and the filters H2 above it is not rendered at mobile — and
the inline slot declares 3, because a card has to render for it to appear at
all, so the results-count H2 is always above it.

### 83b. An admin label was 380×22 with no clear air

The audit measures the **label** as the target, which is right: clicking the
words toggles the box. `.provider-form__check` was 22px tall with 0px to the
submit button below it. `min-height: 1.5rem` now. The 18×18 checkbox inside
it was never the thing to measure, and I spent a probe finding that out.

### 83c. ⚠️ The check was stricter than the criterion it cites

`/admin/reports` and `/admin/disputes` were reported as AA failures for links
that 2.5.8 **exempts**: "Listing: `<a>`Bright en-suite room…`</a>` · Sandton ·
active", and "`<a>`Drive Tenant`</a>` (tenant) reported `<a>`Drive
Landlord`</a>` (landlord)". The criterion exempts a target "in a sentence or
whose size is otherwise constrained by the line-height of non-target text".
It says nothing about the parent's tag name — but the exemption tested
`/^(P|LI|SPAN|LABEL)$/` on the parent, so a `div` holding a sentence failed.

The same defect family as everything else in that file, turned on the file
itself. It now asks the real question without naming a tag: the link must
render **inline**, and must have non-whitespace **text immediately beside it**
in the same parent. The length floor stays — a parent whose only text is the
link's own is not a sentence.

Widening an exemption weakens a gate, so it was positively controlled against
constructed cases rather than trusted:

| case | verdict |
|---|---|
| `Listing: <a>…</a> · Sandton · active` | EXEMPT |
| `<a>Drive Tenant</a> (tenant) reported <a>…</a>` | EXEMPT |
| footer link column, block links | **MEASURED** |
| card-title block link with text around it | **MEASURED** |
| lone inline `<a>Edit</a>`, no adjacent words | **MEASURED** |

The footer's 17px link list — the first finding this sweep ever made — still
fails, which is the result that makes the change safe.

⚠️ **And it was not only a widening.** The new predicate also MEASURES things
the tag whitelist used to excuse, which is the other direction of the same
defect — and it immediately found one: `p.applicants__back` on the landlord
applicants screen holds two navigation links, "← Back to dashboard" and "All
applicants across your rooms", at **20px tall with 16px of clear air**. The
old rule exempted them for one reason only, that they sit in a `<p>`. The row
is `display: flex`; nothing about it is running text. They are real AA
failures that had been hidden, and they now carry
`min-height: 1.5rem`.

So the rule was wrong in both directions at once: too strict on
/admin/reports and /admin/disputes, too lax here, and for the same underlying
reason — it asked about a tag name instead of about words.

### 83d. /admin/analytics scrolled the page sideways on a phone

14px at 360px, from a six-column growth table (Role · Today · Week · Month ·
Year · Total) measuring 358px inside a 328px box. Horizontal page scroll on a
phone is the first thing CLAUDE.md says to check for.

Fixed with this codebase's own pattern for a wide table — `display: block;
overflow-x: auto`, as `.legal-table` and `.rate-table` already do — so the
table takes the scroll and the figures stay readable by swiping the table
rather than the whole screen. Measured after: page scroll **0** at all four
widths, the table carrying its own 30px scroll at 360px.

⚠️ **I got this one wrong first.** I hypothesised the `.stat-row` grid and the
automatic-minimum-size trap, added `min-width: 0` to `.stat-box`, rebuilt, and
re-measured: still 14px. The change was reverted rather than shipped with a
comment that misstated the cause, and a probe then named the table outright.
A fix that does not move the number is not a fix, however plausible its story.

---


## 84. The browse shortcuts are removed — 21 October 2026, by the owner

> "remove this which is circled in red I don't like it anymore it must no
> longer appear anywhere on any screen"

The category row built in checklist row 105 — "Available now 2", "Private
room 1", "En-suite room 1", "Rooms in Pretoria 1", "Rooms in Tshwane 1" — is
gone from the board and from the codebase's frontend.

Removed: the template block in `home.ts`, the `categories` signal, the
`getCategories()` call and the decision comment beside it, `getCategories()`
in `rooms.service.ts`, the `BoardCategories` interface in `room.model.ts`,
and the `.browse` / `.browse__link` / `.browse__count` rules in `_spec.scss`.
Nothing else in the app referenced any of it — the board was the only screen
that rendered the row.

⚠️ **The drive's assertion is inverted, not deleted.** `scripts/search-drive.mjs`
§7 used to click every shortcut and compare the result count to the number it
advertised; it now asserts the row is absent, on the board and at all four
widths. A removal that nothing asserts is a removal that comes back the next
time somebody restores a component from an older branch, and this row sat on
the busiest screen in the product, above the first room card.

Driven both ways: with the row removed the drive is 33 passed, 0 failed; with
`home.ts` and `_spec.scss` restored from git and rebuilt, the same drive is
28 passed, **5 failed** — "no browse shortcut row on the board — found 9
element(s)", and the same at 360, 390, 768 and 1280.

Verified in a browser at all four widths after removal: no shortcut element
of any kind, 12 cards rendering, "423 rooms found", no horizontal page
scroll, and the heading order still H1 → H2 → … with no skipped level.
Production build clean.

### What was deliberately NOT removed

**`GET /rooms/categories` and `RoomsService.categories()` stay.** The
instruction was about what appears on screen, and tearing out a backend route
is a change to the API contract rather than a UI removal — `CLAUDE.md`'s
standing position on paused work is to keep the code and switch the surface
off, not to delete it. The endpoint now has no consumer, and
`scripts/smoke-test.sh` still asserts it answers 200 and never advertises a
category with a count of zero, so it cannot rot unnoticed. **Say the word and
it goes too**, along with its smoke check and the aggregation behind it.

---


## 85. The API sweeps, and the 500 they found on the busiest public route

Steps 1–5 of the API testing brief. `scripts/api-inventory.mjs` reads the
inventory out of the 35 controllers — **236 routes**, 41 unauthenticated, 2
optional-auth, 61 admin-only, 25 rate-limited, 81 with a body DTO — and
`backend/test/api-contract.int-spec.ts` sweeps that inventory rather than a
hand-written list of routes, because "a row-shaped check only ever finds what
somebody thought to list" and 236 of them is well past what anybody keeps in
step by hand.

### 85a. 🔴 `GET /api/rooms?page=999999999999&limit=999999999` → 500

On the busiest unauthenticated route in the product. `rooms.service.ts`
computes `skip = (page - 1) * limit`, about **1e21** for those numbers, far
past what Postgres will take for an OFFSET — so Prisma threw and the board
answered Internal Server Error to an anonymous caller.

**Either parameter alone was fine**, which is why nothing had ever hit it: a
large page with the default limit returns an empty list, and a large limit on
page 1 returns the board. It takes both.

The unbounded `limit` was the second half of the same hole: no maximum at
all, so one anonymous request could ask for every active row. At 423 rooms
that is a fat response; on a board that grows it is a full scan served to
whoever asks.

`@Max(100)` on `limit` and `@Max(100_000)` on `page`. The board pages at 12
and nothing in this codebase or the frontend ever asks for more, so 100 is
generous; the pair also bounds the product, so `skip` cannot exceed 1e7 and
the overflow cannot return through another combination. Measured against the
running API: 500 → **400 "limit must not be greater than 100"**, with the
boundaries exact — 100 and page 100000 pass, 101 and page 100001 are refused,
and `?page=1&limit=12` is untouched. Falsified: removing both `@Max`
decorators brings the 500 back and fails two tests.

### 85b. ⚠️ The inventory was wrong in the one direction that hides routes

Its first run reported `POST /admin/recoveries/confirm` behind
`JwtAuthGuard + AdminGuard` and `GET /landlord/storefront/:slug` behind
`JwtAuthGuard + LandlordGuard`. **Both are public.**

`lost-number.controller.ts` declares two controllers —
`@Controller('admin/recoveries')` and then `@Controller('auth/lost-number')` —
and so does `storefront.controller.ts`. The parser read only the first
`@Controller` and the first class-level `@UseGuards` per file, so the second
controller's routes inherited the first one's prefix **and its guards**. The
real routes, `POST /auth/lost-number/confirm` and `GET /storefronts/:slug`,
were never swept at all, and two open routes sat in the inventory as
protected.

A list wrong this way cannot be caught by anything downstream of it — every
sweep would have reported those routes as correctly refusing a caller while
calling a path that does not exist. The sweep found it on its first run,
because *a guarded route answering 404 to everybody is not a thing that
happens*. Public is 41, not 39; admin is 61, not 62.

It also parsed `@UseGuards(AuthGuard('google'))` as `AuthGuard('google'` —
`[^)]*` stops at the first `)`. Decorator arguments are read with balanced
parentheses now.

### 85c. Two of my own test defects, both the familiar shapes

**Ten supertest requests built eagerly** raced each other onto `listen(0)` and
one lost, failing with "Cannot read properties of null (reading 'address')" —
which reads as the API crashing on hostile input when it is the harness
racing itself. The probes are thunks now, created and awaited in turn.

**The OAuth callback** is excluded from the unauthenticated sweep *with a
reason in the code*, not quietly: `AuthGuard('google')` exists to answer an
unauthenticated caller — that is the return leg of the sign-in — and it
redirects. It has its own test asserting the redirect mints no token and sets
no cookie.

### What the sweeps assert

| Sweep | Scope |
|---|---|
| unauthenticated | all 194 identity-guarded routes must answer 401/403 |
| privilege escalation | all 61 admin routes refuse a TENANT **and** a LANDLORD |
| the control for both | a real admin gets *past* the guard on the same routes — otherwise "everything 403s" would pass with a broken token or misspelt paths |
| malformed id | no `:id` route may answer 5xx to `not-a-uuid` |
| unsupported method | 404/405, never a crash |
| hostile input | malformed JSON, wrong content type, SQL strings, arrays and nulls where objects belong, absurd query values — all < 500 |
| leakage | no V8 frame, `node_modules` path, PrismaClient reference, connection string, raw SQL, JWT secret or internal file path in **any** response collected above |
| oversized body | 2MB → 400/413, and nothing written |
| unexpected field | `forbidNonWhitelisted` enforced, with a control proving the same body minus the field succeeds |

---


## 86. The SEO budget that failed every run, the audit that never ran, and the drive nothing executed — 21 October 2026

Three defects behind one red check, found by reading a CI log rather than by
anything in this repository.

### 86a. 🔴 `categories:seo` 0.66 on all four URLs, every run since the job was written

The Lighthouse `budgets` job builds the **production** bundle, serves it on
`localhost:4000` and audits it. A production bundle's site is
`www.umastande.co.za`, so `isCanonicalHost()` in `frontend/src/server.ts`
answered `localhost` the way it answers any hostname that is not this site —
`Disallow: /`, no sitemap, which is exactly right for a Vercel preview and for
`rentboard-za1.vercel.app`. Lighthouse then read that robots.txt and correctly
reported every audited URL as blocked from indexing.

    ✘  categories.seo failure for minScore assertion
          expected: >=1          found: 0.66     all values: 0.66, 0.66, 0.66
    ✘  is-crawlable failure for minScore assertion
          Page is blocked from indexing
          expected: >=0.9        found: 0        all values: 0, 0, 0

Four URLs, three runs each, run 10 and every run before it. **Not a bug in the
server** — the server was right about what it was serving. The job never said
which of the two things it was auditing.

Reproduced here before changing anything, by serving the bundle and reading the
file: `User-agent: *` / `Disallow: /`, and a local Lighthouse run giving
`seo 0.66`, `is-crawlable 0`, `best-practices 0.96` — the runner's numbers
exactly. `SITE_CANONICAL_HOSTS` (documented in `docs/DEPLOYMENT.md`) lets the
job state that localhost is the site for this run; measured after:
**seo 1.00, is-crawlable 1, robots-txt 1**. Falsified by removing it again:
back to `Disallow: /`.

It widens nothing. The variable adds hostnames and never removes one, no
deployment sets it, and the `X-Robots-Tag` header on private prefixes and the
page's own `robots` meta tag are untouched — a copy still cannot be indexed
whatever its robots.txt invites.

### 86b. 🔴 The weekly production audit has never audited production

`lhci collect --url=https://umastande.co.za/ …` runs from the repo root, and
lhci auto-discovers `lighthouserc.json` from the working directory. That file
budgets a **local** build, so collect read its `startServerCommand` and tried
to boot a server the job never builds:

    Error: Cannot find module '…/dist/mastande-frontend/server/server.mjs'
    code: 'MODULE_NOT_FOUND'

Eleven seconds in, nothing collected, every weekly run since the domain started
answering. The thresholds and URLs now live in `lighthouserc.production.json`
and every subcommand passes `--config` explicitly, so a local-build setting
cannot leak into a remote audit. Also moved off the apex: `environment.prod.ts`
documents it as a 301 to www, so the old URLs were measuring a redirect hop
through a host that is not ours.

⚠️ **No Core Web Vitals claim about production follows from any of this.**
Nothing has measured the live site. The job can run now; it has not run yet.

### 86c. ⚠️ A correction: "the Lighthouse gate could not fail" was wrong

`PRE-LAUNCH-CHECKLIST.md` row 115 said that, and it was true of only one of the
two jobs in that workflow. The weekly `production` job did end with
`lhci assert … || true` and discarded every score. The `budgets` job asserted
strictly, ran on every frontend PR, **and was failing** — for weeks, visibly,
on the numbers in 86a. "The gate cannot fail" and "the gate fails every run and
nobody reads it" are opposite defects, and I reported the first while looking at
the second. Row 115 is corrected rather than quietly edited.

### 86d. ⚠️ `scripts/seo-drive.mjs` had never been run by anything

Written ten days earlier, reported 38/38, and wired into no job — so the
checklist row claiming its coverage was claiming a drive no gate executed. It
was also verified only against a **development** build, which is the one build
where two of its own defects are invisible:

- the Organization logo check did `org.logo.url.replace(BASE, '')`, which
  matches only when `siteUrl` is localhost. On a production bundle the fetch
  became `http://localhost:4000https://www.umastande.co.za/icon-512.png` and
  the whole drive **crashed** on an invalid URL.
- the room section took a room id from `localhost:3000` and then asked the
  server under test to render it. On a production bundle those are two
  different databases, so there was no room, no markup — and five negatives
  ("no rating is attached", "the street address is not published") scored full
  marks against an **empty object**. Markup absent read as markup correct.

Now: the id comes from the board the server under test actually renders, so the
two halves share one scope on any build; "this board serves no rooms" is a
stated skip; `the room page carries listing markup at all` is asserted before
any negative is; and the logo is fetched by path. A new section reads
`robots.txt` itself — the file at the centre of 86a, which this drive had never
once fetched — and asserts its DIRECTION, derived from what the page says about
itself rather than hardcoded, so both branches are covered.

Both builds run it in CI now: 44/44 on development, 40/40 on production (room
section skipped, as stated). Falsified by serving the bundle without
`SITE_CANONICAL_HOSTS` while telling the drive it was there: **8 failures**,
the direction check among them.

### What is still open

- The weekly production audit needs to run once and be read. Until then
  `lighthouserc.production.json` holds four unmeasured floors.
- `best-practices` is 0.96 and not 1.0 on the local run, from one audit
  (`errors-in-console`) caused by the bundle's cross-origin fetches to the real
  API. The budget names it rather than loosening the production API's CORS
  policy for a cosmetic 0.04.
- `/rooms/:id` is still not in the audited URL list. It is the page the whole
  listing business depends on being indexed, and auditing it needs a bundle
  whose API is reachable from the runner.

---


## 87. The first real measurement of production, and the gate that reported it green — 21 October 2026

§86b fixed the weekly audit; run 11 is the first one it has ever completed.
Three URLs, three runs each, mobile, simulated throttling, against
`https://www.umastande.co.za`. Median run:

| URL | Performance | LCP | TBT | CLS |
|---|---|---|---|---|
| `/pricing` | 0.98 | 1.1s | 180ms | 0.017 |
| `/how-it-works` | 0.97 | 1.1s | 170ms | 0.050 |
| **`/` (the board)** | **0.62** | **3.3s** | **310ms** | **0.953** |

Accessibility, best practices and SEO are **1.0 on all three**. `is-crawlable`,
`robots-txt`, `canonical`, `meta-description` and `errors-in-console` all pass
on the live site, which is the first evidence any of that works in production
rather than in a lab.

### 87a. 🔴 CLS 0.953 on the board — nine times the budget, and the gate said green

The job asserts `cumulative-layout-shift ≤ 0.1`. The median run measured
**0.953**. It passed.

`lhci` defaults to **`aggregationMethod: 'optimistic'`**, and for a
`maxNumericValue` assertion optimistic takes the **best** of the three runs:
`assertions.js` line 139, `aggregationMethod = 'optimistic'`. So one lucky run
satisfied a budget the typical run missed by a factor of nine, and the other two
were discarded. Every number in both config files was being read that way —
LCP, TBT and CLS alike. Both now set `aggregationMethod: 'median'`.

This is the defect family again, in the one place meant to catch it: a gate that
asserted the right metric against the right bound and still could not fail,
because it was reading the luckiest sample.

### 87b. ⚠️ Why the budgets job cannot see this, and the board page is the one that matters

The `budgets` job measures `/` at **CLS 0.026** — a board with no room cards in
it. The bundle fetches rooms from `api.umastande.co.za`, which the runner's
browser is not allowed to use cross-origin, so the page it audits is an empty
board. A green CLS there is a statement about a page that renders nothing, and
the live board is the page the whole listing business depends on.

### 87c. ⚠️ The culprits are not in the published report

`lhci upload --target=temporary-public-storage` sanitises what it publishes:
`layout-shifts` came back with a null score and no details, so the shift could
be seen and not explained. The full LHRs were on the runner and were thrown away
with it. `scripts/lhr-summary.mjs` now prints the median run's metrics, every
run's CLS, the LCP element and what shifted, into the job's own log, before the
assert, so a failing run explains itself.

### 87d. ⚠️ Three more measurements, and the shift does not reproduce locally

Runs 12 and 13 (dispatched, same commit family):

| Run | `/` CLS, all three runs | `/` perf | `/pricing` | `/how-it-works` |
|---|---|---|---|---|
| 12 | 0.916, 0.953, 0.916 | 0.62 | 0.99 / CLS 0.017 | 0.99 / CLS 0.050 |
| 13 | 0.916, 0.916, 0.916 | 0.57 | **1.00** / CLS 0.004 | **1.00** / CLS 0.027 |

Run 13's three values are identical to sixteen decimal places, which says this
is one deterministic shift of a fixed size and not a race between loads. The
two other pages are now perfect scores. Only the board.

And it does **not** reproduce here. A development build served on `localhost`
with the local API and two seeded rooms measures **CLS 0** on the same page —
the API answers in about a millisecond, so whatever difference in height exists
between what the server renders and what the client settles on never becomes a
visible move. The shift needs production conditions, which makes the weekly job
the only thing in this project that can see it.

### 87e. ⚠️ The culprit audit is erroring, and two print-outs could not say so

Run 12's summary said `layout-shifts: no items reported`. Run 13's, after
reading both audit ids, said:

    · cumulative-layout-shift: score 0.03 mode numeric details debugdata/1 item(s)
    · layout-shifts: score null mode error details none

`mode error` means the audit **threw**. The reason is in `errorMessage`, which
the print-out did not read — so the second version of a diagnostic added to
explain a failure again stopped one field short of the explanation, and the
debugdata it reported as "1 item" was never shown either. Both are printed now.
That is three iterations on one diagnostic, each blind in a different way, which
is worth recording as plainly as the defect it is chasing.

### 87f. 🔴 The cause is not a layout bug: production serves the board as an empty shell

Runs 15 and 16 answered it, and the answer is not about CSS.

    what shifted (mobile):  · 0.9162  Mastande / South Africa's dedicated room-letting notice board…
    LCP element (mobile):   app-root > app-cookie-consent > div.cookie-notice > p.cookie-notice__body
    the same board at desktop width: CLS 0.718
    what the served HTML contains, before any JavaScript runs:
      bytes:        7617
      room links:   0
      skeletons:    0
      hero--splash: 0
      trust-strip:  0

**`https://www.umastande.co.za/` answers with 7.6 KB that contain no board.** No
room links, no skeletons, no trust strip, no hero. That is `index.csr.html` —
the client-side shell — and every pixel of the page is painted by JavaScript
after load, which is why the footer moves nearly a full viewport and why the
cookie notice is the largest thing painted early enough to be the LCP element.

Both earlier candidates are dead. The phone splash is mobile-only (JS at ≤700px,
CSS at ≤768px) and desktop still shifts 0.718, so it is not the cause; the fonts
account for 0.0495 and 0.0002 of it. The cookie notice is `position: fixed` and
cannot push anything.

⚠️ **And the CLS is the smaller half of this.** `app.routes.ts` has
`{ path: '', renderMode: RenderMode.Server }` — on master, not only on develop —
precisely so the board is rendered per request rather than baked at deploy. It
is not being rendered at all in production. Consequences beyond the shift:

- Every crawler that does not run JavaScript sees a page with no rooms, no hero,
  no trust strip and none of the `Organization`/`WebSite` JSON-LD that §86 and
  the SEO phase shipped. All of that was verified against `localhost`, where
  `server.ts` renders it — which is the "measured on the wrong build" trap again,
  one layer out: the right build, the wrong deployment.
- `BOARD_CACHE_CONTROL` and the `s-maxage=60` reasoning in `server.ts` describe
  a render that is not happening.
- The sitemap advertises `/` as the primary URL of the site.

### 87g. 🔴 The cause: the CSR shell is in the static output, so `/` never reaches the function

Runs 17 and 18, against the live site:

    /                  200  cache-control: public, max-age=0, must-revalidate
                            x-vercel-cache: HIT   content-length: 7618
    /index.csr.html    200  content-length: 7618      ← the same document, by name
    /pricing           200  content-length: 33190     cache-control: identical
    /zzz-no-such-path  404  content-length: 27027     x-vercel-cache: MISS
    icon-48: 1   apple-touch-icon: 1   ld-site: 0   canonical: 0   trust-strip: 0
    scripts: main-NQO6TBEY.js

Three things fall out of that. `public, max-age=0, must-revalidate` is Vercel's
**static** default, not the `s-maxage=60, stale-while-revalidate=600` that
`server.ts` stamps on a board it rendered. `/` returns exactly the same bytes as
`/index.csr.html`. And an unmatched path answers **404 with a 27 KB
server-rendered body**, so the function is healthy and rendering — it simply
never gets `/`.

`handle: filesystem` in `tools/vercel-build.mjs` serves anything in `static/`,
and the static copy contains `index.csr.html`. That takes `/` before
`dest: /ssr` sees it. The comment above that copy said the HTML there "is not
served from disk — the function answers every page — but leaving it costs
nothing". It cost the home page, and it said so in this file for as long as the
bug was in production.

**Fixed** by removing the shell from `static/` while keeping it inside the
function, where the Angular engine reads it as the template for every page it
renders — remove the wrong copy and there are no pages at all, so the build now
asserts both directions and refuses rather than assembling a broken output.
Falsified by reintroducing the defect in the code (not by planting a file in the
output, which the script wipes first — the first falsification attempt proved
nothing and said "NO FAILURE"):

    ✘ static/index.csr.html exists. `handle: filesystem` will serve it for `/`…
    exit=1

⚠️ **Not yet deployed.** The fix reaches production when master is deployed, and
the prediction to check against then is specific: `/` answers with
`s-maxage=60, stale-while-revalidate=600`, its body carries room links, the
trust strip, a canonical and `ld-site`, and the board's CLS falls from 0.95.

### 87i. ✅ Verified in production — 25 October 2026, after v1.165.0 deployed

The prediction written into the merge commit, checked against the live site
rather than assumed. Every line of it held.

| | before | after |
|---|---|---|
| `/` body | **7,618 bytes** | **69,068 bytes** |
| room links in the served HTML | **0** | **2** |
| `trust-strip` | 0 | 2 |
| `ld-site` (the site JSON-LD) | 0 | 1 |
| `rel="canonical"` | 0 | 1 |
| board CLS, mobile | **0.916 – 0.966** | **0.071** |
| board CLS, desktop | 0.718 | **0.005** |
| board performance, mobile | 0.57 – 0.62 | **0.98** |
| board performance, desktop | 0.76 | **1.00** |
| the weekly gate | red on CLS | **passes** |

`/` now answers `cache-control: public, max-age=0` with **`x-vercel-cache:
STALE`**. ⚠️ Worth being exact: that is not the literal
`s-maxage=60, stale-while-revalidate=600` string `server.ts` sets — Vercel
consumes those directives at the edge and does not echo them. The proof the
function rendered it is the cache STATE and the body: a static file is never
`STALE`, and 69 KB containing two room links is not `index.csr.html`.
`/pricing` still answers `must-revalidate` + `HIT` from its prerendered file,
exactly as designed.

So the board is server-rendered in production for the first time since the
route was made `RenderMode.Server`, and a crawler that runs no JavaScript now
sees the rooms, the hero, the trust strip, the canonical and the
`Organization`/`WebSite` markup — all of which §86 shipped and none of which
had ever been served.

**What is left on this page, and it is small.** CLS 0.071 is inside the 0.1
bound but is no longer zero, and the culprits are named:

    · 0.0392  "2 rooms available / 0 verified landlords / Free to apply…"  Web font loaded
    · 0.0204  the same hero stats block
    · 0.0115  "POPIA Compliant / Rental Housing Act Aligned…"              Web font loaded

That is the Google Fonts swap reflowing the hero stats and the trust strip —
a different defect from the one just fixed, an order of magnitude smaller, and
the obvious next move is `size-adjust`/`font-display` on the two families
rather than anything structural. ⚠️ The mobile figure is ONE run (the
diagnostic audit runs once); the gate's own three-run median is what passed.

### 87h. ⚠️ A correction: "the deployment is not this build's output" was wrong

§87f said production's 7,618-byte shell could not be this repository's current
build, because the local `index.csr.html` was 5,835 bytes and referenced
`main.js`. That was **my own measurement on the wrong build** — the last thing
built in this container was `ng build --configuration development`, for the SEO
drive, and a development build does not hash its filenames.

Rebuilt with `npm run build:prod`: **7,618 bytes, `src="main-NQO6TBEY.js"`** —
identical to what production serves, down to the byte and the hash. Production
is running exactly this build. Everything else in §87f stands; that one
inference does not, and it is the same defect this section is about, committed
by me three findings after writing it up about somebody else's check.

### What is open

- ⚠️ **The board's render is fixed in the repository and not yet in production**
  (87g). It takes effect on the next deployment of master, and the prediction to
  verify is in that section.
- 🔴 **The board's CLS, explained but not fixed.** 0.916 is a real defect on the
  busiest public page. It cannot be diagnosed from this container —
  `www.umastande.co.za` and `api.umastande.co.za` are both `connect_rejected`
  by the egress proxy — and it does not reproduce locally (87d), so each
  iteration costs a CI run. The next run prints why `layout-shifts` errored and
  what the CLS debugdata holds. Candidates worth checking first: a difference in
  height between the server-rendered board and the client's first settled
  render, the house ad slot in the sidebar, and the two Google Fonts families.
- ⚠️ **The sitemap check was skipped in run 13** because the audit step above it
  failed — a step's default condition is `success()`, so a soft 404 in a
  submitted sitemap would have gone unnoticed for as long as a performance
  number stayed red. Now `!cancelled()`.
- ⚠️ **The weekly job will now go red** on that CLS, correctly, and stay red
  until the board is fixed. That is the point of arming it.
- ⚠️ **Performance 0.62 and LCP 3.3s on the board** pass the floors in
  `lighthouserc.production.json` (LCP 4000ms) and fail the lab budgets in
  `lighthouserc.json` (2500ms). Both are deliberate: the floor is what the live
  site must not fall below, the budget is what the code should achieve.

---


## 88. Four things reported from a phone — 25 October 2026

Reported with screenshots, from the live site, on an Android phone. Three
reproduced and are fixed; one cannot be reproduced in this container at all,
and that is the interesting one.

### 88a. The landlord's nav strip stood 101px against the tenant's 61px

Same component, same stylesheet. The only difference between the two
dashboards is that a landlord has a primary action and a tenant has none — and
`.portal-nav-cta` computed `padding: 12px 20px; margin: 16px 0 0`, so it stood
84px tall in a row of 44px links and the flex row grew to fit it.

🔴 **The mobile overrides had never applied.** They sit inside
`@media (max-width: 900px)` at line ~430 of `_responsive.scss`; the base rule
sits at line ~647, unconditional, at equal specificity, and **later**. So the
rule that reads like the override is the one that loses, and the strip's
`padding`, `margin-top` and `width: auto` were decoration. Scoping the base
rule to `@media (min-width: 901px)` — the sidebar it was written for — fixes
it, with `align-items: center` on the strip so no single taller child can pull
the row up again.

This file already carries the same lesson once, on `.results-header` at line
~337: *"that rule sat in a narrower media query than the fix, so the fix never
applied"*.

Measured, 360 / 390 / 768px: landlord **101px → 61px**, exactly the tenant's,
every link 44px, no horizontal scroll, no target under 44px. The desktop
sidebar is unchanged — wrapper padding `12px 20px`, margin-top `16px`, button
full width at 199px.

### 88b. The tenant's viewings panel had a terracotta rule with nothing behind it

`.vi-section { border-left: 3px solid var(--terra); }` and `.dash-section`
carries no padding of its own, so the heading, the time, the room name, the
address and all five outcome buttons sat **3px** from the line — on the one
screen somebody reads standing outside a stranger's gate.

`padding-left: .9rem`, which is what the `.hint` aside beside it uses with its
own 4px rule. Measured at all four widths: the nearest element is now 17px from
the rule; with the padding removed again it measures 3px.

### 88c. 🔴 The landlord's drawer hid its own two call-to-action buttons

`max-height: calc(100vh - 66px); overflow-y: auto;` on the top-nav sheet.

On mobile Chrome **`100vh` is the viewport with the address bar hidden**, which
is taller than what you can see while it is showing. So the cap was bigger than
the screen: the sheet never overflowed its own max-height, `overflow-y: auto`
therefore had nothing to scroll, the page scroll is locked behind it, and
"Dashboard", "+ List a room" and "Log out" sat past the bottom edge — the
screenshot shows the third button sliced in half at the screen edge.

⚠️ **Not reproducible here, and it never will be.** Headless Chromium has no
address bar, so `100vh` and the visible height are the same number: the drawer
measures correctly at every viewport this container can produce (575px tall at
360×800, scrollable at 360×640, nothing off-screen). The diagnosis comes from
the screenshot plus the arithmetic, and `.hero--splash` already carries the
same lesson in this codebase with the comment *"dvh, not vh: on mobile Chrome
the address bar makes vh taller than the visible area"*.

**It is a family, not an instance.** `scripts/viewport-unit-lint.mjs` found
three more, and two were real:

| Where | What | Verdict |
|---|---|---|
| `.wt-card` | `max-height: calc(100vh - 2rem)` + scroll | 🔴 the walkthrough **every new account meets**, on a phone |
| `.report-dialog` | `max-height: 85vh` + scroll | 🔴 its submit button is the thing past the edge |
| `.portal-wrap` | `min-height: calc(100vh - 66px)` | ⚠️ every portal screen a little taller than the screen |
| `.filter-panel` | `max-height: calc(100vh - 5rem)` | ✅ inside `min-width: 901px` — desktop has no address bar |

All four now carry a `dvh` line after the `vh` one, the `vh` first as the
fallback.

⚠️ **The lint's own first version was wrong twice**, and running it said so:
`\bdvh\b` cannot match `100dvh` (a digit and a letter are both word
characters, so there is no boundary between them), so it reported the single
line in the codebase that was already correct; and it flagged every `vh` height
including `min-height: 50vh` on centring blocks, which can strand nothing. The
rule is now the actual failure shape: a `max-height` in vh on a box that
scrolls, or a `min-height` of a full viewport or more.

### 88d. ⚠️ "Server error" — not reproduced, and the dialog could not have told us

A landlord dashboard showed **"Server error — Something went wrong on our end"**
at 04:38. Every one of the thirteen API calls that screen makes was driven
locally and all thirteen answer 200, including for a landlord with no rooms,
which is the state the screenshot shows. So it is production-specific and
nothing here reproduces it.

What the dialog did NOT say is the point: that sentence was the answer to every
status at or above 500, and those are three different situations.

- the phone could not reach the API at all (status 0)
- the **platform** answered instead of the API — 502/503/504. This deployment's
  API sleeps when idle, so the first request after a quiet spell can be one of
  these and the next succeeds. 04:38 is exactly the hour it would be cold, and
  this is the leading hypothesis.
- the API itself threw: a real 500, which will not fix itself on a retry.

"Please try again shortly" is right for the first two and wrong for the third.
The three now read differently, the failing call is logged to the console in
every case, and a genuine 500 shows a line worth quoting. Driven, all three:

    500 → "Server error … If it keeps happening, quote this: GET /api/landlord/calendar (500)."
    503 → "Waking up … it was idle and is starting up. Wait a few seconds."
      0 → "No connection … check your data or wi-fi."

🔴 **Still open**: the underlying failure. The next report will name the
endpoint and the status, which is what this change buys. Nothing has been
changed on the server, because nothing here has seen it fail.

### Gates

Production build green. a11y drive **10 public + 33 portal pages**, headings,
names and contrast at rest, hover and focus — all clean. mobile-drive: all
reported bugs still fixed. template-literal, emoji, viewport-unit lints green.

⚠️ Two of this repository's own documented traps, both hit in one edit of one
file: an **emoji inside a CSS comment** (fails esbuild's CSS parser) and a
**backtick quoting a class name inside a `styles` template literal** (ends the
literal). Both produced the same unhelpful build error —
`Failed to resolve @Component.styles` — naming nothing.
`scripts/template-literal-lint.mjs` named the second in one line, and it was
written for exactly this; run it before the build, not after.

---


## 89. The server error names itself, and both dashboards could be taken down by one row — 25 October 2026

### 89a. The dialog worked

v1.165.0 taught the error dialog to quote the failing call. The next report
came back as a screenshot of:

    Server error
    Something went wrong on our end, and it was not your doing. Please try
    again shortly. If it keeps happening, quote this: GET /api/tenant-inbox (500).

That is §88d paying for itself: one screenshot, one endpoint, no guessing.

### 89b. 🔴 Seven independent queries under one `Promise.all`

Both inboxes fan out to seven queries and merge the results:

    const [applications, viewings, messages, rent, lease, passport, survey] =
      await Promise.all([...]);

`Promise.all` rejects on the **first** rejection. So one bad row in any one of
those seven answered the WHOLE endpoint with a 500 — and both dashboards call
their inbox on load, so the screen became a "Server error" dialog with nothing
behind it. The landlord dashboard reported on 21 October and the tenant
dashboard on 25 October are the same defect, once per role.

These lists have nothing to do with each other: an unread message does not
depend on a rent period, a lease date does not depend on a survey. Each section
is wrapped now — it returns its own items or, on failure, an empty list, a log
line **naming the section**, and `partial: true` on the response so the screen
knows what it is showing is incomplete rather than empty.

⚠️ ~~**The failing row itself is still not identified, and this does not
identify it.** Every state that could be built locally answers 200 … Whatever
production holds, this container does not.~~

**Struck through — it was found, and the reason it could not be found is in the
sentence itself. See §91.** There was no failing row. `messageItems()` indexes
`r.messages[0]` on a list a concurrent mark-as-read can empty between the two
SELECTs Prisma issues for one `findMany`, so the defect needs two things
happening at once and every state above was one thing standing still. Driven
against a real Postgres: 19 of 30 attempts failed before the fix, 0 of 40
after.

What §89 did change, and it still stands: the blast radius and the evidence.
A section failing now costs one section instead of the dashboard.

### 89c. 🔴 A count that was `null` in the API for months, in both inboxes

`viewing_elapsed` is in both kind unions. It was in **neither** counts object:

    const counts = { message_unread: 0, … } as Record<TenantInboxKind, number>;
    for (const i of items) counts[i.kind]++;

`counts.viewing_elapsed++` increments `undefined` → `NaN` → JSON `null`. So
every user with a viewing that had been and gone got `"viewing_elapsed": null`
from the API.

**TypeScript could not catch it**, and that is the lesson rather than the bug:
`as Record<InboxKind, number>` is a cast, and a cast is the point where type
checking stops. The object was missing a key the type demanded and the compiler
had been told to accept it. Both counts are built from a kind ARRAY now
(`TENANT_INBOX_KINDS`, `LANDLORD_INBOX_KINDS`), so a new kind is counted by
existing rather than by being remembered.

Measured after: tenant 10 kinds, landlord 9, none of them anything but a
number, `viewing_elapsed: 0`.

### 89d. The Close button is out of the drawer

Removed at the owner's request. The reasoning that added it — "the burger is at
the top-right and a thumb that has just scrolled the sheet is nowhere near it"
— described a sheet that scrolls; this one opens at the top with the burger a
thumb's width above it, already showing an ✕, already labelled "Close menu".
With the scrim and Escape that is four ways out, one of which was taking the
first screen of the menu.

Focus still enters the sheet on open — the first link now, not a button whose
only job was to undo the tap that opened it — and the trap and the first-focus
share one selector so they cannot disagree about what "focusable" means. The
`.nav-sheet-close` rule is deleted with the button rather than left for
somebody to prove dead later.

Driven at 360 / 390 / 768: no close button, focus lands on "Browse rooms"
inside the sheet, every item reachable, Escape still closes it, the burger
still reads "Close menu".

### 89e. Deployed, 25 October — and what that does and does not prove

v1.166.0 is live. The repository's own deploy verifier read the live API rather
than a build log:

    Verifying production at https://api.umastande.co.za
    {"status":"ok","db":"connected","version":"1.166.0","env":"production","uptime":43}
    ✅ serving 1.166.0, which is the version in this commit
    ✅ the service identifies as production
    ✅ database is connected

⚠️ That run finished in **11 seconds**, which is fast enough to be a skip rather
than a check — so the log was read instead of the tick. `uptime: 43` says the
API had just restarted on the new build, so it caught the deploy rather than an
old process. The frontend rolled too: the served board's bundle changed from
`main-MI4IYX5M.js` to `main-ORV4AFAJ.js`, which is the build carrying the drawer
change.

**What this proves:** the fix is running in production.

**What it does not prove:** that the failing row is gone. It was never found,
and nothing here could find it. The defect it fixes is the blast radius — one
section instead of the whole dashboard — and the evidence. The next occurrence
will show a dashboard that renders with something missing, `partial: true` in
the response, and one server-log line naming the section. That line is the
thing still wanted.

### What the checks say now

- `scripts/smoke-test.sh` asserts, for **both** inboxes, that every per-kind
  count is a number and that `partial` is present and false. The first is the
  check that would have caught 89c from outside; the second cannot pass while
  a section is silently failing.
- `backend/src/modules/tenant-inbox/inbox-resilience.spec.ts` — 5 tests, one
  per property, both roles. Falsified by making the section rethrow (the old
  `Promise.all` behaviour): 1 failed, 4 passed.
- Gates: 96 backend unit tests, a11y drive 10 public + 33 portal pages,
  mobile-drive, css-coverage, production build, viewport and template lints.

---


## 90. The board's font shift, and the two families coming home — 25 October 2026

§87i left CLS 0.071 on the live board with the cause already named by the
diagnostic:

    · 0.0392  "2 rooms available / 0 verified landlords / Free to apply…"  Web font loaded
    · 0.0204  the same hero stats block
    · 0.0115  "POPIA Compliant / Rental Housing Act Aligned…"              Web font loaded

`display=swap` paints the page in the fallback and **reflows** it when the
files land. That is swap working as designed; the shift is the price.

### 90a. Self-hosted, which was already the written plan

`docs/DEPLOYMENT.md` has said since before launch that self-hosting was "worth
doing properly before launch", and `index.html`'s own comment called it the
"preferred next step". Four files now live in `frontend/src/assets/fonts`:

| File | Size |
|---|---|
| `dm-sans-latin.woff2` | 36 KB |
| `dm-sans-latin-ext.woff2` | 18 KB |
| `playfair-display-latin.woff2` | 38 KB |
| `playfair-display-latin-ext.woff2` | 21 KB |

Both variable (DM Sans wght 100–1000, Playfair 400–900), so one file per subset
covers every weight the app uses and nothing is synthesised. `unicode-range` is
kept exactly as Google served it, so latin-ext is fetched only by a page that
contains one of its characters — Sepedi's š and the marks the other locales
need. Measured: a board visit fetches **two** files, not four.

Licence and provenance in `src/assets/fonts/OFL.txt`. Both families are OFL
1.1, unmodified.

### 90b. `font-display: optional` is the fix, and it is a trade

`swap` guarantees the brand face AND the reflow. `optional` gives the file
about 100ms: there in time, it is used from the first paint and nothing moves;
not there, this page view keeps the fallback and nothing moves — and the file
still downloads, so the next view has it from cache.

Driven both ways, with the font response delayed to force the slow path:

    font delayed    0ms -> CLS 0        brand face in use: true
    font delayed 1500ms -> CLS 0        brand face in use: false

And falsified by putting `swap` back:

    font delayed 1500ms -> CLS 0.0109   brand face in use: true
                           shifting .hero-inner

⚠️ `.hero-inner` is the element Lighthouse named on the live board. The local
number is an order of magnitude smaller because this board is small and this
server is instant, but it is the same element and the same mechanism.

⚠️ **The trade, stated plainly:** a first-time visitor on a bad connection
reads the board in Georgia and the system sans rather than Playfair and
DM Sans. On a product whose audience is on cheap phones, a page that does not
jump under a thumb is worth more than a serif on the first screen — and they
get the serif from the second screen onward.

### 90c. The fonts are testable here for the first time

`scripts/font-lint.mjs` said in its own header that a rendered check was
impossible in this container, because fonts.googleapis.com is unreachable
through the agent proxy and every webfont fell back to the same width. Serving
them from this origin ends that. Measured against a deliberately bogus family
at the same size:

    Playfair Display  300.23px  vs bogus 282.39px   -> the real face
    DM Sans           312.20px  vs bogus 309.34px   -> the real face

That also makes every contrast measurement the a11y drive has ever taken more
faithful: text metrics decide which WCAG threshold applies, and until today
every run measured fallback metrics.

### 90d. ⚠️ The lint had to be rewritten, and its first two versions were wrong

`font-lint` parsed `family=` out of the Google URL. With the URL gone it
**refused to run** rather than passing on an empty set — the one reason this
rewrite happened instead of a silent green. It now reads the `@font-face`
blocks, which is a stronger source: a URL can only prove what was ASKED for,
while a local `src:` is checked against a file that is either on disk or is
not.

Two defects in my own new checks, both found by running it:

- the third-party-origin check read the whole file and failed on the **comment
  explaining why the Google origin is gone** — a check that could not tell
  markup from prose about markup.
- the weight check read `font-weight: 400 900` as a LIST and reported that 700
  "is used but NOT requested", about a variable font that renders 700
  natively. A range read as a set is wrong in the direction that costs a real
  weight.

New assertions it carries: every face's file exists on disk (the failure
self-hosting introduces — a rename leaves a face resolving to nothing), no
third-party font origin is fetched, and every preload matches a declared face
and carries `crossorigin` (without it a font preload is fetched twice).

### Gates

a11y drive 10 public + 33 portal pages — the first run ever to measure contrast
with the real faces. mobile-drive, logo-drive 96/96, seo-drive 44/44,
bundle-budget 50.1 KB under, css-coverage, production build, font/viewport/
template lints.

⚠️ The local Lighthouse run fails performance, LCP and TBT in this container,
as it has all session — a slow shared box, and the same gate passes on the
runner. Local CLS on the board: **0.012**, and 0.000 on the two static pages.

### 90e. ⚠️ The preloads bought the brand face and cost the largest paint

Self-hosting put two `<link rel="preload">` lines in `index.html` — the obvious
companion to `font-display: optional`, because `optional` only uses the face if
it arrives inside its ~100ms window, and a preload is how you make it arrive.
It worked for that, and it was the wrong trade.

A font preload is fetched at the **highest** priority Chrome has, ahead of the
stylesheet and the LCP image. Median of three runs per URL on the CI runner,
all three states measured on the same box:

| URL | Google Fonts (before) | self-hosted + preload | self-hosted, no preload |
|---|---|---|---|
| `/` | 2188 ms | 2529 ms | **2501 ms** |
| `/pricing` | 1527 ms | 1820 ms | **1810 ms** |
| `/how-it-works` | 1412 ms | 2877 ms | **1811 ms** |
| `/zu/pricing` | 1530 ms | — | **1810 ms** |

`/how-it-works` is the line that decides it: **2877 → 1811 ms**, a full second
returned by deleting two tags. The other two move ~10–30 ms, so the preload was
doing almost nothing for them and a second of damage to the one page whose
largest paint is text.

⚠️ **What this does NOT fix, and I am not going to paper over it:** self-hosting
still costs LCP against the Google Fonts baseline — about **310 ms** on `/`,
**280 ms** on `/pricing`, **400 ms** on `/how-it-works`. The budgets job's
2500 ms LCP assertion on `/` therefore fails by **1.5 ms** (2501.5 vs 2500).

That number is a regression I introduced, so the budget is not being raised to
meet it. Why the trade is still right, and what is actually left:

- the thing being paid for is CLS 0.071 → **0.012** on the live board, measured
  in production, and a layout that stops moving under a thumb is worth more on
  a cheap Android than 300 ms of text paint.
- the baseline is not like-for-like: Google Fonts serves from a CDN edge with
  warm DNS and an `immutable` cache that a large share of visitors already
  hold. Our files come from Vercel's edge on first visit and from cache after.
- ~~the 300 ms is **not** irreducible. The faces are not subset to the glyphs
  this product uses; `dm-sans-latin.woff2` is the whole latin range at 36 KB.
  A glyph-subset build is the next lever and has not been pulled.~~

  ⚠️ **Withdrawn — see §92.** Both halves of this were unsupported. The 310 ms
  was inferred from two numbers taken either side of a commit that changed the
  origin AND the display strategy together, and glyph-subsetting was named as
  the lever for a cause that had never been isolated. Driven three ways
  against one build, this container measures **0 ms** between `optional` and
  `swap` and **8 ms** between `optional` and no webfont at all, with a
  within-variant spread of 184–296 ms — so it cannot see an effect of this
  size, which §90e had itself recorded two paragraphs earlier and then
  reasoned past anyway.

  Also withdrawn by §92b: subsetting would not have been the only option, but
  **deferring the faces out of the render-critical stylesheet would not have
  worked either** — Angular SSR inlines the `@font-face` blocks into the HTML.

So the open item is `/` at 1.5 ms over a real budget, with a named remedy, not
a threshold to relax. Recorded here rather than silenced in `lighthouserc.json`.

### 90f. Measured in production, v1.168.0 — and the budget passed by 10 ms

Live board, `main-ORV4AFAJ.js`, `x-vercel-cache: STALE` so the SSR function
answered, body 71,488 bytes with 2 room links and no skeletons:

| | v1.167.0 (preloads in) | v1.168.0 (preloads out) |
|---|---|---|
| mobile LCP | 3128 ms | **2528 ms** |
| mobile CLS | 0.012 | 0.018 |
| mobile performance | — | 0.96 |
| desktop LCP | 687 ms | **578 ms** |
| desktop CLS | 0.001 | 0.002 |
| desktop performance | — | 1.00 |

**LCP: 600 ms back on mobile, 109 ms on desktop.** The runner's verdict
transferred to production, which was the thing in doubt.

⚠️ **CLS went 0.012 → 0.018 and I am not calling that a regression or a win.**
The production audit is **one run per viewport**, and the culprit changed
identity: v1.167.0's was the trust strip (0.0115), this one is the province
`<select>` list (0.0184). A shift that moves between elements between single
runs is noise, not a trend. What can be said: no "Web font loaded" cause
appears in either, which is what `font-display: optional` was for, and both
numbers are far inside the 0.1 budget. A real before/after on CLS needs the
weekly job's repeated runs, not this.

⚠️ **The LCP budget on `/` now passes by 10 ms, not comfortably.** Same code as
the run that failed by 1.5 ms: median 2490 ms against 2500, having been 2501.5.
So the assertion is sitting inside the runner's own variance and the earlier
failure was noise in the other direction. §90e's open item stands exactly as
written — self-hosting still costs ~310 ms against the Google Fonts baseline,
the faces are still not glyph-subset, and a gate that flips on 11 ms of jitter
is not evidence the cost went away.

⚠️ **Half of that is withdrawn by §92.** The gate-flipping-on-jitter point
stands. The "~310 ms against the Google Fonts baseline" does not: it was
inferred from a comparison that changed the origin and the display strategy
together, and nothing has isolated it. There is no measured cost to recover
and therefore no lever to pull. Budgets, median of 3:

    /               LCP 2490 ms  CLS 0.033   (budget 2500)
    /pricing        LCP 1814 ms  CLS 0.004
    /how-it-works   LCP 1819 ms  CLS 0.027
    /zu/pricing     LCP 1816 ms  CLS 0.004

⚠️ **An unrelated thing the probe says and should not be read literally:**
`/index.csr.html` answers 200 with 10,084 bytes and `cache-control: no-cache`.
That is NOT the static shell coming back — `vercel-build.mjs` asserts it is
absent from `static/` and the build would have failed. It is the SSR function
answering a path no file matches, the same way `/zzz-no-such-path-xyz` gets a
29,449-byte 404 page. The probe's label ("does index.csr.html exist as a static
file?") can no longer tell the two apart and will mislead the next reader.

## 91. The tenant inbox 500, found — it was never a row — 25 October 2026

§89 fixed the blast radius of `GET /api/tenant-inbox (500)` and closed saying
the failing row was unidentified. It stayed open for that reason. It is closed
now, and the thing that kept it open was the word **row**.

### 91a. One `findMany` is four SELECTs

`messageItems()` asks for the applications that have an unread message, and for
each one the unread messages:

```ts
where:  { messages: { some: { senderId: { not: tenantId }, readAt: null } } }
select: { messages: { where: { senderId: { not: tenantId }, readAt: null },
                      select: { id: true, createdAt: true } } }
```

That reads as one question asked twice, and the second copy looks redundant. It
is not one question. Prisma loads a to-many relation with a **separate query** —
no `relationJoins`, no `relationLoadStrategy` in `schema.prisma`, so the default
holds — and that single `findMany` issues four SELECTs, the messages one last:

    SELECT ... FROM applications WHERE (...)                   <- the row matches here
    SELECT ... FROM rooms        WHERE id IN ($1)
    SELECT ... FROM users        WHERE id IN ($1)
    SELECT ... FROM messages     WHERE readAt IS NULL AND ...  <- and is empty here

Anything that sets `readAt` between the first and the last leaves a row the
outer query matched holding an **empty** message list. The next line was:

```ts
const waiting = -daysUntil(r.messages[0].createdAt);
```

`undefined.createdAt` is a TypeError. A TypeError in a Nest handler with no
global exception filter is a 500. The tenant dashboard calls this endpoint on
load, so the screen was a "Server error" dialog with nothing behind it.

### 91b. ⚠️ The window is wide, and deliberately so

Opening a thread marks the other side's messages read, and `messages.service.ts`
fires that `updateMany` **without awaiting it**:

```ts
this.prisma.message.updateMany({ ... }).catch(() => {});
```

That is deliberate and documented where it sits — "a failure here must not stop
somebody reading their messages" — so the write lands whenever it lands. Open a
conversation, go to the dashboard: that is the whole reproduction.

The fire-and-forget is **not** the defect and has not been changed. A list that
cannot survive its own filter going stale is the defect.

### 91c. Why no fixture could have found it

§89 listed what it had tried: a pending application, a shortlisting, an unread
message, a viewing fifteen days gone, an acceptance with and without a tenancy,
a lease ending, notice given. Every one of them is **one thing standing still**.
This needs two things happening at once. No amount of building states by hand
reaches it, which is exactly why the honest "could not reproduce" in §89 was
also a dead end — the search was in the wrong dimension, not insufficiently
thorough.

### 91d. Measured, in both directions

`scripts/inbox-race-drive.mjs` drives `TenantInboxService.inbox()` itself —
the real service, a real Postgres, the real unawaited write — and asserts the
response is not `partial`:

    before the fix   19 / 30 attempts came back partial
    after the fix     0 / 50

⚠️ The before number was taken **first**, against the unfixed service. A check
written after the fix that has never been seen to fail is the thing this
codebase keeps finding.

⚠️ **And it refuses to pass vacuously, which took a second pass to notice.**
"0 partial" is also what you get if the write lands after the messages SELECT
every single time — the race never fires, nothing is exercised, and the drive
reports success over nothing. That is precisely the green-tick-over-nothing
this file is a list of. So each attempt is now classified, and a run where the
race never fired exits **2 as INCONCLUSIVE** rather than 0:

    the mark-read landed mid-query (the race fired): 35 / 40
    it landed after the read, item served as normal:  5 / 40
    attempts whose response came back partial:        0 / 40

Falsified by moving the write so it cannot land mid-query: 0/20 fired, and the
drive reported INCONCLUSIVE and exited 2 instead of passing.

⚠️ The first CI run of this step passed in **one second**, which is the shape of
a check that did nothing — that is what prompted the guard. The step is green
with the race firing, not green because nothing happened.

### 91e. Skipped, not defaulted — and the near-miss has its own test

The fix is `flatMap` plus `if (unread === 0) return []`. They read the messages
a moment ago; nothing is waiting on them.

The obvious alternative is `r.messages[0]?.createdAt ?? new Date()`, which also
stops the throw and is **wrong**: it invents "1 unread message, sent today" for
a conversation with nothing unread in it. That is the landlord list's
`_min.createdAt ?? new Date()`, correct there because its count comes from a
`groupBy` that cannot be empty, and wrong here.

Two unit tests in `inbox-resilience.spec.ts`, each falsified by the defect it is
for:

| test | reintroduce | result |
|---|---|---|
| does not throw when the messages were read mid-query | the original `map` + `[0]` | ❌ fails (`partial` true) |
| emits no item for a thread with nothing unread | `?? new Date()` | ❌ fails (an item appears) |

⚠️ The first test passes under the `?? new Date()` version and the second passes
under the original bug. Neither test alone covers this; that is why there are
two, and why each was run against its own defect rather than against "the old
code" in general.

### 91f. 🔴 The same class, one line from a guard that knew better

Grepping `[0].` across the backend found four other sites. Three are guarded
(`storage.service.ts` checks `length === 0`, `listing-bot.service.ts` checks
`hits.length === 0`). The fourth:

```ts
email: emails[0].value,
fullName: displayName,
avatarUrl: photos?.[0]?.value,     // <- guarded, one line below
```

`google.strategy.ts`. A Google profile with no email — the scope withheld, an
account without a verified address — was a TypeError inside a Passport verify
callback, surfacing as a 500 on the sign-in redirect naming nothing. It is a
refusal with a reason now, naming email-and-password sign-in, because an email
is not optional here: `User.email` is nullable for the WhatsApp-first landlord
who has a phone number instead, not for a Google account that came back without
one.

⚠️ **Not reproduced.** It needs Google to return such a profile and this
container cannot make it do that. Stated as what it is — a read of the code and
of the guarded line beside it — rather than implied to be driven.

### 91g. Deployed and confirmed

    {"status":"ok","db":"connected","version":"1.169.0","env":"production",
     "uptime":458}

    ✅ serving 1.169.0, which is the version in this commit
    ✅ the service identifies as production
    ✅ database is connected

`uptime 458` is about seven and a half minutes, consistent with a fresh deploy
rather than a stale instance reporting an old build.

⚠️ **What that does NOT prove.** It proves the fix is deployed; it does not
prove the dialog is gone, because the only witness to that is a tenant opening
their dashboard. The fix is proven against a defect **measured** to produce the
500 — it is not proven to be the only cause of one. If it recurs, the dialog
still quotes the endpoint, the response carries `partial: true`, and the log
names the section: §89's machinery is what would catch a second cause, and it
stays.

### 91h. What is NOT covered

`scripts/smoke-test.sh` asserts, for both inboxes, that every per-kind count is
a number and that `partial` is false. Those assertions pass before and after
this fix, because from outside the race is invisible unless it happens to fire
during the run. **No new smoke assertion was added, because there is no way to
assert a race from an HTTP client without causing it.** The drive is what
covers this, and it is wired into CI's backend job (after the smoke suite's
fixtures, against the same seeded database) and into `npm run audit:inbox-race`.

## 92. The 310ms I attributed to self-hosting, withdrawn — 25 October 2026

§90e said self-hosting the two families costs about **310ms of LCP** against
the Google Fonts baseline, and named **glyph-subsetting** as "the next lever".
Both halves are being withdrawn. The first was an inference from two numbers
taken either side of a change that altered two things at once; the second was
a remedy proposed for a cause that had never been isolated.

### 92a. The comparison conflated two changes

Moving to `src/assets/fonts` changed the **origin** (fonts.gstatic.com became
this origin) and the **display strategy** (`display=swap` became
`font-display: optional`) in the same commit. Those cost different things, and
the before/after was read as though only the first had happened.

So `scripts/font-paint-drive.mjs` separates them: one build, three variants —
as shipped, `swap`, and **no webfont at all** — produced by rewriting the
stylesheet *and the document* in flight, with every font response held back
1500ms so the file is certain to miss its window.

### 92b. ⚠️ Angular SSR inlines the `@font-face` blocks into the HTML

This is the finding worth keeping, and it is structural rather than a timing
measurement, so this container's load cannot weaken it. The served board
carries all four faces in a `<style>` tag:

    $ curl -s http://localhost:4000/ | grep -c '@font-face'      -> 1 block
    $ curl -s http://localhost:4000/ | grep -o 'woff2' | wc -l    -> 8 refs

Two consequences:

- **The strategy governing the first paint is the inlined copy**, not the
  external stylesheet, which applies later and merely overrides it.
- **Deferring the fonts out of the render-critical stylesheet cannot work.**
  That was the other obvious remedy — load the faces from a stylesheet
  injected after `load`, so the first view never contends for bandwidth. The
  inliner would put them back. Killed before anybody spends a day on it.

### 92c. Font requests begin before the headline paints

Read from the page's own resource timeline, so the two numbers share a clock:

    first woff2 request   ~138ms
    first contentful paint ~220ms      (the LCP element is h1.hero-headline)
    began before the paint: 7 / 7 runs

That is the contention mechanism, measured rather than assumed, and it is the
honest version of what §90e was reaching for: self-hosted faces are discovered
in a stylesheet the browser is already parsing, so they start at once, whereas
Google Fonts cannot be discovered until a third-party DNS lookup, TLS
handshake and CSS round trip have finished. On an unthrottled localhost that
ordering costs nothing. On CI's throttled link it is where a delta could come
from — **could**, which is not the same as does.

### 92d. 🔴 And this box cannot adjudicate the difference

Medians of 7 runs per variant, same build, same box:

| variant | LCP (median) | all 7 runs | headline in brand face |
|---|---|---|---|
| optional (as shipped) | 220ms | 268, 208, 236, 220, 212, 184, 224 | false |
| swap | 220ms | 284, 220, 216, 232, 184, 236, 204 | false |
| no webfont at all | 212ms | 252, 200, 172, 212, 220, 212, 296 | false |

`optional` vs `swap`: **0ms**. `optional` vs no webfont at all: **8ms**. The
spread **within** one variant (184–296ms) is an order of magnitude wider than
any gap **between** them, so the only defensible reading is that this
container cannot see an effect of this size. It is the same limit §90e itself
recorded — `/` measured at 4370ms here against the runner's 2529ms — and I
then drew a 310ms conclusion anyway.

⚠️ **The budget is no longer the reason to care.** `/` passes at 2490ms against
2500ms (§90f), on the same code that failed it by 1.5ms the run before. There
is no gate being chased here, so no font change is being made on the strength
of a number nothing can measure.

### 92e. ⚠️ Local CLS does not reproduce §90b, and the case for `optional` does not rest on it

All three variants measured **CLS 0.0000**, in every run, including `swap` with
the font arriving 1500ms late — which §90b reported locally as **0.0109
shifting `.hero-inner`**. That is a direct non-reproduction of an earlier local
measurement and I cannot explain it; the board has changed by two releases
since, and this harness differs from that one in viewport and in rewriting the
inlined CSS as well.

Stated rather than smoothed over, because the honest position is that
**`font-display: optional` is justified by the PRODUCTION before/after, not by
any local number**: the live board went from CLS 0.071 with two "Web font
loaded" culprits named by Lighthouse to 0.012 with both gone (§90, §90f). That
evidence is unaffected by anything in this section.

### 92f. ⚠️ Five defects in this harness, every one found by running it

Listed because the pattern is the point — each version produced a confident
number that was wrong, and three of them would have been reported as a finding:

1. **Single runs.** The first result showed `optional` costing **+80ms**, which
   matched the block-period story exactly. With 5 runs it was **−4ms**. The
   number that agreed with my hypothesis was noise.
2. **An unverified control.** "No webfont at all" was never checked to remove
   anything. It reported 4 → 0 `@font-face` in the external CSS *and two font
   requests*, which a page with no face cannot make.
3. **The inlined CSS** (§92b) — the rewrite only touched `**/*.css`, so for two
   versions the variants did not govern the first paint at all. This is what
   defect 2 was a symptom of.
4. **Two clocks.** Font request starts were taken as `Date.now()` minus a
   baseline captured outside the page, then compared with FCP's page-relative
   `startTime`. Now read from the page's own resource timeline.
5. **A probe that measured the wrong element, at the wrong time, and caused
   the requests it counted.** A fresh `<span>` asking for Playfair *after* the
   wait reported "brand face in use: true" on runs where every font response
   was held back 1500ms — impossible, and the tell for a sixth problem:
   cross-run **caching**, since a `BrowserContext` does not isolate the HTTP
   cache the way it isolates cookies. The probe now swaps a bogus family onto
   the `h1` itself, at load, and the cache is disabled through CDP per run.

### 92g. What is NOT wired into CI, and why

`font-paint-drive.mjs` is in `npm run audit:font-paint` and **not** in
`.github/workflows/ci.yml`. It cannot assert a timing threshold — §92d is the
reason — and a check whose assertion cannot be trusted is worse than no check,
because it gets believed. It answers ordering and structural questions on
demand: whether the requests precede the paint, whether the faces are inlined,
whether a variant is really the variant it claims to be.

## 93. One room, let to two people — 26 October 2026

§91 closed a race that cost a dialog. This one cost a room.

`docs/API-TESTING.md` §6.5 named the gap in its own words — "no test races two
acceptances of the same room" — and §91 is why it was worth closing now rather
than later: a defect that needs two things happening at once cannot be found by
building states one at a time, and this codebase had just spent four days
learning that.

### 93a. 🔴 Both accepts returned 200

`scripts/double-let-drive.mjs`, against the real API, first attempt:

    ── Two applications for one room, accepted at the same moment ──
         responses: 200, 200
      ❌ 2 of 2 acceptances succeeded — a room let 2 times
      ❌ 2 accepted applications for one room
      ❌ 2 live tenancies for one room — this is the double-let

Two tenants each told "You got the room". No tricks: two requests that did not
wait for each other.

### 93b. The protection ran after the write

```ts
const application = await this.getOwnedApplication(id, landlordId);
this.assertNotDecided(application);        // the application's OWN status
... update the application to accepted ...
... update the room to let ...
await this.autoRejectOthers(roomId, id);   // what protected the room
```

`assertNotDecided` knows only about the application in front of it. What kept a
room from being let twice was `autoRejectOthers` — which runs **after** the
write. So the sequential path was safe (accept A, and B is rejected before
anybody can accept it) and the concurrent path was not: two different
applications for one room both read `pending`, both passed the check, both were
accepted.

⚠️ **The sequential safety is why this was invisible.** Every existing check
accepts one applicant and then asserts the others are rejected, which is true
and passes. 527 smoke assertions, 98 unit tests and a 236-route sweep all held
while a room could be let twice.

### 93c. Compare-and-swap, in one transaction

Both writes now carry the old state in the `WHERE` clause, so Postgres blocks
the second writer on the same row until the first commits and then re-evaluates
it against the new version — exactly one caller sees `count === 1`:

```ts
const claimedApplication = await tx.application.updateMany({
  where: { id: applicationId, status: { notIn: ['accepted', 'rejected', 'withdrawn'] } },
  data: { status: 'accepted', decidedAt: new Date() },
});
if (claimedApplication.count === 0) throw new BadRequestException(…);

const claimedRoom = await tx.room.updateMany({
  where: { id: application.roomId, status: { not: 'let' } },
  data: { status: 'let', letAt: new Date() },
});
if (claimedRoom.count === 0) throw new BadRequestException(
  'This room has already been let to another applicant. Undo that acceptance first if it was a mistake.',
);
```

- The **application** claim stops one application being accepted twice — a
  double tap, a retry, two tabs.
- The **room** claim stops two different applications letting one room.
- One transaction, so a lost room claim rolls the acceptance back rather than
  leaving an application accepted for a room somebody else has.
- Ordered application-then-room in every caller, so two racing accepts cannot
  deadlock.

`{ status: { not: 'let' } }` rather than `=== 'active'` deliberately: a landlord
may accept while the room is paused or reserved, and `undoAccept` puts it back
to `active`, so a reversed acceptance can be made again. The smoke suite's
undo-then-reaccept path is what would have caught an over-tight predicate, and
it passes.

### 93d. Measured, the before taken first

| | before | after |
|---|---|---|
| two applications, one room | **200, 200** — 2 tenancies | **200, 400** — 1 tenancy |
| one application, twice | **200, 200** | **200, 400** |
| rent month, marked twice | 200, 200 — 1 period | 200, 200 — 1 period |

### 93e. The rent half held, and was made to prove it

`rent.service.ts mark()` is a Prisma `upsert` on the unique
`[tenancyId, periodStart]`. An upsert is a read then a write, so two can both
decide to INSERT and one must lose on the constraint — correctly, as long as
the person is told something true rather than handed a 500 for pressing a
button twice.

⚠️ **One pair of requests would have proved nothing.** If the first upsert
commits before the second reads, both take the UPDATE path, no constraint is
ever tested, and the drive passes having raced nothing. So the period is
**deleted between attempts**, which puts every pair back on the INSERT path —
the only one the unique index can reject. Five attempts: `200/200` each time,
one period each time.

⚠️ And the rent tracker is the landlord's **own record**. Mastande never holds
rent or a deposit, and nothing in this section moves money; a duplicated month
would have been a wrong record, not a double charge.

### 93f. ⚠️ And it refuses to pass vacuously

`200, 400` is **also** what a run where the two requests serialised looks like:
the first acceptance completes, `autoRejectOthers` rejects the second
application, and `assertNotDecided` refuses it on the sequential path — which
was always correct and was never the defect. A drive that cannot tell that
apart from a working compare-and-swap passes whether or not the fix is there.

The guards say different things, so they can be told apart:

| refusal | what it means |
|---|---|
| "already been let to another applicant" | the room claim — the race fired |
| "already been decided" | the application claim — the race fired |
| "already been rejected" | the sequential path — the race did **not** fire |

A run refused only by the sequential path is reported **INCONCLUSIVE for this
race** and fails, rather than passing. Measured: the refusal comes from the
room claim, so the window is genuinely open on this machine —

    ✅ the conditional claim is what refused — "This room has already been
       let to another applicant. Undo that acceptance first if it was a mistake."

⚠️ This was added AFTER the first CI run went green, for the same reason §92f
lists five harness defects: the step passed in six seconds and its output could
not distinguish a working claim from two requests that never overlapped.

### 93g. ⚠️ What this does NOT cover

- **One defect in my own drive**, found by running it: `dbRows` returns LINES
  OF TEXT, one per row, not objects. Reading `.id` off one gave `undefined`,
  which the route answered with "Validation failed (uuid is expected)".
- **The pattern is not searched for.** Read, check, write, with the protection
  running afterwards — that is the shape, and it was found by suspecting one
  method, not by sweeping for it. Nothing here races a notice against a
  withdrawal, two confirmations of one move-in, or two verification decisions.
  Those remain as §6.5 now says.
- **Two accepts from two different landlord sessions** are not driven
  separately; both requests here carry the same token, which is the realistic
  case (one landlord, two taps or two tabs) and exercises the same code path.

---


## How to check the whole thing still works

```bash
# API, with every gate open. Anything less leaves checks unrun.
ADMIN_EMAIL=<seeded admin> ADMIN_PASSWORD=<their password> \
  WHATSAPP_APP_SECRET=<the API's own> \
  RESEND_WEBHOOK_SECRET=<the API's own> \
  ./scripts/smoke-test.sh          # 517 passed, 9 skipped without the three
                                   # secrets above; set them and five of those
                                   # become checks, leaving 4 named skips
#
# ⚠️ The auth limiter counts in memory over 15 minutes, so running the suite
# twice inside that window rate-limits its own login checks. Those now report
# as NAMED SKIPS rather than failures — reported as failures they were an alarm
# crying wolf on every second run. To have them actually run, wait the window
# out or restart the API first. The phone sign-up enumeration check has the
# same shape: it spends one of a fixed number's ten daily codes per run, so on
# the second run of a day it skips with its reason named.

# What the production build actually serves. Run it BOTH ways:
./scripts/verify-build.sh          # with an API on :3000
# then stop the API and run it again — the hanging-API check needs 3000 free

# The drives. Each needs the API on :3000; the UI ones also need :4200, and the
# phone ones need DATABASE_URL and the API's own JWT_SECRET, because a code is
# only ever sent over WhatsApp and reading it back means reading the database.
#
# ⚠️ Counting them: `grep -c '^  ✅'`, with the two leading spaces. A bare
# `grep -c '✅'` also counts each drive's final summary line and reports one
# check more than there is — which is exactly how these numbers were wrong
# twice, in both directions, before anybody looked at a log carefully.
node scripts/phone-signup-drive.mjs      # 29 checks, 0 skip
node scripts/phone-signup-ui-drive.mjs   # 11 checks — the consent box is the point
node scripts/otp-drive.mjs               # phone sign-in hardening
node scripts/notices-drive.mjs           # 9 checks — the in-app notice channel
node scripts/sublet-drive.mjs            # 38 checks — Phase 6, incl. the guard split
node scripts/sublet-ui-drive.mjs         # 13 checks — what an applicant is actually told
node scripts/throttle-lint.mjs           # every @Throttle is actually guarded
node scripts/nav-audit.mjs               # Phase 7a: dead nav links, unreachable
                                         # screens, two names for one place
node scripts/properties-drive.mjs        # 22 checks — Phase 7b, incl. "deleting a
                                         # property cannot delete a listing"
node scripts/properties-ui-drive.mjs     # 18 checks — can a landlord FIND grouping
node scripts/messages-inbox-drive.mjs    # 43 checks — Phase 7c. Includes the two
                                         # defects it found: who a WhatsApp reply
                                         # is from, and that readAt is written
node scripts/messages-inbox-ui-drive.mjs # 33 checks — which channel a reply
                                         # leaves by, said out loud
node scripts/search-drive.mjs            # keyword search in a real browser: a
                                         # shared ?q= URL, typing reaching the URL,
                                         # back/forward, the chip that removes a
                                         # place, and 44px targets at 360/390/768/
                                         # 1280. 28 checks.
node scripts/a11y-drive.mjs              # 26 pages WITH CONTENT on them. Before
                                         # Phase 7c it seeded nothing and so
                                         # audited every portal screen empty
node scripts/dashboard-drive.mjs         # 35 checks — Phase 7d. "Viewed 47 times
                                         # this week" now has data under it, and
                                         # the task buttons point somewhere real
node scripts/onboarding-drive.mjs        # 35 checks — Phase 7f. The social card
                                         # (measured, not assumed) and the
                                         # first-run walkthrough

# ⚠️ Not a drive — a read-only preflight you point at the database you are
# about to migrate. Every statement is a SELECT, so it is safe against
# production. Exits non-zero if the run would fail partway.
DATABASE_URL=<target> node scripts/migration-preflight.mjs
node scripts/templates-ui-drive.mjs     # 45 checks — Phase 8a. The four
                                         # printable documents, and the one
                                         # that matters: the "not checked by a
                                         # lawyer" warning SURVIVES printing,
                                         # asserted under emulateMedia(print)
node scripts/lost-number-drive.mjs      # 50 checks — Phase 7q. Needs
                                         # JWT_SECRET. Tests the CHECK
                                         # CONSTRAINTS with SQL as well as the
                                         # service, which is how it found two
                                         # that passed on NULL
node scripts/lost-number-ui-drive.mjs   # 29 checks — that both screens say
                                         # what they can and cannot do, and
                                         # that approve stays off until a check
                                         # is written down
node scripts/assisted-signup-drive.mjs  # 27 checks — Phase 7p. Needs
                                         # JWT_SECRET. Mostly about what an
                                         # admin CANNOT do: no code and no
                                         # ticket in the reply, and the Terms
                                         # still the person's to accept
node scripts/assisted-signup-ui-drive.mjs # 21 checks — that the admin screen
                                         # says whose handset the code goes to,
                                         # at four widths
node scripts/phone-only-drive.mjs       # 30 checks — Phase 7o. Needs
                                         # JWT_SECRET: a code only goes out
                                         # over WhatsApp, so it is recovered
                                         # from the stored HMAC. The lockout,
                                         # the two Google messages, and the
                                         # confirmed number change
node scripts/phone-only-ui-drive.mjs    # 25 checks — what the settings screen
                                         # OFFERS such an account, at four
                                         # widths. Makes its account through
                                         # /auth/register-phone, because the
                                         # session is a cookie and there is no
                                         # email or password to sign in with
node scripts/nav-ui-drive.mjs            # 54 checks — Phase 7e and 7n. The
                                         # sidebar on every guarded screen, the
                                         # mobile header CTAs at 360/390/430px,
                                         # the footer, three widths with no
                                         # sideways scroll — and that the phone
                                         # strip says it scrolls, that its far
                                         # end is reachable, and that exactly
                                         # one item is marked the current page
node scripts/dashboard-ui-drive.mjs      # 29 checks — that the task buttons
                                         # ARRIVE, not just that the string is
                                         # right, and that a landlord who never
                                         # grouped anything can reach their rent
node scripts/account-lifecycle-drive.mjs # 48 checks — Phase 7g. Needs a FRESH
                                         # API: it spends six of the ten delete
                                         # attempts the endpoint allows per
                                         # quarter hour, on purpose
node scripts/account-lifecycle-ui-drive.mjs # 51 checks — pausing and closing on
                                         # screen, at four widths, plus the
                                         # settings screen's own step-up check
node scripts/layout-ui-drive.mjs         # 130 checks — Phase 7h. The rendered
                                         # box of every control a landlord
                                         # presses: heights, gaps, computed
                                         # backgrounds and page overflow at
                                         # 360/390/768/1280
node scripts/admin-closure-drive.mjs     # 42 checks — Phase 7i. An admin ending
                                         # an account on request: the audit row,
                                         # the refusals, and that closure and
                                         # suspension cannot be confused
node scripts/admin-closure-ui-drive.mjs  # 42 checks — the same on screen, at
                                         # four widths
node scripts/contractor-checks-drive.mjs # 22 checks — Phase 7j. The directory
                                         # said "people we have checked out"
                                         # and nothing recorded a check
node scripts/contractor-checks-ui-drive.mjs # 41 checks — and the screen states
                                         # which checks exist rather than
                                         # asserting that someone checked
node scripts/contractor-leads-drive.mjs  # 33 checks — Phase 7k. Leads recorded,
                                         # priced only at a rate somebody set,
                                         # and nothing that collects money
node scripts/contractor-leads-ui-drive.mjs # 43 checks — the landlord is told
                                         # they are never charged, and the admin
                                         # screen says record, not invoice
node scripts/viewings-drive.mjs          # 35 checks — Phase 7l. Inviting an
                                         # applicant, and the private property
                                         # address never reaching them
node scripts/viewings-ui-drive.mjs       # 41 checks — the form says what it
                                         # sends, and the tenant can answer
node scripts/token-render-drive.mjs      # 51 checks — Phase H. The fourteen
                                         # borders that var(--line) silently
                                         # dropped, measured as PAINTED at
                                         # 360 / 390 / 768 / 1280
node scripts/scale-lint.mjs              # Phase J3 + K. Radius and shadows on
                                         # the scale with zero tolerance;
                                         # spacing and font size ratcheted
node scripts/house-ads-drive.mjs         # 13 checks — § 51. What /api/ads
                                         # actually serves, at all three
                                         # placements, carries no old brand
node scripts/font-lint.mjs               # Phase J4. A font token may not name
                                         # a family nothing fetches — DM Mono
                                         # never was
node scripts/feedback-lint.mjs           # Phase J2. Loading, empty and error
                                         # are three components, and the
                                         # loading state is announced
node scripts/state-lint.mjs              # Phase J1. Five meanings, one
                                         # definition; no component declares
                                         # the treatment itself. No API, no
                                         # browser
node scripts/logo-drive.mjs              # 76 checks — Phase I. One wordmark
                                         # component, MA fixed at #C4522C, and
                                         # the 18.66px bold floor the 3:1
                                         # contrast threshold depends on.
                                         # Needs the web server only, no API
```

Two of these need no API and no browser, so they belong in the same breath as
`audit:env` rather than in a sweep:

```bash
node scripts/token-lint.mjs              # a literal hex within ΔE 3 of a token,
                                         # and any var(--x) naming nothing
node scripts/template-literal-lint.mjs   # a backtick truncating an inline
                                         # template — eight occurrences so far
```

⚠️ Both were unwired until 11 October: `template-literal-lint.mjs` was written
in Phase F and appeared in no npm script, no workflow and no hook. A lint
nobody runs is the same thing as no lint. Both are now in `npm run audit` and
in `.github/workflows/ci.yml`.

⚠️ **Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the a11y drive.** Without them
it audits 10 public + 17 portal pages and SKIPS every admin screen — which is
where it had been for every release until v1.94.0. With them it does 27,
including `/admin/users/:id`, the only admin screen carrying a destructive form
and so the one place a red-on-pink danger panel can fail a contrast threshold
while looking deliberate. The two closure drives promote their own admin and
need nothing set.

⚠️ **Rate limiting is the binding constraint on running these back to back.**
`/auth/register` allows 60 an hour and `/auth/login` 30 per 15 minutes, counted
in memory per instance (v1.86.0). The dashboard UI drive alone needs nine
accounts, so a full sweep exhausts the window — and the failure reads as
`register failed: 429` or `still on /auth/login`, which looks like an auth bug.
`registerUser` names the limiter and the remedy now. **Restart the API to clear
the counters** between sweeps; they are in memory, so a restart is enough.

⚠️ **Two traps in this container, both of which cost a cycle.** `ng serve` and
`tsc -w` both stop watching silently, so a fix can appear not to work while the
old bundle is still being served — restart them rather than trusting the
watcher. And an **emoji inside a CSS comment** in a component's `styles` block
fails esbuild's CSS parser; `ng serve` reports it and then keeps serving the
previous bundle, so the symptom is "my change did nothing". The production build
fails on it, which is the net.

The suite prints the release invocation itself whenever anything skipped. Ninety
-two checks in it had never run once before v1.84.0, and the one assertion
covering "uploaded documents are deleted" was among them — a skipped check reads
exactly like a passing one when you are scanning output.
