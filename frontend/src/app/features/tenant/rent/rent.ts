import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TenanciesService } from '../../../core/services/tenancies.service';
import { RentService, RentPeriod } from '../../../core/services/rent.service';
import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';
import { Tenancy } from '../../../core/models/tenancy.model';
import { LeaseDocuments } from '../../../shared/components/lease-documents/lease-documents';
import { ScreenHint } from '../../../shared/components/screen-hint/screen-hint';

/**
 * The tenant's side of rent tracking.
 *
 * This screen exists because the reminder we send says "if you have paid, say
 * so on Mastande" — and until now there was nowhere to say it. The dispute
 * lived only in the API, so the instruction in our own message could not be
 * followed. Gap Y3 in docs/FLOW-AUDIT.md.
 *
 * Three things it is careful about:
 *
 * **It never asserts that money is owed.** Every month is shown as what the
 * landlord marked, attributed to them, with the platform's own position
 * stated plainly: Mastande has not checked. A rent tracker that reads as a
 * demand from the platform would be both wrong and, on an unverified toggle,
 * unfair.
 *
 * **Disagreeing is one tap, explaining is optional.** Being able to say "I
 * paid" matters more than being able to say why, and asking for a reason
 * before accepting a denial puts the burden on the wrong side.
 *
 * **A dispute is additive.** It sits beside the landlord's record rather than
 * replacing it, exactly as the API stores it — and it stops further reminders
 * for that month, because continuing to chase someone who has said they paid
 * is how a reminder becomes harassment.
 */
@Component({
  selector: 'app-tenant-rent',
  standalone: true,
  imports: [DatePipe, FormsModule, ZarCentsPipe, LeaseDocuments, ScreenHint],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
      <app-screen-hint key="tenant-rent" heading="This is your landlord's record, and your answer to it">
        Your landlord marks each month here. Mastande does not hold your rent or your deposit and cannot see whether you paid — so if a month is marked wrong, say so on it: your answer is kept beside theirs, neither one overwrites the other, and it stops the reminders for that month.
      </app-screen-hint>


      <div class="insight-banner">
        🧾
        <span>
          This is what your landlord has recorded. <strong>Mastande does not
          handle your rent and has not checked any of it</strong> — if a month
          is wrong, say so here and your answer is saved next to theirs.
        </span>
      </div>

      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (!tenancies().length) {
        <div class="empty-state">
          <!-- h2: this replaces the page's whole content, so it follows the
               shell's h1 directly. As an h3 it skipped a level. -->
          <h2>No tenancies yet</h2>
          <p class="muted">
            Once a landlord accepts your application and confirms you have
            moved in, your rent record appears here.
          </p>
        </div>
      } @else {
        @for (t of tenancies(); track t.id) {
          <section class="dash-section">
            <h2 class="dash-section-title">
              {{ t.room?.title || 'Your room' }}
              <span class="dash-count">{{ t.rentCents | zarCents }}/mo</span>
            </h2>
            @if (t.room?.locationDisplay) {
              <p class="muted">{{ t.room?.locationDisplay }}</p>
            }

            @if (periodsFor(t.id); as periods) {
              @if (!periods.length) {
                <p class="muted">Your landlord has not recorded any months yet.</p>
              }
              @for (p of periods; track p.id) {
                <div class="app-card">
                  <div class="app-info">
                    <div class="app-room">
                      {{ p.periodStart | date: 'MMMM yyyy' }} — {{ p.amountCents | zarCents }}
                    </div>
                    <div class="app-location">
                      <span class="app-status" [class]="'app-status status-' + p.status">
                        {{ statusLabel(p.status) }}
                      </span>
                      @if (p.markedAt) { marked by your landlord {{ p.markedAt | date: 'd MMM' }} }
                    </div>

                    @if (p.tenantDisputedAt) {
                      <div class="rent-answer">
                        ✋ You said this is wrong on {{ p.tenantDisputedAt | date: 'd MMM yyyy' }}.
                        @if (p.tenantNote) { <em>“{{ p.tenantNote }}”</em> }
                        <br/>Your landlord can see this, and no more reminders
                        will be sent for this month.
                      </div>
                    } @else if (disputing() === p.id) {
                      <div class="rent-answer">
                        <label [attr.for]="'note-' + p.id">
                          Anything you want to add? (optional)
                        </label>
                        <input [id]="'note-' + p.id" type="text" maxlength="300"
                               [(ngModel)]="note"
                               placeholder="e.g. paid on the 3rd by EFT"/>
                        <div class="portal-row-actions">
                          <button type="button" class="btn btn-sm btn-primary"
                                  [disabled]="saving()" (click)="confirmDispute(p)">
                            {{ saving() ? 'Saving…' : 'Send this' }}
                          </button>
                          <button type="button" class="btn btn-sm btn-outline"
                                  [disabled]="saving()" (click)="cancelDispute()">
                            Cancel
                          </button>
                        </div>
                      </div>
                    }

                    @if (error() === p.id) {
                      <div class="field-error" role="alert">{{ errorMessage() }}</div>
                    }
                  </div>

                  @if (canDispute(p) && disputing() !== p.id) {
                    <div class="portal-row-actions">
                      <button type="button" class="btn btn-sm btn-outline"
                              (click)="startDispute(p)">
                        I've paid this
                      </button>
                    </div>
                  }
                </div>
              }
            } @else if (t.status === 'pending') {
              <p class="muted">
                Your move-in is not confirmed yet, so there is no rent record.
                Anything you and your landlord have signed is below.
              </p>
            } @else {
              <p class="muted">Loading rent record…</p>
            }

            <!-- The tenant's own copy of the lease. Shown without a toggle,
                 unlike the landlord's yard: a tenant has one or two tenancies,
                 not sixteen, and the thing they most often need is the document
                 that says what they agreed to pay. headingLevel 3 because this
                 section's own title is the h2. -->
            <app-lease-documents [tenancyId]="t.id" [headingLevel]="3"/>
          </section>
        }
      }
  `,
})
export class TenantRent implements OnInit {
  private tenancies_ = inject(TenanciesService);
  private rent = inject(RentService);

  tenancies = signal<Tenancy[]>([]);
  loading = signal(true);
  /** tenancyId → its months, loaded on demand so one slow tenancy cannot block the page. */
  private periods = signal<Record<string, RentPeriod[]>>({});
  disputing = signal<string | null>(null);
  saving = signal(false);
  error = signal<string | null>(null);
  errorMessage = signal('');
  note = '';

  ngOnInit() {
    this.tenancies_.load().subscribe({
      next: (list) => {
        // A cancelled tenancy never started, so it has nothing to show.
        //
        // `pending` is included, which it was not before. A tenant whose
        // application had been accepted but whose move-in was not yet confirmed
        // was told "No tenancies yet" — false, and the moment they are most
        // likely to be looking, because a lease is usually signed BEFORE move-in
        // and the paperwork panel lives on this page. The rent record itself
        // still only renders for a tenancy that has started, since there is no
        // rent to record before that.
        const live = list.filter(
          (t) => t.status === 'active' || t.status === 'ended' || t.status === 'pending',
        );
        this.tenancies.set(live);
        this.loading.set(false);
        // Not for a pending tenancy: rent history returns an empty list, which
        // is truthy, so the template would take the "no months recorded yet"
        // branch instead of saying the move-in is not confirmed. Asking at all
        // would also be a request that can only answer nothing.
        for (const t of live) {
          if (t.status !== 'pending') this.loadPeriods(t.id);
        }
      },
      error: () => this.loading.set(false),
    });
  }

  private loadPeriods(tenancyId: string) {
    this.rent.history(tenancyId).subscribe({
      next: (list) => this.periods.update((m) => ({ ...m, [tenancyId]: list })),
      error: () => this.periods.update((m) => ({ ...m, [tenancyId]: [] })),
    });
  }

  periodsFor(tenancyId: string): RentPeriod[] | null {
    return this.periods()[tenancyId] ?? null;
  }

  /** Nothing to dispute on a month already marked paid, or one already answered. */
  canDispute(p: RentPeriod): boolean {
    return p.status !== 'paid' && !p.tenantDisputedAt;
  }

  statusLabel(status: string): string {
    return {
      unpaid: 'Marked unpaid',
      paid: '✓ Marked paid',
      partial: 'Marked part-paid',
      waived: 'Not being chased',
    }[status] ?? status;
  }

  startDispute(p: RentPeriod) {
    this.note = '';
    this.error.set(null);
    this.disputing.set(p.id);
  }

  cancelDispute() {
    this.disputing.set(null);
    this.note = '';
  }

  confirmDispute(p: RentPeriod) {
    this.saving.set(true);
    this.error.set(null);
    this.rent.dispute(p.id, this.note.trim() || undefined).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.disputing.set(null);
        this.note = '';
        this.periods.update((m) => ({
          ...m,
          [p.tenancyId]: (m[p.tenancyId] ?? []).map((x) => (x.id === updated.id ? updated : x)),
        }));
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(p.id);
        this.errorMessage.set(
          err?.error?.message ?? 'Could not save that. Please try again.',
        );
      },
    });
  }
}
