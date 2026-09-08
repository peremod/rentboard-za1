import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../services/auth.service';

/** Redirects unauthenticated users to login, preserving the attempted URL as returnUrl. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // On the server there is no cookie and no session, so this would always
  // redirect — and the browser would paint that server-rendered login page
  // before hydration restored the real session. Let it through and let the
  // client decide; these routes are client-rendered anyway.
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

  // Wait for the startup refresh before deciding. isAuthenticated() is a
  // synchronous signal read, so on a hard page load this guard used to run
  // before the silent refresh had returned — which signed people out of any
  // guarded page simply for reloading it.
  return auth.sessionReady().pipe(
    map(() => {
      // Temporary: remove once the reload behaviour is confirmed working.
      console.info('[guard] decided. authenticated =', auth.isAuthenticated(), 'for', state.url);
        if (auth.isAuthenticated()) return true;
        // Never nest: if the attempted url is already a login url, keep the
        // destination it carries rather than wrapping it again.
        const attempted = state.url.startsWith('/auth/login')
          ? decodeURIComponent(state.url.split('returnUrl=')[1] ?? '/')
          : state.url;
        return router.createUrlTree(['/auth/login'], { queryParams: { returnUrl: attempted } });
    }),
  );
};
