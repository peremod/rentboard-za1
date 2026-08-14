import { HttpInterceptorFn, HttpErrorResponse, HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError, of } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ToastService } from '../services/toast.service';

/** Requests where a 401 must never trigger a silent-refresh attempt — refreshing off a failed refresh/login is how you build an infinite loop. */
const AUTH_ENDPOINTS_NO_RETRY = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/google'];

/**
 * Global HTTP error handler.
 *
 * 401 on any *other* endpoint: attempt exactly one silent refresh (via the
 * httpOnly cookie), and if that succeeds, retry the original request once
 * with the new access token. Only logs out if the refresh itself also
 * fails — this is what makes the short 15-minute access token invisible
 * to the person using the app in the common case.
 *
 * Known simplification: concurrent 401s each trigger their own refresh
 * call rather than sharing one in-flight refresh. Harmless (rotation is
 * safe to call more than once in quick succession) but not maximally
 * efficient — a shared-refresh-lock is a reasonable follow-up, not done
 * here to keep this change reviewable.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const toast = inject(ToastService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      const isAuthEndpoint = AUTH_ENDPOINTS_NO_RETRY.some((p) => req.url.includes(p));

      if (err.status === 401 && !isAuthEndpoint) {
        return attemptSilentRefreshAndRetry(req, next, auth, router, toast);
      }

      handleNonAuthError(err, toast);
      return throwError(() => err);
    }),
  );
};

function attemptSilentRefreshAndRetry(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  auth: AuthService,
  router: Router,
  toast: ToastService,
) {
  return auth.restoreSession().pipe(
    switchMap((user) => {
      if (!user) {
        toast.error('Your session has expired. Please log in again.');
        auth.logout();
        router.navigate(['/auth/login'], { queryParams: { returnUrl: router.url } });
        return throwError(() => new Error('Session expired'));
      }
      // Re-issue the original request — authInterceptor will attach the
      // freshly-refreshed token since it reads auth.token() at clone time.
      const retried = req.clone({ setHeaders: { Authorization: `Bearer ${auth.token()}` } });
      return next(retried);
    }),
    catchError((err) => {
      toast.error('Your session has expired. Please log in again.');
      auth.logout();
      router.navigate(['/auth/login'], { queryParams: { returnUrl: router.url } });
      return throwError(() => err);
    }),
  );
}

function handleNonAuthError(err: HttpErrorResponse, toast: ToastService) {
  switch (err.status) {
    case 403:
      toast.error("You don't have permission to do that.");
      break;
    case 429:
      toast.error('Too many requests — please slow down and try again.');
      break;
    case 400:
    case 422: {
      const msg = (err.error as any)?.message;
      if (msg && typeof msg === 'string') toast.error(msg);
      break;
    }
    default:
      if (err.status >= 500) toast.error('Something went wrong on our end. Please try again shortly.');
  }
}
