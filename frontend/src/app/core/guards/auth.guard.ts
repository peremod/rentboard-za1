import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../services/auth.service';

/** Redirects unauthenticated users to login, preserving the attempted URL as returnUrl. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Wait for the startup refresh before deciding. isAuthenticated() is a
  // synchronous signal read, so on a hard page load this guard used to run
  // before the silent refresh had returned — which signed people out of any
  // guarded page simply for reloading it.
  return auth.sessionReady().pipe(
    map(() => {
        if (auth.isAuthenticated()) return true;
        return router.createUrlTree(['/auth/login'], { queryParams: { returnUrl: state.url } });
    }),
  );
};
