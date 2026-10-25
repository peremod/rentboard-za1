import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, effect,
  inject, signal, viewChild,
} from '@angular/core';
import { DOCUMENT, NgTemplateOutlet, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { Icon } from '../icon/icon';
import { LangSwitcher } from '../lang-switcher/lang-switcher';
import { Logo } from '../logo/logo';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * Auth-aware navbar. Shows different actions based on AuthService signals —
 * no hardcoded role strings, no duplicated auth logic.
 */
@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, RouterLinkActive, Icon, LangSwitcher, Logo, TranslatePipe],
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
        <app-logo size="lg"/>

        <!-- The scrim. It is not decoration: without it the drawer was a
             dark panel over a dark hero with no boundary between them, and
             nothing outside the drawer said "this is closed by tapping
             away". Rendered before the panel so the panel wins on order. -->
        @if (mobileOpen()) {
          <div class="nav-scrim" (click)="close()" aria-hidden="true"></div>
        }

        <div class="nav-links" id="nav-sheet" [class.open]="mobileOpen()" #sheet
             [attr.role]="mobileOpen() ? 'dialog' : null"
             [attr.aria-modal]="mobileOpen() ? 'true' : null"
             [attr.aria-label]="mobileOpen() ? 'Menu' : null">
          <!-- ⚠️ Rendered ONLY while the sheet is open, not merely styled
               for the drawer width.
               It shipped unconditional for one commit: .nav-links is the
               ordinary header row on a desktop, and :where(button) paints
               every button terracotta — so a red "✕ Close" sat in the
               header at 1280px, beside the logo, doing nothing. The
               drive's own desktop section missed it because it asked
               whether the BURGER and the SCRIM were absent and never
               whether anything belonging to the sheet had leaked out.
               Found by looking at a screenshot of the dashboard. -->
          <!-- ⚠️ There WAS a "✕ Close" button here, and it is gone at the
               owner's request after seeing it on a phone.
               The reasoning that put it in — "the burger is at the top-right
               and a thumb that has just scrolled the sheet is nowhere near
               it" — described a sheet that scrolls. This one opens at the top
               with the burger a thumb's width above it, already showing an ✕,
               already labelled "Close menu", and the scrim and Escape both
               close it too. Four ways out, one of them taking the first screen
               of the menu and pushing the links people came for further down.
               Focus still enters the sheet on open: it lands on the first link
               now rather than on a button whose only job was to undo the tap
               that opened it. -->
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"
             (click)="close()">{{ 'nav.browse_rooms' | translate }}</a>
          <a routerLink="/how-it-works" routerLinkActive="active"
             (click)="close()">How it works</a>
          <a routerLink="/pricing" routerLinkActive="active"
             (click)="close()">Pricing</a>
          <!-- ⚠️ Demoted, not removed. In the drawer these three sat at the
               same size and weight as Browse rooms, so a person opening the
               menu on a phone met six links of which half were legal pages
               and one was where they wanted to go. They stay reachable
               because the footer is a long scroll away on a phone. -->
          <div class="nav-links__legal">
            <a routerLink="/legal/privacy" routerLinkActive="active" (click)="close()">Privacy</a>
            <a routerLink="/legal/terms" routerLinkActive="active" (click)="close()">Terms</a>
            <a routerLink="/legal/disclaimer" routerLinkActive="active" (click)="close()">Disclaimer</a>
          </div>

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

        <!-- ⚠️ Was the character U+2630, which is not an icon: it is a
             typeface's idea of three lines, so it arrived at a different
             weight and a different width on every handset, and could not be
             sized or aligned with anything beside it.

             aria-controls as well as aria-expanded, so the state names the
             thing it belongs to; aria-label changes with the state because
             "Toggle navigation" told a screen-reader user nothing about
             which way it was about to go. -->
        <button type="button" class="nav-burger" (click)="toggle()"
                id="nav-burger" aria-controls="nav-sheet"
                [attr.aria-expanded]="mobileOpen()"
                [attr.aria-label]="mobileOpen() ? 'Close menu' : 'Open menu'">
          <app-icon [name]="mobileOpen() ? 'x' : 'menu'"/>
        </button>
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

  private doc = inject(DOCUMENT);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private sheet = viewChild<ElementRef<HTMLElement>>('sheet');

  constructor() {
    /**
     * Scroll lock.
     *
     * ⚠️ The drawer has never had one. Opening it left the page scrolling
     * underneath, so a thumb that started on the panel and travelled past
     * its edge moved the board instead — and because the panel is
     * positioned against the header rather than the viewport, the menu
     * then slid away up the screen while still open.
     *
     * `overflow-y` and not `overflow`: body already carries
     * `overflow-x:hidden` from _spec.scss, and setting the shorthand here
     * would quietly drop it on every close.
     */
    effect(() => {
      if (!this.isBrowser) return;
      this.doc.body.style.overflowY = this.mobileOpen() ? 'hidden' : '';
    });

    // Focus goes into the sheet when it opens, and back to the burger when
    // it shuts. Without this, opening the menu leaves focus on a button the
    // sheet now covers, and the first Tab lands somewhere behind it.
    effect(() => {
      if (!this.isBrowser) return;
      const open = this.mobileOpen();
      queueMicrotask(() => {
        // The first link in the sheet, because the Close button that used to
        // take this focus is gone. Not the burger: it is outside the sheet,
        // so landing there would put the first Tab back at the top of the
        // page rather than in the menu that just opened.
        if (open) this.firstFocusable()?.focus();
        else if (this.wasOpen) this.doc.getElementById('nav-burger')?.focus();
        this.wasOpen = open;
      });
    });
  }

  private wasOpen = false;

  toggle() {
    this.mobileOpen.set(!this.mobileOpen());
  }

  close() {
    this.mobileOpen.set(false);
  }

  /**
   * ⚠️ Escape did not close the drawer. On a phone that reads as a stuck
   * menu; on a desktop keyboard it is the only way out that does not
   * involve finding the burger again.
   */
  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.mobileOpen()) this.close();
  }

  /**
   * The focus trap.
   *
   * aria-modal says the rest of the page is inert, and it was not: Tab
   * walked straight out of the sheet into the board behind it, which is
   * worse than no dialog role at all because a screen reader has been told
   * the opposite. Cycles within the sheet, both directions.
   */
  /**
   * The first thing in the sheet a person can land on.
   *
   * Shares the trap's selector below rather than keeping a second list: two
   * definitions of "focusable" is how the first element of the trap and the
   * element that receives focus on open end up being different elements.
   */
  private firstFocusable(): HTMLElement | null {
    const root = this.sheet()?.nativeElement;
    if (!root) return null;
    return Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])',
      ),
    ).find((el) => el.offsetParent !== null) ?? null;
  }

  @HostListener('document:keydown.tab', ['$event'])
  @HostListener('document:keydown.shift.tab', ['$event'])
  onTab(raw: Event) {
    const event = raw as KeyboardEvent;
    if (!this.mobileOpen() || !this.isBrowser) return;
    const root = this.sheet()?.nativeElement;
    if (!root) return;
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])',
      ),
    ).filter((el) => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = this.doc.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  logout() {
    this.close();
    this.auth.logout();
  }
}
