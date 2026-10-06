import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { TenanciesService } from '../../../core/services/tenancies.service';
import { Tenancy } from '../../../core/models/tenancy.model';

/**
 * The move-in and move-out of a letting — Phase 8c.
 *
 * ── Why this exists
 *
 * Accepting an applicant opens a `Tenancy` with status `pending`, and the API
 * has had `confirm-start`, `cancel` and `end` since Phase 4. Every one of them
 * was wired into `tenancies.service.ts` and **called by nothing**. So in the
 * shipped product:
 *
 *   · no tenancy could ever become `active`;
 *   · `rent.service.ts` selects `tenancy: { status: 'active' }`, so no rent
 *     reminder could ever fire;
 *   · reviews open when a tenancy is ended, so none could ever be written;
 *   · notice, renewal and move-out were all unreachable.
 *
 * The owner reported it as "how a tenant's move is confusing". The rent screen
 * was describing a tenancy that had never begun. This is the missing screen.
 *
 * ── Why one component for both sides
 *
 * Either party may confirm, cancel or end — the API says so, and for a reason
 * worth keeping in view: requiring both would leave a tenancy stuck forever
 * whenever one side simply stops logging in. So the same panel serves a
 * landlord and a tenant, and only the wording changes. Two components would be
 * the copy that misses the next fix.
 *
 * ── What it is NOT
 *
 * Not a payment, not an agreement, and not a document. Confirming a move-in
 * records that somebody moved in; it says nothing about money, and the panel
 * says so out loud, because "confirm" next to a rand figure is exactly how a
 * person would come to believe this platform had handled their deposit.
 */
@Component({
  selector: 'app-tenancy-lifecycle',
  standalone: true,
  imports: [DatePipe, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (needingAnswer().length) {
      <!-- The id is what the "Confirm the move" row in the task inbox points
           at. Phase 8c mounted this panel with no anchor, so a list that knew
           a move needed confirming had nowhere to send anybody. -->
      <section class="tl" id="moving-in-out">
        <h2 class="tl__title">Moving in and out</h2>
        <p class="tl__lede">
          Marking a move-in is what starts the rent record for that room. It is a
          note of what happened — Mastande never holds rent or a deposit.
        </p>

        @for (t of needingAnswer(); track t.id) {
          <article class="tl__card">
            <div class="tl__who">
              <strong>{{ t.room?.title ?? 'A room' }}</strong>
              <span class="tl__sub">{{ otherParty(t) }}</span>
            </div>

            @if (t.status === 'pending') {
              <p class="tl__ask">{{ pendingQuestion(t) }}</p>

              <label class="tl__field">
                <span>Which day did the move happen?</span>
                <!-- The API refuses a start date more than a day ahead — "confirm
                     once the tenant has moved in" — so the picker cannot offer
                     one. A 400 for a date the form allowed is the product
                     arguing with itself. -->
                <input type="date" [(ngModel)]="startDate" [name]="'start-' + t.id" [max]="today"/>
              </label>

              <div class="tl__actions">
                <button type="button" class="btn btn-primary btn-sm"
                        [disabled]="busy() === t.id" (click)="confirm(t)">
                  {{ busy() === t.id ? 'Saving…' : movedInLabel(t) }}
                </button>
                <button type="button" class="btn btn-outline btn-sm"
                        [disabled]="busy() === t.id" (click)="fellThrough(t)">
                  It fell through
                </button>
              </div>
              <p class="tl__note">
                "It fell through" closes this without a review on either side —
                for when the room was never actually taken.
              </p>
            }

            @if (t.status === 'active') {
              <p class="tl__ask">
                Living here since {{ t.startDate | date: 'd MMM yyyy' }}.
              </p>
              <label class="tl__field">
                <span>If this has ended, which day?</span>
                <!-- Not before the move-in: the API refuses it, and a tenancy
                     that ended before it began is a record nobody can read. -->
                <input type="date" [(ngModel)]="endDate" [name]="'end-' + t.id"
                       [min]="t.startDate?.slice(0, 10)" [max]="today"/>
              </label>
              <div class="tl__actions">
                <button type="button" class="btn btn-outline btn-sm"
                        [disabled]="busy() === t.id" (click)="finish(t)">
                  {{ busy() === t.id ? 'Saving…' : movedOutLabel(t) }}
                </button>
              </div>
              <p class="tl__note">
                Ending it opens reviews for both of you, for 30 days.
              </p>
            }

            @if (error() === t.id) {
              <p class="tl__error" role="alert">{{ errorText() }}</p>
            }
          </article>
        }
      </section>
    }
  `,
  styles: [`
    .tl { margin: 0 0 1.25rem; }
    .tl__title { font-size: 1rem; margin: 0 0 .25rem; }
    .tl__lede { margin: 0 0 .75rem; font-size: .82rem; line-height: 1.55; color: #5A5047; }
    .tl__card {
      border: 1.5px solid #DDD5C8; border-radius: 8px; background: #fff;
      padding: .9rem; margin-bottom: .75rem;
    }
    .tl__who { display: grid; gap: .1rem; margin-bottom: .5rem; }
    .tl__sub { font-size: .78rem; color: #6B6055; }
    .tl__ask { margin: 0 0 .6rem; font-size: .88rem; line-height: 1.5; }
    .tl__field { display: grid; gap: .25rem; font-size: .8rem; font-weight: 600; margin-bottom: .7rem; }
    .tl__field input {
      width: 100%; font: inherit; font-weight: 400; min-height: 44px;
      padding: .5rem .6rem; border: 1.5px solid #DDD5C8; border-radius: 4px;
    }
    .tl__actions { display: flex; flex-wrap: wrap; gap: .6rem; }
    .tl__note { margin: .6rem 0 0; font-size: .75rem; line-height: 1.5; color: #6B6055; }
    .tl__error {
      margin: .6rem 0 0; padding: .5rem .6rem; font-size: .8rem; line-height: 1.5;
      color: #B23B3B; background: rgba(178,59,59,.07);
      border: 1.5px solid rgba(178,59,59,.35); border-radius: 4px;
    }
    /* Breakpoints here are 900/768/480. At the narrowest the two buttons go
       full width rather than being squeezed side by side — one of them closes
       a letting. */
    @media (max-width: 480px) {
      .tl__actions .btn { flex: 1 1 100%; }
    }
  `],
})
export class TenancyLifecycle implements OnInit {
  private tenancies = inject(TenanciesService);
  private auth = inject(AuthService);

  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly errorText = signal('');

  /** Today, as the date input wants it. The API will not take a later one. */
  protected readonly today = new Date().toISOString().slice(0, 10);
  protected startDate = this.today;
  protected endDate = this.today;

  /**
   * Only the ones waiting on somebody.
   *
   * `ended` and `cancelled` are finished — showing them here would turn a list
   * of things to do into a history nobody asked for, and the review prompt
   * already covers what follows an ending.
   */
  protected readonly needingAnswer = computed(() =>
    this.tenancies.tenancies().filter((t) => t.status === 'pending' || t.status === 'active'),
  );

  ngOnInit() {
    this.tenancies.load().subscribe({ error: () => {} });
  }

  protected amLandlord(t: Tenancy) {
    return this.auth.user()?.id === t.landlordId;
  }

  protected otherParty(t: Tenancy) {
    const name = this.amLandlord(t) ? t.tenant?.fullName : t.landlord?.fullName;
    return this.amLandlord(t) ? `${name ?? 'Your tenant'} — your tenant` : `${name ?? 'Your landlord'} — your landlord`;
  }

  protected pendingQuestion(t: Tenancy) {
    return this.amLandlord(t)
      ? 'You accepted this application. Has the tenant moved in?'
      : 'Your application was accepted. Have you moved in?';
  }

  protected movedInLabel(t: Tenancy) {
    return this.amLandlord(t) ? 'Yes, they moved in' : 'Yes, I moved in';
  }

  protected movedOutLabel(t: Tenancy) {
    return this.amLandlord(t) ? 'They have moved out' : 'I have moved out';
  }

  private fail(t: Tenancy, err: unknown) {
    this.busy.set(null);
    this.error.set(t.id);
    const message = (err as { error?: { message?: string } })?.error?.message;
    /**
     * The server's own sentence when there is one. Its refusals already say
     * the useful thing — "A move-in date cannot be in the future. Confirm once
     * the tenant has moved in." — and replacing that with "Something went
     * wrong" would throw away the only part a person can act on.
     */
    this.errorText.set(message ?? 'That did not save just now. Try again in a moment.');
  }

  private done() {
    this.busy.set(null);
    this.error.set(null);
    this.tenancies.load().subscribe({ error: () => {} });
  }

  protected confirm(t: Tenancy) {
    this.busy.set(t.id);
    this.tenancies.confirmStart(t.id, this.startDate)
      .subscribe({ next: () => this.done(), error: (e) => this.fail(t, e) });
  }

  protected fellThrough(t: Tenancy) {
    this.busy.set(t.id);
    this.tenancies.cancel(t.id)
      .subscribe({ next: () => this.done(), error: (e) => this.fail(t, e) });
  }

  protected finish(t: Tenancy) {
    this.busy.set(t.id);
    this.tenancies.end(t.id, undefined, this.endDate)
      .subscribe({ next: () => this.done(), error: (e) => this.fail(t, e) });
  }
}
