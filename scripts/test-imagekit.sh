#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# ImageKit isolation test
#
# Uploads a tiny generated image straight to ImageKit using the same signed
# token the app uses, with no browser involved. This separates three things
# that all look identical from the frontend:
#
#   1. our request construction        -> would fail here too
#   2. the browser / network path      -> works here, fails in browser
#   3. the ImageKit account or keys    -> fails here with the same error
#
#   ./scripts/test-imagekit.sh
#
# Requires: curl, jq, and a landlord login. Reads keys from backend/.env.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

API="${API:-http://localhost:3000}"
ENV_FILE="${ENV_FILE:-backend/.env}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
grey()  { printf '\033[90m%s\033[0m\n' "$1"; }

command -v jq >/dev/null || { red "jq required: sudo apt install -y jq"; exit 1; }
[[ -f "$ENV_FILE" ]] || { red "Cannot find $ENV_FILE — run this from the repo root."; exit 1; }

PUB=$(grep -E '^IMAGEKIT_PUBLIC_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"' \r')
PRIV=$(grep -E '^IMAGEKIT_PRIVATE_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"' \r')
ENDPOINT=$(grep -E '^IMAGEKIT_URL_ENDPOINT=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"' \r')

echo "── Key configuration ──"
[[ -n "$PUB"  ]] && grey "  public key   ${PUB:0:18}…" || red "  IMAGEKIT_PUBLIC_KEY is empty"
[[ -n "$PRIV" ]] && grey "  private key  ${PRIV:0:18}…" || red "  IMAGEKIT_PRIVATE_KEY is empty"
[[ -n "$ENDPOINT" ]] && grey "  url endpoint $ENDPOINT" || red "  IMAGEKIT_URL_ENDPOINT is empty"

# The instance id is the last path segment of the URL endpoint. Both keys must
# belong to that same instance — a mismatch is the classic cause of a 500 with
# otherwise valid parameters.
INSTANCE=$(basename "$ENDPOINT")
grey "  instance     $INSTANCE"
echo

# ── 1. Verify the private key directly against ImageKit's account API ──────
echo "── 1. Do the credentials belong to a live account? ──"
ACC=$(curl -sS -w '\n%{http_code}' -u "$PRIV:" \
  "https://api.imagekit.io/v1/files?limit=1" 2>/dev/null)
ACC_CODE=$(echo "$ACC" | tail -n1)
if [[ "$ACC_CODE" == "200" ]]; then
  green "  PASS  private key authenticates against the ImageKit API (200)"
elif [[ "$ACC_CODE" == "401" || "$ACC_CODE" == "403" ]]; then
  red   "  FAIL  private key rejected ($ACC_CODE) — wrong key, or the account is suspended"
  grey  "        $(echo "$ACC" | sed '$d' | head -c 300)"
else
  red   "  FAIL  unexpected response $ACC_CODE"
  grey  "        $(echo "$ACC" | sed '$d' | head -c 300)"
fi
echo

# ── 2. Sign a token exactly as the backend does, then upload ───────────────
echo "── 2. Signed upload with a 1x1 PNG ──"
TOKEN=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen)
EXPIRE=$(( $(date +%s) + 1800 ))
SIG=$(printf '%s%s' "$TOKEN" "$EXPIRE" | openssl dgst -sha1 -hmac "$PRIV" | awk '{print $NF}')

grey "  token   $TOKEN"
grey "  expire  $EXPIRE (in 30 min)"
grey "  sig     ${SIG:0:16}…"

TMP=$(mktemp /tmp/ik-test-XXXX.png)
# Smallest valid PNG — removes the file itself as a variable.
printf '\211PNG\r\n\032\n\000\000\000\rIHDR\000\000\000\001\000\000\000\001\010\006\000\000\000\037\025\304\211\000\000\000\nIDATx\234c\370\017\000\001\001\001\000\030\335\212\333\000\000\000\000IEND\256B`\202' > "$TMP"

RESP=$(curl -sS -w '\n%{http_code}' -X POST \
  -F "file=@$TMP" \
  -F "fileName=imagekit-isolation-test.png" \
  -F "publicKey=$PUB" \
  -F "token=$TOKEN" \
  -F "expire=$EXPIRE" \
  -F "signature=$SIG" \
  -F "useUniqueFileName=true" \
  https://upload.imagekit.io/api/v1/files/upload 2>/dev/null)
rm -f "$TMP"

CODE=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | sed '$d')

if [[ "$CODE" == "200" ]]; then
  green "  PASS  upload succeeded ($CODE)"
  grey  "        $(echo "$BODY" | jq -r '.url // empty')"
  echo
  green "ImageKit and the keys are fine. The failure is in the browser path —"
  green "check for an extension, proxy or VPN interfering with upload.imagekit.io."
else
  red   "  FAIL  upload returned $CODE"
  grey  "        $BODY"
  echo
  red   "Same failure outside the browser, so this is not an app bug."
  grey  "  500 with valid parameters usually means the public and private keys"
  grey  "  belong to different ImageKit instances. In the ImageKit dashboard,"
  grey  "  open Developer Options -> API Keys and confirm BOTH keys and the"
  grey  "  URL endpoint come from the same instance ($INSTANCE)."
fi
