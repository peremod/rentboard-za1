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
    # Not an ImageKit problem: this script creates rooms through the API and
    # never uploads a photo, so there is no heroImagePath to publish with.
    # Section 2b is what actually verifies the ImageKit credentials.
    grey  "  SKIP  publish blocked — no cover photo on an API-created room (expected)"; SKIP=$((SKIP+1))
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

# -- 8. Landlord dashboard --------------------------------------------------
# Every endpoint the landlord portal calls on load, plus the full room
# lifecycle its buttons trigger.
head_ "8. Landlord dashboard"
req GET /api/rooms/my-rooms "" "$LTOKEN"
check "my-rooms loads" 200 "$STATUS" "$BODY"
MY_COUNT=$(echo "$BODY" | jq -r 'if type=="array" then length else 0 end')
grey "        active/draft rooms: $MY_COUNT"

req GET /api/rooms/my-rooms/archived "" "$LTOKEN"
check "archived rooms loads" 200 "$STATUS" "$BODY"

req GET /api/rooms/my-rooms "" "$TTOKEN"
check "tenant CANNOT load landlord rooms" 403 "$STATUS" "$BODY"

if [[ -n "$ROOM_ID" ]]; then
  req GET "/api/applications/room/$ROOM_ID" "" "$LTOKEN"
  check "applicants list (Applicants nav)" 200 "$STATUS" "$BODY"

  # Lifecycle the dashboard buttons drive: reserve -> let -> undo -> relist
  req POST "/api/rooms/$ROOM_ID/reserve" "" "$LTOKEN"
  check "Mark as Reserved" 200 "$STATUS" "$BODY"

  req POST "/api/rooms/$ROOM_ID/let" "" "$LTOKEN"
  check "Mark as Let" 200 "$STATUS" "$BODY"

  req GET "/api/rooms/$ROOM_ID"
  LET_STATUS=$(echo "$BODY" | jq -r '.status')
  if [[ "$LET_STATUS" == "let" ]]; then
    green "  PASS  let room leaves the public board"; PASS=$((PASS+1))
  else
    red "  FAIL  room status after let: $LET_STATUS"; FAIL=$((FAIL+1))
  fi

  req POST "/api/rooms/$ROOM_ID/undo-let" "" "$LTOKEN"
  check "Undo let (30-minute window)" 200 "$STATUS" "$BODY"

  req POST "/api/rooms/$ROOM_ID/let" "" "$LTOKEN"
  req POST "/api/rooms/$ROOM_ID/relist" '{}' "$LTOKEN"
  check "Relist archived room" 200 "$STATUS" "$BODY"
  RELISTED=$(echo "$BODY" | jq -r '.status')
  if [[ "$RELISTED" == "active" ]]; then
    green "  PASS  relisted room is active again"; PASS=$((PASS+1))
  else
    red "  FAIL  status after relist: $RELISTED"; FAIL=$((FAIL+1))
  fi

  req POST "/api/rooms/$ROOM_ID/let" "" "$ITOKEN"
  check "non-owner CANNOT mark a room as let" 403 "$STATUS" "$BODY"
fi

# -- 9. Tenant dashboard ----------------------------------------------------
head_ "9. Tenant dashboard"
req GET /api/applications/mine "" "$TTOKEN"
check "my applications loads" 200 "$STATUS" "$BODY"

req GET /api/applications/mine
check "applications require auth" 401 "$STATUS"

req GET /api/auth/me "" "$TTOKEN"
check "profile loads (portal header)" 200 "$STATUS" "$BODY"

# Saved Rooms is device-local, but the dashboard resolves each saved id
# through the public room endpoint, so that path must work unauthenticated.
if [[ -n "$ROOM_ID" ]]; then
  req GET "/api/rooms/$ROOM_ID"
  check "saved room resolves by id" 200 "$STATUS" "$BODY"
fi
req GET /api/rooms/00000000-0000-0000-0000-000000000000
if [[ "$STATUS" == "404" ]]; then
  green "  PASS  removed saved room returns 404 (dashboard drops it)"; PASS=$((PASS+1))
else
  red "  FAIL  expected 404 for a missing room, got $STATUS"; FAIL=$((FAIL+1))
fi

# -- 10. Listing a room (create-room wizard) --------------------------------
head_ "10. Listing a room"
WIZ=$(cat <<JSON
{"roomType":"studio","title":"Wizard test studio in Rosebank","description":"A bright studio with its own entrance, fibre, prepaid electricity and secure off-street parking for one vehicle.","rentCents":720000,"depositCents":720000,"billsIncluded":false,"province":"Gauteng","city":"Rosebank","locationDisplay":"Rosebank, Gauteng","availableFrom":"$AVAIL","housematesCount":0,"couplesAllowed":true,"dssAccepted":false,"petsAllowed":true}
JSON
)
req POST /api/rooms "$WIZ" "$LTOKEN"
check "wizard step 1-4: create draft" 201 "$STATUS" "$BODY"
WIZ_ID=$(echo "$BODY" | jq -r '.id // empty')

if [[ -n "$WIZ_ID" ]]; then
  DRAFT_STATUS=$(echo "$BODY" | jq -r '.status')
  if [[ "$DRAFT_STATUS" == "draft" ]]; then
    green "  PASS  new room starts as a draft"; PASS=$((PASS+1))
  else
    red "  FAIL  expected draft, got $DRAFT_STATUS"; FAIL=$((FAIL+1))
  fi

  req GET /api/rooms
  if echo "$BODY" | jq -e --arg id "$WIZ_ID" '.data[]? | select(.id==$id)' >/dev/null 2>&1; then
    red "  FAIL  draft room is visible on the public board"; FAIL=$((FAIL+1))
  else
    green "  PASS  draft is hidden from the public board"; PASS=$((PASS+1))
  fi

  req PATCH "/api/rooms/$WIZ_ID" '{"rentCents":690000,"title":"Wizard test studio in Rosebank (updated)"}' "$LTOKEN"
  check "wizard edit saves changes" 200 "$STATUS" "$BODY"

  req POST /api/rooms '{"roomType":"studio","title":"short","rentCents":500,"province":"Gauteng","city":"X","locationDisplay":"X","availableFrom":"not-a-date"}' "$LTOKEN"
  check "wizard rejects invalid input" 400 "$STATUS" "$BODY"

  req POST /api/rooms '{"roomType":"studio","title":"Valid title for a room here","description":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","rentCents":500000,"province":"Atlantis","city":"X","locationDisplay":"X","availableFrom":"'"$AVAIL"'"}' "$LTOKEN"
  check "wizard rejects a non-SA province" 400 "$STATUS" "$BODY"

  req PATCH "/api/rooms/$WIZ_ID" '{"heroImagePath":"/smoke-test-placeholder.jpg"}' "$LTOKEN"
  req POST "/api/rooms/$WIZ_ID/publish" "" "$LTOKEN"
  check "wizard publish makes the room live" 200 "$STATUS" "$BODY"

  req GET /api/rooms
  if echo "$BODY" | jq -e --arg id "$WIZ_ID" '.data[]? | select(.id==$id)' >/dev/null 2>&1; then
    green "  PASS  published room appears on the public board"; PASS=$((PASS+1))
  else
    red "  FAIL  published room is missing from the public board"; FAIL=$((FAIL+1))
  fi

  # Room cards render the landlord block, so the list must carry that relation
  req GET /api/rooms
  if echo "$BODY" | jq -e '.data[0].landlord.fullName' >/dev/null 2>&1; then
    green "  PASS  room list includes landlord data (card footer)"; PASS=$((PASS+1))
  else
    red "  FAIL  room list has no landlord relation — card footer will be empty"; FAIL=$((FAIL+1))
  fi
fi


# -- 11. Application lifecycle edge cases ----------------------------------
head_ "11. Application lifecycle"
if [[ -n "$WIZ_ID" ]]; then
  req POST /api/applications "{\"roomId\":\"$WIZ_ID\",\"coverNote\":\"Interested in this studio.\"}" "$TTOKEN"
  check "tenant applies to the wizard room" 201 "$STATUS" "$BODY"
  WIZ_APP=$(echo "$BODY" | jq -r '.id // empty')

  if [[ -n "$WIZ_APP" ]]; then
    req POST "/api/applications/$WIZ_APP/withdraw" "" "$ITOKEN"
    check "other tenant CANNOT withdraw it" 403 "$STATUS" "$BODY"

    req POST "/api/applications/$WIZ_APP/withdraw" "" "$TTOKEN"
    check "tenant withdraws own application" 201 "$STATUS" "$BODY"

    req POST "/api/applications/$WIZ_APP/withdraw" "" "$TTOKEN"
    check "cannot withdraw twice" 400 "$STATUS" "$BODY"
  fi

  # Letting a room must close everyone still waiting, not leave them pending
  req POST /api/applications "{\"roomId\":\"$WIZ_ID\",\"coverNote\":\"Also interested.\"}" "$ITOKEN"
  WAITING=$(echo "$BODY" | jq -r '.id // empty')
  req POST "/api/rooms/$WIZ_ID/let" "" "$LTOKEN"
  check "mark wizard room as let" 200 "$STATUS" "$BODY"

  if [[ -n "$WAITING" ]]; then
    req GET /api/applications/mine "" "$ITOKEN"
    LEFT_PENDING=$(echo "$BODY" | jq -r --arg id "$WAITING" '[.[]? | select(.id==$id and .status=="pending")] | length')
    if [[ "$LEFT_PENDING" == "0" ]]; then
      green "  PASS  letting the room closed the waiting applicant"; PASS=$((PASS+1))
    else
      red "  FAIL  applicant left pending on a room that is already let"; FAIL=$((FAIL+1))
    fi
  fi

  # A relisted room must accept a fresh application from the same tenant
  req POST "/api/rooms/$WIZ_ID/relist" '{}' "$LTOKEN"
  req POST /api/applications "{\"roomId\":\"$WIZ_ID\",\"coverNote\":\"Applying again after relist.\"}" "$TTOKEN"
  check "same tenant can re-apply after a relist" 201 "$STATUS" "$BODY"

  req GET "/api/applications/room/$WIZ_ID" "" "$LTOKEN"
  CUR=$(echo "$BODY" | jq -r 'if type=="array" then length else 0 end')
  if [[ "$CUR" == "1" ]]; then
    green "  PASS  applicant list shows only the new cycle (1)"; PASS=$((PASS+1))
  else
    red "  FAIL  applicant list shows $CUR — old cycle applicants leaked through"; FAIL=$((FAIL+1))
  fi
fi


# -- 12. Tenant alerts (saved searches) ------------------------------------
head_ "12. Tenant alerts"
req GET /api/alerts/saved-searches "" "$TTOKEN"
check "saved searches list" 200 "$STATUS" "$BODY"

req POST /api/alerts/saved-searches \
  '{"name":"Gauteng under R6000","province":"Gauteng","maxRentCents":600000,"frequency":"instant"}' "$TTOKEN"
check "create a saved search" 201 "$STATUS" "$BODY"
SEARCH_ID=$(echo "$BODY" | jq -r '.id // empty')

req POST /api/alerts/saved-searches '{"name":"Bad province","province":"Atlantis"}' "$TTOKEN"
check "rejects a non-SA province" 400 "$STATUS" "$BODY"

req GET /api/alerts/saved-searches
check "saved searches require auth" 401 "$STATUS"

if [[ -n "$SEARCH_ID" ]]; then
  req PATCH "/api/alerts/saved-searches/$SEARCH_ID" '{"isActive":false}' "$TTOKEN"
  check "pause a saved search" 200 "$STATUS" "$BODY"

  req PATCH "/api/alerts/saved-searches/$SEARCH_ID" '{"isActive":true}' "$ITOKEN"
  check "another tenant CANNOT edit it" 403 "$STATUS" "$BODY"

  # Publishing a matching room must not fail even though alerts fire
  req POST /api/rooms "$ROOM_JSON" "$LTOKEN"
  ALERT_ROOM=$(echo "$BODY" | jq -r '.id // empty')
  if [[ -n "$ALERT_ROOM" ]]; then
    req PATCH "/api/rooms/$ALERT_ROOM" '{"heroImagePath":"/smoke-test-placeholder.jpg"}' "$LTOKEN"
    req POST "/api/rooms/$ALERT_ROOM/publish" "" "$LTOKEN"
    check "publish still succeeds while alerts fire" 200 "$STATUS" "$BODY"
  fi

  req DELETE "/api/alerts/saved-searches/$SEARCH_ID" "" "$TTOKEN"
  check "delete a saved search" 200 "$STATUS" "$BODY"
fi

# -- 13. Landlord verification ---------------------------------------------
head_ "13. Landlord verification"
req GET /api/verification/mine "" "$LTOKEN"
check "landlord verification list" 200 "$STATUS" "$BODY"

req GET /api/verification/mine "" "$TTOKEN"
check "tenant CANNOT access verification" 403 "$STATUS" "$BODY"

req POST /api/verification '{"type":"identity","documentPath":"private/verification/smoke-test.jpg"}' "$LTOKEN"
check "submit an identity document" 201 "$STATUS" "$BODY"

if echo "$BODY" | jq -e 'has("documentPath")' >/dev/null 2>&1; then
  red "  FAIL  response exposed documentPath — POPIA s.26 special personal information"; FAIL=$((FAIL+1))
else
  green "  PASS  documentPath withheld from the response"; PASS=$((PASS+1))
fi

req POST /api/verification '{"type":"identity","documentPath":"private/verification/again.jpg"}' "$LTOKEN"
check "rejects a duplicate pending request" 400 "$STATUS" "$BODY"

req POST /api/verification '{"type":"nonsense","documentPath":"x"}' "$LTOKEN"
check "rejects an unknown document type" 400 "$STATUS" "$BODY"

req GET /api/verification/pending "" "$LTOKEN"
check "non-admin CANNOT see the review queue" 403 "$STATUS" "$BODY"


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
