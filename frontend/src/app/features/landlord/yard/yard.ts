import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PropertiesService } from '../../../core/services/properties.service';
import { RentPeriod, RentStatus, YardGroup } from '../../../core/models/property.model';
import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';
import { DialogService } from '../../../core/services/dialog.service';
import { PortalShell, PortalNavItem } from '../../../shared/components/portal-shell/portal-shell';

/**
 * The yard dashboard.
 *
 * Answers the two questions a multi-room landlord has and the old per-room
 * dashboard could not: how many of my rooms are empty, and who is waiting
 * anywhere on this property.
 *
 * Rooms not in a yard appear under their own heading rather than being
 * hidden. A landlord who has grouped four of six rooms must still see the
 * other two, or the screen quietly misrepresents what they own.
 *
 * Rent lives here too because it is the same screen in the landlord's head —
 * "who is in, who is out, who has not paid" — and splitting it across two
 * pages would mean checking both every month.
 */
@Component({
  selector: 'app-yard',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, RouterLink, ZarCentsPipe, PortalShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems" roleLabel="Landlord">
      <div class="dash-section-title">Your property</div>

      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (dash(); as d) {
        <div class="yard-totals">
          <div class="yard-total">
            <strong>{{ d.totals.rooms }}</strong><span>rooms</span>
          </div>
          <div class="yard-total" [class.yard-total--good]="d.totals.vacant === 0">
            <strong>{{ d.totals.vacant }}</strong><span>vacant</span>
          </div>
          <div class="yard-total" [class.yard-total--alert]="d.totals.waitingApplicants > 0">
            <strong>{{ d.totals.waitingApplicants }}</strong><span>waiting</span>
          </div>
        </div>

        @if (error()) { <div class="form-error">{{ error() }}</div> }

        @for (group of d.properties; track group.property!.id) {
          <ng-container [ngTemplateOutlet]="yardTpl"
                        [ngTemplateOutletContext]="{ $implicit: group }"/>
        }

        @if (d.ungrouped) {
          <ng-container [ngTemplateOutlet]="yardTpl"
                        [ngTemplateOutletContext]="{ $implicit: d.ungrouped }"/>
        }

        @if (d.totals.rooms === 0) {
          <div class="empty-state">
            <h3>No rooms yet</h3>
            <p>Post your first room and it will show up here.</p>
            <a class="btn btn-primary" routerLink="/landlord/rooms/new">Post a room</a>
          </div>
        }

        <div class="yard-new">
          @if (creating()) {
            <form (ngSubmit)="createYard()">
              <label>What do you call this place?
                <input type="text" name="name" [(ngModel)]="newName" required maxlength="120"
                       placeholder="Ext 7 back rooms"/>
              </label>
              <div class="yard-new__row">
                <label>Suburb
                  <input type="text" name="suburb" [(ngModel)]="newSuburb" maxlength="120"/>
                </label>
                <label>City
                  <input type="text" name="city" [(ngModel)]="newCity" required maxlength="120"/>
                </label>
                <label>Province
                  <input type="text" name="province" [(ngModel)]="newProvince" required maxlength="120"/>
                </label>
              </div>
              <p class="muted">
                We do not ask for the street address — the board shows the suburb,
                not the street, and there is nothing here that needs more.
              </p>
              <button type="submit" class="btn btn-primary" [disabled]="busy()">Create</button>
              <button type="button" class="btn btn-outline" (click)="creating.set(false)">Cancel</button>
            </form>
          } @else {
            <button type="button" class="btn btn-outline" (click)="creating.set(true)">
              + Group rooms into a yard
            </button>
          }
        </div>
      }

      <ng-template #yardTpl let-group>
        <div class="yard">
          <div class="yard__head">
            <div>
              <strong>{{ group.property?.name || 'Rooms not in a yard' }}</strong>
              @if (group.property) {
                <span class="muted">
                  {{ group.property.suburb ? group.property.suburb + ', ' : '' }}{{ group.property.city }}
                </span>
              } @else {
                <span class="muted">Group these to see them together</span>
              }
            </div>
            @if (group.property) {
              <button type="button" class="link-btn" (click)="deleteYard(group.property.id, group.property.name)">
                Delete yard
              </button>
            }
          </div>

          <div class="yard__counts">
            <span>{{ group.roomCount }} rooms</span>
            <span class="yard__count--vacant">{{ group.vacant }} vacant</span>
            <span>{{ group.let }} let</span>
            @if (group.draft) { <span>{{ group.draft }} draft</span> }
            @if (group.waitingApplicants) {
              <span class="yard__count--alert">{{ group.waitingApplicants }} waiting</span>
            }
          </div>

          @for (room of group.rooms; track room.id) {
            <div class="yard-room">
              <div class="yard-room__main">
                <a [routerLink]="['/rooms', room.id]">{{ room.title }}</a>
                <span class="status status--{{ room.status }}">{{ room.status }}</span>
                <span class="muted">{{ room.rentCents | zarCents }}/mo</span>
              </div>

              @if (room.applications.length) {
                <a class="yard-room__applicants" [routerLink]="['/landlord/rooms', room.id, 'applicants']">
                  {{ room.applications.length }} waiting →
                </a>
              }

              <!-- Rent, per live tenancy. The toggle is the whole feature:
                   the landlord is already collecting the money, what they
                   lack is a record of who is behind. -->
              @for (tenancy of room.tenancies; track tenancy.id) {
                <div class="yard-rent">
                  <span>{{ tenancy.tenant.fullName }}</span>
                  @if (rent()[tenancy.id]; as periods) {
                    <span class="yard-rent__state">{{ currentLabel(periods) }}</span>
                    <span class="yard-rent__actions">
                      <button type="button" [disabled]="busy()"
                              (click)="mark(tenancy.id, 'paid')">Paid</button>
                      <button type="button" [disabled]="busy()"
                              (click)="mark(tenancy.id, 'unpaid')">Not yet</button>
                    </span>
                    @if (disputed(periods); as note) {
                      <span class="yard-rent__disputed">
                        They say they paid{{ note === true ? '' : ': ' + note }}
                      </span>
                    }
                  } @else {
                    <button type="button" class="link-btn" (click)="loadRent(tenancy.id)">
                      Rent this month
                    </button>
                  }
                </div>
              }
            </div>
          } @empty {
            <p class="muted yard__empty">No rooms here yet.</p>
          }
        </div>
      </ng-template>
    </app-portal-shell>
  `,
})
export class Yard implements OnInit {
  private properties = inject(PropertiesService);
  private dialogs = inject(DialogService);

  protected readonly navItems: PortalNavItem[] = [
    { label: 'Dashboard', icon: '📊', route: '/landlord/dashboard', exact: true },
    { label: 'Property', icon: '🏘️', route: '/landlord/yard' },
    { label: 'Verification', icon: '🪪', route: '/landlord/verification' },
    { label: 'Settings', icon: '⚙️', route: '/account/settings' },
  ];

  protected readonly dash = this.properties.dashboard;
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly creating = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Rent periods by tenancy id, fetched on demand rather than with the list. */
  protected readonly rent = signal<Record<string, RentPeriod[]>>({});

  protected newName = '';
  protected newSuburb = '';
  protected newCity = '';
  protected newProvince = '';

  ngOnInit() {
    this.reload();
  }

  private reload() {
    this.loading.set(true);
    this.properties.loadDashboard().subscribe({
      next: () => this.loading.set(false),
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message ?? 'Could not load your property.');
      },
    });
  }

  /** First of the current month, matching how the API normalises a period. */
  private thisMonth(): string {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  }

  protected currentLabel(periods: RentPeriod[]): string {
    const month = this.thisMonth();
    const period = periods.find((p) => p.periodStart.slice(0, 10) === month);
    if (!period) return 'not recorded';
    switch (period.status) {
      case 'paid': return 'paid';
      case 'partial': return 'part paid';
      case 'waived': return 'not chasing';
      default: return 'not yet paid';
    }
  }

  /** The tenant's note for this month, or true if they disputed without one. */
  protected disputed(periods: RentPeriod[]): string | boolean | null {
    const month = this.thisMonth();
    const period = periods.find((p) => p.periodStart.slice(0, 10) === month);
    if (!period?.tenantDisputedAt) return null;
    return period.tenantNote || true;
  }

  protected loadRent(tenancyId: string) {
    this.properties.rentHistory(tenancyId).subscribe({
      next: (periods) => this.rent.update((m) => ({ ...m, [tenancyId]: periods })),
      error: () => this.error.set('Could not load the rent record.'),
    });
  }

  protected mark(tenancyId: string, status: RentStatus) {
    this.busy.set(true);
    this.properties.markRent(tenancyId, this.thisMonth(), status).subscribe({
      next: (period) => {
        this.busy.set(false);
        this.rent.update((m) => ({
          ...m,
          [tenancyId]: [period, ...(m[tenancyId] ?? []).filter((p) => p.id !== period.id)],
        }));
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(err?.error?.message ?? 'Could not save that.');
      },
    });
  }

  protected createYard() {
    if (!this.newName.trim() || !this.newCity.trim() || !this.newProvince.trim()) {
      this.error.set('A name, city and province are needed.');
      return;
    }
    this.busy.set(true);
    this.properties
      .create({
        name: this.newName.trim(),
        suburb: this.newSuburb.trim() || undefined,
        city: this.newCity.trim(),
        province: this.newProvince.trim(),
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.creating.set(false);
          this.newName = this.newSuburb = this.newCity = this.newProvince = '';
          this.reload();
        },
        error: (err) => {
          this.busy.set(false);
          this.error.set(err?.error?.message ?? 'Could not create that yard.');
        },
      });
  }

  /**
   * Says plainly that the rooms survive. "Delete" on a container reads as
   * "delete everything in it", and a landlord who believes that will not use
   * the feature at all.
   */
  protected async deleteYard(id: string, name: string) {
    const confirmed = await this.dialogs.confirm(
      `Delete "${name}"?`,
      'The rooms in it stay exactly as they are — they just stop being grouped. Nothing is removed from the board.',
    );
    if (!confirmed) return;

    this.busy.set(true);
    this.properties.remove(id).subscribe({
      next: () => { this.busy.set(false); this.reload(); },
      error: (err) => {
        this.busy.set(false);
        this.error.set(err?.error?.message ?? 'Could not delete that yard.');
      },
    });
  }
}
