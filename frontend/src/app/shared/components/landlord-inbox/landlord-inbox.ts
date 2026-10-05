import {
  ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal,
} from '@angular/core';
import { TaskRows } from '../task-rows/task-rows';
import { LandlordInboxService } from '../../../core/services/landlord-inbox.service';
import {
  InboxItem, InboxKind, LandlordHealth, LandlordInbox,
} from '../../../core/models/landlord-inbox.model';

/** A glyph per kind. Never the only signal — every row also says it in words. */
const ICONS: Record<InboxKind, string> = {
  rent_disputed: '✋',
  notice_given: '📤',
  lease_ending: '📅',
  application_waiting: '👤',
  rent_unmarked: '🧾',
  unread_message: '💬',
};

/**
 * "What needs my attention right now" — Phase 5a, with 5d underneath it.
 *
 * ── One list, in the order the API gave it
 *
 * The rows are unlike each other: an applicant waiting nine days, a lease ending
 * in ten, a tenant saying your rent record is wrong. Ranking those against each
 * other is a judgement, and it is made once, server-side. This component does
 * not re-sort, because two places sorting the same list is two places that can
 * disagree — and the landlord would trust whichever they happened to see first.
 *
 * ── Every row is actionable, not a link to go hunting
 *
 * The brief is explicit that an item must be actionable "not just links". Each
 * row carries its own destination from the API, so a new kind needs no change
 * here. Where the destination is a section of another screen it carries the
 * fragment too, so the landlord lands on the thing rather than at the top of a
 * long page.
 *
 * ── Nothing renders when nothing needs doing
 *
 * No empty "Needs attention" panel. A landlord who is on top of everything
 * should see the health paragraph and their rooms, not a heading with nothing
 * under it — an empty queue that still draws the eye is how people learn to
 * ignore a queue.
 */
@Component({
  selector: 'app-landlord-inbox',
  standalone: true,
  imports: [TaskRows],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length) {
      <section class="dash-section" id="needs-attention">
        @if (headingLevel() === 2) {
          <h2 class="dash-section-title">
            Needs you
            <span class="dash-count">{{ items().length }}</span>
          </h2>
        } @else {
          <h3 class="dash-section-title">
            Needs you
            <span class="dash-count">{{ items().length }}</span>
          </h3>
        }

        <!-- The rows themselves are shared with the tenant side — Phase 7d.
             See TaskRows for why there is one copy of this markup and not two.
             The application_waiting kind counts days WAITED, which is negative
             by construction, so it must not read as overdue. -->
        <app-task-rows [items]="items()" [icons]="icons"
                       [waitingKinds]="['application_waiting']"/>
      </section>
    }

    @if (health(); as h) {
      <section class="dash-section" id="portfolio-health">
        @if (headingLevel() === 2) {
          <h2 class="dash-section-title">How it is going</h2>
        } @else {
          <h3 class="dash-section-title">How it is going</h3>
        }
        <!-- A paragraph, not a row of gauges. Built server-side beside the
             numbers it describes, because the wording changes with the data and
             a figure with nothing behind it is reported as absent rather than
             rounded into a percentage. -->
        <p class="health-summary">{{ h.summary }}</p>
        @if (h.daysToFillFrom === 0 && h.rooms.live > 0) {
          <p class="muted health-note">
            Once a room is let, this will also say how long rooms take to fill.
          </p>
        }
      </section>
    }
  `,
  styles: [
    `
      .health-summary { line-height: 1.7; margin: 0; }
      .health-note { font-size: 0.85rem; margin-top: 0.4rem; }
    `,
  ],
})
export class LandlordInboxPanel implements OnInit {
  private service = inject(LandlordInboxService);

  /**
   * The host's to declare — a component cannot know its own depth. Shipped wrong
   * twice in this codebase (the survey card and the ad slot both hardcoded a
   * level) and once more on the lease-documents panel, which the drive caught.
   */
  readonly headingLevel = input<2 | 3>(2);

  readonly items = signal<InboxItem[]>([]);
  readonly health = signal<LandlordHealth | null>(null);

  ngOnInit() {
    // Silent on failure, both of them: this panel sits above a dashboard that
    // works without it, and the HTTP interceptor already reports the error. An
    // inline message here would be the second report of one fault — the defect
    // the services screen shipped with.
    this.service.inbox().subscribe({
      next: (d: LandlordInbox) => this.items.set(d.items),
      error: () => this.items.set([]),
    });
    this.service.health().subscribe({
      next: (h) => this.health.set(h),
      error: () => this.health.set(null),
    });
  }

  /** Passed to the shared rows; the vocabulary is this role's, the markup is not. */
  readonly icons = ICONS as Record<string, string>;
}
