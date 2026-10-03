import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Creating an account with a phone number and nothing else — Phase 7g part two.
 *
 * ── Who this is for
 *
 * The landlord with four rooms in Katlehong who runs everything on WhatsApp and
 * has never had an email address. Before this, their only way in was for
 * somebody to invent an address on their behalf — and an invented address is one
 * nobody reads, so every notice we sent them went nowhere while looking
 * delivered.
 *
 * ── A separate screen, not a toggle
 *
 * The login page toggles into a phone field, which is fine there: it is one
 * field either way. Signing up by phone is three steps with a different shape,
 * and interleaving it with the email form would mean a form whose validity
 * depends on a mode — the kind of thing that ships with the password field still
 * required and nobody notices because the happy path is the other one.
 *
 * `/auth/register` links here prominently, which is how people find it.
 *
 * ── The tick is the point
 *
 * The checkbox at step three is not decoration and is not pre-ticked. The API
 * refuses anything but a literal `true` and records the moment against the
 * number that was proven. This is the control that makes assisted sign-up safe:
 * somebody can sit with a landlord and help them through all of this, and the
 * acceptance still has to be made by the person holding the handset.
 */
@Component({
  selector: 'app-register-phone',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth">
      <div class="auth__card">
        <div class="auth__brand">Mas<span>tande</span></div>
        <h1 class="auth__title">Sign up with your phone number</h1>
        <p class="auth__sub">No email address needed. Free to list. Free to apply. Always.</p>

        <!-- Three states, one at a time. A progress line rather than three
             numbered circles: it reads on a 320px screen, which is most of
             them. -->
        <p class="auth__fine" aria-live="polite">
          Step {{ step() }} of 3 — {{ stepLabel() }}
        </p>

        @if (step() === 1) {
          <div class="auth__field">
            <label for="phone">Mobile number</label>
            <input id="phone" type="tel" [(ngModel)]="phone" name="phone"
                   placeholder="082 123 4567" autocomplete="tel"
                   [attr.aria-describedby]="error() ? 'phone-error' : null"/>
            <p class="field-hint">
              We send a 6-digit code to this number on WhatsApp. It is also how
              you will sign in from now on, so use the handset you keep.
            </p>
          </div>

          @if (error()) {
            <p class="auth__error" role="alert" id="phone-error">{{ error() }}</p>
          }

          <button type="button" class="auth__submit"
                  [disabled]="phone.trim().length < 9 || busy()" (click)="sendCode()">
            {{ busy() ? 'Sending…' : 'Send me a code on WhatsApp' }}
          </button>
        } @else if (step() === 2) {
          <p class="auth__fine">{{ sentMessage() }}</p>

          <div class="auth__field">
            <label for="code">6-digit code</label>
            <input id="code" type="text" inputmode="numeric" maxlength="6"
                   [(ngModel)]="code" name="code"
                   placeholder="000000" autocomplete="one-time-code"/>
          </div>

          @if (error()) {
            <p class="auth__error" role="alert">{{ error() }}</p>
          }

          <button type="button" class="auth__submit"
                  [disabled]="code.trim().length !== 6 || busy()" (click)="confirmCode()">
            {{ busy() ? 'Checking…' : 'Confirm my number' }}
          </button>
          <button type="button" class="auth__magic" style="margin-top:.5rem"
                  (click)="startOver()">
            Use a different number
          </button>
        } @else {
          <p class="auth__fine">✅ {{ phone }} is confirmed. Last bit.</p>

          <div class="auth__roles" role="group" aria-label="What brings you here?">
            <button type="button" class="auth__role" [class.is-active]="role() === 'TENANT'"
                    [attr.aria-pressed]="role() === 'TENANT'" (click)="role.set('TENANT')">
              <span class="auth__role-icon" aria-hidden="true">🏠</span>
              <span class="auth__role-title">I'm looking for a room</span>
              <span class="auth__role-sub">Tenant</span>
            </button>
            <button type="button" class="auth__role" [class.is-active]="role() === 'LANDLORD'"
                    [attr.aria-pressed]="role() === 'LANDLORD'" (click)="role.set('LANDLORD')">
              <span class="auth__role-icon" aria-hidden="true">🔑</span>
              <span class="auth__role-title">I have a room to let</span>
              <span class="auth__role-sub">Landlord</span>
            </button>
          </div>

          <div class="auth__field">
            <label for="fullName">Your full name</label>
            <input id="fullName" type="text" [(ngModel)]="fullName" name="fullName"
                   autocomplete="name"/>
          </div>

          <div class="auth__field">
            <label for="referralCode">Invite code <span class="muted">(optional)</span></label>
            <input id="referralCode" type="text" [(ngModel)]="referralCode" name="referralCode"
                   autocapitalize="characters" spellcheck="false" placeholder="e.g. JHB-K4M2P"/>
          </div>

          <!-- Not pre-ticked, and the button stays disabled until it is. If
               somebody is helping with the sign-up, this is the one action that
               has to be the account holder's own. -->
          <div class="auth__field auth__consent">
            <label for="acceptTerms" class="auth__check">
              <input id="acceptTerms" type="checkbox" [(ngModel)]="acceptTerms"
                     name="acceptTerms"/>
              <span>
                I agree to the <a routerLink="/legal/terms" target="_blank">Terms</a> and the
                <a routerLink="/legal/privacy" target="_blank">Privacy Policy</a>, and I
                agree that Mastande may process my personal information as described
                there under POPIA.
              </span>
            </label>
          </div>

          @if (error()) {
            <p class="auth__error" role="alert">{{ error() }}</p>
          }

          <button type="button" class="auth__submit"
                  [disabled]="!canComplete() || busy()" (click)="complete()">
            {{ busy() ? 'Creating your account…' : 'Create my free account' }}
          </button>
        }

        <p class="auth__foot">
          Have an email address? <a routerLink="/auth/register">Sign up with email</a>
        </p>
        <p class="auth__foot">
          Already have an account? <a routerLink="/auth/login">Log in</a>
        </p>
      </div>
    </div>
  `,
  styles: `
    .auth__consent { margin-top: 1rem; }
    /* The box and the words beside it, aligned on the first line rather than
       centred — the text wraps to three lines on a narrow screen. */
    .auth__check {
      display: flex;
      align-items: flex-start;
      gap: .6rem;
      font-size: .9rem;
      line-height: 1.45;
      cursor: pointer;
    }
    /* 20px, not the browser default 13px: this is the one control on the screen
       that must be comfortable to hit with a thumb. */
    .auth__check input[type="checkbox"] {
      flex: 0 0 auto;
      width: 20px;
      height: 20px;
      margin-top: .1rem;
    }
  `,
})
export class RegisterPhone {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  step = signal<1 | 2 | 3>(1);
  busy = signal(false);
  error = signal<string | null>(null);
  sentMessage = signal('');

  phone = '';
  code = '';
  fullName = '';
  referralCode = this.route.snapshot.queryParamMap.get('ref')?.toUpperCase() ?? '';
  acceptTerms = false;
  role = signal<'TENANT' | 'LANDLORD'>('TENANT');

  /**
   * Held in the component only, for the few minutes step three takes.
   *
   * Not localStorage: it is worth nothing once used or expired, and a credential
   * in storage outlives the tab, the person and the shared phone in the internet
   * café.
   */
  private ticket: string | null = null;

  stepLabel = computed(
    () =>
      ({ 1: 'your number', 2: 'the code we sent', 3: 'who you are' })[this.step()],
  );

  /** Two-way bound with ngModel, so a plain method rather than a computed. */
  canComplete() {
    return this.fullName.trim().length >= 2 && this.acceptTerms === true;
  }

  sendCode() {
    this.busy.set(true);
    this.error.set(null);
    this.auth.requestSignupCode(this.phone.trim()).subscribe({
      next: (res) => {
        this.sentMessage.set(res.message);
        this.step.set(2);
        this.busy.set(false);
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(
          err?.error?.message ?? 'Could not send a code. Check the number and try again.',
        );
      },
    });
  }

  confirmCode() {
    this.busy.set(true);
    this.error.set(null);
    this.auth.verifySignupCode(this.phone.trim(), this.code.trim()).subscribe({
      next: (res) => {
        this.ticket = res.ticket;
        // The canonical +27… form the API confirmed, not what was typed — so
        // the number shown back is the number the account will have.
        this.phone = res.phone;
        this.step.set(3);
        this.busy.set(false);
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(err?.error?.message ?? 'That code is wrong or has expired.');
      },
    });
  }

  complete() {
    if (!this.ticket || !this.canComplete()) return;
    this.busy.set(true);
    this.error.set(null);
    this.auth
      .completePhoneSignup({
        ticket: this.ticket,
        fullName: this.fullName.trim(),
        role: this.role(),
        acceptTerms: this.acceptTerms,
        referralCode: this.referralCode.trim() || undefined,
      })
      .subscribe({
        next: (res) => this.router.navigate([this.auth.homeRouteFor(res.user.role)]),
        error: (err) => {
          this.busy.set(false);
          const message = err?.error?.message;
          this.error.set(
            Array.isArray(message)
              ? message.join(' ')
              : message ?? 'Something went wrong. Please try again.',
          );
          // The ticket expired, so there is nothing to retry at this step — send
          // them back to the number rather than leaving a dead button.
          if (/expired|start again/i.test(String(message))) this.startOver();
        },
      });
  }

  startOver() {
    this.ticket = null;
    this.code = '';
    this.error.set(null);
    this.step.set(1);
  }
}
