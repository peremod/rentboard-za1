import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap, catchError, of } from 'rxjs';
import { environment } from '@env/environment';
import { AuthResponse, LoginDto, RegisterDto, User } from '../models/user.model';

/**
 * AuthService — signal-based auth state, consumed reactively by guards,
 * interceptors, and any component that injects it.
 *
 * Token storage: localStorage (simplest for MVP). Post-launch hardening
 * (httpOnly cookie + refresh rotation) is tracked in the project's audit
 * fixes doc — not required for this pass.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private api = environment.apiUrl;

  private readonly _user = signal<User | null>(this.loadStoredUser());
  private readonly _token = signal<string | null>(this.loadStoredToken());

  readonly user = this._user.asReadonly();
  readonly token = this._token.asReadonly();
  readonly isAuthenticated = computed(() => !!this._user() && !!this._token());
  readonly isLandlord = computed(() => this._user()?.role === 'LANDLORD');
  readonly isTenant = computed(() => this._user()?.role === 'TENANT');
  readonly isAdmin = computed(() => this._user()?.role === 'ADMIN');

  login(dto: LoginDto) {
    return this.http.post<AuthResponse>(`${this.api}/auth/login`, dto).pipe(tap((res) => this.setSession(res)));
  }

  register(dto: RegisterDto) {
    return this.http.post<AuthResponse>(`${this.api}/auth/register`, dto).pipe(tap((res) => this.setSession(res)));
  }

  /** Redirects the browser to the backend's Google OAuth entry point. */
  loginWithGoogle(role: 'TENANT' | 'LANDLORD' = 'TENANT', returnUrl?: string) {
    const params = new URLSearchParams({ role, ...(returnUrl ? { returnUrl } : {}) });
    window.location.href = `${this.api}/auth/google?${params.toString()}`;
  }

  /** Called by AuthCallbackComponent after Google redirects back with ?token=... */
  handleGoogleCallback(token: string) {
    this._token.set(token);
    localStorage.setItem('rb_token', token);
    return this.http.get<User>(`${this.api}/auth/me`).pipe(
      tap((user) => {
        this._user.set(user);
        localStorage.setItem('rb_user', JSON.stringify(user));
      }),
    );
  }

  logout() {
    this._user.set(null);
    this._token.set(null);
    localStorage.removeItem('rb_user');
    localStorage.removeItem('rb_token');
    this.router.navigate(['/']);
  }

  /** Called on app startup to sync the latest user state with the server. */
  refreshUser() {
    if (!this._token()) return;
    return this.http.get<User>(`${this.api}/auth/me`).pipe(
      tap((user) => {
        this._user.set(user);
        localStorage.setItem('rb_user', JSON.stringify(user));
      }),
      catchError(() => {
        this.logout();
        return of(null);
      }),
    );
  }

  private setSession(res: AuthResponse) {
    this._user.set(res.user);
    this._token.set(res.accessToken);
    localStorage.setItem('rb_user', JSON.stringify(res.user));
    localStorage.setItem('rb_token', res.accessToken);
  }

  private loadStoredUser(): User | null {
    try {
      const raw = localStorage.getItem('rb_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private loadStoredToken(): string | null {
    try {
      return localStorage.getItem('rb_token');
    } catch {
      return null;
    }
  }
}
