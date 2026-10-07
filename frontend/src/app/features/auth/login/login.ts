import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { WHATSAPP_ENABLED } from '../../../core/config/feature-flags';

/**
 * Login — email and password.
 *
 * ⚠️ "Continue with Google" was removed in Phase 8g: the owner is not paying
 * for it. The button is what cost money; the backend route and the passport
 * strategy are deliberately left in place, because an account that signed up
 * through Google still exists and a half-finished OAuth callback must not meet
 * a 404.
 *
 * Removing a way IN means giving its users another one, and that is the other
 * half of this change: a Google-only account asking to reset its password used
 * to be told "you sign in with Google" and handed nothing. It now gets a real
 * reset link, so it can set a first password and carry on through this form.
 * See account-recovery.service.ts.
 * Full visual design (per RentBoard-ZA-Visual-Preview-v2.html) ports in with
 * the UI/CI-CD pass; this is a working, unstyled functional baseline.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  // FormsModule for the phone fields, which use ngModel rather than joining
  // the reactive form — they are a separate sign-in path, not extra login fields.
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth">
      <div class="auth__card">
        <div class="auth__brand">Mas<span>tande</span></div>
        <h1 class="auth__title">Welcome back</h1>
        <p class="auth__sub">Log in to your account</p>


        <form [formGroup]="form" (ngSubmit)="onSubmit()">
          <div class="auth__field">
            <label for="email">{{ 'auth.email' | translate }}</label>
            <input id="email" type="email" formControlName="email" autocomplete="email"/>
          </div>

          <div class="auth__field">
            <label for="password">{{ 'auth.password' | translate }}</label>
            <input id="password" type="password" formControlName="password" autocomplete="current-password"/>
          </div>

          @if (error()) {
            <p class="auth__error" role="alert">{{ error() }}</p>
          }

          <button type="submit" class="auth__submit" [disabled]="form.invalid || loading()">
            {{ loading() ? ('auth.logging_in' | translate) : ('auth.login' | translate) }}
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
               people keep long after they have forgotten a password — which is
               why the whole flow stays, behind one flag, rather than being
               deleted. Phase 8j: Meta bills per message and this product is
               free, so the channel is off until that is a cost worth carrying.
               The form is not merely hidden: somebody who has only ever signed
               in with a number needs to be told where to go instead. -->
          @if (!whatsappEnabled) {
            <p class="auth__hint" style="margin-top:.5rem">
              Signing in with a phone number is not available yet — use your
              email address above. If your account has no email address on it,
              <a routerLink="/legal/privacy">get in touch</a> and we will add one.
            </p>
          } @else if (!phoneMode()) {
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
        <!-- Phase 7q. For an account with no email and no password the number is
             the only way in, so "forgot your password" is no help at all and
             this is the only line on the page that is. Without a link from
             here the page exists and nobody who needs it can find it. -->
        <p class="auth__foot">
          <a routerLink="/auth/lost-number">Lost the phone you sign in with?</a>
        </p>
        <p class="auth__foot">
          No account? <a routerLink="/auth/register">Register free</a>
        </p>
      </div>
    </div>
  `,
})
export class Login {
  /** Phase 8j — see feature-flags.ts. Hides what promises a WhatsApp message. */
  protected readonly whatsappEnabled = WHATSAPP_ENABLED;

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
