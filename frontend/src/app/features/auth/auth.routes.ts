import { Routes } from '@angular/router';

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
    path: 'magic',
    loadComponent: () => import('./magic/magic-link').then((m) => m.MagicLink),
    title: 'Signing in — Mastande',
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
