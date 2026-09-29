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

Fourteen tags exist only in a container that no longer exists. Every tagged
commit IS on the remote — only the tag objects are missing. Pushing
`refs/tags/*` is refused (HTTP 403) from the coding session, so this runs from
your own clone.

```bash
cd /path/to/rentboard-za1
git fetch origin
bash scripts/push-release-tags.sh
```

**Worked when:** it prints `Created 14 tag(s), skipped 0` then pushes without
error. Safe to re-run — a tag already on the remote is skipped, never moved.

```bash
# Verify
git ls-remote --tags origin | grep -E 'v1[.](7[5-9]|8[0-3])[.]'
```

**If skipped:** v1.75.2–v1.83.0 have no tags, so there is no way to say which
commit a given release was, and `git describe` is useless.

> **Note:** v1.84.0 is NOT in the script yet. Phase 5 is unfinished — **5c
> (share/flyer generator) is the only part left**, and it needs device testing
> nobody in a container can do; see §10. 5e, 5f and 5h are done, and 5g turned
> out to be already built.

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

## 5. Staging migrations — before any deploy

Sixteen migrations are in the repo. How many are unapplied on staging depends on
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
| `sendOtp` | An **authentication** template | Phone login for anyone outside the 24-hour window |
| Survey outreach | A **utility** template | The WhatsApp delivery variant of the Phase 0 survey |
| Rent reminders (4a) | A **utility** template | Reminders to tenants who have not messaged in 24h |

Submit in **Meta Business Manager → WhatsApp Manager → Message templates.**
Approval is typically hours to a couple of days.

**Worked when:** the templates show *Approved*, and their names are wired into
the WhatsApp service.

**If skipped:** rent reminders and notification fallbacks silently fail for
anyone who has not messaged in 24 hours — the worst kind of failure, because the
landlord believes the tenant was reminded.

This is why v1.85.0's notification fallback writes an **in-app notice** first and
treats WhatsApp as a best-effort improvement on top: a fallback that only works
inside the 24-hour window is not a fallback. `Notice.whatsappError` records the
refusal so the gap is visible rather than silent.

---

## 8. ⚠️ Attorney review — privacy policy and PAIA manual

Both were **changed in v1.83.0** and need a South African attorney's eye. The
PAIA manual is a statutory document.

What changed and why it matters:

- **Privacy policy, ImageKit row** — now distinguishes identity documents
  (*deleted once reviewed*) from leases (*kept, because both parties need them
  for as long as the agreement can be disputed*). Previously it said all uploads
  were deleted after review, which Phase 4e made false in the other direction.
- **PAIA manual** — a new row for lease paperwork, stating that Mastande stores
  the document and does **not** sign, witness, verify or execute any agreement.

Also still unreviewed from earlier phases:

- The sub-letting disclaimer (Phase 6) — a distinct risk from the landlord
  disclaimer, because the applicant carries real exposure if a sub-lessor's right
  to sublet turns out to be invalid. **Do not let this be copied from the
  existing landlord disclaimer.**

Files: `frontend/src/app/features/legal/privacy-policy/privacy-policy.ts`,
`frontend/src/app/features/legal/paia/paia.ts`.

---

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

Neither is mine to make — both briefs say to flag rather than decide.

### Phase 6 — the `UserRole` question

A tenant subletting a room in their own leased house fits neither `TENANT` nor
`LANDLORD`. `LandlordProfile` exists only for `LANDLORD`, and `Room.landlordId`
points at one.

- **Option A** (recommended, smaller blast radius): let a `TENANT` create
  listings, with a `listerType` field (`owner_landlord` | `sublessor`) on the
  listing. Reuses most of the existing Room/Property/verification machinery.
- **Option B** (cleaner long-term, much larger): generalise "Landlord" into
  "Room Provider", with ownership/sublet status as an attribute. Touches guards,
  dashboards and copy throughout.

**Also needed:** should sublet listings share the same search surface as
backroom rentals, or be a distinct category/filter? Different segment — students
and young professionals versus the informal backroom core market — and mixing
them without a clear filter could dilute both.

### Phase 7g — phone/WhatsApp signup

Making email optional touches `User` (email uniqueness and nullability, phone
uniqueness), every auth guard, the email service, and every flow that assumes
`user.email` exists.

- **Recommended:** email becomes optional, phone becomes an alternative unique
  login identifier, and at least one of the two is required at signup.

Say the word on either and it gets built. Nothing is being written to the schema
for these until then.

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

## How to check the whole thing still works

```bash
# API, with every gate open. Anything less leaves checks unrun.
ADMIN_EMAIL=<seeded admin> ADMIN_PASSWORD=<their password> \
  WHATSAPP_APP_SECRET=<the API's own> \
  RESEND_WEBHOOK_SECRET=<the API's own> \
  ./scripts/smoke-test.sh          # 461 checks, 3 skip

# What the production build actually serves. Run it BOTH ways:
./scripts/verify-build.sh          # with an API on :3000
# then stop the API and run it again — the hanging-API check needs 3000 free
```

The suite prints the release invocation itself whenever anything skipped. Ninety
-two checks in it had never run once before v1.84.0, and the one assertion
covering "uploaded documents are deleted" was among them — a skipped check reads
exactly like a passing one when you are scanning output.
