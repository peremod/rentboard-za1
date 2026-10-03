import { Routes } from '@angular/router';

/** Account settings — same page for both roles, guarded by authGuard only. */
export const ACCOUNT_ROUTES: Routes = [
  {
    path: 'settings',
    loadComponent: () => import('./settings/account-settings').then((m) => m.AccountSettings),
    title: 'Account settings — Mastande',
  },
  {
    // Phase 7g. In /account rather than under a role, because both roles get
    // notices and the page is identical — the sidebar follows the account's
    // own area, as on settings.
    path: 'notices',
    loadComponent: () => import('./notices/notices').then((m) => m.Notices),
    title: 'Your notices — Mastande',
  },
  { path: '', redirectTo: 'settings', pathMatch: 'full' },
];
