import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const landlordGuard: CanActivateFn = () => {
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
        if (auth.isLandlord() || auth.isAdmin()) return true;
        return router.createUrlTree(['/tenant/dashboard']);
    }),
  );
};
