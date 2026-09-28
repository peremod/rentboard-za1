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
#   bash scripts/migrate-remote.sh                 # shows the target, asks
#   CONFIRM=yes bash scripts/migrate-remote.sh      # for CI or a scripted run
#
# It refuses rather than guesses when the target is missing or local.

set -euo pipefail

cd "$(dirname "$0")/../backend"

red()   { printf '\033[31m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
grey()  { printf '\033[90m%s\033[0m\n' "$1"; }

# Deliberately does NOT read backend/.env. That fallback is the whole bug: this
# script exists to migrate somewhere else, so an unset variable must stop it.
TARGET="${DATABASE_URL:-}"
DIRECT="${DIRECT_URL:-}"

if [ -z "$TARGET" ]; then
  red "❌ DATABASE_URL is not set, or is empty."
  echo
  echo "   This script will NOT fall back to backend/.env, because that is a"
  echo "   local database and migrating it while believing you migrated"
  echo "   staging is the mistake this script was written to stop."
  echo
  echo "   Export the real values first — see docs/DEPLOYMENT.md §Migrations:"
  echo
  echo "     export NEON_POOLED=\"postgresql://…-pooler…\""
  echo "     export NEON_DIRECT=\"postgresql://…\"   # no -pooler"
  echo "     DATABASE_URL=\"\$NEON_POOLED\" DIRECT_URL=\"\$NEON_DIRECT\" \\"
  echo "       bash scripts/migrate-remote.sh"
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

echo "Pending migrations:"
npx prisma migrate status 2>&1 | sed 's/^/  /' || true
echo

if [ "${CONFIRM:-}" != "yes" ]; then
  printf 'Apply these to %s? [y/N] ' "$WHERE"
  read -r answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) grey "Nothing applied."; exit 0 ;;
  esac
fi

npx prisma migrate deploy
echo
green "✅ Applied to $WHERE"
echo
grey "Next: re-run the 'Verify deployment' workflow, which asserts staging"
grey "serves the version in the commit rather than only that it answers."
