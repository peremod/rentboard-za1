import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
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
             (click)="mobileOpen.set(false)">Browse rooms</a>
          @if (auth.isLandlord()) {
            <a routerLink="/landlord/upgrade" routerLinkActive="active" (click)="mobileOpen.set(false)">Pricing</a>
          }
          <a routerLink="/legal/terms" routerLinkActive="active" (click)="mobileOpen.set(false)">Legal</a>
        </div>

        <div class="nav-actions">
          <app-lang-switcher/>
          @if (auth.isAuthenticated()) {
            @if (auth.isLandlord()) {
              <a class="btn btn-ghost btn-sm" routerLink="/landlord/dashboard">My rooms</a>
              <a class="btn btn-primary btn-sm" routerLink="/landlord/rooms/new">+ List a room</a>
            } @else {
              <a class="btn btn-ghost btn-sm" routerLink="/tenant/dashboard">My applications</a>
            }
            <button type="button" class="btn btn-ghost btn-sm" (click)="logout()">Log out</button>
          } @else {
            <a class="btn btn-ghost btn-sm" routerLink="/auth/login">Log in</a>
            <a class="btn btn-primary btn-sm" routerLink="/auth/register">Get started free</a>
          }
        </div>

        <button type="button" class="nav-burger" (click)="mobileOpen.set(!mobileOpen())"
                [attr.aria-expanded]="mobileOpen()" aria-label="Toggle navigation">☰</button>
      </div>
    </nav>
  `,
})
export class Navbar {
  auth = inject(AuthService);
  mobileOpen = signal(false);

  logout() {
    this.mobileOpen.set(false);
    this.auth.logout();
  }
}
