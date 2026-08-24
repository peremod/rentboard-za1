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
        <h1 class="auth__title">Welcome back</h1>
        <p class="auth__sub">Log in to manage your rooms and applications.</p>

        <button type="button" class="auth__google" (click)="continueWithGoogle()">
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
