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
import { NavigationHistoryService } from '../../core/services/navigation-history.service';
import { Review } from '../../core/models/review.model';
import { AMENITY_LABELS } from '../../core/models/room.model';

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
        <!-- Points back where they came from: a room opened from a dashboard
             returns to that dashboard, not to the public board. -->
        <p><a [routerLink]="back().url">{{ back().label }}</a></p>

        <!-- Main image plus up to four thumbnails beside it. A row of
             equal thumbnails under a hero gave no sense of which photo
             mattered; this keeps one image dominant. -->
        <div class="gallery" [class.gallery--solo]="allPhotos().length === 1">
          <button type="button" class="gallery__main" (click)="openLightbox(0)"
                  [attr.aria-label]="'View photos of ' + r.title">
            <img [ngSrc]="activePath()" [alt]="r.title" width="800" height="533" priority/>
          </button>

          @if (allPhotos().length > 1) {
            <div class="gallery__side">
              @for (path of sidePhotos(); track $index; let i = $index) {
                <button type="button" class="gallery__thumb" (click)="openLightbox(i + 1)">
                  <img [ngSrc]="path" [alt]="r.title" width="200" height="140"/>
                  <!-- The overflow count sits on the last visible thumb rather
                       than adding another row nobody scrolls. -->
                  @if (i === 3 && hiddenCount() > 0) {
                    <span class="gallery__more">+{{ hiddenCount() }}</span>
                  }
                </button>
              }
            </div>
          }
        </div>

        @if (lightboxIndex() !== null) {
          <div class="lightbox" role="dialog" aria-modal="true"
               (click)="closeLightbox()" (keydown.escape)="closeLightbox()" tabindex="-1">
            <button type="button" class="lightbox__close" (click)="closeLightbox()"
                    aria-label="Close">✕</button>
            <button type="button" class="lightbox__nav lightbox__nav--prev"
                    (click)="step(-1); $event.stopPropagation()" aria-label="Previous">‹</button>
            <img [src]="allPhotos()[lightboxIndex()!]" [alt]="r.title"
                 (click)="$event.stopPropagation()"/>
            <button type="button" class="lightbox__nav lightbox__nav--next"
                    (click)="step(1); $event.stopPropagation()" aria-label="Next">›</button>
            <div class="lightbox__count">
              {{ lightboxIndex()! + 1 }} of {{ allPhotos().length }}
            </div>
          </div>
        }

        <h1>{{ r.title }}</h1>
        <p class="room-detail__price">{{ r.rentCents | zarCents:'monthly' }} @if (r.billsIncluded) { <span class="pill">Bills included</span> }</p>
        <p class="room-detail__location">📍 {{ r.locationDisplay }}</p>

        <div class="room-detail__flags">
          @if (r.couplesAllowed) { <span class="pill pill--green">Couples welcome</span> }
          @if (r.dssAccepted) {
            <span class="pill pill--green"
                  title="The landlord will consider tenants whose income is a government grant">
              SASSA grants welcome
            </span>
          }
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

        @if (room()?.amenities?.length) {
          <section class="detail__section">
            <h2>What's included</h2>
            <div class="room-amenities">
              @for (a of room()!.amenities!; track a) {
                <span class="room-amenity">{{ amenityLabel(a) }}</span>
              }
            </div>
          </section>
        }

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
                     [city]="room()?.city"
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
    /* Hero plus a 2x2 of thumbnails. Collapses to hero-only on narrow
       screens, where four small images are unreadable anyway. */
    .gallery { display: grid; grid-template-columns: 2fr 1fr; gap: .5rem; margin-bottom: 1rem; }
    .gallery--solo { grid-template-columns: 1fr; }
    .gallery button { padding: 0; border: none; background: none; cursor: pointer; display: block; }
    .gallery__main img { width: 100%; height: 100%; aspect-ratio: 3/2;
                         object-fit: cover; border-radius: 10px; display: block; }
    .gallery__side { display: grid; grid-template-rows: repeat(2, 1fr); gap: .5rem; }
    .gallery__thumb { position: relative; }
    .gallery__thumb img { width: 100%; height: 100%; aspect-ratio: 3/2;
                          object-fit: cover; border-radius: 8px; display: block; }
    .gallery__more { position: absolute; inset: 0; display: flex; align-items: center;
                     justify-content: center; background: rgba(26,20,16,.62); color: #fff;
                     font-weight: 700; border-radius: 8px; font-size: 1.05rem; }

    @media (max-width: 700px) {
      .gallery { grid-template-columns: 1fr; }
      .gallery__side { grid-template-rows: none; grid-template-columns: repeat(4, 1fr); }
    }

    .lightbox { position: fixed; inset: 0; z-index: 200; background: rgba(10,8,6,.94);
                display: flex; align-items: center; justify-content: center; padding: 2rem; }
    .lightbox img { max-width: 100%; max-height: 88vh; object-fit: contain; border-radius: 6px; }
    .lightbox__close { position: absolute; top: 1rem; right: 1.25rem; font-size: 1.6rem;
                       background: none; border: none; color: #fff; cursor: pointer; line-height: 1; }
    .lightbox__nav { position: absolute; top: 50%; transform: translateY(-50%);
                     font-size: 2.5rem; background: none; border: none; color: #fff;
                     cursor: pointer; padding: 0 1rem; line-height: 1; }
    .lightbox__nav--prev { left: .25rem; }
    .lightbox__nav--next { right: .25rem; }
    .lightbox__count { position: absolute; bottom: 1.25rem; left: 50%; transform: translateX(-50%);
                       color: rgba(255,255,255,.75); font-size: .85rem; }
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

  /** Falls back to the raw key so an unknown value still shows something. */
  amenityLabel(value: string) {
    return AMENITY_LABELS[value] ?? value;
  }

  /** Report dialog visibility. Available signed out — see ReportDialog. */
  reportOpen = signal(false);

  /** Bound from the :id route segment. */
  id = input.required<string>();

  private roomsService = inject(RoomsService);
  private reviewsService = inject(ReviewsService);
  private history = inject(NavigationHistoryService);

  /** Resolved once in ngOnInit — see the service for why timing matters. */
  back = signal<{ url: string; label: string }>({ url: '/', label: '← Back to all rooms' });
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

  /** Cover first, then the rest — the order the landlord chose. */
  allPhotos = computed(() => [this.heroPath(), ...this.galleryPaths()]);
  activePath = computed(() => this.allPhotos()[0]);
  /** At most four beside the hero; the rest are reachable in the lightbox. */
  sidePhotos = computed(() => this.allPhotos().slice(1, 5));
  hiddenCount = computed(() => Math.max(0, this.allPhotos().length - 5));

  lightboxIndex = signal<number | null>(null);

  openLightbox(index: number) {
    this.lightboxIndex.set(index);
  }

  closeLightbox() {
    this.lightboxIndex.set(null);
  }

  /** Wraps at both ends — running out of photos mid-browse feels broken. */
  step(delta: number) {
    const total = this.allPhotos().length;
    if (total === 0) return;
    this.lightboxIndex.update((i) => ((i ?? 0) + delta + total) % total);
  }

  roomReviews = signal<Review[]>([]);
  loadingReviews = signal(true);

  ngOnInit() {
    this.back.set(this.history.backTarget());

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
