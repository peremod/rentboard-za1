import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReferralsService } from '../../../core/services/referrals.service';
import { AuthService } from '../../../core/services/auth.service';
import { Icon } from '../icon/icon';

type ShareKind = 'landlord_to_landlord' | 'landlord_to_tenant' | 'tenant_to_tenant';

/**
 * Referral panel for both dashboards.
 *
 * ⚠️ The copy names NO reward, for landlords or tenants. It used to tell
 * landlords their R149 identity check was covered by a referral; nothing in
 * the product could spend that credit (§100), so the panel was making a
 * monetary promise the platform did not keep. The R149 is a verification fee,
 * not a referral reward.
 *
 * The principle in the old comment was right and is why this is now one line
 * rather than two branches: implying a payout we cannot fund costs more trust
 * than the referrals are worth.
 */
@Component({
  selector: 'app-referral-panel',
  standalone: true,
  imports: [Icon, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (data(); as d) {
      <section class="dash-section">
        <h2 class="dash-section-title">
          Invite people
          @if (d.summary.qualified > 0) {
            <span class="dash-count">({{ d.summary.qualified }} joined)</span>
          }
        </h2>

        <div class="referral-code-box">
          <div class="referral-code-box__label">Your code</div>
          <div class="referral-code-box__code">{{ d.code }}</div>
          <button type="button" class="btn btn-sm btn-outline" (click)="copyCode(d.code)">
            @if (copied() === 'code') { <app-icon name="check"/> Copied } @else { Copy code }
          </button>
        </div>

        <!-- ⚠️ One line for everybody, and NO reward named. See §100.
             This used to tell a landlord "You have N free verifications
             earned. It covers the R149 identity check." and, before they had
             earned one, "your R149 verification is covered". Driven end to
             end against the real API: the credit is granted, counted and
             displayed, and NOTHING SPENDS IT. consumeFreeVerification() has
             no caller anywhere in the codebase, and requiresPayment(type,
             role) cannot see a credit even in principle. So the screen made
             a specific promise in rands that the product could not keep.

             The R149 is the identity VERIFICATION fee — a charge for a
             service, described honestly on /legal/terms, the privacy policy
             and the verification screen. It is not a referral reward, and
             tying the two together was the mistake. Referrals are
             attribution now, and say so.

             ⚠️ The backend still grants and counts the credit; only the
             promise is gone. That is deliberate: nothing is taken away from
             anyone who already earned one, and wiring redemption up later
             (§100, option 1) needs no migration. Until then nothing on
             screen offers it. -->
        <p class="muted">
          There's no cash reward for inviting people — we'd rather not promise
          one we can't fund. More tenants and landlords simply means more rooms
          and faster replies for everyone.
        </p>

        <h2 class="dash-section-title" style="margin-top:1.25rem">Share</h2>
        <div class="referral-share">
          @for (option of shareOptions(); track option.kind) {
            <div class="referral-share__row">
              <div class="referral-share__label">{{ option.label }}</div>
              <div class="referral-share__actions">
                <a class="btn btn-sm btn-sage"
                   [href]="whatsappUrl(option.kind, d.code)"
                   target="_blank" rel="noopener">WhatsApp</a>
                <button type="button" class="btn btn-sm btn-ghost-light"
                        (click)="copyMessage(option.kind, d.code)">
                  @if (copied() === option.kind) { <app-icon name="check"/> Copied } @else { Copy message }
                </button>
              </div>
            </div>
          }
        </div>

        @if (d.referrals.length > 0) {
          <h2 class="dash-section-title" style="margin-top:1.25rem">Who you've invited</h2>
          @for (r of d.referrals; track r.id) {
            <div class="app-card">
              <div class="app-thumb portal-thumb" aria-hidden="true">
                <app-icon [name]="r.referee.role === 'LANDLORD' ? 'key' : 'home'"/>
              </div>
              <div class="app-info">
                <div class="app-room">{{ r.referee.fullName }}</div>
                <div class="app-location">
                  Joined {{ r.createdAt | date:'d MMM yyyy' }}
                  @if (r.qualifyingAction) { · {{ actionLabel(r.qualifyingAction) }} }
                </div>
              </div>
              <div class="portal-row-actions">
                <span class="app-status" [class]="'app-status status-' + statusClass(r.status)">
                  {{ statusLabel(r.status) }}
                </span>
              </div>
            </div>
          }
        }
      </section>
    }
  `,
  styles: [`
    .referral-code-box { display: flex; align-items: center; gap: .85rem; flex-wrap: wrap;
                         padding: .9rem 1.1rem; background: var(--cream2);
                         border: 1px dashed var(--border); border-radius: var(--r8); }
    .referral-code-box__label { font-size: .72rem; text-transform: uppercase;
                                letter-spacing: .08em; color: var(--slate); }
    .referral-code-box__code { font-family: var(--font-mono); font-size: 1.25rem;
                               font-weight: 600; color: var(--terra); letter-spacing: .05em; flex: 1; }
    .referral-share__row { display: flex; align-items: center; justify-content: space-between;
                           gap: .75rem; padding: .6rem 0; border-bottom: 1px solid var(--border);
                           flex-wrap: wrap; }
    .referral-share__row:last-child { border-bottom: none; }
    .referral-share__label { font-size: .85rem; color: var(--ink2); }
    .referral-share__actions { display: flex; gap: .4rem; }
  `],
})
export class ReferralPanel implements OnInit {
  private referrals = inject(ReferralsService);
  private auth = inject(AuthService);

  data = this.referrals.mine;
  copied = signal<string | null>(null);

  isLandlord = () => this.auth.isLandlord();

  ngOnInit() {
    // A failure here must not take the dashboard down with it.
    this.referrals.load().subscribe({ error: () => {} });
  }

  shareOptions(): { kind: ShareKind; label: string }[] {
    return this.isLandlord()
      ? [
          { kind: 'landlord_to_landlord', label: 'Invite another landlord' },
          { kind: 'landlord_to_tenant', label: 'Invite someone looking for a room' },
        ]
      : [{ kind: 'tenant_to_tenant', label: 'Invite someone looking for a room' }];
  }

  whatsappUrl(kind: ShareKind, code: string) {
    return this.referrals.whatsappUrl(this.referrals.shareMessage(kind, code));
  }

  copyCode(code: string) {
    this.write(code, 'code');
  }

  copyMessage(kind: ShareKind, code: string) {
    this.write(this.referrals.shareMessage(kind, code), kind);
  }

  private write(text: string, marker: string) {
    navigator.clipboard?.writeText(text).then(
      () => {
        this.copied.set(marker);
        setTimeout(() => this.copied.set(null), 2000);
      },
      () => {},   // clipboard blocked; the text is still selectable on screen
    );
  }

  actionLabel(action: string) {
    return { published_room: 'listed a room', applied: 'applied for a room' }[action] ?? action;
  }

  statusLabel(status: string) {
    return {
      pending: 'Signed up',
      qualified: 'Active',
      // ⚠️ Was 'Reward earned', and there is no reward to earn — see the
      // template comment and §100. The backend's status is still `rewarded`,
      // because the credit is still granted; what a person READS must not
      // claim they are owed something nothing can pay. This names what
      // actually happened: they joined and put a room up.
      rewarded: 'Listed a room',
      void: 'Not counted',
    }[status] ?? status;
  }

  statusClass(status: string) {
    return { pending: 'pending', qualified: 'shortlisted', rewarded: 'accepted', void: 'rejected' }[status] ?? 'pending';
  }
}
