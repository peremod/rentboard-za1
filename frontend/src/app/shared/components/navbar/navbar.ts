import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Auth-aware navbar. Shows different actions based on AuthService signals —
 * no hardcoded role strings, no duplicated auth logic.
 */
@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="navbar">
      <div class="navbar__inner">
        <a routerLink="/" class="navbar__logo">Rent<span>Board</span></a>

        <nav class="navbar__links" [class.open]="mobileOpen()">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{exact:true}" (click)="mobileOpen.set(false)">Browse rooms</a>
          <a routerLink="/legal/terms" routerLinkActive="active" (click)="mobileOpen.set(false)">Legal</a>

          @if (!auth.isAuthenticated()) {
            <a routerLink="/auth/login" (click)="mobileOpen.set(false)">Log in</a>
            <a routerLink="/auth/register" class="navbar__cta" (click)="mobileOpen.set(false)">Get started</a>
          }
          @if (auth.isLandlord()) {
            <a routerLink="/landlord/dashboard" routerLinkActive="active" (click)="mobileOpen.set(false)">Dashboard</a>
            <button type="button" (click)="logout()">Log out</button>
          }
          @if (auth.isTenant()) {
            <a routerLink="/tenant/dashboard" routerLinkActive="active" (click)="mobileOpen.set(false)">Dashboard</a>
            <button type="button" (click)="logout()">Log out</button>
          }
        </nav>

        <button type="button" class="navbar__hamburger" (click)="mobileOpen.update(v => !v)" [attr.aria-expanded]="mobileOpen()" aria-label="Toggle menu">☰</button>
      </div>
    </header>
  `,
  styles: [`
    .navbar { position: sticky; top: 0; z-index: 50; background: #1A1410; border-bottom: 3px solid #C04E28; }
    .navbar__inner { max-width: 1200px; margin: 0 auto; display: flex; align-items: center; gap: 1.5rem; padding: 0 1.25rem; height: 60px; }
    .navbar__logo { font-family: 'Playfair Display', serif; font-size: 1.4rem; font-weight: 900; color: #F5F0E8; text-decoration: none; flex-shrink: 0; }
    .navbar__logo span { color: #C04E28; }
    .navbar__links { display: flex; align-items: center; gap: 1.25rem; margin-left: auto; }
    .navbar__links a, .navbar__links button { color: rgba(255,255,255,.75); text-decoration: none; font-size: .85rem; font-weight: 600; background: none; border: none; cursor: pointer; font-family: inherit; }
    .navbar__links a.active, .navbar__links a:hover, .navbar__links button:hover { color: #F5F0E8; }
    .navbar__cta { background: #C04E28; color: #fff !important; padding: .45rem .9rem; border-radius: 4px; }
    .navbar__hamburger { display: none; background: none; border: none; color: #fff; font-size: 1.2rem; cursor: pointer; }
    @media (max-width: 768px) {
      .navbar__links { display: none; position: absolute; top: 60px; left: 0; right: 0; background: #1A1410; flex-direction: column; align-items: flex-start; padding: 1rem 1.25rem; gap: .75rem; }
      .navbar__links.open { display: flex; }
      .navbar__hamburger { display: block; }
    }
  `],
})
export class Navbar {
  auth = inject(AuthService);
  mobileOpen = signal(false);

  logout() {
    this.mobileOpen.set(false);
    this.auth.logout();
  }
}
