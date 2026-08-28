import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/**
 * Star rating. Interactive when `editable`, otherwise a display.
 *
 * Built on radio inputs rather than clickable spans so it is keyboard
 * navigable and announced correctly by screen readers — a rating widget is a
 * choice from a set, and the native control already models that.
 */
@Component({
  selector: 'app-star-rating',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (editable()) {
      <fieldset class="stars stars--editable">
        <legend class="sr-only">{{ label() }}</legend>
        @for (star of [1, 2, 3, 4, 5]; track star) {
          <label class="stars__star" [class.is-on]="star <= value()">
            <input type="radio" [name]="name()" [value]="star"
                   [checked]="value() === star" (change)="value.set(star)"/>
            <span aria-hidden="true">★</span>
            <span class="sr-only">{{ star }} out of 5</span>
          </label>
        }
      </fieldset>
    } @else {
      <span class="stars" [attr.aria-label]="value() + ' out of 5'">
        @for (star of [1, 2, 3, 4, 5]; track star) {
          <span class="stars__star" [class.is-on]="star <= value()" aria-hidden="true">★</span>
        }
      </span>
    }
  `,
  styles: [`
    .stars { display: inline-flex; gap: .15rem; border: none; padding: 0; margin: 0; }
    .stars__star { color: var(--border); font-size: 1.25rem; line-height: 1; }
    .stars__star.is-on { color: var(--gold); }
    .stars--editable .stars__star { cursor: pointer; }
    .stars--editable .stars__star:hover { color: var(--gold2, var(--gold)); }
    .stars input { position: absolute; opacity: 0; width: 0; height: 0; }
    .stars input:focus-visible + span { outline: 2px solid var(--terra); outline-offset: 2px; border-radius: 2px; }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
    }
  `],
})
export class StarRating {
  readonly value = model<number>(0);
  readonly editable = input(false);
  readonly label = input('Rating');
  readonly name = input('rating');
}
