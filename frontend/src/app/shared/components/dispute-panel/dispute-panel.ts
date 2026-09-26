import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TenanciesService } from '../../../core/services/tenancies.service';
import { AuthService } from '../../../core/services/auth.service';
import {
  FLAG_REASONS,
  LANDLORD_FLAG_REASONS,
  TENANT_FLAG_REASONS,
  Tenancy,
  TenancyFlag,
  TenancyFlagReason,
} from '../../../core/models/tenancy.model';

/**
 * "Something went wrong with this letting" — on both dashboards, after a
 * tenancy has ended.
 *
 * The API has been able to do all of this since v1.56.0 and nothing called it.
 * Neither party could raise a report, see their own, or withdraw one; no admin
 * could read the queue. The checklist recorded the feature as built with only
 * the admin screen outstanding, and in fact nothing user-facing existed at all.
 *
 * Four decisions worth stating, because each of them is the difference between
 * a reporting tool and a weapon:
 *
 *  · **Only after the tenancy ends.** A dispute while both parties still have
 *    to live with each other is a conversation, or in a bad case the Rental
 *    Housing Tribunal. The API refuses it and so does this panel, which says
 *    so rather than showing a button that errors.
 *  · **The Tribunal is named.** It hears deposit and eviction disputes for
 *    free, in every province, and it can order money returned — which this
 *    platform cannot. Telling someone to report it to us and nothing else,
 *    when their deposit is gone, would be the most useful thing we could
 *    withhold.
 *  · **Reasons are filtered by side.** A tenant is not offered "rent was not
 *    paid" and a landlord is not offered "my deposit was withheld": an option
 *    that produces a report an admin must throw away wastes the reporter's
 *    time and teaches them the form does not work.
 *  · **Withdrawing is as easy as reporting.** A report raised in anger that
 *    cannot be taken back is a reason not to raise a real one.
 *
 * Renders nothing when there is no ended tenancy, so it can be dropped into a
 * dashboard unconditionally.
 */
@Component({
  selector: 'app-dispute-panel',
  standalone: true,
  imports: [DatePipe, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ended().length > 0) {
      <section class="dash-section" id="disputes">
        <h2 class="dash-section-title">
          Problems with a past letting
          @if (openCount() > 0) { <span class="dash-count">({{ openCount() }} open)</span> }
        </h2>

        <p class="field-hint">
          A report here is private: it goes to Mastande, not onto anyone's
          profile, and the person it is about is not told until we have read it.
          It reduces how far their listings reach while it is open — it does not
          suspend anyone, because a report is an allegation until someone checks.
        </p>

        @for (t of ended(); track t.id) {
          <div class="app-card">
            <div class="app-info">
              <div class="app-room">{{ t.room?.title ?? 'A previous letting' }}</div>
              <div class="app-location">
                {{ counterpartyName(t) }}
                @if (t.startDate && t.endDate) {
                  · {{ t.startDate | date:'MMM yyyy' }} – {{ t.endDate | date:'MMM yyyy' }}
                }
              </div>

              @if (flagFor(t.id); as flag) {
                <div class="dispute-outcome">
                  <div><strong>{{ reasonLabel(flag.reason) }}</strong> — {{ statusLabel(flag.status) }}</div>
                  <p class="app-location">{{ flag.detail }}</p>
                  @if (flag.reviewNote) {
                    <p class="field-hint">
                      Mastande’s note: {{ flag.reviewNote }}
                      @if (flag.reviewedAt) { ({{ flag.reviewedAt | date:'d MMM yyyy' }}) }
                    </p>
                  }
                </div>
              } @else if (openFor() === t.id) {
                <div class="form-row">
                  <label [attr.for]="'reason-' + t.id">What went wrong?</label>
                  <select [id]="'reason-' + t.id" [(ngModel)]="reason">
                    @for (r of reasons(); track r) {
                      <option [value]="r">{{ reasonLabel(r) }}</option>
                    }
                  </select>
                </div>

                <div class="form-row">
                  <label [attr.for]="'detail-' + t.id">What happened, in your own words</label>
                  <textarea [id]="'detail-' + t.id" rows="4" [(ngModel)]="detail"
                            placeholder="Dates, amounts, what was said — enough for someone who was not there to understand it."></textarea>
                  <span class="field-hint">
                    At least 20 characters. A reason on its own gives us nothing
                    to act on, and a report nobody can act on is a mark against
                    someone that never gets lifted.
                  </span>
                </div>

                @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }
              }
            </div>

            <div class="portal-row-actions">
              @if (flagFor(t.id); as flag) {
                @if (flag.status === 'open') {
                  <button type="button" class="btn btn-sm btn-ghost-light"
                          [disabled]="busy()" (click)="withdraw(flag)">
                    {{ busy() ? 'Saving…' : 'Withdraw report' }}
                  </button>
                }
              } @else if (openFor() === t.id) {
                <button type="button" class="btn btn-sm btn-primary"
                        [disabled]="detail.trim().length < 20 || busy()" (click)="submit(t)">
                  {{ busy() ? 'Sending…' : 'Send report' }}
                </button>
                <button type="button" class="btn btn-sm btn-ghost-light" (click)="cancel()">Cancel</button>
              } @else {
                <button type="button" class="btn btn-sm btn-outline" (click)="start(t)">
                  Report a problem
                </button>
              }
            </div>
          </div>
        }

        <p class="field-hint">
          If money is owed — a deposit not returned, rent unpaid — the Rental
          Housing Tribunal in your province hears these for free and can order
          it repaid. Reporting it here does not replace that, and does not stop
          you doing both.
        </p>
      </section>
    }
  `,
  styles: [`
    .dispute-outcome { margin-top: .5rem; font-size: .86rem; }
    .dispute-outcome p { margin-top: .25rem; }
  `],
})
export class DisputePanel implements OnInit {
  private tenancies = inject(TenanciesService);
  private auth = inject(AuthService);

  /** 'landlord' or 'tenant' — decides which reasons are offered. */
  readonly role = input.required<'landlord' | 'tenant'>();

  /**
   * Ended tenancies only. `cancelled` is not "ended": nobody moved in, so
   * there is nothing to dispute about how the letting went.
   */
  readonly ended = computed(() => this.tenancies.tenancies().filter((t) => t.status === 'ended'));
  readonly openCount = computed(
    () => this.tenancies.myFlags().filter((f) => f.status === 'open').length,
  );
  readonly reasons = computed(() =>
    this.role() === 'landlord' ? LANDLORD_FLAG_REASONS : TENANT_FLAG_REASONS,
  );

  openFor = signal<string | null>(null);
  busy = signal(false);
  error = signal<string | null>(null);
  reason: TenancyFlagReason = 'other';
  detail = '';

  ngOnInit() {
    // Both, because the panel has to know whether each ended tenancy already
    // carries a report before it offers to raise one.
    this.tenancies.load().subscribe({ error: () => {} });
    this.tenancies.loadMyFlags().subscribe({ error: () => {} });
  }

  reasonLabel(reason: TenancyFlagReason) {
    return FLAG_REASONS[reason] ?? reason;
  }

  /** Worded as an outcome, not a status code — this is read by the reporter. */
  statusLabel(status: TenancyFlag['status']) {
    const labels: Record<TenancyFlag['status'], string> = {
      open: 'we are looking at it',
      upheld: 'upheld',
      dismissed: 'not upheld',
      withdrawn: 'you withdrew this',
    };
    return labels[status] ?? status;
  }

  counterpartyName(t: Tenancy) {
    const me = this.auth.user()?.id;
    const other = t.landlordId === me ? t.tenant : t.landlord;
    return other?.fullName ?? (this.role() === 'landlord' ? 'Your tenant' : 'Your landlord');
  }

  flagFor(tenancyId: string) {
    return this.tenancies.myFlags().find((f) => f.tenancyId === tenancyId) ?? null;
  }

  start(t: Tenancy) {
    this.reason = this.reasons()[0];
    this.detail = '';
    this.error.set(null);
    this.openFor.set(t.id);
  }

  cancel() {
    this.openFor.set(null);
    this.error.set(null);
  }

  submit(t: Tenancy) {
    this.busy.set(true);
    this.error.set(null);
    this.tenancies.raiseFlag(t.id, this.reason, this.detail.trim()).subscribe({
      next: () => {
        this.busy.set(false);
        this.openFor.set(null);
      },
      error: (err: { error?: { message?: string | string[] } }) => {
        this.busy.set(false);
        const message = err?.error?.message;
        this.error.set(
          (Array.isArray(message) ? message[0] : message) ??
            'That did not send. Try again in a moment.',
        );
      },
    });
  }

  withdraw(flag: TenancyFlag) {
    this.busy.set(true);
    this.tenancies.withdrawFlag(flag.id).subscribe({
      next: () => this.busy.set(false),
      error: () => {
        this.busy.set(false);
        this.error.set('Could not withdraw that. Try again in a moment.');
      },
    });
  }
}
