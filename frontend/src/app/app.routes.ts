import { Routes } from '@angular/router';
import { RenderMode, ServerRoute } from '@angular/ssr';
import { authGuard } from './core/guards/auth.guard';
import { landlordGuard } from './core/guards/landlord.guard';
import { tenantGuard } from './core/guards/tenant.guard';

/**
 * Application routes — all feature routes are lazy-loaded.
 * Route `title` drives per-page <title> for SEO (see SEO-LIGHTHOUSE-CHECKLIST.md §5).
 *
 * Guard chain (verified end-to-end in this pass):
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
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes').then((m) => m.AUTH_ROUTES),
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
    path: '**',
    loadComponent: () => import('./shared/components/error-page/error-page').then((m) => m.ErrorPage),
    title: 'Page not found — RentBoard',
  },
];

/**
 * SSR rendering mode per route.
 * Static/public pages prerender at build time (fast LCP, zero server load).
 * Auth-gated portals render client-side only — private, per-user data must
 * never be cached or prerendered.
 */
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'auth/**', renderMode: RenderMode.Client },
  { path: 'tenant/**', renderMode: RenderMode.Client },
  { path: 'landlord/**', renderMode: RenderMode.Client },
  { path: '**', renderMode: RenderMode.Prerender },
];
