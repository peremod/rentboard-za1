import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
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
  imports: [NgTemplateOutlet, RouterLink, RouterLinkActive, LangSwitcher, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="nav">
      <!-- The auth state, on the element the responsive layer keys off.
           CSS cannot ask AuthService whether anyone is signed in, and the two
           cases want opposite things on a phone: a VISITOR must keep Log in and
           Get started in the header (they are what the header is for), while a
           signed-in landlord has Dashboard, List a room and Log out, which do
           not fit beside a logo at 360px and belong in the drawer. One class,
           so the rule can say which. -->
      <div class="nav-inner" [class.is-signed-in]="auth.isAuthenticated()">
        <a class="nav-logo" routerLink="/">Mas<span>tande</span></a>

        <div class="nav-links" [class.open]="mobileOpen()">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"
             (click)="mobileOpen.set(false)">{{ 'nav.browse_rooms' | translate }}</a>
          <a routerLink="/how-it-works" routerLinkActive="active"
             (click)="mobileOpen.set(false)">How it works</a>
          <a routerLink="/pricing" routerLinkActive="active"
             (click)="mobileOpen.set(false)">Pricing</a>
          <a routerLink="/legal/privacy" routerLinkActive="active" (click)="mobileOpen.set(false)">Privacy</a>
          <a routerLink="/legal/terms" routerLinkActive="active" (click)="mobileOpen.set(false)">Terms</a>
          <a routerLink="/legal/disclaimer" routerLinkActive="active" (click)="mobileOpen.set(false)">Disclaimer</a>

          <!-- Shown only inside the drawer on small screens, where the
               header copy of the switcher is hidden for space. -->
          <div class="nav-links-lang"><app-lang-switcher/></div>

          <!-- The SAME auth actions as the header, not a second copy of them.
               At mobile width .nav-actions .btn-ghost is hidden for space,
               and the rule's own comment said the secondary action "moves into
               the drawer" — it never did. So on a phone: a returning visitor
               had no Log in at all, a signed-in landlord had no Dashboard and
               no Log out, and an admin had nothing whatsoever. Reported from a
               phone, and the worst of it was not the part reported.

               One ng-template rendered twice rather than duplicated markup:
               this repo has already paid for the other choice with a nav
               defined six times that disagreed with itself. -->
          <div class="nav-links-auth"><ng-container [ngTemplateOutlet]="authActions"/></div>
        </div>

        <div class="nav-actions">
          <app-lang-switcher/>
          <ng-container [ngTemplateOutlet]="authActions"/>
        </div>

        <button type="button" class="nav-burger" (click)="mobileOpen.set(!mobileOpen())"
                [attr.aria-expanded]="mobileOpen()" aria-label="Toggle navigation">☰</button>
      </div>
    </nav>

    <ng-template #authActions>
      @if (auth.isAuthenticated()) {
        <!-- One dashboard per account. An admin used to get both an Admin link
             and a Dashboard button pointing at the tenant view, which is empty
             for an account with no tenant profile. -->
        <!-- ⚠️ nav-home is why these three carry a second class.
             At mobile width the rule
             .nav-inner.is-signed-in .nav-actions .btn-ghost was display:none,
             which hid EVERY ghost action a signed-in
             account had — and for a tenant those were Dashboard and Log out,
             i.e. all of them. So a signed-in person who tapped Browse rooms
             had no way back into their own portal except opening the burger
             and finding it among six public links. Reported as "too much
             friction and bad UX", and it is: the one thing a signed-in
             account needs from a public page is the way back.
             The class marks the ONE ghost action that stays, so the rule can
             name it instead of hiding the lot. -->
        @if (auth.isAdmin()) {
          <a class="btn btn-ghost btn-sm nav-home" routerLink="/admin/dashboard" routerLinkActive="active"
             (click)="mobileOpen.set(false)">Admin</a>
        } @else if (auth.isLandlord()) {
          <a class="btn btn-ghost btn-sm nav-home" routerLink="/landlord/dashboard"
             (click)="mobileOpen.set(false)">{{ 'nav.dashboard' | translate }}</a>
          <a class="btn btn-primary btn-sm" routerLink="/landlord/rooms/new"
             (click)="mobileOpen.set(false)">+ List a room</a>
        } @else {
          <a class="btn btn-ghost btn-sm nav-home" routerLink="/tenant/dashboard"
             (click)="mobileOpen.set(false)">{{ 'nav.dashboard' | translate }}</a>
        }
        <button type="button" class="btn btn-ghost btn-sm" (click)="logout()">{{ 'nav.logout' | translate }}</button>
      } @else if (auth.sessionResolved()) {
        <!-- Only once the startup refresh has settled. Before that the app does
             not know whether anyone is signed in, and showing Log in to someone
             who is signed in makes every reload flash. -->
        <a class="btn btn-ghost btn-sm" routerLink="/auth/login"
           (click)="mobileOpen.set(false)">{{ 'nav.login' | translate }}</a>
        <a class="btn btn-primary btn-sm" routerLink="/auth/register"
           (click)="mobileOpen.set(false)">{{ 'nav.get_started' | translate }}</a>
      }
    </ng-template>
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
