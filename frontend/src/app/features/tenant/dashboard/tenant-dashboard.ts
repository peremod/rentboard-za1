import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ApplicationsService } from '../../../core/services/applications.service';
import { Application } from '../../../core/models/application.model';
import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';
import { MessageThread } from '../../../shared/components/message-thread/message-thread';
import { BILLING_ENABLED } from '../../../core/config/feature-flags';
import { PortalShell, PortalNavItem } from '../../../shared/components/portal-shell/portal-shell';

@Component({
  selector: 'app-tenant-dashboard',
  standalone: true,
  imports: [RouterLink, ZarCentsPipe, MessageThread, PortalShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems" roleLabel="Tenant" avatarColour="var(--sage)">

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
        <div class="stat-box"><div class="val">{{ applications().length }}</div><div class="lbl">Applications</div></div>
        <div class="stat-box"><div class="val">{{ shortlistedCount() }}</div><div class="lbl">Shortlisted</div></div>
        <div class="stat-box"><div class="val">{{ pendingCount() }}</div><div class="lbl">Awaiting reply</div></div>
      </div>

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
          @for (app of applications(); track app.id) {
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
    </app-portal-shell>
  `,
  // Layout comes from the global spec + responsive layers.
})
export class TenantDashboard implements OnInit {
  auth = inject(AuthService);
  private applicationsService = inject(ApplicationsService);

  billingEnabled = BILLING_ENABLED;

  /**
   * Applications, Messages and Saved Rooms are shown because the spec lists
   * them. Applications and Messages both resolve to the dashboard, which is
   * where they live today; Saved Rooms has no feature behind it yet, so it is
   * marked disabled rather than linking somewhere misleading.
   */
  readonly navItems: PortalNavItem[] = [
    { label: 'Dashboard', icon: '🏠', route: '/tenant/dashboard', exact: true },
    { label: 'Applications', icon: '📋', route: '/tenant/dashboard' },
    { label: 'Messages', icon: '💬', route: '/tenant/dashboard' },
    { label: 'Browse rooms', icon: '🔍', route: '/' },
    { label: 'Saved Rooms', icon: '♥', route: '/tenant/dashboard', disabled: true },
    ...(BILLING_ENABLED ? [{ label: "Renter's Passport", icon: '🛂', route: '/tenant/passport' }] : []),
  ];

  applications = signal<Application[]>([]);
  loading = signal(true);
  openId = signal<string | null>(null);

  ngOnInit() {
    this.applicationsService.getMyApplications().subscribe({
      next: (apps) => { this.applications.set(apps); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  shortlistedCount() {
    return this.applications().filter((a) => a.status === 'shortlisted').length;
  }

  pendingCount() {
    return this.applications().filter((a) => a.status === 'pending' || a.status === 'viewed').length;
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
