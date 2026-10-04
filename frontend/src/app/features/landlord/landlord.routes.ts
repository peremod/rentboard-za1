import { Routes } from '@angular/router';

/** Landlord portal — guarded by [authGuard, landlordGuard] at the parent route in app.routes.ts. */
export const LANDLORD_ROUTES: Routes = [
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/landlord-dashboard').then((m) => m.LandlordDashboard),
    data: { pageTitle: 'Your dashboard' },
    title: 'Your Dashboard — Mastande',
  },
  {
    path: 'rooms/new',
    loadComponent: () => import('./create-room/create-room').then((m) => m.CreateRoom),
    data: { pageTitle: 'List a room' },
    title: 'List a Room — Mastande',
  },
  {
    // Resumes an existing draft in the same wizard used to create one.
    path: 'rooms/:roomId/edit',
    loadComponent: () => import('./create-room/create-room').then((m) => m.CreateRoom),
    data: { pageTitle: 'Continue your listing' },
    title: 'Continue Your Listing — Mastande',
  },
  {
    /**
     * My properties — Phase 7b.
     *
     * The list screen is new; the detail screen is the yard screen, scoped to
     * one property by its parameter. That reuse is deliberate: everything a
     * landlord does with a property — its rooms, their rent, the expenses
     * against the address, the lease documents, the tenants' notes — is already
     * built there, per property, and a second component rendering the same
     * things would be the copy that misses the next fix.
     */
    path: 'properties',
    loadComponent: () => import('./properties/properties').then((m) => m.Properties),
    data: { pageTitle: 'My properties' },
    title: 'My properties — Mastande',
  },
  {
    path: 'properties/:propertyId',
    loadComponent: () => import('./yard/yard').then((m) => m.Yard),
    data: { pageTitle: 'Your property' },
    title: 'Property — Mastande',
  },
  {
    // Where the nav pointed until Phase 7b. Kept as a redirect rather than
    // deleted: it is in a landlord's history and their bookmarks, and a 404 on
    // a URL that worked yesterday is the kind of thing people do not report,
    // they just stop using the screen.
    path: 'yard',
    redirectTo: 'properties',
    pathMatch: 'full',
  },
  {
    /**
     * All applicants, across every room — Phase 7c.
     *
     * Declared BEFORE `rooms/:roomId/applicants` is not needed (the paths do
     * not overlap), but it is listed next to it on purpose: this is the finder
     * and that is the manager, and the next person to touch one should see the
     * other.
     */
    path: 'applicants',
    loadComponent: () =>
      import('./applicants-inbox/applicants-inbox').then((m) => m.ApplicantsInbox),
    data: { pageTitle: 'All applicants' },
    title: 'All applicants — Mastande',
  },
  {
    path: 'rooms/:roomId/applicants',
    loadComponent: () => import('./applicants/applicants').then((m) => m.Applicants),
    data: { pageTitle: 'Applicants' },
    title: 'Applicants — Mastande',
  },
  {
    path: 'verification',
    loadComponent: () => import('./verification/landlord-verification').then((m) => m.LandlordVerification),
    data: { pageTitle: 'Verification' },
    title: 'Verification — Mastande',
  },
  // No 'upgrade' route. It served a page offering Pro at R349/mo and Agency at
  // R1,499/mo — plans that have no payment provider behind them and never had:
  // Stripe was removed (it does not operate in South Africa for receiving) and
  // PayFast recurring was never built. The page was unreachable behind a flag
  // and a guard, which kept visitors off it but kept the prices in the build,
  // where they were copied into the Terms as a binding subscription table.
  // Deleted rather than re-hidden. Nothing here recurs; see /pricing.
  {
    /**
     * The landlord's own view of their PUBLIC page. The public page itself is at
     * /landlords/:slug, outside this guarded, noIndex'd portal — see
     * app.routes.ts for why the brief's /landlord/[slug] could not work.
     */
    path: 'public-page',
    loadComponent: () =>
      import('./storefront-settings/storefront-settings').then((m) => m.StorefrontSettings),
    data: { pageTitle: 'Your public page' },
    title: 'Your public page — Mastande',
  },
  {
    path: 'services',
    loadComponent: () => import('./services/services').then((m) => m.LandlordServices),
    data: { pageTitle: 'Who to call' },
    title: 'Who to call — Mastande',
  },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
];
