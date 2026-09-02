import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ReferralsService } from '../../../core/services/referrals.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth">
      <div class="auth__card">
        <div class="auth__brand">Rent<span>Board</span></div>
        <h1 class="auth__title">Create your free account</h1>
        <p class="auth__sub">Free to list. Free to apply. Always.</p>

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

          <div class="auth__field">
            <label for="referralCode">Invite code <span class="muted">(optional)</span></label>
            <input id="referralCode" type="text" formControlName="referralCode"
                   autocapitalize="characters" spellcheck="false"
                   placeholder="e.g. JHB-K4M2P" (blur)="checkCode()"/>
            @if (checkingCode()) {
              <p class="field-hint">Checking…</p>
            } @else if (codeCheck()?.valid) {
              <p class="field-hint">✓ Invited by {{ codeCheck()!.invitedBy }}</p>
            } @else if (codeCheck() && !codeCheck()!.valid) {
              <p class="field-hint">
                We don't recognise that code. You can still sign up without it.
              </p>
            }
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
export class Register implements OnInit {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private referrals = inject(ReferralsService);
  private router = inject(Router);

  role = signal<'TENANT' | 'LANDLORD'>('TENANT');
  loading = signal(false);
  error = signal<string | null>(null);

  form = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    // Optional. An invalid code never blocks registration — it is simply not
    // credited, which is better than turning someone away over a typo.
    referralCode: [''],
  });

  codeCheck = signal<{ valid: boolean; invitedBy?: string } | null>(null);
  checkingCode = signal(false);

  ngOnInit() {
    // Arrives as ?ref=CODE from a shared link; pre-filled and confirmed so the
    // person can see the invite was recognised.
    const ref = this.route.snapshot.queryParamMap.get('ref');
    if (ref) {
      this.form.patchValue({ referralCode: ref.toUpperCase() });
      this.checkCode();
    }
  }

  /** Confirms a code as the person finishes typing it. */
  checkCode() {
    const code = (this.form.value.referralCode ?? '').trim();
    if (code.length < 3) {
      this.codeCheck.set(null);
      return;
    }
    this.checkingCode.set(true);
    this.referrals.validate(code).subscribe({
      next: (res) => { this.codeCheck.set(res); this.checkingCode.set(false); },
      error: () => { this.codeCheck.set(null); this.checkingCode.set(false); },
    });
  }

  onSubmit() {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    const raw = this.form.getRawValue();
    this.auth.register({
      ...(raw as any),
      // Omit rather than send an empty string.
      referralCode: raw.referralCode?.trim() || undefined,
      role: this.role(),
    }).subscribe({
      next: (res) => this.router.navigate([res.user.role === 'LANDLORD' ? '/landlord/dashboard' : '/tenant/dashboard']),
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message ?? 'Something went wrong. Please try again.');
      },
    });
  }
}
