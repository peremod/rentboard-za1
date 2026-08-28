import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ReviewsService } from '../../../core/services/reviews.service';
import { ReviewType } from '../../../core/models/review.model';

/**
 * A single review. Kept deliberately small — a long form after someone has
 * moved out is a form nobody completes.
 *
 * The copy states that neither side sees the other's review until both are in,
 * because knowing that is what makes an honest review feel safe to write.
 */
@Component({
  selector: 'app-review-form',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="review-form">
      <h4 class="review-form__title">{{ heading() }}</h4>
      <p class="review-form__blind">
        Held until you and {{ counterparty() }} have both reviewed, or the window closes.
        Neither of you sees the other's first.
      </p>

      <div class="review-form__stars" role="radiogroup" [attr.aria-label]="heading()">
        @for (star of [1,2,3,4,5]; track star) {
          <button type="button" class="star" [class.star--on]="star <= rating()"
                  role="radio" [attr.aria-checked]="rating() === star"
                  [attr.aria-label]="star + ' out of 5'"
                  (click)="rating.set(star)">★</button>
        }
        @if (rating() > 0) { <span class="review-form__rating-label">{{ ratingLabel() }}</span> }
      </div>

      <div class="form-row">
        <label [attr.for]="'comment-' + type()">Your review</label>
        <textarea [id]="'comment-' + type()" [(ngModel)]="comment" rows="4"
                  [placeholder]="placeholder()"></textarea>
        <p class="field-hint">
          {{ comment.length }}/2000 · at least 20 characters
        </p>
      </div>

      @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }

      <button type="button" class="btn btn-primary"
              [disabled]="!canSubmit() || saving()" (click)="submit()">
        {{ saving() ? 'Submitting…' : 'Submit review' }}
      </button>
    </div>
  `,
  styles: [`
    .review-form { padding: 1.1rem; background: var(--card); border: 1px solid var(--border);
                   border-radius: var(--r8); margin-bottom: .85rem; }
    .review-form__title { font-size: .95rem; font-weight: 700; margin-bottom: .3rem; }
    .review-form__blind { font-size: .78rem; color: var(--slate); line-height: 1.6; margin-bottom: .85rem; }
    .review-form__stars { display: flex; align-items: center; gap: .2rem; margin-bottom: .85rem; }
    .star { background: none; border: none; font-size: 1.6rem; line-height: 1; padding: 0 .1rem;
            cursor: pointer; color: var(--border); transition: color .1s; }
    .star:hover, .star--on { color: var(--gold); background: none; box-shadow: none; transform: none; }
    .review-form__rating-label { font-size: .8rem; color: var(--slate); margin-left: .5rem; }
  `],
})
export class ReviewForm {
  private reviews = inject(ReviewsService);

  readonly tenancyId = input.required<string>();
  readonly type = input.required<ReviewType>();
  readonly counterpartyName = input<string>('the other party');
  readonly submitted = output<ReviewType>();

  rating = signal(0);
  comment = '';
  saving = signal(false);
  error = signal<string | null>(null);

  heading() {
    return {
      room: 'Review the room',
      landlord: 'Review the landlord',
      tenant: 'Review the tenant',
    }[this.type()];
  }

  placeholder() {
    return {
      room: 'What was the room and the house actually like? Space, condition, noise, housemates, anything you wish you had known.',
      landlord: 'How were they to deal with? Repairs, deposit, communication, whether they respected your space.',
      tenant: 'How were they as a tenant? Rent on time, care of the room, communication, notice given.',
    }[this.type()];
  }

  counterparty() {
    return this.counterpartyName();
  }

  ratingLabel() {
    return ['', 'Poor', 'Not great', 'Fine', 'Good', 'Excellent'][this.rating()];
  }

  canSubmit() {
    return this.rating() > 0 && this.comment.trim().length >= 20;
  }

  submit() {
    if (!this.canSubmit()) return;
    this.saving.set(true);
    this.error.set(null);

    this.reviews.submit(this.tenancyId(), this.type(), this.rating(), this.comment.trim()).subscribe({
      next: () => {
        this.saving.set(false);
        this.submitted.emit(this.type());
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(err?.error?.message ?? 'That could not be submitted. Please try again.');
      },
    });
  }
}
