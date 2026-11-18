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

console.log(`\n── About entity page ──────────────────────────`);
{
  // /about is prerendered static HTML, so this is build-agnostic — there is no
  // production-API skip to make here, unlike the board and room sections.
  const { status, html } = await get('/about');
  check(status === 200, '/about answers 200', `status ${status}`);

  const blocks = jsonLd(html);
  const all = nodes(blocks);
  const about = all.find((n) => n['@type'] === 'AboutPage');
  check(!!about, '/about server-renders an AboutPage', typesOf(blocks).join(',') || '(no json-ld)');

  if (about) {
    check(/\/about\/#webpage$/.test(about['@id'] ?? ''), 'the AboutPage has its own stable @id', about['@id'] ?? '(none)');
    check(/\/about$/.test(about.url ?? ''), 'its url is /about', about.url ?? '(none)');

    // 🔴 The whole point of the block: its references must resolve to the SAME
    // entities the site graph mints ON THIS PAGE. If the Organization/WebSite
    // nodes are not here, or the ids do not match, the AboutPage is describing a
    // second, unrelated company and the entity signal splits instead of joining
    // — which is worse than no block at all. This also proves the site identity
    // graph reaches a prerendered page, not only the server-rendered board.
    const org = all.find((n) => n['@type'] === 'Organization') ?? {};
    const web = all.find((n) => n['@type'] === 'WebSite') ?? {};
    check(!!org['@id'] && about.about?.['@id'] === org['@id'],
      'its about[@id] is this page\'s own Organization', `${about.about?.['@id']} vs ${org['@id'] ?? '(absent)'}`);
    check(!!web['@id'] && about.isPartOf?.['@id'] === web['@id'],
      'its isPartOf[@id] is this page\'s own WebSite', `${about.isPartOf?.['@id']} vs ${web['@id'] ?? '(absent)'}`);

    // The same line site-identity.ts holds, on the one page whose entire job is
    // to be trusted about the entity: an AboutPage asserting a phone or address
    // the site cannot show is the fabricated-fact failure these audits forbid.
    const invented = ['address', 'telephone', 'email', 'foundingDate', 'aggregateRating', 'review', 'priceRange']
      .filter((k) => k in about);
    check(invented.length === 0, 'the AboutPage invents nothing', invented.join(','));
  }
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

    // A BreadcrumbList that matches the visible path: Home → this room. Two
    // items, first the site root, last this room's own URL. A trail that does
    // not end on the page it is on is describing a different page.
    const crumb = nodes(blocks).find((n) => n['@type'] === 'BreadcrumbList');
    check(!!crumb, 'the room page carries a BreadcrumbList');
    const items = crumb?.itemListElement ?? [];
    check(items.length === 2, 'the trail is two levels, Home → this room', `${items.length} item(s)`);
    check(items[0]?.position === 1 && /\/$/.test(items[0]?.item ?? ''), 'position 1 is the site root');
    check(
      items[1]?.position === 2 && new RegExp(`/rooms/${roomId}$`).test(items[1]?.item ?? ''),
      'position 2 is this room, and its URL is this room',
    );

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

console.log(`\n── Province landing pages, and the inventory gate ────`);
{
  /**
   * The gate (backend rooms/locations.ts): a province gets a landing page only
   * at/above the inventory threshold. The sitemap is the published set — so the
   * drive takes the pages it checks from the sitemap, the same way the room
   * block takes its id from the board. That makes "nothing is published yet" a
   * stated skip, not a silent green, and keeps the drive honest on any build.
   *
   * ⚠️ The negative half is the one that matters, and it is checked two ways:
   * a province the sitemap does NOT list must refuse to be a page — it carries
   * the 404 status marker AND a noindex meta. A gate that publishes an empty
   * "no rooms here yet" 200 is exactly the soft-404 this whole mechanism exists
   * to prevent, so the drive asserts the gated-out province is never that.
   */
  const ALL_SLUGS = [
    'eastern-cape', 'free-state', 'gauteng', 'kwazulu-natal', 'limpopo',
    'mpumalanga', 'northern-cape', 'north-west', 'western-cape',
  ];

  const sitemap = await get('/sitemap.xml');
  const published = [...new Set(
    [...sitemap.html.matchAll(/\/rooms\/in\/([a-z-]+)/g)].map((m) => m[1]),
  )];

  // Every slug the sitemap advertises must be a real province slug — a sitemap
  // that lists a page the site cannot serve is the defect this guards. Safe on
  // ANY build: it reads only the sitemap's own text.
  for (const slug of published) {
    check(ALL_SLUGS.includes(slug), `sitemap's /rooms/in/${slug} is a known province slug`);
  }

  // ⚠️ Same rule as the room block above: the deep assertions below RENDER a
  // page, and a production bundle renders it from api.umastande.co.za — a
  // remote, free-tier API that sleeps (OUTSTANDING §102) and whose live
  // inventory is not this run's to predict. So they run only against a build
  // that serves location data LOCALLY, detected the same way the room block
  // detects it: a board that server-renders room links is the development
  // build on the seeded database. On the production build the board renders no
  // local rooms, and these checks state a skip rather than asserting against
  // whatever production happens to be serving this minute. The dev-build pass
  // (step 17 in CI) is where they really run; this keeps the prod-build pass
  // (which reads production) from going red on production's data, exactly as
  // the room and sitemap sections already do.
  const boardHtml = (await get('/')).html;
  const servesLocalData = /\/rooms\/[0-9a-f-]{36}/.test(boardHtml);

  if (published.length === 0) {
    console.log(`  ⏭  no province is at/above the inventory gate on this board — landing-page checks skipped`);
    console.log('     (seed ≥ the threshold of active rooms in one province to drive these)');
  } else if (!servesLocalData) {
    console.log(`  ⏭  this board serves no local rooms (production bundle → api.umastande.co.za) — landing-page RENDER checks skipped`);
    console.log('     (the sitemap slug check above still ran; the render checks run on the development build)');
  } else {
    const slug = published[0];
    const { status, html } = await get(`/rooms/in/${slug}`);
    check(status === 200, `/rooms/in/${slug} is served (200)`, `status ${status}`);

    const blocks = jsonLd(html);
    const t = typesOf(blocks);
    const page = nodes(blocks).find((n) => n['@type'] === 'CollectionPage');
    check(!!page, 'the landing page is a CollectionPage', t.join(','));
    // Without this, "numberOfItems" etc. below pass on an empty object.
    const list = page?.mainEntity;
    check(list?.['@type'] === 'ItemList', 'its main entity is an ItemList of the rooms on show');
    check(Array.isArray(list?.itemListElement) && list.itemListElement.length > 0,
      'the ItemList is not empty', `${list?.itemListElement?.length ?? 0} item(s)`);
    check(list?.itemListElement?.[0]?.position === 1, 'the ItemList is positioned from 1');

    const crumb = nodes(blocks).find((n) => n['@type'] === 'BreadcrumbList');
    check(!!crumb, 'the landing page carries a BreadcrumbList');
    const items = crumb?.itemListElement ?? [];
    check(items.length === 2, 'the trail is two levels, Home → this province', `${items.length} item(s)`);
    check(items[0]?.position === 1 && /\/$/.test(items[0]?.item ?? ''), 'position 1 is the site root');
    check(
      items[1]?.position === 2 && new RegExp(`/rooms/in/${slug}$`).test(items[1]?.item ?? ''),
      'position 2 is this province, and its URL is this province',
    );

    // The board links to the page — the crawlable internal path, not only the
    // sitemap. One link per published province at the foot of the board.
    check(
      boardHtml.includes(`/rooms/in/${slug}`),
      'the board internal-links to this province landing page',
    );

    // The gate's negative. A province the sitemap does not list must not be a
    // page: 404 marker + noindex, never a 200 "nothing here yet". Checked on
    // the marker and meta (always present) rather than the HTTP status, which
    // only server.ts applies — a dev `ng serve` serves the marker under 200.
    const gatedOut = ALL_SLUGS.find((s) => !published.includes(s));
    if (gatedOut) {
      const out = await get(`/rooms/in/${gatedOut}`);
      check(
        /mastande-status["'][^>]*content=["']404["']/.test(out.html),
        `the gated-out province ${gatedOut} asks for a 404, not a soft-404 200`,
      );
      check(
        /<meta name="robots"[^>]*noindex/.test(out.html),
        `the gated-out province ${gatedOut} is noindex`,
      );
      check(
        !jsonLd(out.html).some((b) => JSON.stringify(b).includes('CollectionPage')),
        `the gated-out province ${gatedOut} emits no CollectionPage markup`,
      );
    } else {
      console.log('  ⏭  every province is published on this board — gated-out negative not exercised here');
    }
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
 *
 * ⚠️ One probe per entry in server.ts PRIVATE_PREFIXES — auth, welcome, tenant,
 * landlord, account, admin, reference — so dropping ANY prefix from that list
 * fails a check here. `welcome` and `reference` had no probe before, which left
 * two prefixes a refactor could have quietly deleted with every test still
 * green. The header is set by prefix whether or not the route exists, so a
 * synthetic sub-path is a valid probe of the rule.
 */
for (const path of [
  '/auth/login', '/welcome', '/tenant/dashboard', '/landlord/dashboard',
  '/account/settings', '/admin/users', '/reference/sample',
  '/zu/tenant/dashboard',
]) {
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
for (const path of ['/', '/pricing', '/how-it-works', '/about']) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
  check(!(res.headers.get('x-robots-tag') ?? '').includes('noindex'), `${path} is NOT noindexed`);
}

console.log(`\n── About: the entity page a crawler and an AI can read ────`);
{
  // SEO/AEO/GEO: the page that states plainly what Mastande is and who runs
  // it, in the SERVED HTML — not painted in after hydration, which is why this
  // reads the bytes. Every assertion is a fact the page must carry server-side;
  // a client-rendered shell (the §87f failure one layer out) would fail them.
  const { status, html } = await get('/about');
  check(status === 200, '/about is served (200)', `status ${status}`);
  check(/<title>[^<]*About[^<]*<\/title>/i.test(html), '/about has a title naming itself');
  check(/<meta name="description" content="[^"]+"/i.test(html), '/about has a meta description');
  // Canonical presence is environment-dependent — a non-indexable (development
  // or preview) deployment deliberately emits none, which the dedicated
  // crawl-direction section below asserts. So the canonical is NOT checked here,
  // where it would fail on exactly the dev build this drive also runs against.
  check(/<h1[^>]*>\s*About Mastande\s*<\/h1>/i.test(html), '/about server-renders its H1, not a shell');
  // The entity claim a GEO reader extracts — the operating company — has to be
  // in the body, not only in the Organization JSON-LD on the homepage.
  check(/Umastande \(Pty\) Ltd/.test(html), '/about names the operating company in its prose');
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

    // AI-crawler policy = allow SEARCH via "*", block TRAINING by name. The
    // trap this guards: a bot obeys the most specific group that names it and
    // ignores "*", so a "User-agent: GPTBot / Allow: /" would hand that crawler
    // the private areas the "*" Disallows protect. The invariant that makes the
    // trap unshippable is therefore NOT "only one group exists" (there are now
    // named training blocks) but "every named group is a full Disallow: / and
    // carries no Allow" — a named group can only ever subtract, never add.
    //
    // Parse robots.txt into groups. Consecutive User-agent lines share the
    // directives that follow them (standard grouping). Sitemap is a non-group
    // directive and is ignored here.
    const groups = [];
    let cur = null;
    for (const raw of body.split('\n')) {
      const line = raw.replace(/#.*$/, '').trim();
      if (!line) continue;
      const ua = line.match(/^User-agent:\s*(.+)$/i);
      if (ua) {
        if (cur && cur.rules.length === 0) cur.agents.push(ua[1].trim());
        else { cur = { agents: [ua[1].trim()], rules: [] }; groups.push(cur); }
      } else if (cur && /^(Allow|Disallow):/i.test(line)) {
        cur.rules.push(line);
      }
    }
    const star = groups.find((g) => g.agents.includes('*'));
    check(!!star, 'robots.txt has a "*" group', `groups: ${groups.map((g) => g.agents.join('+')).join(' / ') || '(none)'}`);

    const named = groups.filter((g) => !g.agents.includes('*'));
    // Every named group must be a FULL block and nothing else: at least one
    // "Disallow: /" and zero "Allow:" lines. This is what keeps a named crawler
    // from ever reaching more than "*" grants.
    for (const g of named) {
      const label = g.agents.join('+');
      const hasFullDisallow = g.rules.some((r) => /^Disallow:\s*\/\s*$/i.test(r));
      const hasAllow = g.rules.some((r) => /^Allow:/i.test(r));
      check(
        hasFullDisallow && !hasAllow,
        `robots.txt group "${label}" is a full block, so it cannot bypass the private Disallows`,
        `rules: ${g.rules.join(' | ') || '(none)'}`,
      );
    }

    // ⚠️ Whether the TRAINING blocks are PRESENT is NOT asserted here, and the
    // reason is load-bearing: on the production build this drive runs against,
    // robots.txt is proxied from the live production origin — the DEPLOYED
    // code's policy, not this branch's. Requiring this branch's training groups
    // here can never pass until after deploy, a chicken-and-egg. That presence
    // is verified against this build's own code in
    // backend/src/modules/seo/robots.spec.ts instead. What IS safe to assert on
    // any deployment is the one-directional half below: whatever crawlers are
    // named, a search crawler must never be among them (a search crawler in a
    // named group is in a full block — refused — which breaks "citable, not
    // trainable" on production too, not just here).
    const namedAgents = named.flatMap((g) => g.agents);
    for (const searcher of ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot', 'Googlebot', 'Bingbot', 'ChatGPT-User']) {
      check(!namedAgents.includes(searcher), `robots.txt never blocks the search crawler ${searcher}`, `named: ${namedAgents.join(', ') || '(none)'}`);
    }
  } else {
    // A copy must not advertise the real site's URLs as its own.
    check(!/^Sitemap:/m.test(body), 'a non-indexable copy advertises no sitemap');
  }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
