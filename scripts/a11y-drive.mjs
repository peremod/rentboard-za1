#!/usr/bin/env node
/**
 * Accessibility, driven in a real browser rather than read off the source.
 *
 * Two things this catches that nothing else in the repo does:
 *
 *  1. Lighthouse only visits four public URLs, because every portal page needs
 *     a session. So the tenant and landlord screens — the ones people spend
 *     actual time in — have never been audited for heading order or accessible
 *     names. This walks the public pages that Lighthouse skips too.
 *  2. Whether a control HAS a name is a DOM question, not a template question.
 *     A `<label for>` that points at the wrong id, an aria-label the translate
 *     pipe never resolved, a heading that is only skipped on a phone because
 *     the drawer above it is off-canvas: all of those compile, and all of them
 *     read correctly in the source.
 *
 * Measured with textContent, not innerText. innerText returns '' for anything
 * not rendered — the filter drawer is closed by default — and an earlier
 * version of this check read innerText and so reported two correctly labelled
 * selects as unlabelled. A measurement trap worth keeping a comment on.
 *
 *   node scripts/a11y-drive.mjs                     # against localhost:4200
 *   BASE_URL=http://localhost:4000 node scripts/a11y-drive.mjs
 *
 * Exits non-zero on any skipped heading level or any unnamed control, so it
 * can be a gate. Skips with a clear message when the site is not running.
 */
const BASE = (process.env.BASE_URL ?? 'http://localhost:4200').replace(/\/$/, '');
const WIDTH = Number(process.env.VIEWPORT_WIDTH ?? 412);

// Public pages only. Adding the portal screens means a logged-in session, and
// a script that seeds a tenant is a different job from this one — the portal
// pages are driven by scripts/smoke-test.sh and the feature drives instead.
const PAGES = [
  '/',
  '/how-it-works',
  '/pricing',
  '/advertise',
  '/legal/terms',
  '/legal/privacy',
  '/legal/paia',
];

let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch {
  console.log('⏭  @playwright/test not installed — run this from a checkout with frontend deps.');
  process.exit(0);
}

try {
  const probe = await fetch(BASE + '/', { signal: AbortSignal.timeout(5000) });
  if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
} catch (err) {
  console.log(`⏭  ${BASE} is not answering (${err.message}) — start the frontend first.`);
  process.exit(0);
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const failures = [];

/** A card's visible text is a paragraph; the failure line has to stay readable. */
const clip = (text) => (text.length > 70 ? text.slice(0, 70) + '…' : text);
const locate = (c) => (c.cls ? '.' + c.cls : c.href ? `[href="${c.href}"]` : '(no class)');

for (const path of PAGES) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 823 } });
  let status = 0;
  try {
    const res = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
    status = res?.status() ?? 0;
    await page.waitForTimeout(1200);
  } catch (err) {
    failures.push(`${path}: did not load (${err.message})`);
    await page.close();
    continue;
  }

  console.log(`\n=== ${path} (${status}) ===`);

  // Only headings a sighted visitor can see. checkVisibility with
  // visibilityProperty, NOT offsetParent: the filter drawer is `position:
  // fixed; visibility: hidden` until opened, and offsetParent is non-null for
  // a child of a fixed element — so an offsetParent test counted the drawer's
  // h2 as visible, agreed with itself that the outline was fine, and missed
  // the exact skipped level Lighthouse was failing on. Found by reintroducing
  // the bug on purpose and watching this check stay green.
  const heads = await page.locator('h1,h2,h3,h4,h5,h6').evaluateAll((els) =>
    els
      .filter((e) => e.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }))
      .map((e) => ({ tag: e.tagName, text: (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 44) })),
  );

  let prev = 0;
  const skips = [];
  for (const h of heads) {
    const lvl = Number(h.tag[1]);
    if (prev && lvl > prev + 1) skips.push(`${h.tag} after H${prev} ("${h.text}")`);
    prev = lvl;
  }
  console.log('  headings:', heads.map((h) => h.tag).join(' → ') || '(none)');
  if (!heads.length || heads[0].tag !== 'H1') failures.push(`${path}: first visible heading is ${heads[0]?.tag ?? 'none'}, not H1`);
  if (skips.length) {
    console.log('  ⚠️  skipped levels: ' + skips.join(' | '));
    failures.push(`${path}: heading order — ${skips.join('; ')}`);
  } else {
    console.log('  ✅ no skipped heading levels');
  }

  // Every control that carries a value someone has to identify.
  const controls = await page.locator('select,input,textarea,button,a[href]').evaluateAll((els) =>
    els.map((e) => {
      const tag = e.tagName.toLowerCase();
      // A form control does NOT take its name from its content. A <select>'s
      // textContent is the concatenation of every option, so counting it as a
      // name made a select with no label at all look labelled — which is how
      // an earlier version of this check passed a select I had deliberately
      // stripped the aria-label from.
      const namedByContent = tag === 'button' || tag === 'a';
      const name =
        e.getAttribute('aria-label') ||
        (e.getAttribute('aria-labelledby')
          ? (document.getElementById(e.getAttribute('aria-labelledby'))?.textContent ?? '').trim()
          : '') ||
        (e.labels?.length ? (e.labels[0].textContent ?? '').trim() : '') ||
        (namedByContent ? (e.textContent ?? '').replace(/\s+/g, ' ').trim() : '') ||
        e.getAttribute('title') ||
        e.getAttribute('placeholder') ||
        '';
      return {
        tag,
        cls: e.className && typeof e.className === 'string' ? e.className.split(' ')[0] : '',
        // A card link carries no class of its own, so `.` was the whole
        // locator in the failure output. The href identifies it.
        href: e.getAttribute('href') ?? '',
        type: e.getAttribute('type') ?? '',
        visible: e.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }),
        hidden: e.getAttribute('aria-hidden') === 'true',
        name,
        // WCAG 2.5.3: a voice-control user says what they can see, so the
        // accessible name has to contain the visible text.
        visibleText: (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
        ariaLabel: e.getAttribute('aria-label') ?? '',
      };
    }),
  );

  const unnamed = controls.filter(
    (c) => !c.hidden && !c.name && !(c.tag === 'input' && ['hidden', 'submit'].includes(c.type)),
  );
  // WCAG 2.5.3 only applies where the accessible name comes FROM the content:
  // a button or a link. A <select>'s textContent is the concatenation of its
  // options, which is not visible text, and an icon-only control ("☰", "✕")
  // has no text at all — the first version of this check flagged eleven of
  // both and none of them was a bug. Letters and digits only, same as axe.
  const namesFromContent = new Set(['button', 'a']);
  const mismatched = controls.filter((c) => {
    if (!namesFromContent.has(c.tag) || !c.ariaLabel) return false;
    const visible = c.visibleText.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!visible) return false;
    return !c.ariaLabel.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().includes(visible);
  });

  console.log(`  controls: ${controls.length} — ${unnamed.length} unnamed, ${mismatched.length} name/text mismatch`);
  for (const c of unnamed) {
    console.log(`    ❌ <${c.tag}${c.type ? ' type=' + c.type : ''}> ${locate(c)}${c.visible ? '' : ' (hidden)'} has no accessible name`);
    failures.push(`${path}: <${c.tag}> ${locate(c)} has no accessible name`);
  }
  for (const c of mismatched) {
    // Worded as what it costs, not as the rule number. An aria-label REPLACES
    // the content it sits on, so text missing from the name is text a
    // screen-reader user is not told about at all — which is the finding, and
    // WCAG 2.5.3 is the reason it is a failure rather than a preference.
    console.log(`    ❌ <${c.tag}> ${locate(c)}: aria-label "${c.ariaLabel}" hides visible text "${clip(c.visibleText)}"`);
    failures.push(`${path}: <${c.tag}> ${locate(c)} aria-label hides its own visible text`);
  }

  // The board with rooms on it is the state that hid two real defects for
  // four releases: the room card's h3 followed the hero's h1 with no h2
  // between them, and the card's aria-label replaced everything the card
  // shows. Nothing here could see either one, because no check had ever
  // loaded this page with a single room on it — CI's Lighthouse run has no
  // API, and a fresh database has no listings. A drive that reads the empty
  // state and reports seven green pages is the same as no drive at all.
  if (path === '/') {
    const cards = await page.locator('app-room-card').count();
    console.log(`  room cards on the board: ${cards}`);
    if (cards === 0) {
      failures.push(
        '/: the board had no rooms, so the room card was never checked — ' +
          'seed them (SEED_DEMO_ROOMS=true npx ts-node prisma/seed.ts) and run this again',
      );
    }
  }

  await page.close();
}

await browser.close();

console.log('');
if (failures.length) {
  console.log(`❌ ${failures.length} accessibility failure(s):`);
  failures.forEach((f) => console.log('   • ' + f));
  process.exit(1);
}
console.log(`✅ ${PAGES.length} pages: heading order intact, every control named.`);
