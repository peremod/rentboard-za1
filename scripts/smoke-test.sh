#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Mastande ZA — end-to-end API smoke test
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
# it is safe to run repeatedly. It REFUSES to run against production — see
# below, and see why.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

API="${API:-http://localhost:3000}"
STAMP=$(date +%s)

# ── Refuse to touch production ─────────────────────────────────────────────
#
# This line used to read "Never run it against production" and that was the
# entire protection. It was not enough: a production board served real
# visitors a room called "Wizard test studio in Rosebank (updated)", a
# landlord renamed to "Renamed Landlord", and a hero image pointing at
# /smoke-test-placeholder.jpg — every one of them created by this script.
#
# So it asks. /health reports which deployment it is, and production is a
# hard stop with no override flag, because the only reason to add one is to
# use it. Run it against a local API, a staging API, or a throwaway database.
SMOKE_ENV=$(curl -s --max-time 10 "$API/health" | sed -n 's/.*"env":"\([a-z]*\)".*/\1/p')
if [ "$SMOKE_ENV" = "production" ]; then
  printf '\033[31m%s\033[0m\n' "REFUSING: $API reports APP_ENV=production."
  echo
  echo "  This script registers landlords and tenants, publishes rooms, renames"
  echo "  accounts and uploads placeholder photos. Those rows are visible to"
  echo "  real visitors on a production board, and they have been before."
  echo
  echo "  Point API at a local or staging server:"
  echo "    API=http://localhost:3000 bash scripts/smoke-test.sh"
  exit 2
fi
if [ -z "$SMOKE_ENV" ]; then
  # An older API that does not report its environment, or one that is down.
  # Warned rather than blocked: the run will fail on its own if nothing is
  # listening, and refusing outright would break every checkout older than
  # this guard.
  printf '\033[33m%s\033[0m\n' "⚠ $API did not report an environment — cannot confirm this is not production."
fi
LANDLORD_EMAIL="landlord+${STAMP}@mastande.test"
TENANT_EMAIL="tenant+${STAMP}@mastande.test"
PASSWORD="TestPass123"

PASS=0; FAIL=0; SKIP=0
# Every skip's reason, so the summary can NAME them rather than count them.
#
# Counting was how the retention defect survived: the one assertion covering
# "uploaded documents are deleted" sat behind ADMIN_TOKEN, nobody set it, and a
# line reading "skipped: 14" gave a reader no way to know that the check about
# someone's identity document was one of the fourteen.
SKIP_REASONS=()
# Use in place of a bare `grey` + counter: it prints, counts AND records, so the
# summary can name what did not run.
skipped() { grey "  SKIP  $1"; SKIP=$((SKIP+1)); SKIP_REASONS+=("$1"); }

# throttled <name> -> 0 if the last response was a 429, having SKIPPED the check
#
# ⚠️ For assertions that read $BODY instead of going through check().
#
# check() already skips a 429 and names the remedy. A hand-rolled `if` reading
# a jq field does not: a 429 body has no field, so the assertion falls to its
# else branch and reports a logic failure. Section 29 did exactly that — three
# runs of this suite inside a minute spent the 20/min on
# /api/referrals/validate, and the two checks around it reported "own code did
# not validate" AND "unknown code validated", which cannot both be true. A
# limiter doing its job read as the endpoint being broken in both directions.
throttled() {
  [[ "$STATUS" == "429" ]] || return 1
  skipped "$1 — rate limited (429). Counted in memory: wait it out, or restart the API, and re-run"
  return 0
}

# ── Derive ADMIN_TOKEN, so the admin sections actually run ─────────────────
#
# Seven sections of this suite are gated on ADMIN_TOKEN, and in practice nobody
# ever set it: ~69 checks never ran. That is how the retention defect survived —
# the one assertion covering "documents are deleted" was inside one of them, and
# a skipped check reads exactly like a passing one when you are scanning output.
#
# So: if ADMIN_EMAIL and ADMIN_PASSWORD are set (the same pair scripts/db:seed
# and a11y-drive.mjs already use), log in and derive the token. No credentials
# are hardcoded here — an unset pair still skips, loudly, as before.
if [[ -z "${ADMIN_TOKEN:-}" && -n "${ADMIN_EMAIL:-}" && -n "${ADMIN_PASSWORD:-}" ]]; then
  ADMIN_LOGIN=$(curl -s --max-time 15 -X POST "$API/api/auth/login"     -H 'Content-Type: application/json'     -d "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p}')" || true)
  ADMIN_TOKEN=$(echo "$ADMIN_LOGIN" | jq -r '.accessToken // .access_token // empty' 2>/dev/null || true)
  if [[ -n "$ADMIN_TOKEN" ]]; then
    printf '\033[90m%s\033[0m\n' "  ADMIN_TOKEN derived from ADMIN_EMAIL — the admin sections will run."
    export ADMIN_TOKEN
  else
    # Named rather than silent: a wrong password here silently removes 69
    # checks, which is the failure mode this block exists to end.
    printf '\033[33m%s\033[0m\n' "⚠ ADMIN_EMAIL is set but signing in failed — the admin sections will SKIP. Check the password, or that the admin is seeded."
  fi
fi

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
    return
  fi
  # ⚠️ A 429 nobody asked for cannot answer the question the check was asking.
  #
  # v1.86.0 put real per-route rate limiting on the auth routes — a window of
  # fifteen minutes, counted in memory. Running this suite twice inside that
  # window therefore made "login with correct password" fail with a 429, and
  # four other checks behind it, none of which is a login bug: it is the
  # limiter doing exactly its job. Reported as failures they were an alarm
  # crying wolf on every second run, which is how a suite stops being read.
  #
  # Skipped and NAMED instead, with the remedy, because this file's rule is
  # that nothing unexamined is allowed to look like a pass. A check expecting a
  # 429 still passes or fails on its own terms, since `want` is compared first.
  if [[ "$got" == "429" ]]; then
    skipped "$name — rate limited (429). The auth limiter counts in memory over 15 minutes: wait it out, or restart the API, and re-run"
    return
  fi
  red   "  FAIL  $name  (expected $want, got $got)"; FAIL=$((FAIL+1))
  [[ -n "$body" ]] && grey "        $(echo "$body" | head -c 400)"
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

echo "Mastande ZA smoke test → $API"

# ── 1. Infrastructure ──────────────────────────────────────────────────────
# ── A note on $BODY ─────────────────────────────────────────────────────
# `req` overwrites the global STATUS and BODY. Any assertion reading BODY must
# come immediately after the request it is about — inserting a new check
# between a request and its assertion silently repoints the assertion at the
# wrong response. That has caused three false failures in this file, each of
# which looked like an application bug.
#
# When adding a check, put it after the existing assertions for that request,
# not between the request and them.

# ── Optional captures ───────────────────────────────────────────────────
# Declared empty because set -u aborts on an unset variable, and each of
# these is assigned inside a section that may be skipped. A later section
# referencing one should get an empty string and skip, not kill the run.
ADV_ID=""
ALERT_ROOM=""
AMOUNT=""
CAMP_ID=""
CAMP_STATUS=""
CLICK_CODE=""
CLOSES=""
CODE=""
COUNT=""
CUR=""
DEMO_ID=""
DRAFT_STATUS=""
ENQ_ID=""
HAS_SIG=""
IN_QUEUE=""
LAUNCH=""
LEFT_PENDING=""
LET_STATUS=""
LIQ=""
LOWED=""
SHARED_YARD=""
SURVEY_AGAIN=""
SURVEY_MICRO=""
SURVEY_RECORDED=""
SURVEY_SEG=""
SURVEY_SLUG=""
SURVEY_TENANT=""
MINE=""
MSGS=""
OTHER_LL=""
OTHER_LTOKEN=""
OWED=""
PAY_VR=""
PENDING=""
PERIOD=""
PUBKEY=""
PUBLIC_TENANT=""
REFEREE=""
REFEREE_TOKEN=""
RELISTED=""
RESP=""
ROOM_REVIEW=""
SERVED=""
SUB_CAMP=""
TEN_APP=""
TEN_ID=""
TEN_STATUS=""
VALID=""
VERIFIED=""
VISIBLE=""
VR_STATUS=""
WAITING=""
WIZ_APP=""

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
TENANT_ID=$(echo "$BODY" | jq -r '.user.id // empty')

req POST /api/auth/login "{\"email\":\"$LANDLORD_EMAIL\",\"password\":\"$PASSWORD\"}"
check "login with correct password" 201 "$STATUS" "$BODY"
[[ -n "$(echo "$BODY" | jq -r '.accessToken // empty')" ]] && LTOKEN=$(echo "$BODY" | jq -r '.accessToken')

req POST /api/auth/login "{\"email\":\"$LANDLORD_EMAIL\",\"password\":\"WrongPass123\"}"
check "login rejects wrong password" 401 "$STATUS" "$BODY"

req POST /api/auth/register \
  "{\"email\":\"$LANDLORD_EMAIL\",\"password\":\"$PASSWORD\",\"fullName\":\"Dupe\",\"role\":\"LANDLORD\"}"
check "duplicate email rejected" 409 "$STATUS" "$BODY"

req POST /api/auth/register \
  "{\"email\":\"weak@mastande.test\",\"password\":\"weak\",\"fullName\":\"Weak\",\"role\":\"TENANT\"}"
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
    # Remembered because the retention check further down cannot mean anything
    # without storage: a server that cannot reach ImageKit cannot delete from it.
    STORAGE_LIVE=1
  else
    red "  FAIL  ImageKit auth returned 200 but payload incomplete"; FAIL=$((FAIL+1))
    grey "        $(echo "$BODY" | head -c 300)"
  fi
elif [[ "$STATUS" == "503" ]]; then
  skipped "ImageKit not configured - set IMAGEKIT_* in backend/.env"
else
  check "ImageKit auth endpoint" 200 "$STATUS" "$BODY"
fi

# ── 3. Rooms ───────────────────────────────────────────────────────────────
head_ "3. Rooms — landlord lifecycle"
AVAIL=$(date -d '+30 days' +%Y-%m-%d 2>/dev/null || date -v+30d +%Y-%m-%d)
# Yesterday — campaigns and anything else that must already be live.
STARTED=$(date -d '-1 day' +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d)
ROOM_JSON=$(cat <<JSON
{"roomType":"en_suite","title":"Bright en-suite room in Sandton house","description":"A large, sunny en-suite room in a quiet professional shared house. Walking distance to Gautrain, fibre installed, secure parking available.","rentCents":550000,"depositCents":550000,"billsIncluded":true,"province":"Gauteng","city":"Sandton","locationDisplay":"Sandton, Gauteng","availableFrom":"$AVAIL","housematesCount":2,"couplesAllowed":false,"dssAccepted":true,"petsAllowed":false}
JSON
)
req POST /api/rooms "$ROOM_JSON" "$LTOKEN"
check "landlord creates room (draft)" 201 "$STATUS" "$BODY"
ROOM_ID=$(echo "$BODY" | jq -r '.id // empty')

# ⚠️ This check used to assert 403 — "tenant CANNOT create room" — and that was
# correct until Phase 6. Option A is precisely that a TENANT may hold a listing,
# so the old assertion now encodes a rule the product deliberately dropped.
# Rewritten rather than deleted: what still has to be true is that the listing
# they get is a SUBLET, whatever they asked for, because a tenant account
# presenting a listing as an owner's is the one outcome that must be impossible.
req POST /api/rooms "$ROOM_JSON" "$TTOKEN"
check "a tenant CAN create a listing now (Phase 6 Option A)" 201 "$STATUS" "$BODY"
TENANT_ROOM=$(echo "$BODY" | jq -r '.id // empty')
if [[ "$(echo "$BODY" | jq -r '.listerType')" == "sublessor" ]]; then
  green "  PASS  and it is forced to sublessor — a tenant cannot list as an owner"; PASS=$((PASS+1))
else
  red "  FAIL  a tenant's listing came back as $(echo "$BODY" | jq -r '.listerType')"; FAIL=$((FAIL+1))
fi

if [[ -n "$ROOM_ID" ]]; then
  # publish requires a hero image; without ImageKit this is expected to 400
  req POST "/api/rooms/$ROOM_ID/publish" "" "$LTOKEN"
  if [[ "$STATUS" == "200" ]]; then
    green "  PASS  publish room  (200)"; PASS=$((PASS+1))
  elif [[ "$STATUS" == "400" ]]; then
    # Not an ImageKit problem: this script creates rooms through the API and
    # never uploads a photo, so there is no heroImagePath to publish with.
    # Section 2b is what actually verifies the ImageKit credentials.
    skipped "publish blocked — no cover photo on an API-created room (expected)"
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

  # ── Phase 7c: every applicant in one call ────────────────────────────────
  # Applicants were per room and only per room, so a landlord with six rooms
  # had six screens to check before they knew whether anybody had applied.
  req GET "/api/applications/inbox" "" "$LTOKEN"
  check "landlord lists every applicant across all rooms" 200 "$STATUS" "$BODY"
  if [[ -n "$APP_ID" ]]; then
    if echo "$BODY" | jq -e --arg id "$APP_ID" '.data | map(.id) | index($id)' >/dev/null 2>&1; then
      green "  PASS  the applicant from this run is in it"; PASS=$((PASS+1))
    else
      red "  FAIL  the portfolio-wide inbox does not contain the application just created"; FAIL=$((FAIL+1))
    fi
  fi

  req GET "/api/applications/inbox?roomId=$ROOM_ID" "" "$LTOKEN"
  check "applicants filterable by room" 200 "$STATUS" "$BODY"

  req GET "/api/applications/inbox?roomId=not-a-uuid" "" "$LTOKEN"
  check "malformed room filter refused, not ignored" 400 "$STATUS" "$BODY"

  # 200-and-empty, NOT 403. ListerGuard admits a tenant because a sub-lessor
  # lets rooms too (Phase 6); what keeps them out of a landlord's applicants is
  # the WHERE clause, and that is the thing worth checking. A guard-shaped
  # expectation here would pass even if the scoping were removed.
  req GET "/api/applications/inbox" "" "$TTOKEN"
  check "tenant may ask for their own lettings' applicants" 200 "$STATUS" "$BODY"
  TENANT_SEES=$(echo "$BODY" | jq -r '.data | length' 2>/dev/null || echo "?")
  if [[ "$TENANT_SEES" == "0" ]]; then
    green "  PASS  …and sees none, because they let nothing  (scoped by the clause, not the guard)"; PASS=$((PASS+1))
  else
    red "  FAIL  a tenant saw $TENANT_SEES applicant(s) for rooms they do not let"; FAIL=$((FAIL+1))
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

  # ── Phase 7c: one inbox across every conversation ────────────────────────
  # Threads were reachable only from inside the application they belonged to,
  # so both navs listed "Messages" greyed out with a "Soon" chip.
  req GET "/api/messages/inbox" "" "$LTOKEN"
  check "landlord lists every conversation in one call" 200 "$STATUS" "$BODY"
  if echo "$BODY" | jq -e --arg id "$APP_ID" '.data | map(.applicationId) | index($id)' >/dev/null 2>&1; then
    green "  PASS  the thread from this run is in it"; PASS=$((PASS+1))
  else
    red "  FAIL  the unified inbox does not contain the conversation just created"; FAIL=$((FAIL+1))
  fi

  # The channel is in the payload because a thread genuinely mixes them: a
  # tenant's message is forwarded to the landlord on WhatsApp and a reply there
  # is threaded back. Without it, a landlord cannot tell where their last answer
  # went — which the UI warns about explicitly.
  LAST_CHAN=$(echo "$BODY" | jq -r --arg id "$APP_ID" '.data[] | select(.applicationId==$id) | .lastMessage.channel' 2>/dev/null)
  if [[ "$LAST_CHAN" == "in_app" || "$LAST_CHAN" == "whatsapp" ]]; then
    green "  PASS  …saying which channel the last message arrived on  ($LAST_CHAN)"; PASS=$((PASS+1))
  else
    red "  FAIL  the inbox row carries no channel: '$LAST_CHAN'"; FAIL=$((FAIL+1))
  fi

  # ⚠️ Message.readAt had been on the model since messaging shipped and NOTHING
  # ever wrote it. Any unread badge built on it would have counted every message
  # ever sent, for ever. Opening the thread (above, as the tenant) is what marks
  # the landlord's message read, so the tenant's own unread count must now be 0.
  req GET "/api/messages/inbox" "" "$TTOKEN"
  check "tenant has the same inbox from the other side" 200 "$STATUS" "$BODY"
  T_UNREAD=$(echo "$BODY" | jq -r --arg id "$APP_ID" '.data[] | select(.applicationId==$id) | .unread' 2>/dev/null)
  if [[ "$T_UNREAD" == "0" ]]; then
    green "  PASS  …with the unread count cleared by opening the thread  (readAt is finally written)"; PASS=$((PASS+1))
  else
    red "  FAIL  unread is '$T_UNREAD' after the tenant opened the thread — readAt is not being written"; FAIL=$((FAIL+1))
  fi
else
  skipped "no application created — messaging not exercised"
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
INTRUDER_EMAIL="intruder+${STAMP}@mastande.test"
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

  # Phase 7c. The unified inbox is a NEW surface onto private conversations and
  # carries no role guard at all — both roles need it. 200-and-absent is the
  # right answer: the scoping is the only thing keeping a stranger out, so it is
  # what gets checked rather than a status code.
  req GET "/api/messages/inbox" "" "$ITOKEN"
  check "unified inbox readable by any signed-in account" 200 "$STATUS" "$BODY"
  if echo "$BODY" | jq -e --arg id "$APP_ID" '.data | map(.applicationId) | index($id)' >/dev/null 2>&1; then
    red "  FAIL  a stranger's inbox CONTAINS a conversation they are not part of"; FAIL=$((FAIL+1))
  else
    green "  PASS  …and contains no conversation this account is not part of"; PASS=$((PASS+1))
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

# Also a Phase 6 change: my-rooms carries ListerGuard, so a tenant reaches it —
# they have listings of their own to manage. The property that still matters is
# ISOLATION, which the 403 was only ever a proxy for: a tenant must not see a
# landlord's rooms. That is asserted directly now.
req GET /api/rooms/my-rooms "" "$TTOKEN"
check "a tenant can load their own listings" 200 "$STATUS" "$BODY"
if [[ -n "$ROOM_ID" ]] && echo "$BODY" | jq -e --arg id "$ROOM_ID" 'map(.id) | index($id) == null' >/dev/null 2>&1; then
  green "  PASS  and a landlord's room is not among them"; PASS=$((PASS+1))
else
  red "  FAIL  a tenant's my-rooms included a landlord's listing"; FAIL=$((FAIL+1))
fi

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

# -- 13. Verification, both sides ------------------------------------------
# This section used to assert "tenant CANNOT access verification (403)",
# which was true and is now wrong: LandlordGuard sat on these routes, so a
# tenant could not be verified at all and the Renter's Passport had no way to
# exist. The guard was removed in v1.56.0.
#
# The isolation that matters was never the route — it is that a tenant cannot
# submit a landlord's document and cannot read the admin queue. Both are
# asserted below, and both are stricter than the guard was: the guard never
# checked that a landlord was submitting a landlord's document.
head_ "13. Verification, both sides"
req GET /api/verification/mine "" "$LTOKEN"
check "landlord verification list" 200 "$STATUS" "$BODY"

req GET /api/verification/mine "" "$TTOKEN"
check "tenant CAN list their own verifications" 200 "$STATUS" "$BODY"

req GET /api/verification/pending "" "$TTOKEN"
check "tenant CANNOT read the admin review queue" 403 "$STATUS" "$BODY"

req POST /api/verification '{"type":"sassa_grant","documentPath":"private/verification/wrong-side.jpg"}' "$LTOKEN"
check "landlord CANNOT submit a tenant income proof" 400 "$STATUS" "$BODY"

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


# -- 14. Room lifecycle: reserve / pause / remove ---------------------------
head_ "14. Reserve, pause, remove"
req POST /api/rooms "$ROOM_JSON" "$LTOKEN"
LIFE_ID=$(echo "$BODY" | jq -r '.id // empty')
if [[ -n "$LIFE_ID" ]]; then
  req PATCH "/api/rooms/$LIFE_ID" '{"heroImagePath":"/smoke-test-placeholder.jpg"}' "$LTOKEN"
  req POST "/api/rooms/$LIFE_ID/publish" "" "$LTOKEN"

  req POST "/api/rooms/$LIFE_ID/reserve" "" "$LTOKEN"
  check "reserve an active room" 200 "$STATUS" "$BODY"

  req POST /api/applications "{\"roomId\":\"$LIFE_ID\",\"coverNote\":\"Still interested\"}" "$ITOKEN"
  if [[ "$STATUS" == "400" ]] && echo "$BODY" | grep -qi "reserved"; then
    green "  PASS  reserved room refuses new applications, with a reason"; PASS=$((PASS+1))
  else
    red "  FAIL  reserved room accepted an application (got $STATUS)"; FAIL=$((FAIL+1))
  fi

  req POST "/api/rooms/$LIFE_ID/unreserve" "" "$LTOKEN"
  check "unreserve back to active" 200 "$STATUS" "$BODY"

  req POST "/api/rooms/$LIFE_ID/pause" "" "$LTOKEN"
  check "pause a listing" 200 "$STATUS" "$BODY"

  req GET /api/rooms
  if echo "$BODY" | jq -e --arg id "$LIFE_ID" '.data[]? | select(.id==$id)' >/dev/null 2>&1; then
    red "  FAIL  paused room still on the public board"; FAIL=$((FAIL+1))
  else
    green "  PASS  paused room is off the public board"; PASS=$((PASS+1))
  fi

  # Resume must keep applications. Relisting a paused room would archive them,
  # which is the opposite of what pausing is for.
  req POST /api/applications "{\"roomId\":\"$LIFE_ID\",\"coverNote\":\"Interested while paused test.\"}" "$ITOKEN"
  PAUSE_APP=$(echo "$BODY" | jq -r '.id // empty')

  req POST "/api/rooms/$LIFE_ID/unpause" "" "$LTOKEN"
  check "resume a paused room" 200 "$STATUS" "$BODY"

  if [[ -n "$PAUSE_APP" ]]; then
    req GET "/api/applications/room/$LIFE_ID" "" "$LTOKEN"
    if echo "$BODY" | jq -e --arg id "$PAUSE_APP" 'any(.[]?; .id==$id)' >/dev/null 2>&1; then
      green "  PASS  resuming kept the open application"; PASS=$((PASS+1))
    else
      red "  FAIL  resuming closed an open application"; FAIL=$((FAIL+1))
    fi
  fi

  # A paused room must still be visible to its landlord, or it is unreachable.
  req POST "/api/rooms/$LIFE_ID/pause" "" "$LTOKEN"
  req GET /api/rooms/my-rooms "" "$LTOKEN"
  if echo "$BODY" | jq -e --arg id "$LIFE_ID" 'any(.[]?; .id==$id)' >/dev/null 2>&1; then
    green "  PASS  a paused room stays on the landlord dashboard"; PASS=$((PASS+1))
  else
    red "  FAIL  paused room vanished from my-rooms"; FAIL=$((FAIL+1))
  fi

  req POST "/api/rooms/$LIFE_ID/unpause" "" "$LTOKEN"

  req POST "/api/rooms/$LIFE_ID/remove" "" "$LTOKEN"
  check "remove a published listing" 200 "$STATUS" "$BODY"

  req GET /api/rooms
  if echo "$BODY" | jq -e --arg id "$LIFE_ID" '.data[]? | select(.id==$id)' >/dev/null 2>&1; then
    red "  FAIL  removed room still on the public board"; FAIL=$((FAIL+1))
  else
    green "  PASS  removed room is off the public board"; PASS=$((PASS+1))
  fi

  req POST "/api/rooms/$LIFE_ID/pause" "" "$ITOKEN"
  check "non-owner CANNOT pause" 403 "$STATUS" "$BODY"
fi

# -- 15. Closed conversations ----------------------------------------------
head_ "15. Closed conversations"
if [[ -n "$APP_ID" ]]; then
  req POST "/api/applications/$APP_ID/reject" '{"reason":"Went with someone else"}' "$LTOKEN"
  req POST "/api/applications/$APP_ID/messages" '{"body":"Are you still there?"}' "$TTOKEN"
  check "cannot message on a rejected application" 400 "$STATUS" "$BODY"

  req GET "/api/applications/$APP_ID/messages" "" "$TTOKEN"
  check "thread stays readable after closure" 200 "$STATUS" "$BODY"
fi


# -- 16. Admin surface -----------------------------------------------------
# No admin token here by design: this section proves the admin API is closed to
# ordinary accounts. Seed an admin (npm run db:seed) and set ADMIN_TOKEN to
# exercise the authorised paths.
head_ "16. Admin surface"
req GET /api/admin/stats "" "$LTOKEN"
check "landlord CANNOT read admin stats" 403 "$STATUS" "$BODY"

req GET /api/admin/stats "" "$TTOKEN"
check "tenant CANNOT read admin stats" 403 "$STATUS" "$BODY"

req GET /api/admin/stats
check "admin stats require auth" 401 "$STATUS"

req GET /api/admin/users "" "$TTOKEN"
check "tenant CANNOT list users" 403 "$STATUS" "$BODY"

req PATCH "/api/admin/users/$(echo "$BODY" | jq -r '.id // "00000000-0000-0000-0000-000000000000"')/active" \
  '{"isActive":false,"reason":"probe"}' "$TTOKEN"
check "tenant CANNOT suspend an account" 403 "$STATUS" "$BODY"

req GET /api/verification/pending "" "$TTOKEN"
check "tenant CANNOT read the verification queue" 403 "$STATUS" "$BODY"

# Ending somebody's account — Phase 7i. These need NO admin token, which is the
# point: the guards on the most destructive route in the product should not be
# among the checks that only run when somebody remembers to set an env var.
req DELETE "/api/admin/users/$TENANT_ID" '{"reason":"A landlord should never reach this route.","confirm":"CLOSE","understood":true}' "$LTOKEN"
check "landlord CANNOT end an account" 403 "$STATUS" "$BODY"

req DELETE "/api/admin/users/$TENANT_ID" '{"reason":"A tenant should never reach this route.","confirm":"CLOSE","understood":true}' "$TTOKEN"
check "tenant CANNOT end an account" 403 "$STATUS" "$BODY"

req DELETE "/api/admin/users/$TENANT_ID" '{"reason":"Unauthenticated.","confirm":"CLOSE","understood":true}'
check "ending an account requires auth" 401 "$STATUS"

req GET "/api/admin/users/$TENANT_ID/closure-preview" "" "$TTOKEN"
check "tenant CANNOT see what ending an account would do" 403 "$STATUS" "$BODY"

if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  req GET /api/admin/stats "" "$ADMIN_TOKEN"
  check "admin reads stats" 200 "$STATUS" "$BODY"

  req GET /api/verification/pending "" "$ADMIN_TOKEN"
  check "admin reads the verification queue" 200 "$STATUS" "$BODY"

  # Must be a real user: the service looks the account up before validating
  # the body, so a fake id returns 404 and never reaches the reason check.
  if [[ -n "$TENANT_ID" ]]; then
    req PATCH "/api/admin/users/$TENANT_ID/active" '{"isActive":false}' "$ADMIN_TOKEN"
    check "suspension requires a reason" 400 "$STATUS" "$BODY"
  fi

  req PATCH "/api/admin/users/00000000-0000-0000-0000-000000000000/active" \
    '{"isActive":false,"reason":"probe"}' "$ADMIN_TOKEN"
  check "suspending an unknown user returns 404" 404 "$STATUS" "$BODY"

  # ── Ending an account on its owner's request — Phase 7i.
  #
  # NOTHING here sends a valid closure: it is irreversible, and a smoke suite
  # that ends an account every run would erase the tenant the sections after it
  # still ask questions about. scripts/admin-closure-drive.mjs does the real
  # one, on accounts it registered itself.
  if [[ -n "$TENANT_ID" ]]; then
    req GET "/api/admin/users/$TENANT_ID/closure-preview" "" "$ADMIN_TOKEN"
    check "admin can see what ending an account would do" 200 "$STATUS" "$BODY"
    if throttled "the closure preview names what is erased, KEPT and what stops"; then
      :
    elif echo "$BODY" | jq -e '(.kept | type) == "array" and (.erased | type) == "array" and (.stops | type) == "array"' >/dev/null 2>&1; then
      green "  PASS  the closure preview names what is erased, what is KEPT and what stops"; PASS=$((PASS+1))
    else
      red "  FAIL  the closure preview does not carry all three lists"; FAIL=$((FAIL+1))
      grey "        $(echo "$BODY" | head -c 300)"
    fi

    req DELETE "/api/admin/users/$TENANT_ID" '{"reason":"ok","confirm":"CLOSE","understood":true}' "$ADMIN_TOKEN"
    check "a two-character request is refused — the audit row is the only evidence" 400 "$STATUS" "$BODY"

    req DELETE "/api/admin/users/$TENANT_ID" '{"reason":"Emailed from the registered address, ticket 412.","confirm":"yes","understood":true}' "$ADMIN_TOKEN"
    check "the typed word has to be CLOSE" 400 "$STATUS" "$BODY"

    req DELETE "/api/admin/users/$TENANT_ID" '{"reason":"Emailed from the registered address, ticket 412.","confirm":"CLOSE"}' "$ADMIN_TOKEN"
    check "an absent acknowledgement is refused, not read as false" 400 "$STATUS" "$BODY"
  fi

  req DELETE /api/admin/users/00000000-0000-0000-0000-000000000000 \
    '{"reason":"Ending an account that does not exist.","confirm":"CLOSE","understood":true}' "$ADMIN_TOKEN"
  check "ending an unknown account returns 404" 404 "$STATUS" "$BODY"
else
  skipped "authorised admin paths — set ADMIN_TOKEN to include them"
fi


# -- 17. Account recovery --------------------------------------------------
head_ "17. Account recovery"
req POST /api/auth/forgot-password "{\"email\":\"$LANDLORD_EMAIL\"}"
check "forgot-password for a real account" 200 "$STATUS" "$BODY"
REAL_MSG=$(echo "$BODY" | jq -r '.message')

req POST /api/auth/forgot-password '{"email":"definitely-not-registered@mastande.test"}'
check "forgot-password for an unknown account" 200 "$STATUS" "$BODY"
FAKE_MSG=$(echo "$BODY" | jq -r '.message')

# The whole point: the response must not reveal whether an account exists.
if [[ "$REAL_MSG" == "$FAKE_MSG" ]]; then
  green "  PASS  response is identical either way (no membership oracle)"; PASS=$((PASS+1))
else
  red "  FAIL  responses differ — the endpoint reveals whether an account exists"; FAIL=$((FAIL+1))
fi

req POST /api/auth/forgot-password '{"email":"not-an-email"}'
check "rejects a malformed address" 400 "$STATUS" "$BODY"

req POST /api/auth/reset-password '{"token":"clearly-invalid-token","newPassword":"NewPass123"}'
check "rejects an invalid reset token" 400 "$STATUS" "$BODY"

req POST /api/auth/reset-password '{"token":"whatever","newPassword":"weak"}'
check "reset enforces password strength" 400 "$STATUS" "$BODY"

# A wrong CURRENT password is 403, not 401, and these two checks are the pair
# that proves it. Both were 401 before, so the suite could not tell "the
# password you typed is wrong" from "you are not signed in" — and the browser
# could not either: it refreshed the session, retried with the same wrong
# password and logged the person out saying their session had expired.
req POST /api/auth/change-password '{"currentPassword":"wrong","newPassword":"NewPass123"}' "$LTOKEN"
check "change-password rejects a wrong current password (403, not a lost session)" 403 "$STATUS" "$BODY"

req POST /api/auth/change-password "{\"currentPassword\":\"$PASSWORD\",\"newPassword\":\"$PASSWORD\"}" "$LTOKEN"
check "rejects reusing the same password" 400 "$STATUS" "$BODY"

req POST /api/auth/change-password '{"currentPassword":"x","newPassword":"NewPass123"}'
check "change-password requires auth" 401 "$STATUS"

req POST /api/auth/change-email "{\"newEmail\":\"new-$$@example.com\",\"currentPassword\":\"wrong\"}" "$LTOKEN"
check "change-email rejects a wrong password (403, not a lost session)" 403 "$STATUS" "$BODY"

req POST /api/auth/change-email "{\"newEmail\":\"$TENANT_EMAIL\",\"currentPassword\":\"$PASSWORD\"}" "$LTOKEN"
check "cannot move to an address already in use" 400 "$STATUS" "$BODY"

req POST /api/auth/change-email "{\"newEmail\":\"$LANDLORD_EMAIL\",\"currentPassword\":\"$PASSWORD\"}" "$LTOKEN"
check "cannot change to your own address" 400 "$STATUS" "$BODY"

req POST /api/auth/confirm-email-change '{"token":"invalid"}'
check "rejects an invalid confirmation token" 400 "$STATUS" "$BODY"


# -- 17b. Pausing and ending an account (Phase 7g) -------------------------
# A DEDICATED account, deliberately. Pausing $TTOKEN's tenant would hide a
# person the rest of this file still asks questions about, and a suite whose
# own setup changes the subject under a later section is how three false
# failures got into this file already.
#
# NOTE the DELETE endpoint allows ten attempts per fifteen minutes, counted in
# memory. This section spends four on refusals and never sends a valid one, so
# the drives still have a budget.
head_ "17b. Pausing and ending an account"

CLOSER_EMAIL="closer+${STAMP}@mastande.test"
req POST /api/auth/register \
  "{\"email\":\"$CLOSER_EMAIL\",\"password\":\"$PASSWORD\",\"fullName\":\"Test Closer\",\"role\":\"TENANT\"}"
check "register the account this section will pause" 201 "$STATUS" "$BODY"
CTOKEN=$(echo "$BODY" | jq -r '.accessToken // empty')

if [[ -z "$CTOKEN" ]]; then
  skipped "pausing and ending an account — no token, so nothing below could be asked"
else
  req GET /api/account/deletion-preview "" "$CTOKEN"
  check "the deletion preview answers" 200 "$STATUS" "$BODY"

  # It must name what STAYS, not only what goes. A screen promising
  # "permanently deleted" over a mechanism that keeps shared rows is the lie
  # this endpoint exists to prevent.
  if throttled "the preview names what is erased, what is KEPT and what stops"; then
    :
  elif echo "$BODY" | jq -e '(.kept | type) == "array" and (.erased | type) == "array" and (.stops | type) == "array"' >/dev/null 2>&1; then
    green "  PASS  the preview names what is erased, what is KEPT and what stops"; PASS=$((PASS+1))
  else
    red "  FAIL  the preview does not carry all three lists"; FAIL=$((FAIL+1))
    grey "        $(echo "$BODY" | head -c 300)"
  fi

  req GET /api/account/deletion-preview
  check "the preview needs a session" 401 "$STATUS"

  req DELETE /api/account '{"confirm":"DELETE","understood":true}' "$CTOKEN"
  check "closing an account without the password is refused" 400 "$STATUS" "$BODY"

  # ⚠️ 403, not 401, and the number IS the check — a 401 is read by the browser
  # as an expired token: it refreshes, retries with the same wrong password and
  # logs the person out saying their session expired.
  req DELETE /api/account '{"password":"not-the-one","confirm":"DELETE","understood":true}' "$CTOKEN"
  check "a wrong password is 403, not a lost session" 403 "$STATUS" "$BODY"

  req DELETE /api/account "{\"password\":\"$PASSWORD\",\"confirm\":\"yes\",\"understood\":true}" "$CTOKEN"
  check "the typed word has to be DELETE" 400 "$STATUS" "$BODY"

  # Absent, not false: a checkbox whose binding never fired ships as absent,
  # and @Equals(true) refuses both.
  req DELETE /api/account "{\"password\":\"$PASSWORD\",\"confirm\":\"DELETE\"}" "$CTOKEN"
  check "an absent acknowledgement is refused, not read as false" 400 "$STATUS" "$BODY"

  req POST /api/account/deactivate "" "$CTOKEN"
  check "pausing an account answers" 200 "$STATUS" "$BODY"

  # The check `isActive` could not satisfy. Pausing leaves isActive TRUE on
  # purpose, because signing in is the only way back — reusing the admin
  # suspension flag would have shipped an account nobody could reopen.
  req POST /api/auth/login "{\"email\":\"$CLOSER_EMAIL\",\"password\":\"$PASSWORD\"}"
  check "a paused person can still sign in — the only way back" 201 "$STATUS" "$BODY"
  if throttled "…and the payload says the account is paused"; then
    :
  elif echo "$BODY" | jq -e '.user.deactivatedAt != null' >/dev/null 2>&1; then
    green "  PASS  …and the payload says the account is paused, so the portal can offer to wake it"; PASS=$((PASS+1))
  else
    red "  FAIL  the sign-in payload does not say the account is paused"; FAIL=$((FAIL+1))
    grey "        $(echo "$BODY" | head -c 200)"
  fi

  req POST /api/account/reactivate "" "$CTOKEN"
  check "waking it up answers" 200 "$STATUS" "$BODY"
  # Rooms are NOT republished by waking up — one may have been let in the
  # meantime — so the count has to be reported rather than silently omitted.
  if throttled "…clears the pause and says how many rooms are still off the board"; then
    :
  elif echo "$BODY" | jq -e 'has("roomsStillPaused") and .deactivatedAt == null' >/dev/null 2>&1; then
    green "  PASS  …clears the pause and says how many rooms are still off the board"; PASS=$((PASS+1))
  else
    red "  FAIL  reactivate did not clear the pause or did not report the paused rooms"; FAIL=$((FAIL+1))
    grey "        $(echo "$BODY" | head -c 300)"
  fi
fi


# -- 17d. Inviting an applicant to a viewing (Phase 7l) --------------------
# ⚠️ The checks that matter here are about the ADDRESS. The board shows a
# suburb, not a street, and Property.addressLine's own form promises "Only you
# see this. It is never on a listing and never sent to an applicant." So the
# meeting place is typed per viewing and the guards on who may invite are the
# guards on who gets told where somebody lives.
head_ "17d. Inviting an applicant to a viewing"

if [[ -n "$APP_ID" ]]; then
  req POST "/api/applications/$APP_ID/viewings" '{"startsAt":"2099-01-01T12:00:00.000Z","meetingPlace":"The blue gate"}'
  check "inviting to a viewing requires a session" 401 "$STATUS"

  # The tenant on the application cannot invite themselves — only the landlord.
  req POST "/api/applications/$APP_ID/viewings" '{"startsAt":"2099-01-01T12:00:00.000Z","meetingPlace":"The blue gate"}' "$TTOKEN"
  check "an applicant CANNOT invite themselves to a viewing" 403 "$STATUS" "$BODY"

  req POST "/api/applications/$APP_ID/viewings" '{"startsAt":"2099-01-01T12:00:00.000Z","meetingPlace":"  "}' "$LTOKEN"
  check "an invitation with no meeting place is refused" 400 "$STATUS" "$BODY"

  req POST "/api/applications/$APP_ID/viewings" '{"startsAt":"2020-01-01T12:00:00.000Z","meetingPlace":"The blue gate"}' "$LTOKEN"
  check "a time that has already passed is refused" 400 "$STATUS" "$BODY"
else
  skipped "viewing invitations — no application id from the earlier section"
fi

req GET /api/applications/viewings/mine
check "your upcoming viewings need a session" 401 "$STATUS"

req GET /api/applications/viewings/mine "" "$TTOKEN"
check "a tenant can read their upcoming viewings" 200 "$STATUS" "$BODY"

req POST /api/applications/viewings/00000000-0000-0000-0000-000000000000/respond '{"accept":true}' "$TTOKEN"
check "answering an unknown viewing returns 404" 404 "$STATUS" "$BODY"

# -- 17c. Who to call, and what we checked (Phase 7j) ----------------------
# ⚠️ The directory had NO smoke coverage at all before this — not one check on
# the endpoints behind a screen that tells landlords these names were looked
# into. The guard and rule checks here need no admin token, deliberately: the
# rule that stops an unchecked name reaching a landlord should not be among the
# checks that only run when somebody sets an env var.
head_ "17c. Who to call, and what we checked"

req GET /api/services
check "the directory needs a session" 401 "$STATUS"

# ⚠️ BOTH body assertions sit immediately after the request they are about.
#
# The first version put "every listed provider has had their number rung" four
# requests later, so it read the 401 body from an unauthenticated POST — and its
# own `if type=="array" ... else true` guard then PASSED it. A check that cannot
# see its subject and reports success is worse than no check, and this file's
# header warns about exactly this: `req` overwrites $BODY.
req GET /api/services "" "$LTOKEN"
check "a landlord can read the directory" 200 "$STATUS" "$BODY"

# Only outcomes reach a landlord, never which admin signed somebody off.
# Same correction as the sponsorship check below, for the same reason: this one
# also reported success on any body that was not a list, and also looked only at
# the first row.
if echo "$BODY" | jq -e 'type=="array" and length>0 and (map(select(has("checkedByAdminId"))) | length) == 0' >/dev/null 2>&1; then
  green "  PASS  the directory withholds which admin signed a provider off"; PASS=$((PASS+1))
else
  red "  FAIL  the directory leaks checkedByAdminId to landlords, or did not return a list of providers"; FAIL=$((FAIL+1))
  grey "        $(echo "$BODY" | head -c 300)"
fi

# A sponsorship is not in the payload at all — Phase 7m.
#
# This asserts an ABSENT key, against the body of the request two lines up. The
# column exists and nothing reads it; it used to be selected here anyway, so a
# client-side sort was the one unguarded way to turn a directory captioned
# "names we have looked into" into a paid placement. `has` is used rather than a
# null comparison on purpose: null would pass while the field was still crossing
# the wire.
# ⚠️ Written the other way round first, and it PASSED on a 401 body: an
# `if … else false` guard sends a non-list down the else branch, which was the
# success branch. That is the third time in this repository, and the second in
# this file. So the list is REQUIRED, the row count is required, and every row
# is checked rather than only the first — a leak on row two is still a leak.
if echo "$BODY" | jq -e 'type=="array" and length>0 and (map(select(has("sponsoredUntil"))) | length) == 0' >/dev/null 2>&1; then
  green "  PASS  no sponsorship field reaches a landlord's browser"; PASS=$((PASS+1))
else
  red "  FAIL  the directory ships sponsoredUntil to landlords, or did not return a list of providers"; FAIL=$((FAIL+1))
  grey "        $(echo "$BODY" | head -c 300)"
fi

# No listed provider is without a phone check. Asserted from the landlord-facing
# list, which is the only place the claim is made — and REQUIRING an array, so a
# non-list response fails rather than being waved through.
if echo "$BODY" | jq -e 'type=="array" and (map(select(.phoneConfirmedAt == null)) | length) == 0' >/dev/null 2>&1; then
  green "  PASS  every listed provider has had their number rung"; PASS=$((PASS+1))
else
  red "  FAIL  a listed provider has no recorded phone check, or the directory did not return a list"; FAIL=$((FAIL+1))
  grey "        $(echo "$BODY" | head -c 300)"
fi

# The admin list is GET services/admin/all, not services/admin — the first
# version used the latter and got a 404 the check reported as a missing guard.
req GET /api/services/admin/all "" "$LTOKEN"
check "a landlord CANNOT read the admin directory" 403 "$STATUS" "$BODY"

req POST /api/services/admin '{"category":"plumber","name":"Not allowed","phone":"082 000 0000","areas":["Tembisa"]}' "$LTOKEN"
check "a landlord CANNOT add a tradesperson" 403 "$STATUS" "$BODY"

req POST /api/services/admin '{"category":"plumber","name":"Unauthenticated","phone":"082 000 0000","areas":["Tembisa"]}'
check "adding a tradesperson requires auth" 401 "$STATUS"

# ── Contractor lead fees (Phase 7k) ───────────────────────────────────────
# ⚠️ NOTHING in this product collects money from a contractor, and these checks
# are how that stays true. A contractor is not a user — no userId, no email — so
# they cannot sign in, see a bill, accept terms or dispute a charge. The product
# keeps the record; invoicing happens outside it, by a person.
#
# The guards need no admin token, deliberately.
req POST "/api/services/$ROOM_ID/lead" '{"channel":"call"}'
check "recording a lead requires a session" 401 "$STATUS"

req GET /api/services/admin/leads "" "$LTOKEN"
check "a landlord CANNOT read the lead summary" 403 "$STATUS" "$BODY"

req POST /api/services/admin/lead-rates '{"category":"plumber","amountCents":100,"effectiveFrom":"2026-01-01T00:00:00.000Z"}' "$LTOKEN"
check "a landlord CANNOT set a lead fee" 403 "$STATUS" "$BODY"

# There is no route anywhere that takes a payment for leads. If somebody adds
# one, these fail and they have to come and change a check that says why.
for leadroute in pay invoice checkout charge; do
  req POST "/api/services/admin/leads/$leadroute" '{}' "$LTOKEN"
  check "there is no /services/admin/leads/$leadroute route" 404 "$STATUS"
done

if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  req POST /api/services/admin '{"category":"plumber","name":"Smoke Unchecked","phone":"082 111 2222","areas":["Tembisa"],"active":true}' "$ADMIN_TOKEN"
  check "a provider cannot be listed before the number is rung" 400 "$STATUS" "$BODY"

  req GET /api/services/admin/leads "" "$ADMIN_TOKEN"
  check "an admin can read what the leads come to" 200 "$STATUS" "$BODY"
  # The disclaimer is in the PAYLOAD, so an export cannot drift from the screen.
  if echo "$BODY" | jq -e '.disclaimer | test("has been invoiced or paid"; "i")' >/dev/null 2>&1; then
    green "  PASS  the summary says in its own payload that nothing was invoiced or paid"; PASS=$((PASS+1))
  else
    red "  FAIL  the lead summary carries no disclaimer — an export could read the figure as an amount owed"; FAIL=$((FAIL+1))
    grey "        $(echo "$BODY" | head -c 300)"
  fi

  req POST /api/services/admin/lead-rates '{"category":"plumber","amountCents":-500,"effectiveFrom":"2026-01-01T00:00:00.000Z"}' "$ADMIN_TOKEN"
  check "a negative lead fee is refused — that is a mistake, not a price" 400 "$STATUS" "$BODY"

  # Selling a placement that does not exist — Phase 7m.
  #
  # This returned 200 and stored the date until this phase, so an admin could
  # record a sponsorship, be told it worked, and have nothing happen. The 400
  # comes from forbidNonWhitelisted now that the field is off both DTOs, which
  # is the point: a write with no reader fails loudly rather than quietly.
  req POST /api/services/admin '{"category":"cleaner","name":"Smoke Sponsored","phone":"082 111 3333","areas":["Tembisa"],"phoneConfirmedAt":"2026-09-18T10:00:00.000Z","sponsoredUntil":"2027-12-31T00:00:00.000Z"}' "$ADMIN_TOKEN"
  check "a sponsorship cannot be recorded for a placement that does not exist" 400 "$STATUS" "$BODY"
else
  skipped "the publish rule and the lead summary — set ADMIN_TOKEN to include them"
fi

# -- 17e. A phone-only account can be looked after (Phase 7o) --------------
head_ "17e. A phone-only account"

# ⚠️ These do NOT create a phone-only account. A code only goes out over
# WhatsApp, which is not connected here, so making one needs the database and
# the API's own JWT_SECRET — that is scripts/phone-only-drive.mjs, and it is
# where the behaviour is actually proven. What is checkable from here is that
# the new surface exists, is guarded, and that an ordinary account was not
# broken by the guard added for phone-only ones.

req POST /api/auth/phone/change/request-code '{"newPhone":"0829876543"}'
check "changing a number needs a session" 401 "$STATUS" "$BODY"

req POST /api/auth/phone/change/confirm '{"code":"123456"}'
check "confirming a number change needs a session" 401 "$STATUS" "$BODY"

# The route EXISTS. A 404 here would mean the whole flow is unreachable and the
# two 401s above would be passing on a missing route — which is how a dead
# control passes a guard check.
if [[ "$STATUS" != "404" ]]; then
  green "  PASS  …and both routes exist rather than answering 404"; PASS=$((PASS+1))
else
  red "  FAIL  /auth/phone/change/confirm is a 404 — the 401s above prove nothing"; FAIL=$((FAIL+1))
fi

# `hasPassword` reaches the browser, because the settings screen branches on it
# and defaults a missing value to "yes, it has one". Absent, a phone-only
# account is shown a Current password box again.
req GET /api/auth/me "" "$LTOKEN"
if echo "$BODY" | jq -e 'has("hasPassword")' >/dev/null 2>&1; then
  green "  PASS  /auth/me says whether the account has a password"; PASS=$((PASS+1))
else
  red "  FAIL  /auth/me carries no hasPassword — the settings screen has to guess"; FAIL=$((FAIL+1))
  grey "        $(echo "$BODY" | head -c 200)"
fi
# And never the hash itself.
if echo "$BODY" | jq -e 'has("passwordHash")' >/dev/null 2>&1; then
  red "  FAIL  /auth/me ships the password hash"; FAIL=$((FAIL+1))
else
  green "  PASS  …and never the hash"; PASS=$((PASS+1))
fi

# The guard added for phone-only accounts must not touch an ordinary one. This
# account has an email and a password, so its number is not the only way in and
# clearing it is still its own business.
req PATCH /api/users/me '{"phone":""}' "$LTOKEN"
check "an account with an email can still clear its number" 200 "$STATUS" "$BODY"

# -- 17f. Assisted sign-up (Phase 7p) --------------------------------------
head_ "17f. Assisted sign-up"

# ⚠️ These cannot complete an assisted sign-up: the code goes out over WhatsApp
# and recovering it needs the database and the API's own JWT_SECRET. That is
# scripts/assisted-signup-drive.mjs, where the consent rule is actually proven.
# What is checkable here is who may start one, and — the control that matters —
# that the reply hands the starter nothing they could finish with alone.

req POST /api/admin/phone-signups/assisted '{"phone":"0821234567"}'
check "a stranger cannot start a sign-up in somebody else's name" 401 "$STATUS" "$BODY"

req POST /api/admin/phone-signups/assisted '{"phone":"0821234567"}' "$LTOKEN"
check "nor can an ordinary signed-in landlord" 403 "$STATUS" "$BODY"

req GET /api/admin/phone-signups/assisted/mine "" "$LTOKEN"
check "nor read what anybody has started" 403 "$STATUS" "$BODY"

# A 404 here would mean the whole surface is unreachable and the guards above
# are passing on missing routes — a dead control clearing a guard check.
if [[ "$STATUS" != "404" ]]; then
  green "  PASS  …and the routes exist rather than answering 404"; PASS=$((PASS+1))
else
  red "  FAIL  /admin/phone-signups/assisted/mine is a 404 — the guards above prove nothing"; FAIL=$((FAIL+1))
fi

if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  SMOKE_ASSIST="08215$(( RANDOM % 90000 + 10000 ))"
  SMOKE_ASSIST="${SMOKE_ASSIST:0:10}"
  req POST /api/admin/phone-signups/assisted "{\"phone\":\"$SMOKE_ASSIST\"}" "$ADMIN_TOKEN"
  check "an admin can start one" 200 "$STATUS" "$BODY"

  # ⚠️ The control. An admin handed the code or a ticket could create an
  # account in somebody else's name and tick the Terms for them.
  if echo "$BODY" | jq -e 'has("code") or has("ticket")' >/dev/null 2>&1; then
    red "  FAIL  the assisted reply hands the admin a code or a ticket — they could finish without the person"; FAIL=$((FAIL+1))
    grey "        $(echo "$BODY" | head -c 200)"
  else
    green "  PASS  …and is handed no code and no ticket"; PASS=$((PASS+1))
  fi
  # Six consecutive digits anywhere in the body would be a code under another
  # key name, which `has()` cannot see.
  if echo "$BODY" | jq -r '.message // ""' | grep -qE '\b[0-9]{6}\b'; then
    red "  FAIL  the assisted reply contains six consecutive digits — likely the code"; FAIL=$((FAIL+1))
  else
    green "  PASS  …and no six-digit code appears in the message either"; PASS=$((PASS+1))
  fi
  if echo "$BODY" | jq -e '.theyMustAccept | test("accept the Terms"; "i")' >/dev/null 2>&1; then
    green "  PASS  …and the payload itself says the person must accept the Terms"; PASS=$((PASS+1))
  else
    red "  FAIL  nothing in the reply says the acceptance is the person's"; FAIL=$((FAIL+1))
  fi

  req GET /api/admin/phone-signups/assisted/mine "" "$ADMIN_TOKEN"
  check "an admin can read back what they started" 200 "$STATUS" "$BODY"
  if echo "$BODY" | jq -e 'type=="array" and length>0 and (map(select(.theyAcceptedAt != null and .becameAnAccount == false)) | length) == 0' >/dev/null 2>&1; then
    green "  PASS  …and nothing claims acceptance without an account to show for it"; PASS=$((PASS+1))
  else
    red "  FAIL  a record claims acceptance with no account, or the list is not an array"; FAIL=$((FAIL+1))
    grey "        $(echo "$BODY" | head -c 300)"
  fi
else
  skipped "starting an assisted sign-up — set ADMIN_TOKEN to include it"
fi

# -- 17g. Handing an account back when the phone is gone (Phase 7q) --------
head_ "17g. Lost-number recovery"

# ⚠️ This cannot complete a recovery: the code goes out over WhatsApp and
# recovering it needs the database and the API's own JWT_SECRET. That is
# scripts/lost-number-drive.mjs, which also tests the CHECK constraints
# directly — one of them turned out to pass on NULL. What is checkable from
# here is who may touch it at all, and that the narrowing exists.

req POST /api/admin/recoveries '{"phone":"0821234567","newPhone":"0829876543"}'
check "a stranger cannot open a hand-over" 401 "$STATUS" "$BODY"

req POST /api/admin/recoveries '{"phone":"0821234567","newPhone":"0829876543"}' "$LTOKEN"
check "nor can an ordinary signed-in landlord" 403 "$STATUS" "$BODY"

req GET /api/admin/recoveries "" "$LTOKEN"
check "nor read the queue" 403 "$STATUS" "$BODY"

req GET "/api/admin/recoveries/lookup?phone=0821234567" "" "$LTOKEN"
check "nor look an account up by its number" 403 "$STATUS" "$BODY"

# A 404 would mean the guards above are passing on missing routes.
if [[ "$STATUS" != "404" ]]; then
  green "  PASS  …and the routes exist rather than answering 404"; PASS=$((PASS+1))
else
  red "  FAIL  /admin/recoveries/lookup is a 404 — the guards above prove nothing"; FAIL=$((FAIL+1))
fi

# The public half: the one route the person recovering uses. It must exist and
# must not be a way to probe which numbers are mid-recovery.
req POST /api/auth/lost-number/confirm '{"phone":"0829876543","code":"000000"}'
check "the public confirm route exists and refuses a made-up code" 400 "$STATUS" "$BODY"
if echo "$BODY" | jq -e '.message | test("wrong or has expired"; "i")' >/dev/null 2>&1; then
  green "  PASS  …with the same sentence whichever way it failed"; PASS=$((PASS+1))
else
  red "  FAIL  the refusal distinguishes 'no request' from 'wrong code' — that says whose account is mid-recovery"; FAIL=$((FAIL+1))
  grey "        $(echo "$BODY" | head -c 200)"
fi

if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  # ⚠️ The narrowing. The landlord account this suite uses has an email AND a
  # password, so the dangerous path must refuse it and name the safer one.
  req GET "/api/admin/recoveries/lookup?phone=0821234567" "" "$ADMIN_TOKEN"
  check "an admin can look a number up" 200 "$STATUS" "$BODY"

  req GET /api/admin/recoveries "" "$ADMIN_TOKEN"
  check "…and read the queue" 200 "$STATUS" "$BODY"
  if echo "$BODY" | jq -e 'type=="array"' >/dev/null 2>&1; then
    green "  PASS  …as a list"; PASS=$((PASS+1))
  else
    red "  FAIL  the recovery queue is not a list"; FAIL=$((FAIL+1))
  fi

  # Only outcomes persist: no column for the document itself, ever.
  if echo "$BODY" | jq -e '(map(select(has("documentPath") or has("idDocumentPath"))) | length) == 0' >/dev/null 2>&1; then
    green "  PASS  …and carries no document path — only outcomes persist"; PASS=$((PASS+1))
  else
    red "  FAIL  the recovery queue carries a document path; a stored ID outlives its use"; FAIL=$((FAIL+1))
  fi
else
  skipped "the admin half of lost-number recovery — set ADMIN_TOKEN to include it"
fi

# -- 18. Safety reports ----------------------------------------------------
head_ "18. Safety reports"
if [[ -n "$ROOM_ID" ]]; then
  # Anonymous reporting is deliberate: requiring an account suppresses exactly
  # the reports worth having.
  req POST /api/reports "{\"roomId\":\"$ROOM_ID\",\"reason\":\"upfront_payment_demanded\",\"details\":\"They asked for a R2000 deposit via EFT before letting me view the room.\",\"contactEmail\":\"worried@example.co.za\"}"
  check "signed-out visitor can report" 201 "$STATUS" "$BODY"

  req POST /api/reports "{\"roomId\":\"$ROOM_ID\",\"reason\":\"misleading_details\",\"details\":\"The advertised rent does not match what the landlord told me on the phone.\"}" "$TTOKEN"
  check "signed-in tenant can report" 201 "$STATUS" "$BODY"

  req POST /api/reports "{\"roomId\":\"$ROOM_ID\",\"reason\":\"other\",\"details\":\"too short\",\"contactEmail\":\"a@b.co\"}"
  check "rejects details that are too short" 400 "$STATUS" "$BODY"

  req POST /api/reports "{\"roomId\":\"$ROOM_ID\",\"reason\":\"not_a_real_listing\",\"details\":\"These photos appear on another listing in a different city entirely.\"}"
  check "anonymous report requires a contact email" 400 "$STATUS" "$BODY"

  req POST /api/reports '{"reason":"other","details":"Something is wrong but I have not said what with.","contactEmail":"a@b.co"}'
  check "rejects a report with no subject" 400 "$STATUS" "$BODY"

  req POST /api/reports "{\"roomId\":\"$ROOM_ID\",\"reason\":\"nonsense\",\"details\":\"A valid length of detail goes here for the test.\",\"contactEmail\":\"a@b.co\"}"
  check "rejects an unknown reason" 400 "$STATUS" "$BODY"
fi

req GET /api/reports "" "$TTOKEN"
check "tenant CANNOT read the report queue" 403 "$STATUS" "$BODY"

req GET /api/reports "" "$LTOKEN"
check "landlord CANNOT read the report queue" 403 "$STATUS" "$BODY"

req GET /api/reports
check "report queue requires auth" 401 "$STATUS"


# -- 19. Public pages ------------------------------------------------------
head_ "19. Public pages"
# Served by the frontend, not the API — checked here so a broken prerender is
# caught by the same run rather than discovered in the browser.
FE="${FRONTEND_URL:-http://localhost:4200}"
for path in "/how-it-works" "/pricing" "/advertise"; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$FE$path" 2>/dev/null || echo "000")
  if [[ "$CODE" == "200" ]]; then
    green "  PASS  $path renders  (200)"; PASS=$((PASS+1))
  elif [[ "$CODE" =~ ^0+$ ]]; then
    # curl reports 000 (sometimes repeated on retries) when it cannot connect.
    skipped "$path — frontend not running at $FE"
  else
    red "  FAIL  $path returned $CODE"; FAIL=$((FAIL+1))
  fi
done

# Admin pages are guarded and client-rendered. An unauthenticated request must
# NOT be served the page — a redirect is the correct answer, and a 200 here
# would mean the portal is publicly reachable.
for path in "/admin/dashboard" "/admin/advertising"; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$FE$path" 2>/dev/null || echo "000")
  if [[ "$CODE" =~ ^0+$ ]]; then
    skipped "$path — frontend not running at $FE"
  elif [[ "$CODE" == "200" ]]; then
    # Angular serves the app shell for client-rendered routes; adminGuard then
    # redirects in the browser. Either shape is acceptable, so this only fails
    # if the page itself renders admin content, which it cannot without a token.
    green "  PASS  $path serves the app shell, guard runs client-side"; PASS=$((PASS+1))
  else
    green "  PASS  $path is not publicly served  ($CODE)"; PASS=$((PASS+1))
  fi
done


# -- 20. Tenancies ---------------------------------------------------------
# The record reviews will hang off. The lifecycle is confirmed rather than
# automatic, so most of what matters here is what is NOT allowed.
head_ "20. Tenancies"
req GET /api/tenancies/mine "" "$TTOKEN"
check "tenant lists own tenancies" 200 "$STATUS" "$BODY"

req GET /api/tenancies/mine
check "tenancies require auth" 401 "$STATUS"

req GET /api/tenancies/reviewable "" "$LTOKEN"
check "reviewable list loads" 200 "$STATUS" "$BODY"

# Accepting an application should have opened a pending tenancy.
req POST /api/rooms "$ROOM_JSON" "$LTOKEN"
TEN_ROOM=$(echo "$BODY" | jq -r '.id // empty')
if [[ -n "$TEN_ROOM" ]]; then
  req PATCH "/api/rooms/$TEN_ROOM" '{"heroImagePath":"/smoke-test-placeholder.jpg"}' "$LTOKEN"
  req POST "/api/rooms/$TEN_ROOM/publish" "" "$LTOKEN"
  req POST /api/applications "{\"roomId\":\"$TEN_ROOM\",\"coverNote\":\"Would love this room.\"}" "$TTOKEN"
  TEN_APP=$(echo "$BODY" | jq -r '.id // empty')

  if [[ -n "$TEN_APP" ]]; then
    req POST "/api/applications/$TEN_APP/accept" "" "$LTOKEN"
    check "landlord accepts the application" 200 "$STATUS" "$BODY"

    sleep 1   # the tenancy is opened without blocking the response
    req GET /api/tenancies/mine "" "$TTOKEN"
    TEN_ID=$(echo "$BODY" | jq -r --arg r "$TEN_ROOM" '[.[]? | select(.roomId==$r)][0].id // empty')
    TEN_STATUS=$(echo "$BODY" | jq -r --arg r "$TEN_ROOM" '[.[]? | select(.roomId==$r)][0].status // empty')

    if [[ -n "$TEN_ID" ]]; then
      green "  PASS  accepting opened a tenancy"; PASS=$((PASS+1))
      if [[ "$TEN_STATUS" == "pending" ]]; then
        green "  PASS  it starts pending, not active"; PASS=$((PASS+1))
      else
        red "  FAIL  new tenancy status is '$TEN_STATUS', expected pending"; FAIL=$((FAIL+1))
      fi

      req POST "/api/tenancies/$TEN_ID/end" '{}' "$TTOKEN"
      check "cannot end a tenancy that never started" 400 "$STATUS" "$BODY"

      req POST "/api/tenancies/$TEN_ID/confirm-start" '{}' "$ITOKEN"
      check "outsider CANNOT confirm a tenancy" 403 "$STATUS" "$BODY"

      req POST "/api/tenancies/$TEN_ID/confirm-start" '{"startDate":"2099-01-01"}' "$TTOKEN"
      check "rejects a future move-in date" 400 "$STATUS" "$BODY"

      req POST "/api/tenancies/$TEN_ID/confirm-start" '{}' "$TTOKEN"
      check "tenant confirms move-in" 200 "$STATUS" "$BODY"

      req POST "/api/tenancies/$TEN_ID/cancel" '{}' "$TTOKEN"
      check "cannot cancel once active" 400 "$STATUS" "$BODY"

      req POST "/api/tenancies/$TEN_ID/end" '{"reason":"Moved closer to work"}' "$LTOKEN"
      check "landlord ends the tenancy" 200 "$STATUS" "$BODY"

      CLOSES=$(echo "$BODY" | jq -r '.reviewsCloseAt // empty')
      if [[ -n "$CLOSES" ]]; then
        green "  PASS  ending opened a review window"; PASS=$((PASS+1))
      else
        red "  FAIL  no review window set on ending"; FAIL=$((FAIL+1))
      fi

      req POST "/api/tenancies/$TEN_ID/end" '{}' "$LTOKEN"
      check "cannot end twice" 400 "$STATUS" "$BODY"

      req GET /api/tenancies/reviewable "" "$TTOKEN"
      OWED=$(echo "$BODY" | jq -r --arg id "$TEN_ID" '[.[]? | select(.tenancy.id==$id)][0].outstanding | length')
      if [[ "$OWED" == "2" ]]; then
        green "  PASS  tenant owes 2 reviews (room and landlord)"; PASS=$((PASS+1))
      else
        red "  FAIL  tenant owes '$OWED' reviews, expected 2"; FAIL=$((FAIL+1))
      fi

      req GET /api/tenancies/reviewable "" "$LTOKEN"
      LOWED=$(echo "$BODY" | jq -r --arg id "$TEN_ID" '[.[]? | select(.tenancy.id==$id)][0].outstanding | length')
      if [[ "$LOWED" == "1" ]]; then
        green "  PASS  landlord owes 1 review (the tenant)"; PASS=$((PASS+1))
      else
        red "  FAIL  landlord owes '$LOWED' reviews, expected 1"; FAIL=$((FAIL+1))
      fi
    else
      red "  FAIL  accepting did not open a tenancy"; FAIL=$((FAIL+1))
    fi
  fi
fi


# -- 21. Reviews -----------------------------------------------------------
# The interesting assertions are the negative ones: double-blind holding, and
# that tenant reviews are references rather than a public record.
head_ "21. Reviews"
if [[ -n "${TEN_ID:-}" ]]; then
  req POST /api/reviews "{\"tenancyId\":\"$TEN_ID\",\"type\":\"tenant\",\"rating\":5,\"comment\":\"Paid on time every month and left the room spotless.\"}" "$TTOKEN"
  check "tenant CANNOT write the tenant review" 400 "$STATUS" "$BODY"

  req POST /api/reviews "{\"tenancyId\":\"$TEN_ID\",\"type\":\"room\",\"rating\":4,\"comment\":\"Good\"}" "$TTOKEN"
  check "rejects a too-short comment" 400 "$STATUS" "$BODY"

  req POST /api/reviews "{\"tenancyId\":\"$TEN_ID\",\"type\":\"room\",\"rating\":9,\"comment\":\"Rating is out of range but long enough to pass length.\"}" "$TTOKEN"
  check "rejects a rating outside 1-5" 400 "$STATUS" "$BODY"

  req POST /api/reviews "{\"tenancyId\":\"$TEN_ID\",\"type\":\"room\",\"rating\":4,\"comment\":\"Bright room, good water pressure, quiet street. Housemates were easy to live with.\"}" "$TTOKEN"
  check "tenant writes the room review" 201 "$STATUS" "$BODY"
  ROOM_REVIEW=$(echo "$BODY" | jq -r '.id // empty')

  req POST /api/reviews "{\"tenancyId\":\"$TEN_ID\",\"type\":\"room\",\"rating\":5,\"comment\":\"Trying to write the same review a second time to check it is refused.\"}" "$TTOKEN"
  check "cannot write the same review twice" 400 "$STATUS" "$BODY"

  # Double-blind: nothing is public until both sides are done.
  req GET "/api/reviews/room/$TEN_ROOM"
  VISIBLE=$(echo "$BODY" | jq -r 'length')
  if [[ "$VISIBLE" == "0" ]]; then
    green "  PASS  review held — not published while the other side is outstanding"; PASS=$((PASS+1))
  else
    red "  FAIL  review published early ($VISIBLE visible) — double-blind broken"; FAIL=$((FAIL+1))
  fi

  req POST /api/reviews "{\"tenancyId\":\"$TEN_ID\",\"type\":\"landlord\",\"rating\":5,\"comment\":\"Responsive landlord, fixed the geyser within a day of reporting it.\"}" "$TTOKEN"
  check "tenant writes the landlord review" 201 "$STATUS" "$BODY"

  req POST /api/reviews "{\"tenancyId\":\"$TEN_ID\",\"type\":\"tenant\",\"rating\":5,\"comment\":\"Reliable tenant, always paid on time and communicated well.\"}" "$LTOKEN"
  check "landlord writes the tenant review" 201 "$STATUS" "$BODY"

  # Both sides done — everything should now be released together.
  req GET "/api/reviews/room/$TEN_ROOM"
  VISIBLE=$(echo "$BODY" | jq -r 'length')
  if [[ "$VISIBLE" == "1" ]]; then
    green "  PASS  reviews released once both sides submitted"; PASS=$((PASS+1))
  else
    red "  FAIL  expected 1 published room review, found $VISIBLE"; FAIL=$((FAIL+1))
  fi

  # The tenant review must NOT be public anywhere.
  if [[ -n "$TENANT_ID" ]]; then
    req GET "/api/reviews/landlord/$TENANT_ID"
    PUBLIC_TENANT=$(echo "$BODY" | jq -r 'length' 2>/dev/null || echo 0)
    if [[ "$PUBLIC_TENANT" == "0" ]]; then
      green "  PASS  tenant review is not publicly listed"; PASS=$((PASS+1))
    else
      red "  FAIL  tenant review is publicly visible"; FAIL=$((FAIL+1))
    fi

    # This landlord DOES have a live application from this tenant (section 11
    # re-applied after a relist), so references are legitimately available.
    req GET "/api/reviews/tenant/$TENANT_ID/references" "" "$LTOKEN"
    check "landlord with a live application CAN see references" 200 "$STATUS" "$BODY"

    # The real restriction: a different landlord, with no application from this
    # person, must not be able to look them up.
    OTHER_LL="landlord2+${STAMP}@mastande.test"
    req POST /api/auth/register \
      "{\"email\":\"$OTHER_LL\",\"password\":\"$PASSWORD\",\"fullName\":\"Second Landlord\",\"role\":\"LANDLORD\"}"
    OTHER_LTOKEN=$(echo "$BODY" | jq -r '.accessToken // empty')

    if [[ -n "$OTHER_LTOKEN" ]]; then
      req GET "/api/reviews/tenant/$TENANT_ID/references" "" "$OTHER_LTOKEN"
      check "unrelated landlord CANNOT look up references" 403 "$STATUS" "$BODY"
    fi

    req GET "/api/reviews/tenant/$TENANT_ID/references" "" "$TTOKEN"
    check "tenant CANNOT read references about themselves this way" 403 "$STATUS" "$BODY"
  fi

  req GET /api/reviews/mine "" "$TTOKEN"
  check "tenant sees their own reviews" 200 "$STATUS" "$BODY"
fi


# -- 22. Profile settings --------------------------------------------------
head_ "22. Profile settings"
req PATCH /api/users/me '{"fullName":"Renamed Landlord"}' "$LTOKEN"
check "update own name" 200 "$STATUS" "$BODY"
NEWNAME=$(echo "$BODY" | jq -r '.fullName')
if [[ "$NEWNAME" == "Renamed Landlord" ]]; then
  green "  PASS  the change persisted"; PASS=$((PASS+1))
else
  red "  FAIL  name came back as '$NEWNAME'"; FAIL=$((FAIL+1))
fi

req PATCH /api/users/me '{"phone":"0821234567"}' "$LTOKEN"
check "set a valid SA mobile number" 200 "$STATUS" "$BODY"

req PATCH /api/users/me '{"phone":"12345"}' "$LTOKEN"
check "rejects a malformed phone number" 400 "$STATUS" "$BODY"

req PATCH /api/users/me '{"phone":""}' "$LTOKEN"
check "empty string clears the number" 200 "$STATUS" "$BODY"

req PATCH /api/users/me '{"fullName":"X"}' "$LTOKEN"
check "rejects a one-character name" 400 "$STATUS" "$BODY"

# Email and password must not be changeable through the profile endpoint —
# both require the current password and email needs confirmation.
req PATCH /api/users/me "{\"email\":\"hijack+${STAMP}@mastande.test\"}" "$LTOKEN"
check "cannot change email via the profile endpoint" 400 "$STATUS" "$BODY"

req PATCH /api/users/me '{"role":"ADMIN"}' "$TTOKEN"
check "cannot escalate role via the profile endpoint" 400 "$STATUS" "$BODY"

req PATCH /api/users/me '{"fullName":"Nobody"}'
check "profile update requires auth" 401 "$STATUS"

# -- 23. Verified badge data ------------------------------------------------
# The badge on a room card reads landlord.landlordProfile.idVerified, so the
# public list must actually carry that field or the badge can never render.
head_ "23. Verified badge data"
req GET /api/rooms
if echo "$BODY" | jq -e '.data[0].landlord.landlordProfile' >/dev/null 2>&1; then
  green "  PASS  room list includes landlordProfile (badge can render)"; PASS=$((PASS+1))
else
  red "  FAIL  room list has no landlordProfile — the verified badge cannot render"; FAIL=$((FAIL+1))
  grey "        $(echo "$BODY" | jq -c '.data[0].landlord // "no landlord"' 2>/dev/null | head -c 200)"
fi

# jq's // operator treats false as empty, so `.idVerified // "missing"` reports
# an unverified landlord as missing. Test for the key instead of its value.
if echo "$BODY" | jq -e '.data[0].landlord.landlordProfile | has("idVerified")' >/dev/null 2>&1; then
  VERIFIED=$(echo "$BODY" | jq -r '.data[0].landlord.landlordProfile.idVerified')
  green "  PASS  idVerified present on the public payload ($VERIFIED)"; PASS=$((PASS+1))
else
  red "  FAIL  idVerified absent — the verified badge cannot render"; FAIL=$((FAIL+1))
  grey "        $(echo "$BODY" | jq -c '.data[0].landlord.landlordProfile' 2>/dev/null | head -c 200)"
fi


# -- 24. Email lifecycle ---------------------------------------------------
head_ "24. Email lifecycle"
req GET /api/notifications/my-emails "" "$LTOKEN"
check "user can read their own email log (POPIA s.23)" 200 "$STATUS" "$BODY"

# Registration and the application flow above should have produced entries.
LOGGED=$(echo "$BODY" | jq -r 'length')
if [[ "$LOGGED" -gt 0 ]]; then
  green "  PASS  emails are being logged ($LOGGED entries)"; PASS=$((PASS+1))
else
  skipped "no email log entries yet for this account"
fi

req GET /api/notifications/my-emails
check "email log requires auth" 401 "$STATUS"

req GET /api/notifications/admin/failures "" "$LTOKEN"
check "non-admin CANNOT read delivery failures" 403 "$STATUS" "$BODY"

# Marketing consent is what the unsubscribe footer links to.
req PATCH /api/users/me '{"marketingEmails":false}' "$TTOKEN"
check "tenant can opt out of marketing" 200 "$STATUS" "$BODY"
OPTED=$(echo "$BODY" | jq -r '.marketingEmails')
if [[ "$OPTED" == "false" ]]; then
  green "  PASS  opt-out persisted"; PASS=$((PASS+1))
else
  red "  FAIL  marketingEmails came back as '$OPTED'"; FAIL=$((FAIL+1))
fi

req PATCH /api/users/me '{"marketingEmails":true}' "$TTOKEN"
check "tenant can opt back in" 200 "$STATUS" "$BODY"

# The Resend webhook. This used to accept 200 OR 400 and call it a pass, which
# meant it passed just as happily against the version that never verified the
# signature at all — it only ever proved the endpoint answered. The assertions
# below check what actually matters: that a forged event cannot suppress an
# address.
#
# The three states are all real deployments, so all three are checked:
#   no secret set    -> 503, refuse to act rather than trust an unsigned event
#   secret, no sig   -> 400
#   secret, good sig -> 200
WEBHOOK_BODY='{"type":"email.bounced","data":{"to":["nobody@example.test"]}}'

if [[ -z "${RESEND_WEBHOOK_SECRET:-}" ]]; then
  # Without the secret here, this script cannot know which of the two the API
  # was started with, so it asserts the property common to both: an unsigned
  # event is never acted on. 200 is the failure — that is the old behaviour.
  req POST /api/notifications/webhook/resend "$WEBHOOK_BODY"
  case "$STATUS" in
    503) green "  PASS  webhook refuses an unsigned event — no secret configured  (503)"; PASS=$((PASS+1)) ;;
    400) green "  PASS  webhook refuses an unsigned event — signature required  (400)"; PASS=$((PASS+1)) ;;
    *)   red "  FAIL  unsigned webhook returned $STATUS; 400 or 503 expected, never 200"; FAIL=$((FAIL+1)) ;;
  esac
  skipped "signature verification — set RESEND_WEBHOOK_SECRET to the API's own to include it"
else
  req POST /api/notifications/webhook/resend "$WEBHOOK_BODY"
  if [[ "$STATUS" == "400" ]]; then
    green "  PASS  webhook rejects an unsigned event  (400)"; PASS=$((PASS+1))
  else
    red "  FAIL  unsigned webhook returned $STATUS, expected 400"; FAIL=$((FAIL+1))
  fi

  # Svix signs `${id}.${timestamp}.${body}` with the base64-decoded secret.
  # od rather than xxd: xxd is not installed on every runner.
  SVIX_ID="msg_smoke_$$"
  SVIX_TS=$(date +%s)
  HEXKEY=$(printf '%s' "${RESEND_WEBHOOK_SECRET#whsec_}" | base64 -d | od -An -tx1 | tr -d ' \n')
  GOOD_SIG="v1,$(printf '%s' "$SVIX_ID.$SVIX_TS.$WEBHOOK_BODY" \
    | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$HEXKEY" -binary | base64 | tr -d '\n')"

  TAMPERED_SIG="v1,$(printf '%s' "$SVIX_ID.$SVIX_TS.${WEBHOOK_BODY/nobody/victim}" \
    | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$HEXKEY" -binary | base64 | tr -d '\n')"
  SW_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/notifications/webhook/resend" \
    -H 'Content-Type: application/json' -H "svix-id: $SVIX_ID" -H "svix-timestamp: $SVIX_TS" \
    -H "svix-signature: $TAMPERED_SIG" -d "$WEBHOOK_BODY" 2>/dev/null)
  if [[ "$SW_STATUS" == "400" ]]; then
    green "  PASS  webhook rejects a signature computed over a different body  (400)"; PASS=$((PASS+1))
  else
    red "  FAIL  mismatched signature returned $SW_STATUS, expected 400"; FAIL=$((FAIL+1))
  fi

  SW_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/notifications/webhook/resend" \
    -H 'Content-Type: application/json' -H "svix-id: $SVIX_ID" -H "svix-timestamp: $SVIX_TS" \
    -H "svix-signature: $GOOD_SIG" -d "$WEBHOOK_BODY" 2>/dev/null)
  if [[ "$SW_STATUS" == "200" ]]; then
    green "  PASS  webhook accepts a correctly signed event  (200)"; PASS=$((PASS+1))
  else
    red "  FAIL  correctly signed webhook returned $SW_STATUS, expected 200"; FAIL=$((FAIL+1))
  fi

  # And the suppression actually happened, which is the point of the endpoint.
  if [[ "$SW_STATUS" == "200" ]]; then
    OLD_TS=$((SVIX_TS - 600))
    OLD_SIG="v1,$(printf '%s' "$SVIX_ID.$OLD_TS.$WEBHOOK_BODY" \
      | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$HEXKEY" -binary | base64 | tr -d '\n')"
    SW_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/notifications/webhook/resend" \
      -H 'Content-Type: application/json' -H "svix-id: $SVIX_ID" -H "svix-timestamp: $OLD_TS" \
      -H "svix-signature: $OLD_SIG" -d "$WEBHOOK_BODY" 2>/dev/null)
    if [[ "$SW_STATUS" == "400" ]]; then
      green "  PASS  a correctly signed but ten-minute-old event is refused  (400)"; PASS=$((PASS+1))
    else
      red "  FAIL  replayed webhook returned $SW_STATUS, expected 400"; FAIL=$((FAIL+1))
    fi
  fi
fi


# -- 25. Verification payment ----------------------------------------------
# The security-critical assertions are the negative ones: a forged ITN must not
# mark anything paid, and an unpaid request must not reach the review queue.
head_ "25. Verification payment"
req POST /api/verification '{"type":"identity","documentPath":"private/verification/pay-test.jpg"}' "$LTOKEN"
if [[ "$STATUS" == "201" ]]; then
  PAY_VR=$(echo "$BODY" | jq -r '.id // empty')
  VR_STATUS=$(echo "$BODY" | jq -r '.status')
  if [[ "$VR_STATUS" == "pending_payment" ]]; then
    green "  PASS  identity request starts as pending_payment"; PASS=$((PASS+1))
  else
    red "  FAIL  identity request status is '$VR_STATUS', expected pending_payment"; FAIL=$((FAIL+1))
  fi
else
  skipped "landlord already has an identity request from an earlier section"
  PAY_VR=""
fi

if [[ -n "$PAY_VR" ]]; then
  req POST "/api/payments/verification/$PAY_VR" "" "$TTOKEN"
  check "tenant CANNOT start a landlord payment" 403 "$STATUS" "$BODY"

  req POST "/api/payments/verification/$PAY_VR" "" "$LTOKEN"
  if [[ "$STATUS" == "201" || "$STATUS" == "200" ]]; then
    HAS_SIG=$(echo "$BODY" | jq -r '.fields.signature // "none"')
    AMOUNT=$(echo "$BODY" | jq -r '.fields.amount // "none"')
    if [[ "$HAS_SIG" != "none" && "$AMOUNT" == "149.00" ]]; then
      green "  PASS  signed PayFast form returned, amount R149.00"; PASS=$((PASS+1))
    else
      red "  FAIL  form incomplete (signature=$HAS_SIG amount=$AMOUNT)"; FAIL=$((FAIL+1))
    fi
  elif [[ "$STATUS" == "400" ]]; then
    skipped "PayFast not configured on this server"
  else
    check "start verification payment" 201 "$STATUS" "$BODY"
  fi
fi

# A forged ITN with no valid signature must never mark a payment paid.
req POST /api/payments/payfast/notify '{"m_payment_id":"RBV-forged","payment_status":"COMPLETE","amount_gross":"149.00"}'
check "forged ITN is accepted but ignored" 200 "$STATUS" "$BODY"

req GET /api/payments/mine "" "$LTOKEN"
check "landlord reads own payment history" 200 "$STATUS" "$BODY"

req GET /api/payments/mine
check "payment history requires auth" 401 "$STATUS"

# Unpaid identity requests must stay out of the admin queue.
if [[ -n "${ADMIN_TOKEN:-}" && -n "$PAY_VR" ]]; then
  req GET /api/verification/pending "" "$ADMIN_TOKEN"
  IN_QUEUE=$(echo "$BODY" | jq -r --arg id "$PAY_VR" '[.[]? | select(.id==$id)] | length')
  if [[ "$IN_QUEUE" == "0" ]]; then
    green "  PASS  unpaid request is not in the review queue"; PASS=$((PASS+1))
  else
    red "  FAIL  unpaid request reached the review queue"; FAIL=$((FAIL+1))
  fi
fi


# -- 26. Board advertising -------------------------------------------------
# The assertions that matter are about what the ad endpoint does NOT do: it
# must not require or accept identity, and must not return anything that could
# be tied back to a viewer.
head_ "26. Board advertising"
req GET "/api/ads?placement=board_sidebar&province=Gauteng"
check "ads endpoint is public" 200 "$STATUS" "$BODY"

# The rate card must be readable by a prospective advertiser.
req GET /api/ads/rates
check "rate card is public" 200 "$STATUS" "$BODY"

# Narrower targeting must cost less than national, or the pricing is backwards.
NAT=$(echo "$BODY" | jq -r '.placements[0].rates[] | select(.level=="national") | .monthlyCents')
SUB=$(echo "$BODY" | jq -r '.placements[0].rates[] | select(.level=="suburb") | .monthlyCents')
if [[ -n "$NAT" && -n "$SUB" && "$SUB" -lt "$NAT" ]]; then
  green "  PASS  suburb rate is below national ($SUB < $NAT)"; PASS=$((PASS+1))
else
  red "  FAIL  suburb rate is not below national (national=$NAT suburb=$SUB)"; FAIL=$((FAIL+1))
fi

# The rate-card request above replaced BODY, so ask for the ads again before
# asserting anything about their shape.
req GET "/api/ads?placement=board_sidebar&province=Gauteng"
if echo "$BODY" | jq -e 'type == "array"' >/dev/null 2>&1; then
  green "  PASS  returns an array, empty is valid"; PASS=$((PASS+1))
else
  red "  FAIL  unexpected shape"; FAIL=$((FAIL+1))
fi

# No identifiers may appear in an ad payload.
if echo "$BODY" | jq -e 'any(.[]?; has("userId") or has("sessionId") or has("trackingId"))' >/dev/null 2>&1; then
  red "  FAIL  ad payload contains a viewer identifier"; FAIL=$((FAIL+1))
else
  green "  PASS  no viewer identifiers in the ad payload"; PASS=$((PASS+1))
fi

req POST /api/ads/campaigns '{"advertiserId":"00000000-0000-0000-0000-000000000000","name":"x"}' "$LTOKEN"
check "landlord CANNOT create a campaign" 403 "$STATUS" "$BODY"

req GET /api/ads/advertisers "" "$TTOKEN"
check "tenant CANNOT list advertisers" 403 "$STATUS" "$BODY"

req GET /api/ads/campaigns
check "campaign list requires auth" 401 "$STATUS"

# Impression counting must not require or record identity.
req POST /api/ads/impressions '{"campaignIds":[]}'
if [[ "$STATUS" == "204" || "$STATUS" == "200" ]]; then
  green "  PASS  impressions accepted anonymously  ($STATUS)"; PASS=$((PASS+1))
else
  red "  FAIL  impressions returned $STATUS"; FAIL=$((FAIL+1))
fi

if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  req POST /api/ads/advertisers \
    "{\"companyName\":\"Smoke Fibre Co\",\"contactName\":\"Test Buyer\",\"contactEmail\":\"ads+${STAMP}@mastande.test\"}" "$ADMIN_TOKEN"
  check "admin creates an advertiser" 201 "$STATUS" "$BODY"
  ADV_ID=$(echo "$BODY" | jq -r '.id // empty')

  if [[ -n "$ADV_ID" ]]; then
    req POST /api/ads/campaigns \
      "{\"advertiserId\":\"$ADV_ID\",\"name\":\"Gauteng fibre\",\"placement\":\"board_sidebar\",\"headline\":\"Fibre at your new place\",\"targetUrl\":\"https://example.co.za\",\"province\":\"Gauteng\",\"startsAt\":\"$STARTED\",\"endsAt\":\"2099-01-01\",\"monthlyRateCents\":250000}" "$ADMIN_TOKEN"
    check "admin creates a campaign" 201 "$STATUS" "$BODY"
    CAMP_ID=$(echo "$BODY" | jq -r '.id // empty')
    CAMP_STATUS=$(echo "$BODY" | jq -r '.status')

    if [[ "$CAMP_STATUS" == "pending_review" ]]; then
      green "  PASS  campaign starts in review, not live"; PASS=$((PASS+1))
    else
      red "  FAIL  campaign status is '$CAMP_STATUS', expected pending_review"; FAIL=$((FAIL+1))
    fi

    req POST /api/ads/campaigns \
      "{\"advertiserId\":\"$ADV_ID\",\"name\":\"Insecure\",\"placement\":\"board_sidebar\",\"headline\":\"Plain http link\",\"targetUrl\":\"http://example.co.za\",\"startsAt\":\"$STARTED\",\"endsAt\":\"2099-01-01\",\"monthlyRateCents\":100}" "$ADMIN_TOKEN"
    check "rejects a non-https destination" 400 "$STATUS" "$BODY"

    if [[ -n "$CAMP_ID" ]]; then
      req PATCH "/api/ads/campaigns/$CAMP_ID/review" '{"status":"rejected"}' "$ADMIN_TOKEN"
      check "rejection requires a reason" 400 "$STATUS" "$BODY"

      req PATCH "/api/ads/campaigns/$CAMP_ID/review" '{"status":"approved"}' "$ADMIN_TOKEN"
      check "admin approves the campaign" 200 "$STATUS" "$BODY"

      # limit=3 because the endpoint returns one ad by default and rotates
      # among equally specific campaigns — with several Gauteng campaigns from
      # previous runs, asking for one makes this a coin toss.
      req GET "/api/ads?placement=board_sidebar&province=Gauteng&limit=3"
      SERVED=$(echo "$BODY" | jq -r 'length')
      if [[ "$SERVED" -gt 0 ]]; then
        green "  PASS  Gauteng sidebar serves an ad ($SERVED returned)"; PASS=$((PASS+1))
      else
        red "  FAIL  nothing served for Gauteng after approving a campaign"; FAIL=$((FAIL+1))
      fi

      # Eligibility is the real assertion: approval must make it servable.
      # Advertisers must be listable — the campaign form populates from this.
  req GET /api/ads/advertisers "" "$ADMIN_TOKEN"
  check "admin lists advertisers for the campaign form" 200 "$STATUS" "$BODY"

  req GET /api/ads/reach-analysis "" "$ADMIN_TOKEN"
  check "admin reads reach analysis" 200 "$STATUS" "$BODY"

  # Reach must come from eligibility, not impressions won — otherwise selling
  # more inventory would look like the targeting reached more people.
  if echo "$BODY" | jq -e '.levels | all(.[]; has("eligibleRequests") and has("reachSharePct"))' >/dev/null 2>&1; then
    green "  PASS  reach measured by eligible requests"; PASS=$((PASS+1))
  else
    red "  FAIL  reach analysis is not using eligibility"; FAIL=$((FAIL+1))
  fi

  # The whole point is comparing delivered reach against what the rate assumes.
  if echo "$BODY" | jq -e '.levels | all(.[]; has("actualSharePct") and has("pricedSharePct") and has("gapPct"))' >/dev/null 2>&1; then
    green "  PASS  reach analysis compares actual against priced share"; PASS=$((PASS+1))
  else
    red "  FAIL  reach analysis missing the comparison fields"; FAIL=$((FAIL+1))
  fi

  # A conclusion drawn from one campaign is noise, and must be marked as such.
  if echo "$BODY" | jq -e '.levels | all(.[]; has("reliable"))' >/dev/null 2>&1; then
    green "  PASS  each level is flagged reliable or not"; PASS=$((PASS+1))
  else
    red "  FAIL  no reliability flag on reach levels"; FAIL=$((FAIL+1))
  fi

  req GET /api/ads/reach-analysis "" "$LTOKEN"
  check "landlord CANNOT read reach analysis" 403 "$STATUS" "$BODY"

  req GET "/api/ads/campaigns?status=active" "" "$ADMIN_TOKEN"
      if echo "$BODY" | jq -e --arg id "$CAMP_ID" 'any(.[]?; .id==$id)' >/dev/null 2>&1; then
        green "  PASS  approved campaign is active and eligible"; PASS=$((PASS+1))
      else
        red "  FAIL  approved campaign is not active"; FAIL=$((FAIL+1))
      fi

      req GET "/api/ads?placement=board_sidebar&province=Western%20Cape&limit=3"
      if echo "$BODY" | jq -e --arg id "$CAMP_ID" 'any(.[]?; .id==$id)' >/dev/null 2>&1; then
        red "  FAIL  Gauteng campaign served on a Western Cape page"; FAIL=$((FAIL+1))
      else
        green "  PASS  not served outside its target province"; PASS=$((PASS+1))
      fi

      # End it, so repeated runs do not accumulate active campaigns competing
      # for the same slot — which is what made this test flaky.
      req PATCH "/api/ads/campaigns/$CAMP_ID/status" '{"status":"ended"}' "$ADMIN_TOKEN"
      check "campaign can be ended (cleanup)" 200 "$STATUS" "$BODY"

      req GET "/api/ads/campaigns/$CAMP_ID/stats" "" "$ADMIN_TOKEN"
      check "campaign stats load" 200 "$STATUS" "$BODY"
    fi
  fi
else
  skipped "admin ad management — set ADMIN_TOKEN to include it"
fi

# Demo campaigns, if seeded with SEED_DEMO_ADS=true. These exercise the serving
# path end to end without needing an admin token or a real advertiser.
req GET "/api/ads?placement=board_sidebar"
DEMO_COUNT=$(echo "$BODY" | jq -r 'length')
if [[ "$DEMO_COUNT" -gt 0 ]]; then
  green "  PASS  an ad is being served for board_sidebar"; PASS=$((PASS+1))

  DEMO_ID=$(echo "$BODY" | jq -r '.[0].id')
  for field in headline ctaLabel advertiser clickUrl; do
    if echo "$BODY" | jq -e --arg f "$field" '.[0] | has($f)' >/dev/null 2>&1; then
      green "  PASS  served ad has $field"; PASS=$((PASS+1))
    else
      red "  FAIL  served ad is missing $field"; FAIL=$((FAIL+1))
    fi
  done

  # The destination must not be exposed before the click — that is the whole
  # reason clicks route through us rather than linking out directly.
  if echo "$BODY" | jq -e '.[0] | has("targetUrl")' >/dev/null 2>&1; then
    red "  FAIL  targetUrl exposed in the ad payload"; FAIL=$((FAIL+1))
  else
    green "  PASS  destination withheld until the click"; PASS=$((PASS+1))
  fi

  # Counting a click should redirect rather than render anything.
  CLICK_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/api/ads/$DEMO_ID/click" 2>/dev/null)
  if [[ "$CLICK_CODE" == "302" || "$CLICK_CODE" == "301" ]]; then
    green "  PASS  click endpoint redirects  ($CLICK_CODE)"; PASS=$((PASS+1))
  else
    red "  FAIL  click endpoint returned $CLICK_CODE, expected a redirect"; FAIL=$((FAIL+1))
  fi

  # WHERE it redirects to, which the check above never asked.
  #
  # House ads point at our own pages, and res.redirect('/how-it-works')
  # resolves against the origin serving the redirect — the API. So every click
  # on the board's only call to action landed on
  # {"message":"Cannot GET /how-it-works","statusCode":404} at a hostname the
  # visitor has never heard of, while this section reported a pass because a
  # redirect to the wrong place is still a redirect.
  CLICK_LOCATION=$(curl -s -o /dev/null -D - "$API/api/ads/$DEMO_ID/click" 2>/dev/null \
    | sed -n 's/^[Ll]ocation: *//p' | tr -d '\r')
  if [[ "$CLICK_LOCATION" == /* ]]; then
    red "  FAIL  click redirects to a relative path (\"$CLICK_LOCATION\") — it resolves against the API, not the site"
    FAIL=$((FAIL+1))
  elif [[ "$CLICK_LOCATION" == "$API"* ]]; then
    red "  FAIL  click redirects to this API (\"$CLICK_LOCATION\") — a visitor lands on JSON, not a page"
    FAIL=$((FAIL+1))
  elif [[ -n "$CLICK_LOCATION" ]]; then
    green "  PASS  and to an absolute destination off this API  ($CLICK_LOCATION)"; PASS=$((PASS+1))
  else
    red "  FAIL  click sent no Location header"; FAIL=$((FAIL+1))
  fi

  req POST /api/ads/impressions "{\"campaignIds\":[\"$DEMO_ID\"]}"
  if [[ "$STATUS" == "204" ]]; then
    green "  PASS  impression recorded anonymously"; PASS=$((PASS+1))
  else
    red "  FAIL  impression recording returned $STATUS"; FAIL=$((FAIL+1))
  fi

  req GET "/api/ads?placement=room_detail"
  if [[ "$(echo "$BODY" | jq -r 'length')" -gt 0 ]]; then
    green "  PASS  room_detail placement also serves"; PASS=$((PASS+1))
  else
    skipped "no room_detail campaign seeded"
  fi
else
  skipped "no active campaigns — seed with SEED_DEMO_ADS=true npx ts-node prisma/seed.ts"
fi


# -- 27. Advertising enquiries ---------------------------------------------
head_ "27. Advertising enquiries"
req POST /api/ads/enquiries \
  "{\"companyName\":\"Smoke Fibre\",\"contactName\":\"Test Buyer\",\"contactEmail\":\"ads+${STAMP}@mastande.test\",\"industry\":\"Fibre\",\"province\":\"Gauteng\",\"message\":\"We would like the Gauteng sidebar placement from next month.\"}"
check "anyone can send an advertising enquiry" 201 "$STATUS" "$BODY"

req POST /api/ads/enquiries \
  '{"companyName":"X","contactName":"Y","contactEmail":"not-an-email","message":"too short"}'
check "rejects a malformed enquiry" 400 "$STATUS" "$BODY"

req POST /api/ads/enquiries \
  "{\"companyName\":\"Valid Co\",\"contactName\":\"Valid Name\",\"contactEmail\":\"ok+${STAMP}@mastande.test\",\"message\":\"short\"}"
check "rejects a message that is too short" 400 "$STATUS" "$BODY"

req GET /api/ads/enquiries "" "$LTOKEN"
check "landlord CANNOT read the enquiry queue" 403 "$STATUS" "$BODY"

req GET /api/ads/enquiries
check "enquiry queue requires auth" 401 "$STATUS"

if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  req GET /api/ads/enquiries "" "$ADMIN_TOKEN"
  check "admin reads the enquiry queue" 200 "$STATUS" "$BODY"
  ENQ_ID=$(echo "$BODY" | jq -r '.[0].id // empty')

  if [[ -n "$ENQ_ID" ]]; then
    req PATCH "/api/ads/enquiries/$ENQ_ID" '{"status":"contacted","adminNotes":"Emailed a rate card."}' "$ADMIN_TOKEN"
    check "admin can progress an enquiry" 200 "$STATUS" "$BODY"
  fi
fi


# -- 28. Admin portal ------------------------------------------------------
head_ "28. Admin portal"
req GET /api/admin/kpis "" "$TTOKEN"
check "tenant CANNOT read KPIs" 403 "$STATUS" "$BODY"

req GET "/api/admin/users/$TENANT_ID" "" "$TTOKEN"
check "tenant CANNOT read account details" 403 "$STATUS" "$BODY"

req GET "/api/admin/users/$TENANT_ID" "" "$LTOKEN"
check "landlord CANNOT read account details" 403 "$STATUS" "$BODY"

if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  req GET /api/admin/kpis "" "$ADMIN_TOKEN"
  check "admin reads KPIs" 200 "$STATUS" "$BODY"

  for section in growth health trust queues; do
    if echo "$BODY" | jq -e --arg s "$section" 'has($s)' >/dev/null 2>&1; then
      green "  PASS  KPIs include $section"; PASS=$((PASS+1))
    else
      red "  FAIL  KPIs missing $section"; FAIL=$((FAIL+1))
    fi
  done

  # The two numbers that actually describe a two-sided marketplace.
  LIQ=$(echo "$BODY" | jq -r '.health.listingsWithApplicationsPct')
  RESP=$(echo "$BODY" | jq -r '.health.landlordResponsePct')
  if [[ "$LIQ" =~ ^[0-9]+$ && "$RESP" =~ ^[0-9]+$ ]]; then
    green "  PASS  liquidity ${LIQ}% and landlord response ${RESP}% computed"; PASS=$((PASS+1))
  else
    red "  FAIL  health metrics are not numeric (liquidity=$LIQ response=$RESP)"; FAIL=$((FAIL+1))
  fi

  # Per-account detail, the support view.
  if [[ -n "$TENANT_ID" ]]; then
    req GET "/api/admin/users/$TENANT_ID" "" "$ADMIN_TOKEN"
    check "admin opens an account detail" 200 "$STATUS" "$BODY"

    for section in user activity rooms applications tenancies payments verifications; do
      if echo "$BODY" | jq -e --arg s "$section" 'has($s)' >/dev/null 2>&1; then
        green "  PASS  detail includes $section"; PASS=$((PASS+1))
      else
        red "  FAIL  detail missing $section"; FAIL=$((FAIL+1))
      fi
    done

    # Message CONTENT must never appear here — only counts. This is the whole
    # reason the endpoint returns messagesSent rather than the messages.
    if echo "$BODY" | jq -e '.. | objects | select(has("body"))' >/dev/null 2>&1; then
      red "  FAIL  account detail exposes message content"; FAIL=$((FAIL+1))
    else
      green "  PASS  no message content in the account detail"; PASS=$((PASS+1))
    fi

    if echo "$BODY" | jq -e '.user | has("passwordHash")' >/dev/null 2>&1; then
      red "  FAIL  account detail exposes the password hash"; FAIL=$((FAIL+1))
    else
      green "  PASS  no password hash in the account detail"; PASS=$((PASS+1))
    fi
  fi

  req GET "/api/admin/users/00000000-0000-0000-0000-000000000000" "" "$ADMIN_TOKEN"
  check "unknown account returns 404" 404 "$STATUS" "$BODY"

  req GET "/api/admin/kpis?days=7" "" "$ADMIN_TOKEN"
  PERIOD=$(echo "$BODY" | jq -r '.periodDays')
  if [[ "$PERIOD" == "7" ]]; then
    green "  PASS  period is configurable"; PASS=$((PASS+1))
  else
    red "  FAIL  requested 7 days, got $PERIOD"; FAIL=$((FAIL+1))
  fi
else
  skipped "admin KPIs — set ADMIN_TOKEN to include them"
fi


# -- 29. Referrals ---------------------------------------------------------
# The assertions that matter are the abuse guards: self-referral, double
# referral, and rewarding a signup that never did anything.
head_ "29. Referrals"
req GET /api/referrals/mine "" "$LTOKEN"
check "landlord gets a referral code" 200 "$STATUS" "$BODY"
REF_CODE=$(echo "$BODY" | jq -r '.code // empty')

if [[ -n "$REF_CODE" ]]; then
  green "  PASS  code issued ($REF_CODE)"; PASS=$((PASS+1))

  req GET "/api/referrals/validate?code=$REF_CODE"
  if throttled "code validates publicly"; then
    skipped "validate reveals only a display name — same 429"
  else
    VALID=$(echo "$BODY" | jq -r '.valid')
    if [[ "$VALID" == "true" ]]; then
      green "  PASS  code validates publicly"; PASS=$((PASS+1))
    else
      red "  FAIL  own code did not validate (valid=$VALID)"; FAIL=$((FAIL+1))
      grey "        $(echo "$BODY" | head -c 200)"
    fi

    # The validate response must not leak anything identifying.
    if echo "$BODY" | jq -e 'has("ownerId") or has("email")' >/dev/null 2>&1; then
      red "  FAIL  validate response leaks referrer identity"; FAIL=$((FAIL+1))
    else
      green "  PASS  validate reveals only a display name"; PASS=$((PASS+1))
    fi
  fi

  # Referred signup, then qualification via a real action.
  REFEREE="referred+${STAMP}@mastande.test"
  req POST /api/auth/register \
    "{\"email\":\"$REFEREE\",\"password\":\"$PASSWORD\",\"fullName\":\"Referred Tenant\",\"role\":\"TENANT\",\"referralCode\":\"$REF_CODE\"}"
  check "signup with a referral code" 201 "$STATUS" "$BODY"
  REFEREE_TOKEN=$(echo "$BODY" | jq -r '.accessToken // empty')

  sleep 1
  req GET /api/referrals/mine "" "$LTOKEN"
  PENDING=$(echo "$BODY" | jq -r '.summary.pending')
  if [[ "$PENDING" -ge 1 ]]; then
    green "  PASS  referral recorded as pending, not yet qualified"; PASS=$((PASS+1))
  else
    red "  FAIL  referral not recorded (pending=$PENDING)"; FAIL=$((FAIL+1))
  fi

  req GET "/api/referrals/validate?code=NONSENSE-XX"
  if throttled "unknown code rejected"; then
    :
  elif [[ "$(echo "$BODY" | jq -r '.valid')" == "false" ]]; then
    green "  PASS  unknown code rejected"; PASS=$((PASS+1))
  else
    red "  FAIL  unknown code validated"; FAIL=$((FAIL+1))
  fi
fi

req GET /api/referrals/mine
check "referrals require auth" 401 "$STATUS"

req GET /api/referrals/admin/stats "" "$TTOKEN"
check "tenant CANNOT read referral stats" 403 "$STATUS" "$BODY"

if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  req GET /api/referrals/admin/stats "" "$ADMIN_TOKEN"
  check "admin reads referral stats" 200 "$STATUS" "$BODY"

  # Conversion is the number worth watching: signups that became nothing.
  if echo "$BODY" | jq -e 'has("conversionPct") and has("byCity")' >/dev/null 2>&1; then
    green "  PASS  stats include conversion and per-city breakdown"; PASS=$((PASS+1))
  else
    red "  FAIL  stats incomplete"; FAIL=$((FAIL+1))
  fi

  req GET /api/referrals/admin/launch-codes "" "$ADMIN_TOKEN"
  check "admin lists launch codes" 200 "$STATUS" "$BODY"
  LAUNCH=$(echo "$BODY" | jq -r 'length')
  if [[ "$LAUNCH" -gt 0 ]]; then
    green "  PASS  launch codes seeded ($LAUNCH)"; PASS=$((PASS+1))
  else
    skipped "no launch codes — seed with SEED_LAUNCH_CODES=true"
  fi
fi


# -- 30. Search suggestions & amenities ------------------------------------
head_ "30. Search suggestions & amenities"
req GET "/api/rooms/suggest?q=jo"
check "suggestions endpoint is public" 200 "$STATUS" "$BODY"

if echo "$BODY" | jq -e 'type == "array"' >/dev/null 2>&1; then
  green "  PASS  returns an array"; PASS=$((PASS+1))
else
  red "  FAIL  unexpected shape"; FAIL=$((FAIL+1))
fi

# A single character would match nearly everything, so it returns nothing.
req GET "/api/rooms/suggest?q=a"
if [[ "$(echo "$BODY" | jq -r 'length')" == "0" ]]; then
  green "  PASS  a one-character query returns nothing"; PASS=$((PASS+1))
else
  red "  FAIL  one-character query returned results"; FAIL=$((FAIL+1))
fi

# 'suggest' is declared before ':id' in the controller; if that order ever
# changes it would be parsed as a UUID and 400.
req GET "/api/rooms/suggest?q=pretoria"
if [[ "$STATUS" == "200" ]]; then
  green "  PASS  /rooms/suggest is not shadowed by /rooms/:id"; PASS=$((PASS+1))
else
  red "  FAIL  /rooms/suggest returned $STATUS — route order regression"; FAIL=$((FAIL+1))
fi

# Amenities round-trip.
req POST /api/rooms "$ROOM_JSON" "$LTOKEN"
AMEN_ROOM=$(echo "$BODY" | jq -r '.id // empty')
if [[ -n "$AMEN_ROOM" ]]; then
  req PATCH "/api/rooms/$AMEN_ROOM" '{"amenities":["shower_indoor","prepaid_electricity","furnished"]}' "$LTOKEN"
  check "amenities save" 200 "$STATUS" "$BODY"
  COUNT=$(echo "$BODY" | jq -r '.amenities | length')
  if [[ "$COUNT" == "3" ]]; then
    green "  PASS  all three amenities persisted"; PASS=$((PASS+1))
  else
    red "  FAIL  expected 3 amenities, got $COUNT"; FAIL=$((FAIL+1))
  fi

  req PATCH "/api/rooms/$AMEN_ROOM" '{"amenities":[]}' "$LTOKEN"
  check "amenities can be cleared" 200 "$STATUS" "$BODY"
fi


# -- 31. Places & suburb targeting -----------------------------------------
# The point of the taxonomy: Sandton is in Johannesburg, and string comparison
# cannot know that.
head_ "31. Places & suburb targeting"
req GET "/api/places/suggest?q=sand"
check "place suggestions are public" 200 "$STATUS" "$BODY"

if echo "$BODY" | jq -e 'any(.[]?; .name == "Sandton")' >/dev/null 2>&1; then
  green "  PASS  suburb suggestion found"; PASS=$((PASS+1))
else
  skipped "places not seeded — run npx ts-node prisma/seed.ts"
fi

req GET "/api/places/resolve?q=sandton"
RESOLVED_CITY=$(echo "$BODY" | jq -r '.city // empty')
if [[ "$RESOLVED_CITY" == "Johannesburg" ]]; then
  green "  PASS  Sandton resolves to Johannesburg"; PASS=$((PASS+1))
elif [[ -z "$RESOLVED_CITY" ]]; then
  skipped "places not seeded"
else
  red "  FAIL  Sandton resolved to '$RESOLVED_CITY'"; FAIL=$((FAIL+1))
fi

# Aliases are the reason a South African can type what they actually say.
req GET "/api/places/resolve?q=joburg"
ALIAS=$(echo "$BODY" | jq -r '.name // empty')
if [[ "$ALIAS" == "Johannesburg" ]]; then
  green "  PASS  alias 'joburg' resolves"; PASS=$((PASS+1))
elif [[ -z "$ALIAS" ]]; then
  skipped "places not seeded"
else
  red "  FAIL  'joburg' resolved to '$ALIAS'"; FAIL=$((FAIL+1))
fi

req GET "/api/places/resolve?q=notarealplace"
if [[ "$STATUS" == "200" ]]; then
  green "  PASS  unknown place returns null, not an error"; PASS=$((PASS+1))
else
  red "  FAIL  unknown place returned $STATUS"; FAIL=$((FAIL+1))
fi

# A suburb-targeted campaign must not leak to the whole city.
if [[ -n "${ADMIN_TOKEN:-}" && -n "${ADV_ID:-}" ]]; then
  req POST /api/ads/campaigns \
    "{\"advertiserId\":\"$ADV_ID\",\"name\":\"Sandton only\",\"placement\":\"board_sidebar\",\"headline\":\"Sandton storage units\",\"targetUrl\":\"https://example.co.za\",\"suburbSlug\":\"johannesburg-sandton\",\"startsAt\":\"$STARTED\",\"endsAt\":\"2099-01-01\",\"monthlyRateCents\":300000}" "$ADMIN_TOKEN"
  SUB_CAMP=$(echo "$BODY" | jq -r '.id // empty')

  if [[ -n "$SUB_CAMP" ]]; then
    req PATCH "/api/ads/campaigns/$SUB_CAMP/review" '{"status":"approved"}' "$ADMIN_TOKEN"

    req GET "/api/ads?placement=board_sidebar&limit=3"
    if echo "$BODY" | jq -e --arg id "$SUB_CAMP" 'any(.[]?; .id==$id)' >/dev/null 2>&1; then
      red "  FAIL  suburb campaign served with no suburb context"; FAIL=$((FAIL+1))
    else
      green "  PASS  suburb campaign withheld without suburb context"; PASS=$((PASS+1))
    fi

    req GET "/api/ads?placement=board_sidebar&suburbSlug=johannesburg-sandton&limit=3"
    if echo "$BODY" | jq -e --arg id "$SUB_CAMP" 'any(.[]?; .id==$id)' >/dev/null 2>&1; then
      green "  PASS  suburb campaign served for its suburb"; PASS=$((PASS+1))
    else
      red "  FAIL  suburb campaign not served for its own suburb"; FAIL=$((FAIL+1))
    fi

    req PATCH "/api/ads/campaigns/$SUB_CAMP/status" '{"status":"ended"}' "$ADMIN_TOKEN"
  fi
fi


# -- 32. UX analytics ------------------------------------------------------
# The assertions that matter are about what is NOT stored.
head_ "32. UX analytics"
req POST /api/analytics/event '{"event":"wizard.started","segment":"mobile"}'
if [[ "$STATUS" == "204" ]]; then
  green "  PASS  event accepted anonymously  (204)"; PASS=$((PASS+1))
else
  red "  FAIL  event endpoint returned $STATUS"; FAIL=$((FAIL+1))
fi

# An allowlist, so an injected event name cannot create arbitrary rows.
req POST /api/analytics/event '{"event":"totally.made.up","segment":"x"}'
if [[ "$STATUS" == "204" ]]; then
  green "  PASS  unknown event silently ignored, not stored"; PASS=$((PASS+1))
else
  red "  FAIL  unknown event returned $STATUS"; FAIL=$((FAIL+1))
fi

req GET /api/analytics/funnels "" "$TTOKEN"
check "tenant CANNOT read funnels" 403 "$STATUS" "$BODY"

req GET /api/analytics/content-signals "" "$LTOKEN"
check "landlord CANNOT read content signals" 403 "$STATUS" "$BODY"

if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  # An admin has no tenant or landlord profile, so those endpoints should not
  # pretend otherwise — the frontend equivalent was an admin being sent to an
  # empty tenant dashboard.
  req GET /api/applications/mine "" "$ADMIN_TOKEN"
  if [[ "$STATUS" == "403" || "$STATUS" == "200" ]]; then
    green "  PASS  tenant endpoint handles an admin token sensibly  ($STATUS)"; PASS=$((PASS+1))
  else
    red "  FAIL  tenant endpoint returned $STATUS for an admin"; FAIL=$((FAIL+1))
  fi

  req GET /api/admin/growth "" "$ADMIN_TOKEN"
  check "admin reads growth metrics" 200 "$STATUS" "$BODY"

  for section in active signups totals; do
    if echo "$BODY" | jq -e --arg s "$section" 'has($s)' >/dev/null 2>&1; then
      green "  PASS  growth includes $section"; PASS=$((PASS+1))
    else
      red "  FAIL  growth missing $section"; FAIL=$((FAIL+1))
    fi
  done

  # Signups split by role: a room board needs both sides, and one number hides
  # a board filling with tenants and no rooms.
  if echo "$BODY" | jq -e '.signups | has("tenants") and has("landlords")' >/dev/null 2>&1; then
    green "  PASS  signups are split by role"; PASS=$((PASS+1))
  else
    red "  FAIL  signups are not split by role"; FAIL=$((FAIL+1))
  fi

  req GET /api/admin/growth "" "$TTOKEN"
  check "tenant CANNOT read growth metrics" 403 "$STATUS" "$BODY"

  req GET /api/analytics/funnels "" "$ADMIN_TOKEN"
  check "admin reads funnels" 200 "$STATUS" "$BODY"

  for section in listingFunnel applyFunnel featureUse; do
    if echo "$BODY" | jq -e --arg s "$section" 'has($s)' >/dev/null 2>&1; then
      green "  PASS  funnels include $section"; PASS=$((PASS+1))
    else
      red "  FAIL  funnels missing $section"; FAIL=$((FAIL+1))
    fi
  done

  # No identifier may ever appear in analytics output.
  if echo "$BODY" | jq -e '.. | objects | select(has("userId") or has("sessionId") or has("ip"))' >/dev/null 2>&1; then
    red "  FAIL  analytics payload contains an identifier"; FAIL=$((FAIL+1))
  else
    green "  PASS  no identifiers anywhere in the funnel payload"; PASS=$((PASS+1))
  fi

  req GET /api/analytics/content-signals "" "$ADMIN_TOKEN"
  check "admin reads content signals" 200 "$STATUS" "$BODY"
fi


# -- 33. Shortlist management ----------------------------------------------
head_ "33. Shortlist management"
# set -u is on, so every optional variable needs a default — APP2_ID is only
# assigned in a section that may not have run.
SL_APP="${APP2_ID:-${APP_ID:-}}"
if [[ -n "$SL_APP" ]]; then
  req POST "/api/applications/$SL_APP/unshortlist" "" "$LTOKEN"
  if [[ "$STATUS" == "200" || "$STATUS" == "400" ]]; then
    green "  PASS  unshortlist responds sensibly  ($STATUS)"; PASS=$((PASS+1))
  else
    red "  FAIL  unshortlist returned $STATUS"; FAIL=$((FAIL+1))
  fi

  req POST "/api/applications/$SL_APP/unshortlist" "" "$TTOKEN"
  check "tenant CANNOT unshortlist" 403 "$STATUS" "$BODY"

  req POST "/api/applications/$SL_APP/unshortlist" ""
  check "unshortlist requires auth" 401 "$STATUS"
fi


# -- 34. Removed listings are not retrievable ------------------------------
# A saved room kept rendering on the tenant dashboard after the landlord took
# it down, because GET /rooms/:id returned it to anyone holding the id.
head_ "34. Removed listing visibility"
req POST /api/rooms "$ROOM_JSON" "$LTOKEN"
GONE_ROOM=$(echo "$BODY" | jq -r '.id // empty')

if [[ -n "$GONE_ROOM" ]]; then
  req GET "/api/rooms/$GONE_ROOM"
  check "a draft is not publicly retrievable" 404 "$STATUS" "$BODY"

  req GET "/api/rooms/$GONE_ROOM" "" "$LTOKEN"
  check "the owner can still read their own draft" 200 "$STATUS" "$BODY"

  req PATCH "/api/rooms/$GONE_ROOM" '{"heroImagePath":"/smoke-test-placeholder.jpg"}' "$LTOKEN"
  req POST "/api/rooms/$GONE_ROOM/publish" "" "$LTOKEN"

  req GET "/api/rooms/$GONE_ROOM"
  check "a published room IS publicly retrievable" 200 "$STATUS" "$BODY"

  req POST "/api/rooms/$GONE_ROOM/remove" "" "$LTOKEN"
  check "landlord removes the listing" 200 "$STATUS" "$BODY"

  req GET "/api/rooms/$GONE_ROOM"
  check "a removed listing is no longer retrievable" 404 "$STATUS" "$BODY"

  req GET "/api/rooms/$GONE_ROOM" "" "$TTOKEN"
  check "not retrievable by a signed-in tenant either" 404 "$STATUS" "$BODY"

  req GET "/api/rooms/$GONE_ROOM" "" "$LTOKEN"
  check "the owner can still see it, to relist" 200 "$STATUS" "$BODY"
fi


# -- 35. House ads ---------------------------------------------------------
# They fill unsold inventory and give the rate card a national baseline. The
# assertion that matters is that they never outrank a paid campaign.
head_ "35. House ads"
req GET "/api/ads?placement=board_sidebar&limit=3"
HOUSE_SERVED=$(echo "$BODY" | jq -r '[.[]? | select(.advertiser == "Mastande")] | length')
TOTAL_SERVED=$(echo "$BODY" | jq -r 'length')

if [[ "$TOTAL_SERVED" -gt 0 ]]; then
  green "  PASS  an ad is served for the sidebar ($TOTAL_SERVED)"; PASS=$((PASS+1))

  # With paid demo campaigns seeded, a house ad must not come first.
  FIRST=$(echo "$BODY" | jq -r '.[0].advertiser')
  PAID_AVAILABLE=$(echo "$BODY" | jq -r '[.[]? | select(.advertiser != "Mastande")] | length')
  if [[ "$PAID_AVAILABLE" -gt 0 && "$FIRST" == "Mastande" ]]; then
    red "  FAIL  a house ad outranked a paid campaign"; FAIL=$((FAIL+1))
  else
    green "  PASS  house ads do not displace paid campaigns"; PASS=$((PASS+1))
  fi
else
  skipped "no campaigns seeded"
fi

# Requesting an ad must record eligibility, which is what the rate card is
# checked against.
if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  req GET "/api/ads?placement=board_sidebar&province=Gauteng&city=Johannesburg"
  req GET /api/ads/reach-analysis "" "$ADMIN_TOKEN"
  REQS=$(echo "$BODY" | jq -r '.totalRequests // 0')
  if [[ "$REQS" -gt 0 ]]; then
    green "  PASS  ad requests are being counted ($REQS)"; PASS=$((PASS+1))
  else
    red "  FAIL  no eligibility recorded after an ad request"; FAIL=$((FAIL+1))
  fi
fi


# -- 36. Passwordless sign-in ----------------------------------------------
# The point of this feature is a returning user who has forgotten everything,
# so the assertions are about not leaking whether an account exists.
head_ "36. Passwordless sign-in"
req POST /api/auth/magic-link "{\"email\":\"$LANDLORD_EMAIL\"}"
check "magic link for a real account" 200 "$STATUS" "$BODY"
REAL_MAGIC=$(echo "$BODY" | jq -r '.message')

req POST /api/auth/magic-link '{"email":"nobody-here@mastande.test"}'
check "magic link for an unknown account" 200 "$STATUS" "$BODY"
FAKE_MAGIC=$(echo "$BODY" | jq -r '.message')

if [[ "$REAL_MAGIC" == "$FAKE_MAGIC" ]]; then
  green "  PASS  identical response either way (no membership oracle)"; PASS=$((PASS+1))
else
  red "  FAIL  responses differ — reveals whether an account exists"; FAIL=$((FAIL+1))
fi

req POST /api/auth/magic-link '{"email":"not-an-email"}'
check "rejects a malformed address" 400 "$STATUS" "$BODY"

req POST /api/auth/magic-link/verify '{"token":"clearly-not-a-real-token"}'
check "rejects an invalid sign-in token" 400 "$STATUS" "$BODY"

req POST /api/auth/magic-link/verify '{}'
check "rejects a missing token" 400 "$STATUS" "$BODY"


# -- 37. Undo accept & phone sign-in ---------------------------------------
head_ "37. Undo accept & phone sign-in"

# Accepting is the most destructive landlord action: it lets the room and
# rejects everyone else. Reversing it must reinstate only the collateral.
req POST /api/rooms "$ROOM_JSON" "$LTOKEN"
UNDO_ROOM=$(echo "$BODY" | jq -r '.id // empty')
if [[ -n "$UNDO_ROOM" ]]; then
  req PATCH "/api/rooms/$UNDO_ROOM" '{"heroImagePath":"/smoke-test-placeholder.jpg"}' "$LTOKEN"
  req POST "/api/rooms/$UNDO_ROOM/publish" "" "$LTOKEN"

  req POST /api/applications "{\"roomId\":\"$UNDO_ROOM\",\"coverNote\":\"First applicant for undo test.\"}" "$TTOKEN"
  UNDO_APP1=$(echo "$BODY" | jq -r '.id // empty')
  req POST /api/applications "{\"roomId\":\"$UNDO_ROOM\",\"coverNote\":\"Second applicant for undo test.\"}" "$ITOKEN"
  UNDO_APP2=$(echo "$BODY" | jq -r '.id // empty')

  if [[ -n "$UNDO_APP1" && -n "$UNDO_APP2" ]]; then
    req POST "/api/applications/$UNDO_APP1/accept" "" "$LTOKEN"
    check "landlord accepts one applicant" 200 "$STATUS" "$BODY"

    req POST "/api/applications/$UNDO_APP1/undo-accept" "" "$LTOKEN"
    check "acceptance can be undone" 200 "$STATUS" "$BODY"
    REINSTATED=$(echo "$BODY" | jq -r '.reinstated // 0')
    if [[ "$REINSTATED" -ge 1 ]]; then
      green "  PASS  the auto-rejected applicant was reinstated"; PASS=$((PASS+1))
    else
      red "  FAIL  nobody reinstated after undo (got $REINSTATED)"; FAIL=$((FAIL+1))
    fi

    req GET "/api/rooms/$UNDO_ROOM"
    if [[ "$(echo "$BODY" | jq -r '.status')" == "active" ]]; then
      green "  PASS  the room is back on the board"; PASS=$((PASS+1))
    else
      red "  FAIL  room did not return to active"; FAIL=$((FAIL+1))
    fi

    req POST "/api/applications/$UNDO_APP1/undo-accept" "" "$LTOKEN"
    check "cannot undo an acceptance that was already undone" 400 "$STATUS" "$BODY"

    req POST "/api/applications/$UNDO_APP1/undo-accept" "" "$TTOKEN"
    check "tenant CANNOT undo an acceptance" 403 "$STATUS" "$BODY"
  fi
fi

# Phone sign-in must not reveal whether a number has an account.
req POST /api/auth/phone/request-code '{"phone":"0821234567"}'
check "phone code request accepted" 200 "$STATUS" "$BODY"
PHONE_MSG=$(echo "$BODY" | jq -r '.message')

req POST /api/auth/phone/request-code '{"phone":"0839999999"}'
if [[ "$(echo "$BODY" | jq -r '.message')" == "$PHONE_MSG" ]]; then
  green "  PASS  identical response for known and unknown numbers"; PASS=$((PASS+1))
else
  red "  FAIL  phone response reveals whether an account exists"; FAIL=$((FAIL+1))
fi

req POST /api/auth/phone/request-code '{"phone":"12345"}'
check "rejects a malformed number" 400 "$STATUS" "$BODY"

req POST /api/auth/phone/verify '{"phone":"0821234567","code":"000000"}'
check "rejects a wrong code" 400 "$STATUS" "$BODY"

req POST /api/auth/phone/verify '{"phone":"0821234567","code":"123"}'
check "rejects a short code" 400 "$STATUS" "$BODY"

# Phone SIGN-UP — Phase 7g part two. The three steps, and the refusals that
# matter more than the happy path: the full flow needs a code read out of the
# database, which is what scripts/phone-signup-drive.mjs is for.
SIGNUP_PHONE="08212$(( RANDOM % 90000 + 10000 ))"
req POST /api/auth/phone/signup/request-code "{\"phone\":\"$SIGNUP_PHONE\"}"
check "sign-up code request accepted" 200 "$STATUS" "$BODY"
SIGNUP_MSG=$(echo "$BODY" | jq -r '.message')

# The same number sign-in uses above, which by now HAS an account.
#
# ⚠️ The daily cap is checked FIRST, and that is not a get-out. This number is
# fixed, so every run of the suite against the same database spends another of
# its codes for the day; on the second run the answer becomes "Too many codes
# sent to this number today", which differs from the generic message for a
# reason that has nothing to do with account enumeration. Read as a failure, it
# was an alarm that cried wolf on any database the suite had already been run
# against — and a check that fails for the wrong reason gets ignored like any
# other. The cap refusal is identical whether or not the number is taken, so it
# leaks nothing; it simply cannot answer this question today, and says so.
req POST /api/auth/phone/signup/request-code '{"phone":"0821234567"}'
SIGNUP_TAKEN_MSG=$(echo "$BODY" | jq -r '.message')
if [[ "$SIGNUP_TAKEN_MSG" == "$SIGNUP_MSG" ]]; then
  green "  PASS  sign-up says the same thing whether or not the number is taken"; PASS=$((PASS+1))
elif [[ "$SIGNUP_TAKEN_MSG" == Too\ many\ codes* ]]; then
  skipped "enumeration wording — this number has spent its codes for today on an earlier run of the suite"
else
  red "  FAIL  sign-up reveals that a number already has an account"; FAIL=$((FAIL+1))
  grey "        taken: $SIGNUP_TAKEN_MSG"
  grey "        free:  $SIGNUP_MSG"
fi

req POST /api/auth/phone/signup/request-code '{"phone":"12345"}'
check "sign-up rejects a malformed number" 400 "$STATUS" "$BODY"

req POST /api/auth/phone/signup/verify "{\"phone\":\"$SIGNUP_PHONE\",\"code\":\"000000\"}"
check "sign-up rejects a wrong code" 400 "$STATUS" "$BODY"

# No ticket, no account — whatever else the request carries.
req POST /api/auth/phone/signup/complete '{"ticket":"not-a-real-ticket-at-all-x","fullName":"Nobody","role":"TENANT","acceptTerms":true}'
check "sign-up refuses a bogus ticket" 400 "$STATUS" "$BODY"

# The consent check, from the outside. The DTO must refuse both shapes: false,
# and absent. Absent is the one a missed checkbox binding actually ships as.
req POST /api/auth/phone/signup/complete '{"ticket":"not-a-real-ticket-at-all-x","fullName":"Nobody","role":"TENANT","acceptTerms":false}'
check "sign-up refuses acceptTerms: false" 400 "$STATUS" "$BODY"

req POST /api/auth/phone/signup/complete '{"ticket":"not-a-real-ticket-at-all-x","fullName":"Nobody","role":"TENANT"}'
check "sign-up refuses a request with no acceptTerms at all" 400 "$STATUS" "$BODY"

# Properties — Phase 7b. The full flow is scripts/properties-drive.mjs; what
# belongs here is the rule that cannot be allowed to regress quietly: deleting a
# property with rooms in it is REFUSED unless the caller confirms, and the
# refusal says what will happen to the listings.
req POST /api/properties '{"name":"Smoke yard","addressLine":"12 Smoke Street","city":"Johannesburg","province":"Gauteng"}' "$LTOKEN"
check "a landlord can create a property" 201 "$STATUS" "$BODY"
SMOKE_PROP=$(echo "$BODY" | jq -r '.id // empty')

if [[ "$(echo "$BODY" | jq -r '.addressLine')" == "12 Smoke Street" ]]; then
  green "  PASS  the private address line is stored and returned to its owner"; PASS=$((PASS+1))
else
  red "  FAIL  addressLine did not round-trip: $(echo "$BODY" | jq -r '.addressLine')"; FAIL=$((FAIL+1))
fi

if [[ -n "$SMOKE_PROP" && -n "$ROOM_ID" ]]; then
  req POST "/api/properties/$SMOKE_PROP/rooms" "{\"roomIds\":[\"$ROOM_ID\"]}" "$LTOKEN"
  check "a room can be grouped under it" 200 "$STATUS" "$BODY"

  req DELETE "/api/properties/$SMOKE_PROP" "" "$LTOKEN"
  check "deleting it with a room inside is refused" 400 "$STATUS" "$BODY"
  if echo "$BODY" | jq -r '.message' | grep -qi "NOT delete"; then
    green "  PASS  and the refusal says the listing will NOT be deleted"; PASS=$((PASS+1))
  else
    red "  FAIL  the refusal does not say what happens to the rooms"; FAIL=$((FAIL+1))
  fi

  req DELETE "/api/properties/$SMOKE_PROP?ungroupRooms=true" "" "$LTOKEN"
  check "with the confirmation it goes ahead" 200 "$STATUS" "$BODY"

  req GET "/api/rooms/$ROOM_ID" "" "$LTOKEN"
  check "and the room it held is still there" 200 "$STATUS" "$BODY"
fi

# A property id that is not yours cannot be attached to a room.
req POST /api/rooms "$(jq -nc --arg d "$(date -u -d '+10 days' +%Y-%m-%d)" '{
  roomType:"shared_house", title:"Room with somebody elses property",
  description:"A clean room in a shared house, close to transport and the shops. Available now.",
  rentCents:300000, province:"Gauteng", city:"Johannesburg",
  locationDisplay:"Tembisa, Johannesburg", availableFrom:$d,
  propertyId:"00000000-0000-4000-8000-000000000000"
}')" "$LTOKEN"
check "a property id that is not yours is refused, not ignored" 400 "$STATUS" "$BODY"

# Sub-letting — Phase 6. The flow end to end is scripts/sublet-drive.mjs; what
# belongs here is that a TENANT may hold a listing, that they cannot claim to be
# an owner, and that the board's new filters are wired to something.
req POST /api/rooms "$(jq -nc --arg d "$(date -u -d '+10 days' +%Y-%m-%d)" '{
  roomType:"shared_house",
  title:"Smoke sublet room in a shared house",
  description:"A clean room in a house I rent myself, close to transport and shops. Available now.",
  rentCents:320000, province:"Gauteng", city:"Johannesburg",
  locationDisplay:"Yeoville, Johannesburg", availableFrom:$d,
  listerType:"owner_landlord"
}')" "$TTOKEN"
check "a tenant account can create a listing (Phase 6 Option A)" 201 "$STATUS" "$BODY"
SUBLET_ROOM=$(echo "$BODY" | jq -r '.id // empty')

if [[ "$(echo "$BODY" | jq -r '.listerType')" == "sublessor" ]]; then
  green "  PASS  a tenant asking for owner_landlord is overridden to sublessor"; PASS=$((PASS+1))
else
  red "  FAIL  a tenant created a listing presenting as an owner's: $(echo "$BODY" | jq -r '.listerType')"; FAIL=$((FAIL+1))
fi

# An owner's listing is unchanged by any of this.
req GET "/api/rooms?limit=1&listerType=owner_landlord"
check "the board filters on listerType" 200 "$STATUS" "$BODY"

req GET "/api/rooms?limit=1&householdSocial=quiet"
check "the board filters on the household" 200 "$STATUS" "$BODY"

req GET "/api/rooms?limit=1&listerType=not-a-thing"
check "a bogus listerType is rejected rather than ignored" 400 "$STATUS" "$BODY"

# A sublet check is about a listing, and is free.
req POST /api/verification '{"type":"sublet_right","documentPath":"verification/smoke-lease.jpg"}' "$TTOKEN"
check "a sublet check with no listing named is refused" 400 "$STATUS" "$BODY"

if [[ -n "$SUBLET_ROOM" ]]; then
  req POST /api/verification "{\"type\":\"sublet_right\",\"documentPath\":\"verification/smoke-lease.jpg\",\"roomId\":\"$SUBLET_ROOM\"}" "$TTOKEN"
  check "a sublet check against their own listing is accepted" 201 "$STATUS" "$BODY"
fi

req GET /api/verification/types "" "$TTOKEN"
if [[ "$(echo "$BODY" | jq -r '[.[] | select(.type=="sublet_right")] | first | .requiresPayment')" == "false" ]]; then
  green "  PASS  the sublet-right check carries no fee"; PASS=$((PASS+1))
else
  red "  FAIL  the sublet-right check is not free, or is not offered to a sub-lessor"; FAIL=$((FAIL+1))
fi

# Cleared before leaving this section, deliberately.
#
# `sublet_right` is offered only to somebody who HOLDS a sublet listing, so
# leaving this one behind changes what section 42 sees and breaks its exact
# list of a tenant's verification types — a check failing three hundred lines
# away because of state this section left lying about. The listing has served
# its purpose here; the full lifecycle is scripts/sublet-drive.mjs.
if [[ -n "$SUBLET_ROOM" ]]; then
  req DELETE "/api/rooms/$SUBLET_ROOM/permanent" "" "$TTOKEN"
  check "the smoke sublet listing is cleaned up" 200 "$STATUS" "$BODY"
fi

# In-app notices — Phase 7g. The channel that works when there is no email
# address, and which nothing could READ until v1.85.1. Isolation between
# accounts is driven properly in scripts/notices-drive.mjs; what belongs here is
# that the endpoints exist, need a session, and answer the shape the nav badge
# reads.
req GET /api/notices "" "$LTOKEN"
check "a landlord can read their own notices" 200 "$STATUS" "$BODY"

req GET /api/notices
check "notices need a session" 401 "$STATUS" "$BODY"

req GET /api/notices/unread "" "$LTOKEN"
if [[ "$(echo "$BODY" | jq -r 'has("count") and has("items")')" == "true" ]]; then
  green "  PASS  the unread endpoint returns a count and a list in one call"; PASS=$((PASS+1))
else
  red "  FAIL  unread response is not {count, items}: $BODY"; FAIL=$((FAIL+1))
fi

req POST /api/notices/read-all '{}' "$LTOKEN"
check "mark-all-read is available to the owner" 200 "$STATUS" "$BODY"

# Rate limiting exists at all — the thing nineteen @Throttle decorators only
# looked like they were doing. Probed on referrals/validate because its window
# is one minute, so this cannot poison a later check for a quarter of an hour.
LIMIT_HIT=""
for i in $(seq 1 26); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
    "$API/api/referrals/validate?code=SMOKE$RANDOM" || true)
  if [[ "$CODE" == "429" ]]; then LIMIT_HIT="$i"; break; fi
done
if [[ -n "$LIMIT_HIT" ]]; then
  green "  PASS  the rate limiter refuses (429 on request $LIMIT_HIT of a 20-per-minute route)"; PASS=$((PASS+1))
else
  red "  FAIL  26 requests to a 20-per-minute route all accepted — the throttle is decoration"; FAIL=$((FAIL+1))
fi


# -- 38. Withdraw then re-apply, and permanent delete -----------------------
head_ "38. Re-apply & permanent delete"

req POST /api/rooms "$ROOM_JSON" "$LTOKEN"
REAPPLY_ROOM=$(echo "$BODY" | jq -r '.id // empty')
if [[ -n "$REAPPLY_ROOM" ]]; then
  req PATCH "/api/rooms/$REAPPLY_ROOM" '{"heroImagePath":"/smoke-test-placeholder.jpg"}' "$LTOKEN"
  req POST "/api/rooms/$REAPPLY_ROOM/publish" "" "$LTOKEN"

  req POST /api/applications "{\"roomId\":\"$REAPPLY_ROOM\",\"coverNote\":\"Applying, will withdraw, will return.\"}" "$TTOKEN"
  RA_APP=$(echo "$BODY" | jq -r '.id // empty')

  if [[ -n "$RA_APP" ]]; then
    req POST "/api/applications/$RA_APP/withdraw" "" "$TTOKEN"
    check "tenant withdraws" 201 "$STATUS" "$BODY"

    # A withdrawal is the tenant's own decision, not the room going away. If it
    # were archived, the dashboard would file it under 'Available again', which
    # is for rooms the landlord relisted.
    if [[ "$(echo "$BODY" | jq -r '.archivedAt // "null"')" == "null" ]]; then
      green "  PASS  withdrawing does not archive the application"; PASS=$((PASS+1))
    else
      red "  FAIL  withdraw set archivedAt — it will show as 'Available again'"; FAIL=$((FAIL+1))
    fi
    if [[ "$(echo "$BODY" | jq -r '.status')" == "withdrawn" ]]; then
      green "  PASS  status is withdrawn"; PASS=$((PASS+1))
    else
      red "  FAIL  status after withdrawing is '$(echo "$BODY" | jq -r '.status')'"; FAIL=$((FAIL+1))
    fi

    # The unique constraint is per cycle, so a withdrawn application used to
    # occupy the slot and block this entirely.
    req POST /api/applications "{\"roomId\":\"$REAPPLY_ROOM\",\"coverNote\":\"Changed my mind, applying again.\"}" "$TTOKEN"
    if [[ "$STATUS" == "201" ]]; then
      green "  PASS  can re-apply after withdrawing"; PASS=$((PASS+1))
      RA_STATUS=$(echo "$BODY" | jq -r '.status')
      if [[ "$RA_STATUS" == "pending" ]]; then
        green "  PASS  the reopened application is pending again"; PASS=$((PASS+1))
      else
        red "  FAIL  reopened application status is '$RA_STATUS'"; FAIL=$((FAIL+1))
      fi
    else
      red "  FAIL  re-applying after withdrawal returned $STATUS"; FAIL=$((FAIL+1))
      grey "        $(echo "$BODY" | head -c 200)"
    fi

    # A room with applications must not be deletable outright.
    req DELETE "/api/rooms/$REAPPLY_ROOM/permanent" "" "$LTOKEN"
    check "cannot hard-delete a room that has applications" 400 "$STATUS" "$BODY"
  fi
fi

# A room nobody applied for can be deleted completely.
req POST /api/rooms "$ROOM_JSON" "$LTOKEN"
CLEAN_ROOM=$(echo "$BODY" | jq -r '.id // empty')
if [[ -n "$CLEAN_ROOM" ]]; then
  req DELETE "/api/rooms/$CLEAN_ROOM/permanent" "" "$LTOKEN"
  check "can hard-delete a room with no applications" 200 "$STATUS" "$BODY"

  req GET "/api/rooms/$CLEAN_ROOM" "" "$LTOKEN"
  check "the deleted room is gone entirely" 404 "$STATUS" "$BODY"

  # This asserted 403, on the reasoning that LandlordGuard stopped a tenant
  # before ownership was ever checked. Since Phase 6 a tenant passes the guard
  # — they can hold listings — and fails on ownership instead, which answers
  # 404. That is the better answer anyway: a miss rather than a refusal does not
  # confirm to a stranger that the room id they tried is real. What is being
  # checked is unchanged — they cannot delete somebody else's listing — so the
  # expectation moves rather than the check going away.
  req DELETE "/api/rooms/$CLEAN_ROOM/permanent" "" "$TTOKEN"
  check "a tenant cannot hard-delete a landlord's room (a miss, not a refusal)" 404 "$STATUS" "$BODY"
  if [[ -n "$TENANT_ROOM" ]]; then
    # And the guard is not simply absent: their OWN listing deletes, which is
    # what distinguishes "ownership refused" from "nothing is enforced".
    req DELETE "/api/rooms/$TENANT_ROOM/permanent" "" "$TTOKEN"
    check "…while their own listing deletes, so the check is ownership and not role" 200 "$STATUS" "$BODY"
  fi

  # A different landlord gets past the guard and must then fail on ownership.
  if [[ -n "${OTHER_LTOKEN:-}" ]]; then
    req DELETE "/api/rooms/$CLEAN_ROOM/permanent" "" "$OTHER_LTOKEN"
    check "another landlord CANNOT hard-delete someone else's room" 404 "$STATUS" "$BODY"
  fi
fi


# -- 39. Phone verification -------------------------------------------------
# Without this step phoneVerified is never true, and phone sign-in can never
# find an account — which is how it originally shipped.
head_ "39. Phone verification"
# The login response must carry the phone too — settings reads the user signal,
# which is populated from login, not only from /auth/me.
# Login must issue the refresh cookie. Without it every page reload signs the
# person out, and the failure is invisible from the API response.
LOGIN_HEADERS=$(curl -s -D - -o /dev/null -X POST "$API/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$LANDLORD_EMAIL\",\"password\":\"$PASSWORD\"}" 2>/dev/null)
# A 429 here is the limiter, not a missing cookie — see check() for why that is
# a named skip rather than a failure.
if echo "$LOGIN_HEADERS" | grep -qi 'set-cookie:.*rb_refresh'; then
  green "  PASS  login issues the refresh cookie"; PASS=$((PASS+1))
elif echo "$LOGIN_HEADERS" | grep -qi '^HTTP/[0-9.]* 429'; then
  skipped "login refresh cookie — rate limited (429); wait out the 15-minute window or restart the API"
else
  red "  FAIL  login sets no rb_refresh cookie — reloads will sign people out"; FAIL=$((FAIL+1))
fi

req POST /api/auth/login "{\"email\":\"$LANDLORD_EMAIL\",\"password\":\"$PASSWORD\"}"
if echo "$BODY" | jq -e '.user | has("phone")' >/dev/null 2>&1; then
  green "  PASS  the login response carries phone"; PASS=$((PASS+1))
elif [[ "$STATUS" == "429" ]]; then
  skipped "login response carries phone — rate limited (429); wait out the 15-minute window or restart the API"
else
  red "  FAIL  login omits phone — settings shows a blank field after signing in"; FAIL=$((FAIL+1))
fi

req GET /api/auth/me "" "$LTOKEN"
if echo "$BODY" | jq -e 'has("phone") and has("phoneVerified")' >/dev/null 2>&1; then
  green "  PASS  /auth/me returns phone and phoneVerified"; PASS=$((PASS+1))
else
  red "  FAIL  /auth/me omits phone — settings will look unsaved after reload"; FAIL=$((FAIL+1))
fi

req PATCH /api/users/me '{"phone":"0821234567"}' "$LTOKEN"
check "save a phone number" 200 "$STATUS" "$BODY"

# Stored canonically, so verification and sign-in match the same string. Two
# forms of one number is what silently broke phone sign-in.
req GET /api/auth/me "" "$LTOKEN"
SAVED_PHONE=$(echo "$BODY" | jq -r '.phone // ""')
if [[ "$SAVED_PHONE" == "+27821234567" ]]; then
  green "  PASS  the number is stored in canonical +27 form"; PASS=$((PASS+1))
else
  red "  FAIL  saved number came back as '$SAVED_PHONE', expected +27821234567"; FAIL=$((FAIL+1))
fi

# Saving the same number in a different format must not look like a change.
req PATCH /api/users/me '{"phone":"+27821234567"}' "$LTOKEN"
SAME=$(echo "$BODY" | jq -r '.phone')
if [[ "$SAME" == "+27821234567" ]]; then
  green "  PASS  the same number in another format stays canonical"; PASS=$((PASS+1))
else
  red "  FAIL  reformatting the number produced '$SAME'"; FAIL=$((FAIL+1))
fi

# Saving a number must NOT be enough to sign in with it. Read from its own
# request: BODY is global and the next call overwrites it, which is exactly how
# this assertion ended up reading a 400 error body.
req GET /api/auth/me "" "$LTOKEN"
VERIFIED_FLAG=$(echo "$BODY" | jq -r '.phoneVerified')
if [[ "$VERIFIED_FLAG" == "false" ]]; then
  green "  PASS  a saved number is not verified by default"; PASS=$((PASS+1))
else
  red "  FAIL  phoneVerified is $VERIFIED_FLAG on a number nobody confirmed"; FAIL=$((FAIL+1))
fi

req PATCH /api/users/me '{"phone":"12345"}' "$LTOKEN"
check "rejects a malformed number on save" 400 "$STATUS" "$BODY"

req POST /api/auth/phone/verify-number "" "$LTOKEN"
if [[ "$STATUS" == "200" || "$STATUS" == "400" ]]; then
  green "  PASS  verification request handled  ($STATUS)"; PASS=$((PASS+1))
else
  red "  FAIL  verification request returned $STATUS"; FAIL=$((FAIL+1))
fi

req POST /api/auth/phone/confirm-number '{"code":"000000"}' "$LTOKEN"
check "rejects a wrong verification code" 400 "$STATUS" "$BODY"

req POST /api/auth/phone/verify-number ""
check "verification requires auth" 401 "$STATUS"


# -- 40. Refresh token rotation and races ----------------------------------
# A 401 must not revoke the refresh token. The interceptor used to call logout
# on any 401, which destroyed the session it was about to restore.
# Rotation must stop a stolen token without signing people out for a race that
# a browser creates routinely.
head_ "40. Refresh rotation"
RT_COOKIES=$(mktemp)
curl -s -c "$RT_COOKIES" -o /dev/null -X POST "$API/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$LANDLORD_EMAIL\",\"password\":\"$PASSWORD\"}" 2>/dev/null
OLD_RT=$(grep rb_refresh "$RT_COOKIES" | awk '{print $NF}')

if [[ -n "$OLD_RT" ]]; then
  green "  PASS  login issued a refresh token"; PASS=$((PASS+1))

  # First use rotates it.
  RT1=$(curl -s -b "$RT_COOKIES" -c "$RT_COOKIES" -o /dev/null -w '%{http_code}' \
    -X POST "$API/api/auth/refresh" -H 'Content-Type: application/json' -d '{}' 2>/dev/null)
  if [[ "$RT1" == "200" || "$RT1" == "201" ]]; then
    green "  PASS  first refresh succeeds and rotates"; PASS=$((PASS+1))
  else
    red "  FAIL  first refresh returned $RT1"; FAIL=$((FAIL+1))
  fi

  # Immediately replaying the consumed token is a race, not theft: it must
  # return a session rather than revoking everything.
  # Sent as a header rather than a cookie jar. A jar file has to name the
  # domain, and hardcoding 'localhost' meant the cookie was silently dropped
  # against a deployed API — the request arrived with no token at all and the
  # 401 looked like the grace window failing.
  RT2=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Cookie: rb_refresh=$OLD_RT" \
    -X POST "$API/api/auth/refresh" -H 'Content-Type: application/json' -d '{}' 2>/dev/null)
  if [[ "$RT2" == "200" || "$RT2" == "201" ]]; then
    green "  PASS  replaying the just-rotated token is treated as a race"; PASS=$((PASS+1))
  else
    red "  FAIL  a refresh race returned $RT2 — this signs people out on reload"; FAIL=$((FAIL+1))
  fi

  # And the session survives it.
  RT3=$(curl -s -b "$RT_COOKIES" -o /dev/null -w '%{http_code}' \
    -X POST "$API/api/auth/refresh" -H 'Content-Type: application/json' -d '{}' 2>/dev/null)
  if [[ "$RT3" == "200" || "$RT3" == "201" ]]; then
    green "  PASS  the current session still works after the race"; PASS=$((PASS+1))
  else
    red "  FAIL  the race revoked the live session (got $RT3)"; FAIL=$((FAIL+1))
  fi

fi
rm -f "$RT_COOKIES"


# -- 41. Available-now filter ----------------------------------------------
# The urgent search: someone whose lease has ended. The filter and the card
# badge must use the same window, or one contradicts the other.
head_ "41. Available now"
req GET "/api/rooms?availableNow=true"
check "availableNow filter is accepted" 200 "$STATUS" "$BODY"

NOW_TOTAL=$(echo "$BODY" | jq -r '.total // 0')
req GET /api/rooms
ALL_TOTAL=$(echo "$BODY" | jq -r '.total // 0')

if [[ "$NOW_TOTAL" -le "$ALL_TOTAL" ]]; then
  green "  PASS  it narrows the board ($NOW_TOTAL of $ALL_TOTAL)"; PASS=$((PASS+1))
else
  red "  FAIL  availableNow returned MORE rooms than no filter"; FAIL=$((FAIL+1))
fi

# Every room it returns must genuinely be available inside the window.
req GET "/api/rooms?availableNow=true&limit=20"
CUTOFF=$(date -u -d '+14 days' +%Y-%m-%d 2>/dev/null || date -u -v+14d +%Y-%m-%d)
LATE=$(echo "$BODY" | jq -r --arg c "$CUTOFF" '[.data[]? | select(.availableFrom > $c)] | length')
if [[ "$LATE" == "0" ]]; then
  green "  PASS  every result is available within the fortnight"; PASS=$((PASS+1))
else
  red "  FAIL  $LATE result(s) are not available until after $CUTOFF"; FAIL=$((FAIL+1))
fi

# It must combine with other filters rather than replacing them.
req GET "/api/rooms?availableNow=true&province=Gauteng"
check "combines with a province filter" 200 "$STATUS" "$BODY"


# -- 42. Renter's Passport — informal-economy verification ------------------
# The checks that replace a credit check. The assertions that matter are the
# negative ones: that a tenant cannot submit a landlord's document, that
# nothing a tenant submits carries a fee, and that a Passport needs BOTH
# halves — an income proof alone must not earn one.
head_ "42. Renter's Passport (informal verification)"

req GET /api/verification/types "" "$TTOKEN"
check "verification types are offered per role" 200 "$STATUS" "$BODY"
if echo "$BODY" | jq -e 'map(.type)|sort == ["bank_statement","employer_confirmation","identity","landlord_reference","sassa_grant"]' >/dev/null 2>&1; then
  green "  PASS  tenant is offered identity plus the four income proofs"; PASS=$((PASS+1))
else
  red "  FAIL  wrong tenant type list: $(echo "$BODY" | jq -c 'map(.type)')"; FAIL=$((FAIL+1))
fi
if echo "$BODY" | jq -e 'all(.requiresPayment == false)' >/dev/null 2>&1; then
  green "  PASS  nothing a tenant submits carries a fee"; PASS=$((PASS+1))
else
  red "  FAIL  a tenant verification type wants payment — free to apply is broken"; FAIL=$((FAIL+1))
fi

req POST /api/verification '{"type":"proof_of_ownership","documentPath":"private/verification/x.jpg"}' "$TTOKEN"
check "a tenant cannot submit a landlord's document" 400 "$STATUS" "$BODY"
req POST /api/verification '{"type":"sassa_grant"}' "$TTOKEN"
check "a document type without a document is refused" 400 "$STATUS" "$BODY"
req POST /api/verification '{"type":"landlord_reference"}' "$TTOKEN"
check "a reference without a referee is refused" 400 "$STATUS" "$BODY"

req POST /api/verification '{"type":"sassa_grant","documentPath":"private/verification/smoke-sassa.jpg"}' "$TTOKEN"
check "SASSA confirmation submitted" 201 "$STATUS" "$BODY"
SASSA_ID=$(echo "$BODY" | jq -r '.id // empty')
if [[ "$(echo "$BODY" | jq -r '.status')" == "pending" ]]; then
  green "  PASS  goes straight to the review queue, no payment step"; PASS=$((PASS+1))
else
  red "  FAIL  tenant proof is waiting for payment"; FAIL=$((FAIL+1))
fi

req POST /api/verification '{"type":"identity","documentPath":"private/verification/smoke-id.jpg"}' "$TTOKEN"
check "tenant identity submitted" 201 "$STATUS" "$BODY"
ID_ID=$(echo "$BODY" | jq -r '.id // empty')

# The audit trail — what makes a badge more than a boolean.
req GET "/api/verification/mine/$SASSA_ID/history" "" "$TTOKEN"
if echo "$BODY" | jq -e '.[0].step == "submitted" and .[0].actor == "applicant"' >/dev/null 2>&1; then
  green "  PASS  audit trail opens with the applicant's own submission"; PASS=$((PASS+1))
else
  red "  FAIL  no submitted event on the trail: $BODY"; FAIL=$((FAIL+1))
fi

if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  req PATCH "/api/verification/$SASSA_ID/review" '{"status":"approved"}' "$ADMIN_TOKEN"
  check "admin approves the income proof" 200 "$STATUS" "$BODY"
  # Asserts the promise this response can actually keep: the document is out of
  # view and the moment is recorded. It used to read `documentDeletedAt != null`
  # and call that "document deleted (POPIA s.26)" — which was false, because
  # nothing deleted anything from ImageKit. The column is `documentWithdrawnAt`
  # now and the bytes are tracked separately.
  #
  # This check has ALWAYS been behind ADMIN_TOKEN, so the one assertion in the
  # suite covering the retention promise had never run. That is how the gap
  # survived: a skipped check reads exactly like a passing one at a glance.
  if echo "$BODY" | jq -e '.documentPath == null and .documentWithdrawnAt != null' >/dev/null 2>&1; then
    green "  PASS  document out of view on decision, timestamped (POPIA s.26)"; PASS=$((PASS+1))
  else
    red "  FAIL  document still reachable after the decision"; FAIL=$((FAIL+1))
  fi
  # And that the trail says the honest thing. Storage deletion is proven
  # end to end in scripts/storage-drive.mjs, which drives a stub ImageKit and
  # checks a DELETE actually goes out for the right file.
  # The submitter's own trail, so the tenant's token — this endpoint is
  # deliberately not an admin one: the person the document is about is who the
  # trail is for.
  req GET "/api/verification/mine/$SASSA_ID/history" "" "$TTOKEN"
  if echo "$BODY" | jq -e '[.[] | select(.step == "document_withdrawn")] | length > 0' >/dev/null 2>&1; then
    green "  PASS  the trail records the document withdrawn, not a deletion it cannot yet confirm"; PASS=$((PASS+1))
  else
    red "  FAIL  no document_withdrawn step in the trail: $(echo "$BODY" | jq -c '[.[].step]' 2>/dev/null)"; FAIL=$((FAIL+1))
  fi

  req GET "/api/verification/badge/$TENANT_ID" "" "$TTOKEN"
  if echo "$BODY" | jq -e '.hasPassport == false' >/dev/null 2>&1; then
    green "  PASS  income proof alone does not earn a Passport"; PASS=$((PASS+1))
  else
    red "  FAIL  Passport granted on income alone"; FAIL=$((FAIL+1))
  fi

  req PATCH "/api/verification/$ID_ID/review" '{"status":"approved"}' "$ADMIN_TOKEN"
  check "admin approves the identity check" 200 "$STATUS" "$BODY"

  req GET "/api/verification/badge/$TENANT_ID" "" "$TTOKEN"
  if echo "$BODY" | jq -e '.hasPassport == true and (.checks|length) == 2' >/dev/null 2>&1; then
    green "  PASS  identity + income earns the Passport, and the badge lists its basis"; PASS=$((PASS+1))
  else
    red "  FAIL  Passport not granted: $BODY"; FAIL=$((FAIL+1))
  fi

  # Three steps, not two, and the order matters. `document_withdrawn` is written
  # in the decision's own transaction; `document_deleted` only once the storage
  # provider confirms the bytes are gone. Requiring BOTH is what makes this
  # assertion mean something — the version that only asked for a timestamp we set
  # ourselves passed for the entire period during which nothing was ever deleted.
  req GET "/api/verification/mine/$SASSA_ID/history" "" "$TTOKEN"
  TRAIL_STEPS=$(echo "$BODY" | jq -c 'map(.step)' 2>/dev/null)
  # Always true, and true in the decision's own transaction.
  if echo "$BODY" | jq -e 'map(.step)|(index("approved") != null and index("document_withdrawn") != null)' >/dev/null 2>&1; then
    green "  PASS  the decision and the document's withdrawal are both on the trail"; PASS=$((PASS+1))
  else
    red "  FAIL  trail is missing the decision or the withdrawal — got: $TRAIL_STEPS"; FAIL=$((FAIL+1))
  fi
  # And the stronger claim, only where storage exists to make it of.
  if [[ -n "${STORAGE_LIVE:-}" ]]; then
    if echo "$BODY" | jq -e 'map(.step)|index("document_deleted") != null' >/dev/null 2>&1; then
      green "  PASS  and the file's deletion is CONFIRMED on it, not assumed"; PASS=$((PASS+1))
    else
      red "  FAIL  no confirmed deletion on the trail — got: $TRAIL_STEPS"; FAIL=$((FAIL+1))
      grey "        the privacy policy, the PAIA manual and the tenant upload screen all say this file is deleted"
      # Names the cause instead of leaving it to be guessed. Credentials being
      # present does not mean the management API is REACHABLE — and the queue
      # already records exactly why the attempt failed.
      req GET /api/admin/storage/status "" "$ADMIN_TOKEN"
      grey "        storage queue says: $(echo "$BODY" | jq -r '"outstanding=\(.outstanding) stuck=\(.stuck) lastError=\(.oldestError // "none")"' 2>/dev/null)"
    fi
  else
    skipped "confirmed deletion — ImageKit is not configured, so nothing CAN be deleted here"
    grey "        that is not a pass: on a server in this state the retention promise is not being kept"
  fi
else
  skipped "Passport review steps — set ADMIN_TOKEN to include them"
fi

# -- 43. Post-tenancy dispute flags ----------------------------------------
# Reduced visibility, never removal. The assertion that matters is the last
# one: a flagged landlord's room is still on the board.
head_ "43. Post-tenancy flags"

req POST "/api/tenancies/$(uuidgen 2>/dev/null || echo 00000000-0000-0000-0000-000000000000)/flag" \
  '{"reason":"deposit_withheld","detail":"A complaint about a tenancy that does not exist at all."}' "$TTOKEN"
if [[ "$STATUS" == "404" || "$STATUS" == "400" ]]; then
  green "  PASS  cannot flag a tenancy that does not exist ($STATUS)"; PASS=$((PASS+1))
else
  red "  FAIL  flagging an unknown tenancy returned $STATUS"; FAIL=$((FAIL+1))
fi

req GET /api/tenancies/flags/mine "" "$TTOKEN"
check "a tenant can list the reports they have raised" 200 "$STATUS" "$BODY"

req GET /api/tenancies/flags/open "" "$TTOKEN"
check "a non-admin cannot read the flag queue" 403 "$STATUS" "$BODY"

if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  req GET /api/tenancies/flags/open "" "$ADMIN_TOKEN"
  check "admin can read the flag queue" 200 "$STATUS" "$BODY"
  req PATCH /api/tenancies/flags/recount "" "$ADMIN_TOKEN"
  if echo "$BODY" | jq -e '.corrected == 0' >/dev/null 2>&1; then
    green "  PASS  openFlagCount has not drifted from the flags themselves"; PASS=$((PASS+1))
  else
    red "  FAIL  visibility counter drifted: $BODY"; FAIL=$((FAIL+1))
  fi
else
  skipped "flag queue checks — set ADMIN_TOKEN to include them"
fi

# -- 44. WhatsApp webhook signature -----------------------------------------
# This handler verified nothing until v1.57.0: anyone who found the URL could
# post a payload and have it written into a landlord and tenant's private
# conversation as though the other party had sent it. The assertion that
# matters is that an unsigned delivery is refused — 200 here is the bug.
head_ "44. WhatsApp webhook signature"

WA_BODY='{"entry":[{"changes":[{"value":{"messages":[{"id":"wamid.smoke","text":{"body":"hi"}}]}}]}]}'
WA_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/whatsapp/webhook" \
  -H 'Content-Type: application/json' -d "$WA_BODY" 2>/dev/null)
if [[ "$WA_STATUS" == "403" ]]; then
  green "  PASS  unsigned WhatsApp webhook is refused  (403)"; PASS=$((PASS+1))
else
  red "  FAIL  unsigned WhatsApp webhook returned $WA_STATUS; 403 expected, never 200"; FAIL=$((FAIL+1))
fi

if [[ -n "${WHATSAPP_APP_SECRET:-}" ]]; then
  WA_SIG="sha256=$(printf '%s' "$WA_BODY" \
    | openssl dgst -sha256 -hmac "$WHATSAPP_APP_SECRET" -hex | awk '{print $NF}')"
  WA_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/whatsapp/webhook" \
    -H 'Content-Type: application/json' -H "x-hub-signature-256: $WA_SIG" -d "$WA_BODY" 2>/dev/null)
  if [[ "$WA_STATUS" == "200" ]]; then
    green "  PASS  a correctly signed delivery is accepted  (200)"; PASS=$((PASS+1))
  else
    red "  FAIL  signed WhatsApp webhook returned $WA_STATUS, expected 200"; FAIL=$((FAIL+1))
  fi

  # Signed for a different body — the tamper that matters.
  WA_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/whatsapp/webhook" \
    -H 'Content-Type: application/json' -H "x-hub-signature-256: $WA_SIG" \
    -d "${WA_BODY/hi/forged}" 2>/dev/null)
  if [[ "$WA_STATUS" == "403" ]]; then
    green "  PASS  a tampered body is refused despite a real signature  (403)"; PASS=$((PASS+1))
  else
    red "  FAIL  tampered WhatsApp body returned $WA_STATUS, expected 403"; FAIL=$((FAIL+1))
  fi
else
  skipped "signed-delivery checks — set WHATSAPP_APP_SECRET to the API's own to include them"
fi

# -- 45. Yards (multi-room properties) --------------------------------------
# A six-room yard was six unrelated listings until v1.57.0. The assertions
# that matter are the two destructive ones: a mixed batch must apply nothing
# rather than half, and deleting a yard must leave its rooms on the board.
head_ "45. Yards"

req POST /api/properties '{"name":"Smoke yard","suburb":"Tembisa","city":"Johannesburg","province":"Gauteng"}' "$LTOKEN"
check "landlord creates a yard" 201 "$STATUS" "$BODY"
YARD_ID=$(echo "$BODY" | jq -r '.id // empty')

req POST /api/properties '{"name":"Tenant yard","city":"Johannesburg","province":"Gauteng"}' "$TTOKEN"
check "a tenant cannot create a yard" 403 "$STATUS" "$BODY"

# ── Shared living, which belongs to the address and not to each room ───────
#
# Four rooms at one address have one kitchen, one set of rules and one group of
# housemates. Held per-room they get typed four times and the copies drift, in
# front of tenants deciding where to live.
req POST /api/properties '{"name":"Shared yard","city":"Johannesburg","province":"Gauteng","houseRules":"Gate locked at 21:00.","sharedAmenities":["Shared kitchen","Outside tap"],"currentHousemates":4,"housemateProfile":"mixed"}' "$LTOKEN"
check "a yard carries house rules, shared amenities and who lives there" 201 "$STATUS" "$BODY"
SHARED_YARD=$(echo "$BODY" | jq -r '.id // empty')
if echo "$BODY" | jq -e '.houseRules != null and (.sharedAmenities | length) == 2 and .currentHousemates == 4 and .housemateProfile == "mixed"' >/dev/null 2>&1; then
  green "  PASS  all four shared-living fields persisted"; PASS=$((PASS+1))
else
  red "  FAIL  shared-living fields did not persist: $(echo "$BODY" | jq -c '{houseRules,sharedAmenities,currentHousemates,housemateProfile}')"; FAIL=$((FAIL+1))
fi

# Saying nothing must stay "unstated" rather than becoming a claim about who a
# tenant would be living with.
req POST /api/properties '{"name":"Quiet yard","city":"Durban","province":"KwaZulu-Natal"}' "$LTOKEN"
if echo "$BODY" | jq -e '.housemateProfile == "unstated"' >/dev/null 2>&1; then
  green "  PASS  an unanswered housemate profile is 'unstated', not a guess"; PASS=$((PASS+1))
else
  red "  FAIL  default housemateProfile was $(echo "$BODY" | jq -r '.housemateProfile')"; FAIL=$((FAIL+1))
fi

if [[ -n "$SHARED_YARD" ]]; then
  # Editing one field must leave the rest alone.
  req PATCH "/api/properties/$SHARED_YARD" '{"houseRules":"Gate locked at 22:00."}' "$LTOKEN"
  if echo "$BODY" | jq -e '.houseRules == "Gate locked at 22:00." and (.sharedAmenities | length) == 2' >/dev/null 2>&1; then
    green "  PASS  editing house rules leaves the shared amenities alone"; PASS=$((PASS+1))
  else
    red "  FAIL  a single-field edit clobbered the others"; FAIL=$((FAIL+1))
  fi

  # Bulk relist: a yard empties at month end and six rooms is six trips.
  # A room already on the board is SKIPPED, not an error — otherwise the
  # button is useless in exactly the mixed case it is for.
  req POST "/api/properties/$SHARED_YARD/relist-all" "" "$LTOKEN"
  check "bulk relist runs on a yard" 201 "$STATUS" "$BODY"
  if echo "$BODY" | jq -e 'has("relisted") and has("skipped")' >/dev/null 2>&1; then
    green "  PASS  bulk relist reports what it did and what it skipped"; PASS=$((PASS+1))
  else
    red "  FAIL  bulk relist result names neither relisted nor skipped"; FAIL=$((FAIL+1))
  fi

  req POST "/api/properties/$SHARED_YARD/relist-all" "" "$TTOKEN"
  check "a tenant cannot bulk relist" 403 "$STATUS" "$BODY"

  req POST "/api/properties/$SHARED_YARD/relist-all" "" "$OTHER_LTOKEN"
  check "another landlord cannot bulk relist your yard" 403 "$STATUS" "$BODY"

  # A tenant reading a room must see what the house is like — and must NOT see
  # the yard's private nickname, which is the landlord's own dashboard label.
  if [[ -n "$ROOM_ID" ]]; then
    req POST "/api/properties/$SHARED_YARD/rooms" "{\"roomIds\":[\"$ROOM_ID\"]}" "$LTOKEN"
    req GET "/api/rooms/$ROOM_ID"
    if echo "$BODY" | jq -e '.property.houseRules != null and (.property.sharedAmenities | length) > 0' >/dev/null 2>&1; then
      green "  PASS  a room page carries the house rules and shared facilities"; PASS=$((PASS+1))
    else
      red "  FAIL  the room detail does not carry shared living: $(echo "$BODY" | jq -c '.property')"; FAIL=$((FAIL+1))
    fi
    if echo "$BODY" | jq -e '.property | has("name") | not' >/dev/null 2>&1; then
      green "  PASS  and not the yard's private nickname"; PASS=$((PASS+1))
    else
      red "  FAIL  the yard's internal name is exposed on the public room page"; FAIL=$((FAIL+1))
    fi
  fi
fi

req GET /api/properties/dashboard "" "$LTOKEN"
check "yard dashboard returns" 200 "$STATUS" "$BODY"
if echo "$BODY" | jq -e 'has("properties") and has("ungrouped") and has("totals")' >/dev/null 2>&1; then
  green "  PASS  dashboard carries yards, ungrouped rooms and portfolio totals"; PASS=$((PASS+1))
else
  red "  FAIL  dashboard shape is wrong: $(echo "$BODY" | jq -c 'keys')"; FAIL=$((FAIL+1))
fi

if [[ -n "$YARD_ID" && -n "$ROOM_ID" ]]; then
  req POST "/api/properties/$YARD_ID/rooms" "{\"roomIds\":[\"$ROOM_ID\"]}" "$LTOKEN"
  check "a room moves into the yard" 200 "$STATUS" "$BODY"

  # A room that is not the caller's must fail the WHOLE batch. Half-applying
  # would leave a landlord believing a room moved when it did not.
  req POST "/api/properties/$YARD_ID/rooms" "{\"roomIds\":[\"$ROOM_ID\",\"00000000-0000-4000-8000-000000000000\"]}" "$LTOKEN"
  check "a batch containing a room that is not yours is refused whole" 400 "$STATUS" "$BODY"

  # Deleting the property must not delete the room — and since Phase 7b it must
  # not even be possible to ask for it without being told so. This check used to
  # expect 200 here, which encoded the old behaviour: the call went through and
  # the landlord found out afterwards what had happened to their rooms.
  req DELETE "/api/properties/$YARD_ID" "" "$LTOKEN"
  check "deleting a property with rooms in it is refused first" 400 "$STATUS" "$BODY"

  req DELETE "/api/properties/$YARD_ID?ungroupRooms=true" "" "$LTOKEN"
  check "and goes ahead once the caller confirms" 200 "$STATUS" "$BODY"
  req GET "/api/rooms/$ROOM_ID"
  if [[ "$STATUS" == "200" ]]; then
    green "  PASS  its room survived — a yard is a label, not an owner"; PASS=$((PASS+1))
  else
    red "  FAIL  deleting a yard destroyed its room ($STATUS)"; FAIL=$((FAIL+1))
  fi
else
  skipped "yard room assignment — no room to move"
fi

# -- 46. Rent tracking -------------------------------------------------------
# A record, not a payment system. The assertion that matters is the last one:
# a tenant's dispute must not overwrite the landlord's record, because neither
# is checked and the platform does not claim to know which is true.
head_ "46. Rent tracking"

req PATCH /api/properties/rent/settings '{"rentGraceDays":5}' "$LTOKEN"
check "landlord sets the reminder grace period" 200 "$STATUS" "$BODY"
req PATCH /api/properties/rent/settings '{"rentGraceDays":40}' "$LTOKEN"
check "an absurd grace period is refused" 400 "$STATUS" "$BODY"
req PATCH /api/properties/rent/settings '{"rentGraceDays":5}' "$TTOKEN"
check "a tenant cannot set a landlord's reminder settings" 403 "$STATUS" "$BODY"

req GET "/api/properties/rent/00000000-0000-4000-8000-000000000000" "" "$LTOKEN"
check "rent history for a tenancy that does not exist" 404 "$STATUS" "$BODY"

# The tenant's side (v1.71.0). The reminder tells them to "say so on
# Mastande", so the path that lets them has to keep working.
req PATCH "/api/properties/rent/period/00000000-0000-4000-8000-000000000000/dispute" '{"note":"Paid on the 3rd."}' "$TTOKEN"
check "disputing a month that does not exist" 404 "$STATUS" "$BODY"

req PATCH "/api/properties/rent/period/00000000-0000-4000-8000-000000000000/dispute" '{"note":"x"}'
check "disputing requires auth" 401 "$STATUS"

# Marking is the landlord's act; answering is the tenant's. Neither may do
# the other's, and a tenant marking their own rent paid would make the whole
# record worthless.
if [[ -n "$TEN_ID" ]]; then
  req PATCH "/api/properties/rent/$TEN_ID/mark" '{"periodStart":"2026-09-01T00:00:00.000Z","status":"paid"}' "$TTOKEN"
  check "a tenant cannot mark their own rent paid" 403 "$STATUS" "$BODY"

  req GET "/api/properties/rent/$TEN_ID" "" "$TTOKEN"
  check "a tenant can read their own rent record" 200 "$STATUS" "$BODY"
else
  skipped "tenant rent record — no tenancy was created earlier"
fi

if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  req POST /api/properties/rent/run-reminders "" "$ADMIN_TOKEN"
  check "the overdue-rent reminder pass runs" 200 "$STATUS" "$BODY"
  req POST /api/properties/rent/run-reminders "" "$LTOKEN"
  check "a landlord cannot trigger the reminder pass" 403 "$STATUS" "$BODY"
else
  skipped "reminder pass — set ADMIN_TOKEN to include it"
fi

# -- 47. WhatsApp-first listing creation ------------------------------------
# A landlord sends photos and a sentence to the number and finds a draft
# waiting on the web. The assertions that matter are the two that stop it
# being abused: an unverified number creates nothing, and nothing a bot
# parses ever reaches the board by itself.
head_ "47. WhatsApp listing bot"

req GET /api/whatsapp/drafts "" "$LTOKEN"
check "landlord can list their WhatsApp drafts" 200 "$STATUS" "$BODY"
req GET /api/whatsapp/drafts "" "$TTOKEN"
check "a tenant cannot" 403 "$STATUS" "$BODY"

req POST "/api/whatsapp/drafts/00000000-0000-4000-8000-000000000000/claim" "" "$LTOKEN"
check "claiming a draft that is not yours is refused" 404 "$STATUS" "$BODY"

if [[ -n "${WHATSAPP_APP_SECRET:-}" ]]; then
  # A signed inbound message from a number with no verified landlord behind
  # it must not create anything.
  WA_PAYLOAD='{"entry":[{"changes":[{"value":{"contacts":[{"wa_id":"27820000001"}],"messages":[{"id":"wamid.smokebot","from":"27820000001","type":"text","text":{"body":"En suite room in Tembisa R3500"}}]}}]}]}'
  WA_SIG="sha256=$(printf '%s' "$WA_PAYLOAD" \
    | openssl dgst -sha256 -hmac "$WHATSAPP_APP_SECRET" -hex | awk '{print $NF}')"
  WA_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/whatsapp/webhook" \
    -H 'Content-Type: application/json' -H "x-hub-signature-256: $WA_SIG" -d "$WA_PAYLOAD" 2>/dev/null)
  if [[ "$WA_STATUS" == "200" ]]; then
    green "  PASS  a signed message from an unknown number is accepted and dropped  (200)"; PASS=$((PASS+1))
  else
    red "  FAIL  signed bot message returned $WA_STATUS, expected 200"; FAIL=$((FAIL+1))
  fi

  req GET /api/whatsapp/drafts "" "$LTOKEN"
  if echo "$BODY" | jq -e 'length == 0' >/dev/null 2>&1; then
    green "  PASS  an unverified number creates no draft for anyone"; PASS=$((PASS+1))
  else
    red "  FAIL  a draft appeared from an unverified number: $(echo "$BODY" | jq -c 'length')"; FAIL=$((FAIL+1))
  fi
else
  skipped "inbound bot message — set WHATSAPP_APP_SECRET to include it"
fi

# -- 48. The refund promise -------------------------------------------------
# The pricing page says "if we cannot verify you, you are refunded in full".
# Until v1.59.0 nothing in the code kept that — an admin had to remember.
#
# What is asserted here is what HTTP can reach. Reaching a *paid* check needs a
# valid PayFast ITN, and validating one needs PayFast to confirm it
# server-to-server, so the full paid → rejected → refunded path lives in
# scripts/refund-drive.mjs, which seeds that one row directly. Everything below
# runs on every suite.
head_ "48. The refund promise"

req GET /api/payments/refunds-due "" "$LTOKEN"
check "a landlord cannot read the refunds queue" 403 "$STATUS" "$BODY"

req GET /api/payments/refunds-due "" "$TTOKEN"
check "nor can a tenant" 403 "$STATUS" "$BODY"

req GET /api/payments/refunds-due
check "nor can a stranger" 401 "$STATUS"

if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  req GET /api/payments/refunds-due "" "$ADMIN_TOKEN"
  check "admin can read it" 200 "$STATUS" "$BODY"

  # Nothing in the queue may be settled already. A refund that shows up after
  # the money went back is how someone gets paid twice.
  SETTLED=$(echo "$BODY" | jq -r '[.[]? | select(.refundDueAt == null)] | length')
  if [[ "$SETTLED" == "0" ]]; then
    green "  PASS  every row in the queue is actually owed"; PASS=$((PASS+1))
  else
    red "  FAIL  $SETTLED rows with no refundDueAt"; FAIL=$((FAIL+1))
  fi

  # A tenant's checks are free, so rejecting one must never owe anybody money.
  # This is the guard on "free to apply, always" from the money side.
  req POST /api/verification '{"type":"sassa_grant","documentPath":"private/verification/refund-guard.jpg"}' "$TTOKEN"
  FREE_VR=$(echo "$BODY" | jq -r '.id // empty')
  if [[ -n "$FREE_VR" ]]; then
    req PATCH "/api/verification/$FREE_VR/review" '{"status":"rejected","reviewNote":"Not legible — testing that a free check owes nothing."}' "$ADMIN_TOKEN"
    check "a free check can be rejected" 200 "$STATUS" "$BODY"

    req GET "/api/verification/mine/$FREE_VR/history" "" "$TTOKEN"
    OWED=$(echo "$BODY" | jq -r '[.[]? | select(.step == "refund_due")] | length')
    if [[ "$OWED" == "0" ]]; then
      green "  PASS  rejecting a free check owes nobody a refund"; PASS=$((PASS+1))
    else
      red "  FAIL  a free check created a refund obligation"; FAIL=$((FAIL+1))
    fi
  else
    skipped "tenant already has a SASSA check from an earlier section"
  fi
else
  skipped "refunds queue contents — set ADMIN_TOKEN to include them"
fi


# ── Private tenant notes and the calendar (Phase 5e / 5f) ──────────────────
#
# The privacy boundary is the feature. Cross-landlord isolation and the
# can-only-note-someone-you-have-dealt-with rule are checked properly in
# scripts/notes-calendar-drive.mjs, which needs two landlords and an admin.
head_ "Private notes and calendar"

# A note about someone this landlord has never dealt with must be refused —
# otherwise this endpoint is a way to keep a private file on any id you can guess.
req POST "/api/landlord/notes/tenant/$TENANT_ID" '{"body":"testing the boundary"}' "$LTOKEN"
if [[ "$STATUS" == "403" || "$STATUS" == "201" ]]; then
  if [[ "$STATUS" == "403" ]]; then
    green "  PASS  a note about someone you have not dealt with is refused  (403)"; PASS=$((PASS+1))
  else
    green "  PASS  a note about your own applicant is written  (201)"; PASS=$((PASS+1))
  fi
else
  red "  FAIL  note write returned $STATUS: $(echo "$BODY" | head -c 200)"; FAIL=$((FAIL+1))
fi

req GET /api/landlord/notes "" "$LTOKEN"
check "a landlord reads their own notes, grouped by person" 200 "$STATUS" "$BODY"
req GET /api/landlord/notes "" "$TTOKEN"
check "a tenant has no notes endpoint" 403 "$STATUS" "$BODY"
req GET /api/landlord/notes "" ""
check "nor does a stranger" 401 "$STATUS" "$BODY"

req GET /api/landlord/calendar "" "$LTOKEN"
check "the calendar answers" 200 "$STATUS" "$BODY"
# Days, not timestamps. "Rent is due on the 1st" rendered as an instant shows a
# South African landlord the 31st.
if echo "$BODY" | jq -e 'all(.date | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$"))' >/dev/null 2>&1; then
  green "  PASS  every date is a plain day, not a timestamp"; PASS=$((PASS+1))
else
  red "  FAIL  a calendar date is not YYYY-MM-DD: $(echo "$BODY" | jq -c '[.[].date] | .[0:3]')"; FAIL=$((FAIL+1))
fi
# Any rent entry must disclaim collection — a calendar row that looks like a bill
# is exactly where someone would assume we take the money.
if echo "$BODY" | jq -e '[.[] | select(.kind == "rent_due")] | all(.detail | test("does not collect"))' >/dev/null 2>&1; then
  green "  PASS  and rent entries say Mastande does not collect it"; PASS=$((PASS+1))
else
  red "  FAIL  a rent entry does not disclaim collection"; FAIL=$((FAIL+1))
fi
req GET /api/landlord/calendar "" "$TTOKEN"
check "a tenant cannot open the landlord calendar" 403 "$STATUS" "$BODY"

# ── Landlord public storefront (Phase 5b / 5h) ─────────────────────────────
#
# The public page is an SEO surface, so what matters here is that it does not
# exist until its owner publishes it, and that a hidden one is indistinguishable
# from one that never existed. Slug collisions and the sitemap entry are checked
# properly in scripts/storefront-drive.mjs.
head_ "Landlord public storefront"

req GET /api/landlord/storefront "" "$LTOKEN"
check "a landlord can open their storefront settings" 200 "$STATUS" "$BODY"
SF_SLUG=$(echo "$BODY" | jq -r '.slug // empty')
if [[ -n "$SF_SLUG" ]] && echo "$SF_SLUG" | grep -qE '^[a-z0-9]+(-[a-z0-9]+)*$'; then
  green "  PASS  a readable slug is minted, not a uuid  ($SF_SLUG)"; PASS=$((PASS+1))
else
  red "  FAIL  slug is missing or not readable: $SF_SLUG"; FAIL=$((FAIL+1))
fi
if echo "$BODY" | jq -e '.storefrontLive == false' >/dev/null 2>&1; then
  green "  PASS  and it is OFF — no page about a person is published for them"; PASS=$((PASS+1))
else
  red "  FAIL  storefrontLive is not false before anyone published it"; FAIL=$((FAIL+1))
fi

# Unpublished and never-existed must be indistinguishable, or anyone can
# enumerate which landlords exist and which have hidden their page.
req GET "/api/storefronts/$SF_SLUG" "" ""
check "an unpublished storefront answers 404 to the public" 404 "$STATUS" "$BODY"
HIDDEN_MSG=$(echo "$BODY" | jq -c '.message' 2>/dev/null)
req GET "/api/storefronts/no-such-landlord-anywhere" "" ""
check "and so does a slug that never existed" 404 "$STATUS" "$BODY"
if [[ "$HIDDEN_MSG" == "$(echo "$BODY" | jq -c '.message' 2>/dev/null)" ]]; then
  green "  PASS  with the same message, so the two cannot be told apart"; PASS=$((PASS+1))
else
  red "  FAIL  hidden and nonexistent storefronts are distinguishable"; FAIL=$((FAIL+1))
fi

req PATCH /api/landlord/storefront '{"bio":"I have let rooms in this yard for eleven years.","storefrontLive":true}' "$LTOKEN"
check "the landlord publishes it themselves" 200 "$STATUS" "$BODY"
req GET "/api/storefronts/$SF_SLUG" "" ""
check "and the public page answers without a token" 200 "$STATUS" "$BODY"
if echo "$BODY" | jq -e '.badges | all(.basis | length > 10)' >/dev/null 2>&1; then
  green "  PASS  every badge says what it was awarded FROM"; PASS=$((PASS+1))
else
  red "  FAIL  a badge with no stated basis: $(echo "$BODY" | jq -c '.badges')"; FAIL=$((FAIL+1))
fi
# The trust page must not quote a response time it has not earned.
if echo "$BODY" | jq -e '(.typicalResponseHours == null) or (.responseFrom >= 3)' >/dev/null 2>&1; then
  green "  PASS  no response time quoted from fewer than 3 answered applications"; PASS=$((PASS+1))
else
  red "  FAIL  quoted $(echo "$BODY" | jq -c '.typicalResponseHours')h from $(echo "$BODY" | jq -c '.responseFrom')"; FAIL=$((FAIL+1))
fi
if echo "$BODY" | grep -q "$LANDLORD_EMAIL"; then
  red "  FAIL  the public storefront carries the landlord's email address"; FAIL=$((FAIL+1))
else
  green "  PASS  and no email address is on the public page"; PASS=$((PASS+1))
fi

req GET /api/landlord/storefront "" "$TTOKEN"
check "a tenant has no storefront settings" 403 "$STATUS" "$BODY"
req PATCH /api/landlord/storefront '{"bio":"x"}' ""
check "and a stranger cannot edit one" 401 "$STATUS" "$BODY"

# ── Landlord task inbox and portfolio health (Phase 5a / 5d) ───────────────
#
# An aggregation layer, so what is worth asserting here is authorisation and
# honesty about absent data — the ORDERING is where the value is, and that is
# checked properly in scripts/inbox-drive.mjs against a landlord with several
# competing situations at once, which is too much fixture for this suite.
head_ "Landlord task inbox"

req GET /api/landlord/inbox "" "$LTOKEN"
check "a landlord can read their own inbox" 200 "$STATUS" "$BODY"
if echo "$BODY" | jq -e 'has("items") and has("counts")' >/dev/null 2>&1; then
  green "  PASS  it carries both the list and the per-kind counts"; PASS=$((PASS+1))
else
  red "  FAIL  inbox shape: $(echo "$BODY" | head -c 200)"; FAIL=$((FAIL+1))
fi
# Every row must carry where its action goes. A template deciding that per kind
# is a template that gets one wrong the next time a kind is added.
if echo "$BODY" | jq -e '.items | all(has("actionPath") and has("actionLabel") and has("urgency"))' >/dev/null 2>&1; then
  green "  PASS  every row carries its own action and its urgency"; PASS=$((PASS+1))
else
  red "  FAIL  a row is missing actionPath/actionLabel/urgency"; FAIL=$((FAIL+1))
fi

req GET /api/landlord/health "" "$LTOKEN"
check "and their portfolio health" 200 "$STATUS" "$BODY"
# The point of 5d: a figure with too little behind it is absent, not rounded.
# Asserted as "if a percentage is quoted, it says what it is from" rather than a
# fixed expectation, because this landlord's data depends on earlier sections.
if echo "$BODY" | jq -e '(.paymentReliabilityPct == null) or (.paymentReliabilityFrom >= 3)' >/dev/null 2>&1; then
  green "  PASS  no payment-reliability figure is quoted from fewer than 3 months"; PASS=$((PASS+1))
else
  red "  FAIL  quoted $(echo "$BODY" | jq -c '.paymentReliabilityPct') from $(echo "$BODY" | jq -c '.paymentReliabilityFrom') month(s)"; FAIL=$((FAIL+1))
fi
if echo "$BODY" | jq -e '.summary | type == "string" and length > 20' >/dev/null 2>&1; then
  green "  PASS  and it reads as a sentence, not a row of figures"; PASS=$((PASS+1))
else
  red "  FAIL  summary is not a sentence: $(echo "$BODY" | jq -c '.summary')"; FAIL=$((FAIL+1))
fi

req GET /api/landlord/inbox "" "$TTOKEN"
check "a tenant cannot open the landlord inbox" 403 "$STATUS" "$BODY"
req GET /api/landlord/health "" ""
check "nor can a stranger read portfolio health" 401 "$STATUS" "$BODY"

# ⚠️ Phase 7d. Every row's destination comes from the API as a string, and
# /landlord/yard became a REDIRECT in v1.87.0 — which drops the fragment, so
# "Mark it" and "Decide on the lease" landed a landlord on a list of addresses.
# scripts/nav-audit.mjs resolves these statically now; this is the runtime half.
req GET /api/landlord/inbox "" "$LTOKEN"
if echo "$BODY" | jq -e '.items | any(.actionPath | startswith("/landlord/yard"))' >/dev/null 2>&1; then
  red "  FAIL  a task button still points at /landlord/yard, which only redirects"; FAIL=$((FAIL+1))
else
  green "  PASS  no task button points at /landlord/yard, a redirect since v1.87.0"; PASS=$((PASS+1))
fi

# ── The tenant's side of the same list (Phase 7d) ──────────────────────────
#
# The brief asks for the task inbox in BOTH portals. The tenant dashboard
# opened on three bare numbers, so an acceptance waiting on an answer, an
# unread message and a month the landlord had not recorded were each only
# visible on a different screen.
head_ "Tenant task inbox"

req GET /api/tenant-inbox "" "$TTOKEN"
check "a tenant can read their own task list" 200 "$STATUS" "$BODY"
if echo "$BODY" | jq -e 'has("items") and has("counts")' >/dev/null 2>&1; then
  green "  PASS  it carries both the list and the per-kind counts"; PASS=$((PASS+1))
else
  red "  FAIL  tenant inbox shape: $(echo "$BODY" | head -c 200)"; FAIL=$((FAIL+1))
fi
if echo "$BODY" | jq -e '.items | all(has("actionPath") and has("actionLabel") and has("urgency"))' >/dev/null 2>&1; then
  green "  PASS  every row carries its own action and its urgency"; PASS=$((PASS+1))
else
  red "  FAIL  a tenant row is missing actionPath/actionLabel/urgency"; FAIL=$((FAIL+1))
fi
# ⚠️ Mastande does not handle the money and has not checked whether it arrived.
# A tenant who paid in cash on the 1st being told by an app that they are in
# arrears is the one accusation this product must never make.
if echo "$BODY" | jq -e '[.items[] | select(.kind == "rent_unrecorded")] | all((.title + " " + (.detail // "")) | test("you have not paid|arrears|overdue"; "i") | not)' >/dev/null 2>&1; then
  green "  PASS  no rent row tells a tenant they have not paid — only that it is not recorded"; PASS=$((PASS+1))
else
  red "  FAIL  a rent row accuses the tenant: $(echo "$BODY" | jq -c '[.items[] | select(.kind == "rent_unrecorded")][0]')"; FAIL=$((FAIL+1))
fi

# 200-and-empty, not 403: a LANDLORD rents somewhere too, and a role guard here
# would hide their own lease and their own messages from them. The scoping is
# what keeps one person's tasks out of another's, so that is what is checked.
req GET /api/tenant-inbox "" "$LTOKEN"
check "a landlord may ask for theirs as a tenant" 200 "$STATUS" "$BODY"
req GET /api/tenant-inbox "" ""
check "a stranger cannot" 401 "$STATUS" "$BODY"

# ── This week's views (Phase 7d) ───────────────────────────────────────────
#
# ⚠️ rooms.viewCount is a LIFETIME integer, so the UX spec's own example
# sentence — "Your room has been viewed 47 times this week" — had no data under
# it: a room posted in June could show 200 views without one of them being this
# month, which is the only question a landlord with an empty room is asking.
# room_view_days is new; what matters is that it counts the right things.
head_ "This week's views"

req GET /api/rooms/my-rooms "" "$LTOKEN"
check "the landlord's own room list" 200 "$STATUS" "$BODY"
if echo "$BODY" | jq -e 'all(has("viewsLast7Days"))' >/dev/null 2>&1; then
  green "  PASS  every room carries a weekly figure — 0 included, so 'nobody looked' is not 'we do not know'"; PASS=$((PASS+1))
else
  red "  FAIL  a room has no viewsLast7Days: $(echo "$BODY" | jq -c '[.[] | {id, viewsLast7Days}] | .[0:3]')"; FAIL=$((FAIL+1))
fi

if [[ -n "$ROOM_ID" ]]; then
  BEFORE=$(echo "$BODY" | jq -r --arg id "$ROOM_ID" '[.[] | select(.id == $id) | .viewsLast7Days][0] // "none"')
  # The landlord's own look must not count. A landlord refreshing their listing
  # to see how it looks being reported back as interest is a lie about demand.
  req GET "/api/rooms/$ROOM_ID" "" "$LTOKEN"
  sleep 1
  req GET /api/rooms/my-rooms "" "$LTOKEN"
  OWN=$(echo "$BODY" | jq -r --arg id "$ROOM_ID" '[.[] | select(.id == $id) | .viewsLast7Days][0] // "none"')
  if [[ "$OWN" == "$BEFORE" ]]; then
    green "  PASS  the landlord opening their OWN room does not count as a view  ($OWN)"; PASS=$((PASS+1))
  else
    red "  FAIL  a landlord's own look was counted: $BEFORE → $OWN"; FAIL=$((FAIL+1))
  fi

  req GET "/api/rooms/$ROOM_ID" "" "$TTOKEN"
  sleep 1
  req GET /api/rooms/my-rooms "" "$LTOKEN"
  AFTER=$(echo "$BODY" | jq -r --arg id "$ROOM_ID" '[.[] | select(.id == $id) | .viewsLast7Days][0] // "none"')
  if [[ "$AFTER" == "$((OWN + 1))" ]]; then
    green "  PASS  somebody else opening it counts as one  ($OWN → $AFTER)"; PASS=$((PASS+1))
  else
    red "  FAIL  a visitor's view was not counted: $OWN → $AFTER"; FAIL=$((FAIL+1))
  fi
else
  skipped "this week's view counting — no room was created earlier in this run"
fi

# ── Rent reminders (Phase 7d) ──────────────────────────────────────────────
#
# ⚠️ This control's own code comment records that it was built because
# PATCH /properties/rent/settings had existed since rent tracking shipped with
# no screen calling it. Phase 7b then left the screen it was given without a
# route, so it was unreachable again. The reachability is checked on a rendered
# page by scripts/dashboard-ui-drive.mjs; this is the data behind it.
req PATCH /api/properties/rent/settings '{"rentGraceDays":0}' "$LTOKEN"
check "reminders can be switched off entirely" 200 "$STATUS" "$BODY"
req GET /api/properties/dashboard "" "$LTOKEN"
if [[ "$(echo "$BODY" | jq -r '.rentGraceDays')" == "0" ]]; then
  green "  PASS  and the dashboard reports the real 0, so the box cannot show a default over it"; PASS=$((PASS+1))
else
  red "  FAIL  dashboard reports rentGraceDays $(echo "$BODY" | jq -c '.rentGraceDays') after setting 0"; FAIL=$((FAIL+1))
fi
req PATCH /api/properties/rent/settings '{"rentGraceDays":3}' "$LTOKEN"
check "and a real window round-trips" 200 "$STATUS" "$BODY"

# ── The first-run walkthrough (Phase 7f) ───────────────────────────────────
#
# ⚠️ The flag is on the ACCOUNT, not in the browser. localStorage is the
# obvious choice and wrong twice over: a phone in this market is shared and
# replaced, so a per-browser flag shows the tour to people who have seen it and
# hides it from people who have not — and under SSR there is no localStorage to
# read on the first paint. So what matters is that the stamp round-trips.
head_ "First-run walkthrough"

req GET /api/auth/me "" "$TTOKEN"
if echo "$BODY" | jq -e 'has("walkthroughSeenAt")' >/dev/null 2>&1; then
  green "  PASS  /auth/me carries walkthroughSeenAt, so the first paint knows without a second request"; PASS=$((PASS+1))
else
  red "  FAIL  /auth/me omits walkthroughSeenAt — the tour would flash a beat after the dashboard"; FAIL=$((FAIL+1))
fi

req POST /api/users/me/walkthrough-seen "" "$TTOKEN"
check "an account can be marked as shown round" 200 "$STATUS" "$BODY"
req GET /api/auth/me "" "$TTOKEN"
if [[ "$(echo "$BODY" | jq -r '.walkthroughSeenAt')" != "null" ]]; then
  green "  PASS  …and it sticks, so the tour does not return on the next login"; PASS=$((PASS+1))
else
  red "  FAIL  the stamp did not persist — the walkthrough will reappear every time"; FAIL=$((FAIL+1))
fi

# "Show me around again" clears the same record rather than keeping a second
# piece of state, which is why it is a nullable timestamp and not a boolean.
req POST /api/users/me/walkthrough-reset "" "$TTOKEN"
check "and it can be asked for again" 200 "$STATUS" "$BODY"
req GET /api/auth/me "" "$TTOKEN"
if [[ "$(echo "$BODY" | jq -r '.walkthroughSeenAt')" == "null" ]]; then
  green "  PASS  …by clearing the stamp, not by adding a second flag to keep in sync"; PASS=$((PASS+1))
else
  red "  FAIL  the reset did not clear walkthroughSeenAt"; FAIL=$((FAIL+1))
fi

req POST /api/users/me/walkthrough-seen "" ""
check "a stranger cannot mark somebody as shown round" 401 "$STATUS" "$BODY"

# ── Landlord survey (Phase 0) ──────────────────────────────────────────────
#
# The survey is seeded by prisma/seed.ts, so a database seeded without it
# SKIPS rather than fails — a smoke run against an older database should not
# report a bug that is really a missing seed.
head_ "Landlord survey"

req GET /api/surveys/prompt "" "$LTOKEN"
check "GET /surveys/prompt as a landlord" 200 "$STATUS" "$BODY"
SURVEY_SLUG=$(echo "$BODY" | jq -r '.slug // empty')

if [[ -z "$SURVEY_SLUG" ]]; then
  skipped "no active survey seeded — run npx ts-node prisma/seed-survey.ts --apply"
else
  SURVEY_MICRO=$(echo "$BODY" | jq -r '.microQuestion.id // empty')
  if [[ -n "$SURVEY_MICRO" ]]; then
    green "  PASS  the prompt names a micro question ($SURVEY_MICRO)"; PASS=$((PASS+1))
  else
    red "  FAIL  no micro question — the post-letting prompt would have nothing to ask"; FAIL=$((FAIL+1))
  fi

  # An unknown question id must be DROPPED, not stored. Anything that reaches
  # the aggregate must be explained by a question, or the admin view shows
  # counts against keys nobody asked about.
  req POST "/api/surveys/$SURVEY_SLUG/responses" \
    '{"answers":{"q3_room_count":"2 to 4","not_a_question":"should be dropped"},"source":"dashboard"}' "$LTOKEN"
  check "POST a survey response" 201 "$STATUS" "$BODY"
  SURVEY_RECORDED=$(echo "$BODY" | jq -r '.recorded // empty')
  if [[ "$SURVEY_RECORDED" == "1" ]]; then
    green "  PASS  an unknown question id is dropped, not stored"; PASS=$((PASS+1))
  else
    red "  FAIL  expected 1 answer recorded, got $SURVEY_RECORDED — an unknown id was stored"; FAIL=$((FAIL+1))
  fi

  # Having answered, the landlord must not be asked again.
  req GET /api/surveys/prompt "" "$LTOKEN"
  SURVEY_AGAIN=$(echo "$BODY" | jq -r '.slug // empty')
  if [[ -z "$SURVEY_AGAIN" ]]; then
    green "  PASS  the prompt goes quiet once answered"; PASS=$((PASS+1))
  else
    red "  FAIL  still prompting after an answer — the same person would be counted twice"; FAIL=$((FAIL+1))
  fi

  # A tenant is not in the audience and must never be asked.
  req GET /api/surveys/prompt "" "$TTOKEN"
  SURVEY_TENANT=$(echo "$BODY" | jq -r '.slug // empty')
  if [[ -z "$SURVEY_TENANT" ]]; then
    green "  PASS  a tenant is not asked a landlord survey"; PASS=$((PASS+1))
  else
    red "  FAIL  a tenant was offered a landlord-only survey"; FAIL=$((FAIL+1))
  fi

  # Aggregates are admin-only: they are the product's own research, and the
  # open-text answers are things landlords said about their tenants.
  req GET "/api/surveys/admin/$SURVEY_SLUG/results" "" "$LTOKEN"
  check "survey results refused to a non-admin" 403 "$STATUS" "$BODY"

  if [[ -n "${ADMIN_TOKEN:-}" ]]; then
    req GET "/api/surveys/admin/$SURVEY_SLUG/results" "" "$ADMIN_TOKEN"
    check "survey results as admin" 200 "$STATUS" "$BODY"
    SURVEY_SEG=$(echo "$BODY" | jq -r '.segmentQuestionId // empty')
    if [[ -n "$SURVEY_SEG" ]]; then
      green "  PASS  results are segmented by $SURVEY_SEG"; PASS=$((PASS+1))
    else
      red "  FAIL  results are not segmented — a table segmented by nothing looks like agreement"; FAIL=$((FAIL+1))
    fi
  else
    skipped "survey aggregate — set ADMIN_TOKEN to include it"
  fi
fi

# ── Summary ────────────────────────────────────────────────────────────────
printf '\n\033[1m═══ Summary ═══\033[0m\n'
green "  passed:  $PASS"
if [[ $SKIP -gt 0 ]]; then
  grey "  skipped: $SKIP"
  # Named, not counted. See SKIP_REASONS where it is declared.
  for r in "${SKIP_REASONS[@]}"; do grey "     · $r"; done
fi
if [[ $FAIL -gt 0 ]]; then
  red "  FAILED:  $FAIL"
  printf '\nFix the failures above, then re-run. Paste the output if you want help.\n'
  exit 1
fi
printf '\n'
if [[ $SKIP -gt 0 ]]; then
  green "Everything that ran passed."
  grey  "That is not the same as verified — $SKIP check(s) did not run. Each is named above."
  grey  "For a release run, set these so nothing worth checking is skipped:"
  grey  "  ADMIN_EMAIL, ADMIN_PASSWORD   the seven admin sections (~70 checks, incl. document retention)"
  grey  "  IMAGEKIT_*                    that an uploaded document is really deleted"
  grey  "  WHATSAPP_APP_SECRET           signed webhook delivery"
  grey  "  RESEND_WEBHOOK_SECRET         email webhook signature verification"
  grey  "  and seed with SEED_LAUNCH_CODES=true, plus prisma/seed-survey.ts --apply"
else
  green "All checks passed — the core MVP flow works end to end."
fi
printf 'Next: click the same flow in the UI at %s\n' "$FE"
