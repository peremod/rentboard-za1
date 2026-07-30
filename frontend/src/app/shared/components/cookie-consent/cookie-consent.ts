import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface CookieConsent {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  timestamp: string;
  version: string;
}

const CONSENT_KEY = 'rb_cookie_consent';
const CONSENT_VERSION = '1.0';
const CONSENT_EXPIRY_DAYS = 365;

/**
 * POPIA-compliant cookie consent banner (s.11(1)(a)).
 * Rejecting is exactly as easy as accepting — no dark patterns. Re-asks after
 * 365 days or when CONSENT_VERSION changes. Rendered once, globally, from App.
 */
@Component({
  selector: 'app-cookie-consent',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showBanner()) {
      <div style="position:fixed;bottom:1rem;left:1rem;right:1rem;max-width:420px;background:#1A1410;color:#fff;border-radius:10px;padding:1.1rem;z-index:9999;font-family:sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.3)">
        <h3 style="font-size:.95rem;margin-bottom:.4rem">🍪 Cookies &amp; Privacy</h3>
        <p style="font-size:.78rem;color:rgba(255,255,255,.7);line-height:1.6;margin-bottom:.85rem">
          We use strictly necessary cookies to run RentBoard. With your permission we'd also like to use analytics
          cookies to improve it. <a routerLink="/legal/cookies" style="color:#D4A853">Cookie policy</a>
        </p>

        @if (!showCustomise()) {
          <div style="display:flex;gap:.5rem;flex-wrap:wrap">
            <button type="button" (click)="rejectAll()" style="flex:1;padding:.5rem;border-radius:4px;border:1px solid rgba(255,255,255,.3);background:transparent;color:#fff;cursor:pointer">Reject optional</button>
            <button type="button" (click)="acceptAll()" style="flex:1;padding:.5rem;border-radius:4px;border:none;background:#C04E28;color:#fff;font-weight:700;cursor:pointer">Accept all</button>
          </div>
          <button type="button" (click)="showCustomise.set(true)" style="margin-top:.5rem;background:none;border:none;color:rgba(255,255,255,.5);font-size:.72rem;cursor:pointer">Customise</button>
        } @else {
          <label style="display:flex;align-items:center;gap:.5rem;font-size:.78rem;margin-bottom:.4rem">
            <input type="checkbox" [checked]="analyticsConsent()" (change)="analyticsConsent.set($any($event.target).checked)"/>
            Analytics cookies
          </label>
          <label style="display:flex;align-items:center;gap:.5rem;font-size:.78rem;margin-bottom:.75rem">
            <input type="checkbox" [checked]="marketingConsent()" (change)="marketingConsent.set($any($event.target).checked)"/>
            Partner / referral cookies
          </label>
          <button type="button" (click)="saveCustom()" style="width:100%;padding:.5rem;border-radius:4px;border:none;background:#C04E28;color:#fff;font-weight:700;cursor:pointer">Save preferences</button>
        }
      </div>
    }
  `,
})
export class CookieConsentBanner implements OnInit {
  showBanner = signal(false);
  showCustomise = signal(false);
  analyticsConsent = signal(false);
  marketingConsent = signal(false);

  ngOnInit() {
    const stored = this.getStoredConsent();
    if (!stored || !this.isValid(stored)) {
      setTimeout(() => this.showBanner.set(true), 800);
    } else {
      this.applyConsent(stored);
    }
  }

  acceptAll() {
    this.save({ necessary: true, analytics: true, marketing: true });
  }

  rejectAll() {
    this.save({ necessary: true, analytics: false, marketing: false });
  }

  saveCustom() {
    this.save({ necessary: true, analytics: this.analyticsConsent(), marketing: this.marketingConsent() });
  }

  private save(prefs: Omit<CookieConsent, 'timestamp' | 'version'>) {
    const consent: CookieConsent = { ...prefs, timestamp: new Date().toISOString(), version: CONSENT_VERSION };
    localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
    this.applyConsent(consent);
    this.showBanner.set(false);
  }

  private applyConsent(consent: CookieConsent) {
    if (!consent.analytics) sessionStorage.setItem('rb_analytics_disabled', 'true');
    else sessionStorage.removeItem('rb_analytics_disabled');
  }

  private getStoredConsent(): CookieConsent | null {
    try {
      const raw = localStorage.getItem(CONSENT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private isValid(consent: CookieConsent): boolean {
    if (consent.version !== CONSENT_VERSION) return false;
    const ageMs = Date.now() - new Date(consent.timestamp).getTime();
    return ageMs < CONSENT_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  }
}
