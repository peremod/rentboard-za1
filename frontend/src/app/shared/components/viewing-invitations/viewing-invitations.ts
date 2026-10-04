import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApplicationsService, UpcomingViewing } from '../../../core/services/applications.service';

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
  imports: [DatePipe, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (viewings().length) {
      <section class="dash-section vi-section">
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
              <span class="vi__place">📍 {{ v.meetingPlace }}</span>
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
              } @else {
                <span class="vi__going">✅ You said you are coming</span>
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
    .vi-section { border-left: 3px solid var(--terra); }
    .vi {
      display: grid; gap: .5rem; padding: .8rem 0;
      border-bottom: 1px solid var(--border);
      grid-template-columns: 1fr;
    }
    .vi:last-of-type { border-bottom: none; }
    .vi__when { display: flex; align-items: baseline; gap: .5rem; }
    .vi__time { font-size: 1.05rem; font-weight: 700; color: var(--terra); }
    .vi__what { display: grid; gap: .15rem; font-size: .85rem; line-height: 1.6; }
    .vi__place { font-weight: 600; }
    .vi__answer { display: flex; flex-wrap: wrap; align-items: center; gap: .9rem; }
    .vi__going { font-size: .85rem; font-weight: 600; color: var(--sage); }
    .vi__reason { display: grid; gap: .2rem; font-size: .8rem; flex: 1 1 14rem; }
    .vi__reason input {
      font: inherit; padding: .55rem .6rem; min-height: 44px;
      border: 1.5px solid var(--border); border-radius: var(--r4, 4px);
    }
    .vi__safety {
      font-size: .8rem; line-height: 1.7; max-width: 42rem;
      margin: .9rem 0 0; padding: .6rem .8rem;
      background: rgba(214, 59, 59, .05); border-radius: var(--r4, 4px);
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

  readonly viewings = signal<UpcomingViewing[]>([]);
  readonly busy = signal<string | null>(null);
  readonly decliningId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  declineReason = '';

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
