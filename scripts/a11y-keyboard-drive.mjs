#!/usr/bin/env node
/**
 * The accessibility criteria no automated scanner can reach.
 *
 * axe is a static-DOM inspector. It cannot press Tab, so the whole of keyboard
 * operability is invisible to it — and scripts/a11y-scan.mjs reporting zero
 * WCAG 2.2 AA violations across 204 page-scans says nothing at all about any
 * of the following. The brief that commissioned this work put it plainly:
 * automated scans are useful but do not establish compliance.
 *
 * What this drives, each named with the criterion it is about:
 *
 *   2.4.1  Bypass Blocks          — a skip link that exists, is first, and works
 *   2.1.1  Keyboard               — every control reachable by Tab alone
 *   2.1.2  No Keyboard Trap       — and Tab can always get back out again
 *   2.4.7  Focus Visible          — the focused control looks different
 *   2.4.11 Focus Not Obscured     — and is not hidden under the sticky chrome
 *   3.3.8  Accessible Auth        — paste allowed, autocomplete present
 *   3.3.1  Error Identification   — the error is announced, not just painted
 *
 * 2.4.11 is new in WCAG 2.2 and this app has three things that can trigger it:
 * `.nav` is sticky at top 0 with z-index 100, `.cookie-notice` is fixed at the
 * bottom with z-index 9999, and `.filter-drawer-actions` is sticky at the
 * bottom on a phone. A control the browser scrolls to under one of those is
 * focused and invisible, which is the exact failure the criterion was added
 * for.
 *
 *   node scripts/a11y-keyboard-drive.mjs
 *   WIDTHS=390 node scripts/a11y-keyboard-drive.mjs
 */
import { chromium } from 'playwright';

const WEB = process.env.BASE_URL ?? 'http://localhost:4200';
const WIDTHS = (process.env.WIDTHS ?? '390,1280').split(',').map(Number);
const PAGES = (process.env.PAGES ?? '/,/pricing,/auth/login,/auth/register,/advertise,/legal/terms').split(',');

let fail = 0;
const ok = (t) => console.log(`  \u001b[32m✅\u001b[0m ${t}`);
const bad = (t) => { console.log(`  \u001b[31m❌\u001b[0m ${t}`); fail++; };
const note = (t) => console.log(`  \u001b[90m·  ${t}\u001b[0m`);
const check = (c, t) => (c ? ok(t) : bad(t));

const up = await fetch(WEB, { signal: AbortSignal.timeout(6000) }).then((r) => r.ok).catch(() => false);
if (!up) {
  // Loudly, and non-zero. A keyboard gate that exits 0 because the site was
  // not running is a gate that reports green on an empty room.
  console.error(`❌ no frontend on ${WEB} — nothing was driven. Start it first.`);
  process.exit(1);
}

const browser = await chromium.launch();

for (const width of WIDTHS) {
  console.log(`\n════════ ${width}px ════════`);

  for (const path of PAGES) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    console.log(`\n── ${path} ──`);

    /**
     * 🔴 Refuse to measure a page with a modal over it.
     *
     * The first version of this drive reported 32 controls on `/` as
     * "ENTIRELY hidden when focused", which looked like a spectacular 2.4.11
     * failure and was nothing of the kind: the API was down, so the app was
     * correctly showing its "No connection" alertdialog, and every control
     * underneath really was covered. I read findings off a broken environment
     * for several minutes.
     *
     * a11y-drive has the same concern about the first-run walkthrough and
     * handles it by marking the account as having seen it. This handles it by
     * refusing: an open dialog means the measurement below is about the dialog,
     * not the page, so say so and fail rather than produce numbers that look
     * like page findings.
     */
    const blocking = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]');
      if (!d || getComputedStyle(d).display === 'none') return null;
      return { role: d.getAttribute('role'),
               title: (d.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 70) };
    });
    if (blocking) {
      bad(`a ${blocking.role} is open over this page — "${blocking.title}" — so nothing below ` +
          'was measured. Fix the environment (is the API up?) and re-run.');
      await ctx.close();
      continue;
    }

    // ── 2.4.1 Bypass Blocks ──────────────────────────────────────────────
    /**
     * A skip link is the FIRST tab stop and it targets the main landmark.
     *
     * 🔴 Version one took `document.querySelector('a[href^="#"]')` and called
     * it the skip link, which on the home page matched the hero's "Skip to
     * rooms" anchor pointing at #board. So it reported a skip link that
     * exists (it does not) and then reported that it is not the first tab stop
     * (it never claimed to be) — two wrong lines about one non-existent thing.
     *
     * The definition that matters for 2.4.1 is narrow: a link, reachable
     * first, that jumps past the repeated navigation to the content.
     */
    const skip = await page.evaluate(() => {
      const main = document.querySelector('main, [role="main"]');
      const mainId = main?.id ? `#${main.id}` : null;
      const candidates = [...document.querySelectorAll('a[href^="#"]')];
      const hit = candidates.find((a) => {
        const href = a.getAttribute('href');
        if (mainId && href === mainId) return true;
        const target = href && href.length > 1 ? document.querySelector(href) : null;
        return !!(target && main && (target === main || main.contains(target) || target.contains(main)));
      });
      if (!hit) return { present: false, mainId, anchorsOnPage: candidates.length };
      return { present: true, href: hit.getAttribute('href'), text: (hit.textContent ?? '').trim(),
               targetExists: true };
    });
    if (!skip.present) {
      bad('2.4.1 no skip link — a keyboard user tabs the whole nav before the content, on every page. ' +
          `The target exists (<main${skip.mainId ? ' ' + skip.mainId : ''}>) and styles.scss even has a rule ` +
          'commented "Skip link target used by the app shell"; the LINK was never built.');
    } else {
      check(skip.targetExists, `2.4.1 skip link "${skip.text}" points at ${skip.href}, which exists`);
      await page.keyboard.press('Tab');
      const firstStop = await page.evaluate(() => ({
        text: (document.activeElement?.textContent ?? '').trim().slice(0, 40),
        isSkip: document.activeElement?.getAttribute('href')?.startsWith('#') ?? false,
      }));
      check(firstStop.isSkip, `2.4.1 …and it is the FIRST tab stop (got "${firstStop.text}")`);
    }

    // ── 2.1.1 / 2.1.2 / 2.4.7 / 2.4.11, walked with real Tab presses ─────
    //
    // Tab is pressed for real rather than calling .focus(), because the
    // question is what a keyboard user reaches, and .focus() reaches things
    // the Tab order does not.
    const MAX = 120;
    const seen = [];
    await page.evaluate(() => document.body.focus());
    let trapped = false;
    for (let i = 0; i < MAX; i++) {
      await page.keyboard.press('Tab');
      /**
       * 🔴 Wait for the scroll to STOP, rather than for a fixed 90ms.
       *
       * `html` has `scroll-behavior: smooth`, so Tab's scroll-into-view
       * animates for a few hundred milliseconds. A fixed 90ms wait measured
       * controls at coordinates they were only passing through.
       *
       * This bit twice, in opposite directions. First it produced 2.4.11
       * verdicts about transient positions. Then, once the fix was corrected
       * to act after the scroll settles, the drive was still measuring at 90ms
       * and reported TEN failures where there had been two — not a regression
       * in the product, but the instrument and the fix disagreeing about when
       * "focused" is finished. A verdict belongs to the resting state.
       */
      await page.evaluate(() => new Promise((resolve) => {
        let last = -1, still = 0;
        const tick = () => {
          const y = Math.round(window.scrollY);
          still = y === last ? still + 1 : 0;
          last = y;
          // Three identical frames, or give up — a page that never settles
          // must not hang the drive.
          if (still >= 3) resolve(undefined);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        setTimeout(() => resolve(undefined), 900);
      }));
      // And the fix itself waits for scrollend before correcting, so allow
      // for that too. 420ms is its fallback timeout; this must exceed it.
      await page.waitForTimeout(520);
      const stop = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);

        /**
         * 2.4.11: is ANY part of this control hit-testable?
         *
         * The criterion fails when author content hides the focused element
         * ENTIRELY, so a probe of one point would be both too strict (a
         * corner under the header) and too lenient. Nine points across the
         * rect: if every one of them returns some other element, nothing of
         * this control is visible, and whatever came back is what is on top.
         */
        /**
         * The EDGES as well as the middle.
         *
         * 🔴 This sampled 15%, 50% and 85% of width and height — nine points
         * that all sit inside the element, none at its rim. A 167px-tall CTA
         * panel on the board overlapped the notice by 160px, leaving its top
         * 7px visible, and every one of the nine points fell in the covered
         * part. The drive called it "ENTIRELY hidden" when it was not, which
         * is the difference between failing 2.4.11 (Minimum, AA) and failing
         * only 2.4.12 (Enhanced, AAA).
         *
         * 2% and 98% rather than 0% and 100%: a point exactly on the boundary
         * hit-tests unpredictably, and a 1px inset is still the rim.
         */
        const pts = [];
        for (const fx of [0.02, 0.15, 0.5, 0.85, 0.98]) {
          for (const fy of [0.02, 0.15, 0.5, 0.85, 0.98]) {
            pts.push([r.left + r.width * fx, r.top + r.height * fy]);
          }
        }
        let visible = 0, coveredBy = null, probed = 0;
        for (const [x, y] of pts) {
          // 🔴 A point outside the viewport is NOT a covered point, and
          // counting it as one was version one's second false finding: links
          // in the footer reported "ENTIRELY hidden, covered by unknown"
          // because every probe fell below the fold, which is off-screen and
          // not obscured. `probed` records how many points were actually
          // testable, so "nothing visible" can be told apart from "nothing
          // measured".
          if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
          probed++;
          const top = document.elementFromPoint(x, y);
          if (!top) continue;
          if (top === el || el.contains(top) || top.contains(el)) { visible++; continue; }
          const tcs = getComputedStyle(top);
          const fixedAncestor = (node) => {
            for (let n = node; n && n !== document.body; n = n.parentElement) {
              const p = getComputedStyle(n).position;
              if (p === 'fixed' || p === 'sticky') return n;
            }
            return null;
          };
          const fa = fixedAncestor(top);
          if (!coveredBy) {
            coveredBy = {
              tag: top.tagName.toLowerCase(),
              cls: String(top.className ?? '').split(' ').filter(Boolean)[0] ?? '',
              position: fa ? getComputedStyle(fa).position : tcs.position,
              fixedCls: fa ? (String(fa.className ?? '').split(' ').filter(Boolean)[0] ?? fa.tagName.toLowerCase()) : null,
            };
          }
        }
        return {
          tag: el.tagName.toLowerCase(),
          name: (el.getAttribute('aria-label') ?? el.textContent ?? el.getAttribute('placeholder') ?? '').replace(/\s+/g, ' ').trim().slice(0, 36),
          outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
          shadow: cs.boxShadow,
          border: `${cs.borderColor} ${cs.borderWidth}`,
          onScreen: r.width > 0 && r.height > 0,
          visiblePoints: visible,
          probedPoints: probed,
          coveredBy,
          id: `${el.tagName}.${String(el.className ?? '')}#${el.id}:${(el.textContent ?? '').slice(0, 20)}`,
          // The geometry at the moment of the verdict, so a 2.4.11 failure can
          // be read rather than re-derived. Two cases survived the fix and my
          // follow-up probes could not reproduce them, because a probe that
          // calls .focus() does not scroll the way Tab does — so the probe was
          // looking at different geometry from the verdict.
          geom: { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), rt: Math.round(r.right) },
          scrollY: Math.round(scrollY),
        };
      });
      if (stop === null) break;                       // focus left the document
      if (seen.length && stop.id === seen[0].id) break; // cycled back to the start
      seen.push(stop);
      /**
       * 🔴 Running out of presses is not a trap.
       *
       * The board at 1280px has twelve room cards with several controls each
       * plus the filter set, and it reported "keyboard trap" purely for
       * exceeding 120 Tab presses while still finding NEW controls — which is
       * a long page, not a trap. 2.1.2 is about focus that cannot get out: the
       * signature is the stop list ceasing to grow while Tab keeps moving.
       */
      if (i === MAX - 1) {
        const ids = new Set(seen.map((x) => x.id));
        const lastTwenty = new Set(seen.slice(-20).map((x) => x.id));
        const allRevisited = [...lastTwenty].every((id) =>
          seen.slice(0, -20).some((x) => x.id === id));
        if (allRevisited) trapped = true;
        else note(`2.1.2 stopped after ${MAX} Tab presses with ${ids.size} distinct controls and still finding new ones — a long page, not a trap`);
      }
    }

    check(seen.length > 0, `2.1.1 Tab reaches ${seen.length} control(s)`);
    check(!trapped, `2.1.2 no keyboard trap — the Tab order ends or cycles within ${MAX} presses`);

    // Only elements that were really testable: at least one probe point inside
    // the viewport, and none of them reaching the element.
    const obscured = seen.filter((s) => s.onScreen && s.probedPoints > 0 && s.visiblePoints === 0);
    const unmeasured = seen.filter((s) => s.onScreen && s.probedPoints === 0).length;
    if (unmeasured) note(`2.4.11 ${unmeasured} control(s) were off-screen when focused and not judged`);
    if (obscured.length === 0) {
      ok(`2.4.11 every focused control has at least one visible point`);
    } else {
      for (const o of obscured.slice(0, 4)) {
        const by = o.coveredBy;
        const culprit = by ? `${by.fixedCls ?? by.cls ?? by.tag} (position: ${by.position})` : 'unknown';
        bad(`2.4.11 "${o.name || o.tag}" is ENTIRELY hidden when focused — covered by ${culprit}` +
            ` [rect ${o.geom.l},${o.geom.t}→${o.geom.rt},${o.geom.b} at scrollY ${o.scrollY}; ${o.visiblePoints}/${o.probedPoints} points visible]`);
      }
      if (obscured.length > 4) note(`…and ${obscured.length - 4} more`);
    }

    // 2.4.7: a control whose focused appearance is identical to its resting
    // appearance has no focus indicator. Measured by focusing each control and
    // comparing, rather than by looking for a :focus-visible rule in the CSS —
    // a rule that exists and is overridden is the defect this catches.
    /**
     * 🔴 Measured from the REAL Tab walk, not by calling .focus().
     *
     * Version one focused each control programmatically and compared computed
     * styles. That reported "no focus indicator" on .filter-pill,
     * .auth__submit, .filter-drawer-close and 25 others — and it was wrong
     * about every one of them. `:focus-visible` deliberately does NOT match
     * for programmatic focus: the browser's heuristic is about whether the
     * user is navigating by keyboard. This codebase styles focus almost
     * entirely with `:focus-visible`, so the check was guaranteed to report
     * the whole app as unstyled.
     *
     * The Tab walk above already visited every reachable control with genuine
     * keyboard focus and captured its outline, box-shadow and border at that
     * moment. Comparing that against the same control's resting style is the
     * honest version, and it needs no second pass.
     */
    const resting = await page.evaluate(() => {
      /**
       * 🔴 Blur first.
       *
       * This snapshot is taken AFTER the Tab walk, and the walk leaves focus
       * on whichever control it stopped at — so that control's FOCUSED styles
       * were being recorded as its resting styles. Compared against itself,
       * they matched, and it was reported as having no focus indicator.
       *
       * That is why the finding was always exactly one control, and a
       * different one per page: it was whatever Tab happened to stop on. On
       * the board it was the footer's "Create account" link, which sent me
       * looking for a missing `.footer-col a:focus-visible` rule that was
       * never the problem.
       */
      document.activeElement?.blur?.();
      const out = {};
      for (const el of document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')) {
        if (el.offsetParent === null) continue;
        const c = getComputedStyle(el);
        const key = `${el.tagName}.${String(el.className ?? '')}#${el.id}:${(el.textContent ?? '').slice(0, 20)}`;
        out[key] = `${c.outlineStyle} ${c.outlineWidth} ${c.outlineColor}|${c.boxShadow}|${c.borderColor} ${c.borderWidth}`;
      }
      return out;
    });
    const noIndicator = seen
      .filter((st) => {
        const rest = resting[st.id];
        if (rest === undefined) return false;   // not in the resting snapshot
        return rest === `${st.outline}|${st.shadow}|${st.border}`;
      })
      .map((st) => `${st.tag} "${st.name}"`);
    if (noIndicator.length === 0) ok('2.4.7 every control changes appearance when focused');
    else {
      for (const n of noIndicator.slice(0, 5)) bad(`2.4.7 no focus indicator: ${n}`);
      if (noIndicator.length > 5) note(`…and ${noIndicator.length - 5} more`);
    }

    // ── 3.3.8 Accessible Authentication, on the pages that authenticate ──
    if (path.startsWith('/auth')) {
      const fields = await page.evaluate(() =>
        [...document.querySelectorAll('input')].filter((i) => i.offsetParent !== null).map((i) => ({
          type: i.type, name: i.name || i.id,
          autocomplete: i.getAttribute('autocomplete'),
          // A field that blocks paste makes a password manager unusable, which
          // is what 3.3.8 exists to prevent.
          blocksPaste: !!(i.onpaste || i.getAttribute('onpaste')),
        })));
      /**
       * Only fields that identify the PERSON.
       *
       * 🔴 Version one asked every text input for an autocomplete token and
       * reported the registration form's "referralCode" as a failure. There
       * is no HTML autocomplete token for a referral code, and inventing one
       * would be wrong — 3.3.8 is about not making the person retype
       * credentials a manager could fill, and a referral code is neither a
       * credential nor something a manager holds. A check that demands an
       * attribute the standard does not define is a check that teaches people
       * to add noise to shut it up.
       */
      const IDENTIFYING = new Set(['email', 'password', 'tel']);
      const NAME_LIKE = /name|surname|given|family/i;
      for (const f of fields) {
        const identifying = IDENTIFYING.has(f.type) || NAME_LIKE.test(f.name ?? '');
        if (identifying) {
          check(!!f.autocomplete,
            `3.3.8 ${f.type} field "${f.name}" declares autocomplete="${f.autocomplete ?? 'MISSING'}" so a manager can fill it`);
        }
        if (f.blocksPaste) bad(`3.3.8 field "${f.name}" intercepts paste`);
      }
      // Paste proven by doing it, not by the absence of a handler.
      const pw = page.locator('input[type="password"]').first();
      if (await pw.count()) {
        await pw.focus();
        await page.evaluate(() => navigator.clipboard?.writeText?.('pasted-secret-123')).catch(() => {});
        await page.keyboard.insertText('pasted-secret-123');
        const v = await pw.inputValue();
        check(v === 'pasted-secret-123', `3.3.8 a password can actually be pasted in (got ${v.length} chars)`);
        await pw.fill('');
      }
    }

    // ── 3.3.1 Error Identification, driven on the login form ─────────────
    if (path === '/auth/login') {
      /**
       * 🔴 A well-formed address and a wrong password, not a malformed one.
       *
       * Version one typed "not-an-email" and then clicked submit, which the
       * form correctly keeps DISABLED until it validates — so the click timed
       * out after 30 seconds and crashed the drive. The criterion under test
       * is 3.3.1 (is a rejection identified and announced), and the rejection
       * worth testing is the server's, which needs a submittable form.
       */
      await page.fill('input[type="email"]', `nobody-${Date.now()}@example.invalid`);
      await page.locator('input[type="password"]').first().fill('definitely-not-the-password');
      /**
       * 🔴 WAIT for the button to enable; do not test it once.
       *
       * The button is `[disabled]="form.invalid || loading()"`, and Angular
       * settles form validity asynchronously after the input events `fill`
       * dispatches. Checking immediately made this whole section flake: the
       * identical build reported the error path three times in a row and then,
       * on the next run, "the submit button stayed disabled" at 1280px and
       * three cascading failures behind it. A check that answers differently
       * on the same code is not a check.
       *
       * Blur first, because a form configured `updateOn: 'blur'` would never
       * validate otherwise, then poll. If it genuinely never enables, that is
       * still reported — it just is not reported on a race.
       */
      await page.keyboard.press('Tab');
      const submit = page.locator('button[type="submit"]').first();
      try {
        await submit.waitFor({ state: 'visible', timeout: 5000 });
        await page.waitForFunction(
          () => { const b = document.querySelector('button[type="submit"]'); return !!b && !b.disabled; },
          null, { timeout: 5000 },
        );
      } catch { /* fall through to the explicit check below, which reports it */ }
      if (await submit.isDisabled()) {
        bad('3.3.1 the submit button stayed disabled on a well-formed sign-in, so the error path was not reached');
      } else {
        await submit.click();
        await page.waitForTimeout(1800);
      }
      const err = await page.evaluate(() => {
        const live = [...document.querySelectorAll('[role="alert"], [aria-live]')]
          .filter((e) => (e.textContent ?? '').trim().length > 0);
        const invalid = [...document.querySelectorAll('[aria-invalid="true"]')];
        const described = [...document.querySelectorAll('input[aria-describedby]')]
          .filter((i) => document.getElementById(i.getAttribute('aria-describedby')));
        const visibleText = [...document.querySelectorAll('.field-error, .form-error, .auth-error, .error')]
          .map((e) => (e.textContent ?? '').trim()).filter(Boolean);
        return { live: live.length, liveText: live.map((e) => (e.textContent ?? '').trim().slice(0, 60)),
                 invalid: invalid.length, described: described.length, visibleText };
      });
      check(err.visibleText.length > 0 || err.live > 0,
        `3.3.1 a rejected sign-in says something (${err.visibleText[0] ?? err.liveText[0] ?? 'nothing'})`);
      check(err.live > 0,
        `3.3.1 …and it is in a live region, so a screen reader hears it without hunting (${err.live} found)`);
      check(err.invalid > 0 || err.described > 0,
        `3.3.1 …and it is tied to the field, via aria-invalid (${err.invalid}) or aria-describedby (${err.described})`);
    }

    await ctx.close();
  }
}
await browser.close();

console.log(
  fail === 0
    ? '\n\u001b[32m✅ keyboard, focus and authentication: nothing found.\u001b[0m\n'
    : `\n\u001b[31m❌ ${fail} finding(s) — each names its WCAG criterion above.\u001b[0m\n`,
);
process.exit(fail ? 1 : 0);
