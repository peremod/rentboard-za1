import { Routes } from '@angular/router';
import { RenderMode, ServerRoute } from '@angular/ssr';
import { authGuard } from './core/guards/auth.guard';
import { landlordGuard } from './core/guards/landlord.guard';
import { tenantGuard } from './core/guards/tenant.guard';
import { adminGuard } from './core/guards/admin.guard';
import { localeMatchGuard } from './core/i18n/locale-routing';
import { PREFIXED_LOCALES } from './core/models/language.model';

/**
 * Application routes — all feature routes are lazy-loaded.
 * Route `title` drives per-page <title>; `data.seo` drives description,
 * canonical, Open Graph and robots (see core/seo/route-seo.ts).
 *
 * Guard chain (verified end-to-end since the Auth pass):
 *   unauthenticated → /auth/login?returnUrl=<attempted>
 *   login/register success → returnUrl, else role-appropriate dashboard
 *   wrong-role access → redirected to their own dashboard, not a 403 page
 */

/**
 * Every route in the application, declared once.
 *
 * Mounted twice below: bare for English, and under ':lang' for the other ten
 * official languages. Declaring them once is not a tidiness preference — two
 * hand-maintained copies would drift, and a route that exists in English but
 * not in isiXhosa is a 404 that only a fraction of users ever hit and nobody
 * reports.
 */
const CONTENT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/home/home').then((m) => m.Home),
    title: 'Mastande — Rooms to Rent in South Africa, No Agent Fees',
    data: {
      seo: {
        description:
          'Browse rooms to rent across South Africa, posted directly by landlords. Apply free — no estate agent, no application fees. Gauteng, Western Cape, KwaZulu-Natal and more.',
      },
    },
  },
  {
    /**
     * The board lives at '/', but /rooms was published in the old sitemap and
     * is the URL people type. Without this it fell through to the wildcard and
     * returned the not-found page under a 200 — a soft 404, which Google
     * treats as a quality signal against the whole site.
     *
     * vercel.json also issues a real 301 for /rooms, which is what actually
     * passes link equity; this is the safety net for a navigation that never
     * reaches the edge, and it covers the localised '/zu/rooms' form too.
     */
    path: 'rooms',
    pathMatch: 'full',
    redirectTo: '',
  },
  {
    path: 'rooms/:id',
    loadComponent: () => import('./features/room-detail/room-detail').then((m) => m.RoomDetail),
    // Title, description, canonical and JSON-LD are set by the component once
    // the room has loaded — they depend on data unknown at build time.
    title: 'Room to rent — Mastande',
  },
  {
    path: 'auth',
    data: { seo: { noIndex: true } },
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
    /**
     * A previous landlord answering a reference request.
     *
     * Top level and unguarded on purpose: the person following this link has
     * no account and will not make one. The one-time token in the URL is the
     * whole authentication.
     *
     * noIndex because the URL contains that token — a crawler following it
     * from a forwarded WhatsApp would spend someone's reference, and an
     * indexed page would put it in a search result.
     */
    path: 'reference/:token',
    data: { seo: { noIndex: true } },
    loadComponent: () =>
      import('./features/reference-respond/reference-respond').then((m) => m.ReferenceRespond),
    title: 'Reference request — Mastande',
  },
  {
    path: 'tenant',
    data: { seo: { noIndex: true } },
    canActivate: [authGuard, tenantGuard],
    loadChildren: () => import('./features/tenant/tenant.routes').then((m) => m.TENANT_ROUTES),
  },
  {
    path: 'landlord',
    data: { seo: { noIndex: true } },
    canActivate: [authGuard, landlordGuard],
    loadChildren: () => import('./features/landlord/landlord.routes').then((m) => m.LANDLORD_ROUTES),
  },
  {
    path: 'account',
    data: { seo: { noIndex: true } },
    canActivate: [authGuard],
    loadChildren: () => import('./features/account/account.routes').then((m) => m.ACCOUNT_ROUTES),
  },
  {
    path: 'admin',
    data: { seo: { noIndex: true } },
    canActivate: [authGuard, adminGuard],
    loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  {
    path: '**',
    loadComponent: () => import('./shared/components/error-page/error-page').then((m) => m.ErrorPage),
    title: 'Page not found — Mastande',
    // A 404 must never be indexed, and must never claim a canonical of its own.
    data: { seo: { noIndex: true } },
  },
];

export const routes: Routes = [
  /**
   * Localised tree. `localeMatchGuard` only lets this branch match when the
   * first segment is one of the ten prefixed locales, so '/pricing' falls
   * straight through to the English tree below rather than being read as
   * lang='pricing'.
   *
   * English is deliberately unprefixed. '/en/pricing' does not exist, because
   * having both '/pricing' and '/en/pricing' serve identical content is the
   * duplication that hreflang exists to prevent.
   */
  {
    path: ':lang',
    canMatch: [localeMatchGuard],
    children: CONTENT_ROUTES,
  },
  ...CONTENT_ROUTES,
];

/**
 * SSR rendering mode per route.
 *
 * Static pages prerender at build time, once per locale — that is the whole
 * point of locale-scoped URLs: '/zu/pricing' must be served as isiZulu HTML
 * to a crawler that runs no JavaScript, not as English that swaps after
 * hydration.
 *
 * Room detail is dynamic per-ID content, so it is SSR'd per request.
 * Auth-gated portals render client-side only — private data is never cached.
 */
// Explicitly typed rather than inferred. getPrerenderParams expects
// Record<string, string>[]; letting TypeScript infer {lang: LanguageCode}[]
// relies on implicit index-signature compatibility, which holds here but is
// a subtle rule to depend on in a file that decides what gets prerendered.
const eachLocale = async (): Promise<Record<string, string>[]> =>
  PREFIXED_LOCALES.map((lang) => ({ lang }));

export const serverRoutes: ServerRoute[] = [
  // ── English (unprefixed) ──
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'rooms/:id', renderMode: RenderMode.Server },
  { path: 'legal/**', renderMode: RenderMode.Prerender },
  { path: 'how-it-works', renderMode: RenderMode.Prerender },
  { path: 'pricing', renderMode: RenderMode.Prerender },
  { path: 'advertise', renderMode: RenderMode.Prerender },

  // ── The other ten locales ──
  // Prerendered where the URL is fully enumerable: ten locales × four pages.
  { path: ':lang', renderMode: RenderMode.Prerender, getPrerenderParams: eachLocale },
  { path: ':lang/how-it-works', renderMode: RenderMode.Prerender, getPrerenderParams: eachLocale },
  { path: ':lang/pricing', renderMode: RenderMode.Prerender, getPrerenderParams: eachLocale },
  { path: ':lang/advertise', renderMode: RenderMode.Prerender, getPrerenderParams: eachLocale },
  // A route parameter combined with a wildcard cannot be enumerated at build
  // time, so the localised legal pages are server-rendered per request
  // instead. Still fully crawlable — just not baked into the build output.
  { path: ':lang/legal/**', renderMode: RenderMode.Server },
  { path: ':lang/rooms/:id', renderMode: RenderMode.Server },
  // Explicit, same reason as ':lang/legal/**' above. Without this, the
  // builder's fallback logic hands the bare '**' entry's own prerender pass
  // eachLocale as its getPrerenderParams — eachLocale supplies 'lang', not
  // the '**' segment a plain catch-all needs, so that pass fails outright.
  { path: ':lang/**', renderMode: RenderMode.Server },

  // ── Private areas, both trees ──
  { path: 'auth/**', renderMode: RenderMode.Client },
  { path: 'reference/**', renderMode: RenderMode.Client },
  { path: 'tenant/**', renderMode: RenderMode.Client },
  { path: 'landlord/**', renderMode: RenderMode.Client },
  { path: 'admin/**', renderMode: RenderMode.Client },
  { path: 'account/**', renderMode: RenderMode.Client },
  { path: ':lang/auth/**', renderMode: RenderMode.Client },
  { path: ':lang/tenant/**', renderMode: RenderMode.Client },
  { path: ':lang/landlord/**', renderMode: RenderMode.Client },
  { path: ':lang/admin/**', renderMode: RenderMode.Client },
  { path: ':lang/account/**', renderMode: RenderMode.Client },

  { path: '**', renderMode: RenderMode.Prerender },
];
