import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * One row of a "needs you" list: unlike things, ranked by the API.
 *
 * Both portals' task inboxes emit this shape. It is deliberately the same
 * interface on both sides — see TaskRows for why there is only one component.
 */
export interface TaskRow {
  kind: string;
  title: string;
  detail: string | null;
  entityId: string;
  roomTitle: string | null;
  daysUntil: number | null;
  actionLabel: string;
  /** A full in-app path, fragment included. Split here, not by the caller. */
  actionPath: string;
}

/**
 * The rows of a task inbox, for either portal — Phase 7d.
 *
 * ── Why this was extracted
 *
 * Phase 5a built this markup for the landlord. Phase 7d asks for the same list
 * on the tenant side, and the honest options were one component or two copies.
 * This codebase has already paid for the second choice twice over: the portal
 * nav was defined six times and the copies disagreed until a landlord's sidebar
 * shrank as they walked through their own portal, and the shared-living fields
 * were held in two places. The row markup carries four decisions that must not
 * drift — the accessible name, the overdue edge, splitting the fragment off the
 * path, and how the action wraps on a phone — so it lives once.
 *
 * ── What stays with the caller
 *
 * The heading, the count, the icon vocabulary and the decision not to render at
 * all when there is nothing to do. Those differ by role and by screen, and a
 * component that guessed them would be a component each caller has to fight.
 */
@Component({
  selector: 'app-task-rows',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="inbox-list">
      @for (item of items(); track item.kind + item.entityId) {
        <li class="inbox-row" [class.inbox-row--urgent]="isOverdue(item)">
          <span class="inbox-icon" aria-hidden="true">{{ icons()[item.kind] ?? '•' }}</span>
          <span class="inbox-body">
            <span class="inbox-title">{{ item.title }}</span>
            @if (item.roomTitle) {
              <span class="inbox-meta">{{ item.roomTitle }}</span>
            }
            @if (item.detail) {
              <span class="inbox-detail">{{ item.detail }}</span>
            }
          </span>
          <!-- aria-label, because "Read it" repeated down a list tells a
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

      /* On a phone the action wraps under the text rather than squeezing the
         sentence into two words a line. */
      @media (max-width: 30rem) {
        .inbox-row { flex-wrap: wrap; }
        .inbox-action { margin-left: 1.75rem; }
      }
    `,
  ],
})
export class TaskRows {
  readonly items = input.required<TaskRow[]>();

  /**
   * A glyph per kind. Never the only signal — every row says it in words too.
   *
   * The value type admits undefined so the fallback below is not flagged as
   * dead: without it Angular's NG8102 says the ?? can be removed, which is only
   * true because a Record's index signature lies about missing keys.
   */
  readonly icons = input<Record<string, string | undefined>>({});

  /**
   * Kinds whose `daysUntil` counts time WAITED rather than time remaining.
   *
   * Those are negative by construction, so treating them as overdue would put
   * an urgent edge on every one of them and the edge would mean nothing. Named
   * by the caller because only the caller knows its own vocabulary.
   */
  readonly waitingKinds = input<string[]>([]);

  /** Already past, so the row earns an edge. Null days are never overdue. */
  isOverdue(item: TaskRow) {
    return !this.waitingKinds().includes(item.kind)
      && item.daysUntil !== null
      && item.daysUntil < 0;
  }

  /** The path without its fragment — routerLink and fragment are separate inputs. */
  pathOf(item: TaskRow) { return item.actionPath.split('#')[0]; }

  /** The fragment, or undefined. Lands the person on the section, not the page top. */
  fragmentOf(item: TaskRow): string | undefined {
    const [, fragment] = item.actionPath.split('#');
    return fragment || undefined;
  }
}
