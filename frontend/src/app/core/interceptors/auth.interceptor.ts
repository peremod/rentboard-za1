import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { EMPTY, switchMap } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { environment } from '@env/environment';

/** Endpoints that must never wait on the session — they are what establishes it. */
const SESSION_ENDPOINTS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout', '/auth/google'];

const isSessionEndpoint = (url: string) => SESSION_ENDPOINTS.some((p) => url.includes(p));

/**
 * Public reads a server-side render is allowed to make.
 *
 * These need no session, answer the same for everyone, and are exactly the
 * data the crawlable pages are made of: the board's listings, a room, its
 * reviews, the place taxonomy behind the filters, and the board's ad slots.
 *
 * Anything not on this list is still dropped during SSR — see below.
 */
const SSR_PUBLIC_PREFIXES = ['/rooms', '/reviews', '/places', '/ads'];

const isPublicRead = (req: { url: string; method: string }) => {
  if (req.method !== 'GET') return false;
  const path = req.url.slice(environment.apiUrl.length);
  return SSR_PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?'));
};

/**
 * Attaches the access token to requests going to our own API, and marks every
 * such request withCredentials so the httpOnly refresh cookie is sent and
 * received. Not applied to third-party requests such as ImageKit.
 *
 * It also HOLDS requests until the startup session refresh has settled.
 *
 * That is the important part. On a reload the dashboard fires its calls as
 * soon as it renders, and those left before the refresh had returned a token —
 * so four requests went out unauthenticated, came back 401, and the error
 * interceptor treated that as an expired session and redirected to login.
 * The recovery then navigated back, the dashboard mounted again, and the whole
 * cycle repeated: the seven identical rounds of 401s in the console.
 *
 * Waiting costs one round trip that was already happening, and removes the
 * entire class of problem rather than handling its symptoms downstream.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  if (!req.url.startsWith(environment.apiUrl)) return next(req);

  // On the server there is no cookie and no token, so a request needing one is
  // guaranteed to 401. The guards let routes through during SSR so the server
  // does not render a signed-out page, which means the portal components mount
  // and fire their loads there too — guaranteed 401s per render, logged in the
  // frontend terminal rather than the browser. Those routes are client-
  // rendered, so nothing is lost by not fetching: the browser loads the data
  // itself a moment later.
  //
  // But this used to drop EVERY request during SSR, public ones included, and
  // returning EMPTY completes the observable without a value — so neither the
  // `next` nor the `error` handler ran. The consequence was not a logging
  // detail: /rooms/:id is server-rendered per request precisely so a crawler
  // sees the room, and it rendered "Loading…" with the site's default title
  // and description and no JSON-LD, on every room page, for every crawler.
  // The prerendered board came out of the build with its empty state, and a
  // room id that does not exist rendered its 200 instead of its not-found
  // branch, because the branch is chosen by the response that never arrived.
  //
  // So: public reads go through on the server. Everything else still does not.
  if (!auth.isBrowserPlatform && !isSessionEndpoint(req.url) && !isPublicRead(req)) {
    return EMPTY;
  }

  // Server-side, a public read carries no credentials — there are none to
  // carry — and must not wait on a session refresh that cannot happen.
  if (!auth.isBrowserPlatform) return next(req);

  const attach = () => {
    const token = auth.token();
    return next(req.clone({
      withCredentials: true,
      ...(token && { setHeaders: { Authorization: `Bearer ${token}` } }),
    }));
  };

  // Session endpoints cannot wait on the session they are establishing.
  if (isSessionEndpoint(req.url) || auth.sessionResolved()) return attach();

  return auth.sessionReady().pipe(switchMap(attach));
};
