#!/usr/bin/env node
/**
 * Reads the SERVED HTML and checks what a crawler would actually get.
 *
 * ⚠️ curl, not a browser, and that is the whole point. Metadata painted in
 * after hydration is metadata Google may never see on a page it renders
 * cheaply, and a check that reads the hydrated DOM cannot tell the two
 * apart. Everything below is asserted against the bytes the server sends.
 *
 *   BASE=http://localhost:4200 node scripts/seo-drive.mjs
 */
const BASE = process.env.BASE ?? process.env.E2E_BASE_URL ?? 'http://localhost:4200';

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
};

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
  return { status: res.status, html: await res.text(), headers: res.headers };
};

const jsonLd = (html) =>
  [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)]
    .map((m) => JSON.parse(m[1].replace(/\\u003c/g, '<')));

const nodes = (blocks) => blocks.flatMap((b) => (b['@graph'] ? b['@graph'] : [b]));
const typesOf = (blocks) => nodes(blocks).map((n) => n['@type']);

console.log(`\n── Site identity ──────────────────────────────`);
{
  const { html } = await get('/');
  const blocks = jsonLd(html);
  const t = typesOf(blocks);

  check(t.includes('Organization'), 'the homepage server-renders an Organization', t.join(','));
  check(t.includes('WebSite'), 'the homepage server-renders a WebSite', t.join(','));

  // ⚠️ Exactly once. Two Organizations on one page is not twice as clear, it
  // is ambiguous — and duplication is what happens when a block is emitted
  // per route instead of per app.
  check(t.filter((x) => x === 'Organization').length === 1, 'exactly one Organization');
  check(t.filter((x) => x === 'WebSite').length === 1, 'exactly one WebSite');

  const org = nodes(blocks).find((n) => n['@type'] === 'Organization') ?? {};
  const invented = ['address', 'telephone', 'foundingDate', 'sameAs', 'aggregateRating', 'review']
    .filter((k) => k in org);
  check(invented.length === 0, 'the Organization invents nothing', invented.join(','));
  check(org.legalName === 'Umastande (Pty) Ltd', 'it names the real registered company');

  const site = nodes(blocks).find((n) => n['@type'] === 'WebSite') ?? {};
  const target = site.potentialAction?.target?.urlTemplate ?? '';
  check(/\?q=\{search_term_string\}$/.test(target), 'the SearchAction points at the real ?q= search', target);

  // The template has to be a URL the site honours, not a plausible-looking
  // one: a SearchAction describing a search that does not exist is a lie that
  // validates.
  const probe = await get('/?q=room');
  check(probe.status === 200, 'and that search URL actually answers 200', String(probe.status));
}

console.log(`\n── Room listing markup ────────────────────────`);
{
  /**
   * ⚠️ The room comes from the BOARD THIS SERVER RENDERS, not from an API the
   * drive picks.
   *
   * It used to read `/api/rooms?limit=1` off API_BASE — localhost:3000 by default —
   * and then ask the server under test for that id. On a development build
   * those are the same API and it works. On a production build the bundle
   * talks to api.umastande.co.za, so the id came from one database and the
   * page was rendered against another: no room, no listing markup, and then
   * five field-level failures ("no rating is attached", "the street address is
   * not published") all passing or failing for a reason that had nothing to do
   * with what they claim to check. Markup absent is the one answer those
   * checks must never read as a pass.
   *
   * Taking the id from the server's own rendered board makes the two halves
   * the same scope on any build, and makes "this board serves no rooms" a
   * stated skip rather than a silent green.
   */
  const board = await get('/');
  const ids = [...board.html.matchAll(/\/rooms\/([0-9a-f-]{36})/g)].map((m) => m[1]);
  const roomId = ids[0];
  if (!roomId) {
    console.log(`  ⏭  the board at ${BASE} server-renders no room links — room checks skipped`);
    console.log('     (a production bundle served locally talks to the production API; use a development build to drive these)');
  } else {
    const { html } = await get(`/rooms/${roomId}`);
    const blocks = jsonLd(html);
    const t = typesOf(blocks);

    check(t.includes('RealEstateListing'), 'the room is a RealEstateListing', t.join(','));
    check(!t.includes('Product'), 'and NOT a Product — a room let monthly is not retail stock');
    check(t.filter((x) => x === 'Organization').length === 1, 'the site identity is not duplicated here');

    const listing = nodes(blocks).find((n) => n['@type'] === 'RealEstateListing');
    // Without this, every negative below ("no rating", "no street address")
    // passes on an EMPTY object — a page with no markup at all scoring full
    // marks for not publishing the wrong markup.
    check(!!listing, 'the room page carries listing markup at all');
    const blob = JSON.stringify(listing ?? {});

    /**
     * 🔴 The rating is the one that matters. It used to be the LANDLORD's
     * rating attached to the ROOM — a room with no reviews of its own
     * inheriting somebody's 4.8. Mismatched rating markup is a documented
     * manual-action risk, not a cosmetic error.
     */
    check(!blob.includes('aggregateRating'), 'no rating is attached to the room');
    check(!blob.includes('priceValidUntil'), 'no priceValidUntil — availability is not a price expiry');
    check(/LeaseOut/.test(listing.offers?.businessFunction ?? ''), 'the offer is a lease, stated explicitly');
    check(listing.offers?.priceCurrency === 'ZAR', 'priced in Rand');

    // A room's street address is private until a landlord shares it with an
    // applicant. Markup must not publish what the page does not show.
    check(!blob.includes('streetAddress'), 'the street address is not published in markup');
    check(
      listing.mainEntity?.address?.addressCountry === 'ZA',
      'the place carries suburb, region and country only',
    );
  }
}

console.log(`\n── Icons a result can display ─────────────────`);
for (const [path, kind] of [['/favicon.svg', 'image/svg'], ['/icon-48.png', 'image/png'], ['/icon-192.png', 'image/png'], ['/icon-512.png', 'image/png'], ['/apple-touch-icon.png', 'image/png']]) {
  const res = await fetch(`${BASE}${path}`);
  const ct = res.headers.get('content-type') ?? '';
  check(res.status === 200 && ct.includes(kind), `${path} is served as ${kind}`, `${res.status} ${ct}`);
}
{
  // The Organization's logo must be a URL that resolves. A logo pointing at a
  // 404 is worse than no logo: it says the mark exists and then fails to
  // produce it.
  //
  // ⚠️ It is fetched by PATH against the server under test, not at the URL in
  // the markup. The markup names the production origin on a production bundle,
  // and `.replace(BASE, '')` — what this did — left it untouched, so the fetch
  // was `http://localhost:4000https://www.umastande.co.za/icon-512.png` and
  // the drive crashed on an invalid URL. It never showed because this drive had
  // only ever been run against a DEVELOPMENT build, whose siteUrl IS localhost:
  // 38/38 green, on the one build where the bug is invisible, while the build
  // Lighthouse and production serve could not get past it.
  const { html } = await get('/');
  const org = nodes(jsonLd(html)).find((n) => n['@type'] === 'Organization');
  const declared = org?.logo?.url ?? '';
  let logo = declared;
  try { logo = new URL(declared).pathname; } catch { /* already a path */ }
  const res = await fetch(`${BASE}${logo}`);
  check(res.status === 200, 'the Organization logo URL resolves', `${declared} -> ${res.status}`);
}

console.log(`\n── Private areas stay out ─────────────────────`);
/**
 * ⚠️ The HEADER, not the HTML, and the first run of this drive is why.
 *
 * These routes render client-side, so the server hands a crawler the CSR
 * shell — 200 OK, ~6KB, no `<meta name="robots">` at all. The `noIndex` in
 * their route data is applied by SeoService after hydration, which a crawler
 * that does not run JavaScript never sees. Three of these four failed on
 * exactly that.
 *
 * ⚠️ And the fourth PASSED for the wrong reason: `/admin/users` is not a real
 * route, so it fell to the server-rendered 404, which does carry noindex. A
 * check can be right by accident; this one now asserts the mechanism that
 * actually covers every private URL whether the route exists or not.
 */
for (const path of ['/tenant/dashboard', '/landlord/dashboard', '/account/settings', '/admin/users', '/zu/tenant/dashboard', '/auth/login']) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
  const header = res.headers.get('x-robots-tag') ?? '';
  const html = await res.text();
  check(/noindex/i.test(header), `${path} is noindex by header`, `X-Robots-Tag: ${header || '(absent)'}`);
  check(
    jsonLd(html).every((b) => !JSON.stringify(b).includes('RealEstateListing')),
    `${path} publishes no listing markup`,
  );
}

// And the control: a PUBLIC page must NOT pick up that header, or the rule is
// a blanket noindex wearing a prefix list.
for (const path of ['/', '/pricing', '/how-it-works']) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
  check(!(res.headers.get('x-robots-tag') ?? '').includes('noindex'), `${path} is NOT noindexed`);
}

console.log(`\n── robots.txt says what this deployment is ────`);
/**
 * ⚠️ Nothing in this repository could see robots.txt before this section, and
 * the Lighthouse `budgets` job spent every run of its life reporting
 * `is-crawlable` 0 and `categories:seo` 0.66 because of it.
 *
 * The cause was not a bug in the server. A production bundle served on
 * localhost is a COPY of the site, and `isCanonicalHost()` correctly answers a
 * copy with `Disallow: /`. The job simply never said which it was auditing, so
 * Lighthouse read that and — correctly — scored all four URLs blocked. Found
 * by reading a CI log, not by any check here.
 *
 * So this asserts the DIRECTION, derived rather than hardcoded: a deployment
 * that says it is indexable, reached on a hostname it accepts as its own,
 * must invite a crawl; anything else must refuse one. Both branches are
 * reachable from this codebase — the second is what a Vercel preview serves —
 * and `scripts/seo-drive.mjs` is run against a production build on localhost
 * in CI, which is exactly the case that was wrong.
 */
{
  const home = await get('/');
  const indexable = !/noindex/i.test(
    home.html.match(/<meta name="robots" content="([^"]*)"/)?.[1] ?? '',
  );
  const canonicalLink = home.html.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? '';

  const hostname = new URL(BASE).hostname.toLowerCase();
  const declared = (process.env.SITE_CANONICAL_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .includes(hostname);
  let isCanonical = declared;
  try {
    const c = new URL(canonicalLink).hostname.toLowerCase();
    const bare = c.startsWith('www.') ? c.slice(4) : c;
    if (hostname === bare || hostname === `www.${bare}`) isCanonical = true;
  } catch { /* no canonical link on the page is itself asserted elsewhere */ }

  const res = await fetch(`${BASE}/robots.txt`, { redirect: 'manual' });
  const body = await res.text();
  const type = res.headers.get('content-type') ?? '';

  check(res.status === 200, 'robots.txt answers 200', `status ${res.status}`);
  // The original defect: both paths fell to the catch-all and this file WAS
  // the 404 page, 200 OK, which Lighthouse parsed line by line and reported
  // as 58 syntax errors.
  check(type.startsWith('text/plain'), 'robots.txt is text/plain', type || '(absent)');
  check(!body.includes('<'), 'robots.txt is not an HTML page wearing a .txt name');

  const blanket = /^\s*Disallow:\s*\/\s*$/m.test(body);
  const expectCrawl = indexable && isCanonical;
  check(
    expectCrawl ? !blanket : blanket,
    expectCrawl
      ? 'an indexable deployment on its own hostname invites a crawl'
      : 'anything else refuses one',
    `indexable=${indexable} canonicalHost=${isCanonical} blanketDisallow=${blanket}`,
  );

  if (expectCrawl) {
    // The private prefixes are the other half of the POPIA position: the
    // X-Robots-Tag header above stops indexing, and these stop the crawl.
    for (const prefix of ['/auth/', '/tenant/', '/landlord/', '/account/', '/admin/', '/api/']) {
      check(body.includes(`Disallow: ${prefix}`), `robots.txt disallows ${prefix}`);
    }
    check(/^Sitemap:\s*https?:\/\/\S+\/sitemap\.xml$/m.test(body), 'robots.txt names a sitemap');
  } else {
    // A copy must not advertise the real site's URLs as its own.
    check(!/^Sitemap:/m.test(body), 'a non-indexable copy advertises no sitemap');
  }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
