import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PropertiesService } from '../../../core/services/properties.service';
import { UpcomingLease } from '../../../core/models/property.model';
import { DialogService } from '../../../core/services/dialog.service';

/**
 * Which rooms are about to be empty, and the one decision each needs.
 *
 * A separate component rather than more of the yard screen, which is already
 * long — and because the same panel belongs on the landlord dashboard when the
 * Phase 5a task inbox is built.
 *
 * ── Two situations, deliberately not merged
 *
 *   lease_ending  a fixed term runs out soon. Nothing has been decided: the
 *                 landlord renews, lets it roll on, or starts relisting.
 *   notice_given  somebody is leaving on a known day. The decision is made;
 *                 what is left is to relist in time.
 *
 * The API says which, and this does not re-derive it. Two screens deriving the
 * same thing is two screens that can derive it differently.
 *
 * Nothing renders when there is nothing to decide. A landlord whose tenancies
 * are all rolling along quietly should see no card at all, not an empty one
 * headed "Ending soon" — which reads as a system that has lost track.
 */
@Component({
  selector: 'app-lease-panel',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length) {
      <section class="dash-section" id="ending-soon">
        @if (headingLevel() === 2) {
          <h2 class="dash-section-title">Rooms coming up</h2>
        } @else {
          <h3 class="dash-section-title">Rooms coming up</h3>
        }

        <p class="muted">
          A lease ending in the next {{ leadDays }} days, or somebody who has given notice.
          Rooms rolling on month to month are not listed — nothing is happening to them.
        </p>

        @for (row of rows(); track row.tenancyId) {
          <div class="lease-row" [class.lease-row--overdue]="row.overdue">
            <div class="lease-row__head">
              <a [routerLink]="['/rooms', row.room.id]">{{ row.room.title }}</a>
              <span class="muted">{{ row.tenant.fullName }}</span>
            </div>

            <p class="lease-row__when">
              @if (row.reason === 'notice_given') {
                {{ row.noticeGivenBy === 'you' ? 'You gave notice' : 'They gave notice' }}
                on {{ row.noticeGivenAt | date: 'd MMM' }} —
              } @else {
                The lease ends
              }
              <strong>{{ whenText(row) }}</strong>
            </p>

            <div class="lease-row__actions">
              @if (row.reason === 'lease_ending') {
                <!-- The three real answers to "your lease is ending", in the
                     order a landlord is most likely to want them. -->
                <button type="button" class="btn btn-sm btn-primary"
                        [disabled]="busy() === row.tenancyId"
                        (click)="renew(row)">Renew for a year</button>
                <button type="button" class="link-btn" [disabled]="busy() === row.tenancyId"
                        (click)="letItRoll(row)">Let it roll on</button>
                <button type="button" class="link-btn" [disabled]="busy() === row.tenancyId"
                        (click)="theyAreLeaving(row)">They are leaving</button>
              } @else {
                <a class="btn btn-sm btn-sage" [routerLink]="['/landlord/rooms', row.room.id, 'edit']">
                  Get it back on the board
                </a>
                <button type="button" class="link-btn" [disabled]="busy() === row.tenancyId"
                        (click)="undoNotice(row)">Notice was a mistake</button>
              }
            </div>
          </div>
        }

        @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }
      </section>
    }
  `,
  styles: [
    `
      .lease-row {
        border-top: 1px solid var(--line);
        padding: 0.75rem 0;
      }
      .lease-row--overdue .lease-row__when strong {
        color: var(--terra-deep, #8e3519);
      }
      .lease-row__head {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: baseline;
      }
      .lease-row__when {
        margin: 0.25rem 0 0.5rem;
      }
      .lease-row__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
        align-items: center;
      }
    `,
  ],
})
export class LeasePanel implements OnInit {
  private properties = inject(PropertiesService);
  private dialogs = inject(DialogService);

  /** Set by the host — a component cannot know what it is nested inside. */
  readonly headingLevel = input<2 | 3>(2);

  /** Matches RENEWAL_LEAD_DAYS in the API. Shown so the rule is not a mystery. */
  protected readonly leadDays = 30;

  protected readonly rows = signal<UpcomingLease[]>([]);
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  ngOnInit() {
    this.load();
  }

  private load() {
    this.properties.upcomingLeases().subscribe({
      next: (list) => this.rows.set(list),
      // Silent: this is one panel on a dashboard, and an error banner because a
      // secondary panel failed is worse than the panel not being there.
      error: () => {},
    });
  }

  /**
   * "in 12 days", "today", "8 days ago".
   *
   * Plain words rather than a date, because the question a landlord is asking
   * is how long they have, and counting from a date is work they should not have
   * to do. The date is still shown for notice, where the day it was given
   * matters for a dispute.
   */
  protected whenText(row: UpcomingLease): string {
    const d = row.daysUntilEmpty;
    if (d === null) return 'at some point';
    if (d === 0) return 'today';
    if (d === 1) return 'tomorrow';
    if (d > 0) return `in ${d} days`;
    // Past. Said plainly rather than as a negative number.
    return d === -1 ? 'yesterday — already empty' : `${Math.abs(d)} days ago — already empty`;
  }

  /** A year from the current end date, which is what "renew" almost always means. */
  protected renew(row: UpcomingLease) {
    const from = row.leaseEndDate ? new Date(row.leaseEndDate) : new Date();
    const next = new Date(from);
    next.setFullYear(next.getFullYear() + 1);
    this.apply(row, { leaseEndDate: next.toISOString().slice(0, 10) });
  }

  /** Fixed term becomes month-to-month. `null` is the value that says so. */
  protected letItRoll(row: UpcomingLease) {
    this.apply(row, { leaseEndDate: null });
  }

  private apply(row: UpcomingLease, body: { leaseEndDate: string | null }) {
    this.busy.set(row.tenancyId);
    this.error.set(null);
    this.properties.updateLeaseTerms(row.tenancyId, body).subscribe({
      next: () => {
        this.busy.set(null);
        this.load();
      },
      error: () => {
        this.busy.set(null);
        this.error.set('That did not save. Check your connection and try again.');
      },
    });
  }

  /**
   * Log that the tenant is leaving.
   *
   * Confirmed, because it starts a countdown the landlord will plan around, and
   * `givenBy: 'tenant'` is recorded rather than assumed — see the API note on
   * why who gave notice is a fact worth keeping.
   */
  protected async theyAreLeaving(row: UpcomingLease) {
    const confirmed = await this.dialogs.confirm(
      `${row.tenant.fullName} is leaving?`,
      `This records that they gave notice today. ${row.room.title} will show as coming free in ${row.noticePeriodDays} days, and you can undo it if you logged it by mistake.`,
      'Yes, they gave notice',
      'Not yet',
    );
    if (!confirmed) return;

    this.busy.set(row.tenancyId);
    this.properties.giveNotice(row.tenancyId, { givenBy: 'tenant' }).subscribe({
      next: () => {
        this.busy.set(null);
        this.load();
      },
      error: () => {
        this.busy.set(null);
        this.error.set('That did not save. Check your connection and try again.');
      },
    });
  }

  protected undoNotice(row: UpcomingLease) {
    this.busy.set(row.tenancyId);
    this.properties.withdrawNotice(row.tenancyId).subscribe({
      next: () => {
        this.busy.set(null);
        this.load();
      },
      error: () => {
        this.busy.set(null);
        this.error.set('That did not save. Check your connection and try again.');
      },
    });
  }
}
