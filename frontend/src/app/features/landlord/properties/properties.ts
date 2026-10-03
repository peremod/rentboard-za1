import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PortalShell, PortalNavItem } from '../../../shared/components/portal-shell/portal-shell';
import { PropertiesService } from '../../../core/services/properties.service';
import { YardDashboard, YardGroup } from '../../../core/models/property.model';
import { SA_PROVINCES } from '../../../core/models/room.model';
import { landlordNav } from '../landlord-nav';

/**
 * My properties — Phase 7b.
 *
 * ── Why this screen exists at all
 *
 * Grouping was only reachable from inside the yard screen, below the rent
 * tracking and the expenses, as a button reading "+ Group rooms into a yard".
 * So the concept was something a landlord discovered while doing something
 * else, if they scrolled far enough — which is almost certainly why landlords
 * create rooms one at a time without ever grouping them. The brief's diagnosis,
 * and it matches what the screen looked like.
 *
 * This is the list: one card per property, each saying how many rooms are on it
 * and how many are empty, with the two actions that matter — add a property,
 * open one — and nothing else competing.
 *
 * ── What it deliberately does NOT do
 *
 * Force structure on anybody. A landlord with one address never has to create a
 * property: rooms without one are shown as their own card, their listings work
 * exactly as they do today, and the empty state teaches the idea in one sentence
 * rather than insisting on it. The brief is explicit about that, and it matters
 * more here than usual — the person this product is for has four back rooms and
 * a phone, not a portfolio and a spreadsheet.
 */
@Component({
  selector: 'app-properties',
  standalone: true,
  imports: [PortalShell, RouterLink, FormsModule, NgOptimizedImage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems" roleLabel="Landlord" pageTitle="My properties">

      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (dash(); as d) {
        @if (error()) { <div class="form-error" role="alert">{{ error() }}</div> }

        <!-- The teaching empty state: one sentence, one button.
             Not a wall of text — the brief says so, and a landlord who has just
             posted their first room does not want a tutorial. -->
        @if (d.properties.length === 0) {
          <div class="empty-state">
            <h2>Group rooms at the same address</h2>
            <p>
              A property groups the rooms at one address — like "my backyard on
              Vilakazi Street". You set the house rules and what everyone shares
              once, instead of typing them into every room.
            </p>
            @if (d.totals.rooms > 0) {
              <p class="muted">
                You have {{ d.totals.rooms }} {{ d.totals.rooms === 1 ? 'room' : 'rooms' }} listed.
                Grouping is optional — they work exactly as they are.
              </p>
            }
            <button type="button" class="btn btn-primary" (click)="startCreate()">
              + Add your first property
            </button>
          </div>
        } @else {
          <div class="prop-head">
            <div class="yard-totals">
              <div class="yard-total">
                <strong>{{ d.properties.length }}</strong><span>{{ d.properties.length === 1 ? 'property' : 'properties' }}</span>
              </div>
              <div class="yard-total">
                <strong>{{ d.totals.rooms }}</strong><span>rooms</span>
              </div>
              <div class="yard-total" [class.yard-total--alert]="d.totals.waitingApplicants > 0">
                <strong>{{ d.totals.waitingApplicants }}</strong><span>waiting</span>
              </div>
            </div>
            <button type="button" class="btn btn-primary" (click)="startCreate()">
              + Add a new property
            </button>
          </div>

          <ul class="prop-list">
            @for (group of d.properties; track group.property!.id) {
              <li class="prop-card">
                <a class="prop-card__link" [routerLink]="['/landlord/properties', group.property!.id]">
                  @if (thumbnail(group); as path) {
                    <img class="prop-card__img" [ngSrc]="path" width="96" height="72" alt=""/>
                  } @else {
                    <div class="prop-card__img prop-card__img--none" aria-hidden="true">🏘️</div>
                  }

                  <div class="prop-card__body">
                    <strong class="prop-card__name">{{ group.property!.name }}</strong>
                    <!-- The address under the nickname, in smaller text, exactly
                         as the brief asks — and only if the landlord gave one.
                         Nobody else ever sees this line. -->
                    <span class="prop-card__where">
                      @if (group.property!.addressLine) { {{ group.property!.addressLine }} · }
                      {{ group.property!.suburb ? group.property!.suburb + ', ' : '' }}{{ group.property!.city }}
                    </span>
                    <span class="prop-card__count">{{ roomSummary(group) }}</span>
                  </div>

                  <span class="prop-card__go" aria-hidden="true">›</span>
                </a>
              </li>
            }

            <!-- Rooms in no property, as a card of their own.
                 Never hidden: a landlord who grouped four of six rooms must see
                 the other two, or this screen quietly says they own four. -->
            @if (d.ungrouped; as loose) {
              <li class="prop-card prop-card--loose">
                <a class="prop-card__link" routerLink="/landlord/dashboard" fragment="active-listings">
                  <div class="prop-card__img prop-card__img--none" aria-hidden="true">🏠</div>
                  <div class="prop-card__body">
                    <strong class="prop-card__name">Not grouped</strong>
                    <span class="prop-card__where">
                      Fine as they are — group them only if it helps you
                    </span>
                    <span class="prop-card__count">{{ roomSummary(loose) }}</span>
                  </div>
                  <span class="prop-card__go" aria-hidden="true">›</span>
                </a>
              </li>
            }
          </ul>
        }

        @if (creating()) {
          <form class="prop-form" (ngSubmit)="create()">
            <h2 class="dash-section-title">A new property</h2>

            <label>
              <span>What do you call this place?</span>
              <input type="text" name="name" [(ngModel)]="form.name" required maxlength="120"
                     placeholder="Ext 7 back rooms" autocomplete="off"/>
              <span class="field-hint">Your own words — you have to recognise it in a list.</span>
            </label>

            <label>
              <span>Street address <span class="muted">(optional)</span></span>
              <input type="text" name="addressLine" [(ngModel)]="form.addressLine" maxlength="200"
                     placeholder="1423 Vilakazi Street" autocomplete="off"/>
              <!-- Said at the point of typing, not in a policy page. The yard
                   screen has never asked for a street and the board shows the
                   suburb only; this line exists for the landlord with two places
                   in one suburb, and for nobody else. -->
              <span class="field-hint">
                Only you see this. It is never shown on a listing, never sent to
                an applicant, and you can leave it blank.
              </span>
            </label>

            <div class="prop-form__row">
              <label>
                <span>Suburb</span>
                <input type="text" name="suburb" [(ngModel)]="form.suburb" maxlength="120"/>
              </label>
              <label>
                <span>City</span>
                <input type="text" name="city" [(ngModel)]="form.city" required maxlength="120"/>
              </label>
              <label>
                <span>Province</span>
                <select name="province" [(ngModel)]="form.province" required>
                  <option value="">Choose…</option>
                  @for (p of provinces; track p) { <option [value]="p">{{ p }}</option> }
                </select>
              </label>
            </div>

            @if (createError()) { <p class="field-error" role="alert">{{ createError() }}</p> }

            <div class="prop-form__actions">
              <button type="submit" class="btn btn-primary" [disabled]="busy() || !form.name.trim() || !form.city.trim() || !form.province">
                {{ busy() ? 'Saving…' : 'Add this property' }}
              </button>
              <button type="button" class="btn btn-ghost-light" (click)="creating.set(false)">Cancel</button>
            </div>
          </form>
        }
      }
    </app-portal-shell>
  `,
  styles: `
    .prop-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem;
    }
    .prop-list { list-style: none; margin: 0; padding: 0; display: grid; gap: .6rem; }
    .prop-card {
      border: 1.5px solid var(--border); border-radius: var(--r8);
      background: var(--white); overflow: hidden;
    }
    .prop-card--loose { border-style: dashed; }
    /* The whole card is the link, so a thumb anywhere on it opens the
       property — a 44px target is the minimum and this is the whole row. */
    .prop-card__link {
      display: flex; align-items: center; gap: .85rem;
      padding: .7rem .85rem; text-decoration: none; color: inherit;
    }
    .prop-card__link:hover { background: var(--cream2); }
    .prop-card__img { width: 96px; height: 72px; object-fit: cover; border-radius: var(--r4); flex: 0 0 auto; }
    .prop-card__img--none {
      display: grid; place-items: center; font-size: 1.6rem;
      background: var(--cream2); color: var(--slate);
    }
    .prop-card__body { display: flex; flex-direction: column; gap: .15rem; min-width: 0; flex: 1; }
    .prop-card__name { font-size: 1rem; }
    .prop-card__where { font-size: .78rem; color: var(--slate); }
    .prop-card__count { font-size: .82rem; font-weight: 600; }
    .prop-card__go { font-size: 1.4rem; color: var(--slate); flex: 0 0 auto; }
    .prop-form { margin-top: 1.25rem; max-width: 34rem; }
    .prop-form label { display: block; margin-bottom: .75rem; }
    .prop-form label > span:first-child { display: block; font-size: .85rem; font-weight: 600; margin-bottom: .2rem; }
    .prop-form input, .prop-form select { width: 100%; padding: .55rem; border: 1.5px solid var(--border); border-radius: var(--r4); font: inherit; }
    .prop-form__row { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .6rem; }
    .prop-form__actions { display: flex; gap: .5rem; margin-top: .5rem; }
  `,
})
export class Properties implements OnInit {
  private properties = inject(PropertiesService);

  readonly navItems: PortalNavItem[] = landlordNav();
  readonly provinces = SA_PROVINCES;

  readonly dash = signal<YardDashboard | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);
  readonly busy = signal(false);

  form = { name: '', addressLine: '', suburb: '', city: '', province: '' };

  ngOnInit() {
    this.reload();
  }

  private reload() {
    this.loading.set(true);
    this.properties.loadDashboard().subscribe({
      next: (d) => { this.dash.set(d); this.loading.set(false); },
      error: (err) => {
        this.loading.set(false);
        // Said as a failure, not as an empty list. "You have no properties"
        // when the request failed is the page telling the landlord something
        // untrue about their own account.
        this.error.set(err?.error?.message ?? 'Could not load your properties just now. This is our end, not an empty list.');
      },
    });
  }

  /**
   * The card's photo: the first room at this address that has one.
   *
   * Derived rather than uploaded. A property photo would be a second upload
   * flow, a second thing to delete under POPIA, and a second thing to get
   * wrong — and the rooms at an address already carry photographs of it.
   */
  thumbnail(group: YardGroup): string | null {
    return group.rooms.find((r) => r.heroImagePath)?.heroImagePath ?? null;
  }

  /**
   * "4 rooms — 2 vacant", in the brief's own words, and honest about the rest.
   *
   * A room can also be a draft or paused, and a count that says "4 rooms — 0
   * vacant" while three of them are drafts would read as a full house.
   */
  roomSummary(group: YardGroup): string {
    if (group.roomCount === 0) return 'No rooms yet';
    const parts = [`${group.roomCount} ${group.roomCount === 1 ? 'room' : 'rooms'}`];
    if (group.vacant > 0) parts.push(`${group.vacant} vacant`);
    if (group.let > 0) parts.push(`${group.let} let`);
    if (group.draft > 0) parts.push(`${group.draft} draft`);
    if (group.paused > 0) parts.push(`${group.paused} paused`);
    if (group.waitingApplicants > 0) {
      parts.push(`${group.waitingApplicants} waiting`);
    }
    return parts.join(' — ');
  }

  startCreate() {
    this.createError.set(null);
    this.creating.set(true);
  }

  create() {
    if (!this.form.name.trim() || !this.form.city.trim() || !this.form.province) return;
    this.busy.set(true);
    this.createError.set(null);
    this.properties.create({
      name: this.form.name.trim(),
      // Omitted rather than sent empty: an empty string is a value, and this
      // column means "the landlord did not say".
      addressLine: this.form.addressLine.trim() || undefined,
      suburb: this.form.suburb.trim() || undefined,
      city: this.form.city.trim(),
      province: this.form.province,
    }).subscribe({
      next: () => {
        this.busy.set(false);
        this.creating.set(false);
        this.form = { name: '', addressLine: '', suburb: '', city: '', province: '' };
        this.reload();
      },
      error: (err) => {
        this.busy.set(false);
        this.createError.set(err?.error?.message ?? 'Could not add that property.');
      },
    });
  }
}
