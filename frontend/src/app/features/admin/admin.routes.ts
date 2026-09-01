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
    title: 'Admin — RentBoard',
  },
  {
    path: 'verifications',
    loadComponent: () => import('./verifications/admin-verifications').then((m) => m.AdminVerifications),
    title: 'Verification queue — RentBoard',
  },
  {
    path: 'reports',
    loadComponent: () => import('./reports/admin-reports').then((m) => m.AdminReports),
    title: 'Reports — RentBoard',
  },
  {
    path: 'advertising',
    loadComponent: () => import('./advertising/admin-advertising').then((m) => m.AdminAdvertising),
    title: 'Advertising — RentBoard admin',
  },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
];
