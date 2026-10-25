import { HttpInterceptorFn, HttpErrorResponse, HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError, of } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { DialogService } from '../services/dialog.service';
import { INLINE_ERRORS } from './inline-errors';

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

/**
 * Sends someone to the login page once, keeping the destination they were
 * actually trying to reach.
 *
 * router.url is the CURRENT url, so redirecting from the login page put the
 * login page in its own returnUrl. Repeated 401s nested it further each time —
 * producing /auth/login?returnUrl=/auth/login?returnUrl=/tenant/dashboard —
 * and every layer had to be unwound by another reload before the real
 * destination was reached. That is the 'refresh four times' behaviour.
 */
function redirectToLogin(router: Router, auth: AuthService) {
  // If the app currently holds a valid session, this 401 is stale — a request
  // that set off before the startup refresh completed, carrying no token or an
  // expired one. The guard has already let the person in. Signing them out on
  // the strength of a reply to a question asked earlier is how a reload ended
  // up back at the login page with a working session.
  if (auth.isAuthenticated()) return;

  const current = router.url;

  // Already there: do not stack another layer.
  if (current.startsWith('/auth/login')) return;

  // If we somehow arrived with a nested returnUrl, keep the innermost one —
  // that is the page the person actually wanted.
  let returnUrl = current;
  let guard = 0;
  while (returnUrl.includes('returnUrl=') && guard++ < 5) {
    returnUrl = decodeURIComponent(returnUrl.split('returnUrl=')[1] ?? returnUrl);
  }

  router.navigate(['/auth/login'], { queryParams: { returnUrl } });
}

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

      if (!req.context.get(INLINE_ERRORS)) handleNonAuthError(err, dialogs, req);
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
        auth.clearSession();
        redirectToLogin(router, auth);
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
      auth.clearSession();
      redirectToLogin(router, auth);
      return throwError(() => err);
    }),
  );
}

/**
 * What a person is told when a request fails for a reason that is not theirs.
 *
 * ⚠️ "Something went wrong on our end. Please try again shortly." was the
 * answer to every status at or above 500, and it is three different situations
 * wearing one sentence:
 *
 *   · the API was unreachable, or the phone's connection dropped (status 0)
 *   · the platform answered instead of the API: 502, 503 or 504. On this
 *     deployment the API sleeps when idle, so the FIRST request after a quiet
 *     spell can be one of these and the next one succeeds. Reported on a
 *     landlord dashboard at 04:38 — exactly the hour the API would be cold.
 *   · the API itself threw: a genuine 500, which is a bug and will not fix
 *     itself on a retry.
 *
 * Telling somebody to "try again shortly" is right for the first two and wrong
 * for the third, and a report of "Server error" names none of them. So the
 * dialog says which of the three it was, and the console carries the method,
 * the path and the status — the one line that would have turned a screenshot
 * into a diagnosis.
 */
function describeServerFailure(err: HttpErrorResponse, path: string): { title: string; body: string } {
  if (err.status === 0) {
    return {
      title: 'No connection',
      body: 'Your phone could not reach Mastande. Check your data or wi-fi and try again.',
    };
  }
  if (err.status === 502 || err.status === 503 || err.status === 504) {
    return {
      title: 'Waking up',
      body: 'Mastande did not answer in time — this usually means it was idle and is starting up. '
        + 'Wait a few seconds and try again.',
    };
  }
  return {
    title: 'Server error',
    body: `Something went wrong on our end, and it was not your doing. Please try again shortly.\n\n`
      + `If it keeps happening, quote this: ${path} (${err.status}).`,
  };
}

function handleNonAuthError(err: HttpErrorResponse, dialogs: DialogService, req?: HttpRequest<unknown>) {
  switch (err.status) {
    /**
     * ⚠️ Use OUR message when there is one.
     *
     * 403 is also the honest code for a step-up check that failed — a wrong
     * current password on a form, where the session is fine and the action is
     * refused. Those used to be 401, which the branch above reads as an expired
     * session: the retry re-sent the wrong password and the person was logged
     * out and told their session had expired. Replacing a specific reason with
     * "You don't have permission to do that." would be the same loss of
     * information by a shorter route.
     */
    case 403: {
      const msg = (err.error as any)?.message;
      dialogs.error(
        typeof msg === 'string' && msg ? msg : "You don't have permission to do that.",
        'Not allowed',
      );
      break;
    }
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
      if (err.status >= 500 || err.status === 0) {
        // Path only, never the query string: a search or a filter can carry
        // what somebody typed, and this line goes on screen and into a log.
        const path = req ? `${req.method} ${safePath(req.url)}` : 'a request';
        // Always, and before the dialog: whoever is looking at a browser
        // console gets the failing call named even if the person taps OK
        // before reading anything.
        console.error(`[http] ${path} failed with ${err.status}`, err.error);
        const { title, body } = describeServerFailure(err, path);
        dialogs.error(body, title);
      }
  }
}

/** The path of a URL, without origin or query string. */
function safePath(url: string): string {
  try {
    return new URL(url, 'http://x').pathname;
  } catch {
    return url.split('?')[0];
  }
}
