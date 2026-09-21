import { Routes } from '@angular/router';

/** Public marketing pages. Prerendered — they are static and SEO-relevant. */
export const PAGES_ROUTES: Routes = [
  {
    path: 'how-it-works',
    loadComponent: () => import('./how-it-works/how-it-works').then((m) => m.HowItWorks),
    title: 'How Mastande Works — Find or Let a Room in South Africa',
    data: { seo: { description: 'How Mastande works for tenants and landlords: browse rooms, apply free, get a response, move in. List a room in minutes with no estate agent and no commission.' } },
  },
  {
    path: 'advertise',
    loadComponent: () => import('./advertise/advertise').then((m) => m.Advertise),
    title: 'Advertise on Mastande — Reach Movers in South Africa',
    data: { seo: { description: 'Reach South Africans actively moving home. Advertise on Mastande and put your brand in front of tenants and landlords at the moment they are relocating.' } },
  },
  {
    path: 'pricing',
    loadComponent: () => import('./pricing/pricing').then((m) => m.Pricing),
    title: 'Pricing — Free for Landlords | Mastande',
    data: { seo: { description: 'Mastande pricing in Rand. Tenants apply free, always. Landlords list two rooms free for life, with paid plans for larger portfolios. No commission, no agent fees.' } },
  },
];
