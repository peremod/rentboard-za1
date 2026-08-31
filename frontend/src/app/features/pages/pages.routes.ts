import { Routes } from '@angular/router';

/** Public marketing pages. Prerendered — they are static and SEO-relevant. */
export const PAGES_ROUTES: Routes = [
  {
    path: 'how-it-works',
    loadComponent: () => import('./how-it-works/how-it-works').then((m) => m.HowItWorks),
    title: 'How RentBoard Works — Find or Let a Room in South Africa',
  },
  {
    path: 'advertise',
    loadComponent: () => import('./advertise/advertise').then((m) => m.Advertise),
    title: 'Advertise on RentBoard — Reach Movers in South Africa',
  },
  {
    path: 'pricing',
    loadComponent: () => import('./pricing/pricing').then((m) => m.Pricing),
    title: 'Pricing — Free for Landlords | RentBoard',
  },
];
