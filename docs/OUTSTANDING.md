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

## 1. Push the release tags

Nineteen tags exist only in a container that no longer exists. Every tagged
commit IS on the remote — only the tag objects are missing. Pushing
`refs/tags/*` is refused (HTTP 403) from the coding session, so this runs from
your own clone.

```bash
cd /path/to/rentboard-za1
git fetch origin
bash scripts/push-release-tags.sh
```

**Worked when:** it prints `Created 19 tag(s), skipped 0` then pushes without
error. Safe to re-run — a tag already on the remote is skipped, never moved.

```bash
# Verify
git ls-remote --tags origin | grep -E 'v1[.](7[5-9]|8[0-7])[.]'
```

**If skipped:** v1.75.2–v1.83.0 have no tags, so there is no way to say which
commit a given release was, and `git describe` is useless.

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
bash scripts/migrate-remote.sh
```

It prints which database it is about to migrate, shows the pending list, and
asks before applying. It refuses if either variable is unset, if either resolves
to localhost, or if `DIRECT_URL` is a `-pooler` host.

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

`migrate:staging` runs `scripts/migrate-remote.sh`, which refuses to run against
localhost, with `DATABASE_URL` unset, without `DIRECT_URL`, or with `DIRECT_URL`
pointing at a `-pooler` host. **The direct string is not optional** — migrating
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
```

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
