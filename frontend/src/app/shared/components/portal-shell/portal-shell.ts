import {
  ChangeDetectionStrategy, Component, ElementRef, PLATFORM_ID, effect, inject, input, signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../../core/services/auth.service';

export interface PortalNavItem {
  label: string;
  icon: string;
  route: string;
  /** Optional count badge, e.g. unread applications. Hidden when 0 or undefined. */
  badge?: number;
  /** Match the route exactly rather than by prefix (used for dashboard roots). */
  exact?: boolean;
  /**
   * Anchor on the destination page.
   *
   * Several of these items name a section of the dashboard rather than a page
   * of their own. Without a fragment they navigate to the dashboard root,
   * which — when you are already on the dashboard — looks exactly like a
   * click that did nothing. `anchorScrolling` is enabled in app.config.ts, so
   * a fragment here actually moves the page.
   */
  fragment?: string;
  /** Listed for parity with the design, but the feature does not exist yet. */
  disabled?: boolean;
}

/**
 * Portal shell — the sidebar + main layout used by both dashboards, matching
 * the visual spec's `portal-wrap`.
 *
 * Content is projected via <ng-content>, so each dashboard supplies only its
 * own body and never re-implements the chrome. The responsive layer turns the
 * sidebar into a horizontal scrolling tab strip below 860px.
 */
@Component({
  selector: 'app-portal-shell',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="portal-wrap">
      <nav class="portal-nav" [attr.aria-label]="roleLabel() + ' navigation'">
        <div class="portal-user">
          <div class="portal-avatar" [style.background]="avatarColour()">{{ initial() }}</div>
          <div class="portal-user-name">{{ auth.user()?.fullName }}</div>
          <div class="portal-user-role">{{ roleLabel() }}</div>
        </div>

        @for (item of navItems(); track item.label) {
          @if (item.disabled) {
            <span class="portal-nav-link is-disabled" aria-disabled="true" title="Coming soon">
              <span class="portal-nav-icon" aria-hidden="true">{{ item.icon }}</span>
              {{ item.label }}
              <span class="portal-nav-soon">Soon</span>
            </span>
          } @else {
            <a class="portal-nav-link" [routerLink]="item.route" [fragment]="item.fragment"
               [class.active]="isActive(item)"
               [attr.aria-current]="isActive(item) ? 'page' : null">
              <span class="portal-nav-icon" aria-hidden="true">{{ item.icon }}</span>
              {{ item.label }}
              @if (item.badge) { <span class="portal-nav-badge">{{ item.badge }}</span> }
            </a>
          }
        }

        @if (primaryAction(); as action) {
          <div class="portal-nav-cta">
            <a class="btn btn-primary" [routerLink]="action.route">{{ action.label }}</a>
          </div>
        }

        <button type="button" class="portal-nav-link portal-logout" (click)="auth.logout()">
          <span class="portal-nav-icon" aria-hidden="true">↪</span> Log out
        </button>
      </nav>

      <main class="portal-main">
        <!-- The portal's h1, and it had none. Not one screen behind a login had
             a top-level heading: the section titles are styled divs, so the
             heading outline of every portal page started at the footer's h2s
             and the page itself contributed nothing. Lighthouse never saw it
             because all four URLs it audits are public, and the accessibility
             drive did not cover the portal until now.

             It lives in the shell rather than in fourteen templates so a new
             portal screen cannot ship without one. -->
        @if (pageTitle()) {
          <h1 class="portal-title">{{ pageTitle() }}</h1>
        }
        <ng-content/>
      </main>
    </div>
  `,
})
export class PortalShell {
  auth = inject(AuthService);
  private router = inject(Router);
  private host = inject(ElementRef<HTMLElement>);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /**
   * The current URL, split into path and fragment.
   *
   * A signal rather than a template expression on `router.url`, because this
   * component is OnPush and a navigation does not otherwise mark it dirty.
   */
  private where = signal(this.split(this.router.url));

  readonly navItems = input.required<PortalNavItem[]>();
  /**
   * The page's own name, rendered as its h1. Not `input.required` only because
   * that would break every existing caller at once; scripts/a11y-drive.mjs
   * fails any portal page whose first heading is not an h1, which is the check
   * that keeps it from being forgotten.
   */
  readonly pageTitle = input<string>('');
  readonly roleLabel = input<string>('');
  readonly primaryAction = input<{ label: string; route: string } | null>(null);
  /** Landlords are terracotta, tenants sage — matches the spec's portal avatars. */
  readonly avatarColour = input<string>('var(--terra)');

  constructor() {
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.where.set(this.split(this.router.url)));

    // Bring "you are here" into view on the phone strip — Phase 7n.
    //
    // The strip is 2251px of nav in a 359px window, so at 360px a landlord sees
    // two of fourteen items and the active one is usually not among them: on
    // /tenant/passport it measured at x=437 in a 359px window. A highlight
    // nobody can see is not an orientation cue, and this is the one nav some
    // people will ever use.
    //
    // scrollLeft is assigned rather than scrollIntoView() called, because
    // scrollIntoView walks up the ancestors and will scroll the PAGE as well —
    // which on a portal screen means jumping the content the person was reading.
    effect(() => {
      this.where();
      if (!this.isBrowser) return;
      queueMicrotask(() => this.revealActive());
    });
  }

  initial() {
    return this.auth.user()?.fullName?.charAt(0).toUpperCase() ?? '?';
  }

  /**
   * Whether this item is the screen you are on.
   *
   * ⚠️ This was `routerLinkActive` with `{ exact: !!item.exact }`, and it was
   * wrong in two ways that the nav audit cannot see, because every link in it
   * resolves to a real route — the same blind spot as the footer in Phase 7e.
   *
   * 1. `Browse rooms` points at '/', and a non-exact match treats '/' as a
   *    prefix of every URL. It was therefore marked active on EVERY tenant
   *    screen: measured on all six, Rent and Passport included.
   * 2. `routerLinkActive` does not look at the fragment, so every item naming
   *    a section of the dashboard matched at once — five highlighted on the
   *    tenant dashboard, four on the landlord one. A nav that says you are in
   *    five places tells you nothing about which.
   *
   * So the rule lives here, in one readable place: a fragment item is active
   * only when that fragment is the one in the URL, and a route match is either
   * exact or a path-segment prefix — never a bare string prefix, which would
   * make /landlord/rooms match /landlord/rooms-archive.
   */
  isActive(item: PortalNavItem): boolean {
    const { path, fragment } = this.where();
    const onRoute = item.exact
      ? path === item.route
      : path === item.route || path.startsWith(item.route.replace(/\/$/, '') + '/');
    if (!onRoute) return false;
    // An item that names a section is active only for that section. With no
    // fragment in the URL you are at the top of the page, which is the
    // route-level item's business, not a section's.
    if (item.fragment) return fragment === item.fragment;
    // ⚠️ `exact` includes the fragment, so exactly one item is ever current.
    //
    // Without this, /landlord/dashboard#drafts marked BOTH "Dashboard" and
    // "Drafts" — defensible as prose, and wrong as markup: each active item
    // carries aria-current="page", and two of those announce two current pages
    // to a screen reader. The dashboard roots are the only exact items, and a
    // fragment on one of them means a section is the answer, not the root.
    if (item.exact && fragment !== null) return false;
    return true;
  }

  private split(url: string): { path: string; fragment: string | null } {
    const [withoutQuery] = url.split('?');
    const hash = withoutQuery.indexOf('#');
    return hash === -1
      ? { path: withoutQuery, fragment: null }
      : { path: withoutQuery.slice(0, hash), fragment: withoutQuery.slice(hash + 1) };
  }

  /** Scroll the horizontal strip so the active item is on screen. */
  private revealActive() {
    const nav = this.host.nativeElement.querySelector('.portal-nav') as HTMLElement | null;
    if (!nav) return;
    // Only when it IS a scroller. On the desktop column this is a no-op, and
    // assigning scrollLeft on a non-scrolling element would be a silent lie
    // about what this function does.
    if (nav.scrollWidth <= nav.clientWidth) return;
    const active = nav.querySelector('.portal-nav-link.active') as HTMLElement | null;
    if (!active) return;
    const navBox = nav.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    if (box.left >= navBox.left && box.right <= navBox.right) return;
    // Centre it, clamped, so the items either side are visible too — which is
    // what tells somebody the strip goes on in both directions.
    const target = nav.scrollLeft + (box.left - navBox.left) - (nav.clientWidth - box.width) / 2;
    nav.scrollLeft = Math.max(0, Math.min(target, nav.scrollWidth - nav.clientWidth));
  }
}
