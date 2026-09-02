import { PortalNavItem } from '../../shared/components/portal-shell/portal-shell';

/** One definition, so a new admin page cannot be missing from the others' nav. */
export const ADMIN_NAV: PortalNavItem[] = [
  { label: 'Overview', icon: '📊', route: '/admin/dashboard', exact: true },
  { label: 'Verifications', icon: '📄', route: '/admin/verifications' },
  { label: 'Reports', icon: '🚩', route: '/admin/reports' },
  { label: 'Advertising', icon: '📢', route: '/admin/advertising' },
  { label: 'Referrals', icon: '🎟️', route: '/admin/referrals' },
  { label: 'Usage', icon: '📈', route: '/admin/analytics' },
];
