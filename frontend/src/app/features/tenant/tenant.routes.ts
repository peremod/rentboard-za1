import { Routes } from '@angular/router';

/** Tenant portal — guarded by [authGuard, tenantGuard] at the parent route in app.routes.ts. */
export const TENANT_ROUTES: Routes = [
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/tenant-dashboard').then((m) => m.TenantDashboard),
    title: 'Your Dashboard — RentBoard',
  },
  {
    path: 'passport',
    loadComponent: () => import('./passport/passport').then((m) => m.Passport),
    title: "Renter's Passport — RentBoard",
  },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
];
