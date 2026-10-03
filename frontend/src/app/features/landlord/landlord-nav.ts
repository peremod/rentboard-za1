import { PortalNavItem } from '../../shared/components/portal-shell/portal-shell';

/** Counts shown as badges. A screen that does not know one leaves it out. */
export interface LandlordNavBadges {
  applicants?: number;
  /** Unread in-app notices — Phase 7g. */
  notices?: number;
}

/**
 * One definition of the landlord's navigation, for the same reason
 * `ADMIN_NAV` exists — except this side had three copies and they disagreed.
 *
 * The dashboard listed eight items, the yard four, and the verification page
 * two. So the nav SHRANK as a landlord moved through their own portal: from
 * /landlord/verification there was no way to reach their property or their
 * settings at all, and "My property" was called "Property" on one screen and
 * "My property" on another. Every one of those screens compiled, rendered and
 * navigated correctly — the defect was only visible by signing in and walking
 * from page to page, which is how it was found.
 *
 * Badges are passed in rather than read here: the counts come from services
 * the dashboard already injects, and a nav definition that injected them would
 * make every screen fetch the dashboard's data to draw a sidebar.
 */
export function landlordNav(badges: LandlordNavBadges = {}): PortalNavItem[] {
  return [
    { label: 'Dashboard', icon: '📊', route: '/landlord/dashboard', exact: true },
    // These two name sections of the dashboard, not pages of their own.
    // Without the fragment they navigate to the dashboard root, which from the
    // dashboard is indistinguishable from a click that did nothing.
    { label: 'My Rooms', icon: '🏠', route: '/landlord/dashboard', fragment: 'active-listings' },
    // Applicants are listed per room, under Active listings, which is where
    // you act on them. The badge is the number that matters.
    {
      label: 'Applicants', icon: '👥', route: '/landlord/dashboard',
      fragment: 'active-listings', badge: badges.applicants,
    },
    // No messages screen exists. Threads live inside an application, reached
    // from that application. `disabled` renders it greyed with a "Soon" chip,
    // which is the truth; listing it as a destination was not.
    { label: 'Messages', icon: '💬', route: '/landlord/dashboard', disabled: true },
    { label: 'My property', icon: '🏘️', route: '/landlord/yard' },
    { label: 'Verification', icon: '🪪', route: '/landlord/verification' },
    // A reason to open the app with no vacancy and no rent due: something is
    // broken and you need a number.
    { label: 'Your public page', icon: '🪧', route: '/landlord/public-page' },
    { label: 'Who to call', icon: '🔧', route: '/landlord/services' },
    // Phase 7g. Not optional furniture: for a landlord with no email address
    // this screen is the only place a notification can be read at all.
    { label: 'Notices', icon: '🔔', route: '/account/notices', badge: badges.notices },
    { label: 'Settings', icon: '⚙️', route: '/account/settings' },
    // No Billing entry. It pointed at /landlord/upgrade, which has been
    // deleted — there are no paid plans to bill for, so a landlord has no
    // billing to look at. Restoring this means restoring a real page first.
  ];
}
