import { ChangeDetectionStrategy, Component, inject, signal, effect } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { PortalShell, PortalNavItem } from '../../../shared/components/portal-shell/portal-shell';
import { ADMIN_NAV } from '../../admin/admin-nav';
import { landlordNav } from '../../landlord/landlord-nav';
import { tenantNav } from '../../tenant/tenant-nav';

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
  imports: [FormsModule, ReactiveFormsModule, PortalShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems()" [roleLabel]="roleLabel()">
      <div class="dash-section-title">Account settings</div>

      <section class="dash-section">
        <div class="dash-section-title">Your details</div>
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
                <p class="field-hint">
                  ✅ Verified — you can sign in with a WhatsApp code using this number.
                  Changing it here will need verifying again.
                </p>
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
        <div class="dash-section-title">Emails</div>
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
        <div class="dash-section-title">Password</div>
        <form [formGroup]="passwordForm" (ngSubmit)="savePassword()" class="settings-form">
          <div class="form-row">
            <label for="currentPassword">Current password</label>
            <input id="currentPassword" type="password" formControlName="currentPassword"
                   autocomplete="current-password"/>
          </div>
          <div class="form-row">
            <label for="newPassword">New password</label>
            <input id="newPassword" type="password" formControlName="newPassword"
                   autocomplete="new-password"/>
            <p class="field-hint">At least 8 characters, with an uppercase letter and a number.</p>
          </div>

          @if (passwordMessage()) { <p class="field-hint">{{ passwordMessage() }}</p> }
          @if (passwordError()) { <p class="field-error" role="alert">{{ passwordError() }}</p> }

          <button type="submit" class="btn btn-primary"
                  [disabled]="passwordForm.invalid || savingPassword()">
            {{ savingPassword() ? 'Updating…' : 'Change password' }}
          </button>
        </form>
      </section>

      <section class="dash-section">
        <div class="dash-section-title">Email address</div>
        <p class="muted">
          Currently <strong>{{ auth.user()?.email }}</strong>. Changing it sends a
          confirmation to the new address — the change only takes effect once you
          confirm there. We also tell your current address, so nobody can move
          your account without you knowing.
        </p>

        <form [formGroup]="emailForm" (ngSubmit)="requestEmailChange()" class="settings-form">
          <div class="form-row">
            <label for="newEmail">New email address</label>
            <input id="newEmail" type="email" formControlName="newEmail" autocomplete="email"/>
          </div>
          <div class="form-row">
            <label for="emailPassword">Your password</label>
            <input id="emailPassword" type="password" formControlName="currentPassword"
                   autocomplete="current-password"/>
          </div>

          @if (emailMessage()) { <p class="field-hint">{{ emailMessage() }}</p> }
          @if (emailError()) { <p class="field-error" role="alert">{{ emailError() }}</p> }

          <button type="submit" class="btn btn-outline"
                  [disabled]="emailForm.invalid || savingEmail()">
            {{ savingEmail() ? 'Sending…' : 'Send confirmation' }}
          </button>
        </form>
      </section>
    </app-portal-shell>
  `,
  styles: [`
    .settings-form { max-width: 26rem; }
  `],
})
export class AccountSettings {
  private fb = inject(FormBuilder);
  auth = inject(AuthService);

  roleLabel = () =>
    this.auth.isAdmin() ? 'Admin' : this.auth.isLandlord() ? 'Landlord' : 'Tenant';

  /**
   * The sidebar follows the account's own area. An admin editing their profile
   * used to get the tenant sidebar, offering a dashboard they have no profile
   * for — the same confusion as the two dashboards in the navbar.
   */
  /**
   * The signed-in role's own navigation, not a fourth abbreviated copy of it.
   * This page used to list three items for a landlord and three for a tenant,
   * so opening your settings dropped most of your portal out of the sidebar.
   */
  navItems = (): PortalNavItem[] =>
    this.auth.isAdmin() ? ADMIN_NAV : this.auth.isLandlord() ? landlordNav() : tenantNav();

  marketingOn = signal(true);

  profileForm = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2)]],
    phone: [''],
  });

  constructor() {
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

  passwordForm = this.fb.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(8),
      Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/)]],
  });

  emailForm = this.fb.group({
    newEmail: ['', [Validators.required, Validators.email]],
    currentPassword: ['', Validators.required],
  });

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
    this.auth.changePassword(currentPassword!, newPassword!).subscribe({
      next: (res) => {
        this.savingPassword.set(false);
        this.passwordMessage.set(res.message);
        this.passwordForm.reset();
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
    this.auth.requestEmailChange(newEmail!, currentPassword!).subscribe({
      next: (res) => {
        this.savingEmail.set(false);
        this.emailMessage.set(res.message);
        this.emailForm.reset();
      },
      error: (err) => {
        this.savingEmail.set(false);
        this.emailError.set(err?.error?.message ?? 'Could not start that change.');
      },
    });
  }
}
