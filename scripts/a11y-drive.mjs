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
import { registerUser, apiCall, signIn, PASSWORD, dbQuery as q } from './lib/drive-session.mjs';
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
/**
 * ⚠️ Known horizontal overflow, listed by route in scripts/overflow-baseline.json.
 *
 * The check below was added on 14 October and found three pre-existing
 * defects on top of the two it was written for. They are real and they are
 * named rather than silenced: a route not in this file fails, and a route in
 * it prints a reminder every run. The list may only shrink.
 *
 * This is a ratchet, not an allowlist — the distinction this repository keeps
 * arriving at is that an allowlist absorbs new defects quietly, and a ratchet
 * refuses them while admitting the ones already shipped.
 */
const OVERFLOW_BASELINE = JSON.parse(
  readFileSync(new URL('./overflow-baseline.json', import.meta.url), 'utf8'),
);

const WIDTH = Number(process.env.VIEWPORT_WIDTH ?? 412);

const PUBLIC_PAGES = [
  '/',
  '/how-it-works',
  '/pricing',
  '/advertise',
  '/legal/terms',
  '/legal/privacy',
  '/legal/paia',
  // Phase 7g. Added with the page itself, because it is a form a person fills
  // in on a phone with one hand — label association and target size are the
  // whole experience, not a detail.
  //
  // ⚠️ The REST of /auth is still unaudited: /login, /register,
  // /forgot-password and /reset-password have never been through this drive,
  // and they share this page's card markup. Named rather than quietly left out.
  '/auth/register-phone',
  // Phase 6. The page an applicant reads before deciding whether to pay a
  // deposit to somebody who may not be allowed to let them the room.
  '/legal/sublet',
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
const LANDLORD_PAGES = [
  '/landlord/dashboard', '/landlord/yard', '/landlord/verification',
  '/landlord/services', '/landlord/public-page', '/account/settings',
  // Phase 7b. The list a landlord lands on from the nav, and the detail view
  // behind a card — both new, both forms, both on a phone.
  '/landlord/properties',
  // Phase 7g. For an account with no email address this screen is the only
  // place a notification can be read, so it is not a page that may quietly
  // regress.
  '/account/notices',
  // Phase 7c. The portfolio-wide applicants list — four native selects and a
  // list of rows, on a phone, which is where a filter bar either works or
  // becomes four full-width dropdowns nobody can tell apart.
  '/landlord/applicants',
  // Phase 7c. The unified inbox, where each row is a real <button> rather than
  // a clickable div precisely so it can be reached by keyboard — exactly the
  // thing this drive is for.
  '/account/messages',
  // Phase 7d. The detail view for the rooms in no property — the screen a
  // landlord who never grouped anything reaches their rent through. The seed
  // below leaves this account with exactly that shape.
  '/landlord/properties/ungrouped',
  // Phase 7g. A column of explanation and three controls, one of them
  // irreversible — the contrast of the danger button and the association
  // between the tick box and the sentence beside it are the whole safety of
  // the screen, not a detail of it.
  '/account/close',
  // Phase F. The archive. Every row is a real <button> whose whole head is the
  // target, and the record it opens is six tables of dense text — a definition
  // list, a month ledger, star ratings — which is where contrast and heading
  // order go wrong quietly.
  '/account/tenancies',
];
const TENANT_PAGES = [
  '/tenant/dashboard', '/tenant/rent', '/tenant/passport',
  // Phase 6. A four-step form filled in on a phone — label association and
  // target size are the whole experience here, not a detail.
  '/tenant/sublet/new',
  // Phase 7c. The same inbox from the other side — the sidebar differs, so the
  // page is not the same page.
  '/account/messages',
  // Phase F. The archive from the tenant's side. Same reasoning as the inbox:
  // the sidebar differs, so it is not the same page — and this screen is one
  // list for both roles precisely because a sub-lessor is both at once.
  '/account/tenancies',
];
const ADMIN_PAGES = [
  '/admin/dashboard',
  '/admin/verifications',
  '/admin/reports',
  '/admin/disputes',
  '/admin/advertising',
  '/admin/referrals',
  '/admin/services',
  '/admin/surveys',
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

/** `rgb()`/`rgba()` as the browser always reports it. */
function parseColour(css) {
  const m = String(css).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
}

/** WCAG relative luminance and the 1.4.3 ratio. Solid colours only. */
function contrastRatio(fg, bg) {
  const lum = ({ r, g, b }) =>
    [r, g, b]
      .map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}
const locate = (c) => (c.cls ? '.' + c.cls : c.href ? `[href="${c.href}"]` : '(no class)');

/**
 * Screens that render their subject COLLAPSED — opened before measuring.
 *
 * ⚠️ §67 ended with the applicant action row still uncovered: reverting its
 * fix did not fail this drive, because `.applicant-card__actions` is not in
 * the DOM at all until a card is expanded, and the screenshot that reported
 * the bug was of an expanded card. A fixture can supply a missing RECORD; it
 * cannot supply a missing INTERACTION.
 *
 * ⚠️ A reveal that silently does nothing is the §67 seed failure again — a
 * check that passes for free. So each one reports why it could not open, and
 * that is a FAILURE, not a skip: everything inside the card would otherwise
 * be audited as absent and reported clean.
 */
/**
 * ⚠️ Counted, not asserted per route.
 *
 * The action row is correctly ABSENT on an accepted, rejected or withdrawn
 * application — one of the two fixture rooms has an accepted applicant,
 * because it exists to produce a finished tenancy. So requiring the row on
 * every applicants route failed a correct screen. What has to hold is that
 * the row was on screen SOMEWHERE while the measurements ran; that is
 * asserted once, at the end, where it can still fail.
 */
let applicantsRoutes = 0;
let actionRowsSeen = 0;
let shortlistControlsSeen = 0;

const REVEAL = [
  {
    match: /^\/landlord\/rooms\/[^/]+\/applicants$/,
    what: 'the first applicant card',
    async open(page) {
      applicantsRoutes++;
      const header = page.locator('.applicant-card__header').first();
      if (!(await header.count())) return 'no applicant card rendered';
      await header.click();
      await page.waitForTimeout(700);
      if (!(await page.locator('.applicant-card__body').count())) {
        return 'the card did not open';
      }
      if (await page.locator('.applicant-card__actions').count()) actionRowsSeen++;
      // The control the defect was reported on, by its words.
      if (await page.locator('.applicant-card__actions button', { hasText: /shortlist/i }).count()) {
        shortlistControlsSeen++;
      }
      return null;
    },
  },
];

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

  const reveal = REVEAL.find((r) => r.match.test(path));
  if (reveal) {
    const why = await reveal.open(page).catch((err) => err.message);
    if (why) {
      failures.push(
        `${path}: could not open ${reveal.what} — ${why}. Everything inside it was `
        + 'audited as absent, which reads as clean',
      );
    } else {
      console.log(`  \u21b3 opened ${reveal.what} before measuring`);
    }
    // The click leaves the pointer on the header, and :hover changes colours.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
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
  /**
   * ⚠️ HORIZONTAL OVERFLOW. CLAUDE.md requires checking for "horizontal page
   * scroll ... and text that becomes a single line hundreds of characters
   * wide" at every width, and nothing in this repository did. mobile-drive.mjs
   * is a regression suite for five specific reported bugs; it never measures
   * width.
   *
   * Two defects reached a phone on 14 October, both from the same cause -
   * `:where(button)` sets `white-space: nowrap`, which is right for a short
   * label and wrong for a button wrapping prose. "Remove from shortlist" spilled
   * past its own borders, and the archive card's header clipped at both edges:
   * the state pill read "TING", the title lost its first word.
   *
   * Measured per element, not just on the document, because neither of those
   * produced a page-level scrollbar - the overflow was clipped inside a card.
   * A document-level check would have passed on both.
   */
  const overflow = await page.evaluate(() => {
    const docScroll = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const clipped = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'contents') continue;
      // Deliberately scrollable regions opt out by saying so.
      if (/auto|scroll/.test(cs.overflowX)) continue;
      // ⚠️ The visually-hidden pattern is a 1px box that deliberately clips its
      // own text so a screen reader still reads it. Reporting it was this
      // check's first false positive: surveys.ts's <caption class="sr-only">
      // "spilled" 604px, which is the pattern working. Detected by shape
      // rather than class name, so a differently-named utility is covered too.
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      const spill = el.scrollWidth - el.clientWidth;
      if (spill <= 1) continue;
      // Only leaf-ish text: a wrapper inherits its child's spill and would
      // report the same defect several times up the tree.
      if (!el.textContent.trim()) continue;
      if ([...el.children].some((c) => c.scrollWidth - c.clientWidth > 1)) continue;
      clipped.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.'),
        spill,
        text: el.textContent.trim().slice(0, 48),
      });
    }
    return { docScroll, clipped: clipped.slice(0, 6) };
  });
  const known = OVERFLOW_BASELINE[path];
  if (overflow.docScroll > 1) {
    if (known?.docScroll >= overflow.docScroll) {
      console.log(`  ⏳ known: scrolls sideways by ${overflow.docScroll}px — ${known.why}`);
    } else {
      console.log(`  ⚠️  the page scrolls sideways by ${overflow.docScroll}px`);
      failures.push(`${path}: horizontal page scroll of ${overflow.docScroll}px at ${WIDTH}px`);
    }
  }
  if (overflow.clipped.length) {
    const allowed = new Set(known?.elements ?? []);
    const fresh = overflow.clipped.filter((c) => !allowed.has(c.cls || c.tag));
    for (const c of overflow.clipped) {
      const tag = fresh.includes(c) ? '⚠️  clipped' : '⏳ known';
      console.log(`  ${tag}: <${c.tag}${c.cls ? '.' + c.cls : ''}> spills ${c.spill}px — "${c.text}"`);
    }
    if (fresh.length) {
      failures.push(
        `${path}: ${fresh.length} element(s) wider than their box at ${WIDTH}px `
        + `(${fresh.map((c) => c.cls || c.tag).join(', ')})`,
      );
    }
  } else if (overflow.docScroll <= 1) {
    console.log('  ✅ nothing overflows its box, and the page does not scroll sideways');
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
        });
        // ⚠️ `incomplete`, not just `violations`, and the reason is the whole
        // defect this line was added for.
        //
        // axe does NOT report text the same colour as its background as a
        // violation. It buckets it as INCOMPLETE with
        // messageKey 'equalRatio' — "Element has a 1:1 contrast ratio with the
        // background" — on the theory that identical colours usually mean a
        // background image or a gradient it could not resolve, so a human
        // should look.
        //
        // So the single worst contrast failure there is, text that cannot be
        // seen at all, was the one case this drive could not see. It printed
        // "✅ contrast: every visible text node meets its WCAG threshold" on
        // ten screens where the hint panel's only button was white-on-white at
        // 1.00:1, and a person on a phone reported it as "a big button with no
        // text". The hover/focus pass below is what eventually caught it, and
        // it reported a RESTING-state fault under the label ':hover', which
        // sent the first look at it in the wrong direction.
        //
        // Only 'equalRatio' is promoted. The other incomplete reasons really
        // are "axe could not tell" — text over a background image, a gradient,
        // a video — and failing those would make this gate red on things it
        // has not actually measured. Identical colours are not an edge case:
        // whatever is behind the text, the text is the same colour as it.
        const promoted = run.incomplete.flatMap((v) => ({
          ...v,
          nodes: v.nodes.filter((n) =>
            [...(n.any ?? []), ...(n.none ?? []), ...(n.all ?? [])]
              .some((c) => c?.data?.messageKey === 'equalRatio'),
          ),
        })).filter((v) => v.nodes.length);

        return [...run.violations, ...promoted].flatMap((v) =>
          v.nodes.map((n) => {
            // axe puts the measured ratio and the threshold in the check's
            // own data, which is the part worth printing: "2.86:1, needs
            // 4.5:1" is actionable, "insufficient contrast" is not.
            // Across `any`, `none` and `all`, because a promoted incomplete
            // does not necessarily carry its data in the same bucket a
            // violation does — and reading only `any` would print a finding
            // with no ratio and no colours on it, which is the half of the
            // line that makes it actionable.
            const d = [...(n.any ?? []), ...(n.none ?? []), ...(n.all ?? [])]
              .map((c) => c?.data).find((x) => x && x.contrastRatio !== undefined) ?? {};
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
        // Grouped by the colour pair and the class that carries it, not
        // listed per node. One CSS rule on the admin reports screen produced
        // 28 identical lines differing only by :nth-child, which buries the
        // finding in its own repetitions — and there is one thing to fix, not
        // 28. The count is kept so the scale is still visible.
        const groups = new Map();
        for (const c of contrast) {
          // The last class in the selector is the rule worth naming.
          const rule = (c.target.split(/\s+/).pop() ?? c.target).replace(/:nth-child\(\d+\)/g, '');
          const key = `${rule}|${c.fg}|${c.bg}|${c.ratio}`;
          if (!groups.has(key)) groups.set(key, { ...c, rule, count: 0 });
          groups.get(key).count++;
        }
        console.log(`  contrast: ${contrast.length} below threshold in ${groups.size} rule(s)`);
        for (const c of groups.values()) {
          const measured = c.ratio ? `${c.ratio}:1` : 'below';
          const required = c.needs ? `, needs ${c.needs}` : '';
          const times = c.count > 1 ? ` ×${c.count}` : '';
          console.log(`    ❌ ${c.rule}${times} — ${measured}${required}  ${c.fg} on ${c.bg}  ${clip(c.text)}`);
          failures.push(`${path}: contrast ${measured}${required} at ${c.rule}${times}`);
        }
      }
    } catch (err) {
      // A thrown axe is not a pass. It used to be possible to lose this
      // silently by catching and continuing.
      console.log(`    ❌ contrast check did not run: ${err.message}`);
      failures.push(`${path}: the contrast check itself failed — ${err.message}`);
    }
  }

  // ── Hover and focus, which the parked pointer stopped measuring ──────────
  //
  // Row 36's open half. Parking the pointer made the resting-state audit
  // reproducible and, in the same move, removed the only thing that had ever
  // looked at :hover — and what it had found there was real: every primary
  // button in the app sat at 3.56:1 while a pointer was over it, because hover
  // LIGHTENED the background under white text. That was discovered by accident,
  // which is not a plan.
  //
  // axe cannot be pointed at a pseudo-class, so this drives the states: hover
  // each control, read what the browser computed, and do the ratio. Solid
  // backgrounds only — a semi-transparent hover would need the compositing axe
  // does properly, and reporting a wrong number is worse than reporting none,
  // so those are counted and named rather than guessed at.
  //
  // The hover half is driven from here, not from inside the page. The first
  // version dispatched a synthetic PointerEvent and read the computed style,
  // which cannot work: CSS :hover follows the browser's real pointer position,
  // and a dispatched event does not move it. It reported every page green with
  // the 3.56:1 hover colour deliberately restored — a check that passes while
  // the bug it exists for is present. Found by reverting --terra-deep and
  // watching it stay ✅.
  //
  // :focus is different — el.focus() is real state — so that half stayed in
  // the page where it is cheaper.
  // One control per CSS signature, not the first N.
  //
  // This capped at the first 24 elements, which on the board meant two thirds
  // of 76 controls were never hovered — and, worse, the 24 were whatever
  // happened to come first in the DOM, so coverage depended on layout order.
  // What actually needs testing is each distinct rule, since a colour pair
  // comes from a class and not from an instance; that is the same lesson as
  // the status pills, where 28 nodes were one defect. Sampling by signature
  // covers every rule on the page and usually costs fewer hovers.
  const allTargets = await page.locator('button:visible, a[href]:visible').elementHandles();
  const bySignature = new Map();
  for (const handle of allTargets) {
    const signature = await handle.evaluate((el) =>
      `${el.tagName}.${(typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).sort().join('.')}`,
    );
    if (!bySignature.has(signature)) bySignature.set(signature, handle);
  }
  const hoverTargets = [...bySignature.values()];
  const hoverFindings = [];
  let hoverSkipped = 0;

  for (const handle of hoverTargets) {
    try {
      await handle.hover({ timeout: 1500, force: true });
    } catch {
      continue; // off-screen or covered; not a finding
    }
    // Let the transition finish before reading. `.btn` carries
    // `transition: all .15s`, and getComputedStyle returns the value as it is
    // animating — so reading immediately after hover returns the colour the
    // button is leaving, not the one it is arriving at. That made this check
    // report every page green with the 3.56:1 hover colour deliberately
    // restored, which is also why the defect was originally found by accident:
    // the pointer had been resting on that button, long past .15s.
    await page.waitForTimeout(220);
    const seenNow = await handle.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        color: cs.color,
        background: cs.backgroundColor,
        fontSize: parseFloat(cs.fontSize),
        bold: Number(cs.fontWeight) >= 700,
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 44),
        cls: el.className && typeof el.className === 'string'
          ? el.className.split(' ').filter(Boolean)[0] ?? el.tagName.toLowerCase()
          : el.tagName.toLowerCase(),
        // Resolve a fully transparent background to the first painted ancestor.
        behind: (() => {
          for (let p = el.parentElement; p; p = p.parentElement) {
            const b = getComputedStyle(p).backgroundColor;
            const m = b.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
            if (m && (m[4] === undefined || +m[4] === 1)) return b;
            if (m && +m[4] > 0) return null;
          }
          return null;
        })(),
      };
    });
    const f = parseColour(seenNow.color);
    let b = parseColour(seenNow.background);
    if (b && b.a === 0) b = seenNow.behind ? parseColour(seenNow.behind) : null;
    if (!f || !b || b.a < 1) { hoverSkipped++; continue; }
    if (!/[a-z0-9]/i.test(seenNow.text)) continue;

    const needs = seenNow.fontSize >= 24 || (seenNow.bold && seenNow.fontSize >= 18.66) ? 3 : 4.5;
    const r = contrastRatio(f, b);
    if (r < needs) {
      hoverFindings.push({
        state: 'hover', text: seenNow.text, ratio: r.toFixed(2), needs,
        fg: seenNow.color, bg: seenNow.background === 'rgba(0, 0, 0, 0)' ? seenNow.behind : seenNow.background,
        cls: seenNow.cls,
      });
    }
  }
  await page.mouse.move(0, 0);

  const states = await page.evaluate(async () => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
      return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
    };
    const lum = ({ r, g, b }) =>
      [r, g, b]
        .map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (fg, bg) => {
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      return (hi + 0.05) / (lo + 0.05);
    };

    const findings = [];
    let skipped = 0;
    const controls = [...document.querySelectorAll('button, a[href]')].filter((el) =>
      el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }),
    );

    for (const el of controls.slice(0, 40)) {
      // Focus only. Hover is driven by the real pointer, above — a dispatched
      // event does not move it and so never triggers CSS :hover.
      for (const state of ['focus']) {
        el.focus();

        const cs = getComputedStyle(el);
        const fg = parse(cs.color);

        // A fully transparent background is not unmeasurable — the text simply
        // sits on whatever is behind it, so walk up to the first ancestor that
        // paints. The first version skipped these and reported 44 of 71
        // controls unmeasured, which is a blind spot larger than the thing it
        // was checking: every link on the page has no background of its own.
        //
        // Partial alpha is different and is still skipped: blending 0 < a < 1
        // correctly is what axe does properly, and a wrong ratio reported
        // confidently is worse than an honest gap.
        let bg = parse(cs.backgroundColor);
        if (bg && bg.a === 0) {
          bg = null;
          for (let p = el.parentElement; p; p = p.parentElement) {
            const pb = parse(getComputedStyle(p).backgroundColor);
            if (pb && pb.a === 1) { bg = pb; break; }
            if (pb && pb.a > 0) break; // translucent ancestor — needs real compositing
          }
          if (!bg) { skipped++; continue; }
        }
        if (!fg || !bg) continue;
        if (bg.a < 1) { skipped++; continue; }

        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!/[a-z0-9]/i.test(text)) continue;

        // 4.5:1 for normal text; 3:1 once it is 24px, or 18.66px and bold.
        const px = parseFloat(cs.fontSize);
        const bold = Number(cs.fontWeight) >= 700;
        const needs = px >= 24 || (bold && px >= 18.66) ? 3 : 4.5;
        const r = ratio(fg, bg);
        if (r < needs) {
          findings.push({
            state, text: text.slice(0, 44), ratio: r.toFixed(2), needs,
            fg: cs.color, bg: cs.backgroundColor,
            cls: (el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName.toLowerCase()),
          });
        }
        el.blur();
      }
    }
    return { findings, skipped, checked: controls.length };
  });

  const seen = new Set();
  const unique = [...hoverFindings, ...states.findings].filter((f) => {
    const key = `${f.state}|${f.cls}|${f.ratio}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!unique.length) {
    console.log(
      `  ✅ hover/focus: ${hoverTargets.length} distinct control styles hovered + ${states.checked} focused, all over threshold` +
        (states.skipped + hoverSkipped ? ` (${states.skipped + hoverSkipped} translucent, not measurable here)` : ''),
    );
  } else {
    console.log(`  hover/focus: ${unique.length} below threshold`);
    for (const f of unique) {
      console.log(`    ❌ :${f.state} .${f.cls} — ${f.ratio}:1, needs ${f.needs}  ${f.fg} on ${f.bg}  "${f.text}"`);
      failures.push(`${path}: :${f.state} contrast ${f.ratio}:1 (needs ${f.needs}) on .${f.cls}`);
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
  try {
    await auditPage(page, path);
  } catch (err) {
    failures.push(`${path}: the audit could not complete (${err.message})`);
    await page.close().catch(() => {});
  }
}

/**
 * A real room page, found by following the first card on the board.
 *
 * It cannot be a fixed path — a room's URL carries its id — which is exactly
 * why it had never been audited. The room detail page is the most-read page on
 * the site after the board, carries the apply form, the landlord's verified
 * badge and now the shared-living section, and nothing had ever looked at its
 * heading order or its colours. The same shape of gap as the seven admin
 * screens in checklist row 38: not a decision, an omission that followed from
 * the list being literal paths.
 *
 * Skipped loudly rather than silently when the board is empty, because a drive
 * that quietly audits one page fewer and still prints a tick is the defect
 * this file exists to prevent.
 */
let publicPages = PUBLIC_PAGES.length;
{
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 823 } });
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const href = await page.locator('app-room-card a').first().getAttribute('href').catch(() => null);
    await page.close().catch(() => {});

    if (!href) {
      console.log('\n⏭  SKIP the room page — no rooms on the board to open.');
      failures.push('the room detail page was not audited: the board had no rooms');
    } else {
      const roomPage = await browser.newPage({ viewport: { width: WIDTH, height: 823 } });
      try {
        await auditPage(roomPage, href);
        // Counted, so the summary line says what the run actually covered.
        // Leaving it out would make the tick claim one page fewer than it
        // earned — checklist row 38 pointing the other way.
        publicPages++;
      } catch (err) {
        failures.push(`${href}: the audit could not complete (${err.message})`);
        await roomPage.close().catch(() => {});
      }
    }
  } catch (err) {
    failures.push(`the room page could not be reached from the board (${err.message})`);
    await page.close().catch(() => {});
  }
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

  /**
   * One room, one application and one message between the two accounts.
   *
   * ⚠️ Without this, every portal page was audited EMPTY. A fresh account has
   * no rooms, no applicants and no messages, so the drive measured each
   * screen's chrome and its "nothing here yet" sentence and reported the page
   * green — while the rows, badges, status pills and channel chips that people
   * actually read were never on screen to be measured. A contrast check that
   * cannot see the text it is about is the same shape of defect as the rest of
   * this codebase's history: a control that only looks like one.
   *
   * Best-effort on purpose. If the seed fails the drive still audits the empty
   * screens — that is worth more than nothing — but it says so, because
   * "audited" and "audited with content on it" are different claims.
   */
  const accounts = {};
  let seeded = false;
  try {
    accounts.LANDLORD = await registerUser(API, 'LANDLORD', stamp);
    accounts.TENANT = await registerUser(API, 'TENANT', stamp);

    /**
     * ⚠️ Both accounts are marked as already shown round — Phase 7f.
     *
     * The first-run walkthrough is a full-screen sheet on a phone and a modal
     * above the page on a desktop. Without this, every portal page in this
     * drive would be audited with that sheet over it: the heading order would
     * be the modal's, the contrast measured would be the modal's, and the
     * screen underneath would go unchecked while the run reported green.
     *
     * It passed anyway today, for a reason that is luck rather than design —
     * the cookie notice holds the walkthrough back and this drive never
     * dismisses it. If that sequencing ever changes, this drive would quietly
     * start auditing a modal. Stated, so it cannot.
     */
    for (const user of [accounts.LANDLORD, accounts.TENANT]) {
      await apiCall(API, 'POST', '/api/users/me/walkthrough-seen', {}, user.token);
    }

    const prop = await apiCall(API, 'POST', '/api/properties', {
      name: 'Ext 7 back rooms', suburb: 'Tembisa', city: 'Johannesburg', province: 'Gauteng',
    }, accounts.LANDLORD.token);
    const room = await apiCall(API, 'POST', '/api/rooms', {
      roomType: 'shared_house', title: 'Back room with its own entrance',
      description: 'A clean room in a shared house, close to transport and the shops. Available now.',
      rentCents: 285000, province: 'Gauteng', city: 'Johannesburg',
      locationDisplay: 'Tembisa, Johannesburg',
      availableFrom: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
      propertyId: prop.body?.id,
    }, accounts.LANDLORD.token);
    q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${room.body.id}'`);

    const app = await apiCall(API, 'POST', '/api/applications',
      { roomId: room.body.id, coverNote: 'I work at the mall and can move in on the first.' },
      accounts.TENANT.token);
    await apiCall(API, 'POST', `/api/applications/${app.body.id}/messages`,
      { body: 'Good day, is the room still open? I can come see it on Saturday.' },
      accounts.TENANT.token);

    /**
     * ⚠️ A viewing invitation — Phase 7l.
     *
     * The tenant dashboard's viewings panel renders NOTHING when there is
     * nothing, which is right for a tenant and wrong for this drive: without a
     * live invitation the panel is never measured, and it is the one on that
     * screen with a red-tinted safety box and a sage "you are coming" line —
     * exactly where a contrast threshold fails while looking deliberate. This
     * is the same mistake Phase 7c made by auditing every portal screen empty.
     */
    await apiCall(API, 'POST', `/api/applications/${app.body.id}/viewings`, {
      startsAt: new Date(Date.now() + 5 * 86400_000).toISOString(),
      meetingPlace: 'The blue gate on the corner',
      note: 'Ask for Sipho at the gate.',
    }, accounts.LANDLORD.token);

    /**
     * ⚠️ An ACCEPTED and a REJECTED application, on a second room.
     *
     * The same mistake as the viewing invitation above, one level along: this
     * drive has never accepted or rejected anything, so `.status--accepted`
     * and `.status--rejected` — declared in BOTH `applicants.ts` and
     * `applicants-inbox.ts` with raw hexes — were never once rendered while
     * contrast was being measured. Measured by hand afterwards: accepted
     * (#3D7040 on sage 15%) was 4.12:1 over --cream2 and rejected (#D63B3B on
     * red 10%) 3.46:1, both under the 4.5:1 small-text floor, on two screens,
     * green here for every release. A page passes this audit by not containing
     * the failing element, which is the five-vacuous-passes lesson again.
     *
     * A SECOND room, so accepting does not turn the first one `let` and change
     * what every other panel renders. A second tenant, because one applicant
     * cannot be both accepted and rejected.
     */
    const room2 = await apiCall(API, 'POST', '/api/rooms', {
      roomType: 'shared_house', title: 'Second back room, own door',
      description: 'A quiet room at the back of the yard with its own door and a shared kitchen.',
      rentCents: 240000, province: 'Gauteng', city: 'Johannesburg',
      locationDisplay: 'Tembisa, Johannesburg',
      availableFrom: new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10),
      propertyId: prop.body?.id,
    }, accounts.LANDLORD.token);
    q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${room2.body.id}'`);

    accounts.TENANT2 = await registerUser(API, 'TENANT', `${stamp}b`);
    const toAccept = await apiCall(API, 'POST', '/api/applications',
      { roomId: room2.body.id, coverNote: 'I can move in on the first and I have a reference.' },
      accounts.TENANT.token);
    const toReject = await apiCall(API, 'POST', '/api/applications',
      { roomId: room2.body.id, coverNote: 'Looking for something closer to the taxi rank.' },
      accounts.TENANT2.token);
    await apiCall(API, 'POST', `/api/applications/${toAccept.body.id}/accept`, {}, accounts.LANDLORD.token);
    await apiCall(API, 'POST', `/api/applications/${toReject.body.id}/reject`, {}, accounts.LANDLORD.token);

    /**
     * ⚠️ And the per-room applicants screen itself has never been audited.
     *
     * `LANDLORD_PAGES` is static paths, and this route needs a room id, so
     * `applicants.ts` — the screen with the accepted/rejected chips, the
     * references panel and the undo banner on it — was simply not in the list.
     * The portfolio-wide inbox at `/landlord/applicants` is a DIFFERENT
     * component (`applicants-inbox.ts`); auditing one has never covered the
     * other. Pushed here, after the seed, because only the seed knows the id.
     */
    LANDLORD_PAGES.push(`/landlord/rooms/${room2.body.id}/applicants`);

    /**
     * ⚠️ A SHORTLISTED APPLICANT, and a PAST LETTING WITH A LONG TITLE.
     *
     * Added 14 October, because the overflow check two sections up could not
     * see either of the two defects it was written for. Proven at the time
     * rather than assumed: the fix was reverted, the drive re-run, and it
     * passed. The fixture had no shortlisted applicant and no archived
     * letting, so neither card ever rendered — §56's rule, a check cannot see
     * a subject the fixture never creates.
     *
     * Both titles are deliberately long. A short one fits its box at 412px and
     * measures nothing: the defect was a global `white-space: nowrap`, and a
     * label that fits cannot show it. The archive title is the length of the
     * one that was reported.
     */
    // ── a shortlisted applicant, so the two-up action row renders
    const room3 = await apiCall(API, 'POST', '/api/rooms', {
      roomType: 'shared_house',
      title: 'Neat private room near the main road, with the mall five minutes away',
      description: 'A clean room in a shared house, close to transport and the shops. Available now.',
      rentCents: 200000, province: 'Gauteng', city: 'Pretoria',
      locationDisplay: 'Sunnyside, Pretoria',
      availableFrom: new Date().toISOString().slice(0, 10),
    }, accounts.LANDLORD.token);
    q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${room3.body.id}'`);

    const toShortlist = await apiCall(API, 'POST', '/api/applications',
      { roomId: room3.body.id, coverNote: 'I would like to come and see the room this week.' },
      accounts.TENANT2.token);
    await apiCall(API, 'POST', `/api/applications/${toShortlist.body.id}/shortlist`, {}, accounts.LANDLORD.token);
    LANDLORD_PAGES.push(`/landlord/rooms/${room3.body.id}/applicants`);

    // ── a finished letting with a long title, for /account/tenancies
    //
    // The move-in and move-out are written directly. The API route for each is
    // driven by tenancy-lifecycle-drive, which is where that behaviour belongs;
    // here the only thing being measured is that the finished card RENDERS and
    // fits its box, so the shortest honest path to a finished tenancy is the
    // right one. The same shortcut this file already takes to publish a room.
    const room4 = await apiCall(API, 'POST', '/api/rooms', {
      roomType: 'shared_house',
      title: 'Big private room near the main road and the mall is five minutes away',
      description: 'A clean room in a shared house, close to transport and the shops. Available now.',
      rentCents: 200000, province: 'Gauteng', city: 'Pretoria',
      locationDisplay: 'Sunnyside, Pretoria',
      availableFrom: new Date().toISOString().slice(0, 10),
    }, accounts.LANDLORD.token);
    q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${room4.body.id}'`);

    const past = await apiCall(API, 'POST', '/api/applications',
      { roomId: room4.body.id, coverNote: 'I can move in on the first of the month.' },
      accounts.TENANT.token);
    await apiCall(API, 'POST', `/api/applications/${past.body.id}/accept`, {}, accounts.LANDLORD.token);
    // ⚠️ There is no `endedAt`. The schema keeps `endDate` (the actual move-out)
    // and `endedById` (who recorded it); a first attempt wrote `endedAt`, the
    // UPDATE failed, and the drive's own seed guard caught it and refused to
    // audit the portal screens empty rather than reporting them clean.
    q(`UPDATE tenancies SET status='ended', "startDate"=now() - interval '90 days', `
      + `"endDate"=now() - interval '3 days' `
      + `WHERE "applicationId" = '${past.body.id}'`);

    seeded = true;
  } catch (err) {
    failures.push(`the portal screens were audited EMPTY — the seed failed (${err.message}), so rows, badges and pills were never measured`);
  }

  for (const [role, pages] of [
    ['LANDLORD', LANDLORD_PAGES],
    ['TENANT', TENANT_PAGES],
  ]) {
    let session;
    try {
      const user = accounts[role] ?? await registerUser(API, role, stamp);
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
      // Guarded per page for the same reason as the admin loop below: an
      // unguarded throw here does not fail the drive, it CRASHES it, before
      // the summary that lists what was found. A stack trace where a findings
      // list should be is how a check stops being readable.
      try {
        await auditPage(session, path, { close: false });
        portalPages++;
      } catch (err) {
        failures.push(`${path}: the audit could not complete (${err.message})`);
      }
    }
    await session.close();
  }

  // The admin screens carry the densest tables in the product and the least
  // traffic, which is exactly the combination nobody notices.
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    let session;
    // The try covers the sign-in and NOTHING else, as the landlord and tenant
    // blocks above already do. It used to wrap the audit loop too, so a
    // locator timeout on /admin/disputes was reported as "admin portal: could
    // not sign in" — naming a cause that was not the cause — and skipped every
    // screen after it. Three runs failed here and none of them said why; this
    // is the reason the message was useless.
    try {
      session = await signIn(browser, BASE, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, { width: WIDTH });
    } catch (err) {
      failures.push(`admin portal: could not sign in (${err.message})`);
      session = null;
    }
    if (session) {
      /**
       * One account's detail screen, by id — Phase 7i.
       *
       * Not in ADMIN_PAGES because it needs a real id, and it is worth the few
       * lines: it is the only admin screen with a destructive FORM on it (the
       * closure section), which is exactly where a danger treatment — red text
       * on a pink panel — fails a contrast threshold while looking deliberate.
       * It reuses the landlord this drive already seeded, so no extra account
       * is registered against the sixty-an-hour limiter.
       */
      const seeded = accounts.LANDLORD?.id;
      const adminPaths = seeded ? [...ADMIN_PAGES, `/admin/users/${seeded}`] : ADMIN_PAGES;
      if (!seeded) {
        failures.push('admin user detail: no seeded landlord id, so the one admin screen with a destructive form was not audited');
      }
      for (const path of adminPaths) {
        // Per page, so one bad screen costs that screen and not the six
        // after it. A drive that stops at the first problem finds one
        // problem per run, which is one CI cycle per problem.
        try {
          await auditPage(session, path, { close: false });
          portalPages++;
        } catch (err) {
          failures.push(`${path}: the audit could not complete (${err.message})`);
        }
      }
      await session.close();
    }
  } else {
    console.log('\n⏭  SKIP the admin screens — set ADMIN_EMAIL and ADMIN_PASSWORD to include them.');
  }
}

await browser.close();

/**
 * ⚠️ §64's uncovered defect, asserted rather than assumed.
 *
 * `.applicant-card__actions` is only in the DOM once a card is expanded, so
 * for two releases reverting its fix did not fail this drive. The reveal above
 * expands one — and this is what stops that quietly stopping working: if no
 * audited route ever had the action row on screen, the overflow and contrast
 * checks measured nothing there and reported clean.
 */
if (applicantsRoutes) {
  if (!actionRowsSeen) {
    failures.push(
      `the applicant ACTION ROW was never on screen across ${applicantsRoutes} applicants route(s) — `
      + 'the width and contrast checks measured nothing there, which reads as clean',
    );
  } else if (!shortlistControlsSeen) {
    failures.push(
      'no shortlist control was on screen on any applicants route — that is the control two '
      + 'reported defects were in, and the fixture is supposed to supply a shortlisted applicant',
    );
  } else {
    console.log(
      `\n  \u2705 the applicant action row was measured on ${actionRowsSeen} of ${applicantsRoutes} `
      + `applicants route(s), shortlist control included (${shortlistControlsSeen})`,
    );
  }
}

console.log('');
if (failures.length) {
  console.log(`❌ ${failures.length} accessibility failure(s):`);
  failures.forEach((f) => console.log('   • ' + f));
  process.exit(1);
}
console.log(
  `✅ ${publicPages} public + ${portalPages} portal pages: ` +
    'heading order intact, every control named' +
    // Named separately rather than folded into "accessible": a summary that
    // claims more than the run checked is how row 32 happened in the first
    // place — the drive reported green while looking at no colour at all.
    (axeSource
      ? ', every text node over its contrast threshold at rest, on hover and on focus.'
      : '. Contrast NOT checked — axe-core missing.'),
);
