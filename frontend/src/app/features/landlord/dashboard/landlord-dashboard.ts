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
    <div style="font-family:sans-serif;padding:2rem;max-width:720px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
        <h1>Welcome, {{ auth.user()?.fullName }} 👋</h1>
        <button type="button" (click)="auth.logout()">Log out</button>
      </div>

      <div style="display:flex;gap:.75rem;margin-bottom:2rem;flex-wrap:wrap">
        <a routerLink="/landlord/rooms/new" style="background:#C04E28;color:#fff;padding:.6rem 1.1rem;border-radius:6px;text-decoration:none;font-weight:700">
          + List a new room
        </a>
        <a routerLink="/landlord/upgrade" style="background:#1A1410;color:#fff;padding:.6rem 1.1rem;border-radius:6px;text-decoration:none;font-weight:700">
          ⭐ Upgrade plan
        </a>
      </div>

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
                @if (room.isFeatured) { <span style="font-size:.6rem;font-weight:700;background:#D4A853;color:#fff;padding:.1rem .4rem;border-radius:10px;margin-left:.3rem">⭐ Featured</span> }
                <p style="font-size:.8rem;color:#7A6E60;margin-top:.2rem">
                  {{ room.rentCents | zarCents:'monthly' }} · {{ room.locationDisplay }} ·
                  <span [style.color]="room.status === 'active' ? '#3D7040' : '#7A6E60'">{{ room.status }}</span>
                  · {{ room.applicationCount }} applicant{{ room.applicationCount !== 1 ? 's' : '' }}
                </p>
              </div>
              <div style="display:flex;gap:.75rem;align-items:center">
                @if (!room.isFeatured && room.status === 'active') {
                  <button type="button" style="font-size:.78rem;background:none;border:1px solid #D4A853;color:#D4A853;border-radius:6px;padding:.3rem .6rem;cursor:pointer" (click)="boost(room.id)">⭐ Boost R99</button>
                }
                <a [routerLink]="['/landlord/rooms', room.id, 'applicants']" style="font-size:.8rem">Applicants →</a>
                <a [routerLink]="['/rooms', room.id]" style="font-size:.8rem">View →</a>
              </div>
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
