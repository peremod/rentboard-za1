import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '@env/environment';
import { AuthService } from './auth.service';
import { CookieNoticeService } from './cookie-notice';

/**
 * Whether to show somebody round, and remembering that we did — Phase 7f.
 *
 * ── Why the server decides
 *
 * The flag is `User.walkthroughSeenAt`, on the account. localStorage is the
 * obvious choice and wrong twice over here: a phone in this market is shared,
 * borrowed and replaced, so a per-browser flag shows the walkthrough to
 * somebody who has already seen it and never reaches the person who has not —
 * and the app renders on the server, where there is no localStorage to read on
 * the first paint.
 *
 * ── Dismissed is remembered immediately, locally AND on the server
 *
 * `dismissed` is a local signal so closing it is instant, and the write is
 * fire-and-forget. If the write fails the walkthrough comes back on the next
 * visit, which is the right way round: an extra welcome is a small annoyance,
 * a lost one is a feature nobody ever learns about.
 */
@Injectable({ providedIn: 'root' })
export class WalkthroughService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;
  private auth = inject(AuthService);
  private cookieNotice = inject(CookieNoticeService);

  /** Closed in this tab, before the server has confirmed. */
  private readonly dismissed = signal(false);

  /**
   * Show it?
   *
   * Only for a signed-in account whose session has actually resolved — before
   * that the app does not know who is here, and showing a welcome to somebody
   * mid-refresh is the same flash the navbar's `sessionResolved` exists to
   * avoid.
   */
  readonly shouldShow = computed(() => {
    if (this.dismissed()) return false;
    if (!this.auth.sessionResolved() || !this.auth.isAuthenticated()) return false;
    /**
     * ⚠️ Not while the cookie notice is up.
     *
     * Both are fixed to the bottom of the screen and the notice is at z-index
     * 9999, so a brand-new account got the notice drawn OVER the tour's
     * buttons. A drive found it by having thirteen clicks on "Next"
     * intercepted by `.cookie-notice`, which is exactly what a thumb would
     * have found.
     *
     * Sequenced rather than restacked: raising the tour above the notice would
     * bury a notice about cookies under an advert for the product. The notice
     * is small and goes away on one tap; the tour waits its turn.
     */
    if (this.cookieNotice.pending()) return false;
    return !this.auth.user()?.walkthroughSeenAt;
  });

  /** Finished or skipped — the same thing as far as the record goes. */
  dismiss() {
    this.dismissed.set(true);
    this.http.post<{ walkthroughSeenAt: string | null }>(
      `${this.api}/users/me/walkthrough-seen`, {},
    ).pipe(tap((res) => this.auth.patchUser({ walkthroughSeenAt: res.walkthroughSeenAt })))
      .subscribe({ error: () => {} });
  }

  /** "Show me around again", from account settings. */
  replay() {
    return this.http.post<{ walkthroughSeenAt: string | null }>(
      `${this.api}/users/me/walkthrough-reset`, {},
    ).pipe(tap((res) => this.auth.patchUser({ walkthroughSeenAt: res.walkthroughSeenAt })));
    /**
     * ⚠️ `dismissed` is deliberately NOT cleared here.
     *
     * The stamp is gone, so the tour will open on the next screen — which is
     * what the settings page's own confirmation says. Clearing the local flag
     * too made it open instantly, on top of the button that had just been
     * pressed and over the message explaining what had happened. The copy
     * promised the next screen; the code now keeps that promise.
     */
  }
}
