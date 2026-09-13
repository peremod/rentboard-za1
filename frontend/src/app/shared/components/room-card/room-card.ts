import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Room } from '../../../core/models/room.model';
import { ZarCentsPipe } from '../../pipes/zar-cents.pipe';
import { SavedRoomsService } from '../../../core/services/saved-rooms.service';

/**
 * Room card — the notice-board grid item.
 * NgOptimizedImage + [priority]="isFirstCard()" handles the LCP image
 * (loading="eager"/fetchpriority="high") automatically; every other card
 * lazy-loads. width/height are fixed to prevent CLS.
 *
 * IMPORTANT: `ngSrc` gets the *raw* stored path (or the local placeholder,
 * starting with '/'), never a pre-built ImageKit URL — the app-wide
 * IMAGE_LOADER (app.config.ts) is what applies the CDN transform. Passing
 * an already-transformed URL here would run it through the loader twice.
 */
@Component({
  selector: 'app-room-card',
  standalone: true,
  imports: [NgOptimizedImage, RouterLink, ZarCentsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="room-card" [class.featured]="room().isFeatured">
      <!-- Outside the anchor: clicking save must not navigate to the room. -->
      <button type="button" class="save-btn" [class.saved]="isSaved()"
              (click)="toggleSaved($event)"
              [attr.aria-pressed]="isSaved()"
              [attr.aria-label]="(isSaved() ? 'Remove ' : 'Save ') + room().title">
        {{ isSaved() ? '♥' : '♡' }}
      </button>

      <a [routerLink]="['/rooms', room().id]" [attr.aria-label]="'View room: ' + room().title">

        @if (room().heroImagePath) {
          <img class="room-card-img" [ngSrc]="heroPath()" width="280" height="196"
               [priority]="isFirstCard()" [alt]="room().title"/>
        } @else {
          <div class="room-card-img-placeholder" aria-hidden="true">🏠</div>
        }

        <div class="room-badges">
          @if (room().isFeatured) { <span class="badge badge-featured">⭐ Featured</span> }
          @if (isNew()) { <span class="badge badge-new">New</span> }
          @if (availableNow()) { <span class="badge badge-now">⚡ Available now</span> }
          @if (room().status === 'reserved') { <span class="badge badge-reserved">Reserved</span> }
          <!-- Set only by an approved identity check in the admin queue.
               Nothing else can produce it, which is the point. -->
          @if (room().landlord?.landlordProfile?.idVerified) {
            <span class="badge badge-verified" title="This landlord's identity has been checked">✓ Verified</span>
          }
        </div>

        <div class="room-card-body">
          <div class="room-price">
            {{ room().rentCents | zarCents }}<span class="room-price-per">/mo</span>
            @if (room().billsIncluded) { <span class="bills-tag">Bills incl.</span> }
          </div>

          <h3 class="room-title">{{ room().title }}</h3>

          <p class="room-location">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" aria-hidden="true">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            {{ room().locationDisplay }}
            <span class="province-badge" [class]="provinceClass()">{{ provinceAbbr() }}</span>
          </p>

          <div class="room-features">
            <span class="room-feature">{{ roomTypeLabel() }}</span>
            @if (room().housematesCount > 0) {
              <span class="room-feature">👥 {{ room().housematesCount }} housemates</span>
            }
          </div>

          <div class="room-flags">
            @if (room().dssAccepted) { <span class="flag flag-blue">SASSA ✓</span> }
            @if (room().couplesAllowed) { <span class="flag flag-green">Couples ✓</span> }
            @if (room().petsAllowed) { <span class="flag flag-green">Pets ✓</span> }
            @if (room().guarantorAccepted) { <span class="flag flag-blue">Guarantor ✓</span> }
          </div>

          <div class="room-footer">
            <div class="landlord-info">
              <div class="avatar" [style.background]="avatarColour()">{{ landlordInitial() }}</div>
              <div>
                <div class="landlord-name">{{ landlordName() }}</div>
                @if (room().landlord?.landlordProfile?.rating; as rating) {
                  <div class="rating">★ {{ rating.toFixed(1) }}</div>
                } @else {
                  <div class="rating rating--none">New landlord</div>
                }
              </div>
            </div>
            <div class="avail-from">From {{ availableLabel() }}</div>
          </div>
        </div>
      </a>
    </article>
  `,
})
export class RoomCard {
  private savedRooms = inject(SavedRoomsService);

  /** Reactive: reflects changes made from any other card or the dashboard. */
  isSaved = computed(() => this.savedRooms.ids().includes(this.room().id));

  toggleSaved(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.savedRooms.toggle(this.room().id);
  }

  room = input.required<Room>();
  /** First card in the grid — gets eager/high-priority image loading (LCP). */
  isFirstCard = input(false);

  heroPath = computed(() => this.room().heroImagePath || '/assets/images/room-placeholder.svg');

  /** Listed within the last 7 days — drives the "New" badge in the spec design. */
  isNew = computed(() => {
    const published = this.room().publishedAt;
    if (!published) return false;
    return Date.now() - new Date(published).getTime() < 7 * 24 * 60 * 60 * 1000;
  });

  /**
   * Free now or within a fortnight — the same window the board filter uses.
   *
   * The two must agree: a badge appearing on rooms the filter excludes, or
   * missing from rooms it includes, makes both untrustworthy. If the window
   * changes, change it in rooms.service.ts and here together.
   */
  availableNow = computed(() => {
    const from = this.room().availableFrom;
    if (!from) return false;
    return new Date(from).getTime() <= Date.now() + 14 * 24 * 60 * 60 * 1000;
  });

  roomTypeLabel = computed(() => {
    const labels: Record<string, string> = {
      shared_house: '🏠 Shared house',
      en_suite: '🚿 En-suite',
      studio: '🏢 Studio',
      private: '🔑 Private room',
    };
    return labels[this.room().roomType] ?? '🏠 Room';
  });

  availableLabel = computed(() => {
    const from = new Date(this.room().availableFrom);
    return from.getTime() <= Date.now()
      ? 'now'
      : from.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
  });

  /** Province abbreviation + colour class, matching the spec's province badges. */
  private static readonly PROVINCES: Record<string, [string, string]> = {
    'Gauteng': ['GP', 'gp'],
    'Western Cape': ['WC', 'wc'],
    'KwaZulu-Natal': ['KZN', 'kzn'],
    'Eastern Cape': ['EC', 'ec'],
    'Free State': ['FS', 'gp'],
    'Limpopo': ['LP', 'kzn'],
    'Mpumalanga': ['MP', 'kzn'],
    'Northern Cape': ['NC', 'wc'],
    'North West': ['NW', 'ec'],
  };
  /** Surname is withheld on the public board — first name plus initial only. */
  landlordName = computed(() => {
    const full = this.room().landlord?.fullName?.trim();
    if (!full) return 'Landlord';
    const [first, ...rest] = full.split(/\s+/);
    return rest.length ? `${first} ${rest[rest.length - 1].charAt(0)}.` : first;
  });

  landlordInitial = computed(() => this.landlordName().charAt(0).toUpperCase());

  /** Deterministic avatar colour from the spec palette, keyed on landlord id. */
  avatarColour = computed(() => {
    const palette = ['#C04E28', '#3D7040', '#C8902A', '#7A6E60'];
    const id = this.room().landlordId ?? '';
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i)) % palette.length;
    return palette[hash];
  });

  provinceAbbr = computed(() => RoomCard.PROVINCES[this.room().province]?.[0] ?? '');
  provinceClass = computed(() => RoomCard.PROVINCES[this.room().province]?.[1] ?? 'gp');
}
