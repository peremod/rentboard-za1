import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Room } from '../../../core/models/room.model';
import { ZarCentsPipe } from '../../pipes/zar-cents.pipe';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { SavedRoomsService } from '../../../core/services/saved-rooms.service';
import { Icon } from '../icon/icon';

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
  imports: [NgOptimizedImage, RouterLink, Icon, ZarCentsPipe, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="room-card" [class.featured]="room().isFeatured">
      <!-- Outside the anchor: clicking save must not navigate to the room. -->
      <button type="button" class="save-btn" [class.saved]="isSaved()"
              (click)="toggleSaved($event)"
              [attr.aria-pressed]="isSaved()"
              [attr.aria-label]="(isSaved() ? 'Remove ' : 'Save ') + room().title">
        <app-icon name="heart" [filled]="isSaved()"/>
      </button>

      <!-- No aria-label on this anchor. It used to carry
           "View room: {title}", and an aria-label REPLACES the content it sits
           on: a screen-reader user tabbing the board heard a list of titles
           and nothing else — not the rent, not the suburb, not whether the
           room is free now. Every one of those is on the card, in text, for
           anyone who can see it. Named by its own content, the card announces
           what it shows, and WCAG 2.5.3 holds by construction rather than by
           keeping two strings in step.

           alt="" on the photo for the same reason: it repeated the title
           verbatim, two lines above the h3 that says it. -->
      <a [routerLink]="['/rooms', room().id]">

        @if (room().heroImagePath) {
          <img class="room-card-img" [ngSrc]="heroPath()" width="280" height="196"
               [priority]="isFirstCard()" alt=""/>
        } @else {
          <div class="room-card-img-placeholder" aria-hidden="true"><app-icon name="home"/></div>
        }

        <div class="room-badges">
          @if (room().isFeatured) { <span class="badge badge-featured"><app-icon name="star" filled/> Featured</span> }
          @if (isNew()) { <span class="badge badge-new">New</span> }
          <!-- ⚠️ Every card says WHEN, not just whether — Phase 10.
               A board that marks the immediate rooms and says nothing about
               the rest leaves a person to guess, and the guess is always
               "probably now". A room free in six weeks is a good room for
               somebody moving in six weeks, and a waste of a phone call for
               anybody else. -->
          @if (availableNow()) {
            <span class="badge badge-now"><app-icon name="zap"/> Available now</span>
          } @else if (availableFromLabel()) {
            <span class="badge badge-later"><app-icon name="calendar"/> {{ availableFromLabel() }}</span>
          }
          @if (room().status === 'reserved') { <span class="badge badge-reserved">Reserved</span> }
          <!-- Phase 6. On the CARD and not only on the room page: somebody
               scanning a board of thirty rooms is deciding which to open, and
               who is letting a room out changes what they are taking on. The
               room page carries the full notice. -->
          @if (room().listerType === 'sublessor') {
            <span class="badge badge-sublet"
                  title="A tenant is letting out a room in a place they rent themselves">
              Sublet
            </span>
          }
          <!-- Set only by an approved identity check in the admin queue.
               Nothing else can produce it, which is the point. -->
          @if (room().landlord?.landlordProfile?.idVerified) {
            <span class="badge badge-verified" title="This landlord's identity has been checked"><app-icon name="check"/> Verified</span>
          }
        </div>

        <div class="room-card-body">
          <div class="room-price">
            {{ room().rentCents | zarCents }}<span class="room-price-per">/mo</span>
            @if (room().billsIncluded) { <span class="bills-tag">{{ 'room.bills_included' | translate }}</span> }
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
            <span class="room-feature"><app-icon [name]="roomTypeIcon()"/> {{ roomTypeLabel() }}</span>
            @if (room().housematesCount > 0) {
              <span class="room-feature"><app-icon name="users"/> {{ room().housematesCount }} housemates</span>
            }
          </div>

          <div class="room-flags">
            @if (room().dssAccepted) { <span class="flag flag-blue">SASSA <app-icon name="check"/></span> }
            @if (room().couplesAllowed) { <span class="flag flag-green">Couples <app-icon name="check"/></span> }
            @if (room().petsAllowed) { <span class="flag flag-green">Pets <app-icon name="check"/></span> }
            @if (room().guarantorAccepted) { <span class="flag flag-blue">Guarantor <app-icon name="check"/></span> }
          </div>

          <div class="room-footer">
            <div class="landlord-info">
              <!-- The initial is the landlord's name's first letter, set in a
                   coloured circle beside the name itself. Read out, it is a
                   stutter: "D Demo L." -->
              <div class="avatar" aria-hidden="true"
                   [style.background]="avatarColour()">{{ landlordInitial() }}</div>
              <div>
                <div class="landlord-name">{{ landlordName() }}</div>
                @if (room().landlord?.landlordProfile?.rating; as rating) {
                  <div class="rating"><app-icon name="star" filled/> {{ rating.toFixed(1) }}</div>
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

  /**
   * "Available from 25 November", for a room that is not free yet.
   *
   * Null when the room is already free (the badge above says so) or when the
   * date is missing. ⚠️ A missing date cannot happen through the API —
   * `availableFrom` is required on create and the column is NOT NULL — so
   * this renders no "not confirmed" badge for a state the product cannot
   * reach. `scripts/move-in-date-drive.mjs` asserts the API refuses a room
   * without a date, which is what keeps that true.
   *
   * The year is shown only when it is not this one: "25 November" is how
   * somebody says it, and "25 November 2026" on every card is noise until
   * the date is far enough away to matter.
   */
  availableFromLabel = computed(() => {
    const from = this.room().availableFrom;
    if (!from || this.availableNow()) return null;
    const at = new Date(from);
    if (Number.isNaN(at.getTime())) return null;
    const sameYear = at.getFullYear() === new Date().getFullYear();
    return 'From ' + at.toLocaleDateString('en-ZA', {
      day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }),
      timeZone: 'Africa/Johannesburg',
    });
  });

  /**
   * ⚠️ The icon and the words are two things now.
   *
   * They were one string — '🏠 Shared house' — which is why the board still
   * rendered a house emoji twelve times after every emoji in the TEMPLATE
   * had been replaced: the glyph was in a label map in the class, where a
   * sweep of the markup cannot see it. Found by walking the rendered text
   * nodes rather than by reading the file, and that is the only way it
   * could have been found.
   *
   * A label is text and an icon is a name; a string holding both can be
   * neither translated nor restyled.
   */
  private static readonly ROOM_TYPES: Record<string, { icon: string; label: string }> = {
    shared_house: { icon: 'users', label: 'Shared house' },
    en_suite: { icon: 'shower', label: 'En-suite' },
    studio: { icon: 'building', label: 'Studio' },
    private: { icon: 'key', label: 'Private room' },
  };

  roomTypeIcon = computed(() =>
    RoomCard.ROOM_TYPES[this.room().roomType]?.icon ?? 'home');

  roomTypeLabel = computed(() =>
    RoomCard.ROOM_TYPES[this.room().roomType]?.label ?? 'Room');

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
    const palette = ['#AD4222', '#3D7040', '#C8902A', '#7A6E60'];
    const id = this.room().landlordId ?? '';
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i)) % palette.length;
    return palette[hash];
  });

  provinceAbbr = computed(() => RoomCard.PROVINCES[this.room().province]?.[0] ?? '');
  provinceClass = computed(() => RoomCard.PROVINCES[this.room().province]?.[1] ?? 'gp');
}
