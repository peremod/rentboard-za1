import { Injectable, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap, catchError, of, Observable, map, shareReplay, finalize } from 'rxjs';
import { environment } from '@env/environment';
import { AuthResponse, LoginDto, RegisterDto, User } from '../models/user.model';

/**
 * AuthService — auth hardening (v0.9.2). See PRE-LAUNCH-CHECKLIST.md #2 /
 * README §20 for the full rationale. Summary of what changed from the
 * original localStorage-based design:
 *
 * - The access token now lives ONLY in an in-memory signal — never
 *   localStorage, never sessionStorage. A page refresh loses it by design;
 *   `restoreSession()` (called once from App on startup) silently gets a
 *   new one from the refresh cookie instead.
 * - The refresh token never touches JavaScript at all — it's an httpOnly
 *   cookie the browser sends automatically (`withCredentials: true` on
 *   every request to our API, set in authInterceptor). This is the actual
 *   fix for the XSS-can-steal-the-token finding: no script, injected or
 *   otherwise, can read an httpOnly cookie.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private api = environment.apiUrl;

  /** The in-flight startup refresh, shared by every caller. */
  private restore?: Observable<User | null>;

  /**
   * Whether the startup refresh has finished, as a signal so templates can
   * wait for it. Until it flips, the app does not yet know whether anyone is
   * signed in — rendering signed-out UI in that window is what makes a reload
   * flash before settling.
   */
  readonly sessionResolved = signal(false);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Exposed for the interceptor, which must not fetch during SSR. */
  get isBrowserPlatform(): boolean {
    return this.isBrowser;
  }

  private readonly _user = signal<User | null>(null);
  private readonly _accessToken = signal<string | null>(null);

  readonly user = this._user.asReadonly();
  readonly token = this._accessToken.asReadonly();
  readonly isAuthenticated = computed(() => !!this._user() && !!this._accessToken());
  readonly isLandlord = computed(() => this._user()?.role === 'LANDLORD');
  readonly isTenant = computed(() => this._user()?.role === 'TENANT');
  readonly isAdmin = computed(() => this._user()?.role === 'ADMIN');

  /**
   * Where this user's own dashboard is.
   *
   * Every redirect used to ask 'landlord or not', which sent admins to the
   * tenant dashboard — so signing in as an admin produced two dashboards, one
   * of them showing an empty tenant view that made no sense for the account.
   *
   * One place, three roles. A new role gets handled here rather than in the
   * five call sites that each guessed.
   */
  homeRoute(): string {
    const role = this._user()?.role;
    if (role === 'ADMIN') return '/admin/dashboard';
    if (role === 'LANDLORD') return '/landlord/dashboard';
    return '/tenant/dashboard';
  }

  /** For callers holding a user object before the session signal is set. */
  homeRouteFor(role: string): string {
    if (role === 'ADMIN') return '/admin/dashboard';
    if (role === 'LANDLORD') return '/landlord/dashboard';
    return '/tenant/dashboard';
  }

  login(dto: LoginDto) {
    return this.http.post<AuthResponse>(`${this.api}/auth/login`, dto).pipe(tap((res) => this.setSession(res)));
  }

  register(dto: RegisterDto) {
    return this.http.post<AuthResponse>(`${this.api}/auth/register`, dto).pipe(tap((res) => this.setSession(res)));
  }

  loginWithGoogle(role: 'TENANT' | 'LANDLORD' = 'TENANT', returnUrl?: string) {
    const params = new URLSearchParams({ role, ...(returnUrl ? { returnUrl } : {}) });
    window.location.href = `${this.api}/auth/google?${params.toString()}`;
  }

  /**
   * Called by AuthCallbackComponent after Google redirects back with the
   * access token in the URL fragment (never the query string — fragments
   * aren't sent to any server or logged). The refresh cookie was already
   * set by the backend redirect itself.
   */
  handleGoogleCallback(accessToken: string) {
    this._accessToken.set(accessToken);
    return this.http.get<User>(`${this.api}/auth/me`).pipe(tap((user) => this._user.set(user)));
  }

  /**
   * Silently restores a session using the httpOnly refresh cookie — called
   * once from App on startup. No-op, not an error, if there's no valid
   * cookie (e.g. first visit, or it expired): the person is simply
   * signed-out, same as before this pass existed.
   */
  restoreSession(): Observable<User | null> {
    // Never on the server. Node has no cookie jar, so this always failed there
    // and the server rendered the signed-out shell — which the browser painted
    // for a moment before hydration restored the real session. That is the
    // login flash on reload, and every cookieless refresh call in the API log.
    if (!this.isBrowser) {
      this.sessionResolved.set(true);
      return of(null);
    }


    // Shared so concurrent callers — App on startup and every guard on the
    // first navigation — wait on one request rather than each firing their own.
    this.restore ??= this.http
      .post<AuthResponse>(`${this.api}/auth/refresh`, {}, { withCredentials: true })
      .pipe(
        tap((res) => this.setSession(res)),
        map((res) => res.user as User),
        catchError(() => of(null)),
        finalize(() => this.sessionResolved.set(true)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    return this.restore;
  }

  /**
   * Resolves once the startup refresh has finished, either way.
   *
   * Guards need this. restoreSession is asynchronous but isAuthenticated() is
   * a synchronous signal read, so on a hard page load the guard ran first, saw
   * no user, and redirected to login — reloading any guarded page signed the
   * person out even though their refresh cookie was perfectly valid.
   */
  /** True once the startup refresh has settled, either way. */
  get sessionSettled(): boolean {
    return this.sessionResolved();
  }

  sessionReady(): Observable<boolean> {
    if (this.sessionResolved()) return of(this.isAuthenticated());
    return this.restoreSession().pipe(map(() => this.isAuthenticated()));
  }

  /**
   * Name and phone only. Email and password have their own endpoints because
   * both require the current password.
   */
  updateProfile(data: { fullName?: string; phone?: string; marketingEmails?: boolean }) {
    return this.http.patch<User>(`${this.api}/users/me`, data).pipe(
      tap((updated) => this._user.set({ ...this._user()!, ...updated })),
    );
  }

  /** Sends a code to verify the number already on the account. */
  requestPhoneVerification() {
    return this.http.post<{ message: string }>(`${this.api}/auth/phone/verify-number`, {});
  }

  confirmPhoneVerification(code: string) {
    return this.http
      .post<{ verified: boolean; phone: string; message: string }>(
        `${this.api}/auth/phone/confirm-number`, { code },
      )
      .pipe(tap(() => {
        const current = this._user();
        if (current) this._user.set({ ...current, phoneVerified: true });
      }));
  }

  /** Sends a sign-in code over WhatsApp. Same response either way. */
  requestPhoneCode(phone: string) {
    return this.http.post<{ message: string }>(`${this.api}/auth/phone/request-code`, { phone });
  }

  verifyPhoneCode(phone: string, code: string) {
    return this.http
      .post<AuthResponse>(`${this.api}/auth/phone/verify`, { phone, code })
      .pipe(tap((res) => this.setSession(res)));
  }

  /** Passwordless sign-in. Always resolves the same way, account or not. */
  requestMagicLink(email: string, role?: 'TENANT' | 'LANDLORD') {
    return this.http.post<{ message: string }>(`${this.api}/auth/magic-link`, { email, role });
  }

  verifyMagicLink(token: string) {
    return this.http
      .post<AuthResponse>(`${this.api}/auth/magic-link/verify`, { token })
      .pipe(tap((res) => this.setSession(res)));
  }

  /** Always resolves the same way, existing account or not. */
  forgotPassword(email: string) {
    return this.http.post<{ message: string }>(`${this.api}/auth/forgot-password`, { email });
  }

  resetPassword(token: string, newPassword: string) {
    return this.http.post<{ message: string }>(`${this.api}/auth/reset-password`, { token, newPassword });
  }

  /** Signed in. Requires the current password — a live session alone is not enough. */
  changePassword(currentPassword: string, newPassword: string) {
    return this.http.post<{ message: string }>(`${this.api}/auth/change-password`, {
      currentPassword, newPassword,
    });
  }

  requestEmailChange(newEmail: string, currentPassword: string) {
    return this.http.post<{ message: string }>(`${this.api}/auth/change-email`, {
      newEmail, currentPassword,
    });
  }

  /**
   * Signs out deliberately: revokes server-side and goes home.
   *
   * Only for a person choosing to log out. The error interceptor used to call
   * this on a 401, which meant a request that raced the startup refresh
   * revoked the very session being restored and navigated home — the reload
   * landing on '/' rather than the dashboard.
   */
  logout() {
    this.http.post(`${this.api}/auth/logout`, {}, { withCredentials: true }).subscribe({ error: () => {} });
    this.clearSession();
    this.router.navigate(['/']);
  }

  /**
   * Drops local session state without revoking anything or navigating.
   *
   * For the interceptor: when a token has expired, forgetting it locally is
   * the whole job. Revoking the refresh token as well destroys the means of
   * recovery, and navigating fights whatever the router is already doing.
   */
  clearSession() {
    this._user.set(null);
    this._accessToken.set(null);
  }

  /** Called by errorInterceptor after a successful silent refresh, to update in-memory state before retrying the original request. */
  applyRefreshedSession(res: AuthResponse) {
    this.setSession(res);
  }

  private setSession(res: AuthResponse) {
    this._user.set(res.user);
    this._accessToken.set(res.accessToken);
  }
}
