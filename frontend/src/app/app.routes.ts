import { Routes } from '@angular/router';
import { RenderMode, ServerRoute } from '@angular/ssr';
import { authGuard } from './core/guards/auth.guard';
import { landlordGuard } from './core/guards/landlord.guard';
import { tenantGuard } from './core/guards/tenant.guard';
import { adminGuard } from './core/guards/admin.guard';

/**
 * Application routes — all feature routes are lazy-loaded.
 * Route `title` drives per-page <title> for SEO (see SEO-LIGHTHOUSE-CHECKLIST.md §5).
 *
 * Guard chain (verified end-to-end since the Auth pass):
 *   unauthenticated → /auth/login?returnUrl=<attempted>
 *   login/register success → returnUrl, else role-appropriate dashboard
 *   wrong-role access → redirected to their own dashboard, not a 403 page
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/home/home').then((m) => m.Home),
    title: 'RentBoard — Rooms to Rent in South Africa, No Agent Fees',
  },
  {
    path: 'rooms/:id',
    loadComponent: () => import('./features/room-detail/room-detail').then((m) => m.RoomDetail),
  },
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },
  {
    path: '',
    loadChildren: () => import('./features/pages/pages.routes').then((m) => m.PAGES_ROUTES),
  },
  {
    path: 'legal',
    loadChildren: () => import('./features/legal/legal.routes').then((m) => m.LEGAL_ROUTES),
  },
  {
    path: 'tenant',
    canActivate: [authGuard, tenantGuard],
    loadChildren: () => import('./features/tenant/tenant.routes').then((m) => m.TENANT_ROUTES),
  },
  {
    path: 'landlord',
    canActivate: [authGuard, landlordGuard],
    loadChildren: () => import('./features/landlord/landlord.routes').then((m) => m.LANDLORD_ROUTES),
  },
  {
    path: 'account',
    canActivate: [authGuard],
    loadChildren: () => import('./features/account/account.routes').then((m) => m.ACCOUNT_ROUTES),
  },
  {
    path: 'admin',
    canActivate: [authGuard, adminGuard],
    loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  {
    path: '**',
    loadComponent: () => import('./shared/components/error-page/error-page').then((m) => m.ErrorPage),
    title: 'Page not found — RentBoard',
  },
];

/**
 * SSR rendering mode per route.
 * Static pages prerender at build time. Room detail is dynamic per-ID content
 * — SSR'd per request (crawlable for SEO, can't be known at build time).
 * Auth-gated portals render client-side only — private data is never cached.
 */
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'rooms/:id', renderMode: RenderMode.Server },
  { path: 'legal/**', renderMode: RenderMode.Prerender },
  { path: 'how-it-works', renderMode: RenderMode.Prerender },
  { path: 'pricing', renderMode: RenderMode.Prerender },
  { path: 'auth/**', renderMode: RenderMode.Client },
  { path: 'tenant/**', renderMode: RenderMode.Client },
  { path: 'landlord/**', renderMode: RenderMode.Client },
  { path: 'admin/**', renderMode: RenderMode.Client },
  { path: 'account/**', renderMode: RenderMode.Client },
  { path: '**', renderMode: RenderMode.Prerender },
];
