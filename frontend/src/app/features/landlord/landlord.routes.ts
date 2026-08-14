import { Routes } from '@angular/router';

/** Landlord portal — guarded by [authGuard, landlordGuard] at the parent route in app.routes.ts. */
export const LANDLORD_ROUTES: Routes = [
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/landlord-dashboard').then((m) => m.LandlordDashboard),
    title: 'Your Dashboard — RentBoard',
  },
  {
    path: 'rooms/new',
    loadComponent: () => import('./create-room/create-room').then((m) => m.CreateRoom),
    title: 'List a Room — RentBoard',
  },
  {
    path: 'rooms/:roomId/applicants',
    loadComponent: () => import('./applicants/applicants').then((m) => m.Applicants),
    title: 'Applicants — RentBoard',
  },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
];
