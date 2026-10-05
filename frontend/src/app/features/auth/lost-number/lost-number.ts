import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

/**
 * The last step of getting back in when the phone is gone — Phase 7q.
 *
 * ⚠️ This page cannot start a recovery, and that is deliberate.
 *
 * There is no self-service version of handing an account over that is safe: the
 * account holds rooms, tenancies, a rent record and conversations with tenants.
 * A request is opened by an admin, with a person in front of them, who checks
 * an identity document and records what they saw. This page is only where the
 * NEW handset answers the code — the second of the two proofs, and the one the
 * person has to supply themselves.
 *
 * So the page's job is half instruction: somebody who lands here without having
 * spoken to anybody needs to be told what to do, not given a form that cannot
 * help them.
 */
@Component({
  selector: 'app-lost-number',
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="auth">
      <div class="auth__card">
        <h1 class="auth__title">Lost the phone you sign in with?</h1>

        <p class="auth__sub">
          If you still have your number, you do not need this page — sign in with
          a WhatsApp code as usual, or change your number from your settings.
          This is for a phone that is gone.
        </p>

        <div class="insight-banner">
          📞
          <span>
            <strong>Talk to us first.</strong> Because your account has no email
            address and no password, your number is the only way in — so we have
            to check who you are in person before we can move it. Nobody can do
            that through a web form, including you.
          </span>
        </div>

        <ol class="lost__steps">
          <li>Contact us and tell us the number you used to sign in with.</li>
          <li>We check who you are, and write down what we checked.</li>
          <li>We send a code to your <strong>new</strong> number.</li>
          <li>You enter it below. Only then does your account move.</li>
        </ol>

        <h2 class="auth__title" style="font-size:1.1rem;margin-top:1.5rem">
          Already been told to expect a code?
        </h2>

        <form (ngSubmit)="submit()" class="auth__form">
          <div class="auth__field">
            <label for="phone">Your new mobile number</label>
            <input id="phone" type="tel" inputmode="tel" name="phone"
                   [(ngModel)]="phone" placeholder="e.g. 082 987 6543"
                   autocomplete="tel"/>
          </div>
          <div class="auth__field">
            <label for="code">The 6-digit code we sent to it</label>
            <input id="code" type="text" inputmode="numeric" maxlength="6" name="code"
                   [(ngModel)]="code" placeholder="000000" autocomplete="one-time-code"/>
          </div>

          @if (error()) { <p class="auth__error" role="alert">{{ error() }}</p> }
          @if (message()) { <p class="auth__hint" role="status">{{ message() }}</p> }

          <button type="submit" class="auth__submit"
                  [disabled]="busy() || phone.trim().length < 10 || code.trim().length !== 6">
            {{ busy() ? 'Checking…' : 'This is my number now' }}
          </button>
        </form>

        <p class="auth__alt">
          <a routerLink="/auth/login">Back to signing in</a>
        </p>
      </div>
    </section>
  `,
  styles: [`
    .lost__steps {
      margin: 1rem 0 0;
      padding-left: 1.3rem;
      display: grid;
      gap: .5rem;
      font-size: .9rem;
      color: var(--slate);
      line-height: 1.5;
    }
    .lost__steps li { padding-left: .2rem; }
  `],
})
export class LostNumber {
  private http = inject(HttpClient);
  private router = inject(Router);

  phone = '';
  code = '';
  busy = signal(false);
  error = signal<string | null>(null);
  message = signal<string | null>(null);

  submit() {
    this.busy.set(true);
    this.error.set(null);
    this.message.set(null);
    this.http
      .post<{ message: string; phone: string }>(
        `${environment.apiUrl}/auth/lost-number/confirm`,
        { phone: this.phone.trim(), code: this.code.trim() },
      )
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.message.set(`${res.message} Taking you to sign in…`);
          // Straight to the phone sign-in, which is the only way in they have.
          setTimeout(() => this.router.navigate(['/auth/login']), 2500);
        },
        error: (err) => {
          this.busy.set(false);
          this.error.set(err?.error?.message ?? 'That did not work. Contact us and we will look.');
        },
      });
  }
}
