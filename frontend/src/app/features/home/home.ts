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
        <p class="hero-sub">{{ 'hero.subtitle' | translate }}</p>
        <div class="hero-ctas">
          <a routerLink="/auth/register" class="btn btn-primary btn-lg">{{ 'hero.cta' | translate }}</a>
        </div>
        <div class="hero-stats">
          <div class="hero-stat"><strong>{{ total() }}</strong><span>rooms available</span></div>
          <div class="hero-stat"><strong>Free</strong><span>to apply</span></div>
          <div class="hero-stat"><strong>9</strong><span>provinces covered</span></div>
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
          <option value="shared_house">Shared house</option>
          <option value="en_suite">En-suite</option>
          <option value="studio">Studio</option>
          <option value="private">Private room</option>
        </select>
      </div>
    </div>

    <div class="board">
      <aside class="filter-panel">
        <h3>{{ 'filters.title' | translate }}</h3>
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
      </aside>

      <main class="board__main">
        <div class="results-header">
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

  provinces = SA_PROVINCES;
  searchTerm = '';
  province = '';
  roomType = '';
  billsIncluded = false;
  couplesAllowed = false;
  dssAccepted = false;
  guarantorAccepted = false;
  petsAllowed = false;

  @ViewChild('scrollSentinel') sentinel!: ElementRef;
  private observer?: IntersectionObserver;
  private searchDebounce: ReturnType<typeof setTimeout> | undefined;

  ngOnInit() {
    this.fetchRooms();
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

  clearFilters() {
    this.searchTerm = this.province = this.roomType = '';
    this.billsIncluded = this.couplesAllowed = this.dssAccepted = this.guarantorAccepted = this.petsAllowed = false;
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
