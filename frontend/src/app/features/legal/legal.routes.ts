import { Routes } from '@angular/router';

/** Legal pages — prerendered at build time (see app.routes.ts serverRoutes: 'legal/**'). */
export const LEGAL_ROUTES: Routes = [
  { path: '', redirectTo: 'privacy', pathMatch: 'full' },
  {
    path: 'privacy',
    loadComponent: () => import('./privacy-policy/privacy-policy').then((m) => m.PrivacyPolicy),
    title: 'Privacy Policy (POPIA) — RentBoard',
  },
  {
    path: 'terms',
    loadComponent: () => import('./terms/terms').then((m) => m.Terms),
    title: 'Terms & Conditions — RentBoard',
  },
  {
    path: 'disclaimer',
    loadComponent: () => import('./disclaimer/disclaimer').then((m) => m.Disclaimer),
    title: 'Disclaimer — RentBoard',
  },
  {
    path: 'cookies',
    loadComponent: () => import('./cookies/cookies').then((m) => m.Cookies),
    title: 'Cookie Policy — RentBoard',
  },
  {
    path: 'paia',
    loadComponent: () => import('./paia/paia').then((m) => m.Paia),
    title: 'PAIA Manual — RentBoard',
  },
];
