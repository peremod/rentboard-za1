#!/usr/bin/env bash
#
# Verifies everything that cannot be checked without installing dependencies.
#
#     bash scripts/verify-build.sh
#
# Run this once after pulling the v1.49–v1.51 changes, before tagging. It takes
# roughly 5–8 minutes, most of it prerendering.
#
# Why this exists: the SEO, locale-routing and environment work was authored in
# a container with no network and no node_modules, so `ng build` never ran
# against it. Static syntax checks passed, but three things genuinely cannot be
# confirmed without a real build — per-locale prerendering, the JSON bundle
# imports, and whether metadata lands in the served HTML rather than after
# hydration. This checks all three and names the fix for each likely failure.

set -uo pipefail

PASS=0
FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
note() { echo "     ↳ $1"; }
step() { echo; echo "── $1 ─────────────────────────────────────────"; }

cd "$(dirname "$0")/.."
ROOT=$(pwd)
DIST="$ROOT/frontend/dist/mastande-frontend/browser"

# ── 1. Dependencies ───────────────────────────────────────────────────────
step "Installing"
npm run install:all >/dev/null 2>&1 && ok "dependencies installed" || {
  bad "npm run install:all failed"
  note "Run it manually to see the error. Node must be 22.x."
  exit 1
}

# ── 2. Static audits ──────────────────────────────────────────────────────
step "Audits"
npm run audit:routes >/dev/null 2>&1 && ok "routes, guards, internal links" || bad "route audit failed — run: npm run audit:routes"
npm run audit:i18n   >/dev/null 2>&1 && ok "i18n bundles and locale sync"   || bad "i18n audit failed — run: npm run audit:i18n"
npm run audit:env    >/dev/null 2>&1 && ok "environment parity"             || bad "env parity failed — run: npm run audit:env"

# ── 3. Typecheck ──────────────────────────────────────────────────────────
step "Typecheck"
if npx --prefix frontend tsc --noEmit -p frontend/tsconfig.app.json 2>/tmp/tsc.log; then
  ok "no type errors"
else
  bad "type errors"
  head -20 /tmp/tsc.log
  note "If these mention .json imports: confirm resolveJsonModule is true in frontend/tsconfig.json."
  note "If they mention getPrerenderParams: see the note in app.routes.ts above eachLocale."
fi

# ── 4. All three environments build ───────────────────────────────────────
#
# Order matters and used to be wrong. All three configurations write to the
# same dist/, so whichever builds LAST is what step 6 then inspects — and step
# 6 asserts production-only properties: canonical, hreflang, and an indexable
# robots directive. Building development last meant step 6 read an unindexable
# development build and reported four failures on every single run, followed by
# "do not tag a release until these are resolved". Nothing was wrong with the
# build; the script was checking the wrong one.
#
# Production is built last so the artefact left on disk is the one the
# assertions are about. (ci.yml had the same bug and was fixed the same way.)
step "Builds"
for cfg in development staging production; do
  if npm --prefix frontend run build -- --configuration "$cfg" >/tmp/build-$cfg.log 2>&1 \
     || npx --prefix frontend ng build --configuration "$cfg" >/tmp/build-$cfg.log 2>&1; then
    ok "$cfg build"
  else
    bad "$cfg build failed"
    tail -25 /tmp/build-$cfg.log
    if grep -qi "prerender\|getPrerenderParams" /tmp/build-$cfg.log; then
      note "MOST LIKELY FAILURE. The ':lang' server routes in app.routes.ts could not be enumerated."
      note "Fix: change the four ':lang/...' Prerender entries to RenderMode.Server."
      note "Those pages are then rendered per request instead of at build time —"
      note "still fully crawlable and translated, just not baked into the output."
    fi
    if grep -qi "\.json" /tmp/build-$cfg.log; then
      note "SECOND MOST LIKELY. JSON bundle imports in core/i18n/translation-bundles.ts."
      note "Fix: confirm resolveJsonModule in tsconfig.json, and that the relative"
      note "path '../../../assets/i18n/en.json' resolves from that file's location."
    fi
  fi
done

# ── 5. Prerendered output ─────────────────────────────────────────────────
step "Prerendered pages"
if [ -d "$DIST" ]; then
  for page in index.html pricing/index.html how-it-works/index.html advertise/index.html; do
    [ -f "$DIST/$page" ] && ok "prerendered /$page" || bad "/$page was NOT prerendered"
  done
  # Locale pages: the whole point of locale-scoped URLs.
  for locale in af zu; do
    if [ -f "$DIST/$locale/index.html" ]; then
      ok "prerendered /$locale"
    else
      bad "/$locale was NOT prerendered"
      note "If the build otherwise succeeded, getPrerenderParams did not run."
      note "Switch those routes to RenderMode.Server — see note in step 4."
    fi
  done
else
  bad "no build output at $DIST — builds did not complete"
fi

# ── 6. Metadata is in the SERVED html, not applied after hydration ────────
step "Metadata in served HTML"
P="$DIST/pricing/index.html"
if [ -f "$P" ]; then
  check() { grep -q "$1" "$P" && ok "$2" || { bad "$2 missing from served HTML"; note "$3"; }; }
  check 'rel="canonical"'   "canonical"          "SeoService is not running during SSR — check provideRouteSeo in app.config.ts"
  check 'name="description"' "meta description"  "The route is missing data.seo.description in app.routes.ts"
  check 'name="robots"'      "robots directive"  "SeoService.apply is not being called for this route"
  check 'property="og:title"' "Open Graph"       "Same cause as canonical"
  check 'hreflang="en-ZA"'   "hreflang en-ZA"    "setAlternates is not running — check alternates is not false"
  check 'hreflang="x-default"' "hreflang x-default" "The cluster is incomplete; Google discards partial clusters"

  # A page that is indexable must not be noindex, and vice versa.
  if grep -q 'name="robots" content="index' "$P"; then
    ok "production build is indexable"
  else
    bad "production build is NOT indexable"
    note "Check indexable: true in frontend/src/environments/environment.prod.ts"
  fi
else
  bad "cannot check metadata — /pricing was not prerendered"
fi

# ── 6b. No unfilled placeholders in anything public ───────────────────────
# The legal pages shipped with [YOUR COMPANY NAME], [REGISTRATION NUMBER],
# [REGISTERED ADDRESS] and [FULL NAME] in them for most of this project's
# life. Nothing failed, because nothing looked: a placeholder is valid HTML
# and renders perfectly. On a page that names the responsible party and the
# Information Officer, publishing one is a compliance problem, not a typo.
step "No unfilled placeholders in prerendered pages"
PLACEHOLDERS=$(grep -rhoE '\[[A-Z][A-Z ]{2,}\]' "$DIST" --include='*.html' 2>/dev/null | sort -u || true)
if [ -z "$PLACEHOLDERS" ]; then
  ok "no [PLACEHOLDER] text in any prerendered page"
else
  bad "unfilled placeholders are in the build output: $(echo "$PLACEHOLDERS" | tr '\n' ' ')"
  note "Fill them in before tagging — these render to real visitors exactly as written"
fi

# Private routes must be noindex and carry no canonical.
step "Private routes excluded from the index"
L="$DIST/auth/login/index.html"
if [ -f "$L" ]; then
  grep -q 'noindex' "$L" && ok "/auth/login is noindex" || bad "/auth/login is missing noindex"
else
  ok "/auth/login is client-rendered (RenderMode.Client) — nothing to index"
fi

# ── 7. Locale bundles actually shipped ────────────────────────────────────
step "Translation bundles"
for locale in af zu; do
  if grep -rq "$locale" "$DIST"/*.js 2>/dev/null || [ -f "$DIST/assets/i18n/$locale.json" ]; then
    ok "$locale bundle present in output"
  else
    bad "$locale bundle missing from build output"
    note "The import map in translation-bundles.ts must be written out literally."
    note "A computed path leaves the bundler unable to emit the chunks."
  fi
done

# ── 8. Backend compiles and its env guard works ───────────────────────────
step "Backend"
if npm --prefix backend run build >/tmp/be.log 2>&1; then
  ok "backend builds"
else
  bad "backend build failed"
  tail -20 /tmp/be.log
fi

# The validator must REFUSE to start without SITE_URL. If it starts anyway,
# the guard is not wired up and a misconfigured deploy would go unnoticed.
if [ -f "$ROOT/backend/dist/main.js" ]; then
  if (cd backend && env -u SITE_URL APP_ENV=staging timeout 20 node dist/main.js >/tmp/guard.log 2>&1); then
    bad "backend started WITHOUT SITE_URL — the environment guard is not working"
    note "Check validateEnvironment() is called at the top of bootstrap() in main.ts"
  else
    grep -qi "SITE_URL" /tmp/guard.log \
      && ok "backend refuses to start without SITE_URL" \
      || { bad "backend failed to start, but not because of SITE_URL"; tail -10 /tmp/guard.log; }
  fi
fi

# ── 9. What the SERVER actually answers, per URL ──────────────────────────
#
# Every check above reads files on disk. These boot the server and ask it,
# because the three defects this section exists for were all invisible on
# disk and all found by asking:
#
#   · /robots.txt and /sitemap.xml answered 200 with the "Page not found"
#     HTML page. There is no robots.txt at the site's origin — the backend
#     serves one, on the API's origin, where no crawler of the site will ever
#     read it. Lighthouse reported 58 "syntax not understood" errors, having
#     parsed our 404 page as robots directives.
#   · Every unknown URL answered 200. A soft 404 keeps the URL in the index,
#     competing with real pages.
#   · /rooms/:id is server-rendered per request so a crawler sees the room,
#     and it rendered "Loading…" with the site's default title, because the
#     auth interceptor dropped every request during SSR — public reads
#     included.
#
# Run against a DEVELOPMENT build, on purpose. Angular bakes the API URL in at
# build time, and the production artefact left on disk by step 4 points at
# api.umastande.co.za — so on any machine that is not production, a room page
# renders its "no longer available" branch and the sitemap proxy has nothing
# to proxy. The first version of this section ran against that build and
# reported a page that could not have worked as working, which is the exact
# mistake the rest of this file exists to stop.
step "What the server answers"
VERIFY_DIST="$ROOT/frontend/dist/verify-dev"
rm -rf "$VERIFY_DIST"
if ! (cd frontend && npx ng build --configuration development --output-path dist/verify-dev \
        >/tmp/build-verify-dev.log 2>&1); then
  bad "could not build the development bundle these checks need"
  tail -15 /tmp/build-verify-dev.log
fi
SERVER_JS="$VERIFY_DIST/server/server.mjs"
if [ ! -f "$SERVER_JS" ]; then
  bad "no SSR server at $SERVER_JS — cannot check what the site answers"
else
  PORT=4111 NG_ALLOWED_HOSTS=localhost node "$SERVER_JS" >/tmp/verify-ssr.log 2>&1 &
  SSR_PID=$!
  # Wait for the port rather than sleeping a guess.
  for _ in $(seq 1 40); do
    curl -sf -o /dev/null --max-time 2 http://localhost:4111/ && break
    sleep 0.5
  done

  status_of() { curl -s -o /tmp/verify-body.html -w '%{http_code}' --max-time 20 "http://localhost:4111$1"; }
  type_of()   { curl -s -o /dev/null -w '%{content_type}' --max-time 20 "http://localhost:4111$1"; }

  [ "$(status_of /)" = "200" ] && ok "/ answers 200" || bad "/ does not answer 200"

  # A 404 must BE a 404.
  if [ "$(status_of /this-page-does-not-exist)" = "404" ]; then
    ok "an unknown URL answers 404"
  else
    bad "an unknown URL does not answer 404 — soft 404"
    note "Check the '**' serverRoute status and NOT_FOUND_MARKER in src/server.ts"
  fi
  # Single segment: this is the one a ':lang' server route silently claimed.
  if [ "$(status_of /nonsense)" = "404" ]; then
    ok "a single-segment unknown URL answers 404"
  else
    bad "/nonsense answers $(status_of /nonsense) — ':lang' is matching it"
    note "server.ts maps the error page's own marker to a status; check both"
  fi

  case "$(type_of /robots.txt)" in
    text/plain*) ok "/robots.txt is served as text/plain" ;;
    *) bad "/robots.txt is $(type_of /robots.txt), not text/plain"
       note "The site's own origin must serve it — see the proxy in src/server.ts" ;;
  esac

  # A robots.txt that parses is not the same as a robots.txt that says the
  # right thing, and the difference is not cosmetic. The first version of the
  # unreachable-API fallback answered 'Disallow: /' — valid, served correctly,
  # content-type perfect, and an instruction to Google to drop every page.
  # Lighthouse caught it (is-crawlable 0, SEO 0.92 → 0.66). The content-type
  # check above did not, because a type is not a meaning.
  #
  # The invariant is that robots.txt agrees with the deployment's own
  # indexability, so BOTH directions are asserted, each against the build it
  # belongs to. This is a development build, talking to a development API.
  ROBOTS=$(curl -s --max-time 20 http://localhost:4111/robots.txt)
  echo "$ROBOTS" | grep -qi 'user-agent' \
    && ok "/robots.txt is a robots.txt, not a page that happens to be text" \
    || bad "/robots.txt has no User-agent line"
  if echo "$ROBOTS" | grep -qiE '^[[:space:]]*Disallow:[[:space:]]*/[[:space:]]*$'; then
    ok "and a non-indexable build disallows the whole site, as it should"
  else
    bad "a development build's robots.txt does NOT disallow the site"
    note "Development and staging must never be crawlable — check APP_ENV on the API"
    note "and fallbackRobots() in frontend/src/server.ts"
  fi

  # And the production artefact from step 4, whose API is unreachable from
  # here — so this is precisely the fallback path, on the build that faces
  # Googlebot. The direction that matters: it must not tell anyone to go away.
  if [ -f "$DIST/../server/server.mjs" ]; then
    PORT=4112 NG_ALLOWED_HOSTS=localhost node "$DIST/../server/server.mjs" >/tmp/verify-ssr-prod.log 2>&1 &
    PROD_PID=$!
    for _ in $(seq 1 40); do
      curl -sf -o /dev/null --max-time 2 http://localhost:4112/ && break
      sleep 0.5
    done
    # As the site itself. The API is unreachable from here, so this is the
    # fallback path — on the build that faces Googlebot.
    PROD_ROBOTS=$(curl -s --max-time 25 -H "Host: umastande.co.za" http://localhost:4112/robots.txt)
    if echo "$PROD_ROBOTS" | grep -qiE '^[[:space:]]*Disallow:[[:space:]]*/[[:space:]]*$'; then
      bad "the PRODUCTION build serves 'Disallow: /' to its own domain when the API is unreachable"
      note "That is an instruction Google obeys. A missing robots.txt means crawl"
      note "freely; a Disallow: / means deindex. See fallbackRobots() in server.ts."
    else
      ok "the production build stays crawlable on its own domain when the API is down"
    fi
    echo "$PROD_ROBOTS" | grep -qi 'Sitemap:' \
      && ok "and still points at its sitemap" \
      || bad "the production robots.txt has no Sitemap line"

    # And as one of its copies. Every deployment URL, branch alias and preview
    # serves this same production build, so `indexable` says yes on all of
    # them — which had rentboard-za1.vercel.app answering Allow: / for a site
    # that does not exist yet. A copy must not invite crawlers.
    COPY_ROBOTS=$(curl -s --max-time 25 -H "Host: some-preview.vercel.app" http://localhost:4112/robots.txt)
    echo "$COPY_ROBOTS" | grep -qiE '^[[:space:]]*Disallow:[[:space:]]*/[[:space:]]*$' \
      && ok "and tells every other hostname not to crawl it" \
      || bad "a non-canonical hostname is invited to crawl: $(echo "$COPY_ROBOTS" | head -2 | tr '\n' ' ')"
    [ "$(curl -s -o /dev/null --max-time 25 -H "Host: some-preview.vercel.app" -w '%{http_code}' http://localhost:4112/sitemap.xml)" = "404" ] \
      && ok "and serves no sitemap there" \
      || bad "a non-canonical hostname serves a sitemap of the real site's URLs"

    # The production build points at the production API, which does not
    # resolve from any machine that is not production — so this server IS the
    # unreachable-API case, for free. A room page must answer 503 here, not
    # 404: "gone" and "could not ask" are different answers, and answering 404
    # to a blip asks Google to drop every room page on the site.
    UNREACHABLE=$(curl -s -o /dev/null --max-time 40 -w '%{http_code}' \
      "http://localhost:4112/rooms/99999999-9999-4999-8999-999999999999")
    case "$UNREACHABLE" in
      503) ok "a room page answers 503, not 404, when the API cannot be reached" ;;
      404) bad "a room page answers 404 when the API is unreachable — that is a deindex request"
           note "room-detail.ts must only set notFound on a 404/410 from the API" ;;
      *)   bad "a room page answers $UNREACHABLE with no API — expected 503" ;;
    esac
    kill "$PROD_PID" 2>/dev/null || true
    wait "$PROD_PID" 2>/dev/null || true
  fi
  # Only with an API to proxy. The sitemap is built from live rooms, so with
  # nothing to ask, answering 503 as text/plain is the correct behaviour — and
  # asserting XML regardless failed on every machine without a local API,
  # including this one once the sandbox reaped Postgres mid-run. The room
  # checks below already skip for the same reason; this one did not.
  if curl -sf -o /dev/null --max-time 5 "${API_URL:-http://localhost:3000}/health"; then
    case "$(type_of /sitemap.xml)" in
      *xml*) ok "/sitemap.xml is served as XML" ;;
      *) bad "/sitemap.xml is $(type_of /sitemap.xml), not XML" ;;
    esac
  else
    note "SKIP /sitemap.xml — no API on ${API_URL:-http://localhost:3000} to build it from"
  fi

  # Room pages only mean anything with an API to read from. Skipped, loudly,
  # rather than quietly passing when there is nothing to check.
  if curl -sf -o /dev/null --max-time 5 "${API_URL:-http://localhost:3000}/health"; then
    ROOM_ID=$(curl -sf --max-time 10 "${API_URL:-http://localhost:3000}/api/rooms?limit=1" \
      | sed -n 's/.*"data":\[{"id":"\([^"]*\)".*/\1/p')
    if [ -n "$ROOM_ID" ]; then
      status_of "/rooms/$ROOM_ID" >/dev/null
      if grep -q 'Loading…' /tmp/verify-body.html; then
        bad "a room page server-renders 'Loading…' — the room is not in the HTML"
        note "SSR is not awaiting the room request; see SSR_PUBLIC_PREFIXES in auth.interceptor.ts"
      else
        ok "a room page server-renders the room itself"
      fi
      grep -q '"@type":"Product"' /tmp/verify-body.html \
        && ok "and its JSON-LD is in the served HTML" \
        || bad "a room page has no Product JSON-LD in the served HTML"
      grep -q '"@type":"AggregateRating"\|"seller"\|"offers"' /tmp/verify-body.html \
        && ok "with the offer in it, not just the page title" \
        || note "no offer in the JSON-LD — check applySeo in room-detail.ts"
    else
      note "SKIP room page checks — the API returned no rooms"
    fi
    if [ "$(status_of /rooms/99999999-9999-4999-8999-999999999999)" = "404" ]; then
      ok "a room that does not exist answers 404"
    else
      bad "a missing room answers 200 — soft 404 on the site's main URL shape"
    fi
  else
    note "SKIP room page checks — no API on ${API_URL:-http://localhost:3000}"
  fi

  # An API that is DOWN and an API that never answers are different failures,
  # and only the first one was ever checked here. A refused connection fails in
  # microseconds; a hostname that resolves to something which accepts the
  # connection and then says nothing hangs forever — and a render waiting on it
  # never finishes. That is not hypothetical: it failed every production build
  # from v1.73.0 to v1.75.1 on the runner, and nothing in this file could see
  # it, because on this machine api.umastande.co.za refuses fast.
  #
  # So: black-hole the port this build talks to, and ask for a room page.
  API_PORT=$(printf '%s' "${API_URL:-http://localhost:3000}" | sed -n 's/.*:\([0-9]*\)$/\1/p')
  API_PORT=${API_PORT:-3000}
  if curl -s -o /dev/null --max-time 2 "http://localhost:$API_PORT/" ; then
    note "SKIP the hanging-API check — something is already listening on $API_PORT"
    note "(stop the API and re-run to exercise it)"
  else
    node -e '
      // Accepts, reads, and never replies. Deliberately not an HTTP server:
      // the point is that no response ever arrives.
      require("net").createServer((s) => { s.on("data", () => {}); s.on("error", () => {}); })
        .listen(Number(process.argv[1]), "127.0.0.1");
    ' "$API_PORT" &
    BLACKHOLE_PID=$!
    sleep 1
    HANG_START=$(date +%s)
    HANG_STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 \
      "http://localhost:4111/rooms/99999999-9999-4999-8999-999999999999")
    HANG_SECONDS=$(( $(date +%s) - HANG_START ))
    case "$HANG_STATUS" in
      503) ok "a room page answers 503 in ${HANG_SECONDS}s when the API accepts the connection and never answers" ;;
      000) bad "a room page never answered at all with a hanging API — the render has no ceiling"
           note "serverTimeoutInterceptor must be in app.config.ts's withInterceptors list."
           note "Without it, @angular/build aborts the route at 30s and fails the whole build." ;;
      *)   bad "a room page answers $HANG_STATUS with a hanging API — expected 503" ;;
    esac
    kill "$BLACKHOLE_PID" 2>/dev/null || true
    wait "$BLACKHOLE_PID" 2>/dev/null || true
  fi

  kill "$SSR_PID" 2>/dev/null || true
  wait "$SSR_PID" 2>/dev/null || true
  rm -rf "$VERIFY_DIST"
fi

# ── 10. The deploy artefact, which nothing had ever looked at ─────────────
#
# Every other check in this file tests the build. None tested how the build
# gets served, and that is where the site actually broke — twice in one day:
#
#   · `outputDirectory: .../browser` published the client bundle and threw
#     server.mjs away, so production was static: room pages client-rendered,
#     unknown URLs unable to carry a status. Its SPA fallback rewrote to
#     /index.html, which cleanUrls makes unreachable, so every deep link —
#     /auth/login, the portals, every room link — answered 404.
#   · removing outputDirectory did not fix it. Vercel read outputPath from
#     angular.json, published dist/mastande-frontend, and the WHOLE site
#     404'd because index.html is one directory further down.
#
# So the deployment is described explicitly now, by tools/vercel-build.mjs,
# and this step checks the artefact that script produces rather than the
# settings that produce it.
step "Deploy artefact"
VERCEL_BUILD="$ROOT/frontend/tools/vercel-build.mjs"
VERCEL_JSON="$ROOT/frontend/vercel.json"
if [ ! -f "$VERCEL_BUILD" ]; then
  note "SKIP — no frontend/tools/vercel-build.mjs"
elif [ ! -d "$DIST" ]; then
  bad "no production build to assemble a deploy artefact from"
else
  if (cd frontend && node tools/vercel-build.mjs >/tmp/vercel-build.log 2>&1); then
    ok "the deploy artefact assembles"
  else
    bad "tools/vercel-build.mjs failed"
    tail -5 /tmp/vercel-build.log
  fi

  OUT="$ROOT/frontend/.vercel/output"
  FUNC="$OUT/functions/ssr.func"
  node -e '
    const fs = require("fs");
    const out = process.argv[1], func = process.argv[2], vjson = process.argv[3];
    const fail = (m) => console.log("FAIL " + m);
    const pass = (m) => console.log("PASS " + m);

    for (const [label, path] of [
      ["the static bundle", out + "/static/index.html"],
      ["the function entry", func + "/index.mjs"],
      ["its runtime config", func + "/.vc-config.json"],
      ["the server bundle", func + "/server/server.mjs"],
      ["the browser bundle it reads", func + "/browser/index.html"],
    ]) {
      fs.existsSync(path) ? pass(`${label} is in the artefact`) : fail(`${label} is MISSING from the artefact`);
    }

    const cfg = JSON.parse(fs.readFileSync(out + "/config.json", "utf8"));
    const routes = cfg.routes ?? [];
    routes.some((r) => r.handle === "filesystem")
      ? pass("assets are served from the filesystem")
      : fail("no filesystem handler — every asset would hit the function");
    routes.some((r) => r.dest === "/ssr" && /^\^\/\.\*\$?$/.test(r.src ?? ""))
      ? pass("every other path reaches the server")
      : fail("no catch-all to the function — unmatched paths would 404");
    routes.some((r) => (r.headers ?? {})["x-robots-tag"] && (r.has ?? []).some((h) => h.type === "host"))
      ? pass("hosts that are not production are told not to index")
      : fail("no host-scoped x-robots-tag — a preview would compete with the real domain");
    routes.some((r) => /\.html$/.test(r.dest ?? ""))
      ? fail("a route points at a .html path, which cleanUrls-style handling makes unreachable")
      : pass("no route points at a .html path");

    // vercel.json must not quietly re-enable framework inference.
    const v = JSON.parse(fs.readFileSync(vjson, "utf8"));
    v.outputDirectory
      ? fail(`vercel.json sets outputDirectory (${v.outputDirectory}) — it overrides the artefact above`)
      : pass("vercel.json does not override the artefact");
    /vercel-build/.test(v.buildCommand ?? "")
      ? pass("the build command assembles the artefact")
      : fail("the build command does not run tools/vercel-build.mjs — the artefact would never be built");
  ' "$OUT" "$FUNC" "$VERCEL_JSON" > /tmp/vercel-check.txt
  # Read from a file, not a pipe: `node ... | while read` runs the loop in a
  # subshell, so every ok/bad in it would increment a copy of PASS and FAIL
  # and the summary would report neither. A gate that cannot fail again.
  while read -r verdict rest; do
    case "$verdict" in
      PASS) ok "$rest" ;;
      NOTE) note "$rest" ;;
      *)    bad "$rest" ;;
    esac
  done < /tmp/vercel-check.txt

  # And boot it. The entry is what Vercel's Node launcher imports, so if this
  # cannot serve the site, neither can the deployment. VERCEL_URL stands in
  # for the hostname the platform provides — without a hostname it recognises,
  # a production build answers 400 to everything the engine renders.
  VERCEL_URL=verify.local node -e '
    const http = require("http");
    import(process.argv[1]).then((m) => {
      if (typeof m.default !== "function") { console.error("entry default export is not a handler"); process.exit(1); }
      http.createServer(m.default).listen(4114);
    });
  ' "$FUNC/index.mjs" >/tmp/verify-func.log 2>&1 &
  FUNC_PID=$!
  for _ in $(seq 1 40); do
    curl -sf -o /dev/null --max-time 2 -H "Host: verify.local" http://localhost:4114/ && break
    sleep 0.5
  done
  func_status() { curl -s -o /dev/null --max-time 25 -w '%{http_code}' -H "Host: verify.local" "http://localhost:4114$1"; }

  [ "$(func_status /)" = "200" ] \
    && ok "the artefact serves the board" \
    || bad "the artefact answers $(func_status /) on / — check the entry and the browser bundle path"
  [ "$(func_status /pricing)" = "200" ] \
    && ok "and the prerendered pages" \
    || bad "the artefact answers $(func_status /pricing) on a prerendered page"
  [ "$(func_status /nonsense)" = "404" ] \
    && ok "and answers 404 for an unknown URL" \
    || bad "the artefact answers $(func_status /nonsense) for an unknown URL"

  # Behind a proxy — which is every deployment there is.
  #
  # Angular 21 trusts x-forwarded-host and x-forwarded-proto and NOTHING else
  # by default: any other x-forwarded-* header sets deoptToCSR, and the engine
  # silently returns the 4.8 KB client shell under a 200 instead of rendering.
  # Every reverse proxy sends x-forwarded-for. On the deployment that meant
  # every room page, every 404 and every 503 was an unrendered shell, while
  # the prerendered pages looked perfect because they never reach the engine.
  #
  # So ask the way a proxy asks. Without TRUSTED_PROXY_HEADERS in server.ts
  # this answers 200 with the shell; with it, the rendered 404.
  PROXIED=$(curl -s -o /tmp/proxied.html --max-time 25 -w '%{http_code}' \
    -H "Host: verify.local" -H "x-forwarded-for: 203.0.113.7" \
    -H "x-forwarded-proto: https" -H "x-forwarded-host: verify.local" \
    "http://localhost:4114/nonsense")
  if [ "$PROXIED" = "404" ] && grep -q 'ng-server-context="ssr"' /tmp/proxied.html; then
    ok "and still server-renders when a proxy adds x-forwarded-for"
  else
    bad "behind a proxy the artefact answers $PROXIED and does not server-render"
    note "Angular deoptimises to CSR on any untrusted x-forwarded-* header."
    note "Check TRUSTED_PROXY_HEADERS in frontend/src/server.ts."
  fi

  kill "$FUNC_PID" 2>/dev/null || true
  wait "$FUNC_PID" 2>/dev/null || true
  rm -rf "$OUT"
fi

# ── Summary ───────────────────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════"
echo "  $PASS passed, $FAIL failed"
echo "════════════════════════════════════════════════════════"
if [ "$FAIL" -gt 0 ]; then
  echo "  Do not tag a release until these are resolved."
  exit 1
fi
echo "  Verified. Safe to tag."
