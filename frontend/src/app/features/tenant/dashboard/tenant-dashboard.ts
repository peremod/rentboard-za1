import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ApplicationsService } from '../../../core/services/applications.service';
import { Application } from '../../../core/models/application.model';
import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';
import { MessageThread } from '../../../shared/components/message-thread/message-thread';
import { BILLING_ENABLED } from '../../../core/config/feature-flags';

@Component({
  selector: 'app-tenant-dashboard',
  standalone: true,
  imports: [RouterLink, ZarCentsPipe, MessageThread],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dashboard">
      <div class="dashboard__header">
        <h1>Welcome, {{ auth.user()?.fullName }} 👋</h1>
        <button type="button" (click)="auth.logout()">Log out</button>
      </div>

      <div class="dashboard__links">
        <a routerLink="/">← Browse more rooms</a>
        @if (billingEnabled) {
          <a routerLink="/tenant/passport">🪪 Get your Renter's Passport</a>
        }
      </div>
      <h2 class="dashboard__section-title">Your applications</h2>

      @if (loading()) {
        <p>Loading…</p>
      } @else if (applications().length === 0) {
        <p class="muted">You haven't applied to any rooms yet.</p>
      } @else {
        <div class="dashboard__list">
          @for (app of applications(); track app.id) {
            <div class="app-card">
              <div class="app-card__header" (click)="toggle(app.id)">
                <div>
                  <strong>{{ app.room?.title }}</strong>
                  <p class="app-card__meta">
                    @if (app.room) { {{ app.room.rentCents | zarCents:'monthly' }} · }
                    <span [style.color]="app.status === 'accepted' ? '#3D7040' : app.status === 'rejected' ? '#D63B3B' : '#7A6E60'">{{ app.status }}</span>
                  </p>
                </div>
                <div class="app-card__actions">
                  @if (app.room) { <a [routerLink]="['/rooms', app.room.id]" (click)="$event.stopPropagation()">View room →</a> }
                  <span>{{ openId() === app.id ? '▲' : '▼' }}</span>
                </div>
              </div>
              @if (openId() === app.id) { <app-message-thread [applicationId]="app.id"/> }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .dashboard { font-family: sans-serif; padding: 2rem 1.25rem; max-width: 640px; margin: 0 auto; }
    .dashboard__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; gap: .75rem; flex-wrap: wrap; }
    .dashboard__links { display: flex; gap: 1rem; flex-wrap: wrap; }
    .dashboard__links a { font-size: .85rem; }
    .dashboard__section-title { font-size: 1rem; margin: 1.5rem 0 1rem; }
    .dashboard__list { display: flex; flex-direction: column; gap: .75rem; }
    .muted { color: #7A6E60; }

    .app-card { border: 1px solid #DDD5C8; border-radius: 8px; padding: .9rem; }
    .app-card__header { display: flex; justify-content: space-between; align-items: center; cursor: pointer; gap: .75rem; }
    .app-card__meta { font-size: .8rem; color: #7A6E60; margin-top: .2rem; }
    .app-card__actions { display: flex; gap: .6rem; align-items: center; flex-shrink: 0; }
    .app-card__actions a { font-size: .8rem; white-space: nowrap; }

    /* Mobile — PRE-LAUNCH-CHECKLIST.md #9 */
    @media (max-width: 480px) {
      .app-card__header { flex-direction: column; align-items: flex-start; }
      .app-card__actions { width: 100%; justify-content: space-between; }
    }
  `],
})
export class TenantDashboard implements OnInit {
  auth = inject(AuthService);
  private applicationsService = inject(ApplicationsService);

  billingEnabled = BILLING_ENABLED;

  applications = signal<Application[]>([]);
  loading = signal(true);
  openId = signal<string | null>(null);

  ngOnInit() {
    this.applicationsService.getMyApplications().subscribe({
      next: (apps) => { this.applications.set(apps); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  toggle(id: string) {
    this.openId.set(this.openId() === id ? null : id);
  }
}
