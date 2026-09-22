import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { forkJoin, of, catchError } from 'rxjs';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ApplicationsService } from '../../../core/services/applications.service';
import { Application } from '../../../core/models/application.model';
import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';
import { MessageThread } from '../../../shared/components/message-thread/message-thread';
import { BILLING_ENABLED } from '../../../core/config/feature-flags';
import { PortalShell, PortalNavItem } from '../../../shared/components/portal-shell/portal-shell';
import { ReviewPrompt } from '../../../shared/components/review-prompt/review-prompt';
import { ReferralPanel } from '../../../shared/components/referral-panel/referral-panel';
import { SavedRoomsService } from '../../../core/services/saved-rooms.service';
import { AlertsService } from '../../../core/services/alerts.service';
import { DialogService } from '../../../core/services/dialog.service';
import { SavedSearch } from '../../../core/models/alerts.model';
import { RoomsService } from '../../../core/services/rooms.service';
import { Room } from '../../../core/models/room.model';
import { RoomCard } from '../../../shared/components/room-card/room-card';
import { tenantNav } from '../tenant-nav';

@Component({
  selector: 'app-tenant-dashboard',
  standalone: true,
  imports: [RouterLink, ZarCentsPipe, MessageThread, PortalShell, RoomCard, ReviewPrompt, ReferralPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems()" roleLabel="Tenant" avatarColour="var(--sage)">

      @if (shortlistedCount() > 0) {
        <div class="insight-banner" style="background:rgba(61,112,64,.08);border-color:rgba(61,112,64,.2)">
          🎉
          <span>
            You've been <strong>shortlisted</strong> for
            {{ shortlistedCount() }} {{ shortlistedCount() === 1 ? 'room' : 'rooms' }}.
            Message the landlord to arrange a viewing.
          </span>
        </div>
      }

      <div class="stat-row">
        <div class="stat-box"><div class="val">{{ activeApplications().length }}</div><div class="lbl">Applications</div></div>
        <div class="stat-box"><div class="val">{{ shortlistedCount() }}</div><div class="lbl">Shortlisted</div></div>
        <div class="stat-box"><div class="val">{{ pendingCount() }}</div><div class="lbl">Awaiting reply</div></div>
      </div>

      <app-review-prompt/>

      <section class="dash-section" id="your-applications">
        <div class="dash-section-title">Your applications</div>
        <p class="muted">Live — you're waiting on the landlord.</p>

        @if (loading()) {
          <p class="muted">Loading…</p>
        } @else if (applications().length === 0) {
          <div class="empty-state">
            <h3>No applications yet</h3>
            <p>Browse the notice board and apply — it's free, and always will be.</p>
            <a class="btn btn-primary" routerLink="/">Browse rooms</a>
          </div>
        } @else {
          @for (app of activeApplications(); track app.id) {
            <div class="app-card" [class.app-card--closed]="app.status === 'rejected'">
              <div class="app-thumb portal-thumb" aria-hidden="true">🏠</div>

              <div class="app-info">
                <div class="app-room">{{ app.room?.title }}</div>
                @if (app.room) {
                  <div class="app-location">{{ app.room.locationDisplay }}</div>
                  <div class="app-rent">{{ app.room.rentCents | zarCents:'monthly' }}</div>
                }
              </div>

              <div class="portal-row-actions">
                <span class="app-status" [class]="'app-status status-' + app.status">
                  {{ statusLabel(app.status) }}
                </span>
                <button type="button" class="btn btn-sm btn-outline" (click)="toggle(app.id)"
                        [attr.aria-expanded]="openId() === app.id">
                  {{ openId() === app.id ? 'Hide messages' : '💬 Messages' }}
                </button>
                @if (app.room) {
                  <a class="btn btn-sm btn-ghost-light" [routerLink]="['/rooms', app.room.id]">View room</a>
                }
                @if (canWithdraw(app)) {
                  <button type="button" class="btn btn-sm btn-ghost-light"
                          [disabled]="withdrawing() === app.id" (click)="withdraw(app)">
                    {{ withdrawing() === app.id ? 'Withdrawing…' : 'Withdraw' }}
                  </button>
                }
              </div>

              @if (openId() === app.id) {
                <div class="app-card__thread">
                  <app-message-thread [applicationId]="app.id"/>
                </div>
              }
            </div>
          }
        }
      </section>

      <!-- A room you applied for that is back on the board is an opportunity,
           not history. Buried under "Closed applications" nobody sees it. -->
      @if (availableAgain().length > 0) {
        <section class="dash-section">
          <div class="dash-section-title">
            Available again
            <span class="dash-count">({{ availableAgain().length }})</span>
          </div>
          <p class="muted">
            Rooms you applied for that are back on the board. Your earlier
            application closed when the landlord relisted — applying again puts
            you back in the queue.
          </p>
          @for (app of availableAgain(); track app.id) {
            <div class="app-card">
              <div class="app-thumb portal-thumb" aria-hidden="true">🔁</div>
              <div class="app-info">
                <div class="app-room">{{ app.room?.title }}</div>
                @if (app.room) {
                  <div class="app-location">{{ app.room.locationDisplay }}</div>
                  <div class="app-rent">{{ app.room.rentCents | zarCents:'monthly' }}</div>
                }
                <div class="app-location">
                  This room is back on the board. Your earlier application was closed
                  when it was relisted — you can apply again.
                </div>
              </div>
              <div class="portal-row-actions">
                @if (app.room) {
                  <a class="btn btn-sm btn-primary" [routerLink]="['/rooms', app.room.id]">Apply again</a>
                }
              </div>
            </div>
          }
        </section>
      }

      @if (closedApplications().length > 0) {
        <section class="dash-section">
          <div class="dash-section-title">
            Closed applications
            <span class="dash-count">({{ closedApplications().length }})</span>
          </div>
          <p class="muted">Finished — nothing more to do on these.</p>
          @for (app of closedApplications(); track app.id) {
            <div class="app-card app-card--closed">
              <div class="app-thumb portal-thumb" aria-hidden="true">🏠</div>
              <div class="app-info">
                <div class="app-room">{{ app.room?.title }}</div>
                @if (app.room) {
                  <div class="app-location">{{ app.room.locationDisplay }}</div>
                }
                <div class="app-location">{{ closedReason(app) }}</div>
              </div>
              <div class="portal-row-actions">
                @if (app.room && app.room.status === 'active') {
                  <a class="btn btn-sm btn-outline" [routerLink]="['/rooms', app.room.id]">
                    {{ app.status === 'withdrawn' ? 'Apply again' : 'Apply again' }}
                  </a>
                } @else if (app.room) {
                  <a class="btn btn-sm btn-ghost-light" [routerLink]="['/rooms', app.room.id]">View room</a>
                }
              </div>
            </div>
          }
        </section>
      }

      <app-referral-panel/>

      <section class="dash-section" id="room-alerts">
        <div class="dash-section-title">
          Room alerts
          @if (alerts.searches().length > 0) {
            <span class="dash-count">({{ alerts.searches().length }})</span>
          }
        </div>

        @if (alerts.searches().length === 0) {
          <div class="empty-state">
            <h3>No alerts set up</h3>
            <p>
              Rooms are often taken within days. Save a search and we'll email you
              the moment a matching room is listed.
            </p>
            <a class="btn btn-primary" routerLink="/">Search rooms</a>
          </div>
        } @else {
          @for (search of alerts.searches(); track search.id) {
            <div class="app-card" [class.app-card--closed]="!search.isActive">
              <div class="app-thumb portal-thumb" aria-hidden="true">🔔</div>
              <div class="app-info">
                <div class="app-room">{{ search.name }}</div>
                <div class="app-location">{{ describe(search) }}</div>
                <div class="app-location">
                  {{ search.isActive ? frequencyLabel(search.frequency) : 'Paused' }}
                  @if (search.matchCount > 0) {
                    · {{ search.matchCount }} match{{ search.matchCount === 1 ? '' : 'es' }} so far
                  }
                </div>
              </div>
              <div class="portal-row-actions">
                <button type="button" class="btn btn-sm btn-ghost-light"
                        [disabled]="busySearch() === search.id" (click)="togglePaused(search)">
                  {{ search.isActive ? 'Pause' : 'Resume' }}
                </button>
                <button type="button" class="btn btn-sm btn-ghost-light"
                        [disabled]="busySearch() === search.id" (click)="deleteSearch(search)">
                  Delete
                </button>
              </div>
            </div>
          }
        }
      </section>

      <section class="dash-section" id="saved-rooms">
        <div class="dash-section-title">
          Saved rooms
          @if (savedRooms.count() > 0) { <span class="dash-count">({{ savedRooms.count() }})</span> }
        </div>

        @if (savedRooms.count() === 0) {
          <p class="muted">
            No saved rooms yet. Tap the ♡ on any room to keep it here while you decide.
          </p>
        } @else if (loadingSaved()) {
          <p class="muted">Loading saved rooms…</p>
        } @else {
          <div class="room-grid">
            @for (room of savedRoomList(); track room.id) {
              <app-room-card [room]="room"/>
            }
          </div>
          @if (savedRoomList().length < savedRooms.count()) {
            <p class="muted" style="margin-top:.75rem">
              Some saved rooms are no longer listed and have been hidden.
            </p>
          }
        }
      </section>
    </app-portal-shell>
  `,
  // Layout comes from the global spec + responsive layers.
})
export class TenantDashboard implements OnInit {
  auth = inject(AuthService);
  private applicationsService = inject(ApplicationsService);

  billingEnabled = BILLING_ENABLED;
  savedRooms = inject(SavedRoomsService);
  private roomsService = inject(RoomsService);

  savedRoomList = signal<Room[]>([]);
  loadingSaved = signal(false);
  withdrawing = signal<string | null>(null);
  alerts = inject(AlertsService);
  private dialogs = inject(DialogService);

  /** Plain-language summary of a saved search's filters. */
  describe(search: SavedSearch): string {
    const parts: string[] = [];
    if (search.roomType) {
      parts.push({
        shared_house: 'Room in a shared house',
        en_suite: 'En-suite',
        studio: 'Studio',
        private: 'Private room',
      }[search.roomType] ?? 'Room');
    }
    if (search.city) parts.push(`in ${search.city}`);
    else if (search.province) parts.push(`in ${search.province}`);
    if (search.maxRentCents) {
      parts.push(`up to ${new Intl.NumberFormat('en-ZA', {
        style: 'currency', currency: 'ZAR', maximumFractionDigits: 0,
      }).format(search.maxRentCents / 100)}/mo`);
    }
    if (search.billsIncluded) parts.push('bills included');
    if (search.dssAccepted) parts.push('SASSA welcome');
    if (search.petsAllowed) parts.push('pets allowed');
    return parts.length ? parts.join(' · ') : 'Any room, anywhere';
  }

  frequencyLabel(frequency: string): string {
    return {
      instant: 'Emailed as soon as a room matches',
      daily: 'Daily summary',
      off: 'Alerts off',
    }[frequency] ?? frequency;
  }

  /** Pausing keeps the search — consent can be withdrawn without losing setup. */
  togglePaused(search: SavedSearch) {
    this.busySearch.set(search.id);
    this.alerts.togglePaused(search).subscribe({
      next: () => this.busySearch.set(null),
      error: () => this.busySearch.set(null),
    });
  }

  async deleteSearch(search: SavedSearch) {
    const confirmed = await this.dialogs.confirm(
      'Delete this alert?',
      `You will stop receiving emails about "${search.name}". You can create it again at any time.`,
      'Delete',
      'Keep it',
    );
    if (!confirmed) return;

    this.busySearch.set(search.id);
    this.alerts.remove(search.id).subscribe({
      next: () => this.busySearch.set(null),
      error: () => this.busySearch.set(null),
    });
  }

  busySearch = signal<string | null>(null);

  /**
   * Computed rather than static so the Applications and Saved Rooms badges
   * track live counts. Applications and Messages resolve to this dashboard,
   * which is where both live today.
   */
  readonly navItems = computed<PortalNavItem[]>(() =>
    tenantNav({
      applications: this.activeApplicationCount(),
      saved: this.savedRooms.count(),
      alerts: this.alerts.searches().length,
    }),
  );

  applications = signal<Application[]>([]);
  loading = signal(true);
  openId = signal<string | null>(null);

  /** Pending or viewed — the applications still awaiting a landlord decision. */
  activeApplicationCount() {
    return this.activeApplications().filter((a) => a.status === 'pending' || a.status === 'viewed').length;
  }

  /**
   * Saved room ids are device-local, so each is fetched individually. Rooms
   * that 404 (let or removed) are dropped rather than failing the section.
   */
  /** Clears a saved room the tenant no longer wants to see. */
  unsave(room: Room) {
    this.savedRooms.unsave(room.id);
    this.savedRoomList.update((list) => list.filter((r) => r.id !== room.id));
  }

  private loadSavedRooms() {
    const ids = this.savedRooms.ids();
    if (ids.length === 0) {
      this.savedRoomList.set([]);
      return;
    }
    this.loadingSaved.set(true);
    forkJoin(
      ids.map((id) =>
        this.roomsService.getRoom(id).pipe(
          catchError(() => {
            // 404 means the listing is gone for good. Drop the saved id too,
            // or it is re-fetched on every dashboard visit forever.
            this.savedRooms.unsave(id);
            return of(null);
          }),
        ),
      ),
    ).subscribe({
      next: (rooms) => {
        this.savedRoomList.set(rooms.filter((r): r is Room => r !== null));
        this.loadingSaved.set(false);
      },
      error: () => this.loadingSaved.set(false),
    });
  }

  ngOnInit() {
    this.applicationsService.getMyApplications().subscribe({
      next: (apps) => { this.applications.set(apps); this.loading.set(false); },
      error: () => this.loading.set(false),
    });

    // Neither of these may break the dashboard if they fail.
    this.alerts.load().subscribe({ error: () => {} });
    this.loadSavedRooms();
  }

  /**
   * The three sections, defined so they cannot overlap. Every application
   * belongs to exactly one of them.
   *
   *   Your applications  — live. You are waiting on the landlord.
   *   Available again    — closed, but the room is back and you have NOT
   *                        re-applied. The only one with an action.
   *   Closed             — finished. Nothing to do.
   *
   * Previously withdrawn applications stayed under 'Your applications' (they
   * are not archived), and a relisted room appeared in both of the others,
   * once per past cycle.
   */
  canWithdraw(app: Application): boolean {
    return !app.isArchived && ['pending', 'viewed', 'shortlisted'].includes(app.status);
  }

  async withdraw(app: Application) {
    const confirmed = await this.dialogs.confirm(
      'Withdraw this application?',
      'The landlord will see you are no longer interested. You can apply again while the room is still available.',
      'Withdraw',
      'Keep applying',
    );
    if (!confirmed) return;

    this.withdrawing.set(app.id);
    this.applicationsService.withdraw(app.id).subscribe({
      next: (updated) => {
        this.applications.update((list) => list.map((a) => (a.id === app.id ? { ...a, ...updated } : a)));
        this.withdrawing.set(null);
      },
      error: () => this.withdrawing.set(null),
    });
  }

  /**
   * A saved room that is no longer takeable.
   *
   * Let, paused or reserved rooms still resolve — the tenant saved them and
   * may want to know what happened — but showing them identically to an
   * available room is misleading, so they are marked and can be cleared.
   */
  isUnavailable(room: Room): boolean {
    return room.status !== 'active';
  }

  unavailableLabel(room: Room): string {
    // Typed as a partial map: 'active' is deliberately absent, since this is
    // only called for rooms that are not available, and listing every status
    // would imply the method handles them all.
    const labels: Partial<Record<Room['status'], string>> = {
      let: 'Now let',
      reserved: 'Reserved for someone else',
      paused: 'Temporarily off the board',
      deleted: 'No longer listed',
      draft: 'No longer listed',
    };
    return labels[room.status] ?? 'No longer available';
  }

  /** Live: not archived, and not ended by the tenant's own withdrawal. */
  activeApplications() {
    return this.applications().filter(
      (a) => !a.isArchived && a.status !== 'withdrawn' && a.status !== 'rejected',
    );
  }

  /**
   * Rooms with an application in the current cycle, live OR withdrawn.
   *
   * Withdrawn counts here on purpose. Built from live applications alone, an
   * older archived row for the same room stopped being suppressed the moment
   * the tenant withdrew, so it resurfaced under 'Available again' — which read
   * exactly as though withdrawing had moved it there.
   *
   * Someone who has just withdrawn does not need to be invited back to the
   * same room; the Closed section already offers Apply again if they change
   * their mind.
   */
  private liveRoomIds() {
    return new Set(
      this.applications()
        .filter((a) => !a.isArchived)
        .map((a) => a.room?.id)
        .filter(Boolean) as string[],
    );
  }

  /**
   * Closed because the room was relisted or let to someone else. Kept visible
   * so a tenant is not left wondering what happened to an application, and so
   * they can re-apply when the room is back on the board.
   */
  /**
   * Finished, with nothing left to do: withdrawn, rejected, or closed on a room
   * that is not currently available. Never overlaps the other two sections.
   */
  closedApplications() {
    const shownAbove = new Set(this.availableAgain().map((a) => a.id));
    const live = this.liveRoomIds();

    return this.applications().filter((a) => {
      if (shownAbove.has(a.id)) return false;
      const isFinished = a.isArchived || a.status === 'withdrawn' || a.status === 'rejected';
      if (!isFinished) return false;
      // An older archived row for a room they have applied to again is noise —
      // but only the ARCHIVED one is hidden. The current withdrawn application
      // must still appear, or withdrawing makes it disappear from the dashboard
      // altogether.
      const roomId = a.room?.id;
      if (roomId && live.has(roomId) && a.isArchived) return false;
      return true;
    });
  }

  /** Why a closed application ended, in the tenant's terms. */
  closedReason(app: Application): string {
    if (app.status === 'withdrawn') return 'You withdrew this application.';
    if (app.status === 'rejected' && !app.isArchived) {
      return 'The landlord chose someone else.';
    }
    return app.archivedReason ?? 'This application is closed.';
  }

  /**
   * The room is back on the board and they have not re-applied yet.
   *
   * Deduplicated by room: a room relisted three times produced three archived
   * applications and listed the same room three times. One row per room, the
   * most recent, and excluded entirely once they have re-applied — otherwise
   * "apply again" stayed on screen after they already had.
   */
  availableAgain() {
    const live = this.liveRoomIds();
    const seen = new Set<string>();

    return this.applications()
      .filter((a) => {
        // Withdrawing is the tenant's own decision, not the room going away.
        // It belongs under Closed with a Re-apply action, not here.
        if (a.status === 'withdrawn') return false;
        if (!a.isArchived || a.status === 'accepted') return false;
        const roomId = a.room?.id;
        if (!roomId || a.room?.status !== 'active') return false;
        if (live.has(roomId)) return false;      // already re-applied
        if (seen.has(roomId)) return false;      // one row per room
        seen.add(roomId);
        return true;
      });
  }

  shortlistedCount() {
    return this.activeApplications().filter((a) => a.status === 'shortlisted').length;
  }

  pendingCount() {
    return this.activeApplications().filter((a) => a.status === 'pending' || a.status === 'viewed').length;
  }

  /** Human-readable status, matching the spec's pill labels. */
  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: '⏳ Pending',
      viewed: '👀 Viewed',
      shortlisted: '⭐ Shortlisted',
      accepted: '✓ Accepted',
      rejected: '✕ Not this time',
      withdrawn: 'Withdrawn',
    };
    return labels[status] ?? status;
  }

  toggle(id: string) {
    this.openId.set(this.openId() === id ? null : id);
  }
}
