import { Routes } from '@angular/router';
import { billingEnabledGuard } from '../../core/guards/billing-enabled.guard';

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
  {
    path: 'upgrade',
    canActivate: [billingEnabledGuard],
    loadComponent: () => import('./upgrade/upgrade').then((m) => m.Upgrade),
    title: 'Upgrade Your Plan — Mastande',
  },
  {
    path: 'yard',
    loadComponent: () => import('./yard/yard').then((m) => m.Yard),
    title: 'Your property — Mastande',
  },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
];
