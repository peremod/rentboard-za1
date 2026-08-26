import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Login — email/password + Google OAuth entry point.
 * Full visual design (per RentBoard-ZA-Visual-Preview-v2.html) ports in with
 * the UI/CI-CD pass; this is a working, unstyled functional baseline.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth">
      <div class="auth__card">
        <div class="auth__brand">Rent<span>Board</span></div>
        <h1 class="auth__title">Welcome back</h1>
        <p class="auth__sub">Log in to your account</p>

        <button type="button" class="auth__google" (click)="continueWithGoogle()">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>

        <div class="auth__divider"><span>or</span></div>

        <form [formGroup]="form" (ngSubmit)="onSubmit()">
          <div class="auth__field">
            <label for="email">Email address</label>
            <input id="email" type="email" formControlName="email" autocomplete="email"/>
          </div>

          <div class="auth__field">
            <label for="password">Password</label>
            <input id="password" type="password" formControlName="password" autocomplete="current-password"/>
          </div>

          @if (error()) {
            <p class="auth__error" role="alert">{{ error() }}</p>
          }

          <button type="submit" class="auth__submit" [disabled]="form.invalid || loading()">
            {{ loading() ? 'Logging in…' : 'Log in' }}
          </button>
        </form>

        <p class="auth__foot">
          No account? <a routerLink="/auth/register">Register free</a>
        </p>
      </div>
    </div>
  `,
})
export class Login {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  loading = signal(false);
  error = signal<string | null>(null);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  onSubmit() {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    this.auth.login(this.form.getRawValue() as any).subscribe({
      next: () => this.redirectAfterLogin(),
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message ?? 'Invalid email or password');
      },
    });
  }

  continueWithGoogle() {
    const returnUrl = this.route.snapshot.queryParams['returnUrl'];
    this.auth.loginWithGoogle('TENANT', returnUrl);
  }

  private redirectAfterLogin() {
    const returnUrl = this.route.snapshot.queryParams['returnUrl'];
    this.router.navigateByUrl(returnUrl && returnUrl !== '/' ? returnUrl : '/');
  }
}
