import { PortalNavItem } from '../../shared/components/portal-shell/portal-shell';

/** One definition, so a new admin page cannot be missing from the others' nav. */
export const ADMIN_NAV: PortalNavItem[] = [
  { label: 'Overview', icon: 'chart', route: '/admin/dashboard', exact: true },
  { label: 'Verifications', icon: 'file-text', route: '/admin/verifications' },
  // Phase 7q. Handing an account back when its owner lost the phone they sign
  // in with. The only path that can give somebody's rooms and tenants away.
  { label: 'Account recovery', icon: 'key', route: '/admin/recoveries' },
  { label: 'Reports', icon: 'flag', route: '/admin/reports' },
  { label: 'Disputes', icon: 'scale', route: '/admin/disputes' },
  { label: 'Advertising', icon: 'megaphone', route: '/admin/advertising' },
  { label: 'Referrals', icon: 'ticket', route: '/admin/referrals' },
  { label: 'Survey', icon: 'edit', route: '/admin/surveys' },
  { label: 'Who to call', icon: 'wrench', route: '/admin/services' },
  { label: 'Usage', icon: 'trending-up', route: '/admin/analytics' },
  // An admin had no way to reach their own settings from any admin screen:
  // the shell has no user menu, and /account/settings was only ever linked
  // from the landlord and tenant sidebars.
  // Phase 7a. An admin is a user: the notice router can write to them like
  // anybody else, and until this line there was nowhere for them to read one.
  // It also removes the odd exception the nav audit had to carry for
  // /account/notices.
  { label: 'Notices', icon: 'bell', route: '/account/notices' },
  { label: 'Settings', icon: 'sliders', route: '/account/settings' },
];
