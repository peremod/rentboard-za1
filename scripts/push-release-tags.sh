#!/usr/bin/env bash
# Recreate and push the Mastande release tags v1.75.2 … v1.86.0.
#
# These tags were created inside an ephemeral cloud container whose
# credentials are refused for refs/tags/* (HTTP 403), so they never reached
# GitHub and are lost when that container is reclaimed. Every tagged commit IS
# already on the remote — only the tag objects are missing, which is why this
# recreates them here rather than transferring anything.
#
# Run from any clone of peremod/rentboard-za1 with push rights:
#
#     bash push-release-tags.sh
#
# Safe to re-run: a tag already on the remote is skipped, never overwritten,
# so this cannot move a tag anyone else is relying on. Each tag keeps its
# original message and date.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
echo "Fetching, so every tagged commit is present locally…"
git fetch origin --quiet

created=0
skipped=0
# Only what this run created. `git push origin --tags` pushes EVERY local
# tag, including the forty-odd already on the remote; git rejects those as
# "already exists" and the whole push fails, taking the new tags with it.
# Found by running this script rather than reading it — the first version
# ended in "failed to push some refs" having pushed nothing at all.
to_push=()

tag_if_missing() {
  local name="$1" sha="$2" when="$3" msg="$4"

  if ! git cat-file -e "${sha}^{commit}" 2>/dev/null; then
    echo "  SKIP $name — commit $sha is not in this clone"
    skipped=$((skipped+1)); return
  fi
  if git ls-remote --exit-code --tags origin "$name" >/dev/null 2>&1; then
    echo "  SKIP $name — already on the remote"
    skipped=$((skipped+1)); return
  fi
  GIT_COMMITTER_DATE="$when" git tag -a -f "$name" "$sha" -m "$msg" >/dev/null
  echo "  tagged $name -> $(git rev-parse --short "$sha")"
  to_push+=("refs/tags/$name")
  created=$((created+1))
}
tag_if_missing "v1.75.2" "fa0f8181645d9b1bdf77bddd3264894e978677a9" "2026-09-26 15:44:09 +0000" "v1.75.2 — the build that had been failing for three days"

tag_if_missing "v1.76.0" "4c1caf432c3248c686d2b783f9587206b1ce91be" "2026-09-26 19:47:48 +0000" "v1.76.0 — the four open code items, and the two they uncovered"

tag_if_missing "v1.76.1" "868318af8c73baa3ccc39a2e2ceba468c099fd4b" "2026-09-27 20:30:39 +0000" "v1.76.1 — canonical on www"

tag_if_missing "v1.76.2" "c3d54a72bee5f8c8c262c3477f0b8b41baee9f35" "2026-09-27 21:06:07 +0000" "v1.76.2 — environment guard checks values"

tag_if_missing "v1.77.0" "afbf3f0301b4d006bd5a9d489867ee2dd51d3100" "2026-09-27 22:10:15 +0000" "v1.77.0 — Search Console verification without DNS"

tag_if_missing "v1.77.1" "44400b38cab8b48077d1add7e7bbe6e3c974408b" "2026-09-27 23:00:55 +0000" "v1.77.1"

tag_if_missing "v1.77.2" "d9bcd3b314e6ca927dedaa410340828437eb9927" "2026-09-27 23:51:20 +0000" "v1.77.2"

tag_if_missing "v1.78.0" "dd7e70a35755e0cccc687c7f1bf1c46883a0919f" "2026-09-28 03:06:50 +0000" "v1.78.0"

tag_if_missing "v1.78.1" "2e7c3bda55eff2f0c26e3ef41ddb3a36bd3ea4b0" "2026-09-28 03:25:16 +0000" "CI actually checks what it claimed to"

tag_if_missing "v1.79.0" "1bed1e0f819d0cf7bfcd62dba2a1bd52f49089a3" "2026-09-28 08:05:43 +0000" "The legal pages say what the code does"

tag_if_missing "v1.80.0" "4db3ff19419d1a51ca712f0a78641d2f38caf4bb" "2026-09-28 15:46:30 +0000" "v1.80.0 — landlord research survey (Phase 0)

Phase 0 of the differentiator work. The survey that decides whether the
yard-management tiers are worth building, rather than assuming them.

  · Survey, SurveyResponse, SurveyDismissal — additive migration
  · Eligibility decided server-side, never by the client
  · One question after a letting; the full set as a skippable dashboard card
  · A skip is honoured for 30 days, recorded server-side not in localStorage
  · /admin/surveys — counts segmented by room count, nobody named

Deferred: WhatsApp delivery, to Phase 7g. Every outbound message here is
free-form text, which Meta permits only inside the 24-hour window, so
business-initiated outreach needs an approved template that does not exist.
The same defect already breaks sendOtp. See checklist row 40.

Also: verify-build.sh now counts and names skipped checks instead of
reporting 'Verified. Safe to tag.' over assertions that never ran."
tag_if_missing "v1.81.0" "4f2c8137e1d5d27a3af8b590caa2a1562b66c4ea" "2026-09-28 18:46:28 +0000" "v1.81.0 — yard shared-living details and bulk relist (Phase 2 Tier 1)

A yard carries what the whole address shares: house rules in the landlord's
own words, shared facilities, how many people already live there, and what
kind of household it is. On Property rather than Room, because four rooms at
one address have one kitchen and one set of rules.

  · housemateProfile defaults to 'unstated' and is never rendered — silence is
    not a claim about who someone would be living with
  · the room page shows it under 'The rest of the house', and never the yard's
    private dashboard nickname
  · bulk relist puts every relistable room back on the board, skipping what it
    cannot and naming why per room

Also: the accessibility drive now audits a real room page, reached by following
the first card on the board. Its first run found a live WCAG 1.3.1 failure —
the ad slot hardcoded an h4 for house-advert headlines, so the room page went
H2 to H4. Fixed, and the summary counts the extra page.

Tier 2 deliberately not started: the brief gates it on survey data that does
not exist yet."

tag_if_missing "v1.82.0" "27f15165018fcfd09ce331a26482ccc59c4718a1" "2026-09-29 01:54:59 +0000" "v1.82.0 — Phase 4b, 4c and 4d: the money picture, leases ending, who to call

Three features that give a landlord a reason to open Mastande on a day when no
room is empty. Every competitor in this market is a listing portal you visit
only when you have a vacancy.

Phase 4b — expenses. What went out, against what came in. An expense hangs off
the property, not the room, because that is how the money is spent: one
municipal bill, one plumber, one gate motor for the whole address. The money
card states which rent months it counts, because a figure whose rules are
invisible is one someone plans around and is wrong about. Nothing stores a
share, so Phase 6 co-tenant splits stay open.

Phase 4c — lease renewal and notice. Lease end dates, notice periods, and the
rooms about to free up.

  · leaseEndDate null means month-to-month: a real answer, not an unset field
  · a rolling tenancy with no notice appears in neither list, because nothing
    is happening to it
  · a lease already past shows as overdue rather than hidden — an overdue
    relist is the urgent one
  · a second notice does not overwrite who gave the first

Phase 4d — the contractor directory. Five trades, admin-curated because an open
directory is a directory of whoever registered fastest. Tap to call or message;
no booking and no payment, because either would make Mastande a party to the
job. Numbers normalised to E.164, whatsapp stored rather than inferred,
providers off by default.

No fee of any kind was added. Listing is free, applying is free. sponsoredUntil
exists unread and would charge an advertiser rather than a landlord.

Not in this release: Phase 4e, lease documents. Storage only when built, and
explicitly no e-signature — that is document execution.

Also: lease-ui-drive.mjs now asserts that the two Phase 4 cards order correctly
on one yard, because the merge had to choose and the accessibility drive cannot
see it — its landlord has neither card. And verify-build.sh no longer tells you
to \"start the API and re-run\" for the one skip whose remedy is the opposite.

Verified: 334 API checks, 25 accessibility pages, six browser drives,
verify-build.sh both ways. Six migrations apply clean in sequence."

tag_if_missing "v1.83.0" "9bbffa75f5a359189f45b264439897e68010af3c" "2026-09-29 04:32:59 +0000" "v1.83.0 — files are actually deleted now, and Phase 4e

The headline is not the feature. While building lease document storage, the
retention pattern it was told to follow turned out never to have deleted
anything.

Nothing here had ever deleted a stored file. Deciding a verification cleared
documentPath, stamped a column called documentDeletedAt, and wrote an audit
event reading \"The uploaded document was deleted. Only this outcome is kept —
POPIA s.26.\" There is no ImageKit SDK in package.json and no call to its delete
API anywhere. The reference went; the ID photograph stayed.

Three live statements said otherwise, one of them statutory — the privacy
policy, the PAIA manual, and the line shown to a tenant at the moment they
upload their ID.

It survived because the one check covering it asserted our own timestamp rather
than the file's absence, and sat behind ADMIN_TOKEN so it had never run. And
because the admin queue linked to a bare storage path that resolved against our
own origin: every private upload was write-only.

Now: FileDeletion is a durable queue whose row commits with the change that
orphans the file. deletedAt comes from the storage provider's response, never
optimistically. documentDeletedAt is renamed documentWithdrawnAt by a
hand-written RENAME COLUMN, because Prisma's generated DROP + ADD would have
discarded it on every request ever decided. The trail records withdrawal and
deletion as two facts. GET /admin/storage/status makes the promise checkable.

Phase 4e — lease documents, storage only. Both parties keep the signed lease.
Either may upload; only the uploader may remove their own. No admin route.

No e-signature, held by tests: no field may match /sign|witness|execut|notar/,
POST .../sign must 404, and the panel must never say \"is signed\", \"legally
binding\" or \"verified by\". A lease is KEPT, unlike an identity document — a
contract both parties need for as long as it can be disputed.

No fee of any kind was added. Listing is free, applying is free.

Verified: storage-drive.mjs IS an ImageKit stub, so it checks a DELETE arrived
for the right file and that a 500 is not recorded as a deletion. Reverting the
fix makes it fail and exit 1. 340 smoke checks, 25 accessibility pages, nine
drives, verify-build both port states, three migrations clean from empty.

Not settled: whether ImageKit ACCEPTS our signatures. No credentials in the
build container — confirm on staging with a real key before launch."

tag_if_missing "v1.85.0" "aca0075a38fc4d105e55918debb05e8014298249" "2026-09-29 10:15:20 +0000" "v1.85.0 — Phase 7g part one: email becomes optional

Email is nullable, phone is an alternative login identifier (unique among
VERIFIED numbers, by a partial index — the column has never been unique and the
dev database had forty accounts sharing one number, so a full index could only
be created by nulling other people\'s saved numbers), and a database CHECK
requires at least one of the two. Prisma cannot express a partial unique index
and will offer to drop it on migrate dev: do not let it.

Making the column nullable surfaced 22 notification call sites that assumed an
address existed — a phone-only landlord would silently have missed their
applications. One NoticeRouter decides the channel instead of sixteen copies of
the decision.

Also the OTP hardening: wrong codes counted per account with the code burning at
five, one live code at a time, a daily cap, and the stored hash an HMAC keyed
with the server secret rather than a bare digest anybody who could read the
table could reverse in a second.

Not settled: PayFast requires email_address, so a phone-only landlord is refused
at checkout with an instruction to add one rather than given a placeholder."

tag_if_missing "v1.85.1" "5151f99a721e74fc82dba37a44c9691f0c58a95a" "2026-10-03 16:12:48 +0000" "v1.85.1 — Phase 7g part two: sign up with a phone number

A person with only a mobile number can create their own account: a code to the
number, the code for a short-lived ticket, then name, role and the terms. No
User row exists until that last step, so a sign-up attempt cannot create an
account on somebody else\'s handset — and acceptTerms must arrive literally
true, with the moment recorded against the number that was proven. That is what
makes assisted sign-up safe: the help can reach as far as the handset, the
acceptance stops at the person.

The in-app notice channel those accounts depend on can now be READ. It had been
write-only since v1.85.0: a phone-only landlord\'s \"you have a new applicant\"
went into a table, WhatsApp refused it outside Meta\'s 24-hour window, and
nobody was told anything by any channel.

And the rate limits that were supposed to protect all of this did not exist.
Nineteen @Throttle decorators across eight controllers had never limited
anything, because ThrottlerGuard was never registered and the root throttler was
named \'global\' while every decorator keys \'default\'. /auth/login had no
decorator at all, so password guessing was unmetered. Found by sending eight
requests to a route marked limit: 5 and getting eight 200s. throttle-lint.mjs
now fails the build if it can happen again.

Verified: 464 smoke checks, 29 phone-signup + 11 UI + 9 notices drive checks,
19 accessibility pages, verify-build 73/0, production build green. Each new
check was falsified before being trusted.

Not settled: a new number has never messaged us, so it is always outside Meta\'s
24-hour window — phone sign-up waits on the authentication template, not on
code."

tag_if_missing "v1.86.0" "5fdf9ae1d769b8b758e457c225dd483c02cb65be" "2026-10-03 21:19:10 +0000" "v1.86.0 — Phase 6: tenant sub-letting and shared-lease listings

A tenant who rents a place can let out a room in it. Option A: listerType on the
listing rather than on the account, since the same person can own a yard in one
place and sublet a room in a flat they rent in another.

The guard split is the substance of it. Fifty-two endpoints carried
LandlordGuard, and widening that guard would have opened the yard, rent
tracking, expenses, the paid identity badge, the storefront and WhatsApp listing
in one invisible edit. A new ListerGuard carries what a LISTER does; LandlordGuard
keeps what an OWNER does. Asserted both ways, including 403 on all five owner
surfaces, because a guard split that is only described is a guard split that
drifts.

The sublet-right check belongs to a LISTING and not to a person: a right to
sublet in Yeoville says nothing about Soweto. Approval stamps a date, a later
rejection clears it, and the room page says \"lease and consent checked on 14
March\" rather than \"may sublet\" — the head landlord can withdraw consent the
next day and nothing tells us. No fee: listing is free on this platform, and
charging a sub-lessor to prove their right would be a landlord listing fee
wearing a different name, on the one check that protects the applicant.

What the applicant gets: a badge on the card and a notice above the fold
(measured at 522px of a 900px phone) saying who is letting the room, that we do
not confirm the right to sublet, and that it is they who can lose the room and
the deposit.

Positioning: the same board with an explicit filter, because splitting it halves
the inventory each half can show and a thin board is what loses both segments at
launch.

Verified: 476 smoke checks, 38 sublet drive + 13 UI drive checks, 21
accessibility pages, production build green. Adding the listing wizard to the
accessibility drive found that it had never had an h1.

Not settled: /legal/sublet is written from scratch, addressed to the applicant
rather than to our liability, and NOT attorney-reviewed. It characterises the
effect of a head lease on a sub-tenant and summarises the Rental Housing Act on
deposits — docs/OUTSTANDING.md §8 names the sections to ask about."

echo
echo "Created $created tag(s), skipped $skipped."
if [ "$created" -gt 0 ]; then
  echo "Pushing ${#to_push[@]} tag(s)…"
  git push origin "${to_push[@]}"
  echo
  echo "Done. Verify with:"
  echo "  git ls-remote --tags origin | grep -E 'v1[.](7[5-9]|8[0-6])[.]'"
else
  echo "Nothing to push."
fi
