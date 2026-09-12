import { ChangeDetectionStrategy, Component, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
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
  private platformId = inject(PLATFORM_ID);

  ngOnInit() {
    // Nothing to read during prerender: there is no URL fragment on the
    // server, and the fragment is the entire point of this component. Without
    // this guard the build logs 'window is not defined' and prerenders a
    // component that can never do its job server-side.
    if (!isPlatformBrowser(this.platformId)) return;

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
          this.router.navigate([this.auth.homeRouteFor(user?.role ?? 'TENANT')]);
        }
      },
      error: () => this.router.navigate(['/auth/login'], { queryParams: { error: 'session_error' } }),
    });
  }
}
