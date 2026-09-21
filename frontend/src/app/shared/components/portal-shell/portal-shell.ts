import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
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
  imports: [RouterLink, RouterLinkActive],
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
               routerLinkActive="active"
               [routerLinkActiveOptions]="{ exact: !!item.exact }">
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
        <ng-content/>
      </main>
    </div>
  `,
})
export class PortalShell {
  auth = inject(AuthService);

  readonly navItems = input.required<PortalNavItem[]>();
  readonly roleLabel = input<string>('');
  readonly primaryAction = input<{ label: string; route: string } | null>(null);
  /** Landlords are terracotta, tenants sage — matches the spec's portal avatars. */
  readonly avatarColour = input<string>('var(--terra)');

  initial() {
    return this.auth.user()?.fullName?.charAt(0).toUpperCase() ?? '?';
  }
}
