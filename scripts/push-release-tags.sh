#!/usr/bin/env bash
# Recreate and push the Mastande release tags v1.75.2 … v1.80.0.
#
# These eleven tags were created inside an ephemeral cloud container whose
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

echo
echo "Created $created tag(s), skipped $skipped."
if [ "$created" -gt 0 ]; then
  echo "Pushing ${#to_push[@]} tag(s)…"
  git push origin "${to_push[@]}"
  echo
  echo "Done. Verify with:"
  echo "  git ls-remote --tags origin | grep -E 'v1[.](7[5-9]|80)[.]'"
else
  echo "Nothing to push."
fi
