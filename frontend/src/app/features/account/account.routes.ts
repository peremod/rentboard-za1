import { Routes } from '@angular/router';

/** Account settings — same page for both roles, guarded by authGuard only. */
export const ACCOUNT_ROUTES: Routes = [
  {
    path: 'settings',
    loadComponent: () => import('./settings/account-settings').then((m) => m.AccountSettings),
    title: 'Account settings — RentBoard',
  },
  { path: '', redirectTo: 'settings', pathMatch: 'full' },
];
