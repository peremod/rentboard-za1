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
const API = process.env.API_BASE ?? 'http://localhost:3000';

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
  const list = await fetch(`${API}/api/rooms?limit=1`).then((r) => r.json());
  const room = list.data?.[0];
  if (!room) {
    console.log('  ⏭  no active rooms on this board — room checks skipped');
  } else {
    const { html } = await get(`/rooms/${room.id}`);
    const blocks = jsonLd(html);
    const t = typesOf(blocks);

    check(t.includes('RealEstateListing'), 'the room is a RealEstateListing', t.join(','));
    check(!t.includes('Product'), 'and NOT a Product — a room let monthly is not retail stock');
    check(t.filter((x) => x === 'Organization').length === 1, 'the site identity is not duplicated here');

    const listing = nodes(blocks).find((n) => n['@type'] === 'RealEstateListing') ?? {};
    const blob = JSON.stringify(listing);

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
  const { html } = await get('/');
  const org = nodes(jsonLd(html)).find((n) => n['@type'] === 'Organization');
  const logo = org?.logo?.url?.replace(BASE, '') ?? '';
  const res = await fetch(`${BASE}${logo}`);
  check(res.status === 200, 'the Organization logo URL resolves', `${logo} -> ${res.status}`);
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

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
