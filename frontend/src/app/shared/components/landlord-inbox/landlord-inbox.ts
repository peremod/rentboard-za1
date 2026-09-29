import {
  ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
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
  imports: [RouterLink],
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

        <ul class="inbox-list">
          @for (item of items(); track item.kind + item.entityId) {
            <li class="inbox-row" [class.inbox-row--urgent]="isOverdue(item)">
              <span class="inbox-icon" aria-hidden="true">{{ icon(item.kind) }}</span>
              <span class="inbox-body">
                <span class="inbox-title">{{ item.title }}</span>
                @if (item.roomTitle) {
                  <span class="inbox-meta">{{ item.roomTitle }}</span>
                }
                @if (item.detail) {
                  <span class="inbox-detail">{{ item.detail }}</span>
                }
              </span>
              <!-- aria-label, because "Mark it" repeated down a list tells a
                   screen-reader user nothing about WHICH one. The visible label
                   stays short; the accessible name carries the context. -->
              <a class="btn btn-sm btn-outline inbox-action"
                 [routerLink]="pathOf(item)"
                 [fragment]="fragmentOf(item)"
                 [attr.aria-label]="item.actionLabel + ': ' + item.title">
                {{ item.actionLabel }}
              </a>
            </li>
          }
        </ul>
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
      .inbox-list { list-style: none; margin: 0; padding: 0; }
      .inbox-row {
        align-items: flex-start;
        border-bottom: 1px solid var(--line);
        display: flex;
        gap: 0.7rem;
        padding: 0.7rem 0;
      }
      .inbox-row:last-child { border-bottom: 0; }
      /* A left edge, not colour alone — the same information is in the text. */
      .inbox-row--urgent { border-left: 3px solid var(--warn, #B4541F); padding-left: 0.6rem; }
      .inbox-icon { flex: 0 0 auto; font-size: 1.05rem; line-height: 1.5; }
      .inbox-body { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; flex: 1 1 auto; }
      .inbox-title { font-weight: 600; }
      .inbox-meta, .inbox-detail { font-size: 0.85rem; opacity: 0.8; }
      .inbox-action { flex: 0 0 auto; white-space: nowrap; }
      .health-summary { line-height: 1.7; margin: 0; }
      .health-note { font-size: 0.85rem; margin-top: 0.4rem; }

      /* On a phone the action wraps under the text rather than squeezing the
         sentence into two words a line. */
      @media (max-width: 30rem) {
        .inbox-row { flex-wrap: wrap; }
        .inbox-action { margin-left: 1.75rem; }
      }
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

  icon(kind: InboxKind) { return ICONS[kind]; }

  /** Already past, so the row earns an edge. Null days are never overdue. */
  isOverdue(item: InboxItem) {
    return item.kind !== 'application_waiting' && item.daysUntil !== null && item.daysUntil < 0;
  }

  /** The path without its fragment — routerLink and fragment are separate inputs. */
  pathOf(item: InboxItem) { return item.actionPath.split('#')[0]; }

  /** The fragment, or undefined. Lands the landlord on the section, not the page top. */
  fragmentOf(item: InboxItem): string | undefined {
    const [, fragment] = item.actionPath.split('#');
    return fragment || undefined;
  }
}
