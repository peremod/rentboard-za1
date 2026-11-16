import { ChangeDetectionStrategy, Component, OnInit, afterNextRender, effect, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { CookieNoticeService, COOKIE_CONSENT_KEY as CONSENT_KEY } from '../../../core/services/cookie-notice';
import { RouterLink } from '@angular/router';

/** Stored acknowledgement. There are no optional categories to record. */
interface CookieAcknowledgement {
  acknowledged: true;
  version: number;
  timestamp: string;
}

// v2 deliberately re-shows the notice to anyone who saw the old consent
// banner: what it told them was wrong.

/**
 * Cookie notice.
 *
 * Not a consent banner, because there is nothing to consent to. Mastande sets
 * one cookie — the httpOnly refresh token — which is strictly necessary and
 * therefore exempt under both POPIA s.11 and the ECT Act.
 *
 * The previous version asked permission for analytics and advertising cookies
 * that do not exist. That was worse than useless: it recorded a choice nothing
 * read, and it implied third-party trackers we deliberately do not run.
 *
 * If an optional cookie is ever added, this must go back to being a real
 * consent banner with reject as easy as accept.
 */
@Component({
  selector: 'app-cookie-consent',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showBanner()) {
      <div class="cookie-notice" role="region" aria-label="Cookie notice">
        <h3 class="cookie-notice__title">🍪 One cookie</h3>
        <p class="cookie-notice__body">
          Mastande sets a single cookie, to keep you signed in. No analytics
          cookies, no advertising cookies, no third-party trackers — not
          switched off, never added.
          <a routerLink="/legal/cookies">How we handle this</a>
        </p>
        <button type="button" class="cookie-notice__ok" (click)="acknowledge()">
          Got it
        </button>
      </div>
    }
  `,
  styles: [`
    .cookie-notice {
      position: fixed; bottom: 1rem; left: 1rem; right: 1rem; max-width: 420px;
      background: #1A1410; color: var(--white); border-radius: var(--r12); padding: 1.1rem;
      z-index: 9999; box-shadow: var(--shadow-xl);
    }
    .cookie-notice__title { font-size: .95rem; margin-bottom: .4rem; }
    .cookie-notice__body {
      font-size: .78rem; color: rgba(255,255,255,.72); line-height: 1.65;
      margin-bottom: .85rem;
    }
    .cookie-notice__body a { color: #D4A853; }
    .cookie-notice__ok {
      width: 100%; padding: .5rem; border-radius: var(--r4); border: none;
      background: var(--terra); color: var(--white); font-weight: 700; cursor: pointer;
      /* 30px before Phase 7q. Every first visit meets this button, and it is
         the only way to get the notice off the screen. Not a .btn, so the
         app-wide 44px rule never reached it. */
      min-height: 44px;
    }
  `],
})
export class CookieConsentBanner implements OnInit {
  /**
   * The signal moved to CookieNoticeService in Phase 7f.
   *
   * Not for tidiness: the walkthrough has to know whether this notice is still
   * up, because both are fixed to the bottom of the screen and this one is at
   * z-index 9999. A component signal cannot be read from a service, so every
   * new account got the notice drawn over the tour's buttons.
   */
  protected notice = inject(CookieNoticeService);
  protected readonly showBanner = this.notice.pending;

  /** DOCUMENT rather than the global, so this is safe under SSR. */
  private doc = inject(DOCUMENT);

  constructor() {
    /**
     * ── 2.4.11 Focus Not Obscured (Minimum), new in WCAG 2.2 ────────────
     *
     * 🔴 This notice is `position: fixed` at `z-index: 9999`, pinned to the
     * bottom with `left: 1rem; right: 1rem` and a 420px cap — so on a 390px
     * phone it covers nearly the full width of the bottom of the screen.
     * Anything focusable underneath is focused and INVISIBLE.
     *
     * Measured by scripts/a11y-keyboard-drive.mjs, pressing real Tab keys:
     * eleven controls entirely hidden on the board at 390px, ten on the
     * sign-in page, four at 1280px including the board's move-in date inputs,
     * and the whole legal footer column on /pricing. First visit, keyboard
     * user, on the device this product is built for.
     *
     * ⚠️ The class of bug was already known here. The comment above says the
     * walkthrough "has to know whether this notice is still up, because both
     * are fixed to the bottom of the screen and this one is at z-index 9999 —
     * every new account got the notice drawn over the tour's buttons". That
     * was fixed for the walkthrough, by sharing a signal. Nothing was done
     * for everything ELSE at the bottom of every page, which is most of the
     * footer and, on a phone, the board's own controls.
     *
     * The fix is to RESERVE THE SPACE rather than to scroll around it.
     * `scroll-padding-bottom` alone does not work: it only applies when a
     * scroll happens, and a control already sitting under the notice never
     * triggers one — Tab focuses it where it is and the browser sees no
     * reason to move. Adding real padding to the document means nothing is
     * ever under the notice in the first place. The scroll-padding is kept
     * as well, for the case where a scroll does happen.
     */
    effect(() => {
      this.doc.body?.classList.toggle('has-cookie-notice', this.showBanner());
    });

    /**
     * The reserve is MEASURED, not guessed.
     *
     * The notice's height depends on how the body text wraps, which depends on
     * the viewport — it is three lines at 1280px and six at 360px. A constant
     * would be too small at the narrow end (still obscured) or leave a gap
     * above the footer at the wide end. A ResizeObserver keeps the number
     * right through a rotation or a text-size change.
     */
    afterNextRender(() => {
      const root = this.doc.documentElement;
      if (!root || typeof ResizeObserver === 'undefined') return;
      const measure = () => {
        const el = this.doc.querySelector('.cookie-notice');
        root.style.setProperty('--cookie-notice-h', el ? `${Math.ceil(el.getBoundingClientRect().height)}px` : '0px');
      };
      measure();

      /**
       * ── The half that padding cannot fix ────────────────────────────────
       *
       * 🔴 Reserving space at the end of the document was necessary and NOT
       * sufficient, and the drive said so: it took the obscured count from 21
       * to 10 and stopped. The reason is worth stating, because it is easy to
       * believe the padding is the whole answer.
       *
       * Padding protects the END OF THE DOCUMENT. This notice is fixed to the
       * VIEWPORT, so it covers the bottom-left of the screen permanently —
       * including ordinary mid-page content while somebody is scrolled halfway
       * down. No amount of padding reaches that.
       *
       * `scroll-padding-bottom` does not reach it either, and for a subtler
       * reason: the browser only scrolls a newly focused element into view
       * when it is NOT already in view, and an element under the notice is in
       * view — it is merely covered. So nothing moves.
       *
       * Hence this: when focus lands on something the notice overlaps, scroll
       * it clear deliberately. `block: 'center'` rather than 'nearest',
       * because 'nearest' considers an already-visible element to need no
       * movement, which is the exact blind spot above.
       */
      const clearFocusFromNotice = (event: Event) => {
        const el = event.target;
        if (!(el instanceof HTMLElement)) return;
        const notice = this.doc.querySelector('.cookie-notice');
        if (!notice || notice.contains(el)) return;
        const a = el.getBoundingClientRect();
        const b = notice.getBoundingClientRect();
        const overlaps = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        if (!overlaps) return;
        /**
         * 🔴 'instant', NOT 'auto'.
         *
         * `behavior: 'auto'` does not mean "jump" — it means "use the CSS
         * `scroll-behavior` value", and this app sets `scroll-behavior:
         * smooth` on html. So the first version of this animated the scroll
         * over several hundred milliseconds, and every measurement taken just
         * after focus read the element still sitting under the notice. I spent
         * four probes concluding the scroll was a no-op when it was merely
         * unfinished.
         *
         * 'instant' is also the right behaviour on its own merits: a page that
         * glides when you Tab is disorienting, and a keyboard user moving
         * quickly would outrun the animation.
         */
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
      };
      this.doc.addEventListener('focusin', clearFocusFromNotice);

      const ro = new ResizeObserver(measure);
      const el = this.doc.querySelector('.cookie-notice');
      if (el) ro.observe(el);
      /**
       * Re-measure when the notice appears or goes away, since the element
       * itself is created and destroyed by the @if in the template.
       *
       * 🔴 This was an `effect()` reading showBanner(), and it threw
       * NG0203 — "effect() can only be used within an injection context" —
       * because afterNextRender's callback is not one. The error was swallowed
       * into the console, so the component looked like it worked.
       *
       * A MutationObserver needs no injection context and watches the thing
       * that actually changes: the element's presence in the DOM.
       */
      const mo = new MutationObserver(() => {
        measure();
        const now = this.doc.querySelector('.cookie-notice');
        if (now) ro.observe(now);
      });
      if (this.doc.body) mo.observe(this.doc.body, { childList: true, subtree: true });
    });
  }

  ngOnInit() {
    this.notice.check();
  }

  /**
   * An acknowledgement, not a consent choice.
   *
   * The banner used to ask permission for analytics and advertising cookies.
   * Neither category exists — the UX counters store no identifier and set no
   * cookie, and ad targeting is contextual — so the choice was recorded and
   * then read by nothing. Asking for consent we do not need implies trackers
   * we do not have, which is worse than saying nothing.
   *
   * The one cookie is the refresh token: httpOnly, sameSite strict, and
   * strictly necessary, so it needs no consent under POPIA or the ECT Act.
   */
  acknowledge() {
    const record: CookieAcknowledgement = {
      acknowledged: true,
      version: 2,
      timestamp: new Date().toISOString(),
    };
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(record));
    } catch {
      // Blocked site data. The notice still goes away for this visit — holding
      // it up because we could not write a record would punish the person for
      // their own browser setting.
    }
    this.notice.acknowledged();
  }
}
