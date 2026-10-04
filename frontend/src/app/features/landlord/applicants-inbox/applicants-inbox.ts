import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PortalShell, PortalNavItem } from '../../../shared/components/portal-shell/portal-shell';
import { ApplicationsService } from '../../../core/services/applications.service';
import { NoticesService } from '../../../core/services/notices';
import {
  ApplicantInboxRow, ApplicantInboxFilters, ApplicationStatus,
} from '../../../core/models/application.model';
import { landlordNav } from '../landlord-nav';

/**
 * All applicants — Phase 7c.
 *
 * ── Why this screen exists
 *
 * Applicants were per room and only per room: `/landlord/rooms/:roomId/applicants`.
 * A landlord with six rooms therefore had six screens to open before they knew
 * the answer to the only question they actually have — "has anybody applied?" —
 * and no screen anywhere could answer it across the lot. The nav made that
 * worse rather than better: it carried an "Applicants" item pointing at a
 * dashboard section of a different name, which Phase 7a removed for being a
 * promise nothing kept. This is the page that item was promising.
 *
 * ── What it is and is not
 *
 * A finder, not a second applicant manager. Deciding on a person — shortlist,
 * accept, reject, read their references, write a private note — stays on the
 * room's own screen, where it is built and where the surrounding context is.
 * Duplicating those actions here would be the second copy that misses the next
 * fix, which this codebase has already paid for once with the portal nav
 * defined six times. So each row ends in one link, and that link opens the
 * applicant rather than merely the room: `?open=` is read by the room screen,
 * because a list that tells you somebody is waiting and then makes you find
 * them again has only moved the work.
 *
 * ── Filtering
 *
 * Server-side, through `GET /applications/inbox`. The options are built from
 * the first unfiltered load and then kept: deriving them from the current rows
 * would shrink the room list to the one room already chosen, so the filter
 * would delete its own way back.
 */
@Component({
  selector: 'app-applicants-inbox',
  standalone: true,
  imports: [PortalShell, RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems()" roleLabel="Landlord" pageTitle="All applicants">
      <section class="dash-section">
        <div class="ai-head">
          <h2 class="dash-section-title">Everyone who has applied</h2>
          @if (!loading() && !failed() && inbox(); as d) {
            <p class="ai-count">
              {{ d.total }} {{ d.total === 1 ? 'applicant' : 'applicants' }}
              @if (d.needsAttention > 0) {
                · <strong>{{ d.needsAttention }} waiting on you</strong>
              }
            </p>
          }
        </div>

        <!-- Filters stay on screen through every state, including the failed
             one: a filter bar that disappears when a request fails leaves
             somebody with no way to change what they just asked for. -->
        <div class="ai-filters">
          <label>
            <span>Property</span>
            <select [value]="propertyId() ?? ''" (change)="setProperty($any($event.target).value)">
              <option value="">All properties</option>
              @for (p of propertyOptions(); track p.id) {
                <option [value]="p.id">{{ p.name }}</option>
              }
              @if (hasUngrouped()) {
                <!-- Rooms with no property are a real and common case: a
                     landlord with four back rooms never has to group them. -->
                <option value="none">Rooms not grouped</option>
              }
            </select>
          </label>

          <label>
            <span>Room</span>
            <select [value]="roomId() ?? ''" (change)="setRoom($any($event.target).value)">
              <option value="">All rooms</option>
              @for (r of roomOptions(); track r.id) {
                <option [value]="r.id">{{ r.title }}</option>
              }
            </select>
          </label>

          <label>
            <span>Status</span>
            <select [value]="status() ?? ''" (change)="setStatus($any($event.target).value)">
              <option value="">Any status</option>
              <option value="pending">New</option>
              <option value="viewed">Opened</option>
              <option value="shortlisted">Shortlisted</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Turned down</option>
            </select>
          </label>

          <label>
            <span>Sort</span>
            <select [value]="sortBy()" (change)="setSort($any($event.target).value)">
              <option value="newest">Newest first</option>
              <option value="unread">Waiting on you first</option>
            </select>
          </label>

          @if (anyFilter()) {
            <button type="button" class="btn btn-ghost btn-sm" (click)="clearFilters()">
              Clear filters
            </button>
          }
        </div>

        <!-- Three states, not two. "No applicants" on a failed request tells a
             landlord nobody wants their room, which is the one thing this
             screen must not get wrong. Same rule as the notices screen. -->
        @if (failed()) {
          <p class="ai-empty" role="alert">
            We could not load your applicants just now — this is a problem at our
            end, not an empty list.
            <button type="button" class="link-button" (click)="load()">Try again</button>.
          </p>
        } @else if (loading()) {
          <p class="ai-empty">Loading…</p>
        } @else if (rows().length === 0) {
          @if (anyFilter()) {
            <p class="ai-empty">
              No applicants match these filters.
              <button type="button" class="link-button" (click)="clearFilters()">
                Show everyone
              </button>.
            </p>
          } @else {
            <p class="ai-empty">
              Nobody has applied yet. Applications arrive here from your published
              rooms — and we will tell you on WhatsApp and in your notices when
              one does, so you do not have to keep checking.
            </p>
          }
        }

        <ul class="ai-list">
          @for (a of rows(); track a.id) {
            <li class="ai-row" [class.is-waiting]="a.needsAttention">
              <div class="ai-row__main">
                <div class="ai-row__who">
                  <strong>{{ a.tenant?.fullName }}</strong>
                  @if (a.tenant?.isVerified) { <span class="pill">✓ Verified</span> }
                  @if (a.tenant?.tenantProfile?.hasPassport) {
                    <span class="pill pill--passport">🛂 Passport</span>
                  }
                  <span class="status status--{{ a.status }}">{{ statusLabel(a.status) }}</span>
                </div>

                <p class="ai-row__where">
                  {{ a.room.title }}
                  @if (a.room.property) { · {{ a.room.property.name }} }
                </p>

                @if (a.lastMessage; as m) {
                  <p class="ai-row__last">
                    <!-- Which channel the last thing anybody said arrived on.
                         A conversation genuinely mixes them: a tenant's message
                         is forwarded to the landlord over WhatsApp, and a reply
                         typed there is threaded back into this application. -->
                    <span class="chan chan--{{ m.channel }}">
                      {{ m.channel === 'whatsapp' ? '💬 WhatsApp' : '📱 In the app' }}
                    </span>
                    <span class="ai-row__preview">
                      {{ m.fromTenant ? '' : 'You: ' }}{{ m.body }}
                    </span>
                  </p>
                }

                <p class="ai-row__meta">
                  Applied {{ a.createdAt | date: 'd MMM y' }}
                  @if (a.unreadMessages > 0) {
                    · <strong>{{ a.unreadMessages }} unread</strong>
                  } @else if (a.messageCount > 0) {
                    · {{ a.messageCount }} {{ a.messageCount === 1 ? 'message' : 'messages' }}
                  }
                </p>
              </div>

              <div class="ai-row__actions">
                <!-- Opens the applicant, not just the room. See the class note. -->
                <a class="btn btn-primary btn-sm"
                   [routerLink]="['/landlord/rooms', a.room.id, 'applicants']"
                   [queryParams]="{ open: a.id }">
                  Open
                </a>
              </div>
            </li>
          }
        </ul>
      </section>
    </app-portal-shell>
  `,
  styles: `
    .ai-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
    .ai-count { font-size: .85rem; color: var(--slate); margin: 0; }
    .ai-filters {
      display: flex; gap: .75rem; flex-wrap: wrap; align-items: flex-end;
      margin: 1rem 0; padding-bottom: 1rem; border-bottom: 1px solid var(--border);
    }
    .ai-filters label { display: flex; flex-direction: column; gap: .2rem; font-size: .72rem; color: var(--slate); }
    .ai-filters select {
      font: inherit; font-size: .85rem; padding: .4rem .5rem;
      border: 1px solid var(--border); border-radius: 6px; background: #fff; min-width: 9rem;
    }
    .ai-empty { color: var(--slate); line-height: 1.6; max-width: 34rem; }
    .ai-list { list-style: none; padding: 0; margin: 1rem 0 0; }
    .ai-row {
      display: flex; gap: 1rem; align-items: flex-start; justify-content: space-between;
      padding: .9rem 0; border-bottom: 1px solid var(--border); flex-wrap: wrap;
    }
    /* Marked with a left bar rather than a bold font: on a cheap phone screen
       in daylight a weight change is close to invisible. */
    .ai-row.is-waiting {
      border-left: 3px solid var(--terra); padding-left: .75rem; margin-left: -.75rem;
    }
    .ai-row__main { flex: 1; min-width: 14rem; }
    .ai-row__who { display: flex; align-items: center; gap: .4rem; flex-wrap: wrap; }
    .ai-row__where { margin: .25rem 0 0; font-size: .85rem; }
    .ai-row__last { margin: .3rem 0 0; font-size: .8rem; display: flex; gap: .4rem; align-items: baseline; flex-wrap: wrap; }
    .ai-row__preview { color: var(--slate); overflow-wrap: anywhere; }
    .ai-row__meta { margin: .3rem 0 0; font-size: .75rem; color: var(--slate); }
    .ai-row__actions { flex-shrink: 0; }
    .pill { font-size: .6rem; font-weight: 700; background: rgba(61,112,64,.1); color: #3D7040; padding: .1rem .4rem; border-radius: 10px; }
    .status { font-size: .65rem; font-weight: 700; text-transform: uppercase; padding: .15rem .5rem; border-radius: 10px; background: #F2EDE3; }
    .status--accepted { background: rgba(61,112,64,.15); color: #3D7040; }
    .status--rejected, .status--withdrawn { background: rgba(214,59,59,.1); color: #D63B3B; }
    .chan { font-size: .65rem; font-weight: 700; padding: .1rem .4rem; border-radius: 10px; white-space: nowrap; }
    .chan--in_app { background: #F2EDE3; color: #3A3228; }
    .chan--whatsapp { background: rgba(37,211,102,.14); color: #0F7A3D; }
    .link-button {
      background: none; border: none; padding: 0; font: inherit;
      color: var(--terra); text-decoration: underline; cursor: pointer;
    }
    @media (max-width: 480px) {
      .ai-filters label, .ai-filters select { width: 100%; }
      .ai-row__actions { width: 100%; }
      .ai-row__actions .btn { width: 100%; text-align: center; }
    }
  `,
})
export class ApplicantsInbox implements OnInit {
  private applications = inject(ApplicationsService);
  private notices = inject(NoticesService);

  readonly loading = signal(true);
  readonly failed = signal(false);

  readonly roomId = signal<string | null>(null);
  readonly propertyId = signal<string | null>(null);
  readonly status = signal<ApplicationStatus | null>(null);
  readonly sortBy = signal<'newest' | 'unread'>('newest');

  readonly inbox = signal<{ data: ApplicantInboxRow[]; total: number; needsAttention: number } | null>(null);
  readonly rows = computed(() => this.inbox()?.data ?? []);

  /**
   * Filter options, from the FIRST unfiltered load and then left alone.
   *
   * Rebuilding them from the current rows looks tidier and is a trap: choosing
   * one room reduces the rows to that room, so the room list would reduce to
   * the room already chosen and there would be no way back to any other. The
   * same bug, one level down, as a nav that shrinks as you move through it.
   */
  readonly propertyOptions = signal<{ id: string; name: string }[]>([]);
  readonly roomOptions = signal<{ id: string; title: string }[]>([]);
  readonly hasUngrouped = signal(false);

  navItems = (): PortalNavItem[] =>
    landlordNav({
      applicants: this.inbox()?.needsAttention,
      notices: this.notices.unreadCount(),
    });

  anyFilter(): boolean {
    return !!this.roomId() || !!this.propertyId() || !!this.status();
  }

  ngOnInit() {
    this.load();
    // So the Notices badge in the sidebar is a real number here too.
    this.notices.refreshUnread().subscribe({ error: () => {} });
  }

  load() {
    this.loading.set(true);
    this.failed.set(false);

    const filters: ApplicantInboxFilters = {
      // 'none' is this screen's own word for "not grouped under a property" and
      // is not a uuid, so it must not reach the server's @IsUUID(). Those rows
      // are picked out below instead.
      propertyId: this.propertyId() === 'none' ? undefined : this.propertyId() ?? undefined,
      roomId: this.roomId() ?? undefined,
      status: this.status() ?? undefined,
      sortBy: this.sortBy(),
    };

    this.applications.inbox(filters).subscribe({
      next: (res) => {
        const data = this.propertyId() === 'none'
          ? res.data.filter((a) => !a.room.property)
          : res.data;

        this.inbox.set(
          this.propertyId() === 'none'
            ? { data, total: data.length, needsAttention: data.filter((a) => a.needsAttention).length }
            : res,
        );
        if (!this.anyFilter()) this.buildOptions(res.data);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.failed.set(true); },
    });
  }

  private buildOptions(rows: ApplicantInboxRow[]) {
    const properties = new Map<string, string>();
    const rooms = new Map<string, string>();
    let ungrouped = false;

    for (const a of rows) {
      rooms.set(a.room.id, a.room.title);
      if (a.room.property) properties.set(a.room.property.id, a.room.property.name);
      else ungrouped = true;
    }

    this.propertyOptions.set([...properties].map(([id, name]) => ({ id, name })));
    this.roomOptions.set([...rooms].map(([id, title]) => ({ id, title })));
    this.hasUngrouped.set(ungrouped);
  }

  setProperty(value: string) {
    this.propertyId.set(value || null);
    // Clearing the room with the property is deliberate: a room filter from a
    // different property would return nothing and read as "no applicants".
    this.roomId.set(null);
    this.load();
  }

  setRoom(value: string) {
    this.roomId.set(value || null);
    this.load();
  }

  setStatus(value: string) {
    this.status.set((value || null) as ApplicationStatus | null);
    this.load();
  }

  setSort(value: string) {
    this.sortBy.set(value === 'unread' ? 'unread' : 'newest');
    this.load();
  }

  clearFilters() {
    this.roomId.set(null);
    this.propertyId.set(null);
    this.status.set(null);
    this.load();
  }

  /**
   * The database words, in the words a landlord uses.
   *
   * 'pending' reads as though the landlord is pending something; it means
   * nobody has opened it yet. Phase 7f does this across the tenant side; the
   * two labels this screen needs are done here rather than left wrong.
   */
  statusLabel(status: ApplicationStatus): string {
    return { pending: 'New', viewed: 'Opened' }[status as 'pending' | 'viewed'] ?? status;
  }
}
