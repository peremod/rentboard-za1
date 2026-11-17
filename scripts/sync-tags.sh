#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Create any missing release tags, then push the ones the remote lacks.
#
#   ./scripts/sync-tags.sh           # show what it would do
#   ./scripts/sync-tags.sh --push    # do it
#
# Why this exists: tags are created on whichever machine cut the release, and
# `git push origin v1.a v1.b v1.c` aborts the WHOLE push if any one of those
# refs does not resolve locally — so a single missing tag silently blocks
# every other tag in the list. That happened three times in one day, each
# time from a hand-written list containing a tag the machine had never made.
#
# Nothing here is hand-written. Every release commit on develop's first-parent
# line bumps package.json, so the version and its commit are both already in
# the history; this reads them back out.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

BRANCH="${BRANCH:-develop}"
REMOTE="${REMOTE:-origin}"
PUSH=false
[[ "${1:-}" == "--push" ]] && PUSH=true

green() { printf '\033[32m%s\033[0m\n' "$1"; }
grey()  { printf '\033[90m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1" >&2; }

command -v git >/dev/null || { red "git is required"; exit 1; }
git rev-parse --git-dir >/dev/null 2>&1 || { red "not a git repository"; exit 1; }

version_at() {
  git show "$1:package.json" 2>/dev/null \
    | sed -n 's/^  "version": "\([^"]*\)".*/\1/p' | head -1
}

git fetch "$REMOTE" "$BRANCH" --tags --quiet 2>/dev/null \
  || git fetch "$REMOTE" --tags --quiet 2>/dev/null \
  || grey "  (could not fetch $REMOTE — working from what is local)"

# 🔴 Walk the REMOTE branch, not the local one.
#
# BRANCH defaulted to `develop`, which git resolves to the LOCAL branch of that
# name — and a local branch is only as current as the last `git pull`. On 17
# November this printed "Every release tag on develop is already on origin"
# while v1.187.0 existed on neither the remote nor the machine: the local
# `develop` was 48 commits behind origin and genuinely contained no release
# commit the remote lacked. The script was not wrong about what it looked at.
# It looked at the wrong thing, and said so in the reassuring direction.
#
# That is the shape CLAUDE.md keeps naming — a check that cannot fail, here by
# measuring a ref nobody deploys from. Release tags are a property of the
# SHARED history, so the shared ref is the only honest source.
#
# An explicit BRANCH=origin/develop still works: $REMOTE/$BRANCH does not
# resolve for it, so it falls through to the value as given.
if git rev-parse --verify --quiet "$REMOTE/$BRANCH" >/dev/null; then
  SOURCE_REF="$REMOTE/$BRANCH"
else
  SOURCE_REF="$BRANCH"
  git rev-parse --verify --quiet "$SOURCE_REF" >/dev/null \
    || { red "neither $REMOTE/$BRANCH nor $BRANCH resolves — nothing to read."; exit 1; }
  grey "  ($REMOTE/$BRANCH does not resolve — reading $SOURCE_REF as given)"
fi

# Informational, because an operator reading this output will otherwise wonder
# why it disagrees with their checkout.
if git rev-parse --verify --quiet "$BRANCH" >/dev/null && [[ "$SOURCE_REF" != "$BRANCH" ]]; then
  behind=$(git rev-list --count "$BRANCH..$SOURCE_REF" 2>/dev/null || echo 0)
  [[ "$behind" -gt 0 ]] && grey "  (your local $BRANCH is $behind commit(s) behind $SOURCE_REF; reading $SOURCE_REF)"
fi

REMOTE_TAGS=$(git ls-remote --tags "$REMOTE" 2>/dev/null | sed -n 's#.*refs/tags/\([^^]*\)$#\1#p' | sort -u)

created=0; missing=()

# --first-parent keeps to the mainline, so each release merge appears once and
# the feature commits it brought in do not.
while read -r commit; do
  [[ -z "$commit" ]] && continue
  v=$(version_at "$commit")
  [[ -z "$v" ]] && continue
  pv=$(version_at "$commit^")
  [[ "$v" == "$pv" ]] && continue          # not a release commit
  tag="v$v"

  if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    if $PUSH; then
      git tag -a "$tag" "$commit" -m "$tag" && { green "  created $tag at ${commit:0:7}"; created=$((created+1)); }
    else
      grey "  would create $tag at ${commit:0:7}"
      created=$((created+1))
    fi
  fi

  if ! grep -qx "$tag" <<<"$REMOTE_TAGS"; then missing+=("$tag"); fi
done < <(git rev-list --first-parent "$SOURCE_REF")

if [[ ${#missing[@]} -eq 0 ]]; then
  green "Every release tag on $SOURCE_REF is already on $REMOTE."
  exit 0
fi

echo
grey "Not on $REMOTE: ${missing[*]}"

if ! $PUSH; then
  echo
  grey "Re-run with --push to create and push them."
  exit 0
fi

# One ref per push. A single bad ref cannot take the others down with it,
# which is the entire failure this script exists to prevent.
failed=0
for tag in "${missing[@]}"; do
  if git push "$REMOTE" "$tag" >/dev/null 2>&1; then
    green "  pushed $tag"
  else
    red "  FAILED $tag"
    failed=$((failed+1))
  fi
done

echo
[[ $failed -eq 0 ]] && green "All tags are on $REMOTE." || { red "$failed tag(s) failed to push."; exit 1; }
