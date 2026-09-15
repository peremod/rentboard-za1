import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '@env/environment';

/**
 * Sends cookies with every request to our own API.
 *
 * Without this the browser discards the Set-Cookie header on a cross-origin
 * response, so the refresh cookie issued at login was never stored — and every
 * page reload signed the person out with nothing to refresh from. It looked
 * like a broken refresh endpoint; the cookie had simply never existed.
 *
 * Applied per request rather than per call site so a new endpoint cannot
 * silently miss it. Login and register did, which is exactly how this
 * happened: refresh and logout set withCredentials, the two calls that
 * actually issue the cookie did not.
 *
 * Scoped to our own API. Sending credentials to a third party would be a
 * privacy problem, not just an unnecessary one.
 */
export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) return next(req);
  return next(req.clone({ withCredentials: true }));
};
