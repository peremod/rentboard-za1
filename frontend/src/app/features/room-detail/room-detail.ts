import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RoomsService } from '../../core/services/rooms.service';
import { Room } from '../../core/models/room.model';
import { ZarCentsPipe } from '../../shared/pipes/zar-cents.pipe';

/**
 * Placeholder room detail page — proves the room-card → detail link resolves
 * to real data end-to-end. `id` is bound automatically from the :id route
 * param via withComponentInputBinding() in app.config.ts.
 *
 * Full gallery + apply form ports in with the Sprint 2 pass — see
 * RentBoard-Sprint2-Code.html.
 */
@Component({
  selector: 'app-room-detail',
  standalone: true,
  imports: [RouterLink, ZarCentsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="font-family:sans-serif;padding:2rem;max-width:640px;margin:0 auto">
      @if (room(); as r) {
        <p><a routerLink="/">← Back to all rooms</a></p>
        <h1>{{ r.title }}</h1>
        <p style="font-size:1.2rem;color:#C04E28;font-weight:700">{{ r.rentCents | zarCents:'monthly' }}</p>
        <p>{{ r.locationDisplay }}</p>
        <p>{{ r.description }}</p>
      } @else if (notFound()) {
        <p>Room not found. <a routerLink="/">Back to all rooms</a></p>
      } @else {
        <p>Loading…</p>
      }
    </div>
  `,
})
export class RoomDetail implements OnInit {
  /** Bound from the :id route segment — see app.routes.ts withComponentInputBinding(). */
  id = input.required<string>();

  private roomsService = inject(RoomsService);
  room = signal<Room | null>(null);
  notFound = signal(false);

  ngOnInit() {
    this.roomsService.getRoom(this.id()).subscribe({
      next: (r) => this.room.set(r),
      error: () => this.notFound.set(true),
    });
  }
}
