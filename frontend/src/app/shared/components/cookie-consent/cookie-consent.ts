import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
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
      background: #1A1410; color: #fff; border-radius: 10px; padding: 1.1rem;
      z-index: 9999; box-shadow: 0 12px 32px rgba(0,0,0,.3);
    }
    .cookie-notice__title { font-size: .95rem; margin-bottom: .4rem; }
    .cookie-notice__body {
      font-size: .78rem; color: rgba(255,255,255,.72); line-height: 1.65;
      margin-bottom: .85rem;
    }
    .cookie-notice__body a { color: #D4A853; }
    .cookie-notice__ok {
      width: 100%; padding: .5rem; border-radius: 4px; border: none;
      background: var(--terra); color: #fff; font-weight: 700; cursor: pointer;
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
