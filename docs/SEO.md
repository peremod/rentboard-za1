# Technical SEO

How Mastande's metadata layer works, what each environment does differently, and how to verify a change before it ships.

Introduced in `v1.49.0`. Before it, all 41 routes served the homepage `<title>` and description, with no canonical, Open Graph, or structured data anywhere in the codebase.

---

## 1. Where metadata comes from

Three layers, applied in order. Each overwrites the previous one.

| Layer | File | Applies to |
|---|---|---|
| Static defaults | `frontend/src/index.html` | Every page, including for crawlers that never execute JavaScript |
| Route-level | `data: { seo: {...} }` on each route | All static routes |
| Component-level | `SeoService.apply()` in the component | Dynamic pages whose metadata depends on loaded data |

**Adding a static page:** declare `title` and `data.seo.description` on the route. Nothing else. `provideRouteSeo()` in `app.config.ts` picks it up on every `NavigationEnd` and sets the description, canonical, robots directive, Open Graph and Twitter tags.

```ts
{
  path: 'pricing',
  loadComponent: () => import('./pricing/pricing').then((m) => m.Pricing),
  title: 'Pricing — Free for Landlords | Mastande',
  data: { seo: { description: 'Mastande pricing in Rand. Tenants apply free, always…' } },
},
```

**Adding a dynamic page:** let the route defaults apply first, then call `SeoService.apply()` once the data arrives. `room-detail.ts` is the reference implementation. The route-level default means there is never a window where the page advertises the wrong canonical.

**Private routes** carry `data: { seo: { noIndex: true } }`. All of `/auth`, `/tenant`, `/landlord`, `/account`, `/admin` and the 404 already do.

---

## 2. Canonical URLs

Built from `environment.siteUrl` plus the resolved path. Two rules:

- The path comes from `urlAfterRedirects`, not `url` — a redirect canonicalises to its target, never its source.
- Query strings and fragments are stripped. `?utm_source=facebook` and `?province=Gauteng` must not fork a URL in the index.

Pages marked `noIndex` emit no canonical at all. A `noindex` page claiming a canonical sends contradictory signals.

---

## 3. Structured data

### Site identity — Organization and WebSite

`core/seo/site-identity.ts`, emitted once from the root as a single `@graph`,
so it is on every server-rendered page exactly once. The two entities
reference each other by `@id`: the site is **published by** the company, which
is what makes them one description rather than two unrelated blobs.

⚠️ **It buys no sitelinks, no knowledge panel and no search box.** None can be
requested and no markup produces one on demand; Google chooses them from site
structure and brand demand. This supplies the facts correctly so the site is
eligible to be understood. That is the entire claim.

⚠️ **What is deliberately absent**: address, telephone, founding date,
`sameAs`, `aggregateRating`. There is no public address or phone on this site
and no social account linked from it, so every one of those would be
invented — and markup stating facts a visitor cannot verify on the page is
what the guidelines forbid. `legalName` is the registered company, which the
legal pages already state on screen.

The `SearchAction` target is `/?q={search_term_string}`, which is the board's
real search parameter (`home.ts` maps `q` to `searchTerm`). The drive asserts
that URL answers 200 — a SearchAction describing a search the site does not
honour is a lie that happens to validate.



`SeoService.setJsonLd(id, data)` writes a keyed `<script type="application/ld+json">`. Keyed so a page can replace its own block without disturbing another.

Room pages emit `Product` + `Offer`, not a real-estate type. A room let is priced, has an availability date, and carries landlord reviews — that shape is what earns a rich result. `aggregateRating` is included only when the landlord actually has ratings; a fabricated or empty rating block is a manual-action risk.

Validate at [search.google.com/test/rich-results](https://search.google.com/test/rich-results) against a production room URL.

---

### Room listings — RealEstateListing, not Product

It was `@type: 'Product'` with `offers.price` and `priceValidUntil`. A room
let by the month is not retail stock: Google's product rich results target
retail, and `priceValidUntil` means "this price expires" while what was passed
to it was `availableFrom` — close to the opposite. It is a `RealEstateListing`
about a `Room`/`Apartment` now, with `businessFunction: LeaseOut` saying
plainly that this is a letting, and `availabilityStarts` carrying the date.

🔴 **The `aggregateRating` was removed, and that one was a risk.** It was the
LANDLORD's rating — correct on screen, where it sits in a block labelled as
theirs — attached in markup to the ROOM. A room with no reviews of its own
inheriting a landlord's 4.8 is misattribution, and mismatched rating markup is
a documented manual-action risk. The storefront still carries the same figure,
where the subject of the page IS the landlord and the number is displayed
beside it.

⚠️ **Google publishes no rich result for rental listings.** This earns no
enhanced appearance and is not expected to. It is here so the page describes
itself truthfully to anything that reads it — semantic value, stated
separately from search appearance, because they are not the same thing.

The street address is never in the markup. A room's exact address reaches an
applicant after the landlord chooses to share it; publishing it in JSON-LD
would hand it to everyone the moment the room is listed.

### Private routes carry `X-Robots-Tag`, set by the server

🔴 The private trees render client-side, which is right — private data must
never reach cacheable HTML. But it meant a crawler asking for
`/tenant/dashboard` got the CSR shell: **200 OK, ~6KB, and no robots
directive of any kind.** The `noIndex` in the route data is applied by
SeoService after hydration, which a crawler that does not execute JavaScript
never sees. Measured with curl, not assumed.

robots.txt does not close that. It stops a well-behaved crawler FETCHING the
URL; it does not stop the URL being indexed from a link elsewhere — Google's
"Indexed, though blocked by robots.txt" state — and a Disallow also means the
crawler never reads a noindex it is not allowed to fetch.

`server.ts` sets `X-Robots-Tag: noindex, nofollow` on every private prefix,
locale-prefixed ones included. It is defence in depth, **not** the defence:
the guards are what keep the data private.

## 4. Per-environment behaviour

| | Development | Staging | Production |
|---|---|---|---|
| `environment.siteUrl` | `http://localhost:4200` | `https://rentboard-za1.vercel.app` | `https://umastande.co.za` |
| `environment.indexable` | `false` | `false` | `true` |
| Meta robots | `noindex, nofollow` | `noindex, nofollow` | `index, follow, max-image-preview:large` |
| Canonical emitted | no | no | yes |
| `robots.txt` (backend) | `Disallow: /` | `Disallow: /` | full allow list |
| `X-Robots-Tag` header | — | `noindex, nofollow` | — |

Staging is blocked three independent ways: the meta tag, `robots.txt`, and the Vercel header. Duplicating a whole site's copy under a second indexable domain is the fastest way to make it compete with itself, so this is deliberately over-engineered.

The backend reads `SITE_URL` and `NODE_ENV` from config. **Set `SITE_URL` on every deployment target** — it is in `backend/.env.example`. Missing it falls back to the production origin, which would make staging publish production URLs in its own sitemap.

---

## 5. robots.txt and sitemap.xml

**Both are served by the backend, and both have to be reachable at the SITE's
own origin.** A crawler reads `robots.txt` from the origin it is crawling and
nowhere else, so `https://api.umastande.co.za/robots.txt` governs the API and
says nothing whatsoever about `https://umastande.co.za`. Until v1.73.0 the site
origin had neither file: both paths fell through to the router's catch-all and
answered **200 with the "Page not found" page**. Every `Disallow` in that file
was inert, and the sitemap URL submitted to Search Console was a 200 with an
HTML body. Lighthouse had been reporting it for weeks — its `robots-txt` audit
returned "58 errors found", each one a line of our 404 page that it could not
parse as a robots directive, and SEO scored 0.92 on every audited URL because
of it.

Two places carry the fix, because two different servers answer that URL:

| Where | What serves it |
|---|---|
| `frontend/src/server.ts` | Proxies `/robots.txt` and `/sitemap.xml` to the API the build was compiled against, cached five minutes. This is what development, `node server.mjs` and the Lighthouse job use. |
| `frontend/vercel.json` | The same two paths as edge rewrites, because the production deployment is static and `server.ts` does not run there. Host-conditional, so staging proxies the staging API. |

If the API cannot be reached, the fallback answers from the build's own
`environment.indexable`: a production build stays crawlable (Allow, with the
private areas excluded and the Sitemap line intact), staging and development
disallow everything. The sitemap answers 503, which is retried, rather than
200 with an error page, which is believed.

**Not `Disallow: /` on failure.** That was the first version of this fallback,
on the reasoning that refusing a crawl is the cautious direction. It is the
opposite: a missing robots.txt means "crawl freely", while a robots.txt saying
`Disallow: /` is an instruction Google obeys, and obeying it on a live site
removes pages from the index. It also made the score it was meant to fix
worse — Lighthouse read the fallback, correctly concluded every page was
blocked, and SEO went 0.92 → 0.66 with `is-crawlable` at 0.
`scripts/verify-build.sh` now asserts both directions against the build each
one belongs to, because a content-type check passed the broken version.

`scripts/verify-build.sh` asserts the content type of both against a running
server, so a regression fails before a release is tagged.

**And the third direction, which cost the SEO budget its whole life: a copy of
the site.** `isCanonicalHost()` answers any hostname that is not this site's
with `Disallow: /` and no sitemap — correct, and what a Vercel preview should
say. The Lighthouse `budgets` job serves the **production** bundle on
`localhost:4000`, which is exactly that case, and never said otherwise. So
Lighthouse read `Disallow: /`, correctly scored all four URLs blocked, and
reported `is-crawlable` 0 with `categories:seo` 0.66 against a budget of 1.0 —
on every run from the day the job was written until 21 October 2026, in the
workflow whose purpose is to catch SEO regressions. Nobody read it, and no check
in the repository could see it: `scripts/seo-drive.mjs` read headers and markup
and never once fetched `robots.txt`.

Two fixes, and the second is the one that matters. `SITE_CANONICAL_HOSTS`
(`docs/DEPLOYMENT.md`) lets that job state what it is auditing — measured
afterwards, not assumed: seo 0.66 → **1.00**, `is-crawlable` 0 → 1. And the
drive now asserts the DIRECTION of robots.txt, derived from what the page says
about itself rather than hardcoded, so both branches are checked: an indexable
deployment on its own hostname must invite a crawl, and anything else must
refuse one. Falsified by serving the bundle without the variable — 8 failures,
the direction check among them.


Both served by `backend/src/modules/seo/seo.controller.ts` at the domain root, outside the `/api` prefix.

The sitemap is generated from live data: every `active` room, plus a fixed list of public pages. Let, draft and paused rooms are excluded so a crawler never lands on a dead listing.

Two rules for the static list:

1. **Every entry must return 200 at a real route.** The previous list advertised `/rooms`, which had no route and fell through to the not-found page under a 200 — a soft 404, submitted to Google in our own sitemap. There is now a real 301 at the edge (`vercel.json`) plus a router-level redirect as a safety net.
2. **Every prerendered public page must be in it.** `/how-it-works`, `/pricing` and `/advertise` were prerendered and keyword-relevant but had never been submitted.

`robots.txt` also disallows filter query permutations (`?province=`, `?maxRent=`, `?sort=`). These are near-duplicates of the board and burn crawl budget that belongs to room pages.

---

## 6. Performance decisions that are also SEO decisions

| Change | Why |
|---|---|
| Fonts load via `media="print" onload` | A blocking third-party stylesheet delayed first paint on every page. Text now paints immediately in the fallback face and swaps on arrival. |
| `PublicPreloadStrategy` replaces `PreloadAllModules` | The old strategy downloaded the landlord, tenant and admin chunks on the homepage, for visitors who could not reach them without a guard. On a contended mobile connection that competed directly with LCP. |
| Preload delayed 2s | Keeps secondary chunk fetches off the critical path until past LCP on slow 4G. |
| Hashed assets cached `immutable` for a year | `outputHashing: all` means a given filename can never go stale. Largest repeat-visit win. |

**Still open:** self-host Playfair Display and DM Sans under `/assets/fonts` to remove two DNS + TLS handshakes from the critical path.

---

## 7. Locale-scoped URLs and hreflang

Language used to be a `localStorage` toggle with no URL of its own. Every
language shared one address, so a translated page could not be linked, shared,
bookmarked, crawled or ranked — and SSR rendered English regardless of the
toggle, because the translation fetch had no origin on the server.

Language is now part of the URL.

| | URL |
|---|---|
| English | `/pricing` — unprefixed |
| Afrikaans | `/af/pricing` |
| isiZulu | `/zu/pricing` |

**English is deliberately unprefixed.** `/en/pricing` does not exist and 404s
on purpose. Serving both `/pricing` and `/en/pricing` would create two URLs
with identical content — the exact duplication hreflang exists to prevent —
and would invalidate every inbound link and every URL already indexed.

### How it fits together

| Piece | File | Does |
|---|---|---|
| Route tree | `app.routes.ts` | `CONTENT_ROUTES` declared once, mounted bare and under `:lang` |
| Match guard | `core/i18n/locale-routing.ts` | `:lang` only matches a real locale, so `/pricing` falls through instead of parsing as `lang='pricing'` |
| Locale applied | `core/i18n/locale-routing.ts` | Sets the language from the URL on every navigation, before SEO runs |
| Link preservation | `core/i18n/locale-url-serializer.ts` | Every `routerLink`, `navigate` and guard redirect keeps the locale |
| Translations | `core/i18n/translation-bundles.ts` | Static import map — works identically in SSR and the browser |
| hreflang | `core/services/seo.service.ts` | Reciprocal cluster plus `x-default` |
| Sitemap | `backend/.../seo.controller.ts` | One entry per page per locale with `xhtml:link` alternates |

### Only translated locales are published

Eight of the eleven bundles carry a `_meta_needs_translation` marker: they are
English text under another language's filename. That is a fine placeholder for
a runtime toggle and **harmful as a public URL** — `/xh/pricing` serving
English gives Google eleven addresses with identical content, which is
duplication, not localisation, and is the pattern that gets sites classed as
doorway pages.

So a locale is published only once `translated: true` in
`core/models/language.model.ts`. Until then it gets no URL prefix, no hreflang
entry, no sitemap entry, and no slot in the language switcher — offering
isiXhosa and delivering English is worse than not offering it.

**Currently published:** English, Afrikaans, isiZulu.
**Held back:** isiXhosa, Sesotho, Setswana, Sepedi, Xitsonga, siSwati,
Tshivenda, isiNdebele.

**To publish a language:** translate `frontend/src/assets/i18n/<code>.json`,
delete its `_meta_needs_translation` key, flip `translated: true` in the
language model, and add the code to `PREFIXED_LOCALES` in the backend SEO
controller. `npm run audit:i18n` fails if you do only some of those.

### The board is rendered per request; everything else is prerendered

`/` and `/{locale}` are `RenderMode.Server`. Pricing, how-it-works, advertise
and the legal pages are `RenderMode.Prerender`.

The split is content that changes between deploys. A prerendered page carries
whatever the API returned when the build ran, and on 28 September the
production database was cleaned of test rooms while the live board went on
advertising three of them, because the HTML holding them was days old. A room
let last week keeps its card until somebody redeploys. For a marketplace whose
value is which rooms are free right now, that is the wrong trade; for a pricing
page that says the same thing every day, prerendering is exactly right.

Rendering per request would be a bad trade on its own — a render, and an API
call, on the page a first-time visitor lands on, against an API that sleeps
when idle. So the freshness is bounded instead of per-request:

```
Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=600
```

`s-maxage` lets the CDN answer for a minute from one render.
`stale-while-revalidate` lets it keep answering instantly from the old copy
while fetching a new one, so a cold API delays a background revalidation
rather than a person. `max-age=0` keeps the visitor's own reload honest.

It is safe to cache publicly because the server renders the same HTML for
everyone: there is no session server-side, so a signed-in visitor gets the
signed-out shell and hydration corrects it — exactly as when this page was
prerendered for everybody.

Both halves are asserted. `verify-build.sh` fails if `index.html` reappears in
the build, if the served board is `ng-server-context="ssg"` rather than `ssr`,
or if the Cache-Control loses its shared-cache window — proven by reverting the
route and watching all three fail.

One thing depended on `index.html` existing and broke when it stopped:
`scripts/bundle-budget.mjs` read that file to sum the initial JavaScript.
It boots the server bundle and asks for `/` now, and also measures every
prerendered page, holding the costliest to the 170 KB budget. The board is the
costliest — 140.8 KB against `/pricing`'s 118.5 KB, because each page adds its
own route preloads to a shared nine-chunk graph and the board's are the
largest. Worth knowing before reaching for a prerendered page as a stand-in:
that substitution would quietly hand the budget 22 KB of headroom it does not
have.

### A published locale has to be served in that locale

Stated because it was not true. `/af` and `/af/pricing` were served in English
with `lang="af-ZA"` on them for as long as locale routing has existed, and
`/zu` was translated or not depending on which promise resolved first — the
app initializer fired the bundle load without awaiting it, so the render did
not wait. Everything around it was correct and every check agreed: the lang
attribute, the canonical, the hreflang set, the bundle's completeness, and the
page in a browser after hydration.

Two rules follow, and both are now asserted:

1. **The locale is applied before the first render.** The seed comes from
   `PlatformLocation` — the request URL on the server — and the app
   initializer *returns* the promise. English is a static import, so a bare
   URL waits for nothing.
2. **A check on served HTML reads the served bytes.** Playwright's
   `page.content()` serialises the hydrated DOM, which is the browser's
   repaired version of whatever the server sent. The locale-content assertion
   in `e2e/locale-and-seo.spec.ts` uses `request.get()`, and it was verified by
   putting the bug back and watching it fail.

And what "translated" covers: `scripts/i18n-audit.mjs` fails on a bundle key
no template reads. Eighteen of thirty-seven keys were translated and never
used — the footer, the auth labels, a hero that had been replaced — so the
switcher offered Afrikaans and delivered a translated navbar on an English
page. That is the same defect as publishing an untranslated locale, arriving
from the other side.

### Getting Google to know the site exists

Being crawlable is not being indexed. Nothing here submits the site anywhere —
Google finds a site by following a link to it or by being told, and a new
domain with no inbound links can go weeks undiscovered.

`GOOGLE_SITE_VERIFICATION` is the one piece of that which lives in the code.
Set it to the exact filename Search Console offers for HTML-file verification
(`google<hash>.html`) and `server.ts` serves it, with no rebuild and no file
committed — the body is derivable from the name. The token is not a secret: it
proves possession of the site to Google and grants nothing else.

The file method rather than the DNS TXT method on purpose. DNS is the usual
route and it is the one unavailable here while zone edits are not reaching the
authoritative nameservers. A URL-prefix property verified by file needs nothing
from DNS at all.

After verifying: submit `https://www.umastande.co.za/sitemap.xml` in Search
Console, and use URL Inspection → Request Indexing on the home page. Indexing
then takes days; ranking for anything competitive takes months, and neither is
something a deploy can hurry.

### Room pages carry no alternates

A landlord's title and description are written in their own words and are
never translated, so `/zu/rooms/abc` serves the same listing text as
`/rooms/abc`. Claiming alternates for identical content is an error Google
reports, not a ranking gain. Room pages set `alternates: false` and are
submitted once, at their English canonical. The chrome around the listing is
translated; the listing is not.

### Deliberately not done

No server-side redirect on `Accept-Language`. Google crawls from the United
States, and redirecting it away from the English canonical on a header it does
not send is a well-known way to have a site deindexed. A returning visitor with
a saved preference gets a client-only, replace-state redirect from an
unprefixed URL, which a crawler never sees.

---

## 8. Verifying a change

```bash
# Build and serve production locally
cd frontend && npm run build:prod && node dist/mastande-frontend/server/server.mjs

# Metadata is in the served HTML, not painted in after hydration
curl -s http://localhost:4000/pricing | grep -E 'canonical|og:title|name="description"|name="robots"'
curl -s http://localhost:4000/ | grep -c 'application/ld+json'

# Sitemap entries must all resolve
curl -s https://www.umastande.co.za/sitemap.xml \
  | grep -o '<loc>[^<]*</loc>' | sed 's/<[^>]*>//g' \
  | xargs -P4 -I{} sh -c 'printf "%s %s\n" "$(curl -s -o /dev/null -w %{http_code} {})" "{}"' \
  | grep -v '^200' || echo "every sitemap URL returns 200"

# Structured data, icons, private-route headers and robots.txt, read from the
# SERVED HTML — on BOTH builds, because they check different things and each
# build hides something the other shows.
#
# Development build (API on :3000, rooms from the local database): the room
# markup section runs, and robots.txt must REFUSE a crawl — a development
# deployment is not indexable and says so.
BASE=http://localhost:4200 node scripts/seo-drive.mjs
#
# Production build: canonical and the real site URL appear, the room section
# states a skip (this bundle fetches from api.umastande.co.za), and robots.txt
# must INVITE a crawl — which needs the server told that localhost is the site
# for this run and not a copy of it.
SITE_CANONICAL_HOSTS=localhost NG_ALLOWED_HOSTS=localhost PORT=4200 \
  node frontend/dist/mastande-frontend/server/server.mjs &
BASE=http://localhost:4200 SITE_CANONICAL_HOSTS=localhost node scripts/seo-drive.mjs
#
# ⚠️ Running it against the development build ALONE is how this drive reported
# 38/38 while crashing on the production build: the Organization logo is an
# absolute production URL there, and the check stripped `BASE` from it, which
# matches only when siteUrl is localhost. Both are in CI now; before 21 October
# neither was, and nothing ran this file at all.

# Routes, guards, internal links, locale sync, environment parity
npm run audit          # routes, guards, links, i18n parity, env parity

# Lighthouse
npx lighthouse https://www.umastande.co.za --preset=desktop --view
npx lighthouse https://www.umastande.co.za --form-factor=mobile --throttling-method=simulate --view
```

Targets: Performance ≥ 90 mobile, Accessibility 100, Best Practices 100, SEO 100. Run monthly — see `OPERATIONS.md` §5.

Two config files hold the numbers CI enforces, and they are not the same numbers:

| File | Audits | Asserts |
|---|---|---|
| `lighthouserc.json` | a production **build** served on localhost, four URLs, 3 runs | what the code should achieve in a lab: performance ≥ 0.9, accessibility 1.0, SEO 1.0, LCP 2500ms, CLS 0.1, TBT 200ms — and **best-practices ≥ 0.96, not 1.0** |
| `lighthouserc.production.json` | the live **site**, weekly | floors it must not fall below: SEO ≥ 0.9, LCP 4000ms, CLS 0.1, TBT 600ms |

The weekly floors used to be written as inline flags in the workflow while
`lighthouserc.json` carried different values for the same four metrics — two
sources of truth for one budget. The workflow now carries no thresholds.

**Why best-practices is 0.96 and not 1.0.** The local run serves the production
bundle, whose API URL is the real `api.umastande.co.za`, so the board's own
fetches are cross-origin from an origin the API does not allow and the browser
logs a network error: `errors-in-console`, weight 1, the only audit that
category loses. Allow-listing localhost in the production API's CORS policy
would buy 0.04 by widening what that API accepts, so the budget names the gap
instead. 0.96 rather than 0.95 keeps it able to fail — a second failing audit
drops the score below the line.

**No Core Web Vitals claim is made about production.** The weekly job has never
completed an audit: `lhci collect` ran from the repo root, picked up
`lighthouserc.json`'s `startServerCommand`, and died on `MODULE_NOT_FOUND`
trying to boot a server out of a `dist/` that job never builds. Fixed by passing
`--config` explicitly on every subcommand; until a run exists and is read,
nothing here has been measured against the live site.

---

## 9. The social card

`frontend/src/assets/images/og-default.png` — 1200 × 630, the fallback card for any page without its own image. Referenced by `index.html` and `SeoService`.

Generated, not exported:

```bash
npm run og:generate
```

`scripts/generate-og-image.py` builds it from the brand palette in `_variables.scss` and the short-form mission verbatim. It is a script rather than a one-off export because the wording on it is canonical — when the mission changes, the image has to change with it, and a PNG exported once from a laptop that no longer exists cannot be regenerated.

1200 × 630 is the size Facebook, WhatsApp, LinkedIn and X all accept without re-cropping. Text sits inside a 100px margin because some WhatsApp clients crop link previews to a narrower centre region.

WhatsApp matters most here: it is where South African landlords and tenants actually share links, and a blank preview there costs more than a blank preview anywhere else.

---

## 10. Keyword intent, mapped to pages that exist

⚠️ **Every row names a route that is live today.** Nothing here proposes a
page to be built later, and nothing claims inventory the board does not have.
A keyword with no honest page gets a row saying so, because the useful part of
this table is where it says *not yet*.

| Intent | Example query | Route | Audience | Title pattern | Indexable? |
|---|---|---|---|---|---|
| Brand | "mastande" | `/` | both | `Mastande — Rooms to Rent in South Africa, No Agent Fees` | ✅ |
| Browse all | "rooms to rent south africa" | `/` | tenant | as above | ✅ |
| One listing | "back room tembisa to rent" | `/rooms/:id` | tenant | `{title} — {locationDisplay}` | ✅ while `active` |
| A landlord | "{landlord name} rooms" | `/landlords/:slug` | tenant | set from the storefront | ✅ when live |
| How it works | "how to rent a room without an agent" | `/how-it-works` | both | `How Mastande Works — Find or Let a Room in South Africa` | ✅ |
| Cost | "is it free to list a room south africa" | `/pricing` | landlord | `Pricing — Free for Landlords \| Mastande` | ✅ |
| Sub-letting | "can a tenant sublet south africa" | `/legal/sublet` | both | `Renting a room from a tenant (sub-letting) — Mastande` | ✅ |
| Lease paperwork | "free lease agreement template south africa" | `/templates/:slug` | landlord | `{Name} — free South African template` | ✅ |
| Tenant rights | "rental housing tribunal {province}" | `/legal/disclaimer` | tenant | `Disclaimer — Mastande` | ✅ |
| Advertisers | "advertise to tenants south africa" | `/advertise` | advertiser | `Advertise on Mastande — Reach Movers in South Africa` | ✅ |
| **Location** | **"rooms to rent in pretoria"** | **none** | tenant | — | ❌ **no page exists** |
| **Student** | **"student accommodation {city}"** | **none** | tenant | — | ❌ **no such category** |
| **For sale** | **"property for sale {city}"** | **none** | — | — | ❌ **out of scope: this is a letting board** |

### The three ❌ rows, and why they stay ❌

**Location pages are the real gap and the one worth waiting for.** Filtered
URLs (`/?q=Pretoria`) are crawlable but canonicalise to `/`, so no location
query can rank today. The fix is a small set of genuine routes — not hundreds
of thin ones — and the gate is inventory: **a city page should exist only
above a floor of live listings**, appearing as supply arrives and disappearing
rather than rotting when it goes. Production currently holds single-digit
rooms, so every such page would be the thin page this brief warns against.

**Student accommodation** is not a room type this product has. Inventing the
category would be the same defect as a shortcut promising rooms the board
cannot deliver — fixed once already (checklist row 105).

**For sale** is not what this is. Mastande lets rooms; a sale page would be a
lie told for traffic.

---

## 11. Google Search Console — what to check, and what each answer means

### One-time

1. **Verify the property.** `server.ts` already serves a verification file from
   config — set `GOOGLE_SITE_VERIFICATION` to the token Search Console gives
   you, redeploy, then click Verify.
2. **Pick the canonical host.** Add `https://www.umastande.co.za` as the
   property. Confirm the apex 301s to it (the repo's own note says the apex is
   the old cPanel box answering `301 → www`); two hosts both serving 200 is a
   duplicate-site problem no markup can fix.
3. **Submit the sitemap**: Sitemaps → `sitemap.xml` → Submit. It is generated
   live by `seo.controller.ts`, so it never needs resubmitting after a deploy.

### Each time something ships

| Tool | What it tells you | What it does NOT tell you |
|---|---|---|
| URL Inspection → *View crawled page* | the HTML Google actually received | whether it will be indexed |
| URL Inspection → *Coverage* | indexed / excluded, and the reason | ranking |
| Rich Results Test | eligibility for a specific rich result | that one will be shown |
| Schema Markup Validator | whether the JSON-LD parses and is well-formed | eligibility for anything |
| PageSpeed Insights | lab numbers, plus field data when it exists | that field data reflects your change yet |

⚠️ **These five outcomes are not the same thing**, and conflating them is how
SEO work gets reported as finished when nothing has happened:

- structured data is **valid** — it parses;
- the page is **eligible** for a rich result — Google could show one;
- a rich result **appears** — Google chose to;
- the page is **crawled** — Googlebot fetched it;
- the page is **indexed** — it can be returned at all;
- the page **ranks** — somebody sees it.

Nothing in this repository can promise the last three. What it can do is make
the first three true, and that is all that is claimed anywhere in this file.

### Specific to this site

- Inspect one `active` room URL and confirm `index, follow` plus a self
  canonical in the crawled HTML.
- Inspect a `let` room and confirm `noindex` — it should drop out of the index
  on its own, and it is already out of the sitemap.
- Check **Pages → Excluded**. `Indexed, though blocked by robots.txt` on any
  `/tenant/`, `/landlord/`, `/account/` or `/admin/` URL means the
  `X-Robots-Tag` is not reaching that path; that header is the only signal
  that works on a URL a crawler is not allowed to fetch.
- Watch for `Duplicate, Google chose a different canonical` on `/?q=` URLs.
  That is expected and correct — they all canonicalise to `/`.
