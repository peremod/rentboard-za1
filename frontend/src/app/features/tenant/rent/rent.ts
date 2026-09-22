import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TenanciesService } from '../../../core/services/tenancies.service';
import { RentService, RentPeriod } from '../../../core/services/rent.service';
import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';
import { PortalShell, PortalNavItem } from '../../../shared/components/portal-shell/portal-shell';
import { Tenancy } from '../../../core/models/tenancy.model';
import { tenantNav } from '../tenant-nav';

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
  imports: [DatePipe, FormsModule, ZarCentsPipe, PortalShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems" roleLabel="Tenant" avatarColour="var(--sage)">
      <h1 class="portal-title">Rent</h1>

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
          <h3>No tenancies yet</h3>
          <p class="muted">
            Once a landlord accepts your application and confirms you have
            moved in, your rent record appears here.
          </p>
        </div>
      } @else {
        @for (t of tenancies(); track t.id) {
          <section class="dash-section">
            <div class="dash-section-title">
              {{ t.room?.title || 'Your room' }}
              <span class="dash-count">{{ t.rentCents | zarCents }}/mo</span>
            </div>
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
            } @else {
              <p class="muted">Loading rent record…</p>
            }
          </section>
        }
      }
    </app-portal-shell>
  `,
})
export class TenantRent implements OnInit {
  private tenancies_ = inject(TenanciesService);
  private rent = inject(RentService);

  readonly navItems: PortalNavItem[] = tenantNav();

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
        // A cancelled tenancy never started, so it has no rent to show.
        const live = list.filter((t) => t.status === 'active' || t.status === 'ended');
        this.tenancies.set(live);
        this.loading.set(false);
        for (const t of live) this.loadPeriods(t.id);
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
