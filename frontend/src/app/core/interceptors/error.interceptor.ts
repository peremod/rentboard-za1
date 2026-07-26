import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ToastService } from '../services/toast.service';

/**
 * Global HTTP error handler — 401 logs out + redirects, 429/5xx show a toast.
 * Always rethrows so components can still handle errors locally if needed.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const toast = inject(ToastService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      switch (err.status) {
        case 401:
          if (!req.url.includes('/auth/me')) {
            toast.error('Your session has expired. Please log in again.');
          }
          auth.logout();
          router.navigate(['/auth/login'], { queryParams: { returnUrl: router.url } });
          break;
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
      return throwError(() => err);
    }),
  );
};
