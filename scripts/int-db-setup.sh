#!/usr/bin/env bash
#
# Creates and migrates the isolated database the integration tests truncate.
#
# ⚠️ Separate from the development database by NAME, not by configuration.
# test/support/test-app.ts refuses any database whose name does not contain
# "test", and refuses a remote host outright, because these tests TRUNCATE
# EVERY TABLE. §59 is the smoke run that put "Wizard test studio in Rosebank
# (updated)" in front of real visitors; this is the same mistake with delete
# privileges.
set -euo pipefail

DB="${INT_TEST_DB:-mastande_integration_test}"
case "$DB" in *test*) ;; *) echo "❌ refusing: '$DB' is not a test database name"; exit 1 ;; esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# The development URL supplies host, port and credentials only; the database
# name is replaced. Reading it here keeps one set of local credentials.
DEV_URL=$(grep -m1 '^DATABASE_URL' "$ROOT/backend/.env" | cut -d'"' -f2 | sed 's|?schema=public||')
BASE="${DEV_URL%/*}"
URL="$BASE/$DB"

case "$URL" in
  *neon.tech*|*render.com*|*umastande*) echo "❌ refusing: '$URL' looks remote"; exit 1 ;;
esac

echo "Target: $DB"
if psql "$BASE/postgres" -tAc "SELECT 1 FROM pg_database WHERE datname='$DB'" | grep -q 1; then
  echo "  already exists"
else
  psql "$BASE/postgres" -c "CREATE DATABASE $DB;" >/dev/null
  echo "  created"
fi

cd "$ROOT/backend"
DATABASE_URL="$URL" DIRECT_URL="$URL" npx prisma migrate deploy >/dev/null
echo "  migrated: $(psql "$URL" -tAc "select count(*) from information_schema.tables where table_schema='public';" | tr -d ' ') tables"
echo
echo "Run the suite with:  npm run test:int"
