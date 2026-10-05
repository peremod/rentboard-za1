import { PortalNavItem } from '../../shared/components/portal-shell/portal-shell';

/** One definition, so a new admin page cannot be missing from the others' nav. */
export const ADMIN_NAV: PortalNavItem[] = [
  { label: 'Overview', icon: '📊', route: '/admin/dashboard', exact: true },
  { label: 'Verifications', icon: '📄', route: '/admin/verifications' },
  // Phase 7q. Handing an account back when its owner lost the phone they sign
  // in with. The only path that can give somebody's rooms and tenants away.
  { label: 'Account recovery', icon: '🔑', route: '/admin/recoveries' },
  { label: 'Reports', icon: '🚩', route: '/admin/reports' },
  { label: 'Disputes', icon: '⚖️', route: '/admin/disputes' },
  { label: 'Advertising', icon: '📢', route: '/admin/advertising' },
  { label: 'Referrals', icon: '🎟️', route: '/admin/referrals' },
  { label: 'Survey', icon: '📝', route: '/admin/surveys' },
  { label: 'Who to call', icon: '🔧', route: '/admin/services' },
  { label: 'Usage', icon: '📈', route: '/admin/analytics' },
  // An admin had no way to reach their own settings from any admin screen:
  // the shell has no user menu, and /account/settings was only ever linked
  // from the landlord and tenant sidebars.
  // Phase 7a. An admin is a user: the notice router can write to them like
  // anybody else, and until this line there was nowhere for them to read one.
  // It also removes the odd exception the nav audit had to carry for
  // /account/notices.
  { label: 'Notices', icon: '🔔', route: '/account/notices' },
  { label: 'Settings', icon: '⚙️', route: '/account/settings' },
];
