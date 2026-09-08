import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { EMPTY, switchMap } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { environment } from '@env/environment';

/** Endpoints that must never wait on the session — they are what establishes it. */
const SESSION_ENDPOINTS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout', '/auth/google'];

const isSessionEndpoint = (url: string) => SESSION_ENDPOINTS.some((p) => url.includes(p));

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

  // On the server there is no cookie and no token, so any request needing one
  // is guaranteed to 401. The guards let routes through during SSR so the
  // server does not render a signed-out page, which means components mount and
  // fire their loads there too — four guaranteed 401s per render, logged in
  // the frontend terminal rather than the browser.
  //
  // These routes are client-rendered, so nothing is lost by not fetching:
  // the browser will load the data itself a moment later.
  if (!auth.isBrowserPlatform && !isSessionEndpoint(req.url)) {
    return EMPTY;
  }

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
