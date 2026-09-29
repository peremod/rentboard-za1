import {
  ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal,
} from '@angular/core';
import { LandlordNotesService } from '../../../core/services/landlord-notes.service';
import { CalendarEntry, CalendarKind } from '../../../core/models/landlord-note.model';

const ICONS: Record<CalendarKind, string> = {
  rent_due: '🧾',
  lease_ends: '📅',
  notice_expires: '📤',
  room_free: '🔑',
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** One month's worth, headed by the month's name. */
interface MonthGroup {
  key: string;
  label: string;
  entries: CalendarEntry[];
}

/**
 * What is coming up, by month — Phase 5f.
 *
 * ── Dates are parsed by SPLITTING THE STRING
 *
 * Not with `new Date('2026-10-01')`. That parses as UTC midnight and then renders
 * in local time, so a landlord east of Greenwich can see the 30th of September for
 * a date that is the 1st of October. The API deliberately sends plain
 * YYYY-MM-DD for exactly this reason, and undoing that by handing it to the Date
 * constructor is how the off-by-one-day calendar gets reintroduced.
 *
 * ── Grouped by month, not a grid
 *
 * A month grid is mostly empty squares for a landlord with three tenancies, and
 * it is unreadable on a phone. A list under month headings is the same
 * information in the shape people actually read it, and matches the plain-English
 * pattern the rest of the portal uses.
 *
 * ── No .ics export
 *
 * A subscribable feed is a URL that answers with no session, because Google
 * Calendar fetches it server-side. That means a long-lived capability token in a
 * URL exposing tenancy dates and tenant names to anyone the link reaches — and
 * calendar URLs get pasted into shared calendars routinely. See the controller.
 */
@Component({
  selector: 'app-landlord-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (groups().length) {
      <section class="dash-section" id="calendar">
        @if (headingLevel() === 2) {
          <h2 class="dash-section-title">What is coming up</h2>
        } @else {
          <h3 class="dash-section-title">What is coming up</h3>
        }

        @for (g of groups(); track g.key) {
          <div class="cal-month">
            <!-- A month heading is one level below this section's own, whatever
                 that turned out to be — so the order holds either way. -->
            @if (headingLevel() === 2) {
              <h3 class="cal-month__title">{{ g.label }}</h3>
            } @else {
              <h4 class="cal-month__title">{{ g.label }}</h4>
            }
            <ul class="cal-list">
              @for (e of g.entries; track e.kind + e.date + (e.tenancyId ?? '')) {
                <li class="cal-row">
                  <span class="cal-day" aria-hidden="true">{{ dayOf(e.date) }}</span>
                  <span class="cal-icon" aria-hidden="true">{{ icon(e.kind) }}</span>
                  <span class="cal-body">
                    <!-- The full date is in the text for a screen reader, since
                         the big day number beside it is decorative. -->
                    <span class="cal-title">{{ e.title }}</span>
                    <span class="cal-meta muted">
                      {{ longDate(e.date) }}@if (e.roomTitle) { · {{ e.roomTitle }} }
                    </span>
                    @if (e.detail) { <span class="cal-detail muted">{{ e.detail }}</span> }
                  </span>
                </li>
              }
            </ul>
          </div>
        }
      </section>
    }
  `,
  styles: [
    `
      .cal-month { margin-bottom: 1rem; }
      .cal-month__title { font-size: 0.9rem; margin: 0 0 0.3rem; opacity: 0.8; }
      .cal-list { list-style: none; margin: 0; padding: 0; }
      .cal-row {
        align-items: baseline;
        border-bottom: 1px solid var(--line);
        display: flex;
        gap: 0.6rem;
        padding: 0.5rem 0;
      }
      .cal-row:last-child { border-bottom: 0; }
      .cal-day { flex: 0 0 1.6rem; font-variant-numeric: tabular-nums; font-weight: 600; text-align: right; }
      .cal-icon { flex: 0 0 auto; }
      .cal-body { display: flex; flex-direction: column; gap: 0.05rem; min-width: 0; }
      .cal-title { font-weight: 600; }
      .cal-meta, .cal-detail { font-size: 0.8rem; }
    `,
  ],
})
export class LandlordCalendar implements OnInit {
  private service = inject(LandlordNotesService);

  /** The host's to declare — a component cannot know its own depth. */
  readonly headingLevel = input<2 | 3>(2);

  readonly entries = signal<CalendarEntry[]>([]);

  /**
   * Grouped by year-month, preserving the API's date order.
   *
   * The API already sorted, so this walks in order and never re-sorts — two
   * places ordering the same list is two places that can disagree.
   */
  readonly groups = computed<MonthGroup[]>(() => {
    const out: MonthGroup[] = [];
    for (const e of this.entries()) {
      const [y, m] = e.date.split('-');
      const key = `${y}-${m}`;
      const last = out[out.length - 1];
      if (last?.key === key) last.entries.push(e);
      else out.push({ key, label: `${MONTHS[Number(m) - 1]} ${y}`, entries: [e] });
    }
    return out;
  });

  ngOnInit() {
    this.service.calendar().subscribe({
      next: (e) => this.entries.set(e),
      error: () => this.entries.set([]),
    });
  }

  icon(kind: CalendarKind) { return ICONS[kind]; }

  /** From the STRING. `new Date(...)` here is the off-by-one-day bug. */
  dayOf(date: string) { return Number(date.split('-')[2]); }

  longDate(date: string) {
    const [y, m, d] = date.split('-');
    return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
  }
}
