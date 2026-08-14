import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ApplicationsService } from '../../../core/services/applications.service';
import { Application } from '../../../core/models/application.model';
import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';
import { MessageThread } from '../../../shared/components/message-thread/message-thread';

@Component({
  selector: 'app-tenant-dashboard',
  standalone: true,
  imports: [RouterLink, ZarCentsPipe, MessageThread],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="font-family:sans-serif;padding:2rem;max-width:640px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
        <h1>Welcome, {{ auth.user()?.fullName }} 👋</h1>
        <button type="button" (click)="auth.logout()">Log out</button>
      </div>

      <a routerLink="/" style="font-size:.85rem">← Browse more rooms</a>
      &nbsp;·&nbsp;
      <a routerLink="/tenant/passport" style="font-size:.85rem">🪪 Get your Renter's Passport</a>
      <h2 style="font-size:1rem;margin:1.5rem 0 1rem">Your applications</h2>

      @if (loading()) {
        <p>Loading…</p>
      } @else if (applications().length === 0) {
        <p style="color:#7A6E60">You haven't applied to any rooms yet.</p>
      } @else {
        <div style="display:flex;flex-direction:column;gap:.75rem">
          @for (app of applications(); track app.id) {
            <div style="border:1px solid #DDD5C8;border-radius:8px;padding:.9rem">
              <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" (click)="toggle(app.id)">
                <div>
                  <strong>{{ app.room?.title }}</strong>
                  <p style="font-size:.8rem;color:#7A6E60;margin-top:.2rem">
                    @if (app.room) { {{ app.room.rentCents | zarCents:'monthly' }} · }
                    <span [style.color]="app.status === 'accepted' ? '#3D7040' : app.status === 'rejected' ? '#D63B3B' : '#7A6E60'">{{ app.status }}</span>
                  </p>
                </div>
                <div style="display:flex;gap:.6rem;align-items:center">
                  @if (app.room) { <a [routerLink]="['/rooms', app.room.id]" style="font-size:.8rem" (click)="$event.stopPropagation()">View room →</a> }
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
})
export class TenantDashboard implements OnInit {
  auth = inject(AuthService);
  private applicationsService = inject(ApplicationsService);

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
