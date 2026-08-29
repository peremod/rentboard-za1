import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

/** Set a new password from the emailed token. Single-use, one-hour expiry. */
@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth">
      <div class="auth__card">
        <div class="auth__brand">Rent<span>Board</span></div>

        @if (!token()) {
          <h1 class="auth__title">Link not valid</h1>
          <p class="auth__sub">
            This reset link is incomplete. Request a new one — they expire after an hour.
          </p>
          <p class="auth__foot"><a routerLink="/auth/forgot-password">Request a new link</a></p>
        } @else if (done()) {
          <h1 class="auth__title">Password changed</h1>
          <p class="auth__sub">You can log in with your new password now.</p>
          <p class="auth__foot"><a routerLink="/auth/login">Log in</a></p>
        } @else {
          <h1 class="auth__title">Choose a new password</h1>
          <p class="auth__sub">At least 8 characters, with an uppercase letter and a number.</p>

          <form [formGroup]="form" (ngSubmit)="onSubmit()">
            <div class="auth__field">
              <label for="password">New password</label>
              <input id="password" type="password" formControlName="newPassword" autocomplete="new-password"/>
            </div>

            <div class="auth__field">
              <label for="confirm">Confirm new password</label>
              <input id="confirm" type="password" formControlName="confirm" autocomplete="new-password"/>
              @if (mismatch()) { <p class="field-error">Those do not match.</p> }
            </div>

            @if (error()) { <p class="auth__error" role="alert">{{ error() }}</p> }

            <button type="submit" class="auth__submit"
                    [disabled]="form.invalid || mismatch() || loading()">
              {{ loading() ? 'Saving…' : 'Set new password' }}
            </button>
          </form>
        }
      </div>
    </div>
  `,
})
export class ResetPassword implements OnInit {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  token = signal<string | null>(null);
  loading = signal(false);
  done = signal(false);
  error = signal<string | null>(null);

  form = this.fb.group({
    newPassword: ['', [Validators.required, Validators.minLength(8),
      Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/)]],
    confirm: ['', Validators.required],
  });

  ngOnInit() {
    this.token.set(this.route.snapshot.queryParamMap.get('token'));
  }

  mismatch(): boolean {
    const { newPassword, confirm } = this.form.value;
    return !!confirm && newPassword !== confirm;
  }

  onSubmit() {
    if (this.form.invalid || this.mismatch() || !this.token()) return;
    this.loading.set(true);
    this.error.set(null);

    this.auth.resetPassword(this.token()!, this.form.value.newPassword!).subscribe({
      next: () => {
        this.loading.set(false);
        this.done.set(true);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message ?? 'That link is invalid or has expired.');
      },
    });
  }
}
