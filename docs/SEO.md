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

`SeoService.setJsonLd(id, data)` writes a keyed `<script type="application/ld+json">`. Keyed so a page can replace its own block without disturbing another.

Room pages emit `Product` + `Offer`, not a real-estate type. A room let is priced, has an availability date, and carries landlord reviews — that shape is what earns a rich result. `aggregateRating` is included only when the landlord actually has ratings; a fabricated or empty rating block is a manual-action risk.

Validate at [search.google.com/test/rich-results](https://search.google.com/test/rich-results) against a production room URL.

---

## 4. Per-environment behaviour

| | Development | Staging | Production |
|---|---|---|---|
| `environment.siteUrl` | `http://localhost:4200` | `https://staging.umastande.co.za` | `https://umastande.co.za` |
| `environment.indexable` | `false` | `false` | `true` |
| Meta robots | `noindex, nofollow` | `noindex, nofollow` | `index, follow, max-image-preview:large` |
| Canonical emitted | no | no | yes |
| `robots.txt` (backend) | `Disallow: /` | `Disallow: /` | full allow list |
| `X-Robots-Tag` header | — | `noindex, nofollow` | — |

Staging is blocked three independent ways: the meta tag, `robots.txt`, and the Vercel header. Duplicating a whole site's copy under a second indexable domain is the fastest way to make it compete with itself, so this is deliberately over-engineered.

The backend reads `SITE_URL` and `NODE_ENV` from config. **Set `SITE_URL` on every deployment target** — it is in `backend/.env.example`. Missing it falls back to the production origin, which would make staging publish production URLs in its own sitemap.

---

## 5. robots.txt and sitemap.xml

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
curl -s https://umastande.co.za/sitemap.xml \
  | grep -o '<loc>[^<]*</loc>' | sed 's/<[^>]*>//g' \
  | xargs -P4 -I{} sh -c 'printf "%s %s\n" "$(curl -s -o /dev/null -w %{http_code} {})" "{}"' \
  | grep -v '^200' || echo "every sitemap URL returns 200"

# Routes, guards, internal links, locale sync, environment parity
npm run audit          # routes, guards, links, i18n parity, env parity

# Lighthouse
npx lighthouse https://umastande.co.za --preset=desktop --view
npx lighthouse https://umastande.co.za --form-factor=mobile --throttling-method=simulate --view
```

Targets: Performance ≥ 90 mobile, Accessibility 100, Best Practices 100, SEO 100. Run monthly — see `OPERATIONS.md` §5.

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
