import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { RoomsService } from '../../core/services/rooms.service';
import { ApplicationsService } from '../../core/services/applications.service';
import { AuthService } from '../../core/services/auth.service';
import { Room } from '../../core/models/room.model';
import { ZarCentsPipe } from '../../shared/pipes/zar-cents.pipe';
import { ReportDialog } from '../../shared/components/report-dialog/report-dialog';
import { ReviewList } from '../../shared/components/review-list/review-list';
import { AdSlot } from '../../shared/components/ad-slot/ad-slot';
import { ReviewsService } from '../../core/services/reviews.service';
import { Review } from '../../core/models/review.model';

/**
 * Room detail — gallery, full description, and the apply flow.
 * `id` is bound automatically from the :id route segment via
 * withComponentInputBinding() in app.config.ts.
 */
@Component({
  selector: 'app-room-detail',
  standalone: true,
  imports: [NgOptimizedImage, FormsModule, RouterLink, ZarCentsPipe, ReportDialog, ReviewList, AdSlot],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="room-detail">
      @if (room(); as r) {
        <p><a routerLink="/">← Back to all rooms</a></p>

        <div class="room-detail__gallery">
          <img [ngSrc]="heroPath()" [alt]="r.title" width="800" height="533" priority/>
          @if (galleryPaths().length > 0) {
            <div class="room-detail__thumbs">
              @for (path of galleryPaths(); track path) {
                <img [ngSrc]="path" [alt]="r.title" width="150" height="100"/>
              }
            </div>
          }
        </div>

        <h1>{{ r.title }}</h1>
        <p class="room-detail__price">{{ r.rentCents | zarCents:'monthly' }} @if (r.billsIncluded) { <span class="pill">Bills included</span> }</p>
        <p class="room-detail__location">📍 {{ r.locationDisplay }}</p>

        <div class="room-detail__flags">
          @if (r.couplesAllowed) { <span class="pill pill--green">Couples welcome</span> }
          @if (r.dssAccepted) { <span class="pill pill--green">DSS/SASSA accepted</span> }
          @if (r.guarantorAccepted) { <span class="pill pill--green">Guarantor accepted</span> }
          @if (r.petsAllowed) { <span class="pill pill--green">Pets allowed</span> }
        </div>

        <h2>About this room</h2>
        <p class="room-detail__description">{{ r.description }}</p>

        <div class="room-detail__apply">
          @if (!auth.isAuthenticated()) {
            <p>Interested? <a [routerLink]="['/auth/login']" [queryParams]="{returnUrl: '/rooms/' + r.id}">Log in to apply</a> — it's free.</p>
          } @else if (auth.isLandlord()) {
            <p class="muted">Landlord accounts can't apply to rooms.</p>
          } @else if (applied()) {
            <p class="pill pill--green">✓ Application sent</p>
          } @else {
            <h3>Apply for this room</h3>
            <textarea [(ngModel)]="coverNote" rows="3" placeholder="Introduce yourself to the landlord (optional)"></textarea>
            @if (applyError()) { <p class="error">{{ applyError() }}</p> }
            <button type="button" [disabled]="applying()" (click)="apply(r.id)">
              {{ applying() ? 'Sending…' : 'Apply free →' }}
            </button>
          }
        </div>

        <section class="detail__section">
          <h2>What previous tenants said</h2>
          @if (loadingReviews()) {
            <p class="muted">Loading reviews…</p>
          } @else {
            <app-review-list
              [reviews]="roomReviews()"
              emptyMessage="No reviews yet. This room has not been let through RentBoard before, which is not a bad sign — most listings start here."/>
          }
        </section>

        <app-ad-slot placement="room_detail"
                     [province]="room()?.province"
                     [roomType]="room()?.roomType"/>

        <aside class="detail__safety">
          <h2>Stay safe</h2>
          <p>
            Never pay a deposit before viewing the room in person and signing a
            written lease. Deposits must be held in an interest-bearing account
            under the Rental Housing Act 50 of 1999.
          </p>
          <button type="button" class="btn btn-sm btn-ghost-light" (click)="reportOpen.set(true)">
            🚩 Report this listing
          </button>
        </aside>

        @if (reportOpen()) {
          <app-report-dialog [roomId]="r.id" (close)="reportOpen.set(false)"/>
        }
      } @else if (notFound()) {
        <p>Room not found. <a routerLink="/">Back to all rooms</a></p>
      } @else {
        <p>Loading…</p>
      }
    </div>
  `,
  styles: [`
    .room-detail { max-width: 640px; margin: 0 auto; padding: 1.5rem 1.25rem; font-family: sans-serif; }
    .room-detail__gallery img:first-child { width: 100%; height: auto; border-radius: 10px; margin-bottom: .5rem; }
    .room-detail__thumbs { display: flex; gap: .4rem; overflow-x: auto; }
    .room-detail__thumbs img { border-radius: 6px; object-fit: cover; }
    h1 { font-size: 1.4rem; margin: 1rem 0 .3rem; }
    .room-detail__price { font-size: 1.15rem; font-weight: 700; color: #C04E28; margin-bottom: .3rem; }
    .room-detail__location { color: #7A6E60; margin-bottom: .8rem; }
    .room-detail__flags { display: flex; gap: .4rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
    .pill { font-size: .72rem; font-weight: 700; background: #F2EDE3; padding: .2rem .6rem; border-radius: 20px; }
    .pill--green { background: rgba(61,112,64,.1); color: #3D7040; }
    h2 { font-size: 1rem; margin-bottom: .5rem; }
    .room-detail__description { line-height: 1.7; color: #3A3228; margin-bottom: 2rem; white-space: pre-wrap; }
    .room-detail__apply { border-top: 1px solid #DDD5C8; padding-top: 1.5rem; }
    .room-detail__apply textarea { width: 100%; padding: .6rem; border: 1.5px solid #DDD5C8; border-radius: 6px; margin-bottom: .6rem; font-family: inherit; }
    .room-detail__apply button { padding: .6rem 1.2rem; border-radius: 6px; border: none; background: #C04E28; color: #fff; font-weight: 700; cursor: pointer; }
    .room-detail__apply button:disabled { opacity: .5; }
    .error { color: #D63B3B; font-size: .82rem; margin-bottom: .5rem; }
    .muted { color: #7A6E60; }
  `],
})
export class RoomDetail implements OnInit {
  /** Report dialog visibility. Available signed out — see ReportDialog. */
  reportOpen = signal(false);

  /** Bound from the :id route segment. */
  id = input.required<string>();

  private roomsService = inject(RoomsService);
  private reviewsService = inject(ReviewsService);
  private applicationsService = inject(ApplicationsService);
  auth = inject(AuthService);

  room = signal<Room | null>(null);
  notFound = signal(false);
  coverNote = '';
  applying = signal(false);
  applied = signal(false);
  applyError = signal<string | null>(null);

  heroPath = computed(() => this.room()?.heroImagePath || '/assets/images/room-placeholder.svg');
  galleryPaths = computed(() => this.room()?.imagePaths ?? []);

  roomReviews = signal<Review[]>([]);
  loadingReviews = signal(true);

  ngOnInit() {
    // The room id arrives as a routed input signal, not via ActivatedRoute.
    this.reviewsService.getRoomReviews(this.id()).subscribe({
      next: (list: Review[]) => {
        this.roomReviews.set(list);
        this.loadingReviews.set(false);
      },
      // A missing review list must never break the page.
      error: () => this.loadingReviews.set(false),
    });

    this.roomsService.getRoom(this.id()).subscribe({
      next: (r) => this.room.set(r),
      error: () => this.notFound.set(true),
    });
  }

  apply(roomId: string) {
    this.applying.set(true);
    this.applyError.set(null);
    this.applicationsService.apply(roomId, this.coverNote || undefined).subscribe({
      next: () => { this.applying.set(false); this.applied.set(true); },
      error: (err) => {
        this.applying.set(false);
        this.applyError.set(err?.error?.message ?? 'Could not send your application. Please try again.');
      },
    });
  }
}
