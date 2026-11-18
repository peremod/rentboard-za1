# Search Console + DNS runbook — clearing "No information is available for this page"

**This is the P0 SEO lever, and it is operational, not code.** The code side
shipped (crawlable `robots.txt`, server-rendered board and room pages, the
verification-file route, sitemap, structured data). What remains needs the
Google account for `umastande.co.za` and access to the DNS zone — so it is
yours to run. This file is the exact sequence; nothing here is automated by a
deploy.

See `docs/SEO-COMPETITIVE-AUDIT.md` §4 for *why* this is the priority (the
diagnosis of the snippet) and `docs/SEO.md` "Getting Google to know the site
exists" for the background. This runbook is the checklist that turns that
diagnosis into actions.

---

## Why the snippet appears (one paragraph)

Google shows *"No information is available for this page"* when it **has the URL
indexed but was not able to fetch/render the content** to build a description.
On this site the two historical causes — a `robots.txt` that blocked the crawl,
and a board that rendered as an empty client-side shell — **are both already
fixed in production** (v1.189.0 robots; v1.165.0 SSR board). The snippet will
**not clear until Google re-crawls**, and nothing on the site can force that.
The fastest honest lever is Search Console verification → sitemap submission →
Request Indexing, plus confirming DNS so the canonical host resolves. That is
this runbook.

---

## Step 0 — Capture a baseline first (so progress is measurable)

Before changing anything, record today's state. Without this you cannot tell
later whether a change helped.

- [ ] A Google search for `site:umastande.co.za` — note the approximate result
      count and whether any result shows a real description or the snippet.
- [ ] A Google search for `umastande` and for `umastandi` — note what ranks for
      each, and whether our result (if any) is described correctly. (The
      one-letter brand collision with uMaStandi is why both are worth watching.)
- [ ] PageSpeed Insights (<https://pagespeed.web.dev>) for `https://www.umastande.co.za/`
      and one active room URL — save the field-data (CrUX) panel if present.

Keep these four numbers somewhere dated. They are your before-picture.

---

## Step 1 — Verify the property in Search Console (file method)

The code already serves a verification file; you supply the token.

1. Go to <https://search.google.com/search-console>, **Add property →
   URL prefix**, and enter exactly `https://www.umastande.co.za` (the `www`
   host — that is the canonical one the site 301s to).
2. Choose the **HTML file** verification method. Google gives you a filename of
   the form `google<hash>.html`. **Copy that filename.**
3. Set it as the environment variable on the production deployment:
   - **`GOOGLE_SITE_VERIFICATION = google<hash>.html`** (the filename, not the
     file contents). Set it in Vercel → Project → Settings → Environment
     Variables, for the Production environment. See `docs/DEPLOYMENT.md` and
     `backend/.env.example` for where this variable is documented.
   - No rebuild or code change is needed — `frontend/src/server.ts` serves the
     route on the next request, deriving the body from the filename. It
     validates the shape (`google[a-z0-9]+\.html`) at boot and logs
     `Search Console verification served at /google<hash>.html`.
4. Confirm it is live: open `https://www.umastande.co.za/google<hash>.html` in a
   browser. It must return `google-site-verification: google<hash>.html` as
   `text/plain` (not the app's 404 page).
5. Back in Search Console, click **Verify**.

> **Why the file method and not the DNS TXT method:** the usual route is a DNS
> TXT record, and that is the one method this domain cannot use right now —
> zone edits are not reaching the authoritative nameservers (see Step 4). A
> URL-prefix property verified by file needs nothing from DNS, so it works even
> while the DNS issue is open.

---

## Step 2 — Submit the sitemap

1. In Search Console → **Sitemaps**, submit: `sitemap.xml`
   (full URL `https://www.umastande.co.za/sitemap.xml`).
2. Confirm it is fetched with status **Success** and a non-zero discovered-URL
   count. The sitemap is generated live from published rooms + gated province
   pages, so the count grows with real inventory.
3. Sanity-check the sitemap yourself: open the URL and confirm it is XML (not
   the 404 HTML page) and lists `/`, the static pages, active room URLs and any
   published `/rooms/in/<province>` pages.

---

## Step 3 — Request Indexing on the key URLs, and read the crawled page

This is what actively prompts the re-crawl that clears the snippet.

For each URL below: Search Console → **URL Inspection** → paste the URL →
**Request Indexing**. Then, on the home page at least, open **View crawled page
→ More info** and confirm:
- the crawl was **allowed** (not "blocked by robots.txt"), and
- the fetched HTML contains real content (the hero, room links, the meta
  description) — i.e. Google received the server-rendered page, not an empty
  shell.

Priority URLs (do these first, in this order):
- [ ] `https://www.umastande.co.za/`  ← the one most likely showing the snippet
- [ ] `https://www.umastande.co.za/how-it-works`
- [ ] `https://www.umastande.co.za/pricing`
- [ ] `https://www.umastande.co.za/about`
- [ ] 2–3 active room URLs (`/rooms/<id>`) and any live `/rooms/in/<province>` page

> Request Indexing is a queue, not a switch. Indexing then takes days; the
> snippet changes from "No information…" to a real description within
> days-to-weeks of a successful re-crawl. Ranking for competitive terms takes
> months and no deploy can hurry it.

---

## Step 4 — Confirm (and fix) DNS

The known open issue: **zone edits are not reaching the authoritative
nameservers** (`docs/SEO.md`, and the reason Step 1 uses the file method). Until
that is resolved, any DNS-dependent step — a TXT verification, an MX change, a
record correction — may silently not take effect.

Check, from a machine with open network access (not this sandbox — its egress is
locked down):

```sh
# Apex and www must resolve, and the authoritative nameservers must be the ones
# you actually edit in your DNS panel.
dig umastande.co.za        +noall +answer
dig www.umastande.co.za    +noall +answer
dig umastande.co.za NS     +noall +answer

# The canonical behaviour the site assumes: apex 301s to www, www answers 200.
curl -sSI https://umastande.co.za/      | grep -iE 'HTTP/|location'
curl -sSI https://www.umastande.co.za/  | grep -iE 'HTTP/'
```

Expected:
- [ ] `umastande.co.za` and `www.umastande.co.za` both resolve.
- [ ] `NS` records are the nameservers you edit in your host's panel. If they
      are **not**, that is the propagation problem — the domain is delegated to
      nameservers other than the ones your edits land on. Fix the delegation at
      the registrar, or make edits at the authoritative set `dig NS` reports.
- [ ] `https://umastande.co.za/` returns **301** with `Location:
      https://www.umastande.co.za/…`.
- [ ] `https://www.umastande.co.za/` returns **200**.

If the apex does not 301 to www, Google can discover and index the apex as a
separate host whose `robots.txt` (per `server.ts isCanonicalHost`) is
`Disallow: /` — which is exactly a way to manufacture the "No information" state
on the wrong host. Getting apex → www right is part of clearing the snippet, not
a separate nicety.

---

## Step 5 — Confirm it worked

Re-run Step 0's four checks on a dated cadence (weekly is plenty):
- [ ] Search Console → **Pages**: the priority URLs move to **Indexed**; read
      the **Excluded** reasons for anything that does not (watch especially for
      *"Indexed, though blocked by robots.txt"* on a `/tenant|/landlord|/account|/admin`
      URL — that would mean the `X-Robots-Tag` is not reaching it; it is covered
      in code and drive-tested, but Search Console is the live proof).
- [ ] Search Console → **Performance**: impressions/clicks/position begin to
      appear for brand and long-tail queries.
- [ ] `site:umastande.co.za` shows results **with real descriptions**, not the
      snippet.
- [ ] A search for `umastande` returns **us**, described correctly, above
      uMaStandi.

When all four hold, the P0 item is closed. The next levers (brand-entity polish,
content, authority) are in `docs/SEO-COMPETITIVE-AUDIT.md` §16 and
`docs/SEO-AEO-GEO-STRATEGY.md`.

---

## What the code already does for you (so you don't re-check it)

- **`robots.txt`** is crawlable in production (search crawlers allowed; only
  private areas and AI-*training* crawlers disallowed). Asserted by
  `backend/src/modules/seo/robots.spec.ts` and the `Verify deployment` gate.
- **Board and room pages** are server-rendered (`RenderMode.Server`), so a
  crawler that runs no JavaScript still receives real content. Asserted by
  `scripts/seo-drive.mjs` against served bytes.
- **The verification-file route** exists the moment you set
  `GOOGLE_SITE_VERIFICATION` (Step 1) — no deploy of code required.
- **Private areas** carry `X-Robots-Tag: noindex` by server header on every
  one of the seven private prefixes, drive-tested per prefix.
- **Structured data** (`Organization`, `WebSite` + `SearchAction`,
  `AboutPage`, `RealEstateListing`, `BreadcrumbList`, `CollectionPage`) is
  server-rendered and carries only verifiable facts — no invented address,
  phone, rating or review.
