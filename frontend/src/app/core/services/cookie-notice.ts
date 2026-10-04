import { Injectable, signal } from '@angular/core';

/**
 * The key the acknowledgement is stored under.
 *
 * ⚠️ The SAME string the banner has always used. Inventing a new one here
 * would have shown the notice afresh to every person who had already
 * dismissed it — a migration nobody asked for, hidden inside a refactor.
 */
export const COOKIE_CONSENT_KEY = 'rb_cookie_notice_v2';

/**
 * Whether the cookie notice is still on screen — Phase 7f.
 *
 * ── Why this is a service and not a component signal
 *
 * Two things want the bottom of a first-time visitor's screen: this notice
 * (`position: fixed; bottom: 1rem; z-index: 9999`) and the walkthrough sheet.
 * Every brand-new account got both at once, with the notice drawn OVER the
 * tour's buttons — found by a drive whose click on "Next" was intercepted
 * thirteen times by `.cookie-notice`, which is also exactly what a person with
 * a thumb would have experienced.
 *
 * Raising the walkthrough above it would be worse: that buries a notice about
 * cookies under an advert for the product. So they are sequenced — notice
 * first, tour second — and sequencing needs one piece of state that both can
 * read, which a component signal is not.
 *
 * ── Still localStorage, deliberately
 *
 * Unlike the walkthrough's own flag, this one belongs in the browser: it is an
 * acknowledgement that THIS BROWSER has been told about the cookie, and it is
 * shown to signed-out visitors who have no account to record anything against.
 */
@Injectable({ providedIn: 'root' })
export class CookieNoticeService {
  /**
   * True while the notice is up. Starts false so the server-rendered first
   * paint has no notice in it — localStorage cannot be read during prerender,
   * and guessing would mean flashing it at people who have dismissed it.
   */
  readonly pending = signal(false);

  /** Called by the banner on init, in the browser only. */
  check() {
    if (typeof localStorage === 'undefined') return;
    try {
      this.pending.set(!localStorage.getItem(COOKIE_CONSENT_KEY));
    } catch {
      // Private mode, or site data blocked. Showing the notice is the safe
      // side: an extra notice is an annoyance, a missing one is a compliance
      // claim we cannot support.
      this.pending.set(true);
    }
  }

  acknowledged() {
    this.pending.set(false);
  }
}
