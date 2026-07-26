import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const landlordGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isLandlord() || auth.isAdmin()) return true;
  return router.createUrlTree(['/tenant/dashboard']);
};
