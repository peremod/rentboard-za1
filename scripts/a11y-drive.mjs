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
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/a11y-drive.mjs   # + admin
 *
 * Seven public pages plus the portal, which needs a landlord and a tenant
 * registered over the API. Needs the API on :3000 and rooms on the board.
 *
 * Exits non-zero on any skipped heading level or any unnamed control, so it
 * can be a gate. Skips with a clear message when the site is not running.
 */
import { registerUser, signIn, PASSWORD } from './lib/drive-session.mjs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * axe-core, read once and injected into each page.
 *
 * Checklist row 32: Lighthouse found two contrast failures on the live board
 * — the Gauteng badge at 2.86:1 and the board's rating at 2.81:1, where small
 * text needs 4.5:1 — and this drive could not see either, because it looked
 * at headings and names and never at colour. Fixing those two instances left
 * the class uncovered, and the row said so.
 *
 * Contrast is not a thing to reimplement. The ratio depends on what is behind
 * the text after every ancestor's background, opacity and gradient have
 * composited, which is why the two that shipped were both alpha over a card.
 * axe already does that properly, so this runs axe rather than a formula.
 */
const require = createRequire(import.meta.url);
let axeSource = null;
try {
  axeSource = readFileSync(require.resolve('axe-core'), 'utf8');
} catch {
  console.log('⏭  axe-core not installed — contrast will not be checked. npm install at the repo root.');
}

const BASE = (process.env.BASE_URL ?? 'http://localhost:4200').replace(/\/$/, '');
const API = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const WIDTH = Number(process.env.VIEWPORT_WIDTH ?? 412);

const PUBLIC_PAGES = [
  '/',
  '/how-it-works',
  '/pricing',
  '/advertise',
  '/legal/terms',
  '/legal/privacy',
  '/legal/paia',
];

/**
 * The portal, which this drive used to leave out.
 *
 * It said so, and the reason it gave was that a session is a different job —
 * which was true and was also the reason the portal had never been audited by
 * anything. Lighthouse cannot reach these pages either: every one of them
 * needs a login, so the four URLs it visits are all public. So nothing had
 * ever looked at the screens people actually spend time in, and the h1 → h3
 * heading skip we fixed on the public board still existed on every one of
 * them, because the section titles were styled divs rather than headings.
 *
 * The accounts are registered over the API and signed in through the form,
 * using the same helper as scripts/phase-drive.mjs.
 */
const LANDLORD_PAGES = ['/landlord/dashboard', '/landlord/yard', '/landlord/verification', '/account/settings'];
const TENANT_PAGES = ['/tenant/dashboard', '/tenant/rent', '/tenant/passport'];
const ADMIN_PAGES = [
  '/admin/dashboard',
  '/admin/verifications',
  '/admin/reports',
  '/admin/disputes',
  '/admin/advertising',
  '/admin/referrals',
  '/admin/analytics',
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

/**
 * Audit one URL on a page that may already carry a session.
 *
 * `close` is false for the portal passes: they reuse one signed-in page across
 * several URLs, because signing in once per screen is seven logins to audit
 * seven screens.
 */
async function auditPage(page, path, { close = true } = {}) {
  let status = 0;
  try {
    const res = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
    status = res?.status() ?? 0;
    // Park the pointer in the corner before measuring anything.
    //
    // The pointer stays where it was last clicked, and signIn() clicks a
    // submit button — so on the next page whatever sits under that coordinate
    // is in :hover. That made the contrast check report a landlord button at
    // 3.55:1 on one run and not the next, depending on layout. A check whose
    // result depends on where the mouse happened to stop is worse than no
    // check: it produces findings nobody can reproduce.
    //
    // Hover contrast is still worth auditing; it just cannot be audited by
    // accident. Measure the resting state here, deliberately.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(1200);
  } catch (err) {
    failures.push(`${path}: did not load (${err.message})`);
    if (close) await page.close();
    return;
  }

  console.log(`\n=== ${path} (${status}) ===`);

  // A portal URL that 404s is not an accessibility pass. The not-found page has
  // a perfectly good heading outline, so without this a route that does not
  // exist — or a guard that redirects the wrong way — reads as green.
  if (status !== 200) {
    failures.push(`${path}: answered ${status}, not 200 — the page under audit did not render`);
  }

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

  // ── Colour contrast, measured by axe against the composited page ────────
  //
  // Only the `color-contrast` rule, deliberately. Turning on axe's full
  // ruleset here would surface dozens of findings at once, and a gate that is
  // red on the day it lands is a gate someone turns off. Widening it is a
  // decision to take with the findings in hand, not a default to inherit.
  if (axeSource) {
    try {
      await page.evaluate(axeSource);
      const contrast = await page.evaluate(async () => {
        const run = await window.axe.run(document, {
          runOnly: { type: 'rule', values: ['color-contrast'] },
          resultTypes: ['violations'],
        });
        return run.violations.flatMap((v) =>
          v.nodes.map((n) => {
            // axe puts the measured ratio and the threshold in the check's
            // own data, which is the part worth printing: "2.86:1, needs
            // 4.5:1" is actionable, "insufficient contrast" is not.
            const d = n.any?.[0]?.data ?? {};
            return {
              target: Array.isArray(n.target) ? n.target.join(' ') : String(n.target),
              ratio: d.contrastRatio ?? null,
              needs: d.expectedContrastRatio ?? null,
              fg: d.fgColor ?? '',
              bg: d.bgColor ?? '',
              text: (n.html ?? '').replace(/\s+/g, ' ').slice(0, 60),
            };
          }),
        );
      });

      if (!contrast.length) {
        console.log('  ✅ contrast: every visible text node meets its WCAG threshold');
      } else {
        console.log(`  contrast: ${contrast.length} below threshold`);
        for (const c of contrast) {
          const measured = c.ratio ? `${c.ratio}:1` : 'below';
          const required = c.needs ? `, needs ${c.needs}` : '';
          console.log(`    ❌ ${c.target} — ${measured}${required}  ${c.fg} on ${c.bg}  ${clip(c.text)}`);
          failures.push(`${path}: contrast ${measured}${required} at ${c.target}`);
        }
      }
    } catch (err) {
      // A thrown axe is not a pass. It used to be possible to lose this
      // silently by catching and continuing.
      console.log(`    ❌ contrast check did not run: ${err.message}`);
      failures.push(`${path}: the contrast check itself failed — ${err.message}`);
    }
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

  if (close) await page.close();
}

// ── public pages, no session ───────────────────────────────────────────────
for (const path of PUBLIC_PAGES) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 823 } });
  await auditPage(page, path);
}

// ── the portal, which needs one ────────────────────────────────────────────
//
// Skipped loudly rather than silently when there is no API to register
// against. A drive that quietly audits seven pages instead of seventeen and
// still prints a tick is how the room card went unchecked for four releases.
let portalPages = 0;
const apiReachable = await fetch(`${API}/health`, { signal: AbortSignal.timeout(4000) })
  .then((r) => r.ok)
  .catch(() => false);

if (!apiReachable) {
  console.log(`\n⏭  SKIP the portal — no API on ${API} to register a landlord and a tenant against.`);
  failures.push(`the portal was not audited: no API on ${API}`);
} else {
  const stamp = Date.now();
  for (const [role, pages] of [
    ['LANDLORD', LANDLORD_PAGES],
    ['TENANT', TENANT_PAGES],
  ]) {
    let session;
    try {
      const user = await registerUser(API, role, stamp);
      session = await signIn(browser, BASE, user.email, PASSWORD, { width: WIDTH });
    } catch (err) {
      if (err.buildOverlay) {
        console.log('\n⏭  the dev server is showing a build error overlay — fix the build and re-run.');
        await browser.close();
        process.exit(2);
      }
      failures.push(`${role.toLowerCase()} portal: could not sign in (${err.message})`);
      continue;
    }
    for (const path of pages) {
      await auditPage(session, path, { close: false });
      portalPages++;
    }
    await session.close();
  }

  // The admin screens carry the densest tables in the product and the least
  // traffic, which is exactly the combination nobody notices.
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    let session;
    try {
      session = await signIn(browser, BASE, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, { width: WIDTH });
      for (const path of ADMIN_PAGES) {
        await auditPage(session, path, { close: false });
        portalPages++;
      }
      await session.close();
    } catch (err) {
      failures.push(`admin portal: could not sign in (${err.message})`);
    }
  } else {
    console.log('\n⏭  SKIP the admin screens — set ADMIN_EMAIL and ADMIN_PASSWORD to include them.');
  }
}

await browser.close();

console.log('');
if (failures.length) {
  console.log(`❌ ${failures.length} accessibility failure(s):`);
  failures.forEach((f) => console.log('   • ' + f));
  process.exit(1);
}
console.log(
  `✅ ${PUBLIC_PAGES.length} public + ${portalPages} portal pages: ` +
    'heading order intact, every control named' +
    // Named separately rather than folded into "accessible": a summary that
    // claims more than the run checked is how row 32 happened in the first
    // place — the drive reported green while looking at no colour at all.
    (axeSource ? ', every text node over its contrast threshold.' : '. Contrast NOT checked — axe-core missing.'),
);
