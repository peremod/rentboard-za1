import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { WHATSAPP_ENABLED } from '../../core/config/feature-flags';

/**
 * Lets a route through only while the WhatsApp channel is on — Phase 8j.
 *
 * Returns a UrlTree rather than `false`: a bare false leaves the person on
 * whatever page they were on with nothing explaining why the link did
 * nothing, which is the dead-control defect wearing a router's clothes.
 */
const whatsappOnlyGuard = () =>
  WHATSAPP_ENABLED ? true : inject(Router).createUrlTree(['/auth/register']);

/** Auth feature — lazy-loaded, no guard (unauthenticated users need access). */
export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./login/login').then((m) => m.Login),
    title: 'Log In — Mastande',
  },
  {
    path: 'register',
    loadComponent: () => import('./register/register').then((m) => m.Register),
    title: 'Create Your Free Account — Mastande',
  },
  {
    // Phase 7g part two. A separate path rather than a mode on 'register',
    // because the two forms have different shapes — see the component.
    path: 'register-phone',
    loadComponent: () => import('./register-phone/register-phone').then((m) => m.RegisterPhone),
    title: 'Sign up with your phone number — Mastande',
    /**
     * Phase 8j. The link to this page is hidden while WHATSAPP_ENABLED is
     * false, but a hidden link is not a closed door — this URL has been shared
     * and it is in the sitemap's history, so somebody will arrive here by
     * typing it or from a bookmark. Without the guard they would fill in the
     * whole form and meet a 503 at the end, which is the worst place to find
     * out. Redirected to the ordinary sign-up instead, which works.
     */
    canActivate: [whatsappOnlyGuard],
  },
  {
    path: 'magic',
    loadComponent: () => import('./magic/magic-link').then((m) => m.MagicLink),
    title: 'Signing in — Mastande',
  },
  {
    /**
     * Phase 7q. ⚠️ This page cannot START a recovery — there is no safe
     * self-service way to hand an account over. It is where the new handset
     * answers the code, and otherwise it explains what to do, because somebody
     * who lands here needs telling rather than a form that cannot help them.
     */
    path: 'lost-number',
    loadComponent: () => import('./lost-number/lost-number').then((m) => m.LostNumber),
    title: 'Lost the phone you sign in with? — Mastande',
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./forgot-password/forgot-password').then((m) => m.ForgotPassword),
    title: 'Reset your password — Mastande',
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./reset-password/reset-password').then((m) => m.ResetPassword),
    title: 'Choose a new password — Mastande',
  },
  {
    path: 'callback',
    loadComponent: () => import('./auth-callback/auth-callback').then((m) => m.AuthCallback),
    title: 'Signing you in… — Mastande',
  },
  { path: '', redirectTo: 'login', pathMatch: 'full' },
];
