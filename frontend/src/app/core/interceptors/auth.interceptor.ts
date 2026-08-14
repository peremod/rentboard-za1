import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { environment } from '@env/environment';

/**
 * Attaches the access token to requests going to our own API, and marks
 * every such request withCredentials so the httpOnly refresh cookie is
 * actually sent/received (required for /auth/refresh, /auth/logout, and
 * every login/register/refresh response that sets the cookie in the
 * first place). Not applied to third-party requests (e.g. ImageKit).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const isApiRequest = req.url.startsWith(environment.apiUrl);
  if (!isApiRequest) return next(req);

  const token = auth.token();
  req = req.clone({
    withCredentials: true,
    ...(token && { setHeaders: { Authorization: `Bearer ${token}` } }),
  });
  return next(req);
};
