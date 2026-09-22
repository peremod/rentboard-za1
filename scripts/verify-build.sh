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
    PROD_ROBOTS=$(curl -s --max-time 25 http://localhost:4112/robots.txt)
    if echo "$PROD_ROBOTS" | grep -qiE '^[[:space:]]*Disallow:[[:space:]]*/[[:space:]]*$'; then
      bad "the PRODUCTION build serves 'Disallow: /' when the API is unreachable"
      note "That is an instruction Google obeys. A missing robots.txt means crawl"
      note "freely; a Disallow: / means deindex. See fallbackRobots() in server.ts."
    else
      ok "the production build stays crawlable when the API cannot be reached"
    fi
    echo "$PROD_ROBOTS" | grep -qi 'Sitemap:' \
      && ok "and still points at its sitemap" \
      || bad "the production robots.txt has no Sitemap line"

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
  case "$(type_of /sitemap.xml)" in
    *xml*) ok "/sitemap.xml is served as XML" ;;
    *) bad "/sitemap.xml is $(type_of /sitemap.xml), not XML" ;;
  esac

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

  kill "$SSR_PID" 2>/dev/null || true
  wait "$SSR_PID" 2>/dev/null || true
  rm -rf "$VERIFY_DIST"
fi

# ── 10. The deploy config, which nothing has ever looked at ───────────────
#
# Every check in this file until now tested the build. None tested how the
# build gets served, and that is where the site actually broke: on the live
# deployment, /auth/login, /tenant/dashboard and every /rooms/:id answered 404
# while the 19 prerendered pages answered 200. Room links shared on WhatsApp
# were dead and nothing in this repo could have told us.
#
# Two faults, both visible in frontend/vercel.json alone:
#   · "outputDirectory" named the browser folder, so Vercel published those
#     files and nothing else — the server bundle Angular also builds was never
#     deployed, which is what made the whole SSR layer inert in production.
#   · the SPA fallback rewrote unmatched paths to "/index.html", a path that
#     "cleanUrls": true makes unreachable: Vercel strips .html, so /index.html
#     is a 308 and the rewrite resolved to nothing.
step "Deploy config"
VERCEL_JSON="$ROOT/frontend/vercel.json"
if [ ! -f "$VERCEL_JSON" ]; then
  note "SKIP — no frontend/vercel.json"
else
  node -e '
    const fs = require("fs");
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const fail = (m) => { console.log("FAIL " + m); };
    const pass = (m) => { console.log("PASS " + m); };
    // Neither passed nor failed: a state we have chosen and are tracking.
    const note_ = (m) => { console.log("NOTE " + m); };

    // A destination ending in .html cannot be reached when cleanUrls is on.
    const rewrites = cfg.rewrites ?? [];
    const htmlDest = rewrites.filter((r) => /\.html$/.test(r.destination ?? ""));
    if (cfg.cleanUrls && htmlDest.length) {
      fail(`cleanUrls is on and ${htmlDest.length} rewrite(s) point at a .html path: ` +
           htmlDest.map((r) => r.destination).join(", "));
    } else {
      pass("no rewrite points at a path cleanUrls makes unreachable");
    }

    // Publishing only the browser folder discards the server bundle, so the
    // deployment is static: room pages are client-rendered and unknown URLs
    // cannot carry a status. That is where this project is TODAY, on purpose
    // and under protest (row 24), because removing the setting without a
    // replacement took the whole site to 404 — Vercel read outputPath from
    // angular.json and published dist/mastande-frontend, whose index.html is
    // one directory further down.
    //
    // So the verdict depends on whether the replacement exists yet: once
    // tools/vercel-build.mjs is in the repo, the deployment is meant to be
    // serving .vercel/output and this setting would silently disable it.
    const hasServerBuild = fs.existsSync(process.argv[2]);
    if ((cfg.outputDirectory ?? "").includes("browser")) {
      hasServerBuild
        ? fail("outputDirectory publishes only the browser bundle — it overrides the .vercel/output build")
        : note_("static deploy: outputDirectory publishes the browser bundle, so there is no SSR in production (row 24)");
    } else {
      pass("the deploy does not publish the browser bundle alone");
    }

    // robots.txt and sitemap.xml, and which answer is right depends on what
    // kind of deployment this is:
    //
    //   static  — nothing else can answer them, so an edge rewrite is the
    //             only way to have a robots.txt at all. Without one they 404,
    //             and a 404 robots.txt means crawl everything.
    //   server  — src/server.ts answers both, with a cache and a fallback
    //             derived from the build indexability. An edge rewrite would
    //             bypass both, so it must NOT be there.
    //
    // NB: no apostrophes in this script. It is inside single quotes in bash,
    // and one apostrophe ends the string early — which is exactly how the
    // first version of this block failed with a syntax error.
    const isStatic = Boolean(cfg.outputDirectory);
    const intercepted = rewrites.filter((r) => ["/robots.txt", "/sitemap.xml"].includes(r.source));
    if (isStatic) {
      intercepted.length
        ? pass("robots.txt and sitemap.xml are answered at the edge, as a static deploy needs")
        : fail("a static deploy with no rewrite for robots.txt — it will 404, which means crawl everything");
    } else {
      intercepted.length
        ? fail(`${intercepted.length} edge rewrite(s) intercept robots.txt or sitemap.xml, bypassing the cache and fallback in server.ts`)
        : pass("nothing at the edge intercepts robots.txt or sitemap.xml");
    }

    // A deployment that is not production must not invite crawlers. The
    // production BUILD sets meta robots index,follow, so a preview host with
    // no X-Robots-Tag is fully crawlable and will compete with the real
    // domain for every keyword the day it launches.
    const noindexHosts = (cfg.headers ?? [])
      .filter((h) => (h.headers ?? []).some((x) => /x-robots-tag/i.test(x.key ?? "")))
      .flatMap((h) => (h.has ?? []).map((c) => c.value));
    noindexHosts.length
      ? pass(`non-production hosts carry X-Robots-Tag: ${noindexHosts.join(", ")}`)
      : fail("no host carries an X-Robots-Tag noindex — preview deployments are crawlable");
  ' "$VERCEL_JSON" "$ROOT/frontend/tools/vercel-build.mjs" > /tmp/vercel-check.txt
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
