import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { BILLING_ENABLED } from '../../../core/config/feature-flags';
import { LangSwitcher } from '../lang-switcher/lang-switcher';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * Auth-aware navbar. Shows different actions based on AuthService signals —
 * no hardcoded role strings, no duplicated auth logic.
 */
@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, LangSwitcher, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="nav">
      <div class="nav-inner">
        <a class="nav-logo" routerLink="/">Rent<span>Board</span></a>

        <div class="nav-links" [class.open]="mobileOpen()">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"
             (click)="mobileOpen.set(false)">{{ 'nav.browse_rooms' | translate }}</a>
          <!-- Pricing is guarded by billingEnabledGuard; with billing paused
               that guard redirects home, so linking to it looks broken. -->
          @if (auth.isLandlord() && billingEnabled) {
            <a routerLink="/landlord/upgrade" routerLinkActive="active" (click)="mobileOpen.set(false)">Pricing</a>
          }
          <a routerLink="/legal/privacy" routerLinkActive="active" (click)="mobileOpen.set(false)">Privacy</a>
          <a routerLink="/legal/terms" routerLinkActive="active" (click)="mobileOpen.set(false)">Terms</a>
          <a routerLink="/legal/disclaimer" routerLinkActive="active" (click)="mobileOpen.set(false)">Disclaimer</a>

          <!-- Shown only inside the drawer on small screens, where the
               header copy of the switcher is hidden for space. -->
          <div class="nav-links-lang"><app-lang-switcher/></div>
        </div>

        <div class="nav-actions">
          <app-lang-switcher/>
          @if (auth.isAdmin()) {
            <a routerLink="/admin/dashboard" routerLinkActive="active"
               (click)="mobileOpen.set(false)">Admin</a>
          }
          @if (auth.isAuthenticated()) {
            @if (auth.isLandlord()) {
              <a class="btn btn-ghost btn-sm" routerLink="/landlord/dashboard">{{ 'nav.dashboard' | translate }}</a>
              <a class="btn btn-primary btn-sm" routerLink="/landlord/rooms/new">+ List a room</a>
            } @else {
              <a class="btn btn-ghost btn-sm" routerLink="/tenant/dashboard">{{ 'nav.dashboard' | translate }}</a>
            }
            <button type="button" class="btn btn-ghost btn-sm" (click)="logout()">{{ 'nav.logout' | translate }}</button>
          } @else {
            <a class="btn btn-ghost btn-sm" routerLink="/auth/login">{{ 'nav.login' | translate }}</a>
            <a class="btn btn-primary btn-sm" routerLink="/auth/register">{{ 'nav.get_started' | translate }}</a>
          }
        </div>

        <button type="button" class="nav-burger" (click)="mobileOpen.set(!mobileOpen())"
                [attr.aria-expanded]="mobileOpen()" aria-label="Toggle navigation">☰</button>
      </div>
    </nav>
  `,
})
export class Navbar {
  readonly billingEnabled = BILLING_ENABLED;
  auth = inject(AuthService);
  mobileOpen = signal(false);

  logout() {
    this.mobileOpen.set(false);
    this.auth.logout();
  }
}
