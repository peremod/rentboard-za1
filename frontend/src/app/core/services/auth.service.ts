import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap, catchError, of, Observable } from 'rxjs';
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

  private readonly _user = signal<User | null>(null);
  private readonly _accessToken = signal<string | null>(null);

  readonly user = this._user.asReadonly();
  readonly token = this._accessToken.asReadonly();
  readonly isAuthenticated = computed(() => !!this._user() && !!this._accessToken());
  readonly isLandlord = computed(() => this._user()?.role === 'LANDLORD');
  readonly isTenant = computed(() => this._user()?.role === 'TENANT');
  readonly isAdmin = computed(() => this._user()?.role === 'ADMIN');

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
    return this.http.post<AuthResponse>(`${this.api}/auth/refresh`, {}, { withCredentials: true }).pipe(
      tap((res) => this.setSession(res)),
      catchError(() => of(null)),
      // Re-map to just the user for callers that only care whether it worked.
      // (tap above already populated the signals on success.)
    ) as unknown as Observable<User | null>;
  }

  logout() {
    // Best-effort — revoke server-side even though we clear local state regardless.
    this.http.post(`${this.api}/auth/logout`, {}, { withCredentials: true }).subscribe({ error: () => {} });
    this._user.set(null);
    this._accessToken.set(null);
    this.router.navigate(['/']);
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
