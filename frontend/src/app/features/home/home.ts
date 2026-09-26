import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, OnDestroy, OnInit, ViewChild, computed,
  afterNextRender, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RoomsService } from '../../core/services/rooms.service';
import { AlertsService } from '../../core/services/alerts.service';
import { AuthService } from '../../core/services/auth.service';
import { Room, SA_PROVINCES } from '../../core/models/room.model';
import { RoomCard } from '../../shared/components/room-card/room-card';
import { AdSlot } from '../../shared/components/ad-slot/ad-slot';
import { SkeletonCard } from '../../shared/components/skeleton-card/skeleton-card';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

/**
 * Home — the public notice board. Hero + search bar + sidebar filters +
 * infinite-scroll room grid, all driven by RoomsService.
 *
 * Filters here are local component fields (not RoomsService.filters) since
 * this one component owns both the search bar and the sidebar for now;
 * the shared signal is for when they split into separate components later.
 */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule, RouterLink, RoomCard, SkeletonCard, TranslatePipe, AdSlot],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero" [class.hero--splash]="splash()">
      <div class="hero-inner">
        <div class="hero-eyebrow">🇿🇦 {{ 'hero.eyebrow' | translate }}</div>
        <!-- Alternates between the two audiences. A board serving both needs
             to speak to both; one fixed message tells half the visitors this
             site is not for them. -->
        <h1 class="hero-headline" [class.hero-headline--swap]="swapping()">
          {{ heroMessage().title }}<br/><em>{{ heroMessage().emphasis }}</em>
        </h1>
        <p class="hero-sub hero-headline" [class.hero-headline--swap]="swapping()">
          {{ heroMessage().sub }}
        </p>
        <div class="hero-ctas">
          <a href="#board" class="btn btn-primary btn-lg" (click)="scrollToBoard($event)">Browse rooms</a>
          <a routerLink="/auth/register" class="btn btn-ghost btn-lg">List a room free →</a>
        </div>
        <div class="hero-stats">
          <div class="hero-stat"><strong>{{ total() }}</strong><span>rooms available</span></div>
          <div class="hero-stat"><strong>{{ landlordCount() }}</strong><span>verified landlords</span></div>
          <div class="hero-stat"><strong>Free</strong><span>to apply</span></div>
          <div class="hero-stat"><strong>9 provinces</strong><span>and growing</span></div>
        </div>
      </div>

      @if (splash()) {
        <!-- A cue, not an automatic jump. Auto-scrolling takes control away
             from someone who arrived meaning to search, and screen readers
             have no sensible way to follow it. -->
        <!-- The accessible name has to CONTAIN the visible text, or voice
             control breaks: someone saying "click 245 rooms" finds nothing,
             because the only name the button exposed was "Skip to rooms"
             (WCAG 2.5.3, and axe's label-content-name-mismatch). -->
        <button type="button" class="hero-scroll-cue" (click)="scrollToBoard($event)"
                [attr.aria-label]="'Skip to ' + roomCount() + ' rooms'">
          <span>{{ roomCount() }} rooms</span>
          <span class="hero-scroll-cue__chevron" aria-hidden="true">⌄</span>
        </button>
      }
    </section>

    <div class="trust-strip">
      <div class="trust-item"><span class="trust-icon">🔒</span>POPIA Compliant</div>
      <div class="trust-item"><span class="trust-icon">🏛️</span>Rental Housing Act Aligned</div>
      <div class="trust-item"><span class="trust-icon">🚫</span>No Agent Fees</div>
      <div class="trust-item"><span class="trust-icon">📱</span>WhatsApp Notifications</div>
    </div>

    <div class="search-wrap">
      <div class="search-bar">
        <div class="search-input-wrap">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input class="search-input" type="text" [placeholder]="'search.placeholder' | translate"
                 [(ngModel)]="searchTerm" (ngModelChange)="onSearchChange()"
                 (focus)="suggestOpen.set(true)" (blur)="closeSuggestions()"
                 autocomplete="off" role="combobox"
                 [attr.aria-expanded]="suggestOpen() && suggestions().length > 0"
                 aria-autocomplete="list"/>

          @if (suggestOpen() && suggestions().length > 0) {
            <ul class="search-suggest" role="listbox">
              @for (s of suggestions(); track s.label) {
                <li>
                  <!-- mousedown, not click: blur fires first and would close
                       the list before a click ever lands. -->
                  <button type="button" role="option" [attr.aria-selected]="false"
                          (mousedown)="chooseSuggestion(s)">
                    <span class="search-suggest__place">{{ s.label }}</span>
                    <span class="search-suggest__count">
                      {{ s.roomCount }} room{{ s.roomCount === 1 ? '' : 's' }}
                    </span>
                  </button>
                </li>
              }
            </ul>
          }
        </div>
        <select class="search-select" [attr.aria-label]="'search.label_province' | translate"
                [(ngModel)]="province" (ngModelChange)="onFilterChange()">
          <option value="">{{ 'search.all_provinces' | translate }}</option>
          @for (p of provinces; track p) { <option [value]="p">{{ p }}</option> }
        </select>
        <select class="search-select" [attr.aria-label]="'search.label_room_type' | translate"
                [(ngModel)]="roomType" (ngModelChange)="onFilterChange()">
          <option value="">{{ 'search.all_room_types' | translate }}</option>
          <option value="shared_house">🏠 Shared house</option>
          <option value="en_suite">🚿 En-suite</option>
          <option value="studio">🏢 Studio</option>
          <option value="private">🔑 Private room</option>
        </select>
        <select class="search-select" [attr.aria-label]="'search.label_max_rent' | translate"
                [(ngModel)]="maxRentCents" (ngModelChange)="onFilterChange()">
          @for (p of priceOptions; track p.value) {
            <option [value]="p.value">{{ p.label }}</option>
          }
        </select>
      </div>
    </div>

    <div class="board" id="board">
      <div class="filter-drawer-overlay" [class.open]="filtersOpen()"
           (click)="filtersOpen.set(false)" aria-hidden="true"></div>

      <aside class="filter-panel" id="filter-panel" [class.open]="filtersOpen()">
        <div class="filter-drawer-handle" aria-hidden="true"></div>
        <div class="filter-drawer-header">
          <h2>{{ 'filters.title' | translate }}</h2>
          <button type="button" class="filter-drawer-close" (click)="filtersOpen.set(false)"
                  aria-label="Close filters">✕</button>
        </div>

        <div class="filter-group">
          <div class="filter-label">Province</div>
          <div class="filter-pill-wrap">
            @for (p of provincePills; track p.value) {
              <button type="button" class="filter-pill" [class.active]="province === p.value"
                      (click)="province = p.value; onFilterChange()">{{ p.label }}</button>
            }
          </div>
        </div>

        <div class="filter-group">
          <div class="filter-label">Room type</div>
          <div class="filter-pill-wrap">
            @for (t of roomTypePills; track t.value) {
              <button type="button" class="filter-pill" [class.active]="roomType === t.value"
                      (click)="roomType = t.value; onFilterChange()">{{ t.label }}</button>
            }
          </div>
        </div>

        <div class="filter-group">
          <div class="filter-label">I need</div>
          <label class="filter-check">
            <input type="checkbox" [(ngModel)]="billsIncluded" (ngModelChange)="onFilterChange()"/>
            {{ 'filters.bills_included' | translate }}
          </label>
          <label class="filter-check">
            <input type="checkbox" [(ngModel)]="couplesAllowed" (ngModelChange)="onFilterChange()"/>
            {{ 'filters.couples_welcome' | translate }}
          </label>
          <label class="filter-check">
            <input type="checkbox" [(ngModel)]="dssAccepted" (ngModelChange)="onFilterChange()"/>
            {{ 'filters.dss_accepted' | translate }}
          </label>
          <label class="filter-check">
            <input type="checkbox" [(ngModel)]="guarantorAccepted" (ngModelChange)="onFilterChange()"/>
            {{ 'filters.guarantor_accepted' | translate }}
          </label>
          <label class="filter-check">
            <input type="checkbox" [(ngModel)]="petsAllowed" (ngModelChange)="onFilterChange()"/>
            {{ 'filters.pets_allowed' | translate }}
          </label>
        </div>

        <div class="filter-group">
          <label class="filter-label" for="filter-housemates">Housemates</label>
          <select id="filter-housemates" class="filter-select"
                  [(ngModel)]="housemates" (ngModelChange)="onFilterChange()">
            <option value="">Any</option>
            <option value="0">Living alone</option>
            <option value="1-2">1–2 housemates</option>
            <option value="3-4">3–4 housemates</option>
            <option value="5">5 or more</option>
          </select>
        </div>

        <div class="filter-group">
          <label class="filter-label" for="filter-sort">Sort by</label>
          <select id="filter-sort" class="filter-select"
                  [(ngModel)]="sortBy" (ngModelChange)="onFilterChange()">
            <option value="newest">Newest first</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="featured">Featured first</option>
          </select>
        </div>

        <!-- Turns the current filters into a standing alert. Only offered to
             signed-in tenants: a landlord does not want alerts about rooms,
             and a signed-out visitor has nowhere to send them. -->
        @if (auth.isTenant()) {
          <div class="filter-alert-cta">
            @if (searchSaved()) {
              <p class="field-hint">
                ✅ Alert saved. Manage it in
                <a routerLink="/tenant/dashboard">your dashboard</a>.
              </p>
            } @else {
              <button type="button" class="btn btn-outline"
                      [disabled]="savingSearch()" (click)="saveCurrentSearch()">
                {{ savingSearch() ? 'Saving…' : '🔔 Alert me about rooms like this' }}
              </button>
              @if (saveSearchError()) {
                <p class="field-error" role="alert">{{ saveSearchError() }}</p>
              }
            }
          </div>
        }

        <!-- Contextual placement: matches the province and room type being
             browsed, never the person browsing. -->
        <app-ad-slot placement="board_sidebar"
                     [province]="province || undefined"
                     [city]="searchTerm.trim() || undefined"
                     [roomType]="roomType || undefined"/>

        <!-- Drawer actions: visible only while the panel is a bottom sheet. -->
        <div class="filter-drawer-actions">
          <button type="button" class="btn btn-outline" (click)="clearFilters()">Clear</button>
          <button type="button" class="btn btn-primary" (click)="filtersOpen.set(false)">
            Show results
          </button>
        </div>
      </aside>

      <main class="board__main">
        <!-- Above the results, not inside the filter drawer. Someone whose
             lease ended this week is the most urgent visitor the board has,
             and burying this behind a Filters button costs them two taps. -->
        <div class="quick-filters">
          <button type="button"
                  class="quick-chip"
                  [class.quick-chip--on]="availableNow"
                  (click)="toggleAvailableNow()">
            ⚡ Available now
          </button>
          @if (availableNow) {
            <span class="quick-filters__note">Free now or within two weeks</span>
          }
        </div>

        <div class="results-header">
          <button type="button" class="filter-toggle-btn" (click)="filtersOpen.set(true)"
                  [attr.aria-expanded]="filtersOpen()" aria-controls="filter-panel">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" aria-hidden="true">
              <line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/>
              <line x1="10" y1="18" x2="14" y2="18"/>
            </svg>
            Filters
            @if (activeFilterCount() > 0) {
              <span class="filter-toggle-count">{{ activeFilterCount() }}</span>
            }
          </button>

          <select class="sort-select" [(ngModel)]="sortBy" (ngModelChange)="onFilterChange()"
                  aria-label="Sort results">
            <option value="newest">Newest first</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="featured">Featured first</option>
          </select>

          <!-- h2, not p. The results are a section of the page and had no
               heading of any kind, so every room card's h3 followed the hero's
               h1 directly — a skipped level on the busiest page in the site.
               The empty state below already carries an h2 for exactly this
               reason; nothing gave the populated state one, because no check
               had ever seen the board with rooms on it.

               The count is the heading: it is the visible text that names the
               region, so making it the heading beats inventing a hidden one. -->
          <h2 class="results-count">
            @if (loading() && rooms().length === 0) { Loading rooms… }
            @else { {{ 'found_rooms' | translate:{count: total()} }} }
          </h2>
        </div>

        @if (loading() && rooms().length === 0) {
          <div class="room-grid">
            @for (i of [1,2,3,4,5,6]; track i) { <app-skeleton-card/> }
          </div>
        } @else if (rooms().length === 0) {
          <div class="empty-state">
            <!-- h2, not h3. The only heading above it in the results column is
                 the filter drawer's, and on a phone that drawer is off-canvas
                 and so invisible to the heading outline — which made this jump
                 straight from the hero h1 to an h3. -->
            <h2>No rooms match your filters</h2>
            <p>Try widening your search, or clear the filters to see everything available.</p>
            <button type="button" class="btn btn-outline" (click)="clearFilters()">Clear all filters</button>
          </div>
        } @else {
          <div class="room-grid">
            @for (room of rooms(); track room.id; let i = $index) {
              <app-room-card [room]="room" [isFirstCard]="i === 0"/>

              <!-- Every sixth card, not just the first six. The slot index is
                   passed so each one requests independently and the rotation
                   gives a different advertiser rather than the same ad six
                   times down the page. -->
              @if (showsAdAfter(i)) {
                <app-ad-slot placement="board_inline"
                             [slotIndex]="adSlotNumber(i)"
                             [province]="province || undefined"
                             [city]="searchTerm.trim() || undefined"
                             [roomType]="roomType || undefined"/>
              }
            }
          </div>
        }

        <div #scrollSentinel style="height:1px"></div>
        @if (loadingMore()) {
          <div class="room-grid" style="margin-top:1rem">
            @for (i of [1,2,3]; track i) { <app-skeleton-card/> }
          </div>
        }
      </main>
    </div>
  `,
  // No component styles: this page is laid out entirely by the global spec
  // stylesheet and the responsive layer. Scoped styles here previously
  // overrode both (Angular's emulated encapsulation makes them more
  // specific), which is why the board ignored every breakpoint.
})
export class Home implements OnInit, OnDestroy {
  private roomsService = inject(RoomsService);
  private alerts = inject(AlertsService);
  auth = inject(AuthService);
  private destroyRef = inject(DestroyRef);
  private injector = inject(Injector);

  rooms = signal<Room[]>([]);
  total = signal(0);
  loading = signal(true);
  loadingMore = signal(false);
  hasMore = signal(true);
  page = 1;
  /** Mobile filter drawer. Ignored above 860px, where the panel is a sidebar. */
  filtersOpen = signal(false);
  /**
   * Two audiences, alternating. Starts on whichever suits the visitor when we
   * can tell — a signed-in landlord should not be pitched rooms to rent.
   */
  private readonly heroMessages = [
    {
      title: 'Find your next room.',
      emphasis: 'Direct from landlords.',
      sub: 'No estate agents. No fees to apply. Shared houses, en-suites, studios and private rooms across South Africa.',
    },
    {
      title: 'Find your next tenant.',
      emphasis: 'Free to list, always.',
      sub: 'Post a room in minutes, shortlist applicants, and let it without paying commission to anyone.',
    },
  ];

  /**
   * On a phone the hero fills the screen and the board sits one swipe below.
   *
   * Measured before this: the first room card sat 1156px down a 528px
   * viewport, so a tenant scrolled past two screens of marketing to reach the
   * thing they came for. A full-height hero is not fewer pixels, but it is one
   * deliberate swipe with a visible count of what is below, rather than an
   * indeterminate scroll through stacked sections.
   *
   * Skipped for anyone who has been here before: a returning tenant wants
   * rooms, not the pitch. Desktop is unaffected — there is room for both.
   */
  /**
   * Whether the hero fills the screen before the board.
   *
   * On a phone the first room card sat over two screens down, behind the hero,
   * search bar and filters — on a board whose purpose is showing rooms. This
   * makes the hero exactly one screen instead: a single brand impression, then
   * one swipe to the listings.
   *
   * Deliberately not a timed overlay. A splash that hides the board delays the
   * thing people came for, damages Largest Contentful Paint, and irritates
   * anyone arriving for the second time. The board stays in the DOM
   * throughout — this only changes how much room the hero takes.
   */
  splash = signal(false);

  /** Shown on the cue, so it says what is below rather than just 'scroll'. */
  roomCount = computed(() => this.rooms().length);

  heroIndex = signal(0);
  swapping = signal(false);
  heroMessage = () => this.heroMessages[this.heroIndex()];

  savingSearch = signal(false);
  searchSaved = signal(false);
  saveSearchError = signal<string | null>(null);

  provinces = SA_PROVINCES;
  searchTerm = '';
  suggestions = signal<{ city: string; province: string; label: string; roomCount: number }[]>([]);
  suggestOpen = signal(false);
  private suggestTimer?: ReturnType<typeof setTimeout>;
  province = '';
  roomType = '';
  billsIncluded = false;
  availableNow = false;
  couplesAllowed = false;
  dssAccepted = false;
  guarantorAccepted = false;
  petsAllowed = false;
  /*
   * There is deliberately no `studentsWelcome` here. The design lists the
   * filter, but there is no students flag on the Room model or the filters
   * DTO, so it could never narrow anything — and because it was counted in
   * activeFilterCount() the UI told people a filter was active while the
   * board stayed exactly the same. Offering a control that does nothing is
   * worse than not offering it, which is the same call this project already
   * made for untranslated locales and the paused pricing links.
   *
   * To build it properly: a boolean on Room, the landlord wizard, the filters
   * DTO, the query, then the checkbox back here with a translated label.
   */
  maxRentCents = '';
  housemates = '';
  sortBy: 'newest' | 'price_asc' | 'price_desc' | 'featured' = 'newest';

  /** Province pills use short labels; the API needs the full name. */
  readonly provincePills: { label: string; value: string }[] = [
    { label: 'All', value: '' },
    { label: 'Gauteng', value: 'Gauteng' },
    { label: 'W. Cape', value: 'Western Cape' },
    { label: 'KZN', value: 'KwaZulu-Natal' },
    { label: 'E. Cape', value: 'Eastern Cape' },
  ];

  readonly roomTypePills: { label: string; value: string }[] = [
    { label: 'All', value: '' },
    { label: 'Shared', value: 'shared_house' },
    { label: 'En-suite', value: 'en_suite' },
    { label: 'Studio', value: 'studio' },
    { label: 'Private', value: 'private' },
  ];

  readonly priceOptions: { label: string; value: string }[] = [
    { label: 'Any price', value: '' },
    { label: 'Up to R3,000/mo', value: '300000' },
    { label: 'Up to R5,000/mo', value: '500000' },
    { label: 'Up to R8,000/mo', value: '800000' },
    { label: 'Up to R12,000/mo', value: '1200000' },
  ];

  @ViewChild('scrollSentinel') sentinel!: ElementRef;
  private observer?: IntersectionObserver;
  private searchDebounce: ReturnType<typeof setTimeout> | undefined;

  ngOnInit() {
    this.fetchRooms();

    // A landlord already knows they can list; lead with the tenant message
    // for everyone else, and for signed-out visitors.
    if (this.auth.isLandlord()) this.heroIndex.set(1);

    afterNextRender(() => this.decideSplash(), { injector: this.injector });

    // Browser only: an interval on the server would never be cleared, and the
    // prerendered HTML should just carry the first message.
    afterNextRender(() => this.startHeroRotation(), { injector: this.injector });
  }

  /**
   * Splash on a phone, for first-time visitors only.
   *
   * The flag is a plain UI preference in localStorage, not a tracker: it says
   * 'this browser has seen the home page', carries no identifier, and is never
   * sent anywhere.
   */
  private decideSplash() {
    const isPhone = window.matchMedia('(max-width: 700px)').matches;
    if (!isPhone) return;

    try {
      const seen = localStorage.getItem('rb_seen_home');
      if (!seen) {
        this.splash.set(true);
        localStorage.setItem('rb_seen_home', '1');
      }
    } catch {
      // Private browsing can refuse localStorage. Showing the splash is the
      // safe default — it is one swipe, not a barrier.
      this.splash.set(true);
    }
  }

  private startHeroRotation() {
    // Long enough to read, short enough that someone scanning the page sees
    // both. The class toggle drives a CSS fade so it is not a hard cut.
    const timer = setInterval(() => {
      this.swapping.set(true);
      setTimeout(() => {
        this.heroIndex.update((i) => (i + 1) % this.heroMessages.length);
        this.swapping.set(false);
      }, 260);
    }, 7000);

    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  /**
   * Saves the current filter set as a standing alert. The name is generated
   * from the filters so the tenant is not made to invent one — they can see
   * what it means at a glance in the dashboard.
   */
  saveCurrentSearch() {
    this.savingSearch.set(true);
    this.saveSearchError.set(null);

    this.alerts.create({
      name: this.describeCurrentFilters(),
      province: this.province || undefined,
      city: this.searchTerm.trim() || undefined,
      roomType: (this.roomType || undefined) as any,
      maxRentCents: this.maxRentCents ? +this.maxRentCents : undefined,
      billsIncluded: this.billsIncluded || undefined,
      availableNow: this.availableNow || undefined,
      couplesAllowed: this.couplesAllowed || undefined,
      dssAccepted: this.dssAccepted || undefined,
      guarantorAccepted: this.guarantorAccepted || undefined,
      petsAllowed: this.petsAllowed || undefined,
      frequency: 'instant',
      isActive: true,
      notifyEmail: true,
      notifyWhatsapp: false,
    } as any).subscribe({
      next: () => {
        this.savingSearch.set(false);
        this.searchSaved.set(true);
      },
      error: (err) => {
        this.savingSearch.set(false);
        this.saveSearchError.set(err?.error?.message ?? 'Could not save that alert.');
      },
    });
  }

  private describeCurrentFilters(): string {
    const bits: string[] = [];
    if (this.roomType) {
      bits.push({
        shared_house: 'Shared house',
        en_suite: 'En-suite',
        studio: 'Studio',
        private: 'Private room',
      }[this.roomType] ?? 'Room');
    } else {
      bits.push('Rooms');
    }
    if (this.searchTerm.trim()) bits.push(`in ${this.searchTerm.trim()}`);
    else if (this.province) bits.push(`in ${this.province}`);
    if (this.maxRentCents) bits.push(`under R${(+this.maxRentCents / 100).toLocaleString('en-ZA')}`);
    return bits.join(' ').slice(0, 80);
  }

  /** One ad per six rooms — dense enough to be worth selling, sparse enough
   *  that the board still reads as a room board. */
  private readonly AD_EVERY = 6;

  /**
   * True when an ad belongs after this card.
   *
   * Every sixth card, plus the last card on a short board so a new board with
   * three listings still shows one. The trailing case is skipped when the last
   * card is already a multiple of six, or two ads would land together.
   */
  showsAdAfter(index: number): boolean {
    const count = this.rooms().length;
    if (count === 0) return false;

    const isInterval = (index + 1) % this.AD_EVERY === 0;
    const isShortBoardEnd = count < this.AD_EVERY && index === count - 1;
    return isInterval || isShortBoardEnd;
  }

  /** Which ad slot this is, so each requests its own campaign. */
  adSlotNumber(index: number): number {
    return Math.floor(index / this.AD_EVERY);
  }

  /** Count of non-default filters — shown on the mobile Filters button. */
  activeFilterCount(): number {
    return [
      this.province, this.roomType, this.maxRentCents, this.housemates,
      this.billsIncluded, this.availableNow, this.couplesAllowed,
      this.dssAccepted, this.guarantorAccepted, this.petsAllowed,
    ].filter(Boolean).length;
  }

  clearFilters() {
    this.province = '';
    this.roomType = '';
    this.maxRentCents = '';
    this.housemates = '';
    this.searchTerm = '';
    this.billsIncluded = false;
    this.availableNow = false;
    this.couplesAllowed = false;
    this.dssAccepted = false;
    this.guarantorAccepted = false;
    this.petsAllowed = false;
    this.sortBy = 'newest';
    this.onFilterChange();   // resets page and refetches
  }

  /** Distinct landlords across the loaded rooms — the spec's second hero stat. */
  landlordCount() {
    return new Set(this.rooms().map((r) => r.landlordId)).size;
  }

  /** Hero "Browse rooms" jumps to the board rather than navigating away. */
  scrollToBoard(event: Event) {
    event.preventDefault();
    document.getElementById('board')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  constructor() {
    // IntersectionObserver is a browser-only API. ngAfterViewInit also runs
    // during server-side rendering, where it is undefined and throws,
    // crashing the SSR process. afterNextRender only runs in the browser.
    afterNextRender(() => {
      if (!this.sentinel?.nativeElement) return;
      this.observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !this.loading() && this.hasMore()) {
          this.page++;
          this.fetchRooms(true);
        }
      }, { threshold: 0.1 });
      this.observer.observe(this.sentinel.nativeElement);
    }, { injector: this.injector });
  }

  ngOnDestroy() {
    // Both were previously leaked on navigation away from the page.
    this.observer?.disconnect();
    clearTimeout(this.searchDebounce);
  }

  /** Picks a suggestion: fills the city and its province, then searches. */
  chooseSuggestion(s: { city: string; province: string }) {
    this.searchTerm = s.city;
    this.province = s.province;
    this.suggestOpen.set(false);
    this.suggestions.set([]);
    this.onFilterChange();
  }

  /** Delayed so a click on the list still registers before it closes. */
  closeSuggestions() {
    setTimeout(() => this.suggestOpen.set(false), 150);
  }

  private fetchSuggestions() {
    const term = this.searchTerm.trim();
    if (term.length < 2) {
      this.suggestions.set([]);
      return;
    }
    this.roomsService.suggestLocations(term).subscribe({
      next: (list) => this.suggestions.set(list),
      error: () => this.suggestions.set([]),
    });
  }

  onSearchChange() {
    // Two debounces on purpose: suggestions should feel immediate, while the
    // full result fetch can wait until typing actually stops.
    clearTimeout(this.suggestTimer);
    this.suggestTimer = setTimeout(() => this.fetchSuggestions(), 220);
    this.suggestOpen.set(true);
    this.searchSaved.set(false);

    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => { this.page = 1; this.fetchRooms(); }, 400);
  }

  /** The urgent search: rooms free now or very soon. */
  toggleAvailableNow() {
    this.availableNow = !this.availableNow;
    // No tracking call here: Home does not inject AnalyticsService, and the
    // board.filtered event is recorded by the filter panel already. Counting
    // it twice would inflate the funnel.
    this.onFilterChange();
  }

  onFilterChange() {
    // The saved confirmation belongs to the old filter set.
    this.searchSaved.set(false);
    this.page = 1;
    this.fetchRooms();
  }

  private fetchRooms(append = false) {
    append ? this.loadingMore.set(true) : this.loading.set(true);

    this.roomsService.getRooms({
      search: this.searchTerm || undefined,
      province: this.province || undefined,
      roomType: (this.roomType as any) || undefined,
      billsIncluded: this.billsIncluded || undefined,
      availableNow: this.availableNow || undefined,
      couplesAllowed: this.couplesAllowed || undefined,
      dssAccepted: this.dssAccepted || undefined,
      guarantorAccepted: this.guarantorAccepted || undefined,
      petsAllowed: this.petsAllowed || undefined,
      maxRentCents: this.maxRentCents ? +this.maxRentCents : undefined,
      sortBy: this.sortBy,
      page: this.page,
      limit: 12,
    }).subscribe({
    next: (res) => {
      this.rooms.update((prev) => (append ? [...prev, ...res.data] : res.data));
      this.total.set(res.total);
      this.hasMore.set(res.hasMore);
      this.loading.set(false);
      this.loadingMore.set(false);
    },
    error: () => {
      // Without an error callback an API failure becomes an unhandled
      // rejection, which terminates the SSR Node process outright.
      this.loading.set(false);
      this.loadingMore.set(false);
      this.hasMore.set(false);
    },
    });
  }
}
