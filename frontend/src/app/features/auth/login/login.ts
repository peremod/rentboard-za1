import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
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
  // FormsModule for the phone fields, which use ngModel rather than joining
  // the reactive form — they are a separate sign-in path, not extra login fields.
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink],
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

        @if (magicSent()) {
          <p class="auth__foot">✅ {{ magicMessage() }}</p>
        } @else {
          <div class="auth__divider"><span>or</span></div>

          <!-- The likely path for a returning user. Most people find a room,
               stop using the site for a year, and come back with no idea what
               their password was. -->
          <button type="button" class="auth__magic"
                  [disabled]="!emailForMagic() || sendingMagic()"
                  (click)="sendMagicLink()">
            {{ sendingMagic() ? 'Sending…' : '✉️ Email me a sign-in link instead' }}
          </button>
          <p class="auth__fine">
            No password needed. The link works once and expires in 15 minutes.
          </p>

          <!-- WhatsApp is close to universal here, and a number is something
               people keep long after they have forgotten a password. -->
          @if (!phoneMode()) {
            <button type="button" class="auth__magic" style="margin-top:.5rem"
                    (click)="phoneMode.set(true)">
              💬 Use my phone number instead
            </button>
          } @else {
            <div class="phone-signin">
              @if (!codeSent()) {
                <div class="auth__field">
                  <label for="phone">Mobile number</label>
                  <input id="phone" type="tel" [(ngModel)]="phone"
                         [ngModelOptions]="{ standalone: true }"
                         placeholder="082 123 4567" autocomplete="tel"/>
                </div>
                <button type="button" class="auth__submit"
                        [disabled]="!phone.trim() || sendingCode()" (click)="sendCode()">
                  {{ sendingCode() ? 'Sending…' : 'Send me a code on WhatsApp' }}
                </button>
              } @else {
                <p class="auth__fine">{{ codeMessage() }}</p>
                <div class="auth__field">
                  <label for="code">6-digit code</label>
                  <input id="code" type="text" inputmode="numeric" maxlength="6"
                         [(ngModel)]="code" [ngModelOptions]="{ standalone: true }"
                         placeholder="000000" autocomplete="one-time-code"/>
                </div>
                @if (phoneError()) { <p class="auth__error" role="alert">{{ phoneError() }}</p> }
                <button type="button" class="auth__submit"
                        [disabled]="code.trim().length !== 6 || verifying()" (click)="verifyCode()">
                  {{ verifying() ? 'Checking…' : 'Sign in' }}
                </button>
                <button type="button" class="auth__magic" style="margin-top:.5rem"
                        (click)="codeSent.set(false)">
                  Use a different number
                </button>
              }
            </div>
          }
        }

        <p class="auth__foot">
          <a routerLink="/auth/forgot-password">Forgot your password?</a>
        </p>
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
  sendingMagic = signal(false);
  phoneMode = signal(false);
  phone = '';
  code = '';
  sendingCode = signal(false);
  codeSent = signal(false);
  codeMessage = signal('');
  verifying = signal(false);
  phoneError = signal<string | null>(null);
  magicSent = signal(false);
  magicMessage = signal('');
  error = signal<string | null>(null);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  sendCode() {
    this.sendingCode.set(true);
    this.phoneError.set(null);

    this.auth.requestPhoneCode(this.phone.trim()).subscribe({
      next: (res) => {
        this.sendingCode.set(false);
        this.codeMessage.set(res.message);
        this.codeSent.set(true);
      },
      error: (err) => {
        this.sendingCode.set(false);
        this.phoneError.set(err?.error?.message ?? 'Could not send a code. Check the number and try again.');
      },
    });
  }

  verifyCode() {
    this.verifying.set(true);
    this.phoneError.set(null);

    this.auth.verifyPhoneCode(this.phone.trim(), this.code.trim()).subscribe({
      next: (res) =>
        this.router.navigate([
          this.auth.homeRouteFor(res.user.role),
        ]),
      error: (err) => {
        this.verifying.set(false);
        this.phoneError.set(err?.error?.message ?? 'That code is wrong or has expired.');
      },
    });
  }

  /** Reuses whatever is already typed in the email field. */
  emailForMagic(): string {
    return (this.form.value.email ?? '').trim();
  }

  sendMagicLink() {
    const email = this.emailForMagic();
    if (!email) return;

    this.sendingMagic.set(true);
    this.auth.requestMagicLink(email).subscribe({
      next: (res) => {
        this.sendingMagic.set(false);
        this.magicMessage.set(res.message);
        this.magicSent.set(true);
      },
      error: () => {
        this.sendingMagic.set(false);
        // Deliberately the same message as success: whether an account exists
        // is not something an unauthenticated caller should learn.
        this.magicMessage.set('If that address has an account, a sign-in link is on its way.');
        this.magicSent.set(true);
      },
    });
  }

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

  /**
   * Where to land after signing in.
   *
   * Falls back to the person's own dashboard, not the public board. Someone
   * who has just logged in is almost always going somewhere that needed the
   * login; dropping them on the home page makes them navigate again.
   *
   * A returnUrl pointing back at an auth page is ignored, since honouring it
   * would return them to the form they just completed.
   */
  private redirectAfterLogin() {
    const returnUrl = this.route.snapshot.queryParams['returnUrl'];
    const dashboard = this.auth.homeRoute();

    const usable =
      returnUrl && returnUrl !== '/' && !returnUrl.startsWith('/auth');

    this.router.navigateByUrl(usable ? returnUrl : dashboard);
  }
}
