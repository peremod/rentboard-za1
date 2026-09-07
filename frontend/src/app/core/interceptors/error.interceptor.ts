import { HttpInterceptorFn, HttpErrorResponse, HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError, of } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { DialogService } from '../services/dialog.service';

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
  const dialogs = inject(DialogService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      const isAuthEndpoint = AUTH_ENDPOINTS_NO_RETRY.some((p) => req.url.includes(p));

      if (err.status === 401 && !isAuthEndpoint) {
        return attemptSilentRefreshAndRetry(req, next, auth, router, dialogs);
      }

      handleNonAuthError(err, dialogs);
      return throwError(() => err);
    }),
  );
};

function attemptSilentRefreshAndRetry(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  auth: AuthService,
  router: Router,
  dialogs: DialogService,
) {
  return auth.restoreSession().pipe(
    switchMap((user) => {
      if (!user) {
        // Same reasoning: only treat this as an expired session once the
        // startup refresh has actually settled.
        if (!auth.sessionSettled) return throwError(() => new Error('Session not ready'));

        dialogs.alert('Signed out', 'Your session has expired. Please log in again.', 'warning', 'Log in');
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
      // During startup the app has no access token yet, so any request that
      // races the session refresh comes back 401. Redirecting on that is what
      // painted the login page for a moment on every reload — the session was
      // about to be restored successfully.
      if (!auth.sessionSettled) return throwError(() => err);

      dialogs.alert('Signed out', 'Your session has expired. Please log in again.', 'warning', 'Log in');
      auth.logout();
      router.navigate(['/auth/login'], { queryParams: { returnUrl: router.url } });
      return throwError(() => err);
    }),
  );
}

function handleNonAuthError(err: HttpErrorResponse, dialogs: DialogService) {
  switch (err.status) {
    case 403:
      dialogs.error("You don't have permission to do that.", 'Not allowed');
      break;
    case 429:
      dialogs.error('Too many requests. Please wait a moment and try again.', 'Slow down');
      break;
    case 400:
    case 422: {
      const msg = (err.error as any)?.message;
      if (msg && typeof msg === 'string') dialogs.error(msg);
      break;
    }
    default:
      if (err.status >= 500) {
        dialogs.error('Something went wrong on our end. Please try again shortly.', 'Server error');
      }
  }
}
