import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { PortalShell, PortalNavItem } from '../../../shared/components/portal-shell/portal-shell';

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
  imports: [ReactiveFormsModule, PortalShell],
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

  roleLabel = () => (this.auth.isLandlord() ? 'Landlord' : 'Tenant');

  navItems = (): PortalNavItem[] =>
    this.auth.isLandlord()
      ? [
          { label: 'Dashboard', icon: '📊', route: '/landlord/dashboard', exact: true },
          { label: 'Verification', icon: '🪪', route: '/landlord/verification' },
          { label: 'Settings', icon: '⚙️', route: '/account/settings' },
        ]
      : [
          { label: 'Dashboard', icon: '📋', route: '/tenant/dashboard', exact: true },
          { label: 'Browse rooms', icon: '🔍', route: '/' },
          { label: 'Settings', icon: '⚙️', route: '/account/settings' },
        ];

  profileForm = this.fb.group({
    fullName: [this.auth.user()?.fullName ?? '', [Validators.required, Validators.minLength(2)]],
    phone: [this.auth.user()?.phone ?? ''],
  });

  passwordForm = this.fb.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(8),
      Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/)]],
  });

  emailForm = this.fb.group({
    newEmail: ['', [Validators.required, Validators.email]],
    currentPassword: ['', Validators.required],
  });

  savingProfile = signal(false);
  profileMessage = signal<string | null>(null);
  profileError = signal<string | null>(null);

  savingPassword = signal(false);
  passwordMessage = signal<string | null>(null);
  passwordError = signal<string | null>(null);

  savingEmail = signal(false);
  emailMessage = signal<string | null>(null);
  emailError = signal<string | null>(null);

  saveProfile() {
    if (this.profileForm.invalid) return;
    this.savingProfile.set(true);
    this.profileMessage.set(null);
    this.profileError.set(null);

    const { fullName, phone } = this.profileForm.getRawValue();
    this.auth.updateProfile({ fullName: fullName!, phone: phone ?? undefined }).subscribe({
      next: () => {
        this.savingProfile.set(false);
        this.profileMessage.set('Saved.');
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
