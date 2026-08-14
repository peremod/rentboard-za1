import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { BILLING_ENABLED } from '../config/feature-flags';

/**
 * Blocks direct navigation to billing routes (/landlord/upgrade,
 * /tenant/passport) while BILLING_ENABLED is false — hiding the links
 * alone isn't enough, since someone could still land on the URL directly
 * (bookmark, typed URL, old link). Redirects to the person's dashboard.
 */
export const billingEnabledGuard: CanActivateFn = () => {
  if (BILLING_ENABLED) return true;
  const router = inject(Router);
  return router.createUrlTree(['/']);
};
