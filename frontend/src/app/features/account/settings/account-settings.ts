import { ChangeDetectionStrategy, Component, computed, inject, signal, effect } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { WalkthroughService } from '../../../core/services/walkthrough.service';

/**
 * Account settings, shared by landlords and tenants — the needs are identical,
 * so the nav items are the only thing that differs by role.
 *
 * Password and email changes both require the current password: a session
 * someone walked away from should not be enough to take an account over.
 */
@Component({
  selector: 'app-account-settings',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `

      <section class="dash-section">
        <h2 class="dash-section-title">Your details</h2>
        <form [formGroup]="profileForm" (ngSubmit)="saveProfile()" class="settings-form">
          <div class="form-row">
            <label for="fullName">Full name</label>
            <input id="fullName" type="text" formControlName="fullName" autocomplete="name"/>
          </div>
          <div class="form-row">
            <label for="phone">Phone number</label>
            <input id="phone" type="tel" formControlName="phone" autocomplete="tel"
                   placeholder="e.g. 082 123 4567"/>
            <p class="field-hint">Used for WhatsApp notifications. Never shown publicly.</p>

            <!-- Without verification the number cannot sign anyone in, which
                 is how phone sign-in shipped: saved numbers, and a login that
                 could never find them. -->
            @if (auth.user()?.phone) {
              @if (auth.user()?.phoneVerified) {
                @if (numberIsTheOnlyWayIn()) {
                  <!-- ⚠️ The old hint said "changing it here will need verifying
                       again", and for this account that was a lockout: the
                       change un-verified the number, there was no email and no
                       password, and asking for a sign-in code on the real number
                       answered "a code is on its way" and sent nothing. The
                       field now refuses it and this says where to go. -->
                  <p class="field-hint">
                    ✅ Verified. <strong>This number is how you sign in</strong>, and it is
                    the only way into your account — so we confirm a new one before
                    changing it, rather than taking it from this box.
                  </p>
                  @if (changeStep() === 'idle') {
                    <button type="button" class="btn btn-sm btn-outline"
                            (click)="changeStep.set('number')">Change my number</button>
                  } @else if (changeStep() === 'number') {
                    <div class="form-row">
                      <label for="newPhone">Your new number</label>
                      <input id="newPhone" type="tel" inputmode="tel"
                             [(ngModel)]="newPhone" [ngModelOptions]="{ standalone: true }"
                             placeholder="e.g. 082 987 6543" autocomplete="tel"/>
                      <p class="field-hint">
                        We send a code to the new number. This account keeps
                        {{ auth.user()?.phone }} until that code comes back, so if you
                        type it wrong nothing breaks.
                      </p>
                    </div>
                    <button type="button" class="btn btn-sm btn-primary"
                            [disabled]="changing() || newPhone.trim().length < 10"
                            (click)="sendChangeCode()">
                      {{ changing() ? 'Sending…' : 'Send the code' }}
                    </button>
                  } @else {
                    <div class="form-row">
                      <label for="changeCode">Code sent to the new number</label>
                      <input id="changeCode" type="text" inputmode="numeric" maxlength="6"
                             [(ngModel)]="changeCode" [ngModelOptions]="{ standalone: true }"
                             placeholder="000000" autocomplete="one-time-code"/>
                      <p class="field-hint">{{ changeMessage() }}</p>
                    </div>
                    <button type="button" class="btn btn-sm btn-primary"
                            [disabled]="changing() || changeCode.length !== 6"
                            (click)="confirmChange()">
                      {{ changing() ? 'Checking…' : 'This is my number now' }}
                    </button>
                  }
                  @if (changeError()) {
                    <p class="field-error" role="alert">{{ changeError() }}</p>
                  }
                } @else {
                  <p class="field-hint">
                    ✅ Verified — you can sign in with a WhatsApp code using this number.
                    Changing it here will need verifying again.
                  </p>
                }
              } @else if (verifyStep() === 'idle') {
                <p class="field-hint">
                  Not verified yet. Verifying lets you sign in with a WhatsApp code
                  instead of a password.
                </p>
                <button type="button" class="btn btn-sm btn-outline"
                        [disabled]="verifying()" (click)="startVerification()">
                  {{ verifying() ? 'Sending…' : 'Verify this number' }}
                </button>
              } @else {
                <p class="field-hint">{{ verifyMessage() }}</p>
                <div class="form-row">
                  <label for="otp">6-digit code</label>
                  <input id="otp" type="text" inputmode="numeric" maxlength="6"
                         [(ngModel)]="otpCode" [ngModelOptions]="{ standalone: true }"
                         placeholder="000000" autocomplete="one-time-code"/>
                </div>
                <button type="button" class="btn btn-sm btn-primary"
                        [disabled]="otpCode.trim().length !== 6 || verifying()"
                        (click)="confirmVerification()">
                  {{ verifying() ? 'Checking…' : 'Confirm' }}
                </button>
                <button type="button" class="btn btn-sm btn-ghost-light"
                        (click)="verifyStep.set('idle')">Cancel</button>
              }
              @if (verifyError()) { <p class="field-error" role="alert">{{ verifyError() }}</p> }
            }
          </div>

          @if (profileMessage()) { <p class="field-hint">{{ profileMessage() }}</p> }
          @if (profileError()) { <p class="field-error" role="alert">{{ profileError() }}</p> }

          <button type="submit" class="btn btn-primary"
                  [disabled]="profileForm.invalid || savingProfile()">
            {{ savingProfile() ? 'Saving…' : 'Save changes' }}
          </button>
        </form>
      </section>

      <section class="dash-section">
        <h2 class="dash-section-title">Emails</h2>
        <p class="muted">
          We'll always email you about your own applications, messages and
          account — that's part of the service. This controls room alerts and
          digests only.
        </p>
        <label class="filter-check" style="margin-top:.75rem">
          <input type="checkbox" [checked]="marketingOn()" (change)="toggleMarketing($event)"/>
          Send me room alerts and summaries
        </label>
        @if (marketingMessage()) { <p class="field-hint">{{ marketingMessage() }}</p> }
      </section>

      <section class="dash-section">
        <!-- An account made from a mobile number has no password. This section
             offered it "Current password" and a "Change password" button, and
             the API answered "This account signs in with Google" — a provider
             they have never used, and the only thing between them and ever
             having a password. Phase 7o. -->
        <h2 class="dash-section-title">
          {{ hasPassword() ? 'Password' : 'Set a password' }}
        </h2>

        @if (isGoogle() && !hasPassword()) {
          <p class="muted">
            You sign in with Google, so your password lives there.
            Change it on your Google account.
          </p>
        } @else {
        @if (!hasPassword()) {
          <p class="muted">
            You signed up with your number, so you have no password — you have been
            signing in with a WhatsApp code. Setting one is optional. It gives you a
            second way in, which matters if you ever lose this number.
          </p>
        }
        <form [formGroup]="passwordForm" (ngSubmit)="savePassword()" class="settings-form">
          @if (hasPassword()) {
          <div class="form-row">
            <label for="currentPassword">Current password</label>
            <input id="currentPassword" type="password" formControlName="currentPassword"
                   autocomplete="current-password"/>
          </div>
          } @else {
          <!-- The step-up for somebody with no password is the handset they
               do have. Same code, same number, single use. -->
          <div class="form-row">
            <label for="pwStepCode">Code from WhatsApp</label>
            @if (stepStep() === 'idle') {
              <p class="field-hint">
                We send a 6-digit code to {{ auth.user()?.phone }} so we know it is you.
              </p>
              <button type="button" class="btn btn-sm btn-outline"
                      [disabled]="stepSending()" (click)="sendStepCode()">
                {{ stepSending() ? 'Sending…' : 'Send me a code' }}
              </button>
            } @else {
              <input id="pwStepCode" type="text" inputmode="numeric" maxlength="6"
                     [(ngModel)]="stepCode" [ngModelOptions]="{ standalone: true }"
                     placeholder="000000" autocomplete="one-time-code"/>
              <p class="field-hint">{{ stepMessage() }}</p>
            }
          </div>
          }
          <div class="form-row">
            <label for="newPassword">New password</label>
            <input id="newPassword" type="password" formControlName="newPassword"
                   autocomplete="new-password"/>
            <p class="field-hint">At least 8 characters, with an uppercase letter and a number.</p>
          </div>

          @if (passwordMessage()) { <p class="field-hint">{{ passwordMessage() }}</p> }
          @if (passwordError()) { <p class="field-error" role="alert">{{ passwordError() }}</p> }

          <button type="submit" class="btn btn-primary"
                  [disabled]="!passwordReady() || savingPassword()">
            {{ savingPassword()
                ? (hasPassword() ? 'Updating…' : 'Setting…')
                : (hasPassword() ? 'Change password' : 'Set my password') }}
          </button>
        </form>
        }
      </section>

      <section class="dash-section">
        <!-- This read "Currently <strong></strong>" for an account with no
             address, asked for a password it does not have, and was refused
             with a message about Google. Adding an address is what lets such
             an account pay the verification fee and be recovered if the
             number is lost, so it was the one path that mattered. Phase 7o. -->
        <h2 class="dash-section-title">
          {{ hasEmail() ? 'Email address' : 'Add an email address' }}
        </h2>

        @if (hasEmail()) {
          <p class="muted">
            Currently <strong>{{ auth.user()?.email }}</strong>. Changing it sends a
            confirmation to the new address — the change only takes effect once you
            confirm there. We also tell your current address, so nobody can move
            your account without you knowing.
          </p>
        } @else {
          <p class="muted">
            You have no email address on this account, which is fine — you signed up
            with your number. Adding one is optional, and it does two things:
            it is a second way back in if you lose this number, and it is what the
            payment page needs if you ever pay for verification.
            We send a confirmation to the address and nothing is saved until you
            open it, so a mistyped address cannot take your notifications.
          </p>
        }

        <form [formGroup]="emailForm" (ngSubmit)="requestEmailChange()" class="settings-form">
          <div class="form-row">
            <label for="newEmail">{{ hasEmail() ? 'New email address' : 'Your email address' }}</label>
            <input id="newEmail" type="email" formControlName="newEmail" autocomplete="email"/>
          </div>
          @if (hasPassword()) {
          <div class="form-row">
            <label for="emailPassword">Your password</label>
            <input id="emailPassword" type="password" formControlName="currentPassword"
                   autocomplete="current-password"/>
          </div>
          } @else if (!isGoogle()) {
          <div class="form-row">
            <label for="emStepCode">Code from WhatsApp</label>
            @if (stepStep() === 'idle') {
              <p class="field-hint">
                We send a 6-digit code to {{ auth.user()?.phone }} so we know it is
                you adding this address.
              </p>
              <button type="button" class="btn btn-sm btn-outline"
                      [disabled]="stepSending()" (click)="sendStepCode()">
                {{ stepSending() ? 'Sending…' : 'Send me a code' }}
              </button>
            } @else {
              <input id="emStepCode" type="text" inputmode="numeric" maxlength="6"
                     [(ngModel)]="stepCode" [ngModelOptions]="{ standalone: true }"
                     placeholder="000000" autocomplete="one-time-code"/>
              <p class="field-hint">{{ stepMessage() }}</p>
            }
          </div>
          }

          @if (emailMessage()) { <p class="field-hint">{{ emailMessage() }}</p> }
          @if (emailError()) { <p class="field-error" role="alert">{{ emailError() }}</p> }

          <button type="submit" class="btn btn-outline"
                  [disabled]="!emailReady() || savingEmail()">
            {{ savingEmail() ? 'Sending…' : 'Send confirmation' }}
          </button>
        </form>
      </section>

      <!-- Pausing or closing the account — Phase 7g.
           A link, not the buttons: this screen is for editing a profile, and an
           irreversible action a scroll below "change your name" is one somebody
           reaches by accident. The destructive explanation lives on its own
           page with the real counts on it. -->
      <section class="dash-section">
        <h2 class="dash-section-title">Your account</h2>
        @if (auth.user()?.deactivatedAt) {
          <p class="muted settings-hint">
            <strong>Your account is paused.</strong> Your listings are off the board
            and we are not sending you anything. Nothing has been deleted.
          </p>
          <a class="btn btn-primary" routerLink="/account/close">Use my account again</a>
        } @else {
          <p class="muted settings-hint">
            Take a break, or close your account for good. We explain the
            difference, and exactly what happens to your listings, your messages
            and your records, before you decide.
          </p>
          <a class="btn btn-outline" routerLink="/account/close">Pause or close my account</a>
        }
      </section>

      <!-- The way back to the walkthrough — Phase 7f.
           The brief asks for a way to reach it again, and clearing the stamp IS
           that way: the portal shows the tour whenever the stamp is null, so
           one record serves the first visit and the fifth. A separate "replay"
           screen would be a second path to the same thing with its own state
           to get wrong. -->
      <section class="dash-section">
        <h2 class="dash-section-title">Show me around again</h2>
        <p class="muted settings-hint">
          The short tour of what Mastande does. It appears once when you first
          sign in; this brings it back on your next screen.
        </p>
        @if (tourReset()) {
          <p class="muted" role="status">
            Done — it will open on your next screen.
            <a routerLink="/account/notices">Go there now</a>
          </p>
        } @else {
          <button type="button" class="btn btn-outline"
                  [disabled]="resettingTour()" (click)="replayTour()">
            {{ resettingTour() ? 'Just a moment…' : 'Show me around again' }}
          </button>
        }
        @if (tourError()) { <p class="field-error" role="alert">{{ tourError() }}</p> }
      </section>
  `,
  styles: [`
    .settings-form { max-width: 26rem; }
    .settings-hint { max-width: 32rem; line-height: 1.6; }
  `],
})
export class AccountSettings {
  private fb = inject(FormBuilder);
  auth = inject(AuthService);
  private walkthrough = inject(WalkthroughService);

  // ── "Show me around again" — Phase 7f ──────────────────────────────────
  protected readonly resettingTour = signal(false);
  protected readonly tourReset = signal(false);
  protected readonly tourError = signal<string | null>(null);

  protected replayTour() {
    this.resettingTour.set(true);
    this.tourError.set(null);
    this.walkthrough.replay().subscribe({
      next: () => { this.resettingTour.set(false); this.tourReset.set(true); },
      error: (err) => {
        this.resettingTour.set(false);
        // Said out loud, with the data intact. A button that silently does
        // nothing is the defect item 21 of this brief is about.
        this.tourError.set(err?.error?.message ?? 'That did not work just now. Try again in a moment.');
      },
    });
  }

  /**
   * The sidebar follows the account's own area. An admin editing their profile
   * used to get the tenant sidebar, offering a dashboard they have no profile
   * for — the same confusion as the two dashboards in the navbar.
   */
  marketingOn = signal(true);

  profileForm = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2)]],
    phone: [''],
  });

  constructor() {
    /**
     * ⚠️ Re-read the account before deciding what to show — Phase 7o.
     *
     * This screen branches on `hasPassword` and `email`, and it defaults a
     * missing `hasPassword` to true so an older payload behaves as it always
     * did. That default is right for compatibility and wrong for a brand-new
     * phone-only account, whose sign-in payload is not the `/auth/me` payload:
     * it believed that person had a password and showed them "Current
     * password" — the exact screen this phase exists to fix. So the shape is
     * not guessed from whatever happened to arrive.
     */
    this.auth.refreshMe().subscribe({ error: () => {} });

    // Fill from the user signal whenever it resolves. Reading it once at
    // construction meant an empty form on a hard reload, because /auth/me had
    // not returned yet — which looked exactly like the save had failed.
    effect(() => {
      const user = this.auth.user();
      if (!user) return;
      if (this.profileForm.pristine) {
        this.profileForm.patchValue(
          { fullName: user.fullName, phone: user.phone ?? '' },
          { emitEvent: false },
        );
      }
      this.marketingOn.set(user.marketingEmails ?? true);
    });
  }

  /**
   * ⚠️ `currentPassword` is NOT `Validators.required` — Phase 7o.
   *
   * An account made from a mobile number has no password, so a required
   * validator here would keep the button disabled forever with nothing on
   * screen explaining why. Which credential is needed depends on the account,
   * so the readiness of each form is computed below and the server decides
   * for real — an account WITH a password still cannot skip it.
   */
  passwordForm = this.fb.group({
    currentPassword: [''],
    newPassword: ['', [Validators.required, Validators.minLength(8),
      Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/)]],
  });

  emailForm = this.fb.group({
    newEmail: ['', [Validators.required, Validators.email]],
    currentPassword: [''],
  });

  // ── Which kind of account is this — Phase 7o ─────────────────────────────
  //
  // The screen had no way to ask, which is why it offered a phone-only account
  // two forms that could only answer with a message about Google.

  /** Defaults to true, so an older payload without the field behaves as before. */
  readonly hasPassword = computed(() => this.auth.user()?.hasPassword ?? true);
  readonly hasEmail = computed(() => !!this.auth.user()?.email);
  readonly isGoogle = computed(() => this.auth.user()?.authProvider === 'google');

  /**
   * The number is the account's single credential.
   *
   * The same condition the server guards `updateProfile` with. When it holds,
   * the free-text phone field cannot change the number and the confirmed flow
   * is the only way.
   */
  readonly numberIsTheOnlyWayIn = computed(() => !this.hasEmail() && !this.hasPassword());

  /**
   * Enough typed in to be worth sending. The server re-checks all of it.
   *
   * ⚠️ Plain methods, NOT `computed()`. They were computeds, and that made the
   * "Change password" button disabled forever for every account that has one:
   * a `FormGroup`'s value is not a signal, so a computed reading
   * `getRawValue()` has nothing to invalidate it and caches its first answer —
   * false, on an empty form. A control that cannot be pressed, which is this
   * codebase's own recurring defect, introduced while fixing another one.
   *
   * It was not caught by the new UI drive either: section 4 checked that the
   * screen still SAYS "Current password", not that the button can be used. The
   * existing account-lifecycle UI drive caught it by trying to click, which is
   * the difference between reading a screen and using it. Both drives assert it
   * now.
   *
   * A method in the template is re-evaluated on change detection, which a
   * form input event triggers — the same reason the plain `passwordForm.invalid`
   * binding beside it has always worked.
   */
  passwordReady(): boolean {
    if (!this.passwordForm.controls.newPassword.valid) return false;
    return this.hasPassword()
      ? !!this.passwordForm.getRawValue().currentPassword
      : this.stepCode.trim().length === 6;
  }

  emailReady(): boolean {
    if (!this.emailForm.controls.newEmail.valid) return false;
    if (this.hasPassword()) return !!this.emailForm.getRawValue().currentPassword;
    if (this.isGoogle()) return false;
    return this.stepCode.trim().length === 6;
  }

  // The step-up code, for an account whose credential is the handset.
  stepStep = signal<'idle' | 'code'>('idle');
  stepSending = signal(false);
  stepMessage = signal('');
  stepCode = '';

  // Changing the number, confirmed at the NEW one before anything moves.
  changeStep = signal<'idle' | 'number' | 'code'>('idle');
  changing = signal(false);
  changeMessage = signal('');
  changeError = signal<string | null>(null);
  newPhone = '';
  changeCode = '';

  marketingMessage = signal<string | null>(null);

  verifyStep = signal<'idle' | 'code'>('idle');
  verifying = signal(false);
  verifyMessage = signal('');
  verifyError = signal<string | null>(null);
  otpCode = '';

  savingProfile = signal(false);
  profileMessage = signal<string | null>(null);
  profileError = signal<string | null>(null);

  savingPassword = signal(false);
  passwordMessage = signal<string | null>(null);
  passwordError = signal<string | null>(null);

  savingEmail = signal(false);
  emailMessage = signal<string | null>(null);
  emailError = signal<string | null>(null);

  /** Opting out here is what the unsubscribe footer in every marketing email links to. */
  toggleMarketing(event: Event) {
    const on = (event.target as HTMLInputElement).checked;
    this.marketingOn.set(on);
    this.marketingMessage.set(null);
    this.auth.updateProfile({ marketingEmails: on }).subscribe({
      next: () => this.marketingMessage.set(on ? 'Alerts on.' : 'Alerts off. You will still get emails about your applications.'),
      error: () => {
        this.marketingOn.set(!on);   // roll back the checkbox
        this.marketingMessage.set('Could not save that. Please try again.');
      },
    });
  }

  /** Sends a code to the number already saved on the account. */
  startVerification() {
    this.verifying.set(true);
    this.verifyError.set(null);

    this.auth.requestPhoneVerification().subscribe({
      next: (res) => {
        this.verifying.set(false);
        this.verifyMessage.set(res.message);
        this.verifyStep.set('code');
      },
      error: (err) => {
        this.verifying.set(false);
        this.verifyError.set(err?.error?.message ?? 'Could not send a code. Save the number first.');
      },
    });
  }

  confirmVerification() {
    this.verifying.set(true);
    this.verifyError.set(null);

    this.auth.confirmPhoneVerification(this.otpCode.trim()).subscribe({
      next: () => {
        this.verifying.set(false);
        this.verifyStep.set('idle');
        this.otpCode = '';
      },
      error: (err) => {
        this.verifying.set(false);
        this.verifyError.set(err?.error?.message ?? 'That code is wrong or has expired.');
      },
    });
  }

  saveProfile() {
    if (this.profileForm.invalid) return;
    this.savingProfile.set(true);
    this.profileMessage.set(null);
    this.profileError.set(null);

    const { fullName, phone } = this.profileForm.getRawValue();
    this.auth.updateProfile({ fullName: fullName!, phone: phone ?? undefined }).subscribe({
      next: (updated) => {
        this.savingProfile.set(false);
        // Show what the server actually stored: it canonicalises the number to
        // +27 form, and saving a different one clears the verification.
        this.profileForm.patchValue({ phone: updated.phone ?? '' }, { emitEvent: false });
        this.profileForm.markAsPristine();
        this.profileMessage.set(
          updated.phoneVerified === false && updated.phone
            ? 'Saved. Verify the number to use it for signing in.'
            : 'Saved.',
        );
      },
      error: (err) => {
        this.savingProfile.set(false);
        this.profileError.set(err?.error?.message ?? 'Could not save those changes.');
      },
    });
  }

  savePassword() {
    if (this.passwordForm.invalid) return;
    this.savingPassword.set(true);
    this.passwordMessage.set(null);
    this.passwordError.set(null);

    const { currentPassword, newPassword } = this.passwordForm.getRawValue();
    const code = this.hasPassword() ? undefined : this.stepCode.trim();
    this.auth.changePassword(currentPassword ?? '', newPassword!, code).subscribe({
      next: (res) => {
        this.savingPassword.set(false);
        this.passwordMessage.set(res.message);
        this.passwordForm.reset();
        // The code is spent server-side, so the form must not look reusable.
        this.stepCode = '';
        this.stepStep.set('idle');
        // The account now HAS a password, which changes this whole screen.
        this.auth.refreshMe().subscribe({ error: () => {} });
      },
      error: (err) => {
        this.savingPassword.set(false);
        this.passwordError.set(err?.error?.message ?? 'Could not change your password.');
      },
    });
  }

  requestEmailChange() {
    if (this.emailForm.invalid) return;
    this.savingEmail.set(true);
    this.emailMessage.set(null);
    this.emailError.set(null);

    const { newEmail, currentPassword } = this.emailForm.getRawValue();
    const code = this.hasPassword() ? undefined : this.stepCode.trim();
    this.auth.requestEmailChange(newEmail!, currentPassword ?? '', code).subscribe({
      next: (res) => {
        this.savingEmail.set(false);
        this.emailMessage.set(res.message);
        this.emailForm.reset();
        this.stepCode = '';
        this.stepStep.set('idle');
      },
      error: (err) => {
        this.savingEmail.set(false);
        this.emailError.set(err?.error?.message ?? 'Could not start that change.');
      },
    });
  }
  /** A code to the number already on the account, as a step-up credential. */
  sendStepCode() {
    this.stepSending.set(true);
    this.auth.requestPhoneVerification().subscribe({
      next: (res) => {
        this.stepSending.set(false);
        this.stepMessage.set(res.message);
        this.stepStep.set('code');
      },
      error: (err) => {
        this.stepSending.set(false);
        this.stepMessage.set(err?.error?.message ?? 'Could not send a code just now.');
      },
    });
  }

  /**
   * Step one of a number change: the code goes to the NEW number.
   *
   * Nothing on the account moves here. That is the whole point — the old
   * number keeps working, so a mistyped new one costs a wasted code rather
   * than the account.
   */
  sendChangeCode() {
    this.changing.set(true);
    this.changeError.set(null);
    this.auth.requestPhoneChange(this.newPhone.trim()).subscribe({
      next: (res) => {
        this.changing.set(false);
        this.changeMessage.set(res.message);
        this.changeStep.set('code');
      },
      error: (err) => {
        this.changing.set(false);
        this.changeError.set(err?.error?.message ?? 'Could not send a code to that number.');
      },
    });
  }

  confirmChange() {
    this.changing.set(true);
    this.changeError.set(null);
    this.auth.confirmPhoneChange(this.changeCode.trim()).subscribe({
      next: (res) => {
        this.changing.set(false);
        this.changeMessage.set(res.message);
        this.changeStep.set('idle');
        this.changeCode = '';
        this.newPhone = '';
        // The profile form still holds the old number in its box.
        this.profileForm.patchValue({ phone: res.phone }, { emitEvent: false });
      },
      error: (err) => {
        this.changing.set(false);
        this.changeError.set(err?.error?.message ?? 'That code was not right.');
      },
    });
  }
}
