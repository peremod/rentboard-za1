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
    <div style="max-width:360px;margin:3rem auto;font-family:sans-serif">
      <h1>Welcome back</h1>
      <button type="button" (click)="continueWithGoogle()">Continue with Google</button>
      <hr/>
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <label>Email address<br/><input type="email" formControlName="email"/></label><br/>
        <label>Password<br/><input type="password" formControlName="password"/></label><br/>
        @if (error()) { <p style="color:#D63B3B">{{ error() }}</p> }
        <button type="submit" [disabled]="form.invalid || loading()">
          {{ loading() ? 'Logging in…' : 'Log in' }}
        </button>
      </form>
      <p>No account? <a routerLink="/auth/register">Register free</a></p>
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
