import { Routes } from '@angular/router';

/**
 * Admin portal. Guarded at the parent by [authGuard, adminGuard]; adminGuard
 * redirects non-admins home rather than showing a 403, so the portal's
 * existence is not advertised.
 */
export const ADMIN_ROUTES: Routes = [
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/admin-dashboard').then((m) => m.AdminDashboard),
    data: { pageTitle: 'Overview' },
    title: 'Admin — Mastande',
  },
  {
    /**
     * Phase 7q. ⚠️ Its own screen rather than a section on the overview: it is
     * a queue with a workflow (open, record what was checked, approve or
     * refuse), and the one place in the product that can hand somebody's rooms
     * and tenants to the wrong person. It should be somewhere an admin goes
     * deliberately.
     */
    path: 'recoveries',
    loadComponent: () => import('./recoveries/recoveries').then((m) => m.AdminRecoveries),
    data: { pageTitle: 'Account recovery' },
    title: 'Account recovery — Mastande admin',
  },
  {
    path: 'verifications',
    loadComponent: () => import('./verifications/admin-verifications').then((m) => m.AdminVerifications),
    data: { pageTitle: 'Verification queue' },
    title: 'Verification queue — Mastande',
  },
  {
    path: 'reports',
    loadComponent: () => import('./reports/admin-reports').then((m) => m.AdminReports),
    data: { pageTitle: 'Reports' },
    title: 'Reports — Mastande admin',
  },
  {
    // Separate from 'reports', which is listing reports — a fraudulent or
    // duplicate ad. This is a dispute between two people who were in a
    // tenancy, and conflating the queues would mix "this listing is a scam"
    // with "my deposit was not returned".
    path: 'disputes',
    loadComponent: () => import('./disputes/admin-disputes').then((m) => m.AdminDisputes),
    data: { pageTitle: 'Disputes' },
    title: 'Disputes — Mastande admin',
  },
  {
    path: 'advertising',
    loadComponent: () => import('./advertising/admin-advertising').then((m) => m.AdminAdvertising),
    data: { pageTitle: 'Advertising' },
    title: 'Advertising — Mastande admin',
  },
  {
    path: 'referrals',
    loadComponent: () => import('./referrals/admin-referrals').then((m) => m.AdminReferrals),
    data: { pageTitle: 'Referrals' },
    title: 'Referrals — Mastande admin',
  },
  {
    path: 'surveys',
    loadComponent: () => import('./surveys/surveys').then((m) => m.AdminSurveys),
    data: { pageTitle: 'Survey' },
    title: 'Survey results — Mastande',
  },
  {
    path: 'services',
    loadComponent: () => import('./services/services').then((m) => m.AdminServices),
    data: { pageTitle: 'Who to call' },
    title: 'Who to call — Mastande admin',
  },
  {
    path: 'analytics',
    loadComponent: () => import('./analytics/admin-analytics').then((m) => m.AdminAnalytics),
    data: { pageTitle: 'How the site is used' },
    title: 'Usage — Mastande admin',
  },
  {
    // withComponentInputBinding is enabled, so :id binds to the id input.
    path: 'users/:id',
    loadComponent: () => import('./user-detail/admin-user-detail').then((m) => m.AdminUserDetailPage),
    data: { pageTitle: 'Account' },
    title: 'Account — Mastande admin',
  },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
];
