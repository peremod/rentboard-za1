import { Routes } from '@angular/router';
import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Application routes — all feature routes are lazy-loaded.
 * Route `title` drives per-page <title> for SEO (see SEO-LIGHTHOUSE-CHECKLIST.md §5).
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/home/home').then((m) => m.Home),
    title: 'RentBoard — Rooms to Rent in South Africa, No Agent Fees',
  },
  {
    path: '**',
    loadComponent: () => import('./shared/components/error-page/error-page').then((m) => m.ErrorPage),
    title: 'Page not found — RentBoard',
  },
];

/** SSR rendering mode per route — static pages prerender at build time. */
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Prerender },
];
