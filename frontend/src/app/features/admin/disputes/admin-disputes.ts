import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe, LowerCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import { FLAG_REASONS, OpenTenancyFlag, TenancyFlagReason } from '../../../core/models/tenancy.model';

/**
 * The post-tenancy dispute queue.
 *
 * This is the piece that made the feature real. The API has been complete
 * since v1.56.0 — raise, withdraw, review, a counter that reduces reach — and
 * nothing in the app called any of it. Every report ever raised (none, because
 * no screen could raise one) would have sat in the database reducing someone's
 * visibility with no way for a human to read it.
 *
 * Oldest first, deliberately: a report that has been waiting three weeks is
 * costing someone reach on an allegation nobody has looked at, which is worse
 * than one raised this morning.
 *
 * Two outcomes, and the note is the important part of both. Upheld keeps the
 * flag counted. Dismissed gives the account its reach back immediately —
 * leaving it reduced after a decision that the allegation did not hold would
 * make a dismissed report a punishment. Either way both parties see the note,
 * because a decision that arrives as silence is not a decision.
 */
@Component({
  selector: 'app-admin-disputes',
  standalone: true,
  imports: [DatePipe, LowerCasePipe, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
      <div class="insight-banner">
        ⚖️
        <span>
          Reports about how a letting went, raised after it ended. An open
          report pushes that account's rooms down the board; it does not hide
          listings or suspend anyone. Dismissing one restores their reach
          straight away.
        </span>
      </div>

      @if (loading()) {
        <p class="muted">Loading the queue…</p>
      } @else if (error()) {
        <p class="field-error" role="alert">{{ error() }}</p>
      } @else if (flags().length === 0) {
        <div class="empty-state">
          <h2>Nothing waiting</h2>
          <p>Reports raised by a landlord or a tenant after a letting ends appear here.</p>
        </div>
      } @else {
        @for (flag of flags(); track flag.id) {
          <div class="app-card">
            <div class="app-thumb portal-thumb" aria-hidden="true">🚩</div>

            <div class="app-info">
              <div class="app-room">{{ reasonLabel(flag.reason) }}</div>
              <div class="app-location">
                <a [routerLink]="['/admin/users', flag.raisedBy.id]">{{ flag.raisedBy.fullName }}</a>
                ({{ flag.raisedBy.role | lowercase }})
                reported
                <a [routerLink]="['/admin/users', flag.against.id]">{{ flag.against.fullName }}</a>
                ({{ flag.against.role | lowercase }})
              </div>
              <div class="app-location">
                {{ flag.tenancy.room?.title ?? 'a letting' }}
                @if (flag.tenancy.room?.locationDisplay) { · {{ flag.tenancy.room?.locationDisplay }} }
                @if (flag.tenancy.startDate && flag.tenancy.endDate) {
                  · {{ flag.tenancy.startDate | date:'MMM yyyy' }} –
                    {{ flag.tenancy.endDate | date:'MMM yyyy' }}
                }
              </div>
              <div class="app-location">
                Raised {{ flag.createdAt | date:'d MMM yyyy, HH:mm' }}
                @if (flag.against.openFlagCount > 1) {
                  · <strong>{{ flag.against.openFlagCount }} open reports against this account</strong>
                }
              </div>

              <blockquote class="dispute-detail">{{ flag.detail }}</blockquote>

              @if (decidingId() === flag.id) {
                <div class="form-row">
                  <label [attr.for]="'note-' + flag.id">
                    Note (both parties see this — {{ decision() === 'upheld' ? 'upholding' : 'dismissing' }})
                  </label>
                  <textarea [id]="'note-' + flag.id" rows="3" [(ngModel)]="reviewNote"
                            placeholder="What you checked and what you concluded."></textarea>
                  <span class="field-hint">
                    A decision that arrives as silence is not a decision. Say
                    enough that neither party has to guess.
                  </span>
                </div>
              }

              @if (actionError() === flag.id) {
                <p class="field-error" role="alert">That did not save. Try again.</p>
              }
            </div>

            <div class="portal-row-actions">
              @if (decidingId() === flag.id) {
                <button type="button" class="btn btn-sm"
                        [class.btn-danger]="decision() === 'upheld'"
                        [class.btn-sage]="decision() === 'dismissed'"
                        [disabled]="busy() === flag.id" (click)="confirm(flag)">
                  {{ busy() === flag.id
                       ? 'Saving…'
                       : decision() === 'upheld' ? 'Confirm — upheld' : 'Confirm — not upheld' }}
                </button>
                <button type="button" class="btn btn-sm btn-ghost-light" (click)="cancel()">Cancel</button>
              } @else {
                <button type="button" class="btn btn-sm btn-danger"
                        [disabled]="busy() === flag.id" (click)="start(flag, 'upheld')">
                  Uphold
                </button>
                <button type="button" class="btn btn-sm btn-sage"
                        [disabled]="busy() === flag.id" (click)="start(flag, 'dismissed')">
                  Dismiss
                </button>
              }
            </div>
          </div>
        }
      }
  `,
  styles: [`
    .dispute-detail {
      margin: .6rem 0 0;
      padding: .6rem .8rem;
      border-left: 3px solid var(--line, #e3ded6);
      background: #fff;
      font-size: .88rem;
      line-height: 1.55;
      white-space: pre-wrap;
    }
  `],
})
export class AdminDisputes implements OnInit {
  private adminService = inject(AdminService);

  flags = signal<OpenTenancyFlag[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  busy = signal<string | null>(null);
  actionError = signal<string | null>(null);
  decidingId = signal<string | null>(null);
  decision = signal<'upheld' | 'dismissed'>('upheld');
  reviewNote = '';

  ngOnInit() {
    this.load();
  }

  reasonLabel(reason: TenancyFlagReason) {
    return FLAG_REASONS[reason] ?? reason;
  }

  load() {
    this.loading.set(true);
    this.adminService.openTenancyFlags().subscribe({
      next: (list) => {
        this.flags.set(list);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load the queue.');
        this.loading.set(false);
      },
    });
  }

  start(flag: OpenTenancyFlag, decision: 'upheld' | 'dismissed') {
    this.decision.set(decision);
    this.reviewNote = '';
    this.actionError.set(null);
    this.decidingId.set(flag.id);
  }

  cancel() {
    this.decidingId.set(null);
  }

  confirm(flag: OpenTenancyFlag) {
    this.busy.set(flag.id);
    this.actionError.set(null);
    this.adminService
      .reviewTenancyFlag(flag.id, this.decision(), this.reviewNote.trim() || undefined)
      .subscribe({
        next: () => {
          this.busy.set(null);
          this.decidingId.set(null);
          // Off the queue, not re-fetched: the list is "open reports" and this
          // one is no longer open.
          this.flags.update((list) => list.filter((f) => f.id !== flag.id));
        },
        error: () => {
          this.busy.set(null);
          this.actionError.set(flag.id);
        },
      });
  }
}
