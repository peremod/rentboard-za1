import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { PortalShell, PortalNavItem } from '../portal-shell/portal-shell';
import { Walkthrough } from '../walkthrough/walkthrough';
import { AuthService } from '../../../core/services/auth.service';
import { PortalBadgesService } from '../../../core/services/portal-badges';
import { landlordNav } from '../../../features/landlord/landlord-nav';
import { tenantNav } from '../../../features/tenant/tenant-nav';
import { ADMIN_NAV } from '../../../features/admin/admin-nav';

/**
 * The authenticated layout: one sidebar for every screen behind a login.
 *
 * ── The defect this exists to fix
 *
 * The sidebar was a component each screen rendered for itself, and two screens
 * did not render it at all — `/landlord/rooms/new` and
 * `/landlord/rooms/:roomId/applicants`. Those are the two screens a landlord
 * uses most: posting a room and deciding on the people who applied for it. On
 * both of them the portal navigation simply vanished, and on a phone, where the
 * sidebar is the horizontal strip at the top and the header hamburger carries
 * only public links, there was no way back to anything except the browser's
 * back button.
 *
 * Phase 7a had already found and fixed the same shape of fault one layer down:
 * the nav's CONTENTS were defined six times and the copies disagreed, so the
 * sidebar shrank as a landlord moved through their own portal. One definition
 * fixed the contents; this fixes whether it is drawn at all.
 *
 * ── Mounted on the route, not imported by the page
 *
 * It sits on the four guarded parent routes in `app.routes.ts`, with the child
 * screens rendering into its `<router-outlet>`. A new portal screen therefore
 * cannot ship without the navigation, which is the only arrangement where that
 * is true: twenty-three screens remembering to import a shell is twenty-three
 * chances to forget, and two of them had.
 *
 * ── Where a screen's name lives now
 *
 * In the route's `data.pageTitle`. It was an input on each screen's own shell
 * tag, which meant the route table said one thing in `title` (the browser tab)
 * and the component said another in `pageTitle` (the h1), with nothing holding
 * them together. Now the route says both, next to each other, and
 * `scripts/nav-audit.mjs` reads the same place when it compares a nav label
 * against the heading of the page it opens.
 */
@Component({
  selector: 'app-portal-layout',
  standalone: true,
  imports: [PortalShell, RouterOutlet, Walkthrough],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems()" [roleLabel]="roleLabel()"
                      [pageTitle]="pageTitle()" [primaryAction]="primaryAction()"
                      [avatarColour]="avatarColour()">
      <router-outlet/>
    </app-portal-shell>

    <!-- The first-run walkthrough — Phase 7f. Here rather than in each screen
         for the same reason the sidebar is: one place, so a new portal screen
         cannot ship without it. It renders nothing for an account that has
         already been shown round, which is most of them most of the time. -->
    <app-walkthrough/>
  `,
})
export class PortalLayout implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private badges = inject(PortalBadgesService);

  /**
   * The deepest activated child's `data.pageTitle`.
   *
   * Walked to the leaf rather than read off `this.route`, because the layout is
   * the PARENT: its own data is the area's, and the title belongs to the page.
   * Re-read on every navigation, since the layout itself is not recreated when
   * a landlord moves from their dashboard to their properties — that persistence
   * is the whole point of it.
   */
  readonly pageTitle = signal('');

  readonly roleLabel = computed(() =>
    this.auth.isAdmin() ? 'Admin' : this.auth.isLandlord() ? 'Landlord' : 'Tenant',
  );

  /** Landlords are terracotta, tenants sage, admins ink — as the visual spec has it. */
  readonly avatarColour = computed(() =>
    this.auth.isAdmin() ? 'var(--ink2)' : this.auth.isLandlord() ? 'var(--terra)' : 'var(--sage)',
  );

  /**
   * One nav per role, with the counts from one place.
   *
   * A computed over signals, so a badge that arrives after the first paint
   * updates the sidebar without the screen under it knowing anything about it.
   */
  readonly navItems = computed<PortalNavItem[]>(() => {
    if (this.auth.isAdmin()) return ADMIN_NAV;
    if (this.auth.isLandlord()) {
      return landlordNav({
        applicants: this.badges.applicantsWaiting(),
        drafts: this.badges.drafts(),
        notices: this.badges.noticesUnread(),
      });
    }
    return tenantNav({ notices: this.badges.noticesUnread() });
  });

  /**
   * The sidebar's one call to action.
   *
   * Only for a landlord: a tenant's equivalent is "browse rooms", which is
   * already the board and already in their nav, and an admin has nothing to
   * post. It was passed by the landlord dashboard alone before, so it appeared
   * on exactly one screen out of ten.
   */
  readonly primaryAction = computed(() =>
    this.auth.isLandlord() && !this.auth.isAdmin()
      ? { label: '+ List a room', route: '/landlord/rooms/new' }
      : null,
  );

  ngOnInit() {
    this.readTitle();
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.readTitle());
    this.badges.load();
  }

  private readTitle() {
    let leaf = this.route;
    while (leaf.firstChild) leaf = leaf.firstChild;
    this.pageTitle.set(leaf.snapshot.data['pageTitle'] ?? '');
  }
}
