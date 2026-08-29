import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Request a reset link.
 *
 * The API deliberately returns the same message whether or not the account
 * exists, so this page must too — showing "no account found" would turn the
 * form into a way to test whether someone is on the platform.
 */
@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth">
      <div class="auth__card">
        <div class="auth__brand">Rent<span>Board</span></div>

        @if (sent()) {
          <h1 class="auth__title">Check your email</h1>
          <p class="auth__sub">{{ message() }}</p>
          <p class="auth__fine">
            Nothing arrived? Check spam, and make sure you used the address you
            registered with. The link is valid for one hour.
          </p>
          <p class="auth__foot"><a routerLink="/auth/login">Back to log in</a></p>
        } @else {
          <h1 class="auth__title">Reset your password</h1>
          <p class="auth__sub">We'll email you a link to set a new one.</p>

          <form [formGroup]="form" (ngSubmit)="onSubmit()">
            <div class="auth__field">
              <label for="email">Email address</label>
              <input id="email" type="email" formControlName="email" autocomplete="email"/>
            </div>

            @if (error()) { <p class="auth__error" role="alert">{{ error() }}</p> }

            <button type="submit" class="auth__submit" [disabled]="form.invalid || loading()">
              {{ loading() ? 'Sending…' : 'Send reset link' }}
            </button>
          </form>

          <p class="auth__foot">
            Remembered it? <a routerLink="/auth/login">Log in</a>
          </p>
        }
      </div>
    </div>
  `,
})
export class ForgotPassword {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);

  form = this.fb.group({ email: ['', [Validators.required, Validators.email]] });
  loading = signal(false);
  sent = signal(false);
  message = signal('');
  error = signal<string | null>(null);

  onSubmit() {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);

    this.auth.forgotPassword(this.form.value.email!).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.message.set(res.message);
        this.sent.set(true);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message ?? 'Something went wrong. Please try again.');
      },
    });
  }
}
