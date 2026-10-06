/**
 * The navigation, at three widths — Phase 7e.
 *
 * ── What only a browser at a given width can show
 *
 *   1. **The portal sidebar is on every guarded screen.** It was a component
 *      each screen rendered for itself and two did not render it at all:
 *      /landlord/rooms/new and /landlord/rooms/:roomId/applicants, which are
 *      the two screens a landlord uses most. On a phone, where the sidebar IS
 *      the strip at the top and the header hamburger carries only public
 *      links, there was no way out of either except the browser's back button.
 *   2. **It does not shrink as you move through it.** Phase 7a found the nav's
 *      CONTENTS defined six times and disagreeing; this checks the rendered
 *      item count is identical across six screens, which is the only way to
 *      see that fault.
 *   3. **Log in and Get started are in the HEADER on a phone**, not behind the
 *      hamburger — item 23. Log in was `display: none` at ≤480px while Get
 *      started stayed, so the header showed one half of a pair and the other
 *      half took two taps.
 *   4. **The footer does not offer a visitor a guarded route** — item 24.
 *      "Landlord portal" and "My applications" both went to a login form, and
 *      the nav audit cannot see it because both links resolve.
 *   5. **Nothing scrolls sideways** at 360, 390 or 768, and every tap target
 *      clears 44px. CLAUDE.md makes that a standing rule rather than a
 *      per-phase afterthought.
 *
 * Needs the API on :3000, the app on :4200, and a DATABASE_URL.
 */
import { chromium } from '@playwright/test';
import { registerUser, apiCall, signIn, PASSWORD, dbQuery as q } from './lib/drive-session.mjs';

const API = 'http://localhost:3000', WEB = 'http://localhost:4200';
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const S = Math.floor(Math.random() * 1e6);
const PHONE = { width: 390, height: 844 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1280, height: 900 };

const landlord = await registerUser(API, 'LANDLORD');
const tenant = await registerUser(API, 'TENANT');

const room = await apiCall(API, 'POST', '/api/rooms', {
  roomType: 'shared_house', title: `Nav room ${S}`,
  description: 'A clean room in a shared house, close to transport and the shops. Available now.',
  rentCents: 295000, province: 'Gauteng', city: 'Johannesburg',
  locationDisplay: 'Tembisa, Johannesburg',
  availableFrom: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
}, landlord.token);
q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${room.body.id}'`);
await apiCall(API, 'POST', '/api/applications', { roomId: room.body.id, coverNote: 'Still open?' }, tenant.token);

const browser = await chromium.launch();

/** Every item the sidebar renders, by its visible label. */
const navLabels = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.portal-nav .portal-nav-link')]
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean));

const overflowOf = (page) => page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);

console.log('\n── 1. The sidebar is on every guarded screen ───────────────');

const LANDLORD_SCREENS = [
  ['the dashboard', '/landlord/dashboard'],
  ['my properties', '/landlord/properties'],
  ['all applicants', '/landlord/applicants'],
  ['verification', '/landlord/verification'],
  ['who to call', '/landlord/services'],
  ['your public page', '/landlord/public-page'],
  // ⚠️ The two that had no sidebar at all before Phase 7e.
  ['the listing wizard', '/landlord/rooms/new'],
  [`one room's applicants`, `/landlord/rooms/${room.body.id}/applicants`],
  ['messages', '/account/messages'],
  ['notices', '/account/notices'],
  ['settings', '/account/settings'],
];

const page = await signIn(browser, WEB, landlord.email, PASSWORD, DESKTOP);
const counts = new Map();
for (const [name, path] of LANDLORD_SCREENS) {
  await page.goto(WEB + path, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.portal-nav', { timeout: 20000 }).catch(() => {});
  const labels = await navLabels(page);
  counts.set(name, labels.length);
  labels.length > 0
    ? ok(`${name} has the portal sidebar (${labels.length} items)`)
    : bad(`${name} (${path}) renders NO portal navigation`);
}

const sizes = [...new Set(counts.values())];
sizes.length === 1
  ? ok(`…and it is the same size on all ${counts.size} of them (${sizes[0]} items) — it does not shrink as you move`)
  : bad(`the sidebar changes size between screens: ${JSON.stringify([...counts])}`);

console.log('\n── 2. One h1 per screen, and it is the page’s own name ──────');

for (const [name, path] of [['the listing wizard', '/landlord/rooms/new'],
                            [`one room's applicants`, `/landlord/rooms/${room.body.id}/applicants`],
                            ['my properties', '/landlord/properties']]) {
  await page.goto(WEB + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const h1s = await page.locator('.portal-main h1').allInnerTexts();
  h1s.length === 1
    ? ok(`${name} has exactly one h1 ("${h1s[0].trim()}")`)
    : bad(`${name} has ${h1s.length} h1(s) in the portal main: ${JSON.stringify(h1s)}`);
}

// The wizard's title differs by route, which is why it moved to route data and
// not to a constant: an owner and a sub-lessor must not be told they are doing
// the same thing.
await page.goto(`${WEB}/landlord/rooms/new`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ownerTitle = (await page.locator('.portal-main h1').innerText()).trim();
const tPage = await signIn(browser, WEB, tenant.email, PASSWORD, DESKTOP);
await tPage.goto(`${WEB}/tenant/sublet/new`, { waitUntil: 'domcontentloaded' });
await tPage.waitForTimeout(2000);
const subletTitle = (await tPage.locator('.portal-main h1').innerText()).trim();
ownerTitle !== subletTitle && /sublet/i.test(subletTitle)
  ? ok(`the same wizard is headed "${ownerTitle}" for an owner and "${subletTitle}" for a sub-lessor`)
  : bad(`both routes head the wizard "${ownerTitle}" / "${subletTitle}"`);

console.log('\n── 3. The sidebar on a phone: a strip, not a disappearance ──');

const phone = await signIn(browser, WEB, landlord.email, PASSWORD, PHONE);
for (const [name, path] of [['the dashboard', '/landlord/dashboard'],
                            ['the listing wizard', '/landlord/rooms/new'],
                            [`one room's applicants`, `/landlord/rooms/${room.body.id}/applicants`]]) {
  await phone.goto(WEB + path, { waitUntil: 'domcontentloaded' });
  await phone.waitForSelector('.portal-nav', { timeout: 20000 }).catch(() => {});
  const labels = await navLabels(phone);
  labels.length > 0
    ? ok(`${name} keeps the nav strip at 390px (${labels.length} items)`)
    : bad(`${name} has no navigation at all at 390px`);
}

const strip = await phone.evaluate(() => {
  const nav = document.querySelector('.portal-nav');
  if (!nav) return null;
  const s = getComputedStyle(nav);
  const links = [...nav.querySelectorAll('.portal-nav-link')];
  return {
    horizontal: s.display === 'flex' && s.overflowX === 'auto',
    scrollable: nav.scrollWidth > nav.clientWidth,
    minHeight: Math.min(...links.map((l) => l.getBoundingClientRect().height)),
  };
});
strip?.horizontal
  ? ok('…as a horizontal scrolling row rather than a second drawer behind a second tap')
  : bad(`the strip is not a scrolling row: ${JSON.stringify(strip)}`);
strip && strip.minHeight >= 44
  ? ok(`…with every item at least 44px tall (smallest ${Math.round(strip.minHeight)}px) — WCAG 2.5.8`)
  : bad(`a nav item is ${Math.round(strip?.minHeight ?? 0)}px tall, under the 44px target`);

(await overflowOf(phone)) <= 1
  ? ok('…and the page itself does not scroll sideways')
  : bad(`the portal page overflows by ${await overflowOf(phone)}px at 390px`);

// ── 3b. The strip is complete IN PRACTICE, not only in the DOM — Phase 7n ──
//
// Everything above this point was true before Phase 7n and the strip was still
// unusable. Measured at 360px: 2251px of nav in a 359px window, so TWO of
// fourteen items on screen and 1892px past the right edge — with no fade, no
// mask and no visible scrollbar, opening scrolled to 0. "Who to call",
// "Notices" and "Settings" were in there. `scrollable: true` was asserted and
// said nothing about whether a person could tell, or get there.
//
// So: is there a cue, does the far end actually arrive, and is "you are here"
// on screen when you land somewhere deep in the list.

const cue = await phone.evaluate(() => {
  const nav = document.querySelector('.portal-nav');
  if (!nav) return null;
  const s = getComputedStyle(nav);
  return {
    backgroundImage: s.backgroundImage,
    layers: s.backgroundImage === 'none' ? 0 : s.backgroundImage.split(/,(?![^(]*\))/).length,
    attachment: s.backgroundAttachment,
  };
});
// Four layers: two covers that scroll with the content, two shadows pinned to
// the element. Fewer than four cannot be self-regulating, and a static
// gradient would promise more nav at the end of the strip.
cue && cue.layers >= 4 && /local/.test(cue.attachment)
  ? ok(`…with a scroll cue that fades out at the ends (${cue.layers} layers, attachment ${cue.attachment})`)
  : bad(`the strip gives no sign that ${'' + (await phone.evaluate(() => { const n = document.querySelector('.portal-nav'); return n.scrollWidth - n.clientWidth; }))}px of nav is off-screen: ${JSON.stringify(cue)}`);

// Every item is REACHABLE: scroll to the end and the last one is on screen.
// This is the completeness claim, and nothing asserted it before — a strip
// clipped by a parent would have passed every check above.
// ⚠️ `behavior: 'instant'`, and a wait before measuring.
//
// Written as `nav.scrollLeft = nav.scrollWidth` followed by an immediate read
// in the same evaluate, this check FAILED and reported that the last item
// could not be reached — a product bug that did not exist. The strip now sets
// `scroll-behavior: smooth` (for revealActive), so a programmatic scroll is
// animated and reading scrollLeft back in the same tick gives the value it
// started at. The scroll was fine; the measurement was taken before it landed.
await phone.evaluate(() => {
  const nav = document.querySelector('.portal-nav');
  nav.scrollTo({ left: nav.scrollWidth, behavior: 'instant' });
});
await phone.waitForTimeout(400);
const reach = await phone.evaluate(() => {
  const nav = document.querySelector('.portal-nav');
  const navBox = nav.getBoundingClientRect();
  const links = [...nav.querySelectorAll('.portal-nav-link, .portal-nav-cta a')];
  const last = links.at(-1);
  const lb = last.getBoundingClientRect();
  return {
    total: links.length,
    lastLabel: last.textContent.trim().split('\n')[0].trim(),
    lastInView: lb.left >= navBox.left - 1 && lb.right <= navBox.right + 1,
    scrolledTo: Math.round(nav.scrollLeft),
  };
});
reach.lastInView
  ? ok(`…and the far end of the strip really arrives: all ${reach.total} items reachable, last is "${reach.lastLabel}"`)
  : bad(`the last nav item ("${reach.lastLabel}") cannot be scrolled into view — ${reach.total} items, scrolled to ${reach.scrolledTo}px`);

// "You are here", on a screen far enough along the strip to prove it.
// /tenant/passport measured at x=437 in a 359px window before this: a
// highlight nobody can see is not an orientation cue.
const deep = await signIn(browser, WEB, tenant.email, PASSWORD, { width: 360, height: 820 });
await deep.goto(`${WEB}/tenant/passport`, { waitUntil: 'networkidle' });
await deep.waitForSelector('.portal-nav .portal-nav-link');
await deep.waitForTimeout(600);                 // scroll-behavior: smooth
const here = await deep.evaluate(() => {
  const nav = document.querySelector('.portal-nav');
  const navBox = nav.getBoundingClientRect();
  const marked = [...nav.querySelectorAll('.portal-nav-link.active')];
  const cur = [...nav.querySelectorAll('.portal-nav-link[aria-current="page"]')];
  const a = marked[0]?.getBoundingClientRect();
  return {
    labels: marked.map((m) => m.textContent.trim().split('\n')[0].trim()),
    currentCount: cur.length,
    inView: a ? a.left >= navBox.left - 1 && a.right <= navBox.right + 1 : false,
    scrollLeft: Math.round(nav.scrollLeft),
  };
});
here.labels.length === 1 && /passport/i.test(here.labels[0])
  ? ok(`…and the strip marks the screen you are actually on ("${here.labels[0]}")`)
  : bad(`on /tenant/passport the strip marks ${JSON.stringify(here.labels)} — it used to mark "Browse rooms" on all six tenant screens`);
here.currentCount === 1
  ? ok('…exactly one item, so a screen reader announces one current page')
  : bad(`${here.currentCount} items carry aria-current="page" on one screen`);
here.inView
  ? ok(`…and it is scrolled into view rather than left off the edge (strip at ${here.scrollLeft}px)`)
  : bad(`the active item is off-screen at 360px — the strip opens at ${here.scrollLeft}px and never moves`);

// A section of the dashboard is its own "you are here" — and the route root
// is not, when a section is named.
//
// ⚠️ This check exists because falsifying the one above could not reach the
// rule it was meant to cover. /tenant/passport carries no fragment, so letting
// an `exact` item match alongside a fragment one changed nothing there, and
// the aria-current failure that run reported came entirely from the Browse
// rooms bug. A rule with no check that can fail for it is not covered.
const frag = await signIn(browser, WEB, landlord.email, PASSWORD, { width: 360, height: 820 });
for (const [url, want] of [
  ['/landlord/dashboard', 'Dashboard'],
  ['/landlord/dashboard#drafts', 'Drafts'],
  ['/landlord/dashboard#needs-attention', 'Needs you'],
]) {
  await frag.goto(`${WEB}${url}`, { waitUntil: 'networkidle' });
  await frag.waitForSelector('.portal-nav .portal-nav-link');
  await frag.waitForTimeout(500);
  const marked = await frag.evaluate(() =>
    [...document.querySelectorAll('.portal-nav .portal-nav-link[aria-current="page"]')]
      .map((a) => a.textContent.trim().split('\n')[0].trim()));
  marked.length === 1 && marked[0].includes(want)
    ? ok(`${url} marks exactly "${want}"`)
    : bad(`${url} marks ${JSON.stringify(marked)}, expected one item containing "${want}"`);
}
await frag.context().close();

await deep.context().close();

console.log('\n── 4. Log in and Get started stay in the header ────────────');

for (const width of [360, 390, 430]) {
  const visitor = await browser.newPage({ viewport: { width, height: 800 } });
  await visitor.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
  await visitor.waitForTimeout(2500);

  const header = await visitor.evaluate(() => {
    const actions = document.querySelector('.nav-actions');
    const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
    const btns = [...(actions?.querySelectorAll('.btn') ?? [])];
    return {
      labels: btns.filter(vis).map((b) => (b.textContent ?? '').trim()),
      heights: btns.filter(vis).map((b) => Math.round(b.getBoundingClientRect().height)),
      burgerVisible: vis(document.querySelector('.nav-burger')),
      drawerOpen: !!document.querySelector('.nav-links.open'),
    };
  });

  const hasLogin = header.labels.some((l) => /log ?in/i.test(l));
  const hasStart = header.labels.some((l) => /get started|sign ?up/i.test(l));
  hasLogin && hasStart
    ? ok(`at ${width}px both CTAs are in the header, drawer shut: ${JSON.stringify(header.labels)}`)
    : bad(`at ${width}px the header shows ${JSON.stringify(header.labels)} — Log in and Get started must both be there`);

  Math.min(...header.heights) >= 44
    ? ok(`…and both clear the 44px tap target (smallest ${Math.min(...header.heights)}px)`)
    : bad(`at ${width}px a header CTA is ${Math.min(...header.heights)}px tall`);

  const overflow = await overflowOf(visitor);
  overflow <= 1
    ? ok('…without pushing the page sideways')
    : bad(`at ${width}px keeping both CTAs overflows the page by ${overflow}px`);

  // Overcrowding is not only overflow: the logo must still be readable and
  // nothing may overlap the burger.
  const overlap = await visitor.evaluate(() => {
    const logo = document.querySelector('.nav-logo')?.getBoundingClientRect();
    const actions = document.querySelector('.nav-actions')?.getBoundingClientRect();
    const burger = document.querySelector('.nav-burger')?.getBoundingClientRect();
    if (!logo || !actions) return 'missing';
    const over = (a, b) => a && b && a.right > b.left + 1 && a.left < b.right - 1;
    return { logoActions: over(logo, actions), actionsBurger: over(actions, burger), logoWidth: Math.round(logo.width) };
  });
  overlap !== 'missing' && !overlap.logoActions && !overlap.actionsBurger && overlap.logoWidth > 60
    ? ok(`…and nothing overlaps: the logo still has ${overlap.logoWidth}px`)
    : bad(`at ${width}px the header is overcrowded: ${JSON.stringify(overlap)}`);

  await visitor.close();
}

// Signed in, the header stays uncluttered and the drawer carries the rest.
const signedInPhone = await signIn(browser, WEB, landlord.email, PASSWORD, PHONE);
await signedInPhone.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
await signedInPhone.waitForTimeout(2000);
const signedIn = await signedInPhone.evaluate(() => {
  const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
  return {
    header: [...document.querySelectorAll('.nav-actions .btn')].filter(vis).map((b) => (b.textContent ?? '').trim()),
    drawerAuth: !!document.querySelector('.nav-links-auth'),
  };
});
!signedIn.header.some((l) => /log out/i.test(l))
  ? ok('signed in, the phone header is not asked to carry Dashboard, List a room AND Log out')
  : bad(`signed in, the phone header shows ${JSON.stringify(signedIn.header)}`);

await signedInPhone.locator('.nav-burger').click();
await signedInPhone.waitForTimeout(600);
const drawerLabels = await signedInPhone.evaluate(() =>
  [...document.querySelectorAll('.nav-links.open .nav-links-auth .btn, .nav-links.open .nav-links-auth button')]
    .map((b) => (b.textContent ?? '').trim()));
drawerLabels.some((l) => /log out/i.test(l)) && drawerLabels.some((l) => /dashboard/i.test(l))
  ? ok('…and the drawer has them, which is where a signed-in account looks')
  : bad(`the drawer carries ${JSON.stringify(drawerLabels)}`);

await signedInPhone.close();

// ── 4b. The way BACK, which nothing here had ever asserted ───────────────
//
// ⚠️ This section exists because the check above passed while the defect was
// live, and it passed because of what it says rather than what it checks:
// "the phone header is not asked to carry Dashboard, List a room AND Log out"
// only ever looked for Log out. `.nav-inner.is-signed-in .nav-actions
// .btn-ghost { display: none }` hid every ghost action, Dashboard among them,
// and for a TENANT — whose only two actions are Dashboard and Log out — that
// left a header holding a logo and a burger.
//
// So a signed-in person who tapped "Browse rooms" from their own dashboard had
// no way back to it except opening the hamburger and finding Dashboard under
// six public links. Reported from a phone as "too much friction and bad UX",
// and the assertion that should have caught it was structurally incapable of
// seeing it — this codebase's own recurring defect, in a check.
//
// Both roles, because they render different branches of the same template and
// the tenant branch is the one with nothing to spare. 360px as well as 390,
// because 360 is where the landlord's Dashboard has to fit beside "+ List a
// room" and the burger.
//
// And it is CLICKED, not merely measured. A visible link that does not
// navigate is the exact fault class CLAUDE.md names.
for (const who of [
  { label: 'tenant', acct: tenant, home: '/tenant/dashboard' },
  { label: 'landlord', acct: landlord, home: '/landlord/dashboard' },
]) {
  for (const width of [360, 390, 768]) {
    const page = await signIn(browser, WEB, who.acct.email, PASSWORD, { width, height: 844 });
    await page.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);

    const state = await page.evaluate(() => {
      const vis = (el) => !!el && getComputedStyle(el).display !== 'none'
        && el.getBoundingClientRect().width > 0;
      const drawerOpen = !!document.querySelector('.nav-links.open');
      const home = [...document.querySelectorAll('.nav-actions .nav-home')].filter(vis);
      const box = home[0]?.getBoundingClientRect();
      return {
        drawerOpen,
        count: home.length,
        text: (home[0]?.textContent ?? '').trim(),
        href: home[0]?.getAttribute('href') ?? '',
        height: box ? Math.round(box.height) : 0,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    if (state.drawerOpen) {
      bad(`${who.label} at ${width}px: the drawer was already open, so this proves nothing`);
      await page.close();
      continue;
    }
    state.count === 1
      ? ok(`${who.label} at ${width}px: the header carries the way back ("${state.text}" → ${state.href}), drawer shut`)
      : bad(`${who.label} at ${width}px: ${state.count} visible route into the portal in the header — a signed-in account's only way back is the burger`);
    state.height >= 44
      ? ok(`…and it clears the 44px tap target (${state.height}px)`)
      : bad(`${who.label} at ${width}px: the way back is ${state.height}px tall — under WCAG 2.5.8`);
    state.overflow <= 0
      ? ok('…without pushing the page sideways')
      : bad(`${who.label} at ${width}px: keeping it in the header costs ${state.overflow}px of horizontal scroll`);

    // Does it actually go there.
    if (state.count === 1) {
      await page.locator('.nav-actions .nav-home').click();
      try {
        await page.waitForURL((u) => u.pathname === who.home, { timeout: 12000 });
        ok(`…and tapping it lands on ${who.home}`);
      } catch {
        bad(`${who.label} at ${width}px: tapping the way back left them on ${new URL(page.url()).pathname}`);
      }
    }
    await page.close();
  }
}

console.log('\n── 5. The footer offers a visitor nothing it cannot open ────');

const guarded = /^\/(landlord|tenant|account|admin)\//;
const visitorFooter = await browser.newPage({ viewport: DESKTOP });
await visitorFooter.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
await visitorFooter.waitForSelector('.footer-inner', { timeout: 20000 });
const visitorLinks = await visitorFooter.evaluate(() =>
  [...document.querySelectorAll('.footer-col a')].map((a) => ({
    text: (a.textContent ?? '').trim(), href: a.getAttribute('href') ?? '',
  })));

const leaks = visitorLinks.filter((l) => guarded.test(l.href));
leaks.length === 0
  ? ok(`a signed-out visitor is offered no guarded route (${visitorLinks.length} links checked)`)
  : bad(`the footer offers a visitor ${JSON.stringify(leaks)} — each one is a login form`);

const pricing = visitorLinks.filter((l) => l.href === '/pricing');
pricing.length === 1
  ? ok('…and Pricing is listed once, not in two columns')
  : bad(`Pricing appears ${pricing.length} time(s) in the visitor footer`);

// Reuses the desktop page signed in at the top rather than signing in again:
// /auth/login allows 30 per 15 minutes counted in memory, and this drive was
// spending eight of them, so two runs inside the window died on a sign-in that
// reads like an auth bug.
const landlordFooter = page;
await landlordFooter.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
await landlordFooter.waitForSelector('.footer-inner', { timeout: 20000 });
const lLinks = await landlordFooter.evaluate(() =>
  [...document.querySelectorAll('.footer-col a')].map((a) => ({
    text: (a.textContent ?? '').trim(), href: a.getAttribute('href') ?? '',
  })));

lLinks.some((l) => l.href === '/landlord/properties')
  ? ok('a signed-in landlord IS offered their own screens')
  : bad(`the landlord footer has no portal links: ${JSON.stringify(lLinks.map((l) => l.href))}`);
!lLinks.some((l) => /create account|post a room free/i.test(l.text))
  ? ok('…and is not offered a sign-up link they have already used')
  : bad('the footer still offers a signed-in landlord "Create account"');

console.log('\n── 6. Three widths, no sideways scroll ─────────────────────');

// One signed-in page, resized — three sign-ins here was most of the budget.
const widthPage = phone;
for (const [name, size] of [['phone (390px)', PHONE], ['tablet (768px)', TABLET], ['desktop (1280px)', DESKTOP]]) {
  const p = widthPage;
  await p.setViewportSize(size);
  for (const path of ['/', '/landlord/dashboard', '/landlord/properties', '/landlord/rooms/new']) {
    await p.goto(WEB + path, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2200);
    const overflow = await overflowOf(p);
    if (overflow > 1) { bad(`${path} overflows by ${overflow}px at ${name}`); }
  }
  ok(`${name}: no horizontal scroll on the board, the dashboard, properties or the wizard`);

  // The sidebar is a column on desktop and a row on a phone, and must be one
  // of the two — not absent, and not a column squeezed into 390px.
  await p.goto(`${WEB}/landlord/dashboard`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.portal-nav', { timeout: 20000 });
  const shape = await p.evaluate(() => {
    const nav = document.querySelector('.portal-nav');
    const r = nav.getBoundingClientRect();
    return { wide: r.width > window.innerWidth * 0.6, tall: r.height > 300 };
  });
  const wantRow = size.width <= 768;
  (wantRow ? shape.wide && !shape.tall : shape.tall && !shape.wide)
    ? ok(`…and the sidebar is ${wantRow ? 'a strip across the top' : 'a column beside the content'}`)
    : bad(`at ${name} the sidebar is shaped wrong: ${JSON.stringify(shape)}`);
}

await browser.close();
console.log(`\n${fail === 0 ? '✅ all checks passed' : `❌ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
