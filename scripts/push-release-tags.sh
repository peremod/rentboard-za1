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

tag_if_missing "v1.98.0" "f515ba39fc8a9d9114cb6ad7f9aa5d9c4a2f253c" "2026-10-04 21:10:30 +0000" "v1.98.0 — Phase 7m: sponsoredUntil was a writable control with no reader

Four comments said nothing reads it — schema, ordering method, DTO, frontend
model — and all four were true. The ordering method even explains why it stays
out of the ORDER BY, and a drive asserts sponsoring does not move a provider up
the list.

What none of them said is that it was writable. PATCH /api/services/admin/:id
with a sponsoredUntil returned HTTP 200, echoed the date and stored it, and
\`1999-01-01\` was accepted too — the only rule on it was @IsISO8601(). An admin
could sell a placement, record it, be told it worked, and have nothing happen.
The house defect with money attached: the payment would be real, the placement
would not exist.

The subtler half is that it sat in the ordered() SELECT, which is this
codebase's deliberate allowlist and the mechanism that keeps checkedByAdminId
away from landlords. Every landlord received the field; nothing in the app read
it. So the decision not to sell placement was held by a comment in a backend
method while the material to defeat it was already in the browser and typed in
the model — one .sort() in a component makes the directory an advertising
surface without touching the backend, the comment, or the drive that guards it.

Off both DTOs, so forbidNonWhitelisted turns a write into a 400 naming the
property. Out of the payload and out of the model. Existing values cleared as
residue: nothing set them deliberately, nothing can set them now, nothing reads
them, and a date there asserts a commercial arrangement that does not exist. The
column stays — a cheap bet in Phase 4 and still cheap.

The old single check PATCHed a sponsorship and asserted the order held, which
passed while exercising the write that was the defect. Four checks now, the
ordering guard tested against a row that really is sponsored (set in the
database, because the API cannot), precondition asserted, and the drive cleans
up after itself — it had left a live development provider reading \"sponsored
until 2026-11-03\".

Falsified by reintroducing all three bugs at once: four failures, each naming
its own. And one of the two new smoke checks was faulty and caught before
shipping — it passed on a 401 body, the third time in this repository and the
second in that file, which warns about it in its own header.

Selling placement remains undecided and needs a label plus a contractor who can
be billed: the same blocker as lead fees, folded into Outstanding 16 as one
decision. 568 smoke checks passed, 0 failed."

tag_if_missing "v1.99.0" "e84e5201debf426a7c6da3d9928aeeb34c65a744" "2026-10-04 21:53:12 +0000" "v1.99.0 — Phase 7n: the mobile nav strip was complete in the DOM and unusable

Phase 7e fixed whether the portal nav is drawn, after two screens shipped
without it. Phase 7a fixed what it says, after six copies disagreed. Neither
asked whether a person holding a phone can use it, and the 46 checks asserted
\`scrollable: true\` and stopped there.

Measured at 360px: fourteen items, TWO visible. A 2251px strip in a 359px
window, so 1892px off the right-hand edge, with background-image none, no mask,
a 1px scrollbar and opening scrolled to 0. A landlord saw Dashboard and Active
listings and a clean edge. All applicants, Messages, My properties,
Verification, Your public page, Who to call, Notices, Settings and the + List a
room call to action were all real, all 44px tall, and all behind a swipe gesture
with nothing on screen suggesting there was anywhere to swipe. Log out was the
one item not stranded: it is also two taps away in the phone drawer.

Two more faults surfaced while measuring, neither of which the nav audit can
see, because every link in the nav resolves to a real route — the same blind
spot that hid the footer's guarded links in 7e. Browse rooms was marked the
current page on all six tenant screens, because it points at / and a non-exact
match treats / as a prefix of every URL in the app. And every item naming a
dashboard section lit up together, routerLinkActive not looking at the fragment:
five highlighted on the tenant dashboard, four on the landlord one. A nav that
says you are in five places tells you nothing about which.

The fix is a four-layer scroll shadow, chosen because it is self-regulating —
the covers scroll with the content over shadows pinned to the element, so an
edge fade shows only while there is really more nav past it, and a static
gradient would promise more nav at the end of the strip. Light shadows and ink2
covers, because this is a dark bar and the usual black scroll shadow is
invisible on it, which is how it would have shipped looking fixed. isActive()
replaces routerLinkActive with one readable rule, giving exactly one
aria-current per screen where there was none. And the strip scrolls to the
active item, assigning scrollLeft rather than calling scrollIntoView, which
walks up the ancestors and would jump the content being read.

/tenant/passport now opens with the strip at 610px and the right item on
screen, alone. It was 0px with the wrong item highlighted.

Six new checks, including the one nothing asserted before: that the far end of
the strip really arrives. Falsified by reintroducing four bugs at once: four
failures. A seventh check was then added because one of those four had no check
that could fail for it, and falsified on its own.

One of my own new checks reported a product bug that did not exist: this phase
added scroll-behavior smooth, so a programmatic scrollLeft is animated and
reading it back in the same tick gives the starting value. Recorded.

Named rather than implied: two of fourteen items is what fits at 360px with word
labels. Showing more means truncating them or going icons-only, which is a
redesign of a strip 7e chose deliberately and which the drive asserts. The fade
and the reveal make that pattern work; they do not make fourteen items fit on a
360px screen. 54 drive checks, 569 smoke passed, 0 failed."

tag_if_missing "v1.100.0" "67f67ffb2b3f5ccca6d7a9de687ad99312986637" "2026-10-05 05:26:24 +0000" "v1.100.0 — Phase 7o: a phone-only account could lock itself out with one typo

Two of the three items 7g left behind — adding an email later, and recovery for
a phone-only account. Neither turned out to be a feature so much as a shipped
lockout.

Phase 7g gave a WhatsApp-first person their own account: no email, no password,
the verified number as the single credential. It was bolted onto screens written
for accounts that have an address. Measured on a real one made through the
product's own three-step flow:

  PATCH /api/users/me {\"phone\": \"\"}              -> HTTP 500
  PATCH /api/users/me {\"phone\": <one digit out>}  -> HTTP 200, account gone

After the second, the account points at a number nobody holds with
phoneVerified false. Phone sign-in finds accounts by VERIFIED number, so it
cannot find them. forgot-password needs an address they do not have. And asking
for a sign-in code on the number actually in their hand answers 'a code is on
its way on WhatsApp' and sends nothing, because that reply is deliberately
identical for a number with no account. The product reassures them
indefinitely while they are locked out. The 500 was the database CHECK refusing
the row — a line the application did not know it was relying on.

Both ways off such an account were refused with 'This account signs in with
Google', to people who have never seen Google. Both guards were
if (!user.passwordHash), written when Google was the only way to have no
password; 7g added a second and nobody revisited them. Not merely a wrong
sentence: adding an address is what lets a phone-only landlord pay the
verification fee and what makes the account recoverable if the number is lost.

The settings screen could not have done better. Nothing in its payload said
which kind of account it was, so it rendered 'Currently' followed by an empty
bold tag, asked for a password that does not exist, and offered a form whose
only possible answer was about Google.

Now: the profile field refuses to touch the number when it is the only way in.
A phone_change token type with a newPhone column makes a change proven before
it lands — the code goes to the new number and the account keeps the old one
until it comes back — and the confirmed number arrives already verified,
because the un-verified window was the lockout. A single-use step-up code is
the credential where there is no password. Both guards branch on authProvider,
so a real Google account still gets the real message. hasPassword is derived
onto /auth/me and the sign-in payload, never the hash.

30 API and 25 UI checks. Falsified by reintroducing five bugs at once: 13
failures, including the original 500 and the original 200-on-a-typo reproduced
exactly as they were measured.

Three faults of my own are recorded, none caught by the check that should have
caught it. A dead button shipped: passwordReady was a computed() over a
FormGroup, whose value is not a signal, so it cached false and Change password
was disabled for every account that has one — found by the account-lifecycle
drive trying to click it, not by the new drive reading the screen. hasPassword
was only on /auth/me, which restored the very screen this phase fixes for a
new account; the UI drive caught that and the API drive could not, because the
API was right. And two skip messages blamed JWT_SECRET for a number that had
changed and for a route name that was wrong.

Named rather than built: losing the number entirely — stolen phone, dead SIM —
still has no route back, because every route needs the old number in hand.
Assisted sign-up, the third of 7g's items, needs a decision about who may
assist before it can be built. 575 smoke checks passed, 0 failed."

tag_if_missing "v1.101.0" "814278233172032da552d999e821f5dffa1492c6" "2026-10-05 06:49:32 +0000" "v1.101.0 — Phase 7p: assisted sign-up recorded, and 29 inputs nobody had measured

The last of the three items Phase 7g left behind, and it needed a column rather
than a flow. The control that makes helping safe was already there, and the
service's own header said so: complete takes acceptTerms from the request and
records when against the row the handset proved, and a helper cannot reach that
step without the six-digit code, which goes to the person's own phone.

Help reaches the handset. Consent stops at the person. What was missing was only
the record of who helped.

Admin-recorded rather than open to any signed-in account. There is no agent role
in this product, and an open version would be a way to send sign-up codes to
arbitrary numbers with somebody else's name against the record — the same shape
as admin-initiated account closure in Phase 7i.

The reply carries no code and no ticket, and that is the whole design: an admin
handed either could create an account in somebody's name and tick the Terms for
them, and the record would say they were helped. The drive asserts the six
digits appear nowhere in the response under any key, and the smoke suite greps
the message for six consecutive digits as well, because has('code') cannot see a
code under another name.

One deliberate divergence from the public endpoint: the admin IS told when a
number already has an account. Withholding it makes assisting useless in the
case it matters most, since somebody who has an account and has forgotten needs
signing in rather than signing up, and an admin can already read the user list.
The refusal names nobody, and the public endpoint is unchanged — which the drive
asserts too.

27 API and 21 UI checks, falsified four-at-once to 11 failures.

Then the UI drive measured the new admin field at 37px, so the rest of the app
was measured at 360px: every text control under WCAG 2.5.8's 44px. Twenty-nine
of twenty-nine, from 37px down to 30px on the board's own filter row, across the
board, login, register, phone sign-up, account settings, the listing wizard, my
properties and the admin overview. v1.93.0 closed Outstanding 13 by making .btn
44px app-wide after the third local patch; nobody looked at the inputs.

The drive that should have caught it said it had. layout-ui-drive prints 'every
control clears 44px' and measureRow's selector is button, a.btn — a claim about
controls measured over a subset of them, for three releases, in the drive
written for this exact problem. It says 'every button' now, and a new section 9
sweeps every visible text control on six screens at four widths, because a
row-shaped check can only find this on the rows somebody thought to list.
Falsified by removing the global rule: 24 failures, naming each control and its
height.

Three faults in my own drives are recorded, and the second was the fix for the
first. A one-shot storageState() does not survive a rotating refresh cookie:
reused across four widths it worked at the first and was signed out at every one
after, and without the login-bounce guard the sweep would have measured the
login form's two fields and called the page clean. Chaining the state then left
the original page holding a token rotated away three contexts earlier, and that
section sat on a click until Playwright's thirty-second timeout and died with a
stack trace instead of saying so. And the sweep signed in per page per width,
eight extra logins against a thirty-per-fifteen-minutes limiter.

Phase 7g is finished with this. One named gap remains across the phone-only
work: losing the number entirely has no route back, because every route needs
the old number in hand. 585 smoke checks passed, 0 failed."

tag_if_missing "v1.102.0" "435ef5a4f7780dc0628af2a2f25dc37d62f7d88e" "2026-10-05 07:37:41 +0000" "v1.102.0 — Phase 7q: lost-number recovery, and a CHECK constraint that passed on NULL

The gap 7o named and 7p carried. Phase 7o made a number changeable with the new
one proven first, which covers switching SIMs and covers nothing when the
handset is gone: every route needs the old number in hand. A person with no
email, no password and no phone had no way back to their own rooms, ever.

This is the most dangerous path in the product. The account on the other side
holds rooms, applications, tenancies, a rent record and conversations with
tenants. Getting it wrong does not inconvenience somebody; it hands a stranger
a landlord's entire history with the people living in their rooms.

Two proofs, neither sufficient alone. A person proves identity to an admin
offline and the admin records WHAT was checked and WHEN — named, dated
outcomes, the VerificationRequest and contractor-check pattern. And the new
handset answers a code, so an admin cannot type a number in and have it become
the way in. The approval response carries no code, which the drive asserts.

The narrowing that matters most: opening is refused outright when the account
has an email address or a password, naming the safer route — then a password
reset does the same job and nobody has to be trusted at all. The admin screen
refuses it in those words and does not even render the form.

What it cannot do is warn the real owner in time, and that is stated rather
than implied. The notice is written the moment a request opens, to every
channel the account has, and in the case this exists for there is no email and
the owner cannot sign in to read a Notice. Nothing fixes that: a person with no
email, no password and no phone has no channel left. The mitigation is the
record — permanent, attributable to a named admin, reconstructable — plus a
completion notice naming both numbers and what to do if it was not them, and
the old number retired so the stolen handset cannot sign in afterwards.

A second admin approval is the standard control here and is deliberately not
required: Mastande is run by one person, so a two-admin rule would make the
feature unusable by the only admin there is. Recorded as a decision rather than
quietly skipped.

Two of the six CHECK constraints passed on NULL. Written as
length(btrim(column)) > 0, and btrim(NULL) is NULL, length(NULL) is NULL,
NULL > 0 is NULL — and a CHECK constraint that evaluates to NULL is satisfied.
So a refusal with no reason went straight in: the exact row the constraint
existed to refuse, on this path. The sibling constraint for the identity note
had the same hole and no test at all, which is why it slipped beside the one
that did. Found because the drive tests the CONSTRAINTS with SQL rather than
only the service that also enforces them; the service's checks were correct
throughout, and a rule only the service holds is one direct UPDATE from being
no rule. Falsifying the service's identity guard proved the layering: approving
then returned 500, because the database still refused the write.

50 API and 29 UI checks, falsified in two passes — five bugs, then three
isolated — to 13 and 3 failures.

Then the UI drive's whole-page button sweep found eleven sub-target controls,
none of them on the new screen: the language switcher at 24px, the board's own
filter pills at 22px, the save-heart at 32px on every room card, the phone
hamburger at 32px which is the only navigation a phone has, the cookie notice's
Got it at 30px on every first visit, the filter drawer's toggle and close, the
desktop portal nav at 37px including Log out, and .auth__submit at 38px — the
primary button on every auth form. The board had 25 of 34 buttons under target.

Fourth pass at the same family: v1.93.0 did .btn, 7p did the inputs after 29 of
them shipped under target, and each fix was described as app-wide while
reaching only the selector it named. 7p's own fix moved the hole rather than
closing it — it added a text sweep while the row helper went on measuring
buttons a row at a time, so a button outside any listed row stayed invisible. A
whole-page button sweep runs beside it now, falsified by reverting the rules to
18 failures.

One near-miss recorded: .auth__submit measured 38px with a cream background and
grey text and has no CSS rule anywhere in the stylesheets, which reads exactly
like btn-ghost-light. It was measured on an EMPTY form, where the button is
correctly disabled; filled in it is terracotta on white. The height was the only
defect, and reporting the rest would have been a fabricated finding.

590 smoke checks passed, 0 failed."

tag_if_missing "v1.103.0" "dd9ed8496ec1555032ed2d20759caa551be47342" "2026-10-05 10:49:27 +0000" "v1.103.0 — Phase 8a: four printable documents a landlord keeps asking for

A lease agreement, a renewal addendum, a move-in inspection and a deposit
receipt, free to download, print and sign, at /templates.

⚠️ Two of these are contracts and two are not, and that distinction runs through
the whole feature. A move-in inspection is a checklist and a deposit receipt is a
receipt: get the wording clumsy and somebody is mildly inconvenienced. A lease
and an addendum create binding obligations, and if a clause is wrong the person
harmed is a landlord with four back rooms who trusted us. Mastande is not a law
firm.

So reviewState is on the data rather than in a comment. The two contracts ship
awaiting_legal_review, against the same open attorney review /legal/sublet is
waiting on, and say so on their own face. They are still downloadable,
deliberately: a landlord who cannot get one here will take a worse one off a
search result with no warning on it at all. What they must not do is look
finished.

The check that matters most: a warning that disappears when the document is
printed is a warning the person holding the paper never sees — and printing is
the entire point of the feature. The drive applies the print stylesheet with
emulateMedia print, the same cascade the browser uses to make the PDF, and
asserts the warning is still visible. The same check covers the footer
disclaimer on all four: not a law firm, nothing signed here, no deposits or rent
held. Falsified by display none on the warning in the print block, plus flagging
a form as a contract and dropping the nothing-is-signed line: eight failures,
the key one reading 'the person holding the paper never sees it'.

No PDF library was added. The browser already has one, every Android phone
reaches it through Chrome's Print then Save as PDF, and it renders fonts
correctly on a device nobody here can test. A server-side renderer would be a
dependency, a font-licensing question and a layout we could not check on the
handset this product is built for. So the whole job is a print stylesheet, and
the site chrome is hidden BY SELECTOR globally rather than by a class each page
remembers to add — a printable page that forgot the class would print the
navbar and the cookie notice onto a lease, and 'each page remembers' is the
exact shape of defect Phase 7e was about.

Public rather than behind the portal: somebody searching for a South African
lease template is a landlord with rooms and no tools, which is exactly who this
is for.

The inspection is the highest-value one and also the lowest risk. The Rental
Housing Act makes the joint inspection a statutory step and treats a landlord
who skips the outgoing one as having agreed the room was in good order, so no
deduction — a landlord who skips it has already lost the deposit argument and
usually does not know it. The deposit receipt carries the thing small landlords
routinely do not know, that the deposit earns interest and the interest belongs
to the tenant, and it is explicitly the LANDLORD's receipt to their own tenant:
Mastande holds no deposits, and a template that read otherwise would cross the
money-custody line this codebase refuses to cross.

Statutory references are deliberately few. Padding a template with section
numbers makes it look authoritative, which is the opposite of what an unreviewed
document should look like.

45 drive checks at four widths. 596 smoke checks passed, 0 failed."

tag_if_missing "v1.104.0" "cc165352a3f01ee1c2ce8478e45435fb4c1ab901" "2026-10-05 11:40:01 +0000" "v1.104.0 — the preflight passed on production, the migration went to localhost

Production was 15 migrations behind and down on P2022 rooms.listerType. The
preflight was run against it and was right about everything. The next command
was the one the preflight's own closing line printed:

  DATABASE_URL='<production>' node scripts/migration-preflight.mjs   # production
  cd backend && npx prisma migrate deploy                            # localhost

Twelve migrations went to localhost:5432/rentboard_dev, the output read 'All
migrations have been successfully applied.', both commands exited 0, and the
same P2022 was in the production log minutes later.

Neither output was wrong. Each described the database it reached, and nothing
compared them.

Two causes, both already documented in this repository. An inline VAR=value
prefix applies to that one command and does not carry across &&. And prisma
migrate connects through directUrl, not url: schema.prisma declares
directUrl = env(DIRECT_URL), so exporting only DATABASE_URL leaves DIRECT_URL
resolving from backend/.env, and the run goes local with the production URL
sitting in the environment.

scripts/migrate-remote.sh already refused every part of this, and its header
comment describes the staging version of the same mistake. OUTSTANDING section
5 told the operator to call prisma directly. The control was not missing or
broken; it was routed around by the document telling somebody what to run.

A new section 0 reports the connection migrate deploy will actually use, and
blocks when DIRECT_URL is unset, naming the host backend/.env would have sent
the migration to instead.

Three more defects, all legible in output already read: a count that did not add
up (29 applied, 15 pending, of 34), a warning that fired on zero contractors,
and ?schema=public making the script unrunnable against development or staging.

And the replica the original was validated against had been built by deleting
migration rows without dropping the objects those migrations create, so the
rehearsal on it died on an error production cannot produce. The faithful one
applies production's own 19 migrations to an empty database; all 15 then applied
with every post-state assertion verified, and each check falsified.

Production is still down. The migration needs a credential this environment
does not hold and cannot reach."

tag_if_missing "v1.105.0" "e3949d5784e5c204c65d078a0268379513871754" "2026-10-05 11:54:38 +0000" "v1.105.0 — the preflight raised a false blocker on the database that needed migrating

v1.104.0's new section 0 was run against production and printed 'Same database
name neondb but different migration history ([object Object] rows vs 30)', '0
applied, 34 pending' of 34, '[object Object]' as a migration name, and exited 1
with 'Do NOT run migrate deploy until this comes back clean.'

The operator overrode it, prisma migrate status gave the correct answer, and the
15 migrations applied. Had the blocker been believed, production would have
stayed down. That is the failure the section 4 comment in this same file exists
to prevent, reintroduced one commit later in a new section.

A false blocker and a missing check are the same defect. One stops a repair, the
other permits a break. This script has now produced one of each, and both were
found by somebody running it rather than by anything in this repository.

Cause, reproduced locally and byte-for-byte identical to the production output:
over that pooled connection to_regclass of the qualified table answered true
while an unqualified SELECT on it did not exist, and users did the same. The
session's search_path did not include public. An earlier run over the same
pooled endpoint worked, so it is session-dependent. Why Neon's pooler did that
is not established and cannot be from this environment.

What turned an unreadable table into a verdict was this script, twice over.
Every table reference was unqualified; all of them carry the schema now and
PGOPTIONS forces the search_path where the URL does not set its own options. And
q() returns an error object the code treated as a string, so a failed read
became a migration name, a row count and a blocker. It now stops, says it is the
script failing rather than a verdict about the database, and names prisma
migrate status as the fallback.

Production is up: 15 migrations applied over the direct endpoint by the user,
not from here. 'Who to call' is empty until an admin records a phone check per
contractor at /admin/services, as predicted."

tag_if_missing "v1.106.0" "7f6d9ad7f48d053292690e544624e8c130df2c99" "2026-10-05 15:07:16 +0000" "v1.106.0 — a class with no rule renders as unstyled inline content

Three screenshots from a 360px handset: labels beside their inputs instead of
above them, controls running off the right edge, and 'Shared detailsDelete this
property' as one unbroken string.

Most of it was a stale deploy — the label and width rules landed on 4 October in
a commit that is not an ancestor of the master the site was built from, so they
had never been live. Establishing that came before writing any CSS: a fix at
that point would have changed nothing a landlord could see and left the real
cause in place.

Two were real and present on master. .yard__actions had NO rule at all, and it
holds a harmless action next to a destructive one, so they rendered inline with
no gap — the string in the screenshot, which deploying would not have fixed. And
.form-error had no rule anywhere in the app: five uses across four components,
two carrying role=alert, so a screen reader announced an error the screen showed
as ordinary body text.

One more the screenshots could not show: .btn-danger is used by seven components
and written in the scoped styles of two, so five admin screens rendered a
destructive button identical to an ordinary one.

css-coverage-audit.mjs now asserts that every class a template uses has a rule
in the shipped CSS. It reads the templates, so it cannot be fooled by a screen
nobody opened. Its own first version skipped components with a styles block,
which hid four of btn-danger's five victims. It found 27 bare classes across 82
components; the 26 that remain are a baseline file rather than an allowlist,
because 27 invented reasons is how a check reads green over its own findings.

yard-layout-drive.mjs measures the screen at 360/390/768/1280 with both forms
open. Nothing here could have caught the original: the drive written for this
problem never opens this screen, and the drive that opens it measures no widths.
The new drive then produced the same defect itself — pointed at a redirecting
route, three of its four checks passed over an empty set. Fixed to skip rather
than pass when there is nothing to measure.

It found what the screenshots did not: at 360 and 390 the two card actions wrap,
and the first fix left 5.6px between a destructive control and a harmless one.

Falsified both directions, including the finding that removing the label rule
alone does not break the stacking check, because width:100% carries it."

tag_if_missing "v1.107.0" "dcd4570ce096a8b42cb009df75a1e306f3ef95da" "2026-10-05 19:34:19 +0000" "v1.107.0 — Phase 8b: a deeper tour, and a first-use hint on every screen

The report was that the walkthrough is minimal and does not show how to use the
features. Two different problems.

The tour was four cards and that was argued for in a comment. Overruled by the
person who uses this: four cards that skip grouping, viewings, rent and the
forms leave a landlord believing the product does less than it does. Landlord
four to eight, tenant four to six. The drive asserted exactly four and called it
'not a wall of nine' — the design argument of the day written in as a test. It
asserts the shape now.

A tour cannot teach a screen, so there is now one short panel at the top of nine
screens, the first time an account opens each. Stored on the account rather than
the browser, for the two reasons the walkthrough stamp is: a phone here is
shared, borrowed and replaced, and SSR has no localStorage on the first paint.
Keys only, no timestamps, and allowlisted server-side — which is a size limit as
much as a spelling check, since the column is an unbounded text array.

It answered 500 on every call and the screen looked perfect. The id column is
TEXT and the query cast it to uuid. Three sections of the drive passed over it,
because the client patches optimistically and the write is fire-and-forget. Only
signing in again in a fresh browser caught it — a check written because it is
the one a localStorage implementation cannot pass, and the only one that could
see a 500.

Found while writing it, and bigger than it: a tenancy can never start, end or
produce a review. Accepting an applicant opens a pending tenancy, and every
endpoint that would move it on is wired into the client with no component
calling it. No tenancy becomes active, so no rent reminder can fire and no
review can be written. Recorded as OUTSTANDING 18 for its own phase, and it
changed what this phase could honestly say: no tour step describes confirming a
move-in, because no step promises what the app cannot do."

tag_if_missing "v1.108.0" "aa6db35c7517416bb70c2396843d84e0d3b7a93d" "2026-10-05 20:12:14 +0000" "v1.108.0 — Phase 8c: a tenancy can finally start and end

The rent screen was confusing because it was describing a tenancy that had never
begun, and could not begin.

Accepting an applicant opens a tenancy that stays pending until someone confirms
the move-in. confirm-start, cancel and end have existed since Phase 4, are
either-party, and are wired into the client service. Nothing called any of them.
withdrawFlag had the only caller, which is how a completely dead lifecycle hid
behind one live method.

The consequences stack, and only the first is obvious: no tenancy could become
active; the rent reminder query selects on active, so no reminder could ever
fire for anybody; reviews open when a tenancy ends, so none could be written;
notice, renewal and move-out were unreachable.

One component serves both sides, because either party may act — requiring both
would leave a tenancy stuck whenever one side stops logging in. Two date
constraints come straight from the API's own refusals, so the form cannot offer
what the server will reject. And the panel says on its face that confirming a
move-in is not about money, because 'confirm' beside a rand figure is how
somebody comes to believe this platform handled their deposit.

Falsified by removing the mount, which reproduces the shipped state exactly. That
falsification also found the drive dying on a timeout instead of reporting, so it
now stops at the missing panel and says it once.

The API side needed nothing: smoke already had seven checks on these endpoints.

Still open: notice and updateLease have no caller, so the product can withdraw a
notice it has no way to give."

tag_if_missing "v1.109.0" "83f316b89a805aef61826180176f120f6ae5be48" "2026-10-05 20:27:04 +0000" "v1.109.0 — Phase 8d: a room can be put into a property, not only taken out

Reported twice in one list: a room listed outside a property could not be added
to one.

The endpoint has existed since Phase 7b and was wired into the client service
with nothing calling it. And unassignRoom HAD a caller, which is the whole
character of the bug: the product could take a room out of a property and never
put one back, so removing one by accident was unrecoverable and the feature read
as broken rather than absent.

The loose rooms are now offered on the property screen as 44px rows rather than
tick boxes, with a button that names how many will move and refuses to be
pressed into a no-op. The list comes from the ungrouped group the dashboard has
carried all along, and success reloads rather than patching, because moving a
room changes three numbers at once.

Also: 'add your first property' set a signal and stopped, and the form renders
1159px down a 780px screen, so the button scrolled nothing. The obvious check —
the form is in the DOM — would have passed every day the bug existed, because
the form always rendered. The drive asserts its position in the viewport.

Third compile failure from a trap already recorded in CLAUDE.md: a backtick in a
comment inside an inline template literal terminates the template.

One fault of the drive's own, recorded: it assumed the first row rendered was
the first room created, unassigned an already-loose room, and got a 200 that
changed nothing."

tag_if_missing "v1.110.0" "f7b1bc99de08aa72c5b2c62d42036fa177447145" "2026-10-05 21:14:58 +0000" "v1.110.0 — Phase 8e: one report about messages, three unrelated faults

The description of the room would not wrap because :where(button) sets
white-space: nowrap and the conversation row IS a button, so it inherited to
every piece of text inside. At 360px the room title wanted 502px in a 300px
column and the document was 1012px wide in a 360px viewport. font: inherit does
not reset white-space.

A bounding-box sweep cannot see that bug: every element's rect sat inside the
viewport, and the overflow shows only as scrollWidth greater than clientWidth.
Every layout drive here measures boxes, so all of them would have passed through
it forever. The app-wide risk is recorded rather than swept, because it is not
swept.

The send button was a consequence of the first, not a bug of its own. Measured
after the fix and left alone: reporting a fix there would have been a fabricated
finding.

An unread message is now a row in the dashboard's existing list of what needs
doing, beside the applicant who has waited nine days, rather than a dot to
interpret. Only honest because Message.readAt is written now; a count built on
it before would have shown every message ever sent, for ever, which is why the
check that it clears matters more than the check that it appears.

Three faults of my own, recorded: a fourth compile failure from the backtick
trap, a drive that read the badge after its own earlier section had cleared it,
and a check that passed vacuously over a count that was zero before and after."

tag_if_missing "v1.111.0" "26e187ed53969894a08463817c93a0d71cc4fa0b" "2026-10-05 22:02:32 +0000" "v1.111.0 — Phase 8f: a sweep for overflow no bounding-box check can see

Phase 8e fixed one row in one list. The rule behind it applies to every button
in the app, so any other button used as a container for wrapping text had the
same bug and nothing looked for it.

layout-ui-drive now walks ten screens at four widths and fails on any leaf whose
scrollWidth exceeds its clientWidth. None of the existing sections could have
found this: they measure bounding boxes, and every element on the broken screen
sat inside the viewport. The overflow exists only in the scroll measurement.

Leaves only, which is a correction made after the first run: flagging any
element wider than its box reported a deliberate full-bleed advert on the board,
and a check that cries wolf on a designed layout is one people learn to skim.

And then it passed on an empty screen — the drive's landlord had no
conversations, so the screen it swept was blank. The same defect as the drive
that created a property and never opened the screen showing it, produced by the
check written to find that class of thing. It now writes a message with a long
title and a long body, and every page must present at least five pieces of text
or the check fails as nothing really measured.

Falsified: with the fix reverted it names both overflowing elements at the phone
widths, and still catches one at 1280 where the page does not scroll at all."

tag_if_missing "v1.112.0" "e43846ecbc5b9a9f8b75af6fbe2f764f1ce92821" "2026-10-06 05:56:22 +0000" "v1.112.0 — Phase 8g: 'Continue with Google' removed

The owner is not paying for it.

Removing a way in means checking the way out, and I overstated the risk first:
the password-reset path refuses an account with no password, so it looked like
deleting the button stranded every Google account. One more file showed that
wrong — the magic link never gated on a password at all, and 'Email me a
sign-in link instead' is on the same screen under the form.

What was genuinely wrong after the removal was the 'you sign in with Google'
email, which then pointed somebody at a door that is not there. Forgot-password
now issues a real token for a passwordless account, so it can set a first
password and carry on as an ordinary email account. The email method it replaced
had no other caller and was deleted.

The route, the strategy and the two secrets stay: an account that signed up
through Google still exists, a callback in flight must not meet a 404, and
deleting the code would not stop the billing, which lives in Google Cloud.

Three faults in the drive, all the same shape: a check matching remembered copy,
then one asserting a guessed count. Both report the product broken when it is
fine, which is the mirror of a check that passes when it is not.

Falsified: the button restored fails the first checks; the old refusal restored
fails the reset check while the HTTP 200 still passes, which is why that
assertion reads the token row rather than the reply."

tag_if_missing "v1.113.0" "ff5ea519405db13a0ee1ce86b5aaf8e561101ba8" "2026-10-06 18:46:42 +0000" "v1.113.0 — Phase 8h: five reports from one phone, and the gates that could not see them

A button nobody could read. .hint__close set a background and no colour;
:where(button) sets color #fff at zero specificity, so the only control on the
first-use hint panel was white on white at 1.00:1, with 'Got it' in the DOM the
whole time. font: inherit does not help — the shorthand never touches colour.

The part that matters more: a11y-drive printed a tick on all ten screens that
render it. axe does not report identical colours as a violation; it buckets them
as incomplete with messageKey 'equalRatio'. The worst contrast failure there is
was the one case the gate could not see. Promoted to a failure, and only that
reason.

The tenant dashboard could not tell an acceptance from a move-in. An Application
stays accepted for ever and the move-in is a Tenancy, which nothing on that
screen had ever read — so somebody who had moved in was still told to talk to
the landlord about moving in, at the top of the list, for the whole tenancy.
My first fix invented the fault it was fixing: a new inbox kind for a state the
product cannot reach, because accepting opens a tenancy in the same transaction.
A drive caught it.

A nav tab that pointed at an element that did not exist, for every landlord who
was on top of their work. The nav file's own comment describes that fault three
lines above the item.

No way back to your own portal on a phone: one rule hid every ghost action, and
a tenant has only two. Keeping Dashboard cost 21px of horizontal scroll at 360px
for a landlord, so the signed-in header is tightened. The check that should have
caught it had passed for four releases because it only ever looked for Log out.

And .field / .field-label / .btn-link — baselined as debt in Phase 8c and left
until the owner photographed them. 26 baselined classes, 23 now.

Three drives were auditing the wrong screen, found in one sitting: one pointed
at a URL that became a redirect four releases ago, one was red for the same
reason, one matched copy that had been renamed and crashed on a select.

Falsified one fault at a time, each check confirmed to fail with its own bug put
back."

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
  echo "  git ls-remote --tags origin | grep -E 'v1[.](7[5-9]|8[0-9]|9[0-9])[.]|v1[.](10[0-9]|11[0-3])[.]'"
else
  echo "Nothing to push."
fi
