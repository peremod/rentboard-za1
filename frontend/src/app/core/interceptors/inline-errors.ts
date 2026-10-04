import { HttpContext, HttpContextToken } from '@angular/common/http';

/**
 * "This form shows the failure itself — do not put a dialog over it."
 *
 * Set on a request whose component renders the refusal inline, so the same
 * message is not reported twice: once in a modal that has to be dismissed and
 * once in the `.field-error` under the field it belongs to.
 *
 * It suppresses the DIALOG only. The silent-refresh path for a genuinely
 * expired token is untouched, and the error still reaches the caller's own
 * `error` handler — which is what writes the inline message.
 *
 * ── Why this lives in its own file
 *
 * `errorInterceptor` imports `AuthService`, so a token declared there and
 * imported back into `auth.service.ts` would close a cycle. The token is data,
 * not behaviour, so it belongs on its own.
 */
export const INLINE_ERRORS = new HttpContextToken(() => false);

/** `{ context: inlineErrors() }` on an HttpClient call. */
export function inlineErrors(): HttpContext {
  return new HttpContext().set(INLINE_ERRORS, true);
}
