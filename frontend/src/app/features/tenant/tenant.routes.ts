import { Routes } from '@angular/router';
import { billingEnabledGuard } from '../../core/guards/billing-enabled.guard';

/** Tenant portal — guarded by [authGuard, tenantGuard] at the parent route in app.routes.ts. */
export const TENANT_ROUTES: Routes = [
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/tenant-dashboard').then((m) => m.TenantDashboard),
    title: 'Your Dashboard — Mastande',
  },
  {
    path: 'passport',
    canActivate: [billingEnabledGuard],
    loadComponent: () => import('./passport/passport').then((m) => m.Passport),
    title: "Renter's Passport — Mastande",
  },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
];
