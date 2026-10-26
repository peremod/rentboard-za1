import {
  ChangeDetectionStrategy, Component, ElementRef, OnInit, effect, inject, signal, viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  ApplicationsService, UpcomingViewing, ViewingOutcome,
} from '../../../core/services/applications.service';
import { Icon } from '../icon/icon';

/**
 * Viewings a tenant has been invited to — Phase 7l, brief item 26.
 *
 * ── Why this is its own panel and not a row in the task inbox
 *
 * It is the only thing on the tenant's dashboard with a PLACE and a TIME on it
 * — somewhere they have to physically be, on a day. The task inbox is a list of
 * things to answer; this is a list of things to attend, and burying "Saturday
 * 16:00, the blue gate in Tembisa" among "three applications awaiting reply"
 * is how somebody misses it.
 *
 * ── It renders nothing when there is nothing
 *
 * The same rule as the task inbox: a tenant with no viewings is not shown an
 * empty queue.
 *
 * ── The safety line is on the screen as well as in the notice
 *
 * The notice carries it at the moment of invitation; this carries it where
 * somebody looks the night before. This product's own report reasons include
 * `upfront_payment_demanded`, so the risk is known to the codebase, and a
 * warning on a legal page nobody opens is not a warning.
 */
@Component({
  selector: 'app-viewing-invitations',
  standalone: true,
  imports: [Icon, DatePipe, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (viewings().length) {
      <!-- id="viewings" - the tenant inbox has pointed at this anchor since
           Phase 8n and it DID NOT EXIST. The elapsed-viewing row's action is
           /tenant/dashboard#viewings, and the only ids on that page were
           needs-you, your-applications, room-alerts, your-sublets and
           saved-rooms. So "Say what happened" navigated to a fragment with no
           target and the page did not move: measured at 390px as
           scrollY 0 -> 0, with #viewings exists false. Reported from a phone
           as "the button does nothing", which is exactly what it did. -->
      <section class="dash-section vi-section" id="viewings" #viewingsSection>
        <h2 class="dash-section-title">Viewings</h2>

        @for (v of viewings(); track v.id) {
          <div class="vi" [class.vi--answered]="v.status === 'accepted'">
            <div class="vi__when">
              <strong>{{ v.startsAt | date: 'EEEE d MMMM' }}</strong>
              <span class="vi__time">{{ v.startsAt | date: 'HH:mm' }}</span>
            </div>

            <div class="vi__what">
              <a [routerLink]="['/rooms', v.application.room.id]">{{ v.application.room.title }}</a>
              <span class="muted">{{ v.application.room.locationDisplay }}</span>
              <!-- Where to meet, in the landlord's words. This is the one place
                   an address is deliberately shared, with this one person. -->
              <span class="vi__place"><app-icon name="map-pin"/> {{ v.meetingPlace }}</span>
              @if (v.note) { <span class="muted">{{ v.note }}</span> }
            </div>

            <div class="vi__answer">
              @if (v.status === 'proposed') {
                @if (decliningId() === v.id) {
                  <label class="vi__reason">
                    <span class="muted">Why not? (optional)</span>
                    <input type="text" [(ngModel)]="declineReason" name="declineReason"
                           placeholder="I am working that afternoon"/>
                  </label>
                  <button type="button" class="btn btn-sm btn-outline"
                          [disabled]="busy() === v.id" (click)="answer(v, false)">
                    Send
                  </button>
                  <button type="button" class="link-btn" (click)="decliningId.set(null)">Back</button>
                } @else {
                  <button type="button" class="btn btn-sm btn-primary"
                          [disabled]="busy() === v.id" (click)="answer(v, true)">
                    {{ busy() === v.id ? 'Saving…' : 'I can come' }}
                  </button>
                  <button type="button" class="link-btn" [disabled]="busy() === v.id"
                          (click)="decliningId.set(v.id)">I cannot make it</button>
                }
              } @else if (elapsed(v)) {
                <!-- ── The day came and went — Phase 8n ──────────────────
                     This branch is why forTenant() carries elapsed accepted
                     viewings at all. Before it the panel said "✅ You said you
                     are coming" about a Saturday three weeks gone, and neither
                     side was ever asked what became of it. -->
                <div class="vi__gone">
                  <strong class="vi__gone-title">⏰ That time has been and gone</strong>
                  <span class="muted">
                    It was set for {{ v.startsAt | date: 'EEEE d MMMM, HH:mm' }}. What happened?
                  </span>

                  @if (chosen(v); as o) {
                    <label class="vi__reason">
                      <span class="muted">Anything to add? (optional)</span>
                      <input type="text" [(ngModel)]="outcomeNote" name="outcomeNote"
                             placeholder="We met on the Sunday instead"/>
                    </label>
                    <!-- ⚠️ Said before it is saved, not after. Two of the five
                         answers end the application, and somebody tapping
                         through a list of plain-looking choices is owed the
                         consequence at the moment they choose. -->
                    @if (o.closes) {
                      <p class="vi__closing" role="status">
                        This closes your application for this room, and the landlord is told.
                      </p>
                    }
                    <div class="vi__answer">
                      <button type="button" class="btn btn-sm btn-primary"
                              [disabled]="busy() === v.id" (click)="saveOutcome(v)">
                        {{ busy() === v.id ? 'Saving…' : (o.closes ? 'Save and close it' : 'Save') }}
                      </button>
                      <button type="button" class="link-btn" (click)="pick(v, null)">Back</button>
                    </div>
                  } @else {
                    <div class="vi__outcomes">
                      @for (o of outcomes; track o.value) {
                        <button type="button" class="vi__outcome" (click)="pick(v, o.value)">
                          <app-icon [name]="o.icon"/> {{ o.label }}
                        </button>
                      }
                    </div>
                    <!-- The reschedule option. A tenant cannot invite
                         themselves — only a landlord can set a time — so the
                         honest affordance is the thread where they can ask,
                         not a form that would have nowhere to post. -->
                    <a class="link-btn" [routerLink]="['/account/messages']">
                      Ask the landlord for another time
                    </a>
                  }
                </div>
              } @else {
                <span class="vi__going"><app-icon name="check-circle"/> You said you are coming</span>
                <button type="button" class="link-btn" [disabled]="busy() === v.id"
                        (click)="callOff(v)">Call it off</button>
              }
            </div>
          </div>
        }

        @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }

        <!-- ⚠️ The link goes to the ROOM, because that is where reporting
             actually lives: it is a dialog on the room page, not a route. The
             first version linked /report, which does not exist — caught by
             nav-audit.mjs, which is the gate that exists because this codebase
             shipped dead links the eye slides over. -->
        <p class="vi__safety">
          Tell somebody where you are going and when you expect to be back.
          <strong>Never pay anything — no deposit, no key money, no "holding
          fee" — before you have seen the room</strong> and you are happy with
          it. If anyone asks you to, open
          <a [routerLink]="['/rooms', viewings()[0].application.room.id]">the
          room's page</a> and report it.
        </p>
      </section>
    }
  `,
  styles: `
    /* WARNING: the padding is half the rule, and it was missing.

       .dash-section carries no padding of its own, so a bare border-left put a
       terracotta line hard against the heading, the time, the room name, the
       address and all five outcome buttons - on the one screen somebody reads
       standing outside a stranger's gate. .9rem is what the .hint aside beside
       it uses with its own 4px rule, so the two read as the same device rather
       than two accidents.

       Two of this file's own traps in one edit, both listed in CLAUDE.md and
       both hit anyway: an emoji in a CSS comment, which fails esbuild's CSS
       parser, and a backtick quoting a class name, which ENDS this template
       literal - the build said "Failed to resolve @Component.styles" both
       times and named nothing. scripts/template-literal-lint.mjs named the
       second in one line. Run it before the build, not after. */
    .vi-section { border-left: 3px solid var(--terra); padding-left: .9rem; }
    .vi {
      display: grid; gap: .5rem; padding: .8rem 0;
      border-bottom: 1px solid var(--border);
      grid-template-columns: 1fr;
    }
    .vi:last-of-type { border-bottom: none; }
    .vi__when { display: flex; align-items: baseline; gap: .5rem; }
    .vi__time { font-size: 1.05rem; font-weight: 700; color: var(--terra); }
    .vi__what { display: grid; gap: .15rem; font-size: .85rem; line-height: 1.6; }
    /* The room's name is the link out of this card, and it was a 22px line.
       justify-self:start so the inline-flex box is the width of the words
       rather than the whole grid column. */
    .vi__what a { display: inline-flex; align-items: center; min-height: 28px; justify-self: start; }
    .vi__place { font-weight: 600; }
    .vi__answer { display: flex; flex-wrap: wrap; align-items: center; gap: .9rem; }
    .vi__going { font-size: .85rem; font-weight: 600; color: var(--sage); }
    .vi__reason { display: grid; gap: .2rem; font-size: .8rem; flex: 1 1 14rem; }
    .vi__reason input {
      font: inherit; padding: .55rem .6rem; min-height: 44px;
      border: 1.5px solid var(--border); border-radius: var(--r4);
    }
    .vi__gone { display: grid; gap: .5rem; }
    .vi__gone-title { font-size: .9rem; color: var(--terra); }
    .vi__outcomes { display: flex; flex-wrap: wrap; gap: .5rem; }
    .vi__outcome {
      font: inherit; font-size: .8rem; text-align: left;
      /* 44px, WCAG 2.5.8. These are the only controls on the dashboard a
         person taps while standing outside somebody's gate. */
      min-height: 44px; padding: .5rem .75rem;
      /* min-width:0 because a flex item defaults to its content width and
         these labels are sentences — without it they push the card wider
         than a 360px screen. */
      min-width: 0; max-width: 100%; white-space: normal; line-height: 1.3;
      background: var(--white); color: var(--ink);
      border: 1.5px solid var(--border); border-radius: var(--r4);
      cursor: pointer;
    }
    .vi__outcome:hover { border-color: var(--terra); }
    .vi__closing {
      font-size: .8rem; line-height: 1.6; margin: 0;
      padding: .5rem .75rem; border-radius: var(--r4);
      background: rgba(214, 59, 59, .07); font-weight: 600;
    }
    .vi__safety {
      font-size: .8rem; line-height: 1.7; max-width: 42rem;
      margin: .9rem 0 0; padding: .6rem .8rem;
      background: rgba(214, 59, 59, .05); border-radius: var(--r4);
    }
    /* Two columns once there is room, so the time and the place sit side by
       side rather than the time floating above a wide empty row. */
    @media (min-width: 640px) {
      .vi { grid-template-columns: 9rem 1fr; align-items: start; }
      .vi__answer { grid-column: 1 / -1; }
    }
  `,
})
export class ViewingInvitations implements OnInit {
  private applications = inject(ApplicationsService);

  /**
   * ⚠️ Scrolled here rather than left to the router's anchorScrolling — the
   * same remedy, and for the same reason, as the landlord inbox's
   * `#needs-attention`.
   *
   * `withInMemoryScrolling({ anchorScrolling: 'enabled' })` looks for the
   * element ONCE, when the navigation ends. This section does not exist then:
   * it is behind `@if (viewings().length)` and appears only after the
   * viewings request comes back. So giving the section an id fixes half of
   * it — the router would still find nothing on the first arrival and the
   * page would stay where it was, which is the same silent nothing one step
   * later. Doing it here means the scroll happens when the element does.
   */
  private readonly fragment = toSignal(inject(ActivatedRoute).fragment);
  private readonly viewingsSection = viewChild<ElementRef<HTMLElement>>('viewingsSection');

  constructor() {
    effect(() => {
      if (this.fragment() !== 'viewings') return;
      const el = this.viewingsSection()?.nativeElement;
      if (el) el.scrollIntoView({ block: 'start' });
    });
  }

  readonly viewings = signal<UpcomingViewing[]>([]);
  readonly busy = signal<string | null>(null);
  readonly decliningId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  declineReason = '';

  // ── A viewing whose time has passed — Phase 8n ───────────────────
  /** viewingId → the answer being given, before it is saved. */
  readonly outcomeChoice = signal<Record<string, ViewingOutcome>>({});
  outcomeNote = '';

  /**
   * The five answers, in the tenant's words.
   *
   * ⚠️ Worded from THIS side. The same five values read differently from the
   * landlord's screen ("they did not come" / "I could not go" is one outcome
   * told from two ends), which is why the labels live per panel and only the
   * values are shared.
   */
  readonly outcomes: ReadonlyArray<{ value: ViewingOutcome; icon: string; label: string; closes: boolean }> = [
    { value: 'happened', icon: 'check-circle', label: 'I went and saw it', closes: false },
    { value: 'rearranged_privately', icon: 'clock', label: 'We met at a different time', closes: false },
    { value: 'no_answer', icon: 'x', label: 'It did not happen', closes: false },
    { value: 'fell_through_other_room', icon: 'door', label: 'I have taken another room', closes: true },
    { value: 'fell_through_other_tenant', icon: 'lock', label: 'The room went to somebody else', closes: true },
  ];

  /**
   * The agreed time is in the past and nobody has said what happened.
   *
   * ⚠️ Derived, never stored: "has passed" is a fact about the clock, and a
   * column holding it would need a job to keep it true — the same reason
   * Phase G derives an elapsed notice period rather than writing a flag.
   */
  elapsed(v: UpcomingViewing): boolean {
    return v.status === 'accepted' && !v.outcome && new Date(v.startsAt).getTime() < Date.now();
  }

  chosen(v: UpcomingViewing) {
    const value = this.outcomeChoice()[v.id];
    return this.outcomes.find((o) => o.value === value) ?? null;
  }

  pick(v: UpcomingViewing, value: ViewingOutcome | null) {
    this.outcomeNote = '';
    this.error.set(null);
    this.outcomeChoice.update((m) => {
      const next = { ...m };
      if (value) next[v.id] = value; else delete next[v.id];
      return next;
    });
  }

  saveOutcome(v: UpcomingViewing) {
    const choice = this.chosen(v);
    if (!choice) return;
    this.busy.set(v.id);
    this.error.set(null);
    this.applications.recordViewingOutcome(v.id, choice.value, this.outcomeNote.trim() || undefined)
      .subscribe({
        next: () => {
          this.busy.set(null);
          this.pick(v, null);
          // Reload rather than patch: an answered viewing drops out of the
          // list server-side, and a closing answer changes the application
          // underneath it too.
          this.load();
        },
        error: (err) => {
          this.busy.set(null);
          this.error.set(err?.error?.message ?? 'That did not save. Try again.');
        },
      });
  }

  ngOnInit() {
    this.load();
  }

  private load() {
    this.applications.myViewings().subscribe({
      next: (list) => this.viewings.set(list),
      // Silent: this panel renders nothing when it has nothing, and a tenant
      // whose dashboard loaded should not be shown a failure about a section
      // they may have no viewings in anyway.
      error: () => this.viewings.set([]),
    });
  }

  answer(v: UpcomingViewing, accept: boolean) {
    this.busy.set(v.id);
    this.error.set(null);
    this.applications.respondToViewing(v.id, accept, accept ? undefined : this.declineReason.trim() || undefined)
      .subscribe({
        next: () => {
          this.busy.set(null);
          this.decliningId.set(null);
          this.declineReason = '';
          // Reload rather than patch: declining removes it from the upcoming
          // list server-side, and a local patch would leave a row the server
          // no longer considers live.
          this.load();
        },
        error: (err) => {
          this.busy.set(null);
          this.error.set(err?.error?.message ?? 'That did not save. Try again.');
        },
      });
  }

  callOff(v: UpcomingViewing) {
    this.busy.set(v.id);
    this.error.set(null);
    this.applications.cancelViewing(v.id).subscribe({
      next: () => { this.busy.set(null); this.load(); },
      error: (err) => {
        this.busy.set(null);
        this.error.set(err?.error?.message ?? 'Could not call that off. Try again.');
      },
    });
  }
}
