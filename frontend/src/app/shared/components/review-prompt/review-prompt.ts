import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReviewsService } from '../../../core/services/reviews.service';
import { ReviewableTenancy, ReviewType } from '../../../core/models/review.model';
import { ReviewForm } from '../review-form/review-form';

/**
 * "You lived at X — how was it?" Shown on both dashboards after a tenancy ends.
 *
 * Renders nothing when there is nothing outstanding, so it can be dropped into
 * a dashboard unconditionally. The deadline is shown because a review window
 * that closes silently is one people miss.
 */
@Component({
  selector: 'app-review-prompt',
  standalone: true,
  imports: [DatePipe, ReviewForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (pending().length > 0) {
      <section class="dash-section">
        <div class="dash-section-title">Reviews</div>

        @for (item of pending(); track item.tenancy.id) {
          <div class="review-prompt">
            <div class="review-prompt__head">
              <div>
                <div class="app-room">{{ item.tenancy.room?.title ?? 'A previous letting' }}</div>
                <div class="app-location">
                  @if (item.tenancy.startDate && item.tenancy.endDate) {
                    {{ item.tenancy.startDate | date:'MMM yyyy' }} –
                    {{ item.tenancy.endDate | date:'MMM yyyy' }}
                  }
                  @if (item.closesAt) {
                    · reviews close {{ item.closesAt | date:'d MMM' }}
                  }
                </div>
              </div>
            </div>

            @for (type of remaining(item); track type) {
              <app-review-form
                [tenancyId]="item.tenancy.id"
                [type]="type"
                [counterpartyName]="counterparty(item)"
                (submitted)="onSubmitted(item, $event)"/>
            }

            @if (remaining(item).length === 0) {
              <p class="field-hint">
                ✅ Thank you — your review is held until
                {{ counterparty(item) }} has written theirs, or the window closes.
              </p>
            }
          </div>
        }
      </section>
    }
  `,
  styles: [`
    .review-prompt { margin-bottom: 1.25rem; padding-bottom: 1.25rem; border-bottom: 1px solid var(--border); }
    .review-prompt:last-child { border-bottom: none; }
    .review-prompt__head { margin-bottom: .85rem; }
  `],
})
export class ReviewPrompt implements OnInit {
  private reviews = inject(ReviewsService);

  pending = signal<ReviewableTenancy[]>([]);
  private submittedTypes = signal<Record<string, ReviewType[]>>({});

  ngOnInit() {
    this.reviews.loadReviewable().subscribe({
      next: (list) => this.pending.set(list),
      error: () => {},   // a dashboard must still render if this fails
    });
  }

  /** Outstanding minus anything submitted in this session. */
  remaining(item: ReviewableTenancy): ReviewType[] {
    const done = this.submittedTypes()[item.tenancy.id] ?? [];
    return item.outstanding.filter((t) => !done.includes(t));
  }

  counterparty(item: ReviewableTenancy): string {
    return item.role === 'landlord'
      ? item.tenancy.tenant?.fullName ?? 'your tenant'
      : item.tenancy.landlord?.fullName ?? 'your landlord';
  }

  onSubmitted(item: ReviewableTenancy, type: ReviewType) {
    this.submittedTypes.update((map) => ({
      ...map,
      [item.tenancy.id]: [...(map[item.tenancy.id] ?? []), type],
    }));
  }
}
