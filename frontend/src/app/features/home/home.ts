import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, OnDestroy, OnInit, ViewChild,
  afterNextRender, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RoomsService } from '../../core/services/rooms.service';
import { Room, SA_PROVINCES } from '../../core/models/room.model';
import { RoomCard } from '../../shared/components/room-card/room-card';
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
  imports: [FormsModule, RouterLink, RoomCard, SkeletonCard, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero">
      <div class="hero-inner">
        <div class="hero-eyebrow">🇿🇦 {{ 'hero.eyebrow' | translate }}</div>
        <h1>{{ 'hero.title_line1' | translate }}<br/><em>{{ 'hero.title_line2' | translate }}</em></h1>
        <p class="hero-sub">
          No estate agents. No fees to apply. Shared houses, en-suites, studios and private
          rooms — posted directly by landlords across South Africa.
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
                 [(ngModel)]="searchTerm" (ngModelChange)="onSearchChange()"/>
        </div>
        <select class="search-select" [(ngModel)]="province" (ngModelChange)="onFilterChange()">
          <option value="">{{ 'search.all_provinces' | translate }}</option>
          @for (p of provinces; track p) { <option [value]="p">{{ p }}</option> }
        </select>
        <select class="search-select" [(ngModel)]="roomType" (ngModelChange)="onFilterChange()">
          <option value="">{{ 'search.all_room_types' | translate }}</option>
          <option value="shared_house">🏠 Shared house</option>
          <option value="en_suite">🚿 En-suite</option>
          <option value="studio">🏢 Studio</option>
          <option value="private">🔑 Private room</option>
        </select>
        <select class="search-select" [(ngModel)]="maxRentCents" (ngModelChange)="onFilterChange()">
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
          <h3>{{ 'filters.title' | translate }}</h3>
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
            <input type="checkbox" [(ngModel)]="studentsWelcome" (ngModelChange)="onFilterChange()"/>
            Students welcome
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
          <div class="filter-label">Housemates</div>
          <select class="filter-select" [(ngModel)]="housemates" (ngModelChange)="onFilterChange()">
            <option value="">Any</option>
            <option value="0">Living alone</option>
            <option value="1-2">1–2 housemates</option>
            <option value="3-4">3–4 housemates</option>
            <option value="5">5 or more</option>
          </select>
        </div>

        <div class="filter-group">
          <div class="filter-label">Sort by</div>
          <select class="filter-select" [(ngModel)]="sortBy" (ngModelChange)="onFilterChange()">
            <option value="newest">Newest first</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="featured">Featured first</option>
          </select>
        </div>

        <!-- Drawer actions: visible only while the panel is a bottom sheet. -->
        <div class="filter-drawer-actions">
          <button type="button" class="btn btn-outline" (click)="clearFilters()">Clear</button>
          <button type="button" class="btn btn-primary" (click)="filtersOpen.set(false)">
            Show results
          </button>
        </div>
      </aside>

      <main class="board__main">
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

          <p class="results-count">
            @if (loading() && rooms().length === 0) { Loading rooms… }
            @else { {{ 'found_rooms' | translate:{count: total()} }} }
          </p>
        </div>

        @if (loading() && rooms().length === 0) {
          <div class="room-grid">
            @for (i of [1,2,3,4,5,6]; track i) { <app-skeleton-card/> }
          </div>
        } @else if (rooms().length === 0) {
          <div class="empty-state">
            <h3>No rooms match your filters</h3>
            <p>Try widening your search, or clear the filters to see everything available.</p>
            <button type="button" class="btn btn-outline" (click)="clearFilters()">Clear all filters</button>
          </div>
        } @else {
          <div class="room-grid">
            @for (room of rooms(); track room.id; let i = $index) {
              <app-room-card [room]="room" [isFirstCard]="i === 0"/>
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
  private injector = inject(Injector);

  rooms = signal<Room[]>([]);
  total = signal(0);
  loading = signal(true);
  loadingMore = signal(false);
  hasMore = signal(true);
  page = 1;
  /** Mobile filter drawer. Ignored above 860px, where the panel is a sidebar. */
  filtersOpen = signal(false);

  provinces = SA_PROVINCES;
  searchTerm = '';
  province = '';
  roomType = '';
  billsIncluded = false;
  couplesAllowed = false;
  dssAccepted = false;
  guarantorAccepted = false;
  petsAllowed = false;
  /**
   * UI-only for now: there is no students flag on the Room model or the
   * filters DTO, and the API runs forbidNonWhitelisted, so sending it would
   * 400. Shown because the design lists it; wire it up when the field exists.
   */
  studentsWelcome = false;
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
  }

  /** Count of non-default filters — shown on the mobile Filters button. */
  activeFilterCount(): number {
    return [
      this.province, this.roomType, this.maxRentCents, this.housemates,
      this.billsIncluded, this.couplesAllowed, this.studentsWelcome,
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
    this.couplesAllowed = false;
    this.studentsWelcome = false;
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

  onSearchChange() {
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => { this.page = 1; this.fetchRooms(); }, 400);
  }

  onFilterChange() {
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
