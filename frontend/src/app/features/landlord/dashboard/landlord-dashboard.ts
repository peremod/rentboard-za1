import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { RoomsService } from '../../../core/services/rooms.service';
import { Room } from '../../../core/models/room.model';
import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';

@Component({
  selector: 'app-landlord-dashboard',
  standalone: true,
  imports: [RouterLink, ZarCentsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="font-family:sans-serif;padding:2rem;max-width:720px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
        <h1>Welcome, {{ auth.user()?.fullName }} 👋</h1>
        <button type="button" (click)="auth.logout()">Log out</button>
      </div>

      <a routerLink="/landlord/rooms/new" style="display:inline-block;background:#C04E28;color:#fff;padding:.6rem 1.1rem;border-radius:6px;text-decoration:none;font-weight:700;margin-bottom:2rem">
        + List a new room
      </a>

      <h2 style="font-size:1rem;margin-bottom:1rem">Your rooms</h2>

      @if (loading()) {
        <p>Loading…</p>
      } @else if (rooms().length === 0) {
        <p style="color:#7A6E60">You haven't listed a room yet. Click "List a new room" to get started — it's free.</p>
      } @else {
        <div style="display:flex;flex-direction:column;gap:.75rem">
          @for (room of rooms(); track room.id) {
            <div style="border:1px solid #DDD5C8;border-radius:8px;padding:.9rem;display:flex;justify-content:space-between;align-items:center">
              <div>
                <strong>{{ room.title }}</strong>
                <p style="font-size:.8rem;color:#7A6E60;margin-top:.2rem">
                  {{ room.rentCents | zarCents:'monthly' }} · {{ room.locationDisplay }} ·
                  <span [style.color]="room.status === 'active' ? '#3D7040' : '#7A6E60'">{{ room.status }}</span>
                </p>
              </div>
              <a [routerLink]="['/rooms', room.id]" style="font-size:.8rem">View →</a>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class LandlordDashboard implements OnInit {
  auth = inject(AuthService);
  private roomsService = inject(RoomsService);

  rooms = signal<Room[]>([]);
  loading = signal(true);

  ngOnInit() {
    this.roomsService.getLandlordRooms().subscribe({
      next: (rooms) => { this.rooms.set(rooms); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
