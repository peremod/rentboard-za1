import { Routes } from '@angular/router';

/** Auth feature — lazy-loaded, no guard (unauthenticated users need access). */
export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./login/login').then((m) => m.Login),
    title: 'Log In — RentBoard',
  },
  {
    path: 'register',
    loadComponent: () => import('./register/register').then((m) => m.Register),
    title: 'Create Your Free Account — RentBoard',
  },
  {
    path: 'callback',
    loadComponent: () => import('./auth-callback/auth-callback').then((m) => m.AuthCallback),
    title: 'Signing you in… — RentBoard',
  },
  { path: '', redirectTo: 'login', pathMatch: 'full' },
];
