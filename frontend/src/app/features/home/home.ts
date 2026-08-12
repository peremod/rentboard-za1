import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnInit, ViewChild,
  inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RoomsService } from '../../core/services/rooms.service';
import { Room, SA_PROVINCES } from '../../core/models/room.model';
import { RoomCard } from '../../shared/components/room-card/room-card';
import { SkeletonCard } from '../../shared/components/skeleton-card/skeleton-card';

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
  imports: [FormsModule, RouterLink, RoomCard, SkeletonCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero">
      <div class="hero__inner">
        <div class="hero__eyebrow">🇿🇦 South Africa's room-letting notice board</div>
        <h1>Find your next room.<br/><em>Direct from landlords.</em></h1>
        <p>No estate agents. No fees to apply. Rooms posted directly by landlords across South Africa.</p>
        <p class="hero__cta">
          <a routerLink="/auth/register" class="btn-primary">List a room free →</a>
        </p>
      </div>
    </section>

    <div class="search-bar">
      <input
        type="text" placeholder="Search by city, suburb or area…"
        [(ngModel)]="searchTerm" (ngModelChange)="onSearchChange()"
      />
      <select [(ngModel)]="province" (ngModelChange)="onFilterChange()">
        <option value="">All provinces</option>
        @for (p of provinces; track p) { <option [value]="p">{{ p }}</option> }
      </select>
      <select [(ngModel)]="roomType" (ngModelChange)="onFilterChange()">
        <option value="">All room types</option>
        <option value="shared_house">Shared house</option>
        <option value="en_suite">En-suite</option>
        <option value="studio">Studio</option>
        <option value="private">Private room</option>
      </select>
    </div>

    <div class="board">
      <aside class="board__sidebar">
        <h3>Filters</h3>
        <label><input type="checkbox" [(ngModel)]="billsIncluded" (ngModelChange)="onFilterChange()"/> Bills included</label>
        <label><input type="checkbox" [(ngModel)]="couplesAllowed" (ngModelChange)="onFilterChange()"/> Couples welcome</label>
        <label><input type="checkbox" [(ngModel)]="dssAccepted" (ngModelChange)="onFilterChange()"/> DSS / SASSA accepted</label>
        <label><input type="checkbox" [(ngModel)]="guarantorAccepted" (ngModelChange)="onFilterChange()"/> Guarantor accepted</label>
        <label><input type="checkbox" [(ngModel)]="petsAllowed" (ngModelChange)="onFilterChange()"/> Pets allowed</label>
      </aside>

      <main class="board__main">
        <p class="board__count">
          @if (loading() && rooms().length === 0) { Loading rooms… }
          @else { <strong>{{ total() }}</strong> room{{ total() !== 1 ? 's' : '' }} found }
        </p>

        @if (loading() && rooms().length === 0) {
          <div class="room-grid">
            @for (i of [1,2,3,4,5,6]; track i) { <app-skeleton-card/> }
          </div>
        } @else if (rooms().length === 0) {
          <div class="empty-state">
            <p>No rooms match your filters.</p>
            <button type="button" (click)="clearFilters()">Clear all filters</button>
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
  styles: [`
    .hero { background: #1A1410; padding: 3rem 1.25rem; text-align: left; }
    .hero__inner { max-width: 700px; margin: 0 auto; }
    .hero__eyebrow { font-size: .75rem; font-weight: 700; color: #C04E28; text-transform: uppercase; letter-spacing: 1px; margin-bottom: .75rem; }
    .hero h1 { font-family: 'Playfair Display', serif; font-size: clamp(2rem,5vw,3rem); color: #F5F0E8; line-height: 1.1; margin-bottom: 1rem; }
    .hero h1 em { color: #E06038; font-style: normal; }
    .hero p { color: rgba(245,240,232,.7); font-size: .95rem; margin-bottom: 1.5rem; }
    .btn-primary { display: inline-block; background: #C04E28; color: #fff; padding: .65rem 1.25rem; border-radius: 6px; text-decoration: none; font-weight: 700; }
    .search-bar { background: #F2EDE3; padding: 1rem 1.25rem; display: flex; gap: .6rem; flex-wrap: wrap; }
    .search-bar input, .search-bar select { padding: .55rem .75rem; border: 1.5px solid #DDD5C8; border-radius: 6px; font-size: .85rem; }
    .search-bar input { flex: 1; min-width: 200px; }
    .board { max-width: 1200px; margin: 0 auto; padding: 1.25rem; display: flex; gap: 1.5rem; }
    .board__sidebar { width: 220px; flex-shrink: 0; }
    .board__sidebar h3 { font-size: .78rem; text-transform: uppercase; letter-spacing: 1px; color: #7A6E60; margin-bottom: .75rem; }
    .board__sidebar label { display: block; font-size: .82rem; margin-bottom: .5rem; cursor: pointer; }
    .board__main { flex: 1; min-width: 0; }
    .board__count { font-size: .85rem; color: #7A6E60; margin-bottom: 1rem; }
    .room-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(240px,1fr)); gap: 1rem; }
    .empty-state { text-align: center; padding: 3rem 1rem; color: #7A6E60; }
    @media (max-width: 900px) { .board { flex-direction: column; } .board__sidebar { width: 100%; } }
  `],
})
export class Home implements OnInit, AfterViewInit {
  private roomsService = inject(RoomsService);

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

  ngAfterViewInit() {
    this.observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !this.loading() && this.hasMore()) {
        this.page++;
        this.fetchRooms(true);
      }
    }, { threshold: 0.1 });
    this.observer.observe(this.sentinel.nativeElement);
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
    }).subscribe((res) => {
      this.rooms.update((prev) => (append ? [...prev, ...res.data] : res.data));
      this.total.set(res.total);
      this.hasMore.set(res.hasMore);
      this.loading.set(false);
      this.loadingMore.set(false);
    });
  }
}
