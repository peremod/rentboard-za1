import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth">
      <div class="auth__card">
        <h1 class="auth__title">Create your free account</h1>
        <p class="auth__sub">Free to list. Free to apply. Always.</p>

        <div class="auth__roles" role="group" aria-label="What brings you here?">
          <button type="button" class="auth__role" [class.is-active]="role() === 'TENANT'"
                  [attr.aria-pressed]="role() === 'TENANT'" (click)="role.set('TENANT')">
            I'm looking for a room
          </button>
          <button type="button" class="auth__role" [class.is-active]="role() === 'LANDLORD'"
                  [attr.aria-pressed]="role() === 'LANDLORD'" (click)="role.set('LANDLORD')">
            I have a room to let
          </button>
        </div>

        <form [formGroup]="form" (ngSubmit)="onSubmit()">
          <div class="auth__field">
            <label for="fullName">Full name</label>
            <input id="fullName" type="text" formControlName="fullName" autocomplete="name"/>
          </div>

          <div class="auth__field">
            <label for="email">Email address</label>
            <input id="email" type="email" formControlName="email" autocomplete="email"/>
          </div>

          <div class="auth__field">
            <label for="password">Password</label>
            <input id="password" type="password" formControlName="password" autocomplete="new-password"/>
            <p class="field-hint">At least 8 characters, with one uppercase letter and one number.</p>
          </div>

          @if (error()) {
            <p class="auth__error" role="alert">{{ error() }}</p>
          }

          <button type="submit" class="auth__submit" [disabled]="form.invalid || loading()">
            {{ loading() ? 'Creating account…' : 'Create account free' }}
          </button>
        </form>

        <p class="auth__fine">
          By registering you agree to our
          <a routerLink="/legal/terms">Terms</a> and
          <a routerLink="/legal/privacy">Privacy Policy</a>.
          Your data is protected under POPIA.
        </p>

        <p class="auth__foot">
          Already have an account? <a routerLink="/auth/login">Log in</a>
        </p>
      </div>
    </div>
  `,
})
export class Register {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  role = signal<'TENANT' | 'LANDLORD'>('TENANT');
  loading = signal(false);
  error = signal<string | null>(null);

  form = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  onSubmit() {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    this.auth.register({ ...(this.form.getRawValue() as any), role: this.role() }).subscribe({
      next: (res) => this.router.navigate([res.user.role === 'LANDLORD' ? '/landlord/dashboard' : '/tenant/dashboard']),
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message ?? 'Something went wrong. Please try again.');
      },
    });
  }
}
