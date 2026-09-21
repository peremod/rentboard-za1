import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DialogService } from '../../../core/services/dialog.service';
import { RouterLink } from '@angular/router';

/**
 * Pricing shown here MUST match the live Stripe Price objects configured in
 * backend/.env — see README §18. This page displays prices for information
 * only; the actual amount charged always comes from Stripe at checkout time.
 */
@Component({
  selector: 'app-upgrade',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="upgrade">
      <p><a routerLink="/landlord/dashboard">← Back to dashboard</a></p>
      <h1>Upgrade your plan</h1>

      <div class="upgrade__toggle">
        <button type="button" [class.active]="interval() === 'monthly'" (click)="interval.set('monthly')">Monthly</button>
        <button type="button" [class.active]="interval() === 'annual'" (click)="interval.set('annual')">Annual <span class="save">save ~28%</span></button>
      </div>

      <div class="upgrade__plans">
        <div class="plan">
          <h2>Pro</h2>
          <p class="price">{{ interval() === 'monthly' ? 'R349/mo' : 'R2,999/yr' }}</p>
          <ul>
            <li>Unlimited active rooms</li>
            <li>Priority support</li>
            <li>Applicant analytics</li>
          </ul>
          <button type="button" (click)="upgrade('pro')">Upgrade to Pro</button>
        </div>
        <div class="plan plan--featured">
          <h2>Agency</h2>
          <p class="price">{{ interval() === 'monthly' ? 'R1,499/mo' : 'R12,999/yr' }}</p>
          <ul>
            <li>Everything in Pro</li>
            <li>Multi-user team access</li>
            <li>Bulk listing tools</li>
          </ul>
          <button type="button" (click)="upgrade('agency')">Upgrade to Agency</button>
        </div>
      </div>

      <p class="muted">Cancel anytime — 20 business days' notice per the Consumer Protection Act (see <a routerLink="/legal/terms">Terms</a> §4).</p>
    </div>
  `,
  styles: [`
    .upgrade { max-width: 600px; margin: 2rem auto; padding: 0 1.25rem; font-family: sans-serif; }
    h1 { font-size: 1.3rem; margin: .5rem 0 1.5rem; }
    .upgrade__toggle { display: flex; gap: .5rem; margin-bottom: 1.5rem; }
    .upgrade__toggle button { padding: .5rem 1rem; border-radius: 6px; border: 1.5px solid #DDD5C8; background: #fff; cursor: pointer; font-size: .82rem; }
    .upgrade__toggle button.active { background: #1A1410; color: #fff; border-color: #1A1410; }
    .save { font-size: .68rem; color: #3D7040; font-weight: 700; }
    .upgrade__plans { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .plan { border: 1.5px solid #DDD5C8; border-radius: 10px; padding: 1.25rem; }
    .plan--featured { border-color: var(--terra); }
    .plan h2 { font-size: 1rem; margin-bottom: .3rem; }
    .price { font-size: 1.3rem; font-weight: 700; color: var(--terra); margin-bottom: .8rem; }
    .plan ul { list-style: none; margin-bottom: 1rem; font-size: .8rem; color: #3A3228; }
    .plan li { margin-bottom: .3rem; }
    .plan button { width: 100%; padding: .55rem; border-radius: 6px; border: none; background: var(--terra); color: #fff; font-weight: 700; cursor: pointer; }
    .muted { font-size: .78rem; color: #7A6E60; margin-top: 1.5rem; }
    @media (max-width: 520px) { .upgrade__plans { grid-template-columns: 1fr; } }
  `],
})
export class Upgrade {
  private dialogs = inject(DialogService);
  interval = signal<'monthly' | 'annual'>('monthly');

  upgrade(planTier: 'pro' | 'agency') {
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
