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
  { path: ':lang/**', renderMode: RenderMode.Server, status: 404 },

  // The two redirect routes, named explicitly. Without an entry of their own
  // they fall under the catch-alls below, and a catch-all that answers 404
  // cannot describe a redirect — the build says so outright: "The '404'
  // status code is not a valid redirect response code". 301 is also the right
  // answer for /rooms, which is a permanent move to the board.
  { path: 'rooms', renderMode: RenderMode.Server, status: 301 },
  { path: ':lang/rooms', renderMode: RenderMode.Server, status: 301 },

  // ── Private areas, both trees ──
  { path: 'auth/**', renderMode: RenderMode.Client },
  { path: 'reference/**', renderMode: RenderMode.Client },
  { path: 'tenant/**', renderMode: RenderMode.Client },
  { path: 'landlord/**', renderMode: RenderMode.Client },
  { path: 'admin/**', renderMode: RenderMode.Client },
  { path: 'account/**', renderMode: RenderMode.Client },
  { path: ':lang/auth/**', renderMode: RenderMode.Client },
  // Mirrors 'reference/**'. Without it a reference link arriving with a
  // language prefix fell through to ':lang/**', which now answers 404.
  { path: ':lang/reference/**', renderMode: RenderMode.Client },
  { path: ':lang/tenant/**', renderMode: RenderMode.Client },
  { path: ':lang/landlord/**', renderMode: RenderMode.Client },
  { path: ':lang/admin/**', renderMode: RenderMode.Client },
  { path: ':lang/account/**', renderMode: RenderMode.Client },

  /**
   * Not found, with the status to match.
   *
   * This was Prerender, so an unknown URL answered **HTTP 200** with the
   * "Page not found" page — a soft 404, which is worse than a real one: the
   * URL stays in the index, competes with real pages, and the crawl keeps
   * coming back to it. It is also how /robots.txt and /sitemap.xml came to
   * answer 200 with an HTML page, which Lighthouse found by parsing our 404
   * page as robots directives and reporting 58 syntax errors.
   *
   * Server rather than Prerender because `status` does not exist on a
   * prerendered route, and cannot: a file on disk has no status of its own.
   *
   * This entry is not the whole fix. A ':lang' server route matches ANY single
   * segment — server route matching happens before anything runs, so
   * localeMatchGuard never gets a say — which means '/foo' matches ':lang' and
   * '/xx/pricing' matches ':lang/pricing' and neither reaches this catch-all.
   * Enumerating the ten locales here instead is rejected by the build
   * ("the 'zu/rooms/*' server route does not match any routes defined in the
   * Angular routing configuration"), because the client tree declares them
   * under a ':lang' parameter. So the status for those is set in server.ts,
   * from a marker the error page itself renders — see NOT_FOUND_MARKER there.
   */
  { path: '**', renderMode: RenderMode.Server, status: 404 },
];
