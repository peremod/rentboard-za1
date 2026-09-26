import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { throwError, timeout } from 'rxjs';
import { environment } from '@env/environment';

/**
 * A ceiling on how long a server-side render will wait for our own API.
 *
 * Eight seconds, chosen between two hard limits:
 *
 *  · @angular/build aborts a prerendered route after 30s. A render that is
 *    still waiting on a request at that point fails the whole build — not the
 *    one route, the build, because the worker pool is torn down and every
 *    route still in flight fails with "Terminating worker thread".
 *  · the API sleeps when idle on its current plan, and a cold start is slow.
 *    Under this ceiling a room page answers 503 with Retry-After instead of
 *    the room while the API wakes up, which is the honest answer and one
 *    Google retries. Over it, nothing answers at all.
 *
 * This exists because production builds failed for three days and nothing in
 * the repo could see why. api.umastande.co.za resolves on a GitHub runner to
 * something that accepts the connection and never replies, so the board's
 * listing request hung, the home page never became stable, and the 30s abort
 * took `/`, `/af`, `/zu` and three innocent routes down with it. Before
 * v1.73.0 the interceptor dropped every server-side request, so no build had
 * ever depended on a reachable API; making public reads real made the build
 * depend on the network, and nothing bounded the wait.
 *
 * Browser requests are untouched: a slow request there is the user's own
 * network, they can see it happening, and 8 seconds is not a limit worth
 * imposing on someone on a 3G connection in Kwa Thema.
 */
const SERVER_REQUEST_TIMEOUT_MS = 8000;

/**
 * 504, not a bare TimeoutError: the components already split their error
 * handling by status, and a timeout must land on the same branch as any other
 * failure to reach the API. room-detail answers 503 with Retry-After for it
 * (never 404 — that would ask Google to drop a room that exists), the board
 * renders its empty state, and an ad slot renders nothing.
 */
export const serverTimeoutInterceptor: HttpInterceptorFn = (req, next) => {
  if (isPlatformBrowser(inject(PLATFORM_ID))) return next(req);
  if (!req.url.startsWith(environment.apiUrl)) return next(req);

  return next(req).pipe(
    timeout({
      each: SERVER_REQUEST_TIMEOUT_MS,
      with: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 504,
              statusText: 'Gateway Timeout',
              url: req.url,
              error: new Error(`No answer from the API in ${SERVER_REQUEST_TIMEOUT_MS}ms`),
            }),
        ),
    }),
  );
};
