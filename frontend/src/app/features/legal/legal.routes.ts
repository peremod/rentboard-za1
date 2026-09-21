import { Routes } from '@angular/router';

/** Legal pages — prerendered at build time (see app.routes.ts serverRoutes: 'legal/**'). */
export const LEGAL_ROUTES: Routes = [
  { path: '', redirectTo: 'privacy', pathMatch: 'full' },
  {
    path: 'privacy',
    loadComponent: () => import('./privacy-policy/privacy-policy').then((m) => m.PrivacyPolicy),
    title: 'Privacy Policy (POPIA) — Mastande',
    data: { seo: { description: 'How Mastande collects, uses and protects your personal information under POPIA, including your rights and our Information Officer contact details.' } },
  },
  {
    path: 'terms',
    loadComponent: () => import('./terms/terms').then((m) => m.Terms),
    title: 'Terms & Conditions — Mastande',
    data: { seo: { description: 'The terms governing use of Mastande by landlords and tenants, aligned with the Consumer Protection Act and the Rental Housing Act.' } },
  },
  {
    path: 'disclaimer',
    loadComponent: () => import('./disclaimer/disclaimer').then((m) => m.Disclaimer),
    title: 'Disclaimer — Mastande',
    data: { seo: { description: 'What Mastande is and is not responsible for, plus Rental Housing Tribunal contact details for every South African province.' } },
  },
  {
    path: 'cookies',
    loadComponent: () => import('./cookies/cookies').then((m) => m.Cookies),
    title: 'Cookie Policy — Mastande',
    data: { seo: { description: 'Which cookies Mastande uses and why. No advertising trackers, no analytics pixels — and rejecting is as easy as accepting.' } },
  },
  {
    path: 'paia',
    loadComponent: () => import('./paia/paia').then((m) => m.Paia),
    title: 'PAIA Manual — Mastande',
    data: { seo: { description: 'Mastande’s PAIA manual: the categories of records we hold and how to request access under the Promotion of Access to Information Act.' } },
  },
];
