import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { HintsService } from '../../../core/services/hints.service';

/**
 * The first-use hint for one screen — Phase 8b.
 *
 * Used as:
 *
 *   <app-screen-hint key="landlord-applicants" heading="Everyone who applied">
 *     The ones still waiting on you are first…
 *   </app-screen-hint>
 *
 * ⚠️ `key` must appear in `backend/src/modules/users/screen-hints.ts`, or
 * dismissing it answers 400 and the hint comes back forever.
 * `scripts/hints-drive.mjs` asserts that every key used in a template is on
 * that list, because a hint you cannot put away is worse than no hint at all.
 */
@Component({
  selector: 'app-screen-hint',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hints.shouldShow(key())) {
      <aside class="hint" role="note">
        <div class="hint__body">
          <strong class="hint__heading">{{ heading() }}</strong>
          <p class="hint__text"><ng-content/></p>
        </div>
        <button type="button" class="hint__close" (click)="hints.dismiss(key())"
                [attr.aria-label]="'Got it — hide this tip about ' + heading()">
          Got it
        </button>
      </aside>
    }
  `,
  styles: [`
    .hint {
      display: flex; align-items: flex-start; gap: .75rem; flex-wrap: wrap;
      margin: 0 0 1rem; padding: .85rem .9rem;
      background: #FDF6E8; border: 1.5px solid #E8D9BC; border-left-width: 4px;
      border-radius: 8px;
    }
    .hint__body { flex: 1 1 14rem; min-width: 0; }
    .hint__heading { display: block; font-size: .88rem; margin-bottom: .2rem; }
    .hint__text { margin: 0; font-size: .82rem; line-height: 1.55; color: #4A4034; }
    /* 44px, and a real border: this is the only control on the panel and the
       one people press without reading, so it has to look pressable. */
    .hint__close {
      min-height: 44px; padding: .5rem 1.1rem; flex: 0 0 auto;
      border: 1.5px solid #C9B894; border-radius: 6px; background: #fff;
      font: inherit; font-size: .8rem; font-weight: 700; cursor: pointer;
    }
    /* At 480px the button goes full width under the text rather than being
       squeezed beside it — the breakpoints here are 900/768/480. */
    @media (max-width: 480px) {
      .hint__close { flex: 1 1 100%; }
    }
  `],
})
export class ScreenHint {
  /** Must be one of SCREEN_HINTS on the server. */
  key = input.required<string>();
  heading = input.required<string>();
  protected hints = inject(HintsService);
}
