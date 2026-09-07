import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../services/auth.service';

/** Non-admins are sent home rather than shown a 403 — doesn't reveal the admin portal exists. */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Wait for the startup refresh before deciding. isAuthenticated() is a
  // synchronous signal read, so on a hard page load this guard used to run
  // before the silent refresh had returned — which signed people out of any
  // guarded page simply for reloading it.
  return auth.sessionReady().pipe(
    map(() => {
        if (auth.isAdmin()) return true;
        return router.createUrlTree(['/']);
    }),
  );
};
