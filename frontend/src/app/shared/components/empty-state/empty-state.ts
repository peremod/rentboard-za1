import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * "Nothing here yet" — Phase J2.
 *
 * ── Why this is deliberately thin
 *
 * The audit's §G5 says the empty-state COPY in this app is "genuinely better
 * than most". It is, and it is per-screen for a good reason: "No applications
 * yet for this room" and "Your landlord did not record any months for this
 * letting" do different jobs, and a generic "No items" would be a regression.
 * So this component does not take the copy away.
 *
 * What it adds is what a per-screen paragraph could not:
 *
 *   · a place for the ACTION. Several empty states describe a gap and offer
 *     nothing to do about it, which is the difference between a dead end and
 *     a prompt.
 *   · one treatment, so the twentieth screen does not invent a twenty-first
 *     spacing.
 *
 * ⚠️ It is NOT an error, and that distinction is the whole reason both exist.
 * notices, messages and applicants-inbox each used ONE element — named for an
 * empty list — for the empty list AND the failed request. So "we could not
 * reach the server" and "you have nothing" were the same sentence in the same
 * style, and a landlord reading the second when the first was true concludes
 * nobody applied. The two must never be the same element again.
 */
@Component({
  selector: 'app-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="empty">
      <p class="empty__text muted"><ng-content/></p>
      <div class="empty__action"><ng-content select="[slot=action]"/></div>
    </div>
  `,
  styles: [`
    .empty { padding: .75rem 0; }
    .empty__text { margin: 0; line-height: 1.6; max-width: 34rem; }
    .empty__action { margin-top: .75rem; }
    /* Collapses when no action is projected, so an empty state without one
       does not carry a gap it never fills. */
    .empty__action:empty { display: none; margin-top: 0; }
  `],
})
export class EmptyState {}
