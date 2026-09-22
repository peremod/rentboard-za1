import { PortalNavItem } from '../../shared/components/portal-shell/portal-shell';

/** Counts shown as badges. A screen that does not know one leaves it out. */
export interface TenantNavBadges {
  applications?: number;
  saved?: number;
  alerts?: number;
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
    // No messages screen exists; threads live inside an application.
    { label: 'Messages', icon: '💬', route: '/tenant/dashboard', disabled: true },
    { label: 'Browse rooms', icon: '🔍', route: '/' },
    { label: 'Rent', icon: '🧾', route: '/tenant/rent' },
    { label: "Renter's Passport", icon: '🪪', route: '/tenant/passport' },
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
