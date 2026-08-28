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
import { SavedRoomsService } from '../../../core/services/saved-rooms.service';
import { AlertsService } from '../../../core/services/alerts.service';
import { SavedSearch } from '../../../core/models/alerts.model';
import { RoomsService } from '../../../core/services/rooms.service';
import { Room } from '../../../core/models/room.model';
import { RoomCard } from '../../../shared/components/room-card/room-card';

@Component({
  selector: 'app-tenant-dashboard',
  standalone: true,
  imports: [RouterLink, ZarCentsPipe, MessageThread, PortalShell, RoomCard, ReviewPrompt],
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

      <section class="dash-section">
        <div class="dash-section-title">Your applications</div>

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

      @if (closedApplications().length > 0) {
        <section class="dash-section">
          <div class="dash-section-title">
            Closed applications
            <span class="dash-count">({{ closedApplications().length }})</span>
          </div>
          @for (app of closedApplications(); track app.id) {
            <div class="app-card app-card--closed">
              <div class="app-thumb portal-thumb" aria-hidden="true">🏠</div>
              <div class="app-info">
                <div class="app-room">{{ app.room?.title }}</div>
                @if (app.room) {
                  <div class="app-location">{{ app.room.locationDisplay }}</div>
                }
                <div class="app-location">{{ app.archivedReason }}</div>
              </div>
              <div class="portal-row-actions">
                @if (app.room && app.room.status === 'active') {
                  <a class="btn btn-sm btn-outline" [routerLink]="['/rooms', app.room.id]">
                    Apply again
                  </a>
                } @else if (app.room) {
                  <a class="btn btn-sm btn-ghost-light" [routerLink]="['/rooms', app.room.id]">View room</a>
                }
              </div>
            </div>
          }
        </section>
      }

      <section class="dash-section">
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

      <section class="dash-section">
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
  busySearch = signal<string | null>(null);

  /**
   * Computed rather than static so the Applications and Saved Rooms badges
   * track live counts. Applications and Messages resolve to this dashboard,
   * which is where both live today.
   */
  readonly navItems = computed<PortalNavItem[]>(() => [
    { label: 'Dashboard', icon: '🏠', route: '/tenant/dashboard', exact: true },
    { label: 'Applications', icon: '📋', route: '/tenant/dashboard', badge: this.activeApplicationCount() },
    { label: 'Messages', icon: '💬', route: '/tenant/dashboard' },
    { label: 'Browse rooms', icon: '🔍', route: '/' },
    { label: 'Saved Rooms', icon: '♥', route: '/tenant/dashboard', badge: this.savedRooms.count() },
    { label: 'Alerts', icon: '🔔', route: '/tenant/dashboard', badge: this.alerts.searches().length },
    ...(BILLING_ENABLED ? [{ label: "Renter's Passport", icon: '🛂', route: '/tenant/passport' }] : []),
  ]);

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
  private loadSavedRooms() {
    const ids = this.savedRooms.ids();
    if (ids.length === 0) {
      this.savedRoomList.set([]);
      return;
    }
    this.loadingSaved.set(true);
    forkJoin(
      ids.map((id) => this.roomsService.getRoom(id).pipe(catchError(() => of(null)))),
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
  }

  /**
   * An accepted application cannot be withdrawn here — the landlord has already
   * committed, so that conversation belongs in messages, not a button.
   */
  canWithdraw(app: Application): boolean {
    return !app.isArchived && ['pending', 'viewed', 'shortlisted'].includes(app.status);
  }

  withdraw(app: Application) {
    if (!confirm('Withdraw this application? The landlord will see you are no longer interested.')) return;
    this.withdrawing.set(app.id);
    this.applicationsService.withdraw(app.id).subscribe({
      next: (updated) => {
        this.applications.update((list) => list.map((a) => (a.id === app.id ? { ...a, ...updated } : a)));
        this.withdrawing.set(null);
      },
      error: () => this.withdrawing.set(null),
    });
  }

  /** Live applications — the ones a tenant can still act on. */
  activeApplications() {
    return this.applications().filter((a) => !a.isArchived);
  }

  /**
   * Closed because the room was relisted or let to someone else. Kept visible
   * so a tenant is not left wondering what happened to an application, and so
   * they can re-apply when the room is back on the board.
   */
  closedApplications() {
    return this.applications().filter((a) => a.isArchived);
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
