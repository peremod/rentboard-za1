import { Routes } from '@angular/router';

/** Tenant portal — guarded by [authGuard, tenantGuard] at the parent route in app.routes.ts. */
export const TENANT_ROUTES: Routes = [
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/tenant-dashboard').then((m) => m.TenantDashboard),
    data: { pageTitle: 'Your dashboard' },
    title: 'Your Dashboard — Mastande',
  },
  {
    // No billingEnabledGuard any more. The Passport used to sell an R89/month
    // subscription, so it was gated behind the billing flag and unreachable.
    // It is now a free verification flow, and gating a free thing behind a
    // billing switch is how it stays invisible.
    path: 'passport',
    loadComponent: () => import('./passport-verify/passport-verify').then((m) => m.PassportVerify),
    data: { pageTitle: "Renter's Passport" },
    title: "Renter's Passport — Mastande",
  },
  {
    // Gap Y3. The overdue-rent reminder tells a tenant to "say so on
    // Mastande" if they have paid; until this screen there was nowhere to
    // say it, and the dispute existed only in the API.
    path: 'rent',
    loadComponent: () => import('./rent/rent').then((m) => m.TenantRent),
    data: { pageTitle: 'Rent' },
    title: 'Rent — Mastande',
  },
  // ── Sub-letting — Phase 6, Option A ──────────────────────────────────────
  //
  // The same wizard and the same applicants screen the landlord portal uses,
  // reached from here with `listerType: 'sublessor'` in route data. Reuse
  // rather than a second copy: a parallel wizard would be the copy that misses
  // the next fix, which is the mistake this codebase has already paid for with
  // the portal nav defined six times.
  //
  // Under /tenant rather than /landlord because of the guards — a TENANT
  // account cannot pass landlordGuard, and relaxing that guard to let them
  // through would open the yard, rent tracking and the storefront with it.
  {
    path: 'sublet/new',
    loadComponent: () => import('../landlord/create-room/create-room').then((m) => m.CreateRoom),
    title: 'Sublet a room — Mastande',
    data: { listerType: 'sublessor', pageTitle: 'Sublet a room in your place' },
  },
  {
    path: 'sublet/:roomId/edit',
    loadComponent: () => import('../landlord/create-room/create-room').then((m) => m.CreateRoom),
    title: 'Your sublet listing — Mastande',
    data: { listerType: 'sublessor', pageTitle: 'Your sublet listing' },
  },
  {
    path: 'sublet/:roomId/applicants',
    loadComponent: () => import('../landlord/applicants/applicants').then((m) => m.Applicants),
    title: 'Applicants — Mastande',
    data: { listerType: 'sublessor', pageTitle: 'Applicants' },
  },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
];
