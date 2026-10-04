import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { TaskRows } from '../task-rows/task-rows';
import { TenantInboxService } from '../../../core/services/tenant-inbox.service';
import { TenantInboxItem, TenantInboxKind } from '../../../core/models/tenant-inbox.model';

/** A glyph per kind. Never the only signal — every row also says it in words. */
const ICONS: Record<TenantInboxKind, string> = {
  application_accepted: '🎉',
  message_unread: '💬',
  application_shortlisted: '⭐',
  notice_given: '📤',
  lease_ending: '📅',
  rent_unrecorded: '🧾',
  passport_expired: '🪪',
  passport_expiring: '🪪',
};

/**
 * "What needs my attention right now" — the tenant's side, Phase 7d.
 *
 * ── Why it exists
 *
 * Phase 5a built this for the landlord and the brief asks for it in BOTH
 * portals. The tenant dashboard opened instead on a congratulation banner and
 * three bare numbers, so a tenant with an unread message from a landlord, an
 * acceptance waiting on an answer and a month their landlord had not recorded
 * saw none of the three until they went looking on separate screens — and the
 * acceptance is the one where a day of silence can cost somebody the room.
 *
 * ── The order is the API's
 *
 * The rows are unlike each other: an acceptance, an unread message, a lease
 * ending in nine days. Ranking them is a judgement made once, server-side.
 * Two places sorting the same list is two places that can disagree, and the
 * tenant would trust whichever they happened to see first.
 *
 * ── Nothing renders when nothing needs doing
 *
 * No empty "Needs you" panel. A tenant who is on top of everything should see
 * their applications, not a heading with nothing under it: an empty queue that
 * still draws the eye is how people learn to ignore a queue.
 */
@Component({
  selector: 'app-tenant-inbox',
  standalone: true,
  imports: [TaskRows],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length) {
      <section class="dash-section" id="needs-you">
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

        <!-- Shared with the landlord side. The two kinds below count time
             WAITED rather than time remaining, so their day count is negative
             by construction and must not read as an overdue deadline. -->
        <app-task-rows [items]="items()" [icons]="icons"
                       [waitingKinds]="['message_unread', 'application_accepted', 'application_shortlisted']"/>
      </section>
    }
  `,
})
export class TenantInboxPanel implements OnInit {
  private service = inject(TenantInboxService);

  /**
   * The host's to declare — a component cannot know its own depth. Got shipped
   * wrong three times in this codebase before the drives started asserting it.
   */
  readonly headingLevel = input<2 | 3>(2);

  readonly items = signal<TenantInboxItem[]>([]);

  /** Passed to the shared rows; the vocabulary is this role's, the markup is not. */
  readonly icons = ICONS as Record<string, string>;

  ngOnInit() {
    // Silent on failure: this panel sits above a dashboard that works without
    // it, and the HTTP interceptor already reports the error. An inline message
    // here would be the second report of one fault.
    this.service.inbox().subscribe({
      next: (d) => this.items.set(d.items),
      error: () => this.items.set([]),
    });
  }
}
