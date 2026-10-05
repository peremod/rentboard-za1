import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NavigationEnd, Router } from '@angular/router';
import { filter, take, tap } from 'rxjs';
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
  private router = inject(Router);

  /** Closed in this tab, before the server has confirmed. */
  private readonly dismissed = signal(false);

  /**
   * "Show me around again" has been pressed and the tour is waiting for the
   * next screen.
   *
   * ⚠️ Its own flag, because neither existing one can express this.
   *
   * `dismissed` cannot: a page load resets it to false, so on a freshly loaded
   * settings page clearing the server stamp made the tour open INSTANTLY, over
   * the button just pressed and the message explaining what would happen. And
   * leaving `dismissed` set — which is what the code did for three releases —
   * means `shouldShow()` returns false forever, so the button did nothing at
   * all in-session: the tour only came back on a hard refresh.
   *
   * One bug was traded for the other because both were being carried on one
   * signal. This is the missing state: armed, and not yet.
   */
  private readonly armedForNextScreen = signal(false);

  /**
   * Show it?
   *
   * Only for a signed-in account whose session has actually resolved — before
   * that the app does not know who is here, and showing a welcome to somebody
   * mid-refresh is the same flash the navbar's `sessionResolved` exists to
   * avoid.
   */
  readonly shouldShow = computed(() => {
    if (this.armedForNextScreen()) return false;
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

  /**
   * "Show me around again", from account settings.
   *
   * ⚠️ This button did nothing for three releases, and the comment that used to
   * sit here argued for the behaviour without noticing it.
   *
   * It cleared the server stamp and deliberately left `dismissed` set, on the
   * reasoning that the tour would then "open on the next screen". But
   * `shouldShow()`'s first line was `if (this.dismissed()) return false`, and
   * nothing cleared that signal. In an Angular SPA the next screen is a route
   * change, not a page load, so it survived every one. Anybody who had closed
   * the tour earlier pressed the button, read that it would open on the next
   * screen, and never saw it again without a hard refresh.
   *
   * Simply clearing `dismissed` is the other bug: on a freshly loaded settings
   * page it is already false, so the tour opened instantly on top of the button
   * — which is what the old comment was describing.
   *
   * `armedForNextScreen` holds the state neither signal could, and the promise
   * is now kept literally: suppressed here, released on the first navigation to
   * a DIFFERENT url. A same-page navigation — a query parameter, a fragment —
   * does not count, or the tour lands back on this screen.
   */
  replay() {
    return this.http.post<{ walkthroughSeenAt: string | null }>(
      `${this.api}/users/me/walkthrough-reset`, {},
    ).pipe(
      tap((res) => {
        this.armedForNextScreen.set(true);
        this.auth.patchUser({ walkthroughSeenAt: res.walkthroughSeenAt });
        const from = this.router.url;
        this.router.events
          .pipe(
            filter((e): e is NavigationEnd => e instanceof NavigationEnd),
            filter((e) => e.urlAfterRedirects !== from),
            take(1),
          )
          .subscribe(() => {
            this.dismissed.set(false);
            this.armedForNextScreen.set(false);
          });
      }),
    );
  }
}
