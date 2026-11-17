#!/usr/bin/env node
/**
 * Responsive behaviour at the breakpoints nobody tests.
 *
 * ── Why these widths ────────────────────────────────────────────────────
 *
 * CLAUDE.md makes a standing rule of 360 / 390 / 768 / 1280, and says the
 * breakpoints this codebase uses are 900 / 768 / 480. It uses ELEVEN:
 *
 *   max-width:  360, 480, 600, 700, 768, 860, 900
 *   min-width:  640, 769, 901, 1600
 *
 * So the transitions at 600, 640, 700 and 860 are never crossed by any
 * prescribed width, and the `min-width: 1600px` rules are never exercised at
 * all, because the widest width anyone tests is 1280. Four boundaries and a
 * whole desktop enhancement with no coverage.
 *
 * This drives every real boundary at boundary-1, boundary and boundary+1,
 * because an off-by-one in a media query shows up nowhere else: `max-width:
 * 768px` and `min-width: 769px` leave no gap, but `max-width: 768px` with
 * `min-width: 768px` applies BOTH and `max-width: 767px` with `min-width:
 * 769px` applies NEITHER, and a layout with no rules is the one that collapses.
 *
 * ── What it asserts ─────────────────────────────────────────────────────
 *
 *   · no horizontal page scroll — the first item on CLAUDE.md's mobile list
 *   · nothing sticks out past the right edge, named per element
 *   · no text clipped by its own container
 *   · no two controls overlapping each other
 *
 * Touch target size and contrast are NOT repeated here: a11y-drive measures
 * both properly, at four widths, including the 2.5.8 spacing exception. A
 * second implementation of a check this repository already has would be a
 * second thing to keep right.
 *
 *   node scripts/responsive-drive.mjs
 *   WIDTHS=600,601 node scripts/responsive-drive.mjs
 */
import { chromium } from 'playwright';

const WEB = process.env.BASE_URL ?? 'http://localhost:4200';

/** Every boundary the stylesheets actually declare, each probed ±1. */
const BOUNDARIES = [360, 480, 600, 640, 700, 768, 769, 860, 900, 901, 1600];
const WIDTHS = process.env.WIDTHS
  ? process.env.WIDTHS.split(',').map(Number)
  : [...new Set(BOUNDARIES.flatMap((b) => [b - 1, b, b + 1]))].sort((a, b) => a - b);

const PAGES = (process.env.PAGES ?? '/,/pricing,/advertise,/legal/terms,/auth/login,/auth/register').split(',');

// The margin of safety the header must keep, and the band it is asked for in.
// Both derived from measurement on two machines — see the note at the point of
// use, which records how the first version of this got it wrong.
const NAV_HEADROOM_MIN = 40;
const NAV_HEADROOM_ABOVE = 480;

let fail = 0;
const bad = (t) => { console.log(`    \u001b[31m❌\u001b[0m ${t}`); fail++; };
const note = (t) => console.log(`    \u001b[90m·  ${t}\u001b[0m`);

const up = await fetch(WEB, { signal: AbortSignal.timeout(6000) }).then((r) => r.ok).catch(() => false);
if (!up) { console.error(`❌ no frontend on ${WEB} — nothing was driven.`); process.exit(1); }

const browser = await chromium.launch();
console.log(`\n${WIDTHS.length} width(s) × ${PAGES.length} page(s) = ${WIDTHS.length * PAGES.length} layouts`);
console.log(`widths: ${WIDTHS.join(' ')}\n`);

for (const path of PAGES) {
  console.log(`── ${path} ──`);
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(900);

      const r = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const out = { vw, hScroll: document.documentElement.scrollWidth - vw, spills: [], clipped: [], overlaps: [], navHeadroom: null, burgerShown: false, headerLangShown: false };

        const describe = (e) => {
          // getAttribute, not .className: on an SVG element className is an
          // SVGAnimatedString, and String()-ing it printed "svg.[object" in
          // the first run of this drive.
          const cls = (e.getAttribute('class') ?? '').split(' ').filter(Boolean)[0];
          return `${e.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
        };

        /**
         * Is this element inside something that is MEANT to scroll sideways?
         *
         * 🔴 The first run of this drive reported six findings per width on the
         * board, every one of them a `.trust-item` or its icon inside
         * `.trust-strip` — which is a deliberate horizontal scroller below
         * 900px, and whose children are therefore SUPPOSED to extend past the
         * viewport. Flagging them would have had somebody "fix" a feature.
         *
         * The page scrolling sideways is still a defect; a scroller scrolling
         * is not.
         */
        const inScroller = (e) => {
          for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) {
            if (/(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true;
          }
          return false;
        };
        const visible = (e) => {
          const s = getComputedStyle(e);
          if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };

        for (const e of document.querySelectorAll('body *')) {
          if (!visible(e)) continue;
          const b = e.getBoundingClientRect();
          const s = getComputedStyle(e);

          // Past the right edge. 2px of tolerance for sub-pixel layout; a
          // fixed/sticky element deliberately pinned off-canvas is skipped,
          // because a closed drawer at translateX(-100%) is not a defect.
          if (b.right > vw + 2 && s.position !== 'fixed' && s.transform === 'none' &&
              !inScroller(e) && out.spills.length < 6) {
            out.spills.push(`${describe(e)} reaches ${Math.round(b.right)}px`);
          }

          // Text clipped by its own box: the element scrolls horizontally and
          // nothing said it should.
          if (e.scrollWidth > e.clientWidth + 2 && /hidden|clip/.test(s.overflowX) &&
              (e.textContent ?? '').trim().length > 0 && out.clipped.length < 6) {
            out.clipped.push(`${describe(e)} clips ${e.scrollWidth - e.clientWidth}px of its content`);
          }
        }

        /* ── How close the header is to overflowing, not just whether it has ──
         *
         * 🔴 Why this exists, measured rather than reasoned: the navbar at
         * 481px had SIX pixels of slack on this container and overflowed by
         * 20px on CI's runner, from the same commit and the same build. The
         * elements are the same; the text metrics are not. So "no overflow
         * here" said nothing about any other machine, and the gate was
         * passing on this one while the layout was broken on that one.
         *
         * `.nav-actions` has `margin-left: auto`, so the burger is flush
         * against the right padding at every width that fits. The right edge
         * therefore looks identical at 93px of headroom and at 1px, and the
         * only number that distinguishes them is the free space between the
         * logo and the actions. That is what this measures.
         *
         * 🔴 The first version of this check made the EXACT mistake it exists
         * to catch, and the record is worth more than the rule. It asserted a
         * 40px floor at every width the burger shows, calibrated against the
         * tightest value measured HERE: 53px at 359px. On CI the same layout
         * measures 35px at 359px, because CI's text is wider — so the check
         * condemned four pages at 359/360/361px that CI's own overflow
         * assertion passes. Calibrating a cross-machine check against one
         * machine is what this whole finding was about.
         *
         *   width   this container   CI's runner
         *   359px        53px           35px
         *   360px        54px           36px
         *   361px        55px           37px
         *   481px        92px          ~74px   (16px / overflowing, before)
         *
         * So the floor is asked for only ABOVE 480px, and that is a reason
         * rather than a dodge: at and below 480px the nav is deliberately
         * hand-fitted to the pixel — the rules there tighten padding and font
         * size, measured at 360/390/430px by nav-ui-drive — so demanding 40px
         * of slack contradicts a decision taken on purpose. Above 480px
         * nothing was tightened, so slack is expected and its absence is the
         * defect: 40px sits far below the ~74px CI measures after the fix and
         * far above the 16px that shipped.
         *
         * ⚠️ A pixel floor is machine-dependent however it is calibrated, so
         * it is no longer the only guard. `langInHeader` below asserts the
         * same thing STRUCTURALLY — while the burger is shown, the language
         * switcher must not be in the header — which needs no text metrics,
         * cannot drift between runners, and pins the actual regression.
         *
         * Only while the burger is shown. Above 768px `.nav-links` fills the
         * middle of the header on purpose and the gap means nothing.
         */
        const burger = document.querySelector('button.nav-burger');
        if (burger && visible(burger)) {
          out.burgerShown = true;
          const headerLang = document.querySelector('.nav-actions app-lang-switcher');
          out.headerLangShown = !!(headerLang && visible(headerLang));
          const logo = document.querySelector('a.logo');
          const actions = document.querySelector('.nav-actions');
          if (logo && actions && visible(logo) && visible(actions)) {
            out.navHeadroom = Math.round(
              actions.getBoundingClientRect().left - logo.getBoundingClientRect().right,
            );
          }
        }

        // Controls sitting on top of one another — the "buttons collapse into
        // each other" case CLAUDE.md names.
        /**
         * Controls in normal flow only.
         *
         * 🔴 The first run reported `select.search-select over
         * button.cookie-notice__ok` at three widths. The cookie notice is an
         * OVERLAY — it is supposed to sit on top of the page — and its own
         * button is `position: static` inside a `position: fixed` parent, so
         * checking the element's own position was not enough. An overlay
         * overlapping the page is the overlay working; two controls in the
         * same flow overlapping is the defect this check is for.
         */
        const positioned = (e) => {
          for (let n = e; n && n !== document.body; n = n.parentElement) {
            const pos = getComputedStyle(n).position;
            if (pos === 'fixed' || pos === 'absolute' || pos === 'sticky') return true;
          }
          return false;
        };
        const controls = [...document.querySelectorAll('button, a[href], input, select')]
          .filter(visible).filter((e) => !positioned(e));
        /**
         * 🔴 getClientRects(), one rect per LINE BOX — not
         * getBoundingClientRect().
         *
         * An inline link that wraps onto two lines has a bounding box that is
         * the UNION of both line boxes, so it spans the full column width and
         * swallows anything inline near it. On /auth/register at 360px that
         * reported `a over a (34×16px)`: the "Privacy Policy" link wraps, its
         * bounding box reads 62→317, and it therefore "overlapped" the
         * "Terms" link sitting at 216→249 on the first line. Two links in a
         * sentence, side by side, perfectly fine.
         *
         * Line boxes do not have that problem: each is a real painted
         * rectangle, so two of them overlapping is two controls genuinely on
         * top of one another.
         */
        const boxes = controls.map((e) => [...e.getClientRects()]);
        for (let i = 0; i < controls.length && out.overlaps.length < 4; i++) {
          for (let j = i + 1; j < controls.length && out.overlaps.length < 4; j++) {
            if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
            let hit = null;
            for (const a of boxes[i]) {
              for (const c of boxes[j]) {
                const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left);
                const oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
                // More than a hairline in BOTH axes is a real overlap.
                if (ox > 3 && oy > 3) { hit = `${Math.round(ox)}×${Math.round(oy)}`; break; }
              }
              if (hit) break;
            }
            if (hit) out.overlaps.push(`${describe(controls[i])} over ${describe(controls[j])} (${hit}px)`);
          }
        }
        return out;
      });

      // See the note beside the measurement for both the floor and the band.
      const tightNav =
        r.navHeadroom !== null &&
        width > NAV_HEADROOM_ABOVE &&
        r.navHeadroom < NAV_HEADROOM_MIN;
      // Machine-independent, and the one that pins the actual defect.
      const langInHeader = r.burgerShown && r.headerLangShown;
      const problems =
        r.hScroll > 2 ||
        r.spills.length ||
        r.clipped.length ||
        r.overlaps.length ||
        tightNav ||
        langInHeader;
      if (!problems) {
        console.log(`    \u001b[32m·\u001b[0m ${String(width).padStart(4)}px clean`);
      } else {
        console.log(`    ${String(width).padStart(4)}px`);
        if (r.hScroll > 2) bad(`${width}px ${path}: the PAGE scrolls sideways by ${r.hScroll}px`);
        for (const s of r.spills) bad(`${width}px ${path}: ${s} (viewport ${r.vw}px)`);
        for (const c of r.clipped) bad(`${width}px ${path}: ${c}`);
        for (const o of r.overlaps) bad(`${width}px ${path}: ${o}`);
        if (tightNav)
          bad(
            `${width}px ${path}: the header has only ${r.navHeadroom}px between the logo and ` +
              `its actions (floor ${NAV_HEADROOM_MIN}px above ${NAV_HEADROOM_ABOVE}px) — it ` +
              `fits here but not on a machine whose text measures wider`,
          );
        if (langInHeader)
          bad(
            `${width}px ${path}: the language switcher is in the HEADER while the burger is ` +
              `shown — it belongs in the drawer (.nav-links-lang) at every width the burger ` +
              `appears at, and competing with it for the same row is what produced 20px of ` +
              `page scroll at 481px`,
          );
      }
    } catch (e) {
      bad(`${width}px ${path}: could not be measured — ${e.message.split('\n')[0].slice(0, 90)}`);
    }
    await ctx.close();
  }
}
await browser.close();

console.log(
  fail === 0
    ? '\n\u001b[32m✅ every declared breakpoint, ±1px: no sideways scroll, no spill, no clipped text, no overlap.\u001b[0m\n'
    : `\n\u001b[31m❌ ${fail} layout finding(s).\u001b[0m\n`,
);
process.exit(fail ? 1 : 0);
