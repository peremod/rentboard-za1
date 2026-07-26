import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Handles the redirect back from Google OAuth: /auth/callback?token=...&returnUrl=...
 * Exchanges the token for the user record, then redirects to returnUrl (if set)
 * or the role-appropriate dashboard.
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
  private route = inject(ActivatedRoute);

  ngOnInit() {
    const token = this.route.snapshot.queryParams['token'];
    const returnUrl = this.route.snapshot.queryParams['returnUrl'] ?? null;

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
