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
  {
    path: 'about',
    loadComponent: () => import('./about/about').then((m) => m.About),
    title: 'About Mastande — A South African Room-Letting Notice Board',
    data: { seo: { description: 'What Mastande is and who runs it: a South African notice board for letting rooms directly, with no estate agent and no commission. Free to browse, apply and list. Operated by Umastande (Pty) Ltd.' } },
  },
  {
    path: 'rent-out-a-room',
    loadComponent: () => import('./rent-out-a-room/rent-out-a-room').then((m) => m.RentOutARoom),
    title: 'How to Rent Out a Room in South Africa — Free Step-by-Step Guide | Mastande',
    // alternates: false — the guide is written in English and is not translated,
    // so it must not claim a hreflang cluster of localised copies that would each
    // serve the same English text (the same call room and location pages make).
    // It is submitted to the sitemap once, at this English URL (seo.controller).
    data: { seo: { description: 'How to rent out a room in South Africa, free: what to charge, how to prepare and describe the room, how to screen a tenant safely, and what the Rental Housing Act expects of the lease and deposit. No estate agent, no commission.', alternates: false } },
  },
];
