import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Handles the redirect back from Google OAuth: /auth/callback#token=...&returnUrl=...
 *
 * The access token arrives in the URL FRAGMENT (after #), not the query
 * string — deliberate, since fragments are never sent to any server and
 * never appear in server access logs or Referer headers (auth hardening,
 * v0.9.2). Read once here via window.location.hash and never persisted —
 * handleGoogleCallback() puts it straight into the in-memory-only signal.
 */
@Component({
  selector: 'app-auth-callback',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="min-height:50vh;display:flex;align-items:center;justify-content:center;font-family:sans-serif">
      <p>Signing you in…</p>
    </div>
  `,
})
export class AuthCallback implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);

  ngOnInit() {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = params.get('token');
    const returnUrl = params.get('returnUrl');

    if (!token) {
      this.router.navigate(['/auth/login'], { queryParams: { error: 'google_auth_failed' } });
      return;
    }

    this.auth.handleGoogleCallback(token).subscribe({
      next: (user) => {
        if (returnUrl && returnUrl !== '/') {
          this.router.navigateByUrl(decodeURIComponent(returnUrl));
        } else {
          this.router.navigate([user?.role === 'LANDLORD' ? '/landlord/dashboard' : '/tenant/dashboard']);
        }
      },
      error: () => this.router.navigate(['/auth/login'], { queryParams: { error: 'session_error' } }),
    });
  }
}
