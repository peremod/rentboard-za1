import { Routes } from '@angular/router';

/** Landlord portal — guarded by [authGuard, landlordGuard] at the parent route in app.routes.ts. */
export const LANDLORD_ROUTES: Routes = [
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/landlord-dashboard').then((m) => m.LandlordDashboard),
    title: 'Your Dashboard — Mastande',
  },
  {
    path: 'rooms/new',
    loadComponent: () => import('./create-room/create-room').then((m) => m.CreateRoom),
    title: 'List a Room — Mastande',
  },
  {
    // Resumes an existing draft in the same wizard used to create one.
    path: 'rooms/:roomId/edit',
    loadComponent: () => import('./create-room/create-room').then((m) => m.CreateRoom),
    title: 'Continue Your Listing — Mastande',
  },
  {
    path: 'rooms/:roomId/applicants',
    loadComponent: () => import('./applicants/applicants').then((m) => m.Applicants),
    title: 'Applicants — Mastande',
  },
  {
    path: 'verification',
    loadComponent: () => import('./verification/landlord-verification').then((m) => m.LandlordVerification),
    title: 'Verification — Mastande',
  },
  // No 'upgrade' route. It served a page offering Pro at R349/mo and Agency at
  // R1,499/mo — plans that have no payment provider behind them and never had:
  // Stripe was removed (it does not operate in South Africa for receiving) and
  // PayFast recurring was never built. The page was unreachable behind a flag
  // and a guard, which kept visitors off it but kept the prices in the build,
  // where they were copied into the Terms as a binding subscription table.
  // Deleted rather than re-hidden. Nothing here recurs; see /pricing.
  {
    path: 'yard',
    loadComponent: () => import('./yard/yard').then((m) => m.Yard),
    title: 'Your property — Mastande',
  },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
];
