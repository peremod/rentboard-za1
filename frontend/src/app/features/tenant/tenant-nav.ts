import { PortalNavItem } from '../../shared/components/portal-shell/portal-shell';

/** Counts shown as badges. A screen that does not know one leaves it out. */
export interface TenantNavBadges {
  applications?: number;
  saved?: number;
  alerts?: number;
  /** Unread in-app notices — Phase 7g. */
  notices?: number;
}

/**
 * One definition of the tenant's navigation — see `landlordNav` for why.
 *
 * This side had the same fault: the dashboard listed nine items, /tenant/rent
 * five and /tenant/passport two, so a tenant who opened their Renter's
 * Passport lost Rent, Browse rooms, Settings, Applications, Saved rooms and
 * Alerts from the sidebar until they navigated back.
 */
export function tenantNav(badges: TenantNavBadges = {}): PortalNavItem[] {
  return [
    { label: 'Dashboard', icon: '🏠', route: '/tenant/dashboard', exact: true },
    // Sections of the dashboard, so they carry fragments.
    {
      label: 'Applications', icon: '📋', route: '/tenant/dashboard',
      fragment: 'your-applications', badge: badges.applications,
    },
    // Phase 7c. Was `disabled` with a "Soon" chip. The inbox is at
    // /account/messages — one screen for both roles, which matters most for a
    // sub-lessor: a TENANT account that also lets a room has conversations on
    // both sides, and a tenant-only inbox would show them half their messages.
    { label: 'Messages', icon: '💬', route: '/account/messages' },
    // ⚠️ `exact`, because '/' is a prefix of every URL in the app. Without it
    // this item was marked the current page on all six tenant screens — see
    // PortalShell.isActive.
    { label: 'Browse rooms', icon: '🔍', route: '/', exact: true },
    { label: 'Rent', icon: '🧾', route: '/tenant/rent' },
    { label: "Renter's Passport", icon: '🪪', route: '/tenant/passport' },
    // Phase 6. Points at the dashboard SECTION rather than straight into the
    // wizard: the section is where a sub-lessor's existing listings and their
    // applicants are, and a nav item that opens a four-step form is a trap for
    // somebody who only wanted to look.
    { label: 'Rooms you let', icon: '🔑', route: '/tenant/dashboard', fragment: 'your-sublets' },
    // Phase F. The record of every letting that is over, both sides — in
    // /account for the same reason as Messages above, and because a sub-lessor
    // has history on both sides at once. Phase D keeps the rent ledger on the
    // rent screen; this is the whole record, reviews and paperwork included.
    { label: 'Past lettings', icon: '🗂️', route: '/account/tenancies' },
    // Phase 7g. Not optional furniture: for an account with no email address
    // this screen is the only place a notification can be read at all.
    { label: 'Notices', icon: '🔔', route: '/account/notices', badge: badges.notices },
    { label: 'Settings', icon: '⚙️', route: '/account/settings' },
    {
      label: 'Saved Rooms', icon: '♥', route: '/tenant/dashboard',
      fragment: 'saved-rooms', badge: badges.saved,
    },
    {
      label: 'Alerts', icon: '🔔', route: '/tenant/dashboard',
      fragment: 'room-alerts', badge: badges.alerts,
    },
    // No Billing entry: there is no /tenant/upgrade route. The Renter's
    // Passport was the tenant-side subscription and Phase 1 made it free.
  ];
}
