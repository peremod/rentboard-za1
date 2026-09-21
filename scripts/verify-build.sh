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
