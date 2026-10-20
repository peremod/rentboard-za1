#!/usr/bin/env bash
#
# Run `prisma migrate deploy` against a REMOTE database, and say which one
# before doing it.
#
# ── Why this exists
#
# docs/DEPLOYMENT.md documents the migration step as:
#
#   DATABASE_URL="$NEON_POOLED" DIRECT_URL="$NEON_DIRECT" npx prisma migrate deploy
#
# NEON_POOLED and NEON_DIRECT are placeholders the operator exports by hand.
# They are defined nowhere in the repository. If they are not exported, bash
# substitutes empty strings, Prisma falls back to backend/.env — a LOCAL
# database — and prints:
#
#   No pending migrations to apply.
#
# which is true, accurate, and about entirely the wrong database. It reads as
# "staging is migrated". Staging is untouched, and the next deploy starts an API
# against a schema it does not expect.
#
# That happened. The staging deployment check then failed three times while the
# migration was believed to be done, and the only clue was a version mismatch.
#
# prisma/purge-test-data.ts and prisma/seed-house-ads.ts already guard against
# exactly this with describeTarget(), for operations far less dangerous than a
# migration. This closes the gap on the one command that MUST reach production.
#
#   bash scripts/migrate-remote.sh --env staging        # shows the target, asks
#   CONFIRM=yes bash scripts/migrate-remote.sh --env staging   # scripted run
#
# It refuses rather than guesses when the target is missing or local.
#
# ── Correction to the record, 20 October
#
# The commit that reworded the DATABASE_URL refusal below (6876566) says the
# claim ".env is a local database" was "contradicted on 20 October: a seed run
# printed ep-flat-flower-b1my1tch-pooler…neon.tech having read .env". THAT IS
# WRONG and nothing should be built on it. The seed reached Neon because it was
# invoked as `DATABASE_URL="$NEON_POOLED" npm run seed:survey`, and an inline
# prefix applies to that one command — which is why this script, run next in
# the same shell, correctly saw nothing. backend/.env held
# localhost:5432/rentboard_dev throughout, as it should.
#
# The reworded message still stands on its own: .env can hold anything, and
# the guard refuses either way. But it was prompted by a misreading, and a
# wrong reason recorded confidently is how the STAGING_API_HOST comment came
# to hand out the production host for a week.
#
# ── --env, and the two things it closed
#
# ⚠️ `--env` is REQUIRED, and it is not a label. It is checked against
# scripts/migrate-targets.json, because this script could tell a remote
# database from a local one and a pooled host from a direct one but NOT
# staging's Neon branch from production's — both are ep-*.neon.tech and both
# passed every check above. The one command that WRITES said "✅ Applied to
# ep-…" without ever saying which environment that was, and §5a is the hour
# of downtime that shape of mistake already cost.
#
# 🔴 And it printed a host it was not writing to. `Apply these to $WHERE?` and
# `✅ Applied to $WHERE` both came from DATABASE_URL — the POOLED url — while
# `prisma migrate deploy` connects through `directUrl`, i.e. DIRECT_URL. Hand
# it one environment's pooled url and another's direct url and it would name
# the first, migrate the second, and report success. Nothing checked that the
# two were even the same database. They are now required to be, and the lines
# below name the host the migration actually uses.

set -euo pipefail

# ⚠️ Resolved BEFORE the cd, and absolute. A relative "$(dirname "$0")/…"
# evaluated after the cd below resolves against backend/ instead, and the
# migrate-targets.json lookup died with a MODULE_NOT_FOUND stack trace rather
# than the message it was written to print. It failed safe — exit 1, nothing
# migrated — but a guard that reports itself as a crash is a guard nobody
# trusts the next time.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$SCRIPT_DIR/../backend"

red()   { printf '\033[31m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
grey()  { printf '\033[90m%s\033[0m\n' "$1"; }

ENV_NAME=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env)   ENV_NAME="${2:-}"; shift 2 ;;
    --env=*) ENV_NAME="${1#--env=}"; shift ;;
    *) red "❌ unknown argument: $1"; echo "   Usage: bash scripts/migrate-remote.sh --env staging|production"; exit 1 ;;
  esac
done

TARGETS="$SCRIPT_DIR/migrate-targets.json"

if [ -z "$ENV_NAME" ]; then
  red "❌ --env is required."
  echo
  echo "   Which environment are you migrating? The script checks the answer"
  echo "   against scripts/migrate-targets.json rather than taking it on"
  echo "   trust, because every other check here passes identically for"
  echo "   staging and production."
  echo
  echo "     bash scripts/migrate-remote.sh --env staging"
  echo "     bash scripts/migrate-remote.sh --env production"
  exit 1
fi

case "$ENV_NAME" in
  staging|production) ;;
  *)
    red "❌ --env must be 'staging' or 'production', not '$ENV_NAME'."
    echo "   Those are the two environments scripts/migrate-targets.json knows"
    echo "   and the two render.yaml defines a service for."
    exit 1
    ;;
esac

# Deliberately does NOT read backend/.env. That fallback is the whole bug: this
# script exists to migrate somewhere else, so an unset variable must stop it.
TARGET="${DATABASE_URL:-}"
DIRECT="${DIRECT_URL:-}"

if [ -z "$TARGET" ]; then
  red "❌ DATABASE_URL is not set, or is empty."
  echo
  echo "   This script will NOT fall back to backend/.env. Migrating whatever"
  echo "   that happens to point at while believing you migrated staging is"
  echo "   the mistake this script was written to stop."
  echo
  echo "   ⚠️ It does not say 'because .env is local'. It used to, and that is"
  echo "   an assumption, not a fact: a .env holding a remote connection"
  echo "   string is both legal and common, and then every command that DOES"
  echo "   fall back to it — prisma migrate dev, db:seed, purge-test-data,"
  echo "   the drives, smoke-test.sh — is pointed at that remote database"
  echo "   while looking local. Check what yours holds."
  echo
  echo "   Export the real values first — see docs/DEPLOYMENT.md §Migrations:"
  echo
  echo "     export NEON_POOLED=\"postgresql://…-pooler…\""
  echo "     export NEON_DIRECT=\"postgresql://…\"   # no -pooler"
  echo "     DATABASE_URL=\"\$NEON_POOLED\" DIRECT_URL=\"\$NEON_DIRECT\" \\"
  echo "       bash scripts/migrate-remote.sh --env $ENV_NAME"
  echo
  echo "   ⚠️ --env is in that line because this message used to omit it, and"
  echo "   following it exactly then earned a second refusal. A tool whose own"
  echo "   instructions do not satisfy its own requirements is the same defect"
  echo "   as the comment that handed out the production host for STAGING_API_HOST."
  exit 1
fi

if [ -z "$DIRECT" ]; then
  red "❌ DIRECT_URL is not set."
  echo "   Prisma needs the unpooled connection to run migrations; the pooled"
  echo "   one cannot hold the advisory lock. Set both."
  exit 1
fi

# Host and database name only. The password is never printed.
describe() {
  node -e '
    const raw = process.argv[1];
    try {
      const u = new URL(raw);
      const host = u.hostname + (u.port ? ":" + u.port : "");
      process.stdout.write(host + u.pathname);
    } catch { process.stdout.write("(unparseable)"); }
  ' "$1"
}

WHERE=$(describe "$TARGET")
WHERE_DIRECT=$(describe "$DIRECT")

echo "Migrate:  $WHERE"
echo "Direct:   $WHERE_DIRECT"
echo

case "$WHERE" in
  localhost*|127.0.0.1*|*\(unparseable\)*)
    red "❌ That is a local database, or an unparseable URL."
    echo "   Use 'npx prisma migrate dev' for local work. This script is for"
    echo "   a remote environment, and pointing it at localhost means the"
    echo "   remote one silently did not get migrated."
    exit 1
    ;;
esac

# Pooled vs direct is a real distinction on Neon and getting it backwards fails
# in a confusing way, so it is named rather than left to be discovered.
case "$WHERE_DIRECT" in
  *-pooler*)
    red "❌ DIRECT_URL points at the POOLED host (it contains '-pooler')."
    echo "   Migrations need the unpooled connection. Swap the two."
    exit 1
    ;;
esac

# The endpoint: the first label of the hostname with any '-pooler' removed, so
# the pooled and direct urls of one database reduce to the same value.
endpoint() {
  node -e '
    const raw = process.argv[1];
    try {
      const h = new URL(raw).hostname;
      process.stdout.write(h.split(".")[0].replace(/-pooler$/, ""));
    } catch { process.stdout.write("(unparseable)"); }
  ' "$1"
}

EP_POOLED=$(endpoint "$TARGET")
EP_DIRECT=$(endpoint "$DIRECT")

# 🔴 Both urls must be the same database. `migrate deploy` goes through
# directUrl, while everything this script PRINTED came from DATABASE_URL — so
# a mixed pair would name one environment and migrate another, and report
# success. Checked before the confirmation prompt, because the prompt is the
# thing that would have been misleading.
if [ "$EP_POOLED" != "$EP_DIRECT" ]; then
  red "❌ DATABASE_URL and DIRECT_URL are different databases."
  echo
  echo "     DATABASE_URL  $WHERE          (endpoint: $EP_POOLED)"
  echo "     DIRECT_URL    $WHERE_DIRECT   (endpoint: $EP_DIRECT)"
  echo
  echo "   prisma migrate deploy migrates the DIRECT one. Every line this"
  echo "   script would print names the pooled one. So it would tell you it"
  echo "   had migrated $EP_POOLED while having migrated $EP_DIRECT."
  echo
  echo "   Export a matching pair — the same database, '-pooler' and without."
  exit 1
fi

# Which environment this database belongs to. Nothing in a Neon hostname says,
# which is why it is written down: see scripts/migrate-targets.json.
EXPECTED=$(node -e '
  const t = require(process.argv[1]);
  const e = t[process.argv[2]];
  process.stdout.write(e && e.endpoint ? e.endpoint : "");
' "$TARGETS" "$ENV_NAME")

if [ -z "$EXPECTED" ]; then
  red "❌ No endpoint is recorded for '$ENV_NAME', so nothing can be checked."
  echo
  echo "   This is a refusal rather than a skip on purpose: an unrecorded"
  echo "   environment is exactly the state in which there is no check, so it"
  echo "   must not also be the state in which this proceeds quietly."
  echo
  echo "   The endpoint you have just handed it is:"
  echo
  echo "     $EP_DIRECT"
  echo
  echo "   ⚠️ Do NOT paste that in on the strength of this message. Confirm it"
  echo "   first against the environment's own service in the Render dashboard"
  echo "   — Environment → DATABASE_URL — because recording it is the one"
  echo "   assertion nothing here can make for you:"
  echo
  echo "     scripts/migrate-targets.json → \"$ENV_NAME\" → \"endpoint\""
  echo
  echo "   Commit it, and every run after this one is checked."
  exit 1
fi

if [ "$EP_DIRECT" != "$EXPECTED" ]; then
  red "❌ That database is not the one recorded for $ENV_NAME."
  echo
  echo "     you asked for   $ENV_NAME"
  echo "     which is        $EXPECTED"
  echo "     you handed it   $EP_DIRECT"
  echo
  OTHER=$(node -e '
    const t = require(process.argv[1]);
    const seen = process.argv[2];
    const hit = Object.keys(t).filter((k) => k[0] !== "_" && t[k].endpoint === seen);
    process.stdout.write(hit.join(", "));
  ' "$TARGETS" "$EP_DIRECT")
  if [ -n "$OTHER" ]; then
    red "   🔴 THAT IS THE $OTHER DATABASE."
    echo "   Nothing has been written. Check which connection string is"
    echo "   exported in this shell before running anything again."
  else
    echo "   It is not either recorded environment. Either the wrong values"
    echo "   are exported, or migrate-targets.json is out of date — a Neon"
    echo "   branch that was restored or recreated gets a new endpoint."
  fi
  exit 1
fi

green "✅ $EP_DIRECT is the database recorded for $ENV_NAME"
echo

echo "Pending migrations:"
npx prisma migrate status 2>&1 | sed 's/^/  /' || true
echo

if [ "${CONFIRM:-}" != "yes" ]; then
  # $WHERE_DIRECT, not $WHERE: this names the connection the migration runs
  # through. The two are now required to be the same database, so this is
  # belt and braces — but the line a person reads before typing y should be
  # the one that is true by construction.
  printf 'Apply these to %s (%s)? [y/N] ' "$WHERE_DIRECT" "$ENV_NAME"
  read -r answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) grey "Nothing applied."; exit 0 ;;
  esac
fi

npx prisma migrate deploy
echo
green "✅ Applied to $WHERE_DIRECT — the $ENV_NAME database"
echo
grey "Next: re-run the 'Verify deployment' workflow, which asserts $ENV_NAME"
grey "serves the version in the commit rather than only that it answers."
grey "It reads \$${ENV_NAME^^}_API_HOST; see docs/OUTSTANDING.md §75."
