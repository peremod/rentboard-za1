import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DialogService } from '../../../core/services/dialog.service';
import { RouterLink } from '@angular/router';

/**
 * Renter's Passport — a portable pre-verification badge tenants can buy to
 * stand out to landlords. IMPORTANT: the actual ID/income verification
 * behind the badge is a third-party KYC integration NOT included in this
 * pass (see README §18) — this page sells the subscription; verification
 * itself is a manual/admin step until that integration lands. Do not word
 * this page as if verification is instant or automatic.
 */
@Component({
  selector: 'app-passport',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="passport">
      <p><a routerLink="/tenant/dashboard">← Back to dashboard</a></p>
      <h1>Renter's Passport</h1>
      <p class="lead">One verification, use it on every application. Stand out to landlords.</p>

      <div class="passport__toggle">
        <button type="button" [class.active]="interval() === 'monthly'" (click)="interval.set('monthly')">Monthly — R89/mo</button>
        <button type="button" [class.active]="interval() === 'annual'" (click)="interval.set('annual')">Annual — R799/yr <span class="save">save ~25%</span></button>
      </div>

      <button type="button" class="cta" (click)="purchase()">Get your Renter's Passport →</button>

      <p class="muted">
        ⚠️ Verification (ID + proof of income) is reviewed by our team after purchase — it is not instant.
        You'll be notified once your Passport is active.
      </p>
    </div>
  `,
  styles: [`
    .passport { max-width: 480px; margin: 2rem auto; padding: 0 1.25rem; font-family: sans-serif; }
    h1 { font-size: 1.3rem; margin: .5rem 0 .3rem; }
    .lead { color: #7A6E60; margin-bottom: 1.5rem; }
    .passport__toggle { display: flex; flex-direction: column; gap: .5rem; margin-bottom: 1.5rem; }
    .passport__toggle button { padding: .7rem 1rem; border-radius: 8px; border: 1.5px solid #DDD5C8; background: #fff; cursor: pointer; text-align: left; font-size: .85rem; }
    .passport__toggle button.active { border-color: var(--terra); background: rgba(192,78,40,.05); }
    .save { color: #3D7040; font-weight: 700; font-size: .7rem; }
    .cta { width: 100%; padding: .75rem; border-radius: 8px; border: none; background: var(--terra); color: #fff; font-weight: 700; cursor: pointer; margin-bottom: 1rem; }
    .muted { font-size: .78rem; color: #7A6E60; }
  `],
})
export class Passport {
  private dialogs = inject(DialogService);
  interval = signal<'monthly' | 'annual'>('monthly');

  purchase() {
    // Billing has no payment provider. Stripe was removed — it does not
    // operate in South Africa for receiving payments — and PayFast recurring
    // billing is not built. This page is unreachable while BILLING_ENABLED is
    // false; the stub keeps it honest if that flag is ever flipped early.
    this.dialogs.alert(
      'Not available yet',
      'Paid plans are not open yet. Nothing has been charged.',
      'info',
    );
  }
}
