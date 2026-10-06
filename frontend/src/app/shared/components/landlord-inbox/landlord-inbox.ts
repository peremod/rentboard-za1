import {
  ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, effect,
  inject, input, signal, viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
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
    <!-- ⚠️ The second condition is the fix for a DEAD NAV TAB.
         The panel renders nothing when nothing needs doing, which is right on
         a dashboard and was wrong for the sidebar: landlordNav has a
         "Needs you" item pointing at this section by fragment, so for every
         landlord who was on top of everything the tab pointed at an element
         that did not exist. Clicking it set the fragment, scrolled nowhere and
         left a screen identical to the one before — measured: hasAnchor false,
         scrollY 0 before and after. Reported as "the needs you page looks
         exactly the same as the dashboard page, nothing happens when I click
         the needs you tab", and it is the same fault as the nav items this
         file's own comments describe: a destination that does not exist.
         So: still nothing on an ordinary dashboard visit, and an answer when
         somebody has actually asked. -->
    @if (items().length || answerEmpty()) {
      <section class="dash-section" id="needs-attention" #needsAttention>
        @if (headingLevel() === 2) {
          <h2 class="dash-section-title">
            Needs you
            @if (items().length) { <span class="dash-count">{{ items().length }}</span> }
          </h2>
        } @else {
          <h3 class="dash-section-title">
            Needs you
            @if (items().length) { <span class="dash-count">{{ items().length }}</span> }
          </h3>
        }

        @if (items().length) {
          <!-- The rows themselves are shared with the tenant side — Phase 7d.
               See TaskRows for why there is one copy of this markup and not two.
               The application_waiting kind counts days WAITED, which is negative
               by construction, so it must not read as overdue. -->
          <app-task-rows [items]="items()" [icons]="icons"
                         [waitingKinds]="['application_waiting']"/>
        } @else {
          <p class="muted">
            Nothing is waiting on you right now. Applications you have not
            answered, a tenant disputing your rent record, a lease ending and a
            notice given all appear here.
          </p>
        }
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

  /** False until the request has come back, so the empty state cannot flash. */
  private readonly loaded = signal(false);

  private readonly route = inject(ActivatedRoute);
  /** The URL fragment, which is how the sidebar asks for this section. */
  private readonly fragment = toSignal(this.route.fragment, { initialValue: null });

  /**
   * Render the section although there is nothing in it.
   *
   * Only when the fragment names it — that is the difference between a
   * dashboard visit, where an empty queue should not draw the eye, and a
   * person who has just pressed "Needs you" and is owed an answer.
   */
  readonly answerEmpty = computed(
    () => this.loaded() && this.items().length === 0 && this.fragment() === 'needs-attention',
  );

  private readonly needsAttention = viewChild<ElementRef<HTMLElement>>('needsAttention');

  constructor() {
    // ⚠️ Scrolled here rather than left to the router's anchorScrolling.
    //
    // withInMemoryScrolling({ anchorScrolling: 'enabled' }) looks for the
    // element once, when the navigation ends. This section does not exist
    // then: it appears after the inbox request comes back. So on the FIRST
    // arrival at /landlord/dashboard#needs-attention the router finds nothing
    // and the page stays where it was — the same silent nothing, one step
    // later. Doing it here means the scroll happens when the element does.
    effect(() => {
      if (this.fragment() !== 'needs-attention') return;
      const el = this.needsAttention()?.nativeElement;
      if (el) el.scrollIntoView({ block: 'start' });
    });
  }

  ngOnInit() {
    // Silent on failure, both of them: this panel sits above a dashboard that
    // works without it, and the HTTP interceptor already reports the error. An
    // inline message here would be the second report of one fault — the defect
    // the services screen shipped with.
    this.service.inbox().subscribe({
      next: (d: LandlordInbox) => { this.items.set(d.items); this.loaded.set(true); },
      // `loaded` is set on failure too. Without it a landlord whose inbox
      // request failed got the dead tab back — the one case where the screen
      // genuinely cannot say what is waiting is the one where saying nothing
      // is worst.
      error: () => { this.items.set([]); this.loaded.set(true); },
    });
    this.service.health().subscribe({
      next: (h) => this.health.set(h),
      error: () => this.health.set(null),
    });
  }

  /** Passed to the shared rows; the vocabulary is this role's, the markup is not. */
  readonly icons = ICONS as Record<string, string>;
}
