#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Fetch an admin access token for the smoke test.
#
#   ./scripts/admin-token.sh
#   ADMIN_TOKEN=$(./scripts/admin-token.sh) ./scripts/smoke-test.sh
#
# Prompts for the password rather than taking it as an argument: anything on a
# command line ends up in shell history and in `ps` output for every user on
# the machine.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

API="${API:-http://localhost:3000}"
EMAIL="${ADMIN_EMAIL:-}"

red()  { printf '\033[31m%s\033[0m\n' "$1" >&2; }
grey() { printf '\033[90m%s\033[0m\n' "$1" >&2; }

command -v jq >/dev/null || { red "jq is required: sudo apt install -y jq"; exit 1; }

if [[ -z "$EMAIL" ]]; then
  read -rp "Admin email: " EMAIL
fi

# -s keeps it off the screen; no shell history either way.
read -rsp "Password for $EMAIL: " PASSWORD
echo >&2

RESPONSE=$(curl -sS -X POST "$API/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg e "$EMAIL" --arg p "$PASSWORD" '{email:$e, password:$p}')" 2>/dev/null)

TOKEN=$(echo "$RESPONSE" | jq -r '.accessToken // empty')
ROLE=$(echo "$RESPONSE" | jq -r '.user.role // empty')

if [[ -z "$TOKEN" ]]; then
  red "Login failed."
  grey "  $(echo "$RESPONSE" | jq -r '.message // .' 2>/dev/null | head -c 300)"
  grey ""
  grey "If the password is wrong, reset it:"
  grey "  cd backend && ADMIN_EMAIL=$EMAIL ADMIN_PASSWORD='new-password' npx ts-node prisma/seed.ts"
  exit 1
fi

if [[ "$ROLE" != "ADMIN" ]]; then
  red "That account signed in, but its role is $ROLE, not ADMIN."
  grey "Promote it:"
  grey "  cd backend && ADMIN_EMAIL=$EMAIL ADMIN_PASSWORD='your-password' npx ts-node prisma/seed.ts"
  exit 1
fi

grey "Signed in as $EMAIL (ADMIN). Token expires in 15 minutes."
grey ""
grey "Run the full suite with:"
grey "  ADMIN_TOKEN=\$(./scripts/admin-token.sh) ./scripts/smoke-test.sh"
grey ""

# Only the token goes to stdout, so it can be captured cleanly.
echo "$TOKEN"
