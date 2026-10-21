import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, OnDestroy, OnInit, ViewChild, computed,
  afterNextRender, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RoomsService } from '../../core/services/rooms.service';
import { AlertsService } from '../../core/services/alerts.service';
import { WHATSAPP_ENABLED } from '../../core/config/feature-flags';
import { AuthService } from '../../core/services/auth.service';
import { BoardCategories, Room, SA_PROVINCES, SearchMeta } from '../../core/models/room.model';
import { RoomCard } from '../../shared/components/room-card/room-card';
import { Icon } from '../../shared/components/icon/icon';
import { AdSlot } from '../../shared/components/ad-slot/ad-slot';
import { SkeletonCard } from '../../shared/components/skeleton-card/skeleton-card';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { PluralPipe } from '../../shared/pipes/plural.pipe';

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
  imports: [PluralPipe, FormsModule, RouterLink, RoomCard, SkeletonCard, Icon, TranslatePipe, AdSlot],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero" [class.hero--splash]="splash()">
      <div class="hero-inner">
        <div class="hero-eyebrow">🇿🇦 {{ 'hero.eyebrow' | translate }}</div>
        <!-- Alternates between the two audiences. A board serving both needs
             to speak to both; one fixed message tells half the visitors this
             site is not for them. -->
        <h1 class="hero-headline" [class.hero-headline--swap]="swapping()">
          {{ heroMessage().title | translate }}<br/><em>{{ heroMessage().emphasis | translate }}</em>
        </h1>
        <p class="hero-sub hero-headline" [class.hero-headline--swap]="swapping()">
          {{ heroMessage().sub | translate }}
        </p>
        <div class="hero-ctas">
          <a href="#board" class="btn btn-primary btn-lg" (click)="scrollToBoard($event)">
            {{ 'nav.browse_rooms' | translate }}
          </a>
          <a routerLink="/auth/register" class="btn btn-ghost btn-lg">{{ 'hero.cta' | translate }}</a>
        </div>
        <div class="hero-stats">
          <div class="hero-stat"><strong>{{ total() }}</strong><span>{{ 'hero.stat_rooms' | translate }}</span></div>
          <div class="hero-stat"><strong>{{ landlordCount() }}</strong><span>{{ 'hero.stat_landlords' | translate }}</span></div>
          <div class="hero-stat"><strong>{{ 'hero.stat_free' | translate }}</strong><span>{{ 'hero.stat_to_apply' | translate }}</span></div>
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
                [attr.aria-label]="'Skip to ' + (roomCount() | plural: 'room')">
          <span>{{ roomCount() | plural: 'room' }}</span>
          <span class="hero-scroll-cue__chevron" aria-hidden="true">⌄</span>
        </button>
      }
    </section>

    <div class="trust-strip">
      <div class="trust-item"><app-icon class="trust-icon" name="lock"/>POPIA Compliant</div>
      <div class="trust-item"><app-icon class="trust-icon" name="scale"/>Rental Housing Act Aligned</div>
      <div class="trust-item"><app-icon class="trust-icon" name="ban"/>No Agent Fees</div>
      <!-- ⚠️ Phase 8j. This strip is a promise made to a visitor on the
           landing page, so it cannot advertise a channel that is switched off.
           Room alerts are the true version of the same claim: a saved search
           mails you the moment something matches, and costs nobody anything. -->
      @if (whatsappEnabled) {
        <div class="trust-item"><app-icon class="trust-icon" name="smartphone"/>WhatsApp Notifications</div>
      } @else {
        <div class="trust-item"><app-icon class="trust-icon" name="bell"/>Free Room Alerts</div>
      }
    </div>

    <div class="search-wrap">
      <div class="search-bar">
        <div class="search-input-wrap">
          <!-- The one hand-rolled SVG left on this page. Same shape as
               app-icon's search icon, drawn a second time. -->
          <app-icon class="search-icon" name="search"/>
          <input class="search-input" type="text" [placeholder]="'search.placeholder' | translate"
                 [(ngModel)]="searchTerm" (ngModelChange)="onSearchChange()"
                 (focus)="suggestOpen.set(true)" (blur)="closeSuggestions()"
                 autocomplete="off" role="combobox"
                 [attr.aria-expanded]="suggestOpen() && suggestions().length > 0"
                 aria-autocomplete="list"/>

          <!-- ⚠️ There was no way to empty this box but backspace.
               Every other filter on the board has a clear — the date has
               "Clear the date", the panel has "Clear all filters" — and the
               one a person types into, which is the hardest to empty on a
               phone, had none. mousedown rather than click for the same
               reason as the suggestions above: blur fires first. -->
          @if (searchTerm) {
            <button type="button" class="search-clear" aria-label="Clear the search"
                    (mousedown)="clearSearch()">
              <app-icon name="x"/>
            </button>
          }

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
                      {{ s.roomCount | plural: 'room' }}
                    </span>
                  </button>
                </li>
              }
            </ul>
          }
        </div>
        <!-- ⚠️ A wrapper that is display:contents on a desktop and a
             two-column grid on a phone. The three selects were four
             full-width rows with the text box; contents means the
             desktop row is unchanged and the element adds no box. -->
        <div class="search-selects">
          <select class="search-select" [attr.aria-label]="'search.label_province' | translate"
                  [(ngModel)]="province" (ngModelChange)="onFilterChange()">
            <option value="">{{ 'search.all_provinces' | translate }}</option>
            @for (p of provinces; track p) { <option [value]="p">{{ p }}</option> }
          </select>
          <select class="search-select" [attr.aria-label]="'search.label_room_type' | translate"
                  [(ngModel)]="roomType" (ngModelChange)="onFilterChange()">
            <option value="">{{ 'search.all_room_types' | translate }}</option>
            <option value="shared_house">Shared house</option>
            <option value="en_suite">En-suite</option>
            <option value="studio">Studio</option>
            <option value="private">Private room</option>
          </select>
          <select class="search-select" [attr.aria-label]="'search.label_max_rent' | translate"
                  [(ngModel)]="maxRentCents" (ngModelChange)="onFilterChange()">
            @for (p of priceOptions; track p.value) {
              <option [value]="p.value">{{ p.label }}</option>
            }
          </select>
        </div>
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
                  aria-label="Close filters"><app-icon name="x"/></button>
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

        <!-- ── When do you want to move? — Phase 10 ────────────────────
             A search criterion and nothing else: nothing is held, no landlord
             is told, and no tenancy date is set by typing here. Said on the
             screen, because "move-in date" on a property site elsewhere often
             means a booking.

             Three ways to answer, because people arrive with different
             certainties: a date, a window if they are flexible, or "as soon
             as possible" if they just need somewhere. -->
        <div class="filter-group">
          <div class="filter-label" id="movein-label">When do you want to move?</div>

          <div class="movein-chips" role="group" aria-labelledby="movein-label">
            <button type="button" class="quick-chip" [class.quick-chip--on]="availableNow"
                    [attr.aria-pressed]="availableNow" (click)="toggleAvailableNow()">
              <app-icon name="zap"/> As soon as possible
            </button>
            @if (moveIn || availableNow) {
              <button type="button" class="link-btn" (click)="clearMoveIn()">
                Clear the date
              </button>
            }
          </div>

          <label class="filter-date">
            <span>On or after this date, I need a room</span>
            <input type="date" [(ngModel)]="moveIn" [min]="today"
                   (ngModelChange)="onMoveInChange()"/>
            <!-- The native date box renders in the BROWSER's locale, not the
                 page's. index.html already says lang="en-ZA" and it changes
                 nothing: a browser set to en-US shows mm/dd/yyyy, so somebody
                 typing 25/11 is refused and somebody reading 11/12 cannot tell
                 which number is the day. The order cannot be set from here at
                 all, so the chosen day is echoed back in words, where the
                 month is a name and cannot be mistaken for the day. -->
            @if (moveIn) {
              <span class="filter-date-echo">{{ dateInWords(moveIn) }}</span>
            }
          </label>

          @if (moveIn) {
            <label class="filter-check">
              <input type="checkbox" [(ngModel)]="flexibleDates" (ngModelChange)="onMoveInChange()"/>
              I am flexible — show me a range
            </label>
            @if (flexibleDates) {
              <label class="filter-date">
                <span>…up to</span>
                <input type="date" [(ngModel)]="moveInTo" [min]="moveIn"
                       (ngModelChange)="onMoveInChange()"/>
                @if (moveInTo) {
                  <span class="filter-date-echo">{{ dateInWords(moveInTo) }}</span>
                }
              </label>
            }
            <p class="filter-note">
              Rooms free on or before {{ moveInLabel() }}.
              A room that frees up later is not shown.
            </p>
          }
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

        <!-- Sub-letting and household — Phase 6.
             The positioning decision was to keep sublets on the SAME board with
             an explicit filter rather than in their own category: splitting the
             board halves the inventory each half can show, and at launch
             volumes a thin board is what loses both segments.

             ⚠️ The three household selects EXCLUDE every listing that has not
             said, which is most of them today — so the note below is not
             decoration. A filter that silently takes the board from two hundred
             rooms to five teaches people the site is broken. -->
        <div class="filter-group">
          <label class="filter-label" for="filter-lister">Who is letting it</label>
          <select id="filter-lister" class="filter-select"
                  [(ngModel)]="listerType" (ngModelChange)="onFilterChange()">
            <option value="">Anyone</option>
            <option value="owner_landlord">The owner</option>
            <option value="sublessor">A tenant subletting</option>
          </select>
        </div>

        <div class="filter-group">
          <div class="filter-label">The household</div>
          <select class="filter-select" aria-label="Who lives there"
                  [(ngModel)]="housemateProfile" (ngModelChange)="onFilterChange()">
            <option value="">Anyone</option>
            <option value="professionals">Mostly working people</option>
            <option value="students">Mostly students</option>
            <option value="mixed">A mix of people</option>
            <option value="couples">Mostly couples</option>
          </select>
          <select class="filter-select" aria-label="Hours they keep"
                  [(ngModel)]="householdSchedule" (ngModelChange)="onFilterChange()">
            <option value="">Any hours</option>
            <option value="weekday_working">Out on weekdays</option>
            <option value="shift_work">Shift work in the house</option>
            <option value="mostly_home">Somebody usually home</option>
            <option value="varied">Varied hours</option>
          </select>
          <select class="filter-select" aria-label="How tidy"
                  [(ngModel)]="householdCleanliness" (ngModelChange)="onFilterChange()">
            <option value="">Any</option>
            <option value="very_tidy">Very tidy</option>
            <option value="tidy_enough">Tidy enough</option>
            <option value="relaxed">Relaxed</option>
          </select>
          <select class="filter-select" aria-label="Sociable or quiet"
                  [(ngModel)]="householdSocial" (ngModelChange)="onFilterChange()">
            <option value="">Any</option>
            <option value="social">Sociable</option>
            <option value="quiet">Quiet</option>
            <option value="balanced">In between</option>
          </select>
          @if (householdFilterOn()) {
            <p class="filter-note">
              Showing only rooms whose household has been described. Most listings
              have not said yet, so this hides a lot of them.
            </p>
          }
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
                <app-icon name="check-circle"/> Alert saved. Manage it in
                <a routerLink="/tenant/dashboard">your dashboard</a>.
              </p>
            } @else {
              <button type="button" class="btn btn-outline"
                      [disabled]="savingSearch()" (click)="saveCurrentSearch()">
                <!-- ⚠️ The icon is beside the interpolation, not inside it:
                     a string in a ternary cannot hold an element, and the
                     bell belongs to the resting state only — showing it
                     next to "Saving…" says the alert already exists. -->
                @if (savingSearch()) { Saving… } @else {
                  <app-icon name="bell"/> Alert me about rooms like this
                }
              </button>
              @if (saveSearchError()) {
                <p class="field-error" role="alert">{{ saveSearchError() }}</p>
              }
            }
          </div>
        }

        <!-- Contextual placement: matches the province and room type being
             browsed, never the person browsing. -->
        <!-- H2: the advert sits beside the board's own sections, and at phone
             widths the filters H2 above it is not rendered at all — see the
             note on AdSlot.headingLevel. -->
        <app-ad-slot placement="board_sidebar"
                     [headingLevel]="2"
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
            <app-icon name="zap"/> Available now
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

          <!-- ⚠️ How the phrase was read, under the count and above the rooms.
               A board that silently turns "rooms to rent in Springs" into a
               city filter is doing the right thing invisibly: somebody who
               gets five results cannot tell whether it understood "Springs"
               or matched five descriptions by luck. Each chip is a button
               that removes that part, so the interpretation is both legible
               and reversible. -->
          @if (searchMeta(); as m) {
            @if (m.city || m.province || m.roomType || m.tokens.length) {
              <p class="search-read">
                <span class="search-read__label">Searching for</span>
                @if (m.city) {
                  <button type="button" class="search-chip" (click)="dropCity()">
                    {{ m.city }}<app-icon name="x" aria-hidden="true"/>
                    <span class="visually-hidden">Remove the location {{ m.city }}</span>
                  </button>
                }
                @if (m.province && !m.city) {
                  <button type="button" class="search-chip" (click)="dropProvince()">
                    {{ m.province }}<app-icon name="x" aria-hidden="true"/>
                    <span class="visually-hidden">Remove the province {{ m.province }}</span>
                  </button>
                }
                @if (m.roomType) {
                  <button type="button" class="search-chip" (click)="dropRoomType()">
                    {{ roomTypeLabel(m.roomType) }}<app-icon name="x" aria-hidden="true"/>
                    <span class="visually-hidden">Remove the room type</span>
                  </button>
                }
                @for (t of m.tokens; track t) {
                  <span class="search-chip search-chip--word">{{ t }}</span>
                }
              </p>
            }
          }

          <!-- Browse shortcuts — the screenshot's category links, built from
               what the board actually holds.
               ⚠️ Every one carries its count, and the server never returns a
               category with a count of zero, so a shortcut on screen always
               leads to rooms. Hardcoding "Student accommodation" here would
               be the same defect as an autocomplete suggesting a town with no
               listings: a promise the board cannot keep.
               routerLink with queryParams rather than a click handler, so a
               shortcut is a real link — middle-clickable, shareable, and part
               of the history like every other search. -->
          @if (categories(); as cat) {
            <nav class="browse" aria-label="Browse by category">
              @if (cat.availableNow) {
                <a class="browse__link" routerLink="/" [queryParams]="{ now: '1' }">
                  Available now <span class="browse__count">{{ cat.availableNow }}</span>
                </a>
              }
              @for (t of cat.roomTypes; track t.type) {
                <a class="browse__link" routerLink="/" [queryParams]="{ type: t.type }">
                  {{ t.label }} <span class="browse__count">{{ t.count }}</span>
                </a>
              }
              @for (p of cat.places; track p.city) {
                <a class="browse__link" routerLink="/" [queryParams]="{ q: p.city }">
                  Rooms in {{ p.city }} <span class="browse__count">{{ p.count }}</span>
                </a>
              }
            </nav>
          }
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
            @if (moveIn || availableNow) {
              <!-- ⚠️ The date first, and on its own button. It is the filter
                   most likely to empty a board — a room free in January is
                   excluded from a December search however well it matches on
                   everything else — and making somebody clear ALL their
                   filters to loosen one is how a search gets abandoned. -->
              <p>
                Nothing is free by {{ moveIn ? moveInLabel() : 'the end of the fortnight' }}.
                Rooms that come free later are not shown.
              </p>
              <button type="button" class="btn btn-primary" (click)="clearMoveIn()">
                Search without a date
              </button>
              <p class="muted">Your other filters stay as they are.</p>
            } @else if (searchMeta()?.broaden; as b) {
              <!-- The phrase WAS understood; it is the describing words that
                   matched nothing. Offering the number rather than silently
                   dropping them: a board that widens a search by itself and
                   presents the result as a match is how people learn its
                   search cannot be trusted. -->
              <p>
                Nothing matches
                @for (t of b.droppedTokens; track t) { <strong>{{ t }}</strong> }
                here.
              </p>
              <button type="button" class="btn btn-primary" (click)="dropWords()">
                Show all {{ b.total }} {{ b.total === 1 ? 'room' : 'rooms' }} instead
              </button>
              <p class="muted">Your location and filters stay as they are.</p>
            } @else {
              <p>Try widening your search, or clear the filters to see everything available.</p>
            }
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
                <!-- H3: this one always follows the results-count H2, because
                     a card had to render for it to appear at all. -->
                <app-ad-slot placement="board_inline"
                             [headingLevel]="3"
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
  /** Phase 8j — see feature-flags.ts. The strip must not promise a dead channel. */
  protected readonly whatsappEnabled = WHATSAPP_ENABLED;

  private roomsService = inject(RoomsService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private alerts = inject(AlertsService);
  auth = inject(AuthService);
  private destroyRef = inject(DestroyRef);
  private injector = inject(Injector);

  rooms = signal<Room[]>([]);
  /** How the server read the typed phrase. Null when nothing was typed. */
  searchMeta = signal<SearchMeta | null>(null);
  /** Browse shortcuts. Null until loaded; never rendered empty. */
  categories = signal<BoardCategories | null>(null);
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
  /**
   * Translation keys, not English. The headline is the largest text on the site
   * and it was the one string on the home page the translate pipe did not
   * reach — so an Afrikaans or isiZulu visitor got a translated navbar, a
   * translated search bar, translated filters, and then the site's single
   * biggest sentence in English. The bundles carried keys for the hero this
   * one replaced, which nothing had read since the rotating version shipped.
   */
  private readonly heroMessages = [
    {
      title: 'hero.tenant_title',
      emphasis: 'hero.tenant_emphasis',
      sub: 'hero.tenant_sub',
    },
    {
      title: 'hero.landlord_title',
      emphasis: 'hero.landlord_emphasis',
      sub: 'hero.landlord_sub',
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

  // ── When somebody wants to move — Phase 10 ───────────────────────────────
  //
  // Plain fields like every other filter on this screen, so the drawer, the
  // URL and the saved-search description all treat them the same way.
  moveIn = '';
  moveInTo = '';
  flexibleDates = false;

  /**
   * Today, as a date-input min.
   *
   * ⚠️ Computed in the BROWSER's timezone on purpose: this is the bound on a
   * date picker a person is looking at, so it has to mean today where they
   * are. The matching itself is decided on the server in SAST — see
   * endOfDaySast in rooms.service.ts.
   */
  readonly today = new Date().toLocaleDateString('en-CA');
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
  // Phase 6. Empty string means "no preference" throughout, which is what the
  // API treats as absent — these are never sent as empty.
  listerType = '';
  housemateProfile = '';
  householdSchedule = '';
  householdCleanliness = '';
  householdSocial = '';
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
    /**
     * The URL is the search state, and the only thing that triggers a fetch.
     *
     * ⚠️ Before this, nothing in this component touched the router: it
     * imported RouterLink and nothing else. So opening a room and pressing
     * back lost the search and every filter, a search could not be shared or
     * bookmarked, and the browser's own back and forward buttons did nothing
     * on a page whose entire purpose is narrowing a list. The field comment
     * beside moveIn already said these filters were treated the same way by
     * "the drawer, the URL and the saved-search description" — two of those
     * three were true.
     *
     * One subscription rather than a fetch here plus a fetch in every change
     * handler: a handler that both navigates AND fetches runs two requests
     * per keystroke and races them, and whichever returns last wins. Here the
     * handlers only navigate, this reads the result, and back/forward arrive
     * through exactly the same path as a click.
     */
    // ⚠️ DECIDED, not incidental — confirmed by the owner on 21 October 2026:
    // the shortcuts stay NAVIGATION and describe the whole board, never the
    // current search.
    //
    // So this call is independent of the result fetch and is made once. A
    // category row that shrank as somebody narrowed their search would be a
    // second set of filters wearing navigation's clothes, and the counts
    // would stop meaning what they say.
    //
    // The known cost, accepted: on a narrowed board "Rooms in Pretoria 253"
    // is still offered even when the active filters would return far fewer,
    // because the shortcut is an invitation to start a different search
    // rather than a prediction about this one. Passing the current filters
    // into getCategories() is the one-line change that would reverse this —
    // which is exactly why it is written down here.
    this.roomsService.getCategories().subscribe({
      next: (c) => this.categories.set(c.total > 0 ? c : null),
      error: () => this.categories.set(null),
    });

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.hydrateFromUrl(params);
      this.page = 1;
      this.fetchRooms();
    });

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
      this.billsIncluded, this.availableNow, this.moveIn, this.couplesAllowed,
      this.dssAccepted, this.guarantorAccepted, this.petsAllowed,
      // Phase 6. Counted, because each of these really does narrow the board —
      // which is exactly what the absent `studentsWelcome` filter did not, and
      // why it was removed rather than left counted.
      this.listerType, this.housemateProfile, this.householdSchedule,
      this.householdCleanliness, this.householdSocial,
    ].filter(Boolean).length;
  }

  /** Is any household filter on — the note under the selects depends on it. */
  householdFilterOn(): boolean {
    return !!(
      this.housemateProfile || this.householdSchedule ||
      this.householdCleanliness || this.householdSocial
    );
  }

  /**
   * The bound, in the words somebody would use.
   *
   * ⚠️ Formatted here rather than with the date pipe: this component imports
   * no pipes, and pulling DatePipe in for one line is a dependency the
   * template does not otherwise need. Africa/Johannesburg explicitly, so a
   * phone set to another timezone does not render the day before.
   */
  moveInLabel(): string {
    const value = this.flexibleDates && this.moveInTo ? this.moveInTo : this.moveIn;
    return this.dateInWords(value);
  }

  /**
   * An ISO date as a South African would write it: 25 November 2026.
   *
   * The year is carried because this also labels the date inputs themselves,
   * and a bound with no year is a bound somebody has to guess at in December.
   * Midday Africa/Johannesburg so a phone in another timezone does not render
   * the day before, and the raw value is returned rather than a blank if it
   * ever fails to parse - a wrong-looking date is recoverable, a silently
   * empty one is not.
   */
  dateInWords(value: string): string {
    if (!value) return '';
    const at = new Date(`${value}T12:00:00+02:00`);
    if (Number.isNaN(at.getTime())) return value;
    return at.toLocaleDateString('en-ZA', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Johannesburg',
    });
  }

  /**
   * A date changed.
   *
   * ⚠️ "As soon as possible" and a chosen date answer the same question two
   * ways, so picking a date turns the chip off rather than quietly applying
   * both. Both WOULD work — the server takes the tighter bound — but a chip
   * that stays lit while a later date is typed tells somebody their search is
   * narrower than it is.
   */
  onMoveInChange() {
    if (this.moveIn) this.availableNow = false;
    if (!this.flexibleDates) this.moveInTo = '';
    // A window that ends before it starts is a typo, not a request. Snapped
    // rather than refused: an error message on a date box, on a phone, for
    // something this recoverable, is a dead end.
    if (this.moveInTo && this.moveInTo < this.moveIn) this.moveInTo = this.moveIn;
    this.onFilterChange();
  }

  /**
   * Clear the date and nothing else.
   *
   * The empty state's main button. Losing a province and a price ceiling
   * because a date was too tight is how a search gets abandoned rather than
   * widened.
   */
  /**
   * Empties the text search and re-runs the board.
   *
   * Through onSearchChange rather than setting the signal alone: the board
   * is debounced and the suggestion list has its own state, so assigning
   * the field would clear the BOX and leave the results as they were —
   * which is the shape of defect this repo keeps producing.
   */
  clearSearch() {
    this.searchTerm = '';
    this.suggestOpen.set(false);
    this.onSearchChange();
  }

  clearMoveIn() {
    this.moveIn = '';
    this.moveInTo = '';
    this.flexibleDates = false;
    this.availableNow = false;
    this.onFilterChange();
  }

  clearFilters() {
    this.province = '';
    this.roomType = '';
    this.maxRentCents = '';
    this.housemates = '';
    this.searchTerm = '';
    this.billsIncluded = false;
    this.availableNow = false;
    this.moveIn = '';
    this.moveInTo = '';
    this.flexibleDates = false;
    this.couplesAllowed = false;
    this.dssAccepted = false;
    this.guarantorAccepted = false;
    this.petsAllowed = false;
    this.listerType = '';
    this.housemateProfile = '';
    this.householdSchedule = '';
    this.householdCleanliness = '';
    this.householdSocial = '';
    this.sortBy = 'newest';
    this.onFilterChange();   // resets page and refetches
  }

  /**
   * Verified landlords with a room matching this search, from the API.
   *
   * It used to be `new Set(loadedRooms.map(r => r.landlordId)).size` under a
   * label reading "verified landlords", which was wrong twice over: it never
   * looked at whether anyone was verified, so an unverified landlord counted as
   * verified; and it counted only the loaded PAGE, so the figure grew as a
   * visitor scrolled. Reported from a phone, and the scroll half was not the
   * part reported.
   *
   * A trust number that is both false and unstable is worse than no number, and
   * this one sat in the hero of the landing page.
   */
  landlordCount = signal(0);

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
    this.searchDebounce = setTimeout(() => { this.page = 1; this.syncUrl(true); }, 400);
  }

  /** The urgent search: rooms free now or very soon. */
  toggleAvailableNow() {
    this.availableNow = !this.availableNow;
    /**
     * ⚠️ Phase 10. Picking the chip drops a typed date, because the two answer
     * the same question in different words. Both would WORK — the server takes
     * the tighter of the bounds — but a chip left lit beside a date in March
     * tells somebody their search is narrower than it is.
     */
    if (this.availableNow) {
      this.moveIn = '';
      this.moveInTo = '';
      this.flexibleDates = false;
    }
    // No tracking call here: Home does not inject AnalyticsService, and the
    // board.filtered event is recorded by the filter panel already. Counting
    // it twice would inflate the funnel.
    this.onFilterChange();
  }

  /**
   * Which filters travel in the URL, and under what name.
   *
   * ⚠️ Shared by the reader and the writer deliberately. Two lists would
   * drift, and the way they drift is silent: a filter written under one name
   * and read under another is simply dropped on the way back, so the board
   * reloads narrower or wider than the URL says it is. One table, both
   * directions.
   *
   * `q` rather than `search` because it is the shortest thing a person might
   * type or share, and this URL is meant to be shareable.
   */
  private static readonly URL_FIELDS = [
    ['q', 'searchTerm'], ['province', 'province'], ['type', 'roomType'],
    ['maxRent', 'maxRentCents'], ['moveIn', 'moveIn'], ['moveInTo', 'moveInTo'],
    ['sort', 'sortBy'], ['lister', 'listerType'],
    ['profile', 'housemateProfile'], ['schedule', 'householdSchedule'],
    ['tidiness', 'householdCleanliness'], ['social', 'householdSocial'],
  ] as const;

  private static readonly URL_FLAGS = [
    ['now', 'availableNow'], ['bills', 'billsIncluded'], ['couples', 'couplesAllowed'],
    ['dss', 'dssAccepted'], ['guarantor', 'guarantorAccepted'], ['pets', 'petsAllowed'],
    ['flexible', 'flexibleDates'],
  ] as const;

  /** URL -> component state. Anything absent falls back to its empty value. */
  private hydrateFromUrl(params: { get(key: string): string | null }) {
    for (const [param, field] of Home.URL_FIELDS) {
      (this as any)[field] = params.get(param) ?? '';
    }
    for (const [param, field] of Home.URL_FLAGS) {
      (this as any)[field] = params.get(param) === '1';
    }
    // sortBy has a real default; '' would send an empty sort to the API.
    if (!this.sortBy) this.sortBy = 'newest';
  }

  /**
   * Component state -> URL. Navigating is what causes the fetch; see ngOnInit.
   *
   * `replace` is true while somebody is typing, so a seven-letter suburb does
   * not leave seven entries in their history and make the back button feel
   * broken. A deliberate act — picking a filter, choosing a suggestion —
   * pushes an entry, because that is a step somebody may want to go back from.
   */
  private syncUrl(replace = false) {
    const queryParams: Record<string, string | null> = {};
    for (const [param, field] of Home.URL_FIELDS) {
      const v = String((this as any)[field] ?? '').trim();
      queryParams[param] = v && !(param === 'sort' && v === 'newest') ? v : null;
    }
    for (const [param, field] of Home.URL_FLAGS) {
      queryParams[param] = (this as any)[field] ? '1' : null;
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: replace,
    });
  }

  /**
   * Removing one part of what the phrase was read as.
   *
   * ⚠️ Each of these edits the TYPED PHRASE, not a hidden filter beside it.
   * The phrase is what the box shows and what the URL carries, so dropping a
   * chip while leaving the words in the box would put the two out of step —
   * the board would stop filtering by Springs while still saying "rooms to
   * rent in Springs", which is the kind of disagreement nobody reports and
   * everybody distrusts.
   */
  private dropFromPhrase(part: string | null | undefined) {
    if (!part) return;
    const pattern = new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'ig');
    this.searchTerm = this.searchTerm.replace(pattern, ' ').replace(/\s+/g, ' ').trim();
    this.onFilterChange();
  }

  dropCity() { this.dropFromPhrase(this.searchMeta()?.city); }
  dropProvince() { this.dropFromPhrase(this.searchMeta()?.province); }

  /** The type word is whichever synonym was typed, so clear by room type. */
  dropRoomType() {
    const typed = this.searchTerm;
    for (const w of ['en-suite', 'ensuite', 'en suite', 'studio', 'bachelor', 'shared', 'sharing', 'private', 'backroom']) {
      const re = new RegExp(`\\b${w}\\b`, 'ig');
      if (re.test(typed)) { this.searchTerm = this.searchTerm.replace(re, ' ').replace(/\s+/g, ' ').trim(); }
    }
    this.roomType = '';
    this.onFilterChange();
  }

  /** Keep the place and the filters; drop only the describing words. */
  dropWords() {
    const m = this.searchMeta();
    if (!m) return;
    for (const t of m.broaden?.droppedTokens ?? []) this.dropFromPhrase(t);
  }

  roomTypeLabel(type: string) {
    return ({
      shared_house: 'Shared house',
      en_suite: 'En-suite',
      studio: 'Studio',
      private: 'Private room',
    } as Record<string, string>)[type] ?? type;
  }

  onFilterChange() {
    // The saved confirmation belongs to the old filter set.
    this.searchSaved.set(false);
    this.page = 1;
    this.syncUrl();
  }

  private fetchRooms(append = false) {
    append ? this.loadingMore.set(true) : this.loading.set(true);

    this.roomsService.getRooms({
      search: this.searchTerm || undefined,
      province: this.province || undefined,
      roomType: (this.roomType as any) || undefined,
      billsIncluded: this.billsIncluded || undefined,
      availableNow: this.availableNow || undefined,
      // Phase 10. The window's end only travels when the person asked for a
      // window: a stale `moveInTo` left over from an unticked box would widen
      // a search that looks strict on screen.
      moveIn: this.moveIn || undefined,
      moveInTo: (this.flexibleDates && this.moveInTo) || undefined,
      couplesAllowed: this.couplesAllowed || undefined,
      dssAccepted: this.dssAccepted || undefined,
      guarantorAccepted: this.guarantorAccepted || undefined,
      petsAllowed: this.petsAllowed || undefined,
      maxRentCents: this.maxRentCents ? +this.maxRentCents : undefined,
      listerType: (this.listerType as any) || undefined,
      housemateProfile: (this.housemateProfile as any) || undefined,
      householdSchedule: (this.householdSchedule as any) || undefined,
      householdCleanliness: (this.householdCleanliness as any) || undefined,
      householdSocial: (this.householdSocial as any) || undefined,
      sortBy: this.sortBy,
      page: this.page,
      limit: 12,
    }).subscribe({
    next: (res) => {
      this.rooms.update((prev) => (append ? [...prev, ...res.data] : res.data));
      this.total.set(res.total);
      this.searchMeta.set(res.search ?? null);
      this.landlordCount.set(res.verifiedLandlords ?? 0);
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
