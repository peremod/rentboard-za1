/**
 * Nav-link integrity: every nav surface against the routes — Phase 7a.
 *
 * ── Why this is a new script and not a line in route-audit.mjs
 *
 * Because route-audit.mjs already claimed to do it, and did not. Its check
 * compared only the FIRST SEGMENT of each link against a set of known areas:
 *
 *     for (const m of src.matchAll(/routerLink="\/([a-z0-9-]+)/g))
 *       if (!known.has(m[1])) …
 *
 * So `/landlord/billing` and `/landlord/my-rooms` — the two dead links the
 * Phase 7a brief names by name — both "resolved", because `landlord` is a real
 * area. The audit printed "every internal routerLink resolves to a declared
 * route" while pointing at two routes that have never existed. A green line
 * that cannot see the thing it is named after.
 *
 * ── What this checks instead
 *
 *   1. Full-path resolution. Every internal link in the whole app, matched
 *      against the real route tree with its parameters, not its first word.
 *   2. The nav surfaces, enumerated. Desktop navbar, mobile drawer, the portal
 *      nav strip for each role, and the footer — printed as a record, because
 *      the brief asks for the list and not just the verdict.
 *   3. Reachability. A guarded screen that no nav surface links to is a screen
 *      only somebody holding the URL can open. `verification` and `passport`
 *      were exactly that once.
 *   4. One name per thing. A nav item labelled "Billing" pointing at a route
 *      called `upgrade` whose page says "Choose a plan" is three names for one
 *      destination, and the person who clicks it has to work out that they are
 *      the same.
 *
 * Exit code is non-zero on a dead link or an unreachable screen. Label
 * mismatches are reported but do not fail the build: some are deliberate
 * (an icon-only logo link; "Browse rooms" pointing at a board whose h1 is the
 * site's tagline) and a check nobody can satisfy gets switched off.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const FE = join(ROOT, 'frontend/src/app');
const BE = join(ROOT, 'backend/src');

let problems = 0;
let warnings = 0;
const fail = (m) => { problems++; console.log(`  ✗ ${m}`); };
const warn = (m) => { warnings++; console.log(`  ⚠ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}
const FILES = walk(FE);
/** The API's own files, for the action paths it emits — see section 6. */
const BE_FILES = walk(BE);
const read = (f) => readFileSync(f, 'utf8');
const rel = (f) => relative(FE, f);

// ── 1. The route table, with full paths ──────────────────────────────────
//
// Built from the source, because a hand-kept list of routes is wrong within a
// week and nobody notices — the same reason route-audit.mjs derives everything.
//
// ⚠️ Parsed with brace matching rather than a proximity regex, and that is not
// fussiness. The first version of this file paired each `loadChildren` with the
// nearest `path:` within 400 characters, which the comments in app.routes.ts
// push far enough apart that it mounted AUTH_ROUTES under `landlords/:slug` and
// TENANT_ROUTES under `reference/:token`. It then reported /auth/login and
// /tenant/dashboard as dead links — a nav audit confidently wrong about the two
// most-used routes in the product. A tool that gets this wrong is worse than no
// tool, because somebody will "fix" the nav to match it.

/** Every balanced `{ … }` block in a source file, outermost first. */
function objectBlocks(src) {
  const blocks = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '{') continue;
    let depth = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') {
        depth--;
        if (depth === 0) { blocks.push({ start: i, text: src.slice(i, j + 1) }); break; }
      }
    }
  }
  return blocks;
}

/** A block with its nested objects blanked out, so keys read at one level. */
function flatten(text) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') { depth++; if (depth === 1) { out += '{'; continue; } }
    if (ch === '}') { depth--; if (depth === 0) { out += '}'; continue; } }
    if (depth <= 1) out += ch;
  }
  return out;
}

/** Route objects in one file: `{ path, loadComponent, loadChildren, symbol }`. */
function routeObjects(src) {
  const out = [];
  for (const block of objectBlocks(src)) {
    const flat = flatten(block.text);
    const path = flat.match(/\bpath:\s*'([^']*)'/);
    if (!path) continue;
    const comp = flat.match(/loadComponent:[\s\S]*?import\('([^']+)'\)/);
    const children = flat.match(/loadChildren:[\s\S]*?import\('([^']+)'\)[\s\S]*?m\.([A-Z_]+)/);
    const redirect = flat.match(/redirectTo:\s*'([^']*)'/);
    /**
     * The page's own name, from `data.pageTitle` — Phase 7e.
     *
     * It used to be an input on each screen's `<app-portal-shell>` tag, so
     * section 5 below read it out of the component file. The sidebar is drawn
     * once by PortalLayout now and the name lives on the route, next to the
     * browser `title` it has to agree with. Both quote styles, because a title
     * containing an apostrophe ("Renter's Passport") is double-quoted.
     *
     * ⚠️ Read from `block.text`, NOT from `flat`. `flatten` blanks out nested
     * objects so keys read at one level — right for `path`, wrong here, because
     * `pageTitle` lives inside `data: { … }`. Reading the flattened text found
     * nothing, every guarded route fell through to the component-file lookup,
     * and the label count silently dropped from 48 to 20: twenty-eight
     * comparisons skipped with all four sections still reporting green. The
     * count is printed at the end of section 5 for exactly this reason.
     */
    const pageTitle = block.text.match(/pageTitle:\s*'((?:[^'\\]|\\.)*)'/)
      ?? block.text.match(/pageTitle:\s*"((?:[^"\\]|\\.)*)"/);
    out.push({
      path: path[1],
      component: comp ? comp[1] : null,
      childFile: children ? children[1] : null,
      childSymbol: children ? children[2] : null,
      redirect: redirect ? redirect[1] : null,
      pageTitle: pageTitle ? pageTitle[1].replace(/\\'/g, "'") : null,
    });
  }
  return out;
}

const appRoutes = read(join(FE, 'app.routes.ts'));
const topLevel = routeObjects(appRoutes);

const routes = new Set();
/** component path → full route path, for the label pass. */
const componentOf = new Map();

/**
 * Paths that only redirect somewhere else — Phase 7b.
 *
 * They are valid link targets (so they belong in `routes`) and they are not
 * screens, so "is it reachable from a nav" is a question about the place they
 * point at, not about them. /landlord/yard became one of these when the nav
 * moved to /landlord/properties, and the audit immediately asked for a nav
 * entry for a URL that exists only to forward old bookmarks.
 */
const redirects = new Set();

/**
 * What each guarded route calls itself, from `data.pageTitle` — Phase 7e.
 *
 * Keyed by the full route path rather than by the component file, because the
 * name is now a property of the route: `/landlord/rooms/new` and
 * `/tenant/sublet/new` load the SAME component and are deliberately called
 * different things ("List a room" and "Sublet a room in your place"), which a
 * file-keyed map could not express.
 */
const pageTitleOf = new Map();

for (const r of topLevel) {
  if (r.path === '**' || r.path === ':lang') continue;
  if (r.component || r.redirect !== null) {
    routes.add(r.path);
    if (r.component) componentOf.set(r.path, r.component);
    if (!r.component && r.redirect !== null) redirects.add(r.path);
  }
  if (!r.childFile) continue;

  const file = join(FE, r.childFile.replace(/^\.\//, '') + '.ts');
  let src;
  try { src = read(file); } catch { fail(`route file missing for mount '${r.path}': ${r.childFile}`); continue; }

  for (const child of routeObjects(src)) {
    const full = [r.path, child.path].filter(Boolean).join('/');
    routes.add(full);
    if (child.pageTitle) pageTitleOf.set(full, child.pageTitle);
    if (child.component) componentOf.set(full, child.component);
    else if (child.redirect !== null) redirects.add(full);
  }
}

const routeList = [...routes].sort();
console.log('\n── Routes ──────────────────────────────────────────────────');
ok(`${routeList.length} full route paths, parsed with brace matching from app.routes.ts and its ${topLevel.filter((r) => r.childFile).length} mounted route files`);

/** Does a link path match a declared route, parameters and all? */
function resolves(path) {
  const want = path.replace(/^\//, '').split('/').filter(Boolean);
  for (const route of routeList) {
    const have = route.split('/').filter(Boolean);
    if (have.length !== want.length) continue;
    if (have.every((seg, i) => seg.startsWith(':') || seg === want[i])) return route;
  }
  // The board is '', and a bare '/' link is the board.
  if (want.length === 0) return '';
  return null;
}

// ── 2. Every internal link in the app ────────────────────────────────────
console.log('\n── Internal links (full path) ──────────────────────────────');

/** One link found in a template or a navigate() call. */
const links = [];

for (const file of FILES) {
  const src = read(file);

  // routerLink="/a/b"  and  routerLink="/a/b#frag"
  for (const m of src.matchAll(/routerLink="(\/[^"]*)"/g)) {
    links.push({ file, raw: m[1], kind: 'routerLink' });
  }
  // [routerLink]="'/a/b'"
  for (const m of src.matchAll(/\[routerLink\]="'(\/[^']*)'"/g)) {
    links.push({ file, raw: m[1], kind: 'routerLink' });
  }
  // [routerLink]="['/a', id, 'b']" — expression segments become a parameter.
  for (const m of src.matchAll(/\[routerLink\]="\[([^\]]*)\]"/g)) {
    const segs = m[1].split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => (s.startsWith("'") ? s.replace(/'/g, '') : ':param'));
    if (segs.length && segs[0].startsWith('/')) {
      links.push({ file, raw: segs.join('/').replace(/\/+/g, '/'), kind: 'routerLink[]' });
    }
  }
  // router.navigate(['/a', x]) and navigateByUrl('/a/b')
  for (const m of src.matchAll(/navigate\(\s*\[([^\]]*)\]/g)) {
    const segs = m[1].split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => (s.startsWith("'") || s.startsWith('`') ? s.replace(/['`]/g, '') : ':param'));
    if (segs.length && segs[0].startsWith('/')) {
      links.push({ file, raw: segs.join('/').replace(/\/+/g, '/'), kind: 'navigate' });
    }
  }
  for (const m of src.matchAll(/navigateByUrl\(\s*'(\/[^']*)'/g)) {
    links.push({ file, raw: m[1], kind: 'navigateByUrl' });
  }
}

/** Strip a fragment and a query string; keep the fragment for the label pass. */
function split(raw) {
  const [beforeHash, fragment] = raw.split('#');
  const [path] = beforeHash.split('?');
  return { path, fragment: fragment || null };
}

const dead = new Map();
for (const link of links) {
  const { path } = split(link.raw);
  // A dynamic first segment cannot be resolved statically and is not a nav link.
  if (path.includes(':param') && path.split('/').filter(Boolean)[0] === ':param') continue;
  if (resolves(path) === null) {
    const key = `${path} — ${link.kind} in ${rel(link.file)}`;
    dead.set(key, (dead.get(key) ?? 0) + 1);
  }
}

if (dead.size) {
  for (const key of [...dead.keys()].sort()) fail(`link to a route that does not exist: ${key}`);
} else {
  ok(`all ${links.length} internal links resolve as FULL paths, parameters included`);
}

// ── 3. The nav surfaces, enumerated ──────────────────────────────────────
console.log('\n── Nav surfaces ────────────────────────────────────────────');

/**
 * Where a person can click to get somewhere, by surface.
 *
 * The navbar file holds both the desktop row and the mobile drawer — they are
 * one template with a CSS breakpoint, which is itself worth knowing: there is
 * no second list to drift.
 */
const SURFACES = [
  { name: 'navbar (desktop + mobile drawer)', file: 'shared/components/navbar/navbar.ts' },
  { name: 'footer', file: 'shared/components/footer/footer.ts' },
  { name: 'portal nav — landlord', file: 'features/landlord/landlord-nav.ts' },
  { name: 'portal nav — tenant', file: 'features/tenant/tenant-nav.ts' },
  { name: 'portal nav — admin', file: 'features/admin/admin-nav.ts' },
];

/**
 * Nav items declared as data: `{ label: 'X', …, route: '/y', fragment: 'z' }`.
 *
 * ⚠️ Both quote styles. The first version matched single quotes only, so it
 * silently skipped `label: "Renter's Passport"` — written with double quotes
 * precisely because the label contains an apostrophe — and then reported
 * /tenant/passport as a screen reachable only by URL. Which is the exact defect
 * the Phase 7a brief asks about, arrived at by missing the line that fixes it.
 * A tool that invents a finding will have somebody "fix" a working nav.
 */
function navItems(src) {
  const out = [];
  for (const m of src.matchAll(/\{[^{}]*label:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")[^{}]*\}/g)) {
    const block = m[0];
    const route = block.match(/route:\s*'([^']*)'/);
    const fragment = block.match(/fragment:\s*'([^']*)'/);
    const disabled = /disabled:\s*true/.test(block);
    if (route) {
      out.push({
        label: (m[1] ?? m[2] ?? '').replace(/\\'/g, "'"),
        path: route[1],
        fragment: fragment ? fragment[1] : null,
        disabled,
      });
    }
  }
  return out;
}

/** Links written straight into a template, with their visible text. */
function templateLinks(src) {
  const out = [];
  for (const m of src.matchAll(/<a\b([^>]*routerLink="(\/[^"]*)"[^>]*)>([\s\S]*?)<\/a>/g)) {
    const attrs = m[1];
    const text = m[3]
      .replace(/<[^>]*>/g, ' ')
      .replace(/\{\{[^}]*\}\}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // A fragment can arrive two ways: inside the href-ish routerLink as
    // `/x#frag`, or as its own `fragment="frag"` attribute, which is the form
    // Angular wants and the form the footer uses. Reading only the first meant
    // a link that DID point at a section was reported as pointing at the page.
    const attrFragment = attrs.match(/\bfragment="([^"]+)"/);
    out.push({
      label: text,
      path: split(m[2]).path,
      fragment: split(m[2]).fragment ?? (attrFragment ? attrFragment[1] : null),
      disabled: false,
    });
  }
  return out;
}

const navTargets = new Set();
const allNavItems = [];

for (const surface of SURFACES) {
  let src;
  try { src = read(join(FE, surface.file)); } catch { fail(`nav surface file missing: ${surface.file}`); continue; }
  const items = [...navItems(src), ...templateLinks(src)];
  console.log(`\n  ${surface.name} — ${items.length} item(s)`);
  for (const item of items) {
    const target = resolves(item.path);
    const mark = item.disabled ? '◦' : target === null ? '✗' : '·';
    const frag = item.fragment ? `#${item.fragment}` : '';
    console.log(`    ${mark} ${(item.label || '(no text)').slice(0, 42).padEnd(44)} → ${item.path}${frag}`);
    if (target === null && !item.disabled) {
      fail(`${surface.name}: "${item.label}" points at ${item.path}, which is not a route`);
    }
    if (!item.disabled && target !== null) navTargets.add(target);
    allNavItems.push({ ...item, surface: surface.name, target });
  }
}

// ── 4. Reachability: a screen no nav links to ────────────────────────────
console.log('\n── Reachability ────────────────────────────────────────────');

/**
 * Screens deliberately not in any nav, with the reason.
 *
 * Kept here rather than silently skipped: an exception with a reason beside it
 * is reviewable, and a reader can disagree with it. Anything NOT on this list
 * and not in a nav is a screen only somebody holding the URL can open.
 */
const NOT_IN_NAV = {
  'landlord/rooms/new': 'the navbar CTA "List a room"; also the dashboard',
  'landlord/rooms/:roomId/edit': 'opened from a room card on the dashboard',
  'landlord/rooms/:roomId/applicants': 'opened from a room card on the dashboard',
  'tenant/sublet/new': 'the dashboard CTA under "Rooms you are letting out"',
  'tenant/sublet/:roomId/edit': 'opened from that listing in the dashboard section',
  'tenant/sublet/:roomId/applicants': 'opened from that listing in the dashboard section',
  'admin/users/:id': 'opened from a row in the admin user list',
  'landlord/properties/:propertyId': 'opened by tapping a property card on /landlord/properties',
};

const guardedAreas = ['landlord', 'tenant', 'admin', 'account'];
const unreachable = [];
for (const route of routeList) {
  const area = route.split('/')[0];
  if (!guardedAreas.includes(area)) continue;
  if (route === area || route.endsWith("/''")) continue;
  if (navTargets.has(route)) continue;
  if (NOT_IN_NAV[route]) continue;
  if (redirects.has(route)) continue;
  unreachable.push(route);
}

if (unreachable.length) {
  for (const route of unreachable) {
    fail(`/${route} is in no nav surface and has no stated reason — only reachable by URL`);
  }
} else {
  ok('every guarded screen is reachable from a nav, or is listed with the reason it is not');
  for (const [route, why] of Object.entries(NOT_IN_NAV)) {
    console.log(`    ◦ /${route} — ${why}`);
  }
}

// ── 5. One name per thing ────────────────────────────────────────────────
console.log('\n── Labels ──────────────────────────────────────────────────');

/**
 * What the destination calls itself.
 *
 * Three places a page can say its own name, in the order they are trusted:
 * the portal shell's `pageTitle` input (the portal's h1), a literal <h1>, and
 * the route's `title` (which is the browser tab, so it carries the brand and is
 * the weakest signal).
 */
const headings = new Map();
for (const file of FILES) {
  const src = read(file);
  // A public page still says its name in its own <h1>; the guarded ones say it
  // on the route (see pageTitleOf), which is checked first where the nav item
  // resolves to a route that has one.
  const h1 = src.match(/<h1[^>]*>([^<{]+)</);
  if (h1) headings.set(rel(file), h1[1].replace(/\s+/g, ' ').trim());
}

/**
 * Which component a route loads — taken from the route table built above, so a
 * nav item is compared against the page it actually opens rather than against
 * whichever route file happened to mention the same child path.
 */
const normalise = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
/**
 * Compared on stems, not exact words.
 *
 * "Verifications" against "Verification queue", and "Usage" against "How the
 * site is used", were both reported as two names for one destination. They are
 * one name in two grammatical forms, and a reviewer who sees two of those in a
 * row stops reading the list. Crude on purpose: a four-line stemmer that drops
 * a trailing s/es/ed/ing catches every case this product actually has.
 */
const stem = (w) => w.replace(/(ies|es|ed|ing|s)$/, '');
const words = (s) => new Set(normalise(s).split(' ').filter((w) => w.length > 2).map(stem));
const overlaps = (a, b) => {
  const A = words(a), B = words(b);
  for (const w of A) if (B.has(w)) return true;
  return false;
};

/**
 * What each anchored SECTION calls itself.
 *
 * Collected so a fragment link can be checked too, rather than skipped — half
 * the portal nav points at a section of a dashboard, so skipping them would
 * leave the busiest surface in the product unchecked. The heading is the first
 * one within a few hundred characters of the id, which is how these templates
 * are written: `<section id="saved-rooms"><h2 class="dash-section-title">Saved
 * rooms`.
 */
const sectionHeadings = new Map();
for (const file of FILES) {
  const src = read(file);
  for (const m of src.matchAll(/id="([a-z0-9-]+)"/g)) {
    const after = src.slice(m.index, m.index + 400);
    const h = after.match(/<h[1-3][^>]*>([^<{]+)/);
    if (h && !sectionHeadings.has(m[1])) {
      sectionHeadings.set(m[1], h[1].replace(/\s+/g, ' ').trim());
    }
  }
}

/**
 * Compared for every nav item that names something: a page by its heading, a
 * section by its own.
 *
 * A link whose text is an icon or empty says nothing to compare, and a
 * `disabled` item points at nothing by design.
 */
let compared = 0;
for (const item of allNavItems) {
  if (item.disabled || item.target === null) continue;
  if (!item.label || item.label.length < 3) continue;

  if (item.fragment) {
    const sectionHeading = sectionHeadings.get(item.fragment);
    if (!sectionHeading) {
      fail(`"${item.label}" (${item.surface}) points at #${item.fragment}, which no page declares`);
      continue;
    }
    compared++;
    if (!overlaps(item.label, sectionHeading)) {
      warn(`"${item.label}" (${item.surface}) jumps to a section headed "${sectionHeading}" — two names for one place`);
    }
    continue;
  }

  /**
   * The route's own `data.pageTitle` first, the component's `<h1>` second.
   *
   * Guarded screens stopped carrying their own h1 in Phase 7e — the layout
   * draws it from the route — so a component-file lookup now finds nothing for
   * most of the portal and every one of those comparisons would be silently
   * skipped. The count printed below is what makes that visible: it was 48
   * before this change and has to stay there.
   */
  const heading = pageTitleOf.get(item.target) ?? (() => {
    const comp = componentOf.get(item.target);
    if (!comp) return null;
    const compFile = comp.replace(/^\.\//, '');
    return [...headings.entries()].find(([f]) => f.includes(compFile.replace(/^features\//, 'features/')))?.[1] ?? null;
  })();
  if (!heading) continue;

  compared++;
  if (overlaps(item.label, heading)) continue;

  /**
   * A public landing page whose h1 is a HEADLINE, not the page's name.
   *
   * These are deliberate and are not the defect the brief is about. Nobody
   * clicking "Pricing" is confused to land on a page headed "Free to list.
   * Free to apply." — the page is self-evidently the pricing page, and the
   * headline is doing the work a headline should. The defect the brief names is
   * an in-product DESTINATION known by two names ("Billing" pointing at
   * `upgrade`), where a person has to work out that two words mean one screen.
   *
   * Listed route by route rather than skipped by area, so a new mismatch inside
   * the product still shows up, and so disagreeing with one of these is a
   * one-line change in a reviewable list.
   */
  const HEADLINE_PAGES = {
    'how-it-works': 'the h1 is the promise ("Simple for landlords"), which is the page\'s job',
    pricing: 'the h1 is the position ("Free to list. Free to apply."), which is the whole pitch',
    advertise: 'the h1 speaks to an advertiser, not to a navigator',
    'admin/dashboard': 'the navbar button says "Admin" because it enters the AREA; the page says "Overview" because that is the screen',
    'landlord/dashboard': 'the footer calls it "Landlord portal" because from outside it is an area, not a page',
    'admin/analytics': 'one word in the nav strip ("Usage"), a sentence on the page ("How the site is used") — the same word in two grammatical forms, which no reader has to decode',
  };
  if (HEADLINE_PAGES[item.target]) continue;

  warn(`"${item.label}" (${item.surface}) opens a page headed "${heading}" — two names for one destination`);
}
ok(`${compared} nav item(s) compared against the heading of the page or section they open`);

// ── 6. Paths the API hands the browser ───────────────────────────────────
console.log('\n── API action paths ────────────────────────────────────────');

/**
 * Destinations that come from the SERVER, not from a template — Phase 7d.
 *
 * ⚠️ This section exists because of a break it would have caught. The landlord
 * task inbox — the dashboard's top section, the list of things needing doing —
 * emits each row's destination as a string from `LandlordInboxService`. Phase 7b
 * turned `/landlord/yard` into a redirect, and those strings still said
 * `/landlord/yard#money` and `/landlord/yard#ending-soon`. A redirect DROPS the
 * fragment, so the two most important buttons on the dashboard put a landlord on
 * a list of addresses with no explanation of why.
 *
 * Nothing caught it. Sections 2 and 4 above read templates and route tables, and
 * these paths are in neither: they are string literals in the API. So they are
 * read here, resolved against the same route table, and held to one extra rule
 * that templates are held to as well below — a fragment on a route that only
 * redirects can never arrive.
 *
 * Interpolated segments become `:param`, because `/landlord/properties/${id}`
 * is the same claim about the route table as `/landlord/properties/:id`.
 */
const API_PATHS = [];

/**
 * One pattern per quote style, and that is the whole point.
 *
 * ⚠️ Twice now a single pattern written as `[^'"`\n]*` — "anything that is not
 * a quote" — has made this harvester silently blind. `moneyPath` returns
 * `/landlord/properties/${propertyId ?? 'ungrouped'}#money`, which contains a
 * single quote INSIDE a template literal, so the combined character class
 * rejected the one string this section was written to check. It reported four
 * paths, all green, and said nothing about the two that matter.
 *
 * The exclusion set must be the DELIMITER only. Hence three patterns.
 */
const QUOTED = [
  { open: '`', re: /return\s+`(\/[^`\n]*)`/g, attr: /actionPath:\s*`([^`\n]*)`/g },
  { open: "'", re: /return\s+'(\/[^'\n]*)'/g, attr: /actionPath:\s*'([^'\n]*)'/g },
  { open: '"', re: /return\s+"(\/[^"\n]*)"/g, attr: /actionPath:\s*"([^"\n]*)"/g },
];

for (const file of BE_FILES) {
  const src = read(file);
  for (const { re, attr } of QUOTED) {
    // A destination written straight onto the item.
    for (const m of src.matchAll(new RegExp(attr.source, 'g'))) {
      API_PATHS.push({ raw: m[1], file });
    }
    // The helper form: a small function that returns the path.
    for (const m of src.matchAll(new RegExp(re.source, 'g'))) {
      if (/#/.test(m[1]) || /^\/(landlord|tenant|account|admin)\//.test(m[1])) {
        API_PATHS.push({ raw: m[1], file });
      }
    }
  }
}

/** Every `id="..."` in the app, so a fragment can be checked for a target. */
const SECTION_IDS = new Set();
for (const file of FILES) {
  for (const m of read(file).matchAll(/\bid="([a-z0-9-]+)"/g)) SECTION_IDS.add(m[1]);
}

let apiChecked = 0;
let apiFragments = 0;
const apiSeen = new Set();
for (const { raw, file } of API_PATHS) {
  // `${...}` → a parameter. The route table matches a segment, not a value.
  const normalised = raw.replace(/\$\{[^}]*\}/g, ':param');
  const { path, fragment } = split(normalised);
  const key = `${normalised}|${file}`;
  if (apiSeen.has(key)) continue;
  apiSeen.add(key);
  apiChecked++;

  const route = resolves(path);
  if (route === null) {
    fail(`the API hands the browser '${raw}', which matches no route (${relative(ROOT, file)})`);
    continue;
  }
  if (!fragment) continue;
  apiFragments++;

  // The rule that catches the Phase 7b break: a redirect cannot carry a
  // fragment through, so the landing page never scrolls to the section and the
  // person is left at the top of somewhere they did not ask for.
  if (redirects.has(route)) {
    fail(
      `the API hands the browser '${raw}', but '${route}' only redirects — a redirect drops the fragment, `
      + `so nobody ever reaches #${fragment} (${relative(ROOT, file)})`,
    );
    continue;
  }
  if (fragment === ':param') {
    fail(
      `the API builds a fragment by interpolation in ${relative(ROOT, file)} ('${raw}'), so this check `
      + 'cannot tell which section it means. Write the fragment as a literal — see moneyPath/leasePath.',
    );
    continue;
  }
  if (!SECTION_IDS.has(fragment)) {
    fail(`the API hands the browser '${raw}', and no screen has id="${fragment}" (${relative(ROOT, file)})`);
  }
}

/**
 * The harvester's own smoke alarm.
 *
 * The API is known to emit fragment paths — the landlord task inbox's rows are
 * built on them. If none is found, the regexes have stopped matching rather
 * than the problem having gone away, which is exactly how this section was
 * blind twice over. Reported as a failure, not a note.
 */
if (apiFragments === 0) {
  fail(
    'no API path with a fragment was found at all. The landlord task inbox emits two, '
    + 'so this harvester has stopped matching rather than the paths having gone away.',
  );
}
// Worded as what was READ, not as a verdict: an earlier version printed "none
// points a fragment at a redirect" on the same run as two failures saying
// exactly that, because the line ran unconditionally. A summary line that
// contradicts the findings above it is how a reader learns to skip both.
ok(`${apiChecked} path(s) emitted by the API checked against the route table, ${apiFragments} of them with a fragment`);

/**
 * The app's own fragment links, held to the same two rules.
 *
 * Both forms: `routerLink="/x#frag"` written into a template, and the nav
 * items' separate `fragment:` property — which is most of them, since half the
 * landlord nav names a section of the dashboard rather than a page of its own.
 * Reading only the first form would check almost nothing.
 */
let fragmentLinks = 0;
const fragmentTargets = [
  ...links.map((l) => ({ where: rel(l.file), raw: l.raw, ...split(l.raw) })),
  ...allNavItems
    .filter((i) => i.fragment && !i.disabled)
    .map((i) => ({ where: i.surface, raw: `${i.path}#${i.fragment}`, path: i.path, fragment: i.fragment })),
];

for (const t of fragmentTargets) {
  if (!t.fragment) continue;
  const route = resolves(t.path);
  if (route === null) continue;   // already reported above
  fragmentLinks++;
  if (redirects.has(route)) {
    fail(`${t.where} links to '${t.raw}', but '${route}' only redirects — the fragment is dropped`);
  } else if (!SECTION_IDS.has(t.fragment)) {
    fail(`${t.where} links to '${t.raw}', and no screen has id="${t.fragment}"`);
  }
}
ok(`${fragmentLinks} link(s) with a fragment checked the same way`);

// ── Summary ─────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════');
if (problems === 0 && warnings === 0) {
  console.log('  Every nav link resolves, every screen is reachable, every label agrees,');
  console.log('  and every path the API hands the browser lands on a section that exists.');
} else {
  console.log(`  ${problems} problem(s), ${warnings} label warning(s)`);
}
console.log('════════════════════════════════════════════════════════════');
process.exit(problems > 0 ? 1 : 0);
