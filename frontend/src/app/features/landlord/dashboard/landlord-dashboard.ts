import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { RoomsService } from '../../../core/services/rooms.service';
import { StripeService } from '../../../core/services/stripe.service';
import { Room } from '../../../core/models/room.model';
import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';

@Component({
  selector: 'app-landlord-dashboard',
  standalone: true,
  imports: [RouterLink, ZarCentsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dashboard">
      <div class="dashboard__header">
        <h1>Welcome, {{ auth.user()?.fullName }} 👋</h1>
        <button type="button" (click)="auth.logout()">Log out</button>
      </div>

      <div class="dashboard__actions">
        <a routerLink="/landlord/rooms/new" class="btn btn--primary">+ List a new room</a>
        <a routerLink="/landlord/upgrade" class="btn btn--dark">⭐ Upgrade plan</a>
      </div>

      <h2 class="dashboard__section-title">Your rooms</h2>

      @if (loading()) {
        <p>Loading…</p>
      } @else if (rooms().length === 0) {
        <p class="muted">You haven't listed a room yet. Click "List a new room" to get started — it's free.</p>
      } @else {
        <div class="dashboard__list">
          @for (room of rooms(); track room.id) {
            <div class="room-row">
              <div class="room-row__info">
                <strong>{{ room.title }}</strong>
                @if (room.isFeatured) { <span class="badge">⭐ Featured</span> }
                <p class="room-row__meta">
                  {{ room.rentCents | zarCents:'monthly' }} · {{ room.locationDisplay }} ·
                  <span [style.color]="room.status === 'active' ? '#3D7040' : '#7A6E60'">{{ room.status }}</span>
                  · {{ room.applicationCount }} applicant{{ room.applicationCount !== 1 ? 's' : '' }}
                </p>
              </div>
              <div class="room-row__actions">
                @if (!room.isFeatured && room.status === 'active') {
                  <button type="button" class="btn-boost" (click)="boost(room.id)">⭐ Boost R99</button>
                }
                <a [routerLink]="['/landlord/rooms', room.id, 'applicants']">Applicants →</a>
                <a [routerLink]="['/rooms', room.id]">View →</a>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .dashboard { font-family: sans-serif; padding: 2rem 1.25rem; max-width: 720px; margin: 0 auto; }
    .dashboard__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; gap: .75rem; flex-wrap: wrap; }
    .dashboard__actions { display: flex; gap: .75rem; margin-bottom: 2rem; flex-wrap: wrap; }
    .dashboard__section-title { font-size: 1rem; margin-bottom: 1rem; }
    .dashboard__list { display: flex; flex-direction: column; gap: .75rem; }
    .muted { color: #7A6E60; }
    .btn { padding: .6rem 1.1rem; border-radius: 6px; text-decoration: none; font-weight: 700; }
    .btn--primary { background: #C04E28; color: #fff; }
    .btn--dark { background: #1A1410; color: #fff; }
    .badge { font-size: .6rem; font-weight: 700; background: #D4A853; color: #fff; padding: .1rem .4rem; border-radius: 10px; margin-left: .3rem; }

    .room-row { border: 1px solid #DDD5C8; border-radius: 8px; padding: .9rem; display: flex; justify-content: space-between; align-items: center; gap: .75rem; }
    .room-row__meta { font-size: .8rem; color: #7A6E60; margin-top: .2rem; }
    .room-row__actions { display: flex; gap: .75rem; align-items: center; flex-shrink: 0; }
    .room-row__actions a { font-size: .8rem; white-space: nowrap; }
    .btn-boost { font-size: .78rem; background: none; border: 1px solid #D4A853; color: #D4A853; border-radius: 6px; padding: .3rem .6rem; cursor: pointer; white-space: nowrap; }

    /* Mobile — PRE-LAUNCH-CHECKLIST.md #9: stack rows instead of squeezing them */
    @media (max-width: 480px) {
      .room-row { flex-direction: column; align-items: flex-start; }
      .room-row__actions { width: 100%; justify-content: space-between; }
    }
  `],
})
export class LandlordDashboard implements OnInit {
  auth = inject(AuthService);
  private roomsService = inject(RoomsService);
  private stripe = inject(StripeService);

  rooms = signal<Room[]>([]);
  loading = signal(true);

  ngOnInit() {
    this.roomsService.getLandlordRooms().subscribe({
      next: (rooms) => { this.rooms.set(rooms); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  boost(roomId: string) {
    this.stripe.boostRoom(roomId);
  }
}
