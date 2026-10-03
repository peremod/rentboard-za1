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
    // Phase 6. A page of its own rather than a section of the disclaimer: the
    // room page links straight here from a sublet listing, and an applicant
    // deciding whether to pay a deposit should not have to find the relevant
    // paragraph inside a general disclaimer.
    path: 'sublet',
    loadComponent: () => import('./sublet/sublet').then((m) => m.Sublet),
    title: 'Renting a room from a tenant (sub-letting) — Mastande',
    data: { seo: { description: 'What sub-letting means, what can go wrong, what to ask for before paying a deposit, and exactly what Mastande does and does not check about a sub-lessor\'s right to sublet.' } },
  },
  {
    path: 'paia',
    loadComponent: () => import('./paia/paia').then((m) => m.Paia),
    title: 'PAIA Manual — Mastande',
    data: { seo: { description: 'Mastande’s PAIA manual: the categories of records we hold and how to request access under the Promotion of Access to Information Act.' } },
  },
];
