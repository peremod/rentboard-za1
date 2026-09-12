import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Lands here from a sign-in link. Exchanges the token for a session and
 * forwards to the right dashboard.
 *
 * Kept deliberately bare: this screen exists for a second or two, and someone
 * arriving on it has already decided to sign in.
 */
@Component({
  selector: 'app-magic-link',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth">
      <div class="auth__card">
        <div class="auth__brand">Rent<span>Board</span></div>

        @if (error()) {
          <h1 class="auth__title">Link no longer valid</h1>
          <p class="auth__sub">{{ error() }}</p>
          <p class="auth__foot">
            <a routerLink="/auth/login">Request a new sign-in link</a>
          </p>
        } @else {
          <h1 class="auth__title">Signing you in…</h1>
          <p class="auth__sub">One moment.</p>
        }
      </div>
    </div>
  `,
})
export class MagicLink implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);

  error = signal<string | null>(null);

  ngOnInit() {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.error.set('That link is incomplete. Sign-in links expire after 15 minutes.');
      return;
    }

    this.auth.verifyMagicLink(token).subscribe({
      next: (res) =>
        this.router.navigate([
          this.auth.homeRouteFor(res.user.role),
        ]),
      error: (err) =>
        this.error.set(
          err?.error?.message ?? 'That link is invalid or has expired. Please request a new one.',
        ),
    });
  }
}
