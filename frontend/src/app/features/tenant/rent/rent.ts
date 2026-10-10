import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TenanciesService } from '../../../core/services/tenancies.service';
import { RentService, RentPeriod } from '../../../core/services/rent.service';
import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';
import { Tenancy } from '../../../core/models/tenancy.model';
import { LeaseDocuments } from '../../../shared/components/lease-documents/lease-documents';
import { ScreenHint } from '../../../shared/components/screen-hint/screen-hint';
import { TenancyLifecycle } from '../../../shared/components/tenancy-lifecycle/tenancy-lifecycle';

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
 *
 * ── Current and past are different things on this screen — Phase D
 *
 * ⚠️ This screen used to loop over `active`, `ended` and `pending` tenancies
 * together with no branch on which. So a letting that finished two years ago
 * rendered **identically to the room somebody lives in**: the same heading,
 * the same present-tense "R3 000/mo", the same banner telling them to say so
 * if a month was wrong, the same paperwork panel offered as current. Reported
 * by the owner, and the cause was architectural rather than cosmetic — one
 * component was the only representation of rent, so it had to be both things.
 *
 * It is now two sections, and the past one is written in the past tense:
 * "lived there", a date range, "rent was", and the record described as a
 * record.
 *
 * **What does NOT change for a finished letting:**
 *
 *   · the ledger stays, in full. Previous months, amounts, dates and disputes
 *     are what a person needs most once they have left, and hiding them
 *     behind an archive nobody has built yet would be losing them;
 *   · the answer button stays. `RentService.dispute` deliberately refuses only
 *     a cancelled letting, because the most consequential mark a tenant ever
 *     receives is the final month — entered after they moved out, and
 *     `TenancyFlag.unpaid_rent` can rest on it. Taking their answer away at
 *     that moment would leave the landlord's unverified word as the only
 *     record.
 *
 * So the change is what the screen SAYS, not what it permits. "It is over, so
 * lock it" would be the easy wrong fix.
 */
@Component({
  selector: 'app-tenant-rent',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet, FormsModule, ZarCentsPipe, LeaseDocuments, ScreenHint, TenancyLifecycle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
      <app-screen-hint key="tenant-rent" heading="This is your landlord's record, and your answer to it">
        Your landlord marks each month here. Mastande does not hold your rent or your deposit and cannot see whether you paid — so if a month is marked wrong, say so on it: your answer is kept beside theirs, neither one overwrites the other, and it stops the reminders for that month.
      </app-screen-hint>

      <app-tenancy-lifecycle/>


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
      } @else if (!current().length && !past().length) {
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

        @for (t of current(); track t.id) {
          <section class="dash-section">
            <h2 class="dash-section-title">
              {{ t.room?.title || 'Your room' }}
              <span class="dash-count">{{ t.rentCents | zarCents }}/mo</span>
            </h2>
            @if (t.room?.locationDisplay) {
              <p class="muted">{{ t.room?.locationDisplay }}</p>
            }

            @if (t.status === 'pending') {
              <p class="muted">
                Your move-in is not confirmed yet, so there is no rent record.
                Anything you and your landlord have signed is below.
              </p>
            } @else {
              <ng-container [ngTemplateOutlet]="ledger"
                            [ngTemplateOutletContext]="{ t: t, isPast: false }"/>
            }

            <!-- The tenant's own copy of the lease. Shown without a toggle,
                 unlike the landlord's yard: a tenant has one or two tenancies,
                 not sixteen, and the thing they most often need is the document
                 that says what they agreed to pay. headingLevel 3 because this
                 section's own title is the h2. -->
            <app-lease-documents [tenancyId]="t.id" [headingLevel]="3"/>
          </section>
        }

        <!-- ⚠️ Its own section, in the past tense — Phase D.
             These used to render in the same loop as the room somebody lives
             in: same heading, same "R3 000/mo", same banner asking them to
             correct this month. A finished letting is a record, and the screen
             now says so. The ledger and the answer button both stay — see the
             component docblock for why taking them away would be the wrong
             fix. -->
        @if (past().length) {
          <section class="dash-section rent-past" id="past-lettings">
            <h2 class="dash-section-title">Rooms you have left</h2>
            <p class="muted">
              Kept as a record. Nothing here is waiting on you — but if a month
              is marked wrong you can still say so, and your landlord will see it.
            </p>

            @for (t of past(); track t.id) {
              <article class="rent-past__letting">
                <h3 class="rent-past__title">{{ t.room?.title || 'A room' }}</h3>
                <p class="rent-past__when">
                  <span class="rent-past__badge">Past letting</span>
                  @if (t.startDate && t.endDate) {
                    Lived there {{ t.startDate | date: 'd MMM yyyy' }} to {{ t.endDate | date: 'd MMM yyyy' }}.
                  } @else if (t.endDate) {
                    Ended {{ t.endDate | date: 'd MMM yyyy' }}.
                  }
                  Rent was {{ t.rentCents | zarCents }} a month.
                </p>
                @if (t.room?.locationDisplay) {
                  <p class="muted rent-past__where">{{ t.room?.locationDisplay }}</p>
                }

                <ng-container [ngTemplateOutlet]="ledger"
                              [ngTemplateOutletContext]="{ t: t, isPast: true }"/>

                <app-lease-documents [tenancyId]="t.id" [headingLevel]="4"/>
              </article>
            }
          </section>
        }
      }

      <!--
        One ledger, rendered twice.

        ⚠️ Not two copies of this markup. The rows mean the same thing whether
        the letting is running or finished — that is the whole point of keeping
        the record — and this repository has already paid for the other choice
        with a navigation defined six times that disagreed with itself. The
        isPast flag changes the tense of one sentence and nothing else.

        (And no backticks in this comment. A backtick inside an inline template
        literal terminates the template — the seventh compile failure in this
        codebase from exactly that, and it is in CLAUDE.md for a reason.)
      -->
      <ng-template #ledger let-t="t" let-isPast="isPast">
        @if (periodsFor(t.id); as periods) {
          @if (!periods.length) {
            <p class="muted">
              {{ isPast
                 ? 'Your landlord did not record any months for this letting.'
                 : 'Your landlord has not recorded any months yet.' }}
            </p>
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
      </ng-template>
  `,
  /* No emoji in these comments: an emoji inside a CSS comment in an inline
     styles block fails esbuild's CSS parser, and ng serve then keeps serving
     the previous bundle while the production build fails. */
  styles: [`
    /* Past lettings read as a record, not as a screen waiting on somebody.
       Tokens by name rather than retyped hex: --border is #E0D5C4 and this
       file is exactly where a near-miss like #DDD5C8 gets introduced. */
    .rent-past { border-top: 1.5px solid var(--border); padding-top: 1.25rem; }
    .rent-past__letting {
      border-left: 3px solid var(--border);
      padding: 0 0 .25rem 1rem;
      margin: 1.25rem 0 0;
    }
    .rent-past__title { font-size: .95rem; margin: 0 0 .35rem; }
    .rent-past__when {
      margin: 0 0 .25rem;
      font-size: .82rem; line-height: 1.6; color: var(--slate);
      display: flex; flex-wrap: wrap; align-items: center; gap: .4rem;
    }
    .rent-past__where { margin: 0 0 .6rem; }
    /* The one visual assertion on this section: it is over. Terracotta on
       cream2 rather than a grey chip, so it reads as a label and not as a
       disabled control. */
    .rent-past__badge {
      flex: 0 0 auto;
      font-size: .68rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: .06em;
      color: var(--terra-deep);
      background: var(--cream2);
      border: 1px solid var(--border);
      border-radius: var(--r-full);
      padding: .15rem .5rem;
    }
    /* Breakpoints here are 900 / 768 / 480. At the narrowest the left rule and
       its indent cost width a 360px screen does not have to spare, so the
       indent goes and the rule becomes a top border instead. */
    @media (max-width: 480px) {
      .rent-past__letting {
        border-left: none;
        border-top: 1.5px solid var(--border);
        padding: .85rem 0 .25rem;
      }
    }
  `],
})
export class TenantRent implements OnInit {
  private tenancies_ = inject(TenanciesService);
  private rent = inject(RentService);

  tenancies = signal<Tenancy[]>([]);
  loading = signal(true);

  /**
   * The letting somebody is in, or about to be in.
   *
   * `pending` belongs here and not in the past list: a lease is usually signed
   * BEFORE move-in and the paperwork panel lives on this screen, so a tenant
   * whose application has been accepted is one of the people most likely to be
   * looking. They were told "No tenancies yet", which was false.
   */
  readonly current = computed(() =>
    this.tenancies().filter((t) => t.status === 'active' || t.status === 'pending'),
  );

  /**
   * Finished lettings, newest first.
   *
   * ⚠️ These used to render in the same loop as `current`, which is what made
   * a letting that ended two years ago look like the room somebody lives in.
   *
   * `cancelled` is in neither list, and that is right: nobody ever moved in,
   * there is no rent and there is nothing to keep a record of.
   */
  readonly past = computed(() =>
    this.tenancies()
      .filter((t) => t.status === 'ended')
      .sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? '')),
  );
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
        // A cancelled tenancy never started, so it has nothing to show at all.
        // `current` and `past` split the rest; see those computeds.
        const live = list.filter((t) => t.status !== 'cancelled');
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
      // The ledger now arrives with the tenancy's own state attached. Only
      // the periods are stored here; Phase D is what reads the state and
      // stops this screen describing a finished letting as a running one.
      next: (ledger) => this.periods.update((m) => ({ ...m, [tenancyId]: ledger.periods })),
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
