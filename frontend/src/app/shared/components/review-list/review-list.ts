import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Review } from '../../../core/models/review.model';

/** Published reviews, with any reply from the person reviewed. */
@Component({
  selector: 'app-review-list',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (reviews().length === 0) {
      <p class="muted">{{ emptyMessage() }}</p>
    } @else {
      @if (average() !== null) {
        <div class="review-summary">
          <span class="review-summary__score">★ {{ average()!.toFixed(1) }}</span>
          <span class="review-summary__count">
            from {{ reviews().length }} review{{ reviews().length === 1 ? '' : 's' }}
          </span>
        </div>
      }

      @for (review of reviews(); track review.id) {
        <article class="review">
          <div class="review__head">
            <span class="review__stars" [attr.aria-label]="review.rating + ' out of 5'">
              {{ stars(review.rating) }}
            </span>
            <span class="review__meta">
              {{ review.author?.fullName ?? 'A previous tenant' }}
              @if (review.publishedAt) { · {{ review.publishedAt | date:'MMM yyyy' }} }
            </span>
          </div>
          <p class="review__comment">{{ review.comment }}</p>

          @if (review.response) {
            <div class="review__response">
              <strong>Response</strong>
              @if (review.respondedAt) { <span class="review__meta"> · {{ review.respondedAt | date:'MMM yyyy' }}</span> }
              <p>{{ review.response }}</p>
            </div>
          }
        </article>
      }
    }
  `,
  styles: [`
    .review-summary { display: flex; align-items: baseline; gap: .5rem; margin-bottom: 1rem; }
    .review-summary__score { font-family: var(--font-mono); font-size: 1.35rem; color: var(--gold); font-weight: 500; }
    .review-summary__count { font-size: .82rem; color: var(--slate); }
    .review { padding: .9rem 0; border-bottom: 1px solid var(--border); }
    .review:last-child { border-bottom: none; }
    .review__head { display: flex; align-items: baseline; gap: .6rem; flex-wrap: wrap; margin-bottom: .4rem; }
    .review__stars { color: var(--gold); font-size: .95rem; letter-spacing: .05em; }
    .review__meta { font-size: .78rem; color: var(--slate); }
    .review__comment { font-size: .9rem; line-height: 1.7; color: var(--ink2); white-space: pre-line; }
    .review__response { margin-top: .7rem; padding: .7rem .9rem; background: var(--cream2);
                        border-left: 3px solid var(--border); border-radius: var(--r4); }
    .review__response strong { font-size: .8rem; }
    .review__response p { font-size: .85rem; line-height: 1.65; color: var(--ink2); margin-top: .25rem; }
  `],
})
export class ReviewList {
  readonly reviews = input.required<Review[]>();
  readonly emptyMessage = input<string>('No reviews yet.');

  stars(rating: number) {
    return '★'.repeat(rating) + '☆'.repeat(5 - rating);
  }

  average(): number | null {
    const list = this.reviews();
    if (list.length === 0) return null;
    return list.reduce((sum, r) => sum + r.rating, 0) / list.length;
  }
}
