#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# RentBoard ZA — end-to-end API smoke test
#
# Exercises the full MVP flow against a locally running backend and reports
# exactly which step fails. Run this BEFORE clicking through the UI: it is
# far faster at finding broken endpoints, and it tells you whether a UI
# problem is a frontend bug or an API bug.
#
#   chmod +x scripts/smoke-test.sh
#   ./scripts/smoke-test.sh
#
# Requires: curl, and jq (sudo apt install -y jq)
# Assumes:  backend on :3000, database migrated (npm run db:push)
#
# Creates real rows in your dev database using timestamped test emails, so
# it is safe to run repeatedly. Never run it against production.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

API="${API:-http://localhost:3000}"
STAMP=$(date +%s)
LANDLORD_EMAIL="landlord+${STAMP}@rentboard.test"
TENANT_EMAIL="tenant+${STAMP}@rentboard.test"
PASSWORD="TestPass123"

PASS=0; FAIL=0; SKIP=0
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
grey()  { printf '\033[90m%s\033[0m\n' "$1"; }
head_() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

# check <name> <expected_status> <actual_status> [body]
check() {
  local name="$1" want="$2" got="$3" body="${4:-}"
  if [[ "$got" == "$want" ]]; then
    green "  PASS  $name  ($got)"; PASS=$((PASS+1))
  else
    red   "  FAIL  $name  (expected $want, got $got)"; FAIL=$((FAIL+1))
    [[ -n "$body" ]] && grey "        $(echo "$body" | head -c 400)"
  fi
}

# req <METHOD> <path> <json|""> [token] -> sets $STATUS and $BODY
req() {
  local method="$1" path="$2" data="${3:-}" token="${4:-}"
  local args=(-s -w '\n%{http_code}' -X "$method" "$API$path"
              -H 'Content-Type: application/json'
              -c "$COOKIE_JAR" -b "$COOKIE_JAR")
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  [[ -n "$data"  ]] && args+=(-d "$data")
  local out; out=$(curl "${args[@]}" 2>/dev/null)
  STATUS=$(echo "$out" | tail -n1)
  BODY=$(echo "$out" | sed '$d')
}

command -v jq >/dev/null || { red "jq is required: sudo apt install -y jq"; exit 1; }

echo "RentBoard ZA smoke test → $API"

# ── 1. Infrastructure ──────────────────────────────────────────────────────
head_ "1. Infrastructure"
req GET /health
check "GET /health reachable" 200 "$STATUS" "$BODY"
if [[ "$STATUS" != "200" ]]; then
  red "\nBackend is not responding. Start it with: cd backend && npm run start:dev"
  exit 1
fi
DB=$(echo "$BODY" | jq -r '.db // "unknown"')
if [[ "$DB" == "connected" ]]; then
  green "  PASS  database connected"; PASS=$((PASS+1))
else
  red "  FAIL  database reports: $DB"; FAIL=$((FAIL+1))
fi

req GET /robots.txt
check "GET /robots.txt" 200 "$STATUS"
req GET /sitemap.xml
check "GET /sitemap.xml" 200 "$STATUS"

# ── 2. Auth ────────────────────────────────────────────────────────────────
head_ "2. Auth"
req POST /api/auth/register \
  "{\"email\":\"$LANDLORD_EMAIL\",\"password\":\"$PASSWORD\",\"fullName\":\"Test Landlord\",\"role\":\"LANDLORD\"}"
check "register landlord" 201 "$STATUS" "$BODY"
LTOKEN=$(echo "$BODY" | jq -r '.accessToken // empty')

req POST /api/auth/register \
  "{\"email\":\"$TENANT_EMAIL\",\"password\":\"$PASSWORD\",\"fullName\":\"Test Tenant\",\"role\":\"TENANT\"}"
check "register tenant" 201 "$STATUS" "$BODY"
TTOKEN=$(echo "$BODY" | jq -r '.accessToken // empty')

req POST /api/auth/login "{\"email\":\"$LANDLORD_EMAIL\",\"password\":\"$PASSWORD\"}"
check "login with correct password" 201 "$STATUS" "$BODY"
[[ -n "$(echo "$BODY" | jq -r '.accessToken // empty')" ]] && LTOKEN=$(echo "$BODY" | jq -r '.accessToken')

req POST /api/auth/login "{\"email\":\"$LANDLORD_EMAIL\",\"password\":\"WrongPass123\"}"
check "login rejects wrong password" 401 "$STATUS" "$BODY"

req POST /api/auth/register \
  "{\"email\":\"$LANDLORD_EMAIL\",\"password\":\"$PASSWORD\",\"fullName\":\"Dupe\",\"role\":\"LANDLORD\"}"
check "duplicate email rejected" 409 "$STATUS" "$BODY"

req POST /api/auth/register \
  "{\"email\":\"weak@rentboard.test\",\"password\":\"weak\",\"fullName\":\"Weak\",\"role\":\"TENANT\"}"
check "weak password rejected" 400 "$STATUS" "$BODY"

req GET /api/auth/me "" "$LTOKEN"
check "GET /auth/me with token" 200 "$STATUS" "$BODY"

req GET /api/auth/me
check "GET /auth/me without token blocked" 401 "$STATUS"

# -- 2b. ImageKit upload auth ----------------------------------------------
# Photo upload gates publishing a room, so verify credentials explicitly
# rather than discovering the problem inside the create-room wizard.
head_ "2b. Photo upload (ImageKit)"
req GET /api/uploads/imagekit-auth "" "$LTOKEN"
if [[ "$STATUS" == "200" ]]; then
  HAS_SIG=$(echo "$BODY" | jq -r 'has("signature") and has("token") and has("expire")')
  PUBKEY=$(echo "$BODY" | jq -r '.publicKey // "null"')
  if [[ "$HAS_SIG" == "true" && "$PUBKEY" != "null" && -n "$PUBKEY" ]]; then
    green "  PASS  ImageKit auth returns a signed token  (200)"; PASS=$((PASS+1))
    grey  "        publicKey ${PUBKEY:0:12}... - credentials are live"
  else
    red "  FAIL  ImageKit auth returned 200 but payload incomplete"; FAIL=$((FAIL+1))
    grey "        $(echo "$BODY" | head -c 300)"
  fi
elif [[ "$STATUS" == "503" ]]; then
  grey "  SKIP  ImageKit not configured - set IMAGEKIT_* in backend/.env"; SKIP=$((SKIP+1))
else
  check "ImageKit auth endpoint" 200 "$STATUS" "$BODY"
fi

# ── 3. Rooms ───────────────────────────────────────────────────────────────
head_ "3. Rooms — landlord lifecycle"
AVAIL=$(date -d '+30 days' +%Y-%m-%d 2>/dev/null || date -v+30d +%Y-%m-%d)
ROOM_JSON=$(cat <<JSON
{"roomType":"en_suite","title":"Bright en-suite room in Sandton house","description":"A large, sunny en-suite room in a quiet professional shared house. Walking distance to Gautrain, fibre installed, secure parking available.","rentCents":550000,"depositCents":550000,"billsIncluded":true,"province":"Gauteng","city":"Sandton","locationDisplay":"Sandton, Gauteng","availableFrom":"$AVAIL","housematesCount":2,"couplesAllowed":false,"dssAccepted":true,"petsAllowed":false}
JSON
)
req POST /api/rooms "$ROOM_JSON" "$LTOKEN"
check "landlord creates room (draft)" 201 "$STATUS" "$BODY"
ROOM_ID=$(echo "$BODY" | jq -r '.id // empty')

req POST /api/rooms "$ROOM_JSON" "$TTOKEN"
check "tenant CANNOT create room" 403 "$STATUS" "$BODY"

if [[ -n "$ROOM_ID" ]]; then
  # publish requires a hero image; without ImageKit this is expected to 400
  req POST "/api/rooms/$ROOM_ID/publish" "" "$LTOKEN"
  if [[ "$STATUS" == "200" ]]; then
    green "  PASS  publish room  (200)"; PASS=$((PASS+1))
  elif [[ "$STATUS" == "400" ]]; then
    grey  "  SKIP  publish room — needs a cover photo (ImageKit not configured)"; SKIP=$((SKIP+1))
    # force-publish via a direct field update so the rest of the flow can run
    req PATCH "/api/rooms/$ROOM_ID" '{"heroImagePath":"/smoke-test-placeholder.jpg"}' "$LTOKEN"
    req POST "/api/rooms/$ROOM_ID/publish" "" "$LTOKEN"
    check "publish after setting heroImagePath" 200 "$STATUS" "$BODY"
  else
    check "publish room" 200 "$STATUS" "$BODY"
  fi

  req GET /api/rooms
  check "public room list" 200 "$STATUS" "$BODY"
  COUNT=$(echo "$BODY" | jq -r '.total // 0')
  grey "        rooms visible on the public board: $COUNT"

  req GET "/api/rooms/$ROOM_ID"
  check "public room detail (no auth)" 200 "$STATUS" "$BODY"

  req GET "/api/rooms?province=Gauteng&maxRentCents=600000"
  check "filtered search" 200 "$STATUS" "$BODY"

  req GET /api/rooms/my-rooms "" "$LTOKEN"
  check "landlord my-rooms" 200 "$STATUS" "$BODY"
else
  red "  Room was not created — skipping dependent room, application and message tests"
fi

# ── 4. Applications ────────────────────────────────────────────────────────
head_ "4. Applications"
APP_ID=""
if [[ -n "$ROOM_ID" ]]; then
  req POST /api/applications \
    "{\"roomId\":\"$ROOM_ID\",\"coverNote\":\"Hi, I am a working professional and would love to view this room.\"}" "$TTOKEN"
  check "tenant applies to room" 201 "$STATUS" "$BODY"
  APP_ID=$(echo "$BODY" | jq -r '.id // empty')

  req POST /api/applications "{\"roomId\":\"$ROOM_ID\"}" "$LTOKEN"
  check "landlord CANNOT apply" 403 "$STATUS" "$BODY"

  req GET /api/applications/mine "" "$TTOKEN"
  check "tenant sees own applications" 200 "$STATUS" "$BODY"

  req GET "/api/applications/room/$ROOM_ID" "" "$LTOKEN"
  check "landlord sees applicants" 200 "$STATUS" "$BODY"

  req GET "/api/applications/room/$ROOM_ID" "" "$TTOKEN"
  check "tenant CANNOT see applicant list" 403 "$STATUS" "$BODY"

  if [[ -n "$APP_ID" ]]; then
    req POST "/api/applications/$APP_ID/shortlist" "" "$LTOKEN"
    check "landlord shortlists applicant" 200 "$STATUS" "$BODY"
  fi
fi

# ── 5. Messaging ───────────────────────────────────────────────────────────
head_ "5. Messaging"
if [[ -n "$APP_ID" ]]; then
  req POST "/api/applications/$APP_ID/messages" \
    '{"body":"Thanks for applying. Would Saturday at 10am suit you for a viewing?"}' "$LTOKEN"
  check "landlord sends message" 201 "$STATUS" "$BODY"

  req POST "/api/applications/$APP_ID/messages" \
    '{"body":"Saturday works. See you then."}' "$TTOKEN"
  check "tenant replies" 201 "$STATUS" "$BODY"

  req GET "/api/applications/$APP_ID/messages" "" "$TTOKEN"
  check "thread readable by participant" 200 "$STATUS" "$BODY"
  MSGS=$(echo "$BODY" | jq -r 'if type=="array" then length else (.data|length) end' 2>/dev/null || echo "?")
  grey "        messages in thread: $MSGS"
else
  grey "  SKIP  no application created — messaging not exercised"; SKIP=$((SKIP+1))
fi

# ── 6. Security spot-checks ────────────────────────────────────────────────
head_ "6. Security spot-checks"
req GET /api/rooms/my-rooms
check "my-rooms requires auth" 401 "$STATUS"

req GET /api/rooms/not-a-uuid
check "malformed UUID rejected" 400 "$STATUS"

req POST /api/auth/login '{"email":"not-an-email","password":"x"}'
check "invalid email format rejected" 400 "$STATUS"

if [[ -n "$ROOM_ID" ]]; then
  req PATCH "/api/rooms/$ROOM_ID" '{"title":"Hijacked by another user entirely"}' "$TTOKEN"
  check "tenant CANNOT edit landlord's room" 403 "$STATUS" "$BODY"
fi

# ── 7. Cross-tenant isolation (IDOR) ───────────────────────────────────────
# The sharpest question on a platform handling ID numbers and income data:
# can one tenant reach a DIFFERENT tenant's application or message thread?
head_ "7. Cross-tenant isolation (IDOR)"
INTRUDER_EMAIL="intruder+${STAMP}@rentboard.test"
req POST /api/auth/register \
  "{\"email\":\"$INTRUDER_EMAIL\",\"password\":\"$PASSWORD\",\"fullName\":\"Second Tenant\",\"role\":\"TENANT\"}"
check "register second tenant" 201 "$STATUS" "$BODY"
ITOKEN=$(echo "$BODY" | jq -r '.accessToken // empty')

if [[ -n "$APP_ID" && -n "$ITOKEN" ]]; then
  req GET "/api/applications/$APP_ID/messages" "" "$ITOKEN"
  if [[ "$STATUS" == "403" || "$STATUS" == "404" ]]; then
    green "  PASS  other tenant CANNOT read the message thread  ($STATUS)"; PASS=$((PASS+1))
  else
    red "  FAIL  other tenant READ a private message thread  (got $STATUS)"; FAIL=$((FAIL+1))
    grey "        $(echo "$BODY" | head -c 300)"
  fi

  req POST "/api/applications/$APP_ID/messages" '{"body":"intruder probe"}' "$ITOKEN"
  if [[ "$STATUS" == "403" || "$STATUS" == "404" ]]; then
    green "  PASS  other tenant CANNOT post into the thread  ($STATUS)"; PASS=$((PASS+1))
  else
    red "  FAIL  other tenant POSTED into a private thread  (got $STATUS)"; FAIL=$((FAIL+1))
  fi

  req POST "/api/applications/$APP_ID/accept" "" "$ITOKEN"
  if [[ "$STATUS" == "403" || "$STATUS" == "404" ]]; then
    green "  PASS  non-owner CANNOT accept an application  ($STATUS)"; PASS=$((PASS+1))
  else
    red "  FAIL  non-owner ACCEPTED an application  (got $STATUS)"; FAIL=$((FAIL+1))
  fi

  req GET /api/applications/mine "" "$ITOKEN"
  MINE=$(echo "$BODY" | jq -r 'if type=="array" then length else (.data|length // 0) end' 2>/dev/null || echo "?")
  if [[ "$MINE" == "0" ]]; then
    green "  PASS  second tenant's application list is empty (no leakage)"; PASS=$((PASS+1))
  else
    red "  FAIL  second tenant sees $MINE applications that are not theirs"; FAIL=$((FAIL+1))
  fi
fi

# ── Summary ────────────────────────────────────────────────────────────────
printf '\n\033[1m═══ Summary ═══\033[0m\n'
green "  passed:  $PASS"
[[ $SKIP -gt 0 ]] && grey "  skipped: $SKIP"
if [[ $FAIL -gt 0 ]]; then
  red "  FAILED:  $FAIL"
  printf '\nFix the failures above, then re-run. Paste the output if you want help.\n'
  exit 1
fi
printf '\n'
green "All checks passed — the core MVP flow works end to end."
printf 'Next: click the same flow in the UI at http://localhost:4200\n'
