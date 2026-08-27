import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { ReportsService, ReportReason, REPORT_REASON_LABELS } from '../../../core/services/reports.service';

/**
 * Report a listing.
 *
 * The disclaimer warns tenants about deposit scams and agents posing as
 * landlords and tells them to report — this is where that goes. Deliberately
 * usable signed out: requiring an account suppresses exactly the reports worth
 * having.
 */
@Component({
  selector: 'app-report-dialog',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="report-overlay" (click)="close.emit()"></div>

    <div class="report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title">
      @if (submitted()) {
        <h2 id="report-title">Thank you</h2>
        <p>{{ successMessage() }}</p>
        <button type="button" class="btn btn-primary" (click)="close.emit()">Close</button>
      } @else {
        <h2 id="report-title">Report this listing</h2>
        <p class="report-sub">
          Reports are confidential. The landlord is not told who reported them.
        </p>

        <div class="form-row">
          <label for="report-reason">What's wrong?</label>
          <select id="report-reason" [(ngModel)]="reason">
            @for (r of reasons; track r.value) {
              <option [value]="r.value">{{ r.label }}</option>
            }
          </select>
        </div>

        <div class="form-row">
          <label for="report-details">What happened?</label>
          <textarea id="report-details" rows="4" [(ngModel)]="details"
                    placeholder="Dates, amounts, what was said — specifics help us act."></textarea>
          <p class="field-hint">At least 20 characters. {{ details.length }}/2000</p>
        </div>

        @if (!auth.isAuthenticated()) {
          <div class="form-row">
            <label for="report-email">Your email</label>
            <input id="report-email" type="email" [(ngModel)]="contactEmail"
                   placeholder="So we can follow up if we need more detail"/>
          </div>
        }

        @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }

        <div class="report-actions">
          <button type="button" class="btn btn-ghost-light" (click)="close.emit()">Cancel</button>
          <button type="button" class="btn btn-primary"
                  [disabled]="!canSubmit() || submitting()" (click)="submit()">
            {{ submitting() ? 'Sending…' : 'Send report' }}
          </button>
        </div>

        <p class="report-safety">
          If you have lost money or feel unsafe, contact SAPS on <strong>10111</strong>.
          Reporting here does not replace that.
        </p>
      }
    </div>
  `,
  styles: [`
    .report-overlay {
      position: fixed; inset: 0; background: rgba(28,22,14,.5); z-index: 998;
    }
    .report-dialog {
      position: fixed; z-index: 999;
      left: 50%; top: 50%; transform: translate(-50%,-50%);
      width: min(30rem, calc(100vw - 2rem));
      max-height: 85vh; overflow-y: auto;
      background: var(--card); border-radius: var(--r12);
      padding: 1.5rem; box-shadow: var(--shadow-xl);
      h2 { font-size: 1.2rem; margin-bottom: .35rem; }
    }
    .report-sub { font-size: .85rem; color: var(--slate); margin-bottom: 1.25rem; }
    .report-actions { display: flex; gap: .6rem; justify-content: flex-end; margin-top: 1rem; }
    .report-safety {
      margin-top: 1.1rem; padding-top: .85rem; border-top: 1px solid var(--border);
      font-size: .78rem; color: var(--slate); line-height: 1.6;
    }
  `],
})
export class ReportDialog {
  auth = inject(AuthService);
  private reports = inject(ReportsService);

  readonly roomId = input<string | undefined>(undefined);
  readonly close = output<void>();

  reasons = REPORT_REASON_LABELS;
  reason: ReportReason = 'upfront_payment_demanded';
  details = '';
  contactEmail = '';

  submitting = signal(false);
  submitted = signal(false);
  successMessage = signal('');
  error = signal<string | null>(null);

  canSubmit(): boolean {
    if (this.details.trim().length < 20) return false;
    if (!this.auth.isAuthenticated() && !this.contactEmail.trim()) return false;
    return true;
  }

  submit() {
    this.submitting.set(true);
    this.error.set(null);

    this.reports.submit({
      roomId: this.roomId(),
      reason: this.reason,
      details: this.details.trim(),
      contactEmail: this.auth.isAuthenticated() ? undefined : this.contactEmail.trim(),
    }).subscribe({
      next: (res) => {
        this.submitting.set(false);
        this.successMessage.set(res.message);
        this.submitted.set(true);
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message ?? 'That could not be sent. Please try again.');
      },
    });
  }
}
