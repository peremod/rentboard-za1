#!/usr/bin/env bash
#
# Run the browser drives listed in scripts/ui-drives.txt as a suite.
#
#   bash scripts/ui-drives.sh                 # all of them
#   ONLY=nav-sheet-drive,logo-drive bash scripts/ui-drives.sh
#   NO_API_RESTART=1 bash scripts/ui-drives.sh
#
# Needs: the API on :3000, a DEVELOPMENT build served on :4200, and a migrated,
# seeded database. In CI that is the browser job, which already has all three.
#
# ── 🔴 THE RATE LIMITER, which is why this script exists at all
#
# /auth/register allows 60 per hour, counted IN MEMORY (v1.86.0), and each
# drive registers between three and eight throwaway accounts. Running thirty
# seven of them back to back exhausts it about a third of the way through, and
# every drive after that dies on its first line with "register LANDLORD failed:
# 429" — which reads exactly like a broken registration endpoint.
#
# That is not hypothetical. The first pass of the E2E audit reported 31 of 41
# drives failing and the whole result was void; the tell was that `phase-drive`
# — the one drive CI runs and passes on every push — was among the "failures".
# A result that condemns a check which demonstrably passes elsewhere is a
# result about the harness.
#
# So the API is restarted before each drive, which clears the counters. It
# costs two or three seconds a drive. The limiter itself is NOT raised or
# disabled for the suite's convenience: it is a deliberate control, and a test
# harness that switches off the thing under test is not a harness.
#
# ── What this script asserts about ITSELF
#
# A runner that silently runs nothing is the same defect as a drive that
# asserts nothing, so: an empty list fails, a name with no file fails, an API
# that will not come back fails, and the count of drives actually executed is
# compared with the count in the list at the end.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LIST="scripts/ui-drives.txt"
LOGS="${DRIVE_LOG_DIR:-/tmp/ui-drives}"
API_LOG="${API_LOG:-/tmp/api-drives.log}"
mkdir -p "$LOGS"

red()   { printf '\033[31m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
grey()  { printf '\033[90m%s\033[0m\n' "$1"; }

[[ -f "$LIST" ]] || { red "no $LIST"; exit 1; }
mapfile -t DRIVES < <(grep -vE '^\s*#|^\s*$' "$LIST" | tr -d '\r')

if [[ -n "${ONLY:-}" ]]; then
  WANT=",${ONLY},"
  FILTERED=()
  for d in "${DRIVES[@]}"; do [[ "$WANT" == *",$d,"* ]] && FILTERED+=("$d"); done
  DRIVES=("${FILTERED[@]:-}")
  [[ -n "${DRIVES[0]:-}" ]] || { red "ONLY=$ONLY matched nothing in $LIST"; exit 1; }
fi

EXPECTED=${#DRIVES[@]}
(( EXPECTED > 0 )) || { red "$LIST lists no drives — nothing would have run"; exit 1; }

# Every name must name a file, checked BEFORE anything runs: a typo should fail
# the suite, not quietly shrink it.
MISSING=()
for d in "${DRIVES[@]}"; do [[ -f "scripts/$d.mjs" ]] || MISSING+=("$d"); done
if (( ${#MISSING[@]} )); then
  red "listed in $LIST with no scripts/<name>.mjs: ${MISSING[*]}"
  exit 1
fi

# The two servers the drives talk to, named rather than assumed.
curl -sf http://localhost:3000/health >/dev/null \
  || { red "the API is not answering on :3000 — the drives cannot run"; exit 1; }
curl -sf http://localhost:4200/ >/dev/null \
  || { red "no frontend on :4200 — the drives cannot run"; exit 1; }

export BASE="${BASE:-http://localhost:4200}"
export BASE_URL="${BASE_URL:-http://localhost:4200}"
export WEB="${WEB:-http://localhost:4200}"

# ⚠️ The restart below re-execs the API with THIS SCRIPT'S environment, so the
# environment has to be the one the API needs. Without DATABASE_URL the API
# falls back to backend/.env and comes up healthy against the DEVELOPMENT
# database — so every drive would then run, pass or fail, against the wrong
# data, and nothing on screen would say so. In CI the step's `env:` block
# supplies it; locally it has to be exported. Checked rather than hoped for,
# because "healthy" is not the same as "pointed at the right database".
if [[ -z "${NO_API_RESTART:-}" && -z "${DATABASE_URL:-}" ]]; then
  red "DATABASE_URL is not set, and this script RESTARTS the API between drives."
  grey "  Without it the API would fall back to backend/.env and come up healthy"
  grey "  against the development database, and the whole run would be about the"
  grey "  wrong data. Export the same environment the API was started with, or"
  grey "  pass NO_API_RESTART=1 and accept that the rate limiter will exhaust."
  exit 1
fi

start_api() {
  [[ -n "${NO_API_RESTART:-}" ]] && return 0
  pkill -f "node dist/main.js" 2>/dev/null
  sleep 1
  # `setsid`, so the API is not in this shell's process group.
  #
  # ⚠️ A bare "Terminated" line may still appear between rows of the table:
  # that is bash reporting the PREVIOUS API being killed by the restart above,
  # and it is the restart working, not a fault. Worth knowing before somebody
  # reads it in a CI log as a crash. `set +m` does not suppress it and neither
  # does redirecting pkill, so it is documented rather than chased.
  ( cd backend && setsid node dist/main.js > "$API_LOG" 2>&1 & )
  for _ in $(seq 1 40); do
    curl -sf http://localhost:3000/health >/dev/null && return 0
    sleep 1
  done
  return 1
}

printf '\n'
grey "── $EXPECTED browser drive(s), the API restarted before each ──────────"

RAN=0; FAILED=()
for d in "${DRIVES[@]}"; do
  if ! start_api; then
    red "  the API did not come back before $d — stopping here rather than reporting the rest as failures"
    grey "  last 20 lines of $API_LOG:"; tail -20 "$API_LOG"
    exit 1
  fi
  t0=$SECONDS
  node "scripts/$d.mjs" > "$LOGS/$d.log" 2>&1
  code=$?
  dt=$(( SECONDS - t0 ))
  RAN=$(( RAN + 1 ))
  if (( code == 0 )); then
    green "  ✅ $(printf '%-28s' "$d") ${dt}s"
  else
    red   "  ❌ $(printf '%-28s' "$d") ${dt}s  (exit $code)"
    FAILED+=("$d")
  fi
done

printf '\n'
if (( RAN != EXPECTED )); then
  red "ran $RAN of $EXPECTED drives — the suite did not do what the list says"
  exit 1
fi

if (( ${#FAILED[@]} )); then
  for d in "${FAILED[@]}"; do
    printf '\n'
    red "══ $d ══"
    # The ❌ lines first, because they are the answer, then the tail for context.
    grep -E '❌|Error|error:|Timeout' "$LOGS/$d.log" | head -25
    grey "  — last 15 lines —"
    tail -15 "$LOGS/$d.log"
  done
  printf '\n'
  red "$((${#FAILED[@]})) of $EXPECTED drive(s) failed: ${FAILED[*]}"
  grey "full logs in $LOGS"
  exit 1
fi

green "all $EXPECTED drives passed"
grey "full logs in $LOGS"
