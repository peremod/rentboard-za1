import { Routes } from '@angular/router';

/** Tenant portal — guarded by [authGuard, tenantGuard] at the parent route in app.routes.ts. */
export const TENANT_ROUTES: Routes = [
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/tenant-dashboard').then((m) => m.TenantDashboard),
    title: 'Your Dashboard — Mastande',
  },
  {
    // No billingEnabledGuard any more. The Passport used to sell an R89/month
    // subscription, so it was gated behind the billing flag and unreachable.
    // It is now a free verification flow, and gating a free thing behind a
    // billing switch is how it stays invisible.
    path: 'passport',
    loadComponent: () => import('./passport-verify/passport-verify').then((m) => m.PassportVerify),
    title: "Renter's Passport — Mastande",
  },
  {
    // Gap Y3. The overdue-rent reminder tells a tenant to "say so on
    // Mastande" if they have paid; until this screen there was nowhere to
    // say it, and the dispute existed only in the API.
    path: 'rent',
    loadComponent: () => import('./rent/rent').then((m) => m.TenantRent),
    title: 'Rent — Mastande',
  },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
];
