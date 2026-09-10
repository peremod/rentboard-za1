import { Routes } from '@angular/router';

/** Legal pages — prerendered at build time (see app.routes.ts serverRoutes: 'legal/**'). */
export const LEGAL_ROUTES: Routes = [
  { path: '', redirectTo: 'privacy', pathMatch: 'full' },
  {
    path: 'privacy',
    loadComponent: () => import('./privacy-policy/privacy-policy').then((m) => m.PrivacyPolicy),
    title: 'Privacy Policy (POPIA) — RentBoard',
    data: { seo: { description: 'How RentBoard collects, uses and protects your personal information under POPIA, including your rights and our Information Officer contact details.' } },
  },
  {
    path: 'terms',
    loadComponent: () => import('./terms/terms').then((m) => m.Terms),
    title: 'Terms & Conditions — RentBoard',
    data: { seo: { description: 'The terms governing use of RentBoard by landlords and tenants, aligned with the Consumer Protection Act and the Rental Housing Act.' } },
  },
  {
    path: 'disclaimer',
    loadComponent: () => import('./disclaimer/disclaimer').then((m) => m.Disclaimer),
    title: 'Disclaimer — RentBoard',
    data: { seo: { description: 'What RentBoard is and is not responsible for, plus Rental Housing Tribunal contact details for every South African province.' } },
  },
  {
    path: 'cookies',
    loadComponent: () => import('./cookies/cookies').then((m) => m.Cookies),
    title: 'Cookie Policy — RentBoard',
    data: { seo: { description: 'Which cookies RentBoard uses and why. No advertising trackers, no analytics pixels — and rejecting is as easy as accepting.' } },
  },
  {
    path: 'paia',
    loadComponent: () => import('./paia/paia').then((m) => m.Paia),
    title: 'PAIA Manual — RentBoard',
    data: { seo: { description: 'RentBoard’s PAIA manual: the categories of records we hold and how to request access under the Promotion of Access to Information Act.' } },
  },
];
