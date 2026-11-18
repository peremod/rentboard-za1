# uMaStande — SEO Competitive Audit (Phase 1: Discovery & Diagnosis)

**Status: AUDIT ONLY. No application/website files changed by this report.**
Phase 2 (approval) and Phase 3 (implementation, TDD) do not begin until you approve.

Scope: competitive search strategy vs **uMaStandi** and the SA room-rental field;
the "No information is available for this page" Google problem; a full technical
SEO / Angular SSR audit; keyword, content, AEO, GEO, local, brand, backlink,
conversion and measurement strategy; a prioritised register and a 90-day roadmap.

---

## 0. Honest constraints on this audit (read first)

Three limits shape what is **confirmed** vs **flagged for external verification**.
Every finding below is labelled accordingly, per your instruction not to pretend.

1. **This analysis environment cannot reach the live site or the competitor.**
   The sandbox egress is a strict allowlist; direct fetches of `umastande.co.za`,
   `api.umastande.co.za` and `umastandi.co.za` are refused at the proxy, and
   `umastandi.co.za` also failed DNS resolution from here. So I did **not**
   inspect the competitor's live pages or our live rendered HTML from this
   session. What I *could* use: the full codebase (authoritative for how pages
   are generated), and the **live production `robots.txt`** which GitHub Actions
   fetched during today's v1.189.0 deploy and printed in the `Verify deployment`
   job log.
2. **No Google Search Console access and no paid keyword tools** (Ahrefs/SEMrush/
   Keyword Planner). So there are **no real search-volume numbers, no current
   ranking positions, and no impressions/clicks** in this report. Where the brief
   asks for those, I give the method and the exact data to pull — I do not invent
   figures.
3. **Much of this brief shipped hours ago in v1.189.0.** The AI-crawler policy,
   About page, BreadcrumbList, **gated province location pages**, sitemap
   entries and `docs/SEO-AEO-GEO-STRATEGY.md` are already live. This audit builds
   on `docs/SEO.md` and that work rather than repeating it, and several items the
   brief lists as gaps are now **done** — called out where so.

Labels used throughout: **[CONFIRMED]** (code/deploy evidence in hand) ·
**[PROBABLE]** (strong inference, not directly observed) · **[VERIFY]** (needs
Search Console / live access / a keyword tool).

---

## 1. Executive summary

**The foundation is unusually strong for a site this young.** The codebase has a
mature SEO layer — SSR metadata, canonical logic, `Organization`+`WebSite`
JSON-LD, a live-generated sitemap, an environment-aware `robots.txt`, a crawler
policy, and a verify-build gate that has already caught real regressions. Most
"basic SEO" boxes are ticked in code. The binding constraints on *winning* are
**not markup** — they are (a) getting Google to actually crawl, index and
describe the site, (b) **content and inventory depth**, and (c) **authority**
(inbound links / brand signals), none of which a deploy can manufacture.

**The single most urgent item** — the "No information is available for this page"
snippet — is **almost certainly a crawl/indexing-history problem, not a current
code defect.** The conditions that produce that exact Google message (a
`robots.txt` that blocked the crawl, and/or a page that rendered as an empty
client-side shell) **existed in this site's recent past and are now fixed**
(v1.165.0 made the board server-rendered; v1.189.0 shipped the current crawlable
robots). It will not clear until Google **re-crawls**, and the fastest honest
lever for that is **Search Console verification + Request Indexing + sitemap
submission** — which needs you, because it needs the Google account and (per
`docs/SEO.md`) there is an unresolved **DNS** issue on the domain.

**Against uMaStandi specifically:** I could not inspect their live site from
here, so their business model, positioning and footprint are **[VERIFY]**. But
the brand-name collision (uMaStande vs uMaStandi — one letter) is real and
cuts both ways: it is a **brand-defence priority** (own our exact-match brand
SERP so a searcher who means us is not handed them, and vice-versa) and a
**disambiguation opportunity** (clear entity signals so Google models us as a
distinct thing). Neither requires imitating them.

**Where the leverage is, in order:** (P0) prove indexability to Google and clear
the snippet; (P1) own the brand SERP and finish the technical gaps; (P2) content
+ location depth as inventory grows; (P3) authority and long-term topical
coverage.

---

## 2. Current search-visibility assessment  [mostly VERIFY]

- **Indexation / ranking / impressions:** unknown from here — needs Search
  Console (§17). A US-market web search for `umastande` and `umastandi` surfaced
  **neither** brand on page one; that is expected for small, new `.co.za` sites
  in a US index, and is weak evidence of **low external authority / few inbound
  links** rather than a defect. **[PROBABLE: low authority, early-stage index
  presence.]**
- **The reported symptom** ("No information is available for this page") tells us
  Google **has the URL** (so discovery has happened) but **could not render a
  description** — diagnosed in §4.
- **Baseline you must capture before any change** (so progress is measurable):
  Search Console → Performance (impressions, clicks, avg position, top queries);
  Pages (indexed vs excluded, with reasons); the `site:umastande.co.za` result
  count; and a PageSpeed Insights field-data snapshot for `/` and one room URL.

---

## 3. The two businesses, and the brand collision

### uMaStande (us) — [CONFIRMED from code + CLAUDE.md]
A South African **room-letting notice board**: tenants discover rooms (shared
house, en-suite, studio, private) posted **directly by landlords and
sub-lessors**; **free to list, free to apply, no estate agent**. Not an agency,
not a deposit/rent custodian, not a PPRA property practitioner (ECTA
intermediary only). Positioning to protect in search: *direct-from-landlord,
no-agent, no-fee room discovery across South Africa.* Do not let any SEO copy
imply agency services, deposit holding, or coverage/inventory we do not have.

### uMaStandi (competitor) — [VERIFY — could not access]
I could not load `umastandi.co.za` from this environment (DNS/egress), and US
web search did not reveal it. **I will not guess their model.** To analyse them
properly you (or a session with open egress) need to pull: their homepage
`<title>`/meta, nav/page types, positioning/tagline, geographic focus, and a
backlink/keyword snapshot from a real tool. Method and matrix are in §15.

### The name collision — [CONFIRMED it exists; impact VERIFY]
`uMaStande` vs `uMaStandi` differ by one trailing letter. Consequences:
- **Risk:** query/entity confusion. A user who means us may click them (and
  vice-versa); Google may treat the two as variants and split/merge signals.
- **Opportunity:** whoever earns the clearer **entity** (consistent name, logo,
  `Organization` schema, `sameAs` social profiles, an About/contact page, inbound
  links using the exact name) wins the disambiguation — and we shipped the
  entity scaffolding today (About page + `Organization`/`WebSite` graph).
- **Defensive play (P1):** make our **brand SERP** unambiguous — exact-match
  title, a description that says what we are in the first 120 chars, `sameAs`
  links, and ideally sitelinks eligibility via clear internal structure. The goal
  is that `uMaStande` returns *us*, described correctly, above the fold.
- **Never** represent any affiliation with uMaStandi, and never target their
  brand terms deceptively. Clarity, not imitation.

---

## 4. "No information is available for this page" — technical diagnosis (PRIORITY)

### What the message means (not a guess — it is a specific Google state)
Google shows *"No information is available for this page"* when it **has the URL
in its index but was not allowed to, or could not, fetch/render the content** to
build a snippet. The classic cause is **`robots.txt` blocking the crawl** (the
URL is known from a link or sitemap, but Googlebot is refused, so there is
nothing to describe). A secondary cause is **a page that returns no meaningful
content to a non-JavaScript fetch** (an empty client-side shell).

### Ranked causes, with evidence

**Cause A — a `robots.txt` that blocked the crawl at the time Google last saw it. [PROBABLE — strong]**
This site's own history (per `docs/SEO.md` §5 and `docs/OUTSTANDING.md`) records
*exactly* the states that produce this message:
- Until v1.73.0 the **site origin had no `robots.txt` at all** — both
  `/robots.txt` and `/sitemap.xml` fell through to the SPA catch-all and returned
  **HTTP 200 with the "Page not found" HTML page**. Lighthouse parsed it as "58
  errors"; any crawler got a non-robots document.
- The API-unreachable **fallback originally served `Disallow: /`** to the live
  site (later corrected) — a blanket block Google obeys.
- **Non-canonical hosts** (Vercel previews, and historically the apex / old
  cPanel box) answer `Disallow: /`. If Google first discovered the site on a
  preview URL or the apex before the `301 → www` and canonical were correct, it
  would have indexed a URL it was then told not to crawl → this exact snippet.

  → **Evidence:** `frontend/src/server.ts` (`isCanonicalHost`, `fallbackRobots`),
  `backend/src/modules/seo/seo.controller.ts` (`buildRobotsTxt`), SEO.md §5.
  → **Current state [CONFIRMED]:** the **live production `robots.txt` today is
  crawlable** — the v1.189.0 `Verify deployment` job fetched it and it is
  `User-agent: *` / `Allow: /` with only private areas and AI-training crawlers
  disallowed, plus a valid `Sitemap:` line. So the block, if it was the cause,
  **is already removed.** It will clear on re-crawl, not before.

**Cause B — the board rendered as an empty client-side shell. [CONFIRMED fixed]**
Before v1.165.0 the board (`/`) was `RenderMode.Client`: a crawler that runs no
JavaScript received "a page with no rooms, no hero" (OUTSTANDING §103/§87). Even
when crawlable and indexed, there was little to describe. It is now
`RenderMode.Server` and server-renders real content; room pages are Server too.
→ **Evidence:** `frontend/src/app/app.routes.ts` (`RenderMode.Server` on `''`,
`rooms/:id`, `landlords/:slug`, and now `rooms/in/:location`), SEO.md §7.

**Cause C — discovery / DNS, not a block at all. [PROBABLE + a real DNS flag]**
`docs/SEO.md` §7 states plainly: *nothing auto-submits the site; a new domain
with no inbound links can go weeks undiscovered*, and — importantly — notes an
unresolved DNS problem: *"zone edits are not reaching the authoritative
nameservers."* If the apex/www or verification depends on DNS that is not
propagating, Google may have a stale or partial view. This is **[VERIFY]** —
it needs a live DNS check (`dig umastande.co.za`, `dig www.umastande.co.za`,
confirm apex `301 → www`) and Search Console.

### What is NOT the cause [CONFIRMED]
- Not a `noindex` on public pages: public routes render `index,follow`; `noindex`
  is correctly scoped to `/auth`, `/tenant`, `/landlord`, `/account`, `/admin`
  and non-indexable environments.
- Not a missing title/description on the homepage: `/` has a title
  (`Mastande — Rooms to Rent in South Africa, No Agent Fees`) and a meta
  description in its route data, server-rendered.
- Not a current robots block (see Cause A "current state").

### Fix & verification
Most of the *code* fixes already shipped (crawlable robots; SSR board). The
remaining work is **operational and yours**, because it needs the Google account
and the DNS:
1. **[VERIFY/you]** Search Console: verify `https://www.umastande.co.za` (the
   repo already serves a `GOOGLE_SITE_VERIFICATION` file from config — set the
   token, redeploy, Verify).
2. **[VERIFY/you]** Submit `sitemap.xml`; run **URL Inspection → Request
   Indexing** on `/` and 2–3 key URLs; read **View crawled page** to confirm
   Google now receives full HTML and a crawlable robots.
3. **[VERIFY/you]** Confirm DNS: apex resolves and `301 → www`; www serves 200;
   no stale records. Resolve the "zone edits not reaching nameservers" note.
4. **How you'll know it worked:** the snippet changes from "No information…" to a
   real description within days-to-weeks of a successful re-crawl; Search Console
   → Pages shows the URL `Indexed`; `site:umastande.co.za` shows described
   results.
5. **Does it affect other URLs?** [PROBABLE] Yes — if Cause A/B applied to `/`
   it applied site-wide at the time; the same re-crawl clears them. Prioritise
   `/`, `/how-it-works`, `/pricing`, and active room URLs for Request Indexing.

**Severity: P0** (the site is effectively invisible-in-description until this
clears). **SEO consequence:** suppressed CTR, weak brand SERP, and — given the
name collision — a gap uMaStandi can occupy.

---

## 5. Technical SEO audit (code-evidenced)

### Crawlability — [CONFIRMED strong, one gap]
- `robots.txt` correct and environment-aware; private areas disallowed; filter
  permutations (`?province=`, `?maxRent=`, `?sort=`) and `?utm_` disallowed to
  protect crawl budget; AI-training crawlers blocked, search crawlers allowed.
- Internal links are real `<a href>` (RouterLink) and server-rendered; nav,
  footer and the new board "Rooms by province" block give crawlable paths.
- **Gap [CONFIRMED]:** at single-digit inventory, deep crawl paths are thin —
  few room URLs exist to discover. This is an inventory problem, not a code one.

### Indexability — [CONFIRMED well-modelled]
- `noindex` scoped to auth/portal/admin; `let`/`paused`/`draft` rooms excluded
  from the sitemap and set `noindex`; filter URLs canonicalise to `/`.
- Canonical derived from path; **canonical is correctly null on non-indexable
  (dev/staging) builds** and self-referential on production.
- **Watch item [VERIFY]:** `Indexed, though blocked by robots.txt` on any
  `/tenant|/landlord|/account|/admin` URL would mean the `X-Robots-Tag` is not
  reaching it — check in Search Console → Pages → Excluded.

### Angular SSR — [CONFIRMED strong; note: Angular 21, not 19]
- The brief says "Angular 19"; this project is on **Angular 21 SSR** (CLAUDE.md).
  Metadata, canonical, robots meta, OG/Twitter and JSON-LD are emitted in the
  **server-rendered HTML** (via `SeoService` + route `data.seo` + a route-SEO
  provider), not painted post-hydration — `scripts/seo-drive.mjs` asserts this
  against served bytes on both dev and prod builds.
- Per-route metadata exists for `/`, room, storefront, static pages, legal,
  templates, About and the new location pages. **[CONFIRMED]**
- **Gap [CONFIRMED]:** fonts were still render-blocking third-party until
  recently; SEO.md §6 lists "self-host Playfair Display + DM Sans" as open —
  **verify it's done** in the current build (the font-lint drive suggests local
  self-hosting is in place; confirm no third-party font origin on the critical
  path).

### Performance / Core Web Vitals — [CONFIRMED headline fixed; rest VERIFY]
- The board's catastrophic CLS (0.953) / Perf 0.62 was **fixed and verified in
  production 25 Oct (v1.165.0)** — the 16 Nov weekly audit shows board CLS 0.000,
  LCP ~2089 ms, SEO 1.0. **This is no longer an open item** (correcting the
  brief's framing of it as current).
- **[VERIFY]** Field CWV (CrUX) for all templates needs PageSpeed Insights /
  Search Console → Core Web Vitals once there is traffic. Lab budgets run in CI
  (`lighthouse.yml`, `bundle-budget.mjs`).

### Architecture — [CONFIRMED sound]
URL structure is clean (`/rooms/:id`, `/landlords/:slug`, `/rooms/in/:province`,
legal/static). BreadcrumbList on room/storefront/location pages. Sitemap is
live-generated and environment-correct. **Gap:** location hierarchy is
province-level only (city/suburb is the documented next increment, gated on
inventory).

---

## 6. Google Search Central compliance — [CONFIRMED aligned]
I could not fetch the docs live (egress), so I apply current Google guidance from
knowledge and cite the canonical references. The implementation already follows
Search Essentials: crawlable server-rendered content, honest structured data (no
fake reviews/ratings/prices — `RealEstateListing` with real fields only), no
cloaking, no `Accept-Language` redirect of Googlebot, scoped `noindex`, a real
sitemap. **No outdated tactics or undocumented "hacks" are present or
recommended.** Nothing in this plan relies on `llms.txt`, fabricated FAQPage
enhancements, or keyword stuffing. References to apply during Phase 3:
Search Essentials; SEO Starter Guide; JavaScript SEO basics; Crawling & Indexing;
Structured Data intro + policies; Spam policies; Core Web Vitals; Google Images.

---

## 7. Keyword intent & competitive keyword map — [strategy CONFIRMED; volumes VERIFY]
`docs/SEO.md` §10 already maps intent to **live routes** honestly. Extending it,
with the explicit caveat that **every volume/difficulty cell needs a keyword
tool** — I am giving intent, fit and a landing target, not invented numbers.

**Tenant head terms** (national, high competition from Gumtree/Property24/
PamGolding): `rooms to rent in south africa`, `room to rent`, `shared
accommodation south africa`, `cheap/affordable rooms to rent` → `/` (board).
*We will not beat portals on these head terms early; they are brand+long-tail
plays.*

**Tenant long-tail / local (the real opportunity):** `rooms to rent in
{city/township/suburb}`, `back room to rent in {area}`, `room to rent no deposit
{area}`, `en-suite room {area}` → **province pages today (`/rooms/in/:slug`),
city/suburb pages as inventory arrives.** Long-tail + local is where a focused
notice board can rank before it has portal-scale authority.

**Landlord acquisition (underserved, high conversion):** `how to rent out a room
in south africa`, `advertise a room for free`, `find a tenant for my room`,
`free lease agreement south africa` (→ `/templates`), `tenant screening south
africa`. These have clear intent, lower competition than tenant head terms, and
map to pages we can make genuinely useful. **High priority for content.**

**Brand:** `umastande`, `umastande rooms`, `umastande.co.za`, and the
**collision set** `umastandi` vs `umastande` — own our own, disambiguate.

For each cluster, the deliverable table (keyword · intent · est. demand
*[tool]* · difficulty *[tool]* · current rank *[GSC]* · relevance · landing
page · priority · conversion potential) can only be completed with a tool +
Search Console; §17 lists exactly what to pull.

---

## 8. Content architecture — [plan; builds on strategy doc]
Six pillars (detailed in `docs/SEO-AEO-GEO-STRATEGY.md`), re-stated with the
honesty guardrails the brief demands:
1. **Rooms to rent** — the board `/` and province pages are the authority hub.
2. **Shared accommodation / room types** — thin landing content only where it is
   true and backed by inventory.
3. **Tenant resources** — finding a room safely, viewing checklists, questions to
   ask a landlord, deposits, rental scams, tenant rights. **Legal content must be
   sourced and not presented as legal advice** (the legal pages are *not*
   attorney-reviewed — OUTSTANDING §8 — so FAQPage schema over them is **declined**
   until reviewed).
4. **Landlord resources** — advertise a room, price a room, prepare a room, find
   & screen tenants, lease templates. **Highest-ROI content** (acquisition +
   low competition).
5. **Local pages** — province now; city/suburb **only above an inventory floor**
   (the gate already exists in code). No doorway/thin pages.
6. **Education / knowledge** — answer real SA tenant/landlord questions, original
   and useful.
Roadmap (titles · intent · primary/supporting keywords · internal links ·
conversion target) to be finalised in Phase 3 once priorities are approved.

---

## 9. Structured data strategy — [CONFIRMED base; small extensions]
Present and valid: `Organization`, `WebSite` (with `SearchAction` if wired),
`RealEstateListing` (+ `Offer`, `LeaseOut`, area), `BreadcrumbList`,
`CollectionPage`+`ItemList` (location pages). Candidate additions, only where
truthful and supported: `WebPage`/`AboutPage` on `/about`; `Article`/
`BlogPosting` when the content pillars exist; `FAQPage` **only** on
attorney-reviewed content. **No** fabricated reviews/ratings/prices/availability;
no invisible or mismatched schema. Validate every change with the Rich Results
Test + Schema Markup Validator (validity ≠ eligibility ≠ appearance — SEO.md §11).

## 10–11. AEO & GEO — [plan; aligned with strategy doc + today's robots policy]
AEO: answer-first structure on resource pages, real questions, complete answers,
`FAQPage` only where legally reviewed. GEO: the levers are clear brand entity,
accurate facts, crawlable useful content, and **our new robots split
deliberately lets AI *search/retrieval* crawlers in (OAI-SearchBot,
Claude-SearchBot, PerplexityBot) while blocking *training* crawlers** — so we can
be cited without feeding training corpora. No gimmicks; no `llms.txt` promise.

## 12. Backlink & authority — [plan]
90-day, legitimate, SA-focused: relevant property/housing resources, SA business
directories, landlord/student communities, original data (e.g. "what rooms
actually cost across SA townships", from our own board), local press. Quality
over quantity; no PBNs, link farms, or paid spam. This is the slowest lever and
the one that most moves the collision outcome vs uMaStandi.

## 13. Conversion SEO — [plan; audit needs live UX pass]
Map the two journeys (tenant: search → listing → account → contact; landlord:
value → account → post → enquiries) and remove friction at each step. The board
already addresses several (search-read chips, free-to-apply messaging). A full
conversion audit needs the live site (egress-blocked here).

## 14 & 17. Search Console + analytics plan — [VERIFY/you]
One-time: verify the www property (file token already served), submit sitemap,
confirm apex `301 → www`. Per-ship: URL Inspection, Pages (indexed/excluded +
reasons), Performance (queries/impressions/clicks/CTR/position), Core Web Vitals.
**GA4 is intentionally not wired** (no Measurement ID; privacy-first in-house
`room_view_days` + Bing Webmaster is the current path). Capture a **baseline
before Phase 3** so progress is measurable.

## 15. Competitor gap matrix — [METHOD; data VERIFY]
Cannot be completed without live access to uMaStandi + a keyword/backlink tool.
Fill this once accessible — columns: *dimension · uMaStandi · uMaStande ·
who's ahead · why it matters · copy-concept/avoid · our better alternative ·
priority · business impact.* Dimensions: brand SERP, keyword coverage, intent
coverage, architecture, content depth, technical SEO, authority/backlinks, UX,
SERP appearance, conversion. **We are not imitating them — we are building the
clearer, more useful, better-structured platform.**

---

## 16. Prioritised register & roadmap

**P0 — unblock indexing (needs you; mostly operational, code already shipped)**
- Search Console: verify www, submit sitemap, Request Indexing on `/` + key URLs.
- Confirm DNS (apex `301→www`, www 200, nameserver zone edits propagating).
- Confirm the live board/room HTML Google receives is full (URL Inspection →
  View crawled page). → **clears "No information available".**

**P1 — brand SERP + technical finish (code; after approval)**
- Brand-entity polish: `sameAs` social profiles on `Organization`, About-page
  `AboutPage`/`WebPage` schema, tighten homepage meta description for the SERP.
- Confirm fonts self-hosted (remove any third-party critical-path origin).
- `WebSite` `SearchAction` (sitelinks-search eligibility) if not already present.
- Verify `X-Robots-Tag` reaches every private prefix (GSC Excluded check).

**P2 — content + local depth (grows with inventory)**
- Landlord-acquisition content pillar (highest ROI, lowest competition).
- Tenant safety/how-to content (sourced; no unreviewed legal advice).
- City/suburb location pages as inventory crosses the gate.

**P3 — authority + long-term dominance**
- 90-day backlink/authority programme; original SA rooms-pricing data; topical
  coverage; ongoing brand-collision monitoring vs uMaStandi.

**Roadmap:** first 24h/7d = P0 (yours, in Search Console + DNS); 30d = P1 code +
baseline; 31–60d = P2 content/landlord pillar; 61–90d = P2 local + P3 authority
kickoff; 6-month = topical authority + measured ranking review.

---

## 18–19. TDD & Definition of Done (for Phase 3, when approved)
All Phase-3 changes to metadata, rendering, routing, sitemap or indexing rules
follow RED→GREEN→REFACTOR and extend the existing suites (`seo-drive.mjs`,
`robots.spec.ts`, `locations.spec.ts`, `verify-build.sh`). Done = snippet cause
documented/cleared, public pages crawlable with correct SSR'd metadata, brand
entity clear, canonical/sitemap/robots validated, private pages `noindex`,
structured data valid & truthful, keyword map complete, content roadmap set,
Search Console configured or its remaining steps documented, tests + regression
green, performance documented — **and no fabricated content, reviews, stats,
listings or claims introduced.**

---

## Phase 2 — approved ("do all the phases")

## Phase 3 — implemented (code), with what was found already-done and what stays yours

Phase 3 was scoped **honestly against the live code**, not against the brief's
generic P1 list — because several of that list's items were already shipped, and
one would require fabrication. What that inspection found, and what was built:

### Built (TDD: RED → GREEN → prove-the-check-fails)
- **`AboutPage`/`WebPage` JSON-LD on `/about`.** The one genuinely-missing,
  high-value, truthful change. `/about` carried prose but no structured data of
  its own; it now emits an `AboutPage` node whose `about` and `isPartOf`
  references reuse the **exact `@id`s** the site graph mints (`#organization`,
  `#website`), so a parser reads "this page is about the company that publishes
  this site" instead of describing a second, unlinked company. This is the
  entity-disambiguation signal the one-letter uMaStandi collision makes worth
  stating. It invents nothing — no address, phone, rating or review — holding the
  same line `site-identity.ts` holds.
  - Unit: `frontend/src/app/features/pages/about/about.spec.ts` (3 tests). The
    @id-link guard and the fabrication guard were each proven to fail under a
    deliberate mutation (wrong `@id`; injected `telephone`), not merely to pass.
  - Served bytes: `scripts/seo-drive.mjs` "About entity page" section asserts the
    block is in the **prerendered HTML** and its `@id`s match the Organization/
    WebSite nodes on that same page — proven to fail when `AboutPage` is absent.
- **Private-prefix `noindex` drive hardened.** `seo-drive.mjs` probed 5 of the 7
  `PRIVATE_PREFIXES`; `welcome` and `reference` had no probe, so a refactor could
  have dropped either with every test still green. It now probes all seven, and
  dropping one was proven to fail the check.

### Found already-done — recorded, not re-shipped (no churn on good code)
- **`WebSite` `SearchAction`** — present (`site-identity.ts`), pointing at the
  board's real `/?q=` search; the drive asserts the search URL answers 200.
- **Brand / homepage meta description** — already brand-correct in its first 120
  chars (`/about` route meta and `FALLBACK_DESCRIPTION`). Changing good copy for
  its own sake was declined.
- **Fonts self-hosted** — Playfair Display + DM Sans served from origin; the
  font-lint gate asserts no third-party font origin is fetched by `index.html`.
- **`X-Robots-Tag` on private prefixes** — set by server header on all seven
  prefixes (`server.ts`), independent of JavaScript or robots.txt; drive-tested.
- **Verification-file route** — `GOOGLE_SITE_VERIFICATION` wiring is live in
  `server.ts`; setting the token is operational (Step 1 of the runbook).

### Declined on principle (would require fabrication) — unchanged
- **`sameAs` social profiles** on `Organization`. Umastande has no social
  accounts linked from the site, so any `sameAs` URL would be invented —
  `site-identity.ts` omits them deliberately and that stands. Add them only when
  real profiles exist.
- **`FAQPage`** over the legal/resource pages — declined until that content is
  attorney-reviewed (OUTSTANDING §8).

### Stays yours (operational — no deploy can do it)
- **P0: clear "No information is available for this page."** The code causes are
  fixed; the lever is Search Console verification → sitemap → Request Indexing,
  plus confirming apex→www DNS. Full step-by-step:
  **`docs/SEO-SEARCH-CONSOLE-RUNBOOK.md`.**
- **P2/P3** (content pillars, city/suburb pages as inventory crosses the gate,
  backlink/authority programme) grow with real inventory and real links and are
  not manufacturable by a deploy. Register and roadmap: §8, §16 above and
  `docs/SEO-AEO-GEO-STRATEGY.md`.

**No fabricated content, reviews, stats, listings or claims were introduced, and
no affiliation with uMaStandi is represented anywhere.**
