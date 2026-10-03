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

## 5. Staging migrations — before any deploy

Twenty migrations are in the repo. How many are unapplied on staging depends on
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

What is left of 7g is listed as its own items rather than as a decision:
assisted sign-up mode, account recovery for a phone-only account, and adding an
email later.

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

## How to check the whole thing still works

```bash
# API, with every gate open. Anything less leaves checks unrun.
ADMIN_EMAIL=<seeded admin> ADMIN_PASSWORD=<their password> \
  WHATSAPP_APP_SECRET=<the API's own> \
  RESEND_WEBHOOK_SECRET=<the API's own> \
  ./scripts/smoke-test.sh          # 464 passed, 8 skipped without the three
                                   # secrets above; set them and five of those
                                   # become checks, leaving 3 named skips

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
```

The suite prints the release invocation itself whenever anything skipped. Ninety
-two checks in it had never run once before v1.84.0, and the one assertion
covering "uploaded documents are deleted" was among them — a skipped check reads
exactly like a passing one when you are scanning output.
