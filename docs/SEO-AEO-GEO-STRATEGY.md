# Search visibility strategy — SEO / AEO / GEO gap analysis

**Scope:** traditional SEO, technical SEO, on/off-page, local, programmatic, entity,
Answer Engine Optimisation (AEO), Generative Engine Optimisation (GEO), content &
topical authority, measurement.
**Method this round:** inspection of the repo's existing SEO implementation and
`docs/SEO.md`, the frontend SSR/routing/metadata, backend `seo` module, and
deployment config. **Audit only — nothing changed.** Awaiting approval before any
implementation (brief Step 4).

---

## 0. Executive summary — read this first

**The technical and traditional SEO foundation here is strong and close to
complete.** `docs/SEO.md` documents it and it is real in the code: SSR-rendered
per-route metadata, correct canonicals, locale-scoped URLs with hreflang,
Organization + WebSite JSON-LD as a cross-referenced `@graph`, RealEstateListing
markup on rooms, `X-Robots-Tag` on private routes, an environment-aware robots.txt,
a sitemap built from live rooms + published storefronts + static pages, a social
card, a `seo-drive.mjs` that verifies the **served HTML** on both build types in
CI, and Lighthouse budgets. This is not a site that needs its SEO rebuilt.

**So this is a gap analysis, and the honest headline has three parts:**

1. **The binding constraint is not technical SEO — it is content and inventory.**
   SEO, AEO and GEO all feed on two things this platform does not yet have much of:
   public **content** (there are no guides, no blog, no FAQ pages, no location
   pages) and **listing inventory** (production holds single-digit rooms, per
   `SEO.md` §10). The prior work already reached this conclusion and refused to
   build thin location pages — that judgement was correct and this strategy keeps
   it. The biggest wins are **authoring genuinely useful content** and **growing
   supply**, not more markup.

2. **The board Core Web Vitals "Priority 1" was STALE — it is already fixed.**
   ⚠️ Correction (17 Nov 2026): this section first cited the board at Performance
   0.62 / CLS 0.953 from `SEO.md` §8's *21 October* table. That defect — the board
   served as a client-side shell — was fixed and verified in production on **25
   October** (v1.165.0, `OUTSTANDING.md` §87i). The **16 November** weekly
   production audit measures the board at **CLS 0.000** (runs 0.018/0.000/0.000),
   LCP 2089 ms, SEO category 1.0. There is **no open Core Web Vitals or SEO defect
   on the board.** (The weekly job's current red is `link-in-text-block` /
   accessibility — the cookie-notice link — which master v1.188.0 now carries, a
   separate a11y-deploy matter, not SEO.)

3. **AEO and GEO are genuinely greenfield, and that is the opportunity — but only
   if built on real content.** No AI-crawler policy, no FAQ/answer-first structure,
   no BreadcrumbList, no content ecosystem. These are worth doing. None of them is a
   trick, and none should be done by generating thin or fabricated content. The
   platform's honest edge — "free to list, free to apply, no agent", a real South
   African letting process, lease templates, sub-letting law — is exactly the kind
   of first-hand, specific material answer engines cite.

**What this strategy will NOT do** (consistent with the brief and the repo's ethos):
invent inventory, fabricate statistics or reviews, build hundreds of thin location
pages, add FAQ schema to pages that have no real Q&A, invent authors or credentials,
add `sameAs`/address/ratings that don't exist, or promise rankings or AI citations.

---

## 1. Gap-analysis table (Phase 1)

Severity key: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low · ✨ Enhancement.

| Area | Existing implementation | Current condition | Missing / weak | Sev | Recommended action |
|---|---|---|---|---|---|
| **SSR metadata** | Per-route `data.seo` + `SeoService`, dynamic room/storefront metadata, verified in served HTML by `seo-drive.mjs` | ✅ Working, tested in CI | Nothing material | 🟢 | Keep. Reuse the same mechanism for any new page. |
| **Canonical URLs** | Derived from resolved URL, redirect-aware | ✅ Working | — | 🟢 | Keep. |
| **robots.txt** | Env-aware; blocks private areas, filter params, UTM; all 11 locales | ✅ Working for classic crawlers | **No AI-crawler policy** (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot all fall under `*`) | 🟠 | Add an explicit, documented AI-crawler policy (Phase 5.1 below). |
| **Sitemap** | Live rooms + published storefronts + static pages; all entries 200 | ✅ Working | No `<lastmod>` on some static entries; no image or news sitemap | 🟡 | Add `lastmod` where known; image sitemap only if listing photos become an SEO surface. |
| **Structured data** | Organization, WebSite (SearchAction), RealEstateListing — principled, no invented facts | ✅ Excellent, honest | **No BreadcrumbList, no FAQPage, no Article/BlogPosting** | 🟠 | Add BreadcrumbList (cheap, legitimate); add FAQPage/Article only where real content exists. |
| **Core Web Vitals** | Budgets in two lighthouse configs; board fixed 25 Oct (§87i) | ✅ **Board: CLS 0.000, LCP 2089ms** (16 Nov prod audit) | — (the 0.953 figure was stale) | 🟢 | None. Resolved before this work. |
| **On-page (static pages)** | `/`, `/how-it-works`, `/pricing`, `/advertise`, `/legal/*`, `/templates/*` — unique titles, H1s | ✅ Good | Not **answer-first**; thin on depth; few internal links between them | 🟡 | Restructure key informational pages answer-first (AEO); add contextual internal links. |
| **Location pages** | None (filtered URLs canonicalise to `/`) | ❌ Absent — **by deliberate, correct choice** | The real traditional-SEO gap, **gated on inventory** | 🟠 (blocked) | Build a *small* set of real city pages **only above a live-listing floor**, appearing/disappearing with supply. Do not build until inventory supports it. |
| **Content / topical authority** | `/legal/*`, `/templates/*`, `/how-it-works` are seeds | ❌ No guides, blog, FAQ, education hub | Entire AEO/GEO content ecosystem | 🟠 | A small, maintained content set on topics the platform can speak to first-hand. Phase 6. |
| **AEO (answer engines)** | None explicit | ❌ Absent | Question-based content, answer-first structure, FAQ where genuine | 🟠 | Phase 4 below. |
| **GEO (generative)** | None explicit | ❌ Absent | AI-crawler policy, source-worthy content, entity clarity for AI | 🟠 | Phases 5 below. |
| **Entity SEO** | Organization/WebSite `@graph`, `legalName` | ✅ Solid, honest | `sameAs` absent (no socials exist yet); no off-site entity consistency | 🟡 | Add `sameAs` *when* social/directory profiles exist; pursue legitimate citations. |
| **Local SEO** | ZA-targeted copy; `places` table | 🟡 Partial | No location pages, no Google Business Profile decision | 🟡 | GBP eligibility assessment (Phase 3.2); location pages gated on inventory. |
| **Off-page / authority** | None | ❌ Absent (new platform) | Realistic, ethical authority plan | 🟡 | Phase 2.4 — genuine citations, original research, no link schemes. |
| **Analytics** | In-house `analytics.service.ts` (POPIA-minimal `room_view_days`); GSC verification endpoint in `server.ts` | 🟡 GSC ready; **no GA4 / no Bing Webmaster** | Search + AI-referral measurement | 🟡 | Add Bing Webmaster (free, feeds Copilot); choose a privacy-conscious analytics path (Phase 9). |
| **Listing SEO** | Unique URLs/titles/desc, RealEstateListing, visibility tied to `status:active`, no address leak | ✅ Strong and correct | BreadcrumbList; `datePublished` in markup | 🟡 | Add breadcrumbs; surface publish date. |
| **Private-data protection** | Private routes `noIndex` + `X-Robots-Tag` + robots.txt; no address/PII in markup | ✅ Excellent (cross-checked in the security audit) | — | 🟢 | Keep. Any new crawler rule must preserve this. |

---

## 2. Traditional & technical SEO (Phase 2) — mostly done; two real items

**Done well (do not touch):** crawlability of public pages, SSR HTML, canonicalisation,
robots directives, HTTPS, duplicate-content control via canonicals, private-area
protection, hreflang/i18n, the `seo-drive.mjs` CI gate. The security audit
(`docs/SECURITY-ASSESSMENT-PENTEST.md`) separately confirmed public pages expose no
private data and private routes are protected — so "crawlable but safe" holds.

**Real items:**
- ✅ **Board Core Web Vitals — already fixed (25 Oct, §87i), not an open item.** The
  0.953/0.62 figures were stale; the 16 Nov production audit shows the board at CLS
  0.000 / LCP 2089 ms / SEO 1.0. Nothing to do here.
- 🟡 **Internal linking depth.** The static pages barely link to each other; room pages
  don't link to related rooms or a (future) location page. Thin internal linking caps
  topical authority. Address alongside content work.

**On-page (2.2):** titles/H1s are unique and intent-aligned. The gap is **depth and
answer-first structure**, covered under AEO.

**Keyword/intent (2.3):** already mapped honestly in `SEO.md` §10, including three `❌`
rows (location, student, for-sale) with correct reasons. **Keep that discipline.** The
only row worth reopening is **location**, and only when inventory clears the floor.

**Off-page/authority (2.4):** as a new platform with (per the brief's own caution) no
assumed customers or partnerships, the honest plan is: (a) get listed in legitimate ZA
business directories; (b) publish one or two pieces of **original, first-hand** material
worth citing (e.g. "how room-letting actually works in SA without an agent", a real
lease-template library) and let editorial links follow; (c) no purchased links, no
link farms, no fake reviews. Authority follows usefulness here; it cannot be bought
without risking the domain.

---

## 3. Local SEO (Phase 3)

- **Location pages (3.1):** the single biggest traditional opportunity *and* the one the
  prior work correctly deferred. Recommendation unchanged: a **small** set of genuine
  city/suburb pages, each **gated behind a live-listing floor** (e.g. ≥ N active rooms),
  generated from real inventory and **removed when supply drops** rather than left to rot.
  Build the *mechanism* now if desired, but publish pages only as inventory arrives.
  Never publish a page claiming rooms in an area with none.
- **Google Business Profile (3.2):** assess eligibility honestly. Mastande is an online
  service without a public walk-in office; GBP is for businesses with a physical location
  or defined service area. **Do not invent an address.** If the company has a registered
  service-area business footing it can support truthfully, a service-area GBP may qualify —
  otherwise skip it. This is a business/legal decision, not a code change.
- **Local content (3.3):** area guides are valuable *only* where the platform can say
  something true and first-hand. Tie them to inventory and verified facts (transport,
  amenities) with reliable sources — not scraped filler.

---

## 4. AEO — Answer Engine Optimisation (Phase 4)

**Greenfield, and the highest-leverage honest work after the board fix.** The platform
already answers real questions in its product (how letting works, sub-letting law,
what a lease needs); AEO is about making that extractable.

- **4.1 Question set:** build from genuine tenant/landlord questions the platform can
  answer truthfully — e.g. "what documents do I need to apply for a rental in SA",
  "can a tenant sublet", "what goes in a lease", "how do viewings work". Legal/financial
  answers must be accurate and sourced (Rental Housing Act, the tribunals); where the
  platform is not a legal authority, say so and link the real one.
- **4.2 Answer-first structure:** restructure the **existing** `/legal/sublet`,
  `/how-it-works`, and a new small FAQ/guide set as: clear question heading → concise
  direct answer → detail → example → internal link → next step. Do **not** force every
  page into FAQ shape.
- **4.3 FAQ schema:** add `FAQPage` JSON-LD **only** where the page genuinely contains
  those Q&As (e.g. a real pricing FAQ). Adding it elsewhere is a manual-action risk and
  the repo's own schema discipline already forbids invented markup.
- **4.4 E-E-A-T / trust:** add author/edited-by, published/updated dates, and references
  to any informational content — **without inventing authors or credentials**. A named
  real editor and honest dates; nothing fabricated.

---

## 5. GEO — Generative Engine Optimisation (Phase 5)

- **5.1 AI-crawler policy (the one concrete GEO change worth making now).** robots.txt
  currently treats every bot as `*`. A deliberate, documented policy should distinguish:
  - **AI *search/retrieval* crawlers** (e.g. `OAI-SearchBot`, `PerplexityBot`) — these
    power AI answers that can cite and link back. **Allowing** them is how the site
    becomes referenceable.
  - **AI *training* crawlers** (e.g. `GPTBot`, `CCBot`, `Google-Extended`, `ClaudeBot`) —
    these feed model training, not necessarily live answers. Allow or disallow is a
    **business/privacy decision**, not a technical default. The brief is explicit: do not
    assume allowing a training crawler is required to appear in AI search.
  - Verify exact user-agent tokens against each vendor's **current** published docs before
    writing them (they change). Whatever the decision, **private areas stay disallowed for
    every agent** — the existing private-route rules must be replicated per AI agent, not
    dropped. I'll bring the proposed exact robots.txt block for approval before shipping.
- **5.2 Clarity for AI:** ensure the homepage/About/service copy states plainly *what
  Mastande is, who it serves, where, and why it's useful* in factual language — AI systems
  extract this. The mission copy is strong; an explicit **About page** (currently thin)
  would help both AEO and GEO.
- **5.3 Entity recognition:** Organization/WebSite `@graph` is already correct. Add
  `sameAs` **when** real social/directory profiles exist (not before). Keep brand name,
  domain, logo, description consistent everywhere they appear.
- **5.4 Source-worthiness:** the genuinely citable assets this platform could own — a real
  SA tenant checklist, a landlord guide, a lease-template library with plain-language
  explanations, honest "how letting works here" material. Original and first-hand beats
  generic. **No fabricated statistics or market trends.**
- **5.5 Monitoring:** directly observable — branded-search impressions (GSC), referral
  traffic from AI hosts (analytics referrer), brand mentions (manual/alerts). Not
  observable — an "AI ranking score" (doesn't exist). Be explicit about which is which;
  promise no citations.

---

## 6. Content strategy & topical authority (Phase 6)

**Principle: a small, connected, maintained set — not a content farm.** Pillars the
platform can speak to first-hand: tenant education, landlord education, the SA letting
process, lease/paperwork (tie to the existing `/templates`), sub-letting (tie to
`/legal/sublet`), and — gated on inventory — location/area guides. For each pillar:
audience, intent, hub page, supporting pages, honest keywords, questions answered,
internal links, the platform feature it supports, format. Build **topic clusters** with a
hub-and-spoke internal-linking structure so the few pages reinforce each other. Publishing
cadence should match what can be **researched, reviewed and maintained** — slower and true
beats fast and thin.

---

## 7. Listing SEO (Phase 7)

Already strong: unique URLs/titles/descriptions, RealEstateListing markup, visibility tied
to `status: active`, no address/PII leak, expired/unpublished/deleted rooms correctly fall
out of the sitemap and public read. **Add:** BreadcrumbList on room and storefront pages
(Home → [City, when location pages exist] → Room), and surface `datePublished`. Keep the
rule that filter-permutation URLs are **not** indexable landing pages.

---

## 8. Competitive context (Phase 8)

Property24 and Private Property dominate sale + large-agency rentals with deep location-page
and portal infrastructure. **Mastande should not imitate them.** Its differentiation is
real and defensible: informal/room letting, no agent, free to list and apply, WhatsApp-first
distribution, a verification/trust model. The content and entity strategy should lean into
*that* identity rather than competing on breadth of listings it won't have. (Analysis from
public knowledge; no scraping of competitor assets.)

---

## 9. Measurement (Phase 9)

- **Present:** GSC verification endpoint (`server.ts`); in-house POPIA-minimal analytics.
- **Add, privacy-first:** Bing Webmaster Tools (free; feeds Copilot/Bing and is a second
  index signal). For traffic analytics, prefer a **privacy-conscious** option consistent
  with the existing POPIA stance (the in-house counter, or a cookieless analytics tool) over
  GA4 with its consent/privacy overhead — GA4 only if the business needs its funnels and the
  consent flow is updated **in the same change** (the PR template already enforces this).
- **Separate organic visibility from business results.** Impressions ≠ leads. Track the real
  outcomes the product already records (registrations, applications, viewing requests) against
  organic landing pages; do not report impression growth as lead growth.

---

## 10. Prioritised roadmap (Phase 11) — for approval

Each item: objective · benefit · files/pages · complexity · verification. TDD (RED→GREEN)
for code changes, per the repo standard; a `seo-drive.mjs` assertion for anything that
changes served HTML, robots.txt or the sitemap.

### Priority 1 — foundations (do first)
1. ✅ **Board CLS/LCP — already done (25 Oct, §87i).** Stale when first written; the
   board measures CLS 0.000 / LCP 2089 ms in the 16 Nov production audit. No action.
   The work below starts at P2.

### Priority 2 — technical & content improvements
2. **BreadcrumbList schema** on room + storefront (and home). Low complexity; `seo-drive.mjs`
   assertion. 3. **Answer-first restructure** of `/how-it-works` and `/legal/sublet` + an
   **About page**. 4. **Location-page mechanism**, inventory-gated, **publish nothing** until
   the floor is cleared. 5. **Internal-linking pass** across static/informational pages.

### Priority 3 — AEO & GEO
6. **AI-crawler policy** in robots.txt (I bring the exact block + the allow/deny decision for
   training crawlers to you first). 7. **A small FAQ/guide set** (2–4 pages) the platform can
   author truthfully, with `FAQPage` schema only where genuine, and author/date/trust metadata.
   8. **Bing Webmaster** registration (manual).

### Priority 4 — authority & growth
9. **One original, first-hand resource** worth citing (tenant checklist or lease-template
   explainer hub). 10. **Legitimate directory citations**; `sameAs` once socials exist. 11.
   **Content cluster** build-out at a maintainable cadence.

**Quick wins** (small, safe, high-value): BreadcrumbList (#2), AI-crawler policy (#6), Bing
Webmaster (#8), About page (#3). **Larger initiatives:** board CWV (#1), location mechanism
(#4), content ecosystem (#7, #9, #11).

No rankings, traffic numbers, AI citations or timeframes are promised — none can be, and the
brief forbids it.

---

## 11. What I need from you (Phase 12, Step 4 — approval checkpoint)

Nothing has been changed. To proceed I need decisions on:

1. **Priority 1 only, or a broader slice?** My recommendation: start with the **board CWV fix
   (#1)** and the **quick wins (#2 BreadcrumbList, #6 AI-crawler policy, #3 About page)** — all
   TDD, all verifiable, none speculative.
2. **AI training-crawler policy (#6):** allow or disallow GPTBot/CCBot/Google-Extended/ClaudeBot?
   (AI *search* crawlers I'd allow regardless.) I'll bring the exact robots.txt block for your
   sign-off before it ships.
3. **Analytics direction (#8/#9):** privacy-first (Bing + cookieless/in-house) — my
   recommendation — or GA4 (which pulls in the consent-flow work)?
4. **Location pages (#4):** confirm you want the *mechanism* built now (publishing still gated
   on inventory), or deferred entirely until supply grows.

I will implement only what you approve, in manageable phases, TDD where applicable, preserving
the existing architecture and the strong work already in place.
