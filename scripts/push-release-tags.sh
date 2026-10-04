#!/usr/bin/env bash
# Recreate and push the Mastande release tags.
#
# ⚠️ The range used to be written on this line, and it was wrong: it read
# "v1.75.2 … v1.86.0" while the file held entries up to v1.95.0. A header that
# has to be remembered is a header that goes stale, so the script now prints
# its own count and range at startup, derived from the entries themselves.
#
# That matters more than tidiness. A run of an OLD copy of this file reports
# "skipped 19" and stops at v1.87.0, looking exactly like a finished run — the
# startup line is what tells you the file is behind rather than the work being
# done.
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

# ── What this copy of the file actually covers ──────────────────────────────
#
# Printed before anything runs, because an old copy of this script finishes
# quietly and looks right: "Created 0 tag(s), skipped 19. Nothing to push." is
# what a complete run looks like AND what a stale file looks like. The only
# difference visible to a reader is the range, so the range gets printed.
entries=$(grep -c '^tag_if_missing "' "$0")
first=$(grep -o '^tag_if_missing "v[0-9.]*"' "$0" | head -1 | grep -o 'v[0-9.]*')
last=$(grep -o '^tag_if_missing "v[0-9.]*"' "$0" | tail -1 | grep -o 'v[0-9.]*')
echo "This file holds $entries tag entries, $first … $last."
echo "If that range looks behind, pull before running: the tags are added by the"
echo "same commits that make the releases."
echo

# ── Gaps in the version sequence ────────────────────────────────────────────
#
# ⚠️ v1.84.0 has no entry in this file and never did. It was tagged in a
# container that was reclaimed, and the entry was never written — so the tag is
# gone and cannot be honestly reconstructed from here: between v1.83.0 and
# v1.85.0 there are three phase merges (5a/5d, 5b/5h, 5e/5f) and the commit that
# ran the ninety-two checks, and nothing in the repository records which of them
# the tag pointed at. Picking one would be inventing history.
#
# So this prints the gap rather than hiding it. A missing minor version in a
# release history is a thing somebody should know about, and it went unnoticed
# for ten releases because nothing looked.
minors=$(grep -o '^tag_if_missing "v1\.[0-9]*\.' "$0" | grep -o '\.[0-9]*\.$' | tr -d '.' | sort -n -u)
missing=""
prev=""
for m in $minors; do
  if [[ -n "$prev" ]]; then
    n=$((prev + 1))
    while (( n < m )); do missing="$missing v1.$n.x"; n=$((n + 1)); done
  fi
  prev=$m
done
if [[ -n "$missing" ]]; then
  echo "⚠️  No entry for:$missing"
  echo "    Those releases were tagged in a container that was reclaimed before the"
  echo "    entry was written. The tag is lost; the commits are not. Nothing here"
  echo "    guesses which commit it was, because guessing would invent history."
  echo
fi

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

tag_if_missing "v1.86.1" "573ebf501fdc5e14d11aa20bec454733ad9ef126" "2026-10-03 21:50:17 +0000" "v1.86.1 — Phase 7a: nav-link integrity

Every nav link checked against the routes as a FULL path, every guarded screen
checked for being reachable from some nav, and every nav label checked against
the heading of the page or section it opens.

The audit that was supposed to do the first of those compared only each link's
FIRST SEGMENT against the set of known areas, so /landlord/billing and
/landlord/my-rooms — the two dead links the brief names — would both have
passed, because 'landlord' is a real area. It printed 'every internal routerLink
resolves to a declared route' while being incapable of checking it. The third
such control in three releases, after a MAX_ATTEMPTS nothing read and nineteen
@Throttle decorators with no guard.

Four real mismatches fixed: 'My Rooms' opened a section headed 'Active
listings', and a landlord whose rooms were all drafts clicked it and read 'No
rooms listed yet' while holding three; 'Applicants' pointed at a section that
does not exist, so the count moved to where applicants actually are and the slot
now holds 'Needs you'; the footer's 'My applications' opened the dashboard root;
and /legal/sublet, shipped in v1.86.0, was in no nav surface at all. Admins got
a Notices entry, being users the notice router writes to.

Two bugs in the new tool itself, both of which invented findings, fixed before
the nav was touched — a proximity regex that mounted AUTH_ROUTES under
landlords/:slug and reported /auth/login dead, and a label matcher blind to
double quotes that reported the Renter's Passport unreachable.

Verified: 476 smoke checks, nav audit clean across 60 links and 45 labels, 21
accessibility pages, production build green. Each of the four nav checks was
falsified before being trusted."

tag_if_missing "v1.87.0" "2e55c71d1e7f1d51aba8cc9da4b5749c08cfbf98" "2026-10-03 22:37:25 +0000" "v1.87.0 — Phase 7b: properties a landlord can find

Grouping rooms at one address existed and nobody used it. The brief's diagnosis
was right: it was reachable only from inside the yard screen, below the rent
tracking and the expenses, behind a button reading '+ Group rooms into a yard' —
a concept found while doing something else, under a word used nowhere else in
the product.

Now: a list at /landlord/properties with a card per property (their own name for
it, the address under it, a photo borrowed from one of its rooms, '2 rooms — 1
vacant — 1 let'), a detail view behind each card, and an empty state that
teaches the idea in one sentence with one button. The listing wizard asks 'Is
this room at an address where you already have a room listed?' with the existing
places as recognisable cards, and '+ Add a room to this property' fills the
location in — a landlord made to retype the suburb does not come back to group
anything.

The destructive actions were the real work. Deleting a property is refused by the
API while rooms are attached unless the caller passes ungroupRooms, and the
refusal names the count and says the listings will NOT be deleted — server-side,
so no second UI can skip it. Per room, 'Take out of this property' is worded so
it cannot read as 'delete my listing', and its confirmation names what survives.

Structure is forced on nobody: the picker is hidden from somebody with no
properties, 'No — somewhere new' is a real answer, ungrouped rooms keep a card of
their own, and no property is needed to list a room.

The address line the brief wanted on the card is optional and private. This
screen had deliberately never collected a street — the board shows the suburb for
the tenant's safety — so it is nullable, in no public payload, and the form says
so where it is typed.

Verified: 485 smoke checks, 22 + 18 drive checks, 22 accessibility pages, nav
audit clean, production build green.

Found along the way, about the container rather than the code: tsc -w had
silently stopped emitting, so the running API was three edits behind and a drive
caught it. The compiled output is checked for an assertion now rather than the
watcher being trusted."

tag_if_missing "v1.88.0" "4e2ea557643648db40e52909ffd362223a33c034" "2026-10-04 07:47:09 +0000" "v1.88.0 — Phase 7c: one place to find applicants and messages

Applicants were reachable only inside one room and messages only inside one
application, so a landlord with six rooms and eleven applicants had seventeen
screens to open before they knew whether anybody had written to them. Both
portal navs listed 'Messages' greyed out with a 'Soon' chip, which Phase 7a made
them do because the entry was a promise nothing kept.

Now GET /applications/inbox and /landlord/applicants — every applicant across
every room, filtered by room or property, sorted newest first or by what is
waiting on you — and GET /messages/inbox and /account/messages, every
conversation, newest activity first, one screen for both roles. A sub-lessor is
a TENANT account that also lets a room, so two role-scoped inboxes would split
one person's messages by a distinction they do not have.

The channel a reply leaves by is said out loud, because a thread genuinely mixes
them: a tenant's message is forwarded to the landlord over WhatsApp and a reply
there is threaded back, while a reply typed on this screen is always an in-app
message. A thread that has used both channels warns about it above the composer.

Two defects found by building it, neither of which could error. Every WhatsApp
reply a landlord typed was stored as though the tenant had written it, because
the handler used the senderId of the message we had forwarded; the sender is now
resolved from the opted-in number and a reply from any other number is dropped
rather than guessed at. And Message.readAt had been on the model since messaging
shipped with nothing ever writing it, so any unread badge built on it would have
counted every message ever sent, for ever. Both were reintroduced and driven to
confirm the checks catch them.

The accessibility drive turned out to have been auditing every portal screen
empty — a fresh account has no rows — so it now seeds a room, an application and
a message first, and the first run with content on the page found a row of text
rendering white-on-cream at 1.06:1.

Verified: 497 smoke checks, 43 + 33 drive checks, 25 accessibility pages with
content on them, nav audit clean, throttle lint clean, production build green,
26.8 KB under the bundle budget."

tag_if_missing "v1.89.0" "ecca8afc1c9ce351501388242606fad35c8c4797" "2026-10-04 08:41:20 +0000" "v1.89.0 — Phase 7d: a dashboard that answers one question

The brief asked for the task inbox to lead both dashboards, for every number to
be audited against the plain-English principle in the REAL components rather
than in the design document, and for persistent 'Add a room' and 'Add a
property' entry points on the landlord home.

The audit found that 'Total views' was a lifetime counter, so a room posted in
June could read 200 views without one of them being this month — and the spec's
own example sentence, 'viewed 47 times this week', had no data under it. New
room_view_days table: one row per room per day, a counter rather than a row per
view, no viewer identity, and the owner's own look not counted. The dashboard
reads as sentences now, with every clause stating its window, and the tenant
dashboard gets the task list the brief asks for in both portals.

Three things Phase 7b had broken, all found by doing this work:

  - The two most important buttons on the dashboard went nowhere. Each task
    row's destination is a string from the API, and they pointed at
    /landlord/yard, which 7b turned into a redirect — and a redirect drops the
    fragment, so 'Mark it' landed a landlord on a bare list of addresses.
  - 'Rent reminders' became unreachable from every screen: the control built
    because the API had no UI, left on a view with no route.
  - A landlord who never grouped their rooms could not reach their own rent.
    Grouping is optional by design, so /landlord/properties/ungrouped is now a
    real destination.

scripts/nav-audit.mjs resolves the paths the API hands the browser now, and
holds any path with a fragment to the rule that a fragment on a redirect can
never arrive. The tool was blind twice before it worked, reporting success both
times, which is recorded in docs/FLOW-AUDIT.md 5.22.

Verified: 511 smoke checks, 35 + 29 drive checks, 26 accessibility pages with
content on them, nav audit clean including its new section, production build
green, 26.8 KB under the bundle budget."

tag_if_missing "v1.90.0" "ef2aed1c25660374182e65fcd047da609822711f" "2026-10-04 12:33:33 +0000" "v1.90.0 — Phase 7e: the portal sidebar is drawn once

The sidebar was a component every guarded screen imported for itself, and two of
them did not: the listing wizard and the per-room applicants list, which are the
two screens a landlord uses most. On a phone, where that sidebar is the strip
across the top and the header hamburger carries only public links, there was no
way out of either except the browser's back button.

PortalLayout sits on the four guarded parent routes now, with the children
rendering into its outlet, so a new portal screen cannot ship without the
navigation. One badges service replaces four screens that had each grown their
own refresh call, and a screen's name moved onto the route beside the browser
title it has to agree with.

Item 23: Log in and Get started stay in the mobile header rather than behind the
hamburger — and both were 28px tall, under the tap target, before and after.
Item 24: the footer stopped offering a signed-out visitor two guarded routes,
listing Pricing twice, and offering a signed-in person a sign-up link.

Two of my own gates were wrong in the same way, a proximity window standing in
for structure, and one was the route guard check: it reported all four guarded
areas as public about a file whose guards were untouched. Both brace matched
now, and both falsified against a real defect.

CLAUDE.md records the standing constraints, mobile-first verification among
them.

Verified: 511 smoke checks, 46 new drive checks, 26 accessibility pages, nav and
route audits clean, production build green, 100.8 KB under budget. Checked at
360, 390, 768 and 1280px."

tag_if_missing "v1.91.0" "68d151b39c9e65d4a98debc7d12e20a53011e94c" "2026-10-04 13:33:51 +0000" "v1.91.0 — Phase 7f: the social card, and showing somebody round once

The default Open Graph image existed and was the right size. The URL was not:
index.html pointed at the apex, which per environment.prod.ts is a different box
answering a 301 to the www ROOT — so a crawler asked for a PNG and would be
handed the homepage's HTML. It ships in index.csr.html, the shell used when
server rendering is bypassed, which is the place nobody looks.

Width, height, type and alt are emitted now, because Facebook and WhatsApp use
them to draw a large card without fetching the file first, and WhatsApp is the
channel that matters most here. They are stated only for the one image whose
size is a measured fact: a room photo's ImageKit output size was never verified
in this container, and a wrong height is worse than none because the platform
believes it.

The walkthrough is four role-appropriate steps, skippable, reachable again from
settings, and recorded against the ACCOUNT rather than the browser — a phone
here is shared and replaced, and under SSR there is no localStorage to read on
the first paint.

Four defects came out of driving it: every brand-new account got the cookie
notice drawn over the tour's buttons, because both are fixed to the bottom and
the notice is at z-index 9999; Escape was bound on a card nothing ever focused,
so a modal on a phone had no way out but a tap; 'show me around again' opened
instantly over the message promising it would open on the next screen; and the
accessibility drive was passing for the wrong reason, auditing sixteen portal
pages that the tour would have covered.

Verified: 517 smoke checks, 35 new drive checks, 26 accessibility pages, nav,
route and env-parity audits clean, production build green, 123.7 KB under
budget. Both headline defects reintroduced to confirm the drive fails on them."

tag_if_missing "v1.92.0" "f1fe47bf9c931a9e8b5a99348fc9ee3e539c8908" "2026-10-04 14:51:15 +0000" "v1.92.0 — Phase 7g: pausing an account, and ending one

DELETE FROM users looks like the implementation. The foreign keys say otherwise,
and they were read out of postgres before anything was designed: a user row
cascades into their rooms and so into other tenants' applications, saved rooms
and reviews; into applications and so into messages, meaning both sides of every
conversation; into tenancies and so into rent_periods, which is the tenant's own
proof of payment; and into reviews they wrote about somebody else.

A landlord closing their account would have erased their tenant's application,
the tenant's rent history and the landlord's half of their conversation. POPIA
s.24 is a right to have YOUR personal information deleted, not somebody else's,
and not a right to destroy a record two parties share. So the row stays as a
tombstone and the person goes: name, email, phone, photo, password hash,
verification outcomes, notices and sessions, with the avatar leaving through the
file_deletions queue rather than merely being unlinked.

Pausing does not reuse isActive. That flag is the admin suspension, refused on
every sign-in path, so reusing it would have shipped an account nobody could
reopen. Because isActive stays true while paused, one shared PUBLIC_USER rule
now covers the storefront, the sitemap, the OTP paths and the listing bot — a
pause that leaves the shop window on is not a pause.

A wrong password used to log you out, and not only on the new screen. The
step-up checks answered 401, which the frontend reads as an expired token: it
refreshed, retried with the same wrong password and then said the session had
expired. That had been true of /account/settings since it shipped, where both
forms carry an inline error written for a message that could never render. 403
now, with an INLINE_ERRORS context token so the form reports it once.

The smoke suite had a check there and it could not fail: 401 for a wrong
password and 401 for no auth at all were the same assertion twice.

And a 34px button on a screen built this phase, because the base .btn has no
min-height. Fixed here; the app-wide measurement is in Outstanding 13, and the
previous version of the drive had computed that height and never asserted it.

48 API checks, falsified by replacing the tombstone with a real delete, which
failed 14 of them naming every piece of cascade damage. 51 UI checks across
360/390/768/1280, falsified by restoring the 401, which failed 7 and named both
screens. 13 new smoke checks; 453 passed."

tag_if_missing "v1.93.0" "30d3742b9f9df6edcbad789f22412665dd1a5b02" "2026-10-04 16:04:40 +0000" "v1.93.0 — Phase 7h: the controls a landlord presses

Six brief items that read like styling niceties. Every one was a control that
looked like a control, and none was visible to any other gate here, because
each is a question about the rendered box.

The wizard's Back, Cancel and Next measured three identical solid terra
buttons, 33px tall, 6px apart at 360px — one of which abandons the form. Cancel
carried a real global class written to make it a bordered secondary button, and
that class had done nothing since the day it was typed: a component's own bare
element rule outranks it, because Angular's emulated encapsulation appends an
attribute selector. The same rule had been rendering the property picker
Phase 7b built as a stack of solid blocks, with the dashed card's dash
invisible, and made choosing one DARKER by a shade nobody would notice.

Deleting it also removed the only :disabled styling in the app, so that is
global now — the wizard's Next is disabled until the description reaches 50
characters, and a disabled primary that looks live is a button somebody taps
while nothing happens.

Sideways scroll at 360px was blamed on the portal nav, which rendered 386px
wide. The nav was not the cause; it was the only thing wide enough to notice. A
fieldset will not shrink below its min-content, and main.portal-main is a grid
item whose min-width: auto sizes the whole track. Both needed min-width: 0.

The applicant action row was 25-27px tall and 8px apart — Accept beside Reject
— and its media query used a breakpoint this codebase does not have, so at
430px the mobile layout did not apply at all. The card itself could only be
opened with a pointer: a div with a click handler and no role or key handler,
so a landlord on a keyboard could reach no applicant's details, references,
Accept or Reject.

.btn is 44px app-wide now, after a third screen in one sitting needed the same
local patch, and .link-btn went from 17px to 44px — that class carries Remove
on each expense, which deletes the record.

The grouped property card was measured at four widths and found sound, so
nothing was changed. Saving the shared facilities said nothing at all. And the
money-spent section had no stylesheet anywhere in the product: the receipts
rendered as a disc list and the actions row with the buttons a word space apart.

130 drive checks at four widths, falsified twice — 24 failures with the wizard
rule restored, 30 with the expense stylesheet removed, naming Remove at 20px.
Three faults in the drive itself are recorded, and a pre-existing dashboard
flake was fixed rather than lived with."

tag_if_missing "v1.94.0" "0b6d87e83cc34cdcbfeb3d7394d0adc2d4c2f3ea" "2026-10-04 16:43:49 +0000" "v1.94.0 — Phase 7i: an admin can end an account on its owner's request

It could not before, and Phase 7g had already recorded why that mattered: a
phone-only account has no password, so /account/close cannot confirm it. That
screen tells the person to ask us, and there was nothing behind the asking.
POPIA s.24 is a right, not a feature request.

Its own route rather than a flag on the suspend one, because suspension is
reversible, keeps the email and is a moderation decision we make, while closure
is irreversible, erases the email and is the owner's decision we carry out. One
endpoint doing both is how somebody suspends an account and ends it.

The erasure is the same code as the owner's path, extracted to one method both
call — two erasures that start identical drift, and the one that drifts is the
one nobody drives. The preview is byte-for-byte the owner's, so an admin acting
on a request reads what that person would have read.

It takes a written request of real length, the word CLOSE, and a box that
arrives unticked, because after it runs the email, the name and the number are
gone and the audit row is the only lasting evidence it was asked for. That row
holds the user id, the admin and the reason, and no identity at all: an audit
trail that keeps what the erasure removed defeats the erasure it audits.

The suspend toggle could have resurrected a closed account. Sign-in would still
have refused it, but the admin screen would have shown it as active and the
operator would have believed it.

Falsification rescued a guard that looked redundant: without it, an admin
closing their own account is still refused, but refused with advice to delete
their own row from the database — the one action the tombstone design exists to
prevent.

42 + 42 drive checks, both drives promoting their own admin so nothing is
skipped for want of a credential. And the admin screens were accessibility
audited for the first time: 17 portal pages to 27."

tag_if_missing "v1.95.0" "9bfb506caa3e2a74bef0a1fae3d241593746a210" "2026-10-04 17:06:27 +0000" "v1.95.0 — Phase 7j: making the directory's trust claim true

The Who to Call page opened with \"People we have checked out and can pass on\",
and its empty state read \"It is names we have checked, not an open directory\".
ServiceProvider had no column, no table and no outcome recording that anybody
had checked anything. Same family as a documentDeletedAt that deleted nothing,
except this one faced the user and asked them to rely on it — on the axis this
product competes on, in the moment a landlord decides whether to let a stranger
into their tenant's room.

Three named, dated outcomes now: we rang this number and reached them, we saw
an identity document, we spoke to a landlord they have worked for. Plus a trade
registration shown verbatim, with the caveat that we pass it on as given — a
landlord checking it with PIRB themselves is the only thing that makes it worth
storing. The screen lists which checks exist, so one check and three checks no
longer read alike.

Dates rather than booleans, because a check has a date or it is a rumour, and
the admin supplies the date: a call made on Tuesday and recorded on Thursday is
a Tuesday check.

Nobody is listed until the number has been rung, enforced in the service and as
a CHECK constraint, and evaluated against what the row will be rather than
against the request. Only outcomes persist — no document is ever stored, the
rule verification_requests already follows.

The migration un-publishes every live provider, which is the honest migration
rather than the convenient one: none of them had a recorded check.

22 + 41 drive checks. The UI drive clears a stored outcome and reads the screen
again, because if the lines were decoration nothing would change. Falsified by
disabling the guard, dropping the constraint and leaking the admin id: seven
failures, including \"2 live providers have no phone check — the claim on the
screen is false for them\"."

tag_if_missing "v1.96.0" "acacd212e2e1574bc2fcd16d5abf2f960e466ba7" "2026-10-04 20:12:46 +0000" "v1.96.0 — Phase 7k: contractor leads recorded, collecting left to a decision

The brief said to inspect the contractor, lead and user models before
implementing payments. Inspecting them answered the question: a contractor is
not a user. ServiceProvider has no userId and no email — a name, a phone number
and the areas they cover — so they cannot sign in, see a bill, accept terms or
dispute a charge. There was no lead model at all either.

So this builds the record and stops: what was passed on, to whom, on what day,
and what it comes to at a rate somebody agreed. Invoicing happens outside the
product, by a person. Collecting inside it needs contractor accounts first,
which is a product and the owner's decision — recorded as Outstanding 16 with
the three ways forward.

The drives assert the stop: no paid, invoiced or settled column on a lead, and
no pay, invoice, checkout or charge route. It does not touch free-to-list,
free-to-apply: the money would come from a third party receiving leads.

There is no price anywhere in the code — not a constant, a default, an env var,
an API example or a form placeholder. The rate table ships empty, and an
unpriced lead is counted and marked not billable, which the admin screen says
in words rather than showing R0.00. Rates are per category, effective-dated and
insert-only; the fee is snapshotted so a price rise cannot re-price history, and
billable is stored so agreeing terms in November cannot make October billable.

The landlord is told that pressing Call records the hand-over, that they are
never charged, and that we do not say which landlord it was. Their identity is
kept for dedupe and disputes, never shown to the contractor, and nulled when
they close their account.

33 + 43 drive checks, falsified by inventing a default price and by folding the
two lead counts into one: four failures. Three faults in the drives themselves
are recorded, including one that only passed on a clean database."

tag_if_missing "v1.97.0" "148b89f134b9f4c111dc22d4ec6e6d0095792376" "2026-10-04 20:50:36 +0000" "v1.97.0 — Phase 7l: invite an applicant to a viewing, without giving away the address

Nothing in the product arranged a meeting. \`viewed\` on an application meant the
landlord had opened it, and it read on both screens as though the room had been
viewed — one more status asserting something that never happened.

A viewing is now its own row: proposed, accepted, declined or cancelled, one
open invitation per application, either side able to call it off. The meeting
place is typed per invitation and never pre-filled, because Property.addressLine
promises on its own form that it is never sent to an applicant. There is
deliberately no useMyPropertyAddress flag to add later.

The API drive asserts the saved address reaches neither the stored row, nor the
tenant's notices, nor the tenant's API payload. Three CHECK constraints hold the
same line in the database: a meeting place that is not blank, an answer that has
a date, a cancellation that has a date.

The tenant's panel carries the two lines that matter for somebody meeting a
stranger at a room — tell somebody where you are going, and never pay anything
before you have seen the room — linking the room's page, where reporting lives.
It renders nothing when there is nothing booked, so a new tenant is not shown an
empty queue, and the a11y drive seeds a viewing so the panel is measured rather
than audited blank.

35 + 41 drive checks at 360 / 390 / 768 / 1280. Falsified to five failures,
including \"the private property address reached the tenant in a notice\". The
first falsification could not fire — the DTO's MinLength refuses a blank meeting
place before the service's fallback runs — and that is recorded rather than
counted as a pass."

echo
# ⚠️ created + skipped must equal the entry count. If it does not, the run
# stopped early — which `set -e` makes possible and which the old summary could
# not have shown: "Created 0, skipped 19" was indistinguishable from a complete
# run of a file holding 27 entries.
echo "Created $created tag(s), skipped $skipped — of $entries entries in this file."
if (( created + skipped != entries )); then
  echo "⚠️  That does not add up: $((entries - created - skipped)) entr(y/ies) never ran."
  echo "    The run stopped early. Nothing below this point was reached."
fi
if [ "$created" -gt 0 ]; then
  echo "Pushing ${#to_push[@]} tag(s)…"
  git push origin "${to_push[@]}"
  echo
  echo "Done. Verify with:"
  echo "  git ls-remote --tags origin | grep -E 'v1[.](7[5-9]|8[0-9]|9[0-7])[.]'"
else
  echo "Nothing to push."
fi
