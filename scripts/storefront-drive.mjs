/**
 * The public landlord storefront — Phase 5b, with 5h's badges.
 *
 * ── What actually matters about a public page
 *
 * Three things, none of them "does it render":
 *
 *   1. It must not exist until somebody publishes it, and a page that is off
 *      must 404 rather than 403 — a distinguishable refusal lets anyone
 *      enumerate which landlords exist and which have hidden themselves, and
 *      that is information about a person.
 *   2. Slugs must survive real names and collisions. Two landlords with the same
 *      name is not an edge case in a market this size.
 *   3. Every figure on it must be FROM something, and absent rather than
 *      flattering when there is too little behind it. This is a trust page: one
 *      fast reply must not become "usually replies within a day".
 *
 * And it must be in the sitemap, which is checked here rather than assumed —
 * a public page missing from the sitemap is a retention feature in an SEO
 * costume.
 *
 * Needs the API on :3000.
 */
import { registerUser, apiCall } from './lib/drive-session.mjs';

const API = 'http://localhost:3000';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const iso = (d) => d.toISOString().slice(0, 10);
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ll = await registerUser(API, 'LANDLORD');
const T = ll.token;

// ── A slug is minted on first read, not at registration ───────────────────
const s0 = await apiCall(API, 'GET', '/api/landlord/storefront', undefined, T);
s0.status === 200 ? ok('a landlord can open their storefront settings') : bad(`settings: ${s0.status} ${JSON.stringify(s0.body).slice(0, 200)}`);
const slug = s0.body?.slug;
/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug ?? '')
  ? ok(`a readable slug is minted: ${slug}`)
  : bad(`slug is not readable: ${JSON.stringify(slug)}`);
!/[0-9a-f]{8}-[0-9a-f]{4}/.test(slug ?? '')
  ? ok('and it is a name, not a uuid')
  : bad(`slug contains a uuid: ${slug}`);
s0.body?.storefrontLive === false
  ? ok('the page is OFF by default — nothing is published on anyone’s behalf')
  : bad(`storefrontLive is ${s0.body?.storefrontLive} before anyone published it`);

// Reading again must not mint a second one.
const s0b = await apiCall(API, 'GET', '/api/landlord/storefront', undefined, T);
s0b.body?.slug === slug
  ? ok('reading again keeps the same slug — it is a stable public URL')
  : bad(`slug changed from ${slug} to ${s0b.body?.slug}`);

// ── Unpublished must 404, not 403 ─────────────────────────────────────────
const hidden = await apiCall(API, 'GET', `/api/storefronts/${slug}`);
hidden.status === 404
  ? ok('an unpublished storefront answers 404 to the public')
  : bad(`unpublished answered ${hidden.status} — a 403 would confirm the landlord exists`);
const nonsense = await apiCall(API, 'GET', '/api/storefronts/definitely-not-a-real-landlord');
nonsense.status === 404 ? ok('and so does a slug that never existed') : bad(`nonexistent: ${nonsense.status}`);
// Identical bodies, so the two cases cannot be told apart.
JSON.stringify(hidden.body?.message) === JSON.stringify(nonsense.body?.message)
  ? ok('with the same message, so the two cannot be told apart')
  : bad(`distinguishable: "${hidden.body?.message}" vs "${nonsense.body?.message}"`);

// ── Publishing needs the landlord to do it ────────────────────────────────
const pub = await apiCall(API, 'PATCH', '/api/landlord/storefront',
  { bio: 'I have rented rooms in Soweto for eleven years. The gate is locked at nine.', storefrontLive: true }, T);
pub.status === 200 ? ok('the landlord publishes it themselves') : bad(`publish: ${pub.status} ${JSON.stringify(pub.body).slice(0, 200)}`);

const live = await apiCall(API, 'GET', `/api/storefronts/${slug}`);
live.status === 200 ? ok('and now the public page answers') : bad(`published page: ${live.status}`);
live.body?.bio?.includes('eleven years')
  ? ok('carrying their own words')
  : bad(`bio missing: ${JSON.stringify(live.body?.bio)}`);
live.body?.displayName === 'Drive Landlord'
  ? ok('and their name')
  : bad(`displayName: ${JSON.stringify(live.body?.displayName)}`);

// No email, no phone, no id on a public page.
const publicJson = JSON.stringify(live.body);
!publicJson.includes(ll.email) && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(publicJson.replace(/"rooms":\[.*?\]/, ''))
  ? ok('with no email address on it')
  : bad('the public page leaks contact details or ids');

// ── Slug collisions ──────────────────────────────────────────────────────
//
// registerUser always creates "Drive Landlord", so a second one collides by
// construction — which is the case a market full of common names actually hits.
const ll2 = await registerUser(API, 'LANDLORD');
const s2 = await apiCall(API, 'GET', '/api/landlord/storefront', undefined, ll2.token);
s2.body?.slug && s2.body.slug !== slug
  ? ok(`a second landlord with the same name gets a different slug: ${s2.body.slug}`)
  : bad(`collision not handled: both are ${slug}`);
/-\d+$/.test(s2.body?.slug ?? '')
  ? ok('resolved by counting, so it is still a URL a person can read out')
  : bad(`collision suffix is not readable: ${s2.body?.slug}`);

const ll3 = await registerUser(API, 'LANDLORD');
const s3 = await apiCall(API, 'GET', '/api/landlord/storefront', undefined, ll3.token);
new Set([slug, s2.body?.slug, s3.body?.slug]).size === 3
  ? ok('and a third is distinct again')
  : bad(`three landlords, ${new Set([slug, s2.body?.slug, s3.body?.slug]).size} distinct slugs`);

// ── Figures are absent rather than flattering ────────────────────────────
live.body?.typicalResponseHours === null
  ? ok('no response time is quoted with nothing behind it')
  : bad(`quoted ${live.body?.typicalResponseHours}h from ${live.body?.responseFrom} application(s)`);
live.body?.tenantsPlaced === 0
  ? ok('and no tenancies claimed')
  : bad(`tenantsPlaced ${live.body?.tenantsPlaced} for a new landlord`);
!(live.body?.badges ?? []).some((b) => b.id === 'verified')
  ? ok('and no verified badge, because nobody verified them')
  : bad('an unverified landlord shows a verified badge');
(live.body?.badges ?? []).some((b) => b.id === 'since')
  ? ok('the one badge they have earned is the joining year')
  : bad(`badges: ${JSON.stringify((live.body?.badges ?? []).map((b) => b.id))}`);
(live.body?.badges ?? []).every((b) => b.basis && b.basis.length > 10)
  ? ok('and every badge says what it is FROM')
  : bad(`a badge with no basis: ${JSON.stringify(live.body?.badges)}`);

// ── Live rooms appear; drafts and let rooms do not ───────────────────────
async function room(title, publish = true) {
  const r = await apiCall(API, 'POST', '/api/rooms', {
    roomType: 'shared_house', title, rentCents: 250000, province: 'Gauteng',
    city: 'Johannesburg', locationDisplay: 'Soweto', availableFrom: iso(inDays(1)),
    housematesCount: 2, billsIncluded: true,
    description: 'A clean single room in a quiet Soweto yard with a shared kitchen, an outside tap and a gate locked at night.',
  }, T);
  if (r.status >= 300) { bad(`room: ${JSON.stringify(r.body).slice(0, 160)}`); return null; }
  if (publish) {
    await apiCall(API, 'PATCH', `/api/rooms/${r.body.id}/photos`, { paths: ['rooms/demo/cover.jpg'] }, T);
    await apiCall(API, 'POST', `/api/rooms/${r.body.id}/publish`, {}, T);
  }
  return r.body.id;
}
const liveRoom = await room('Storefront live room one');
const draftRoom = await room('Storefront draft room two', false);

const live2 = await apiCall(API, 'GET', `/api/storefronts/${slug}`);
const titles = (live2.body?.rooms ?? []).map((r) => r.title);
titles.includes('Storefront live room one')
  ? ok('a published room shows on the storefront')
  : bad(`rooms: ${JSON.stringify(titles)}`);
!titles.includes('Storefront draft room two')
  ? ok('and a draft does not — the page never advertises what is not on the board')
  : bad('a draft room is on the public page');
live2.body?.roomsAvailable === titles.length
  ? ok('the count matches the list it describes')
  : bad(`roomsAvailable ${live2.body?.roomsAvailable} vs ${titles.length} rooms`);

// ── Unpublishing takes it down again ────────────────────────────────────
await apiCall(API, 'PATCH', '/api/landlord/storefront', { storefrontLive: false }, T);
const down = await apiCall(API, 'GET', `/api/storefronts/${slug}`);
down.status === 404
  ? ok('switching it off takes the page down')
  : bad(`unpublished page still answers ${down.status}`);
await apiCall(API, 'PATCH', '/api/landlord/storefront', { storefrontLive: true }, T);

// ── Nobody else can edit it ─────────────────────────────────────────────
const asOther = await apiCall(API, 'PATCH', '/api/landlord/storefront', { bio: 'hijacked' }, ll2.token);
const stillMine = await apiCall(API, 'GET', `/api/storefronts/${slug}`);
!stillMine.body?.bio?.includes('hijacked')
  ? ok('another landlord editing their own does not touch this one')
  : bad('a landlord edited someone else’s storefront');
const tn = await registerUser(API, 'TENANT');
const asTenant = await apiCall(API, 'GET', '/api/landlord/storefront', undefined, tn.token);
asTenant.status === 403 ? ok('a tenant has no storefront settings') : bad(`tenant got ${asTenant.status}`);
const anon = await apiCall(API, 'PATCH', '/api/landlord/storefront', { bio: 'x' });
anon.status === 401 ? ok('and a stranger cannot edit one') : bad(`anonymous edit got ${anon.status}`);

// ── In the sitemap, which is the point of 5b ────────────────────────────
const sm = await fetch(`${API}/sitemap.xml`);
const xml = await sm.text();
xml.includes(`/landlords/${slug}`)
  ? ok('the published storefront is in the sitemap')
  : bad('the storefront is NOT in the sitemap — an SEO page nobody told Google about');
!xml.includes(`/landlords/${s2.body?.slug}`)
  ? ok('and an unpublished one is not')
  : bad('an unpublished storefront is advertised to crawlers');
/<priority>0\.6<\/priority>/.test(xml)
  ? ok('at a priority below a room page and above the marketing pages')
  : bad('no 0.6 priority entry found');

console.log(fail ? `\n❌ ${fail} failure(s)` : '\n✅ the storefront publishes only when asked, survives name collisions, quotes nothing it has not earned, and is in the sitemap');
process.exit(fail ? 1 : 0);
