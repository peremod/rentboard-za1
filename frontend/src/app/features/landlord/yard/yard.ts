import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PropertiesService } from '../../../core/services/properties.service';
import {
  Expense, ExpenseCategory, ExpenseSummary, HousemateProfile, Property,
  RentPeriod, RentStatus, YardGroup,
} from '../../../core/models/property.model';

/** Plain English for each category, in a landlord's words not an accountant's. */
const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  municipal: 'Municipal bill',
  water: 'Water',
  electricity: 'Electricity',
  maintenance: 'Repairs',
  other: 'Something else',
};

/**
 * Plain English for each profile, in the tenant's terms rather than the
 * enum's. `unstated` has no label on purpose — it is never rendered, because
 * printing "not stated" shows a non-answer as though it were information.
 */
const HOUSEMATE_LABELS: Record<Exclude<HousemateProfile, 'unstated'>, string> = {
  professionals: 'working people',
  students: 'students',
  mixed: 'a mix of people',
  couples: 'couples',
};
import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';
import { DialogService } from '../../../core/services/dialog.service';
import { PortalShell, PortalNavItem } from '../../../shared/components/portal-shell/portal-shell';
import { landlordNav } from '../landlord-nav';
import { PluralPipe } from '../../../shared/pipes/plural.pipe';
import { LeasePanel } from '../../../shared/components/lease-panel/lease-panel';

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
  imports: [
    PluralPipe, NgTemplateOutlet, DatePipe, FormsModule, RouterLink,
    ZarCentsPipe, PortalShell, LeasePanel,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems" roleLabel="Landlord" pageTitle="Your property">

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
            <!-- h2, not h3: it follows the shell's h1 with nothing between. -->
            <h2>No rooms yet</h2>
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

        <!--
          The reminder window, where rent already is.

          PATCH /properties/rent/settings has existed since rent tracking
          shipped and nothing in the UI ever called it: the grace period is
          per landlord precisely because a month-end wage and a SASSA payment
          date want different windows, and a landlord could neither set it nor
          turn reminders off. The API was there, the service method was there,
          and no screen used either.
        -->
        <section class="dash-section rent-reminders">
          <h2 class="dash-section-title">Rent reminders</h2>
          <p class="muted">
            When a month is marked unpaid, we message the tenant once — after
            this many days from the 1st. Set it to 0 to send nothing at all;
            you can still record what was paid and what was not.
          </p>
          <div class="yard-new__row">
            <label for="grace-days">
              Days after the 1st
              <input id="grace-days" type="number" min="0" max="28" [(ngModel)]="graceDays"
                     name="graceDays"/>
            </label>
            <button type="button" class="btn btn-primary" [disabled]="savingGrace()"
                    (click)="saveGraceDays()">
              {{ savingGrace() ? 'Saving…' : 'Save' }}
            </button>
          </div>
          @if (graceSaved()) {
            <p class="muted" role="status">
              @if (graceDays === 0) {
                Reminders are off. Nothing is sent to your tenants.
              } @else {
                Saved — a reminder goes out {{ graceDays }}
                {{ graceDays === 1 ? 'day' : 'days' }} after the 1st.
              }
            </p>
          }
          @if (graceError()) { <p class="field-error" role="alert">{{ graceError() }}</p> }
          <p class="muted">
            Reminders go to verified numbers only. A number typed into a
            profile has not been checked, and "your rent is unpaid" sent to
            whoever holds that number is not a message we will send.
          </p>
        </section>
      }

      <!-- Order on this screen: what needs DECIDING, then the figures, then the
           inventory. Expenses and lease renewal were built on separate branches
           and both added a card here, so the merge had to choose; a lease
           ending carries a deadline and the money card does not, so the
           deadline goes first. scripts/lease-ui-drive.mjs asserts this order on
           a rendered page, because the a11y drive's landlord has neither card.

           headingLevel 2 because this sits directly under the page h1, and a
           component cannot know its own depth. -->
      <app-lease-panel [headingLevel]="2"/>

      <!-- The money picture. Rent tracking already said what came in; without
           expenses "how am I doing" could only be half answered, and half an
           answer about money is worse than none.

           The basis line is not decoration. It says which rent months are
           counted, because a figure whose rules are invisible is one someone
           plans around and is wrong about. -->
      @if (summary(); as sum) {
        <section class="dash-section" id="money">
          <h2 class="dash-section-title">This month</h2>

          <div class="stat-row">
            <div class="stat-box">
              <div class="val">{{ sum.totalRentCents | zarCents: 'exact' }}</div>
              <div class="lbl">Rent marked paid</div>
            </div>
            <div class="stat-box">
              <div class="val">{{ sum.totalExpenseCents | zarCents: 'exact' }}</div>
              <div class="lbl">Spent</div>
            </div>
            <div class="stat-box">
              <div class="val" [class.stat-warn]="sum.netCents < 0">{{ sum.netCents | zarCents: 'exact' }}</div>
              <div class="lbl">Left over</div>
            </div>
          </div>

          <p class="muted money-basis">{{ sum.rentBasis }}</p>
          @if (sum.ungroupedRentCents > 0) {
            <p class="muted">
              {{ sum.ungroupedRentCents | zarCents: 'exact' }} of that rent is on rooms not in a yard, so the
              per-yard rows below add up to less than the total.
            </p>
          }
        </section>
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
              <div class="yard__actions">
                <!-- Bulk relist, the action a multi-room landlord actually has:
                     a yard empties at month end and putting six rooms back is
                     six trips through the dashboard. Disabled when there is
                     nothing to relist, rather than offered and then refused. -->
                @if (group.let || group.paused) {
                  <button type="button" class="btn btn-sm btn-sage"
                          [disabled]="relisting() === group.property.id"
                          (click)="relistYard(group.property.id, group.property.name)">
                    {{ relisting() === group.property.id ? 'Relisting…' : '↻ Relist all' }}
                  </button>
                }
                <button type="button" class="link-btn" (click)="editShared(group.property)">
                  Shared details
                </button>
                <button type="button" class="link-btn" (click)="deleteYard(group.property.id, group.property.name)">
                  Delete yard
                </button>
              </div>
            }
          </div>

          <!-- What the whole address shares. Shown read-only here, because the
               point is that a landlord can SEE it is set once for the yard
               rather than per room. -->
          @if (group.property && sharedSummary(group.property); as shared) {
            <p class="yard__shared muted">{{ shared }}</p>
          }

          @if (editing() === group.property?.id) {
            <form class="yard-shared-form" (ngSubmit)="saveShared(group.property.id)">
              <label>
                <span>House rules</span>
                <textarea rows="3" [(ngModel)]="form.houseRules" name="houseRules"
                          placeholder="Gate locked at 21:00. Tell me before overnight visitors."></textarea>
              </label>
              <label>
                <span>Shared facilities, separated by commas</span>
                <input type="text" [(ngModel)]="form.sharedAmenities" name="sharedAmenities"
                       placeholder="Shared kitchen, outside tap, washing line"/>
              </label>
              <label>
                <span>People already living here</span>
                <input type="number" min="0" max="100" [(ngModel)]="form.currentHousemates" name="currentHousemates"/>
              </label>
              <label>
                <span>Who lives here</span>
                <select [(ngModel)]="form.housemateProfile" name="housemateProfile">
                  <option value="unstated">Rather not say</option>
                  <option value="mixed">A mix of people</option>
                  <option value="professionals">Working people</option>
                  <option value="students">Students</option>
                  <option value="couples">Couples</option>
                </select>
              </label>
              @if (sharedError()) { <p class="field-error" role="alert">{{ sharedError() }}</p> }
              <div class="yard-shared-form__actions">
                <button type="submit" class="btn btn-primary btn-sm" [disabled]="savingShared()">
                  {{ savingShared() ? 'Saving…' : 'Save' }}
                </button>
                <button type="button" class="link-btn" (click)="editing.set(null)">Cancel</button>
              </div>
            </form>
          }

          <div class="yard__counts">
            <span>{{ group.roomCount | plural: 'room' }}</span>
            <span class="yard__count--vacant">{{ group.vacant }} vacant</span>
            <span>{{ group.let }} let</span>
            @if (group.draft) { <span>{{ group.draft }} draft</span> }
            @if (group.waitingApplicants) {
              <span class="yard__count--alert">{{ group.waitingApplicants }} waiting</span>
            }
          </div>

          <!-- Expenses for this yard. Collapsed by default: a landlord opening
               the dashboard wants vacancies and rent first, and a list of
               receipts under every yard would bury both. -->
          @if (group.property) {
            <div class="yard-expenses">
              <button type="button" class="link-btn"
                      (click)="toggleExpenses(group.property.id)">
                {{ openExpenses() === group.property.id ? '▾' : '▸' }} Money spent
                @if (yardSpend(group.property.id); as spent) { <span class="muted">— {{ spent | zarCents: 'exact' }} this month</span> }
              </button>

              @if (openExpenses() === group.property.id) {
                @if (loadingExpenses()) {
                  <p class="muted">Loading…</p>
                } @else {
                  @if (expenses().length === 0) {
                    <p class="muted">Nothing recorded yet. Add the municipal bill, a repair, anything you paid for.</p>
                  } @else {
                    <ul class="expense-list">
                      @for (e of expenses(); track e.id) {
                        <li class="expense">
                          <div class="expense__main">
                            <strong>{{ e.amountCents | zarCents: 'exact' }}</strong>
                            <span class="expense__cat">{{ categoryLabel(e.category) }}</span>
                            <span class="muted">{{ e.incurredOn | date: 'd MMM' }}</span>
                          </div>
                          @if (e.room) { <div class="muted">{{ e.room.title }}</div> }
                          @if (e.note) { <div class="expense__note">{{ e.note }}</div> }
                          <button type="button" class="link-btn"
                                  (click)="deleteExpense(e)">Remove</button>
                        </li>
                      }
                    </ul>
                  }

                  <form class="expense-form" (ngSubmit)="addExpense(group.property.id)">
                    <label>
                      <span>What was it for</span>
                      <select [(ngModel)]="expenseForm.category" name="category">
                        <option value="municipal">Municipal bill</option>
                        <option value="water">Water</option>
                        <option value="electricity">Electricity</option>
                        <option value="maintenance">Repairs</option>
                        <option value="other">Something else</option>
                      </select>
                    </label>
                    <label>
                      <span>How much, in rand</span>
                      <input type="number" min="1" step="0.01" [(ngModel)]="expenseForm.rand" name="rand"
                             placeholder="450.00"/>
                    </label>
                    <label>
                      <span>When you paid it</span>
                      <input type="date" [(ngModel)]="expenseForm.incurredOn" name="incurredOn" [max]="today"/>
                    </label>
                    <label>
                      <span>Just one room? (optional)</span>
                      <select [(ngModel)]="expenseForm.roomId" name="roomId">
                        <option value="">The whole place</option>
                        @for (room of group.rooms; track room.id) {
                          <option [value]="room.id">{{ room.title }}</option>
                        }
                      </select>
                    </label>
                    <label>
                      <span>Note (optional)</span>
                      <input type="text" [(ngModel)]="expenseForm.note" name="note"
                             placeholder="Plumber for the geyser"/>
                    </label>
                    @if (expenseError()) { <p class="field-error" role="alert">{{ expenseError() }}</p> }
                    <div class="expense-form__actions">
                      <button type="submit" class="btn btn-primary btn-sm" [disabled]="savingExpense()">
                        {{ savingExpense() ? 'Saving…' : 'Add' }}
                      </button>
                      <button type="button" class="link-btn" [disabled]="downloadingCsv()"
                              (click)="downloadCsv(group.property.id, group.property.name)">
                        {{ downloadingCsv() ? 'Preparing…' : 'Download this year as CSV' }}
                      </button>
                    </div>
                  </form>
                }
              }
            </div>
          }

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

  protected readonly navItems: PortalNavItem[] = landlordNav();

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

  /** Mirrors the saved value, so the box shows what is actually being applied. */
  protected graceDays = 3;
  protected readonly savingGrace = signal(false);
  protected readonly graceSaved = signal(false);
  protected readonly graceError = signal<string | null>(null);

  // ── Shared living, and bulk relist ────────────────────────────────────────
  protected readonly editing = signal<string | null>(null);
  protected readonly savingShared = signal(false);
  protected readonly sharedError = signal<string | null>(null);
  protected readonly relisting = signal<string | null>(null);

  // ── Expenses ──────────────────────────────────────────────────────────────
  protected readonly summary = signal<ExpenseSummary | null>(null);
  protected readonly openExpenses = signal<string | null>(null);
  protected readonly expenses = signal<Expense[]>([]);
  protected readonly loadingExpenses = signal(false);
  protected readonly savingExpense = signal(false);
  protected readonly expenseError = signal<string | null>(null);
  protected readonly downloadingCsv = signal(false);

  /** Today, so the date field cannot be set in the future. */
  protected readonly today = new Date().toISOString().slice(0, 10);

  /**
   * The form takes RAND, and the API takes cents.
   *
   * Deliberately not cents in the input. A landlord typing 45000 meaning R450
   * would file R45 000, and there is no way for the product to tell the
   * difference afterwards — it is a plausible municipal bill either way.
   */
  protected expenseForm: {
    category: ExpenseCategory;
    rand: number | null;
    incurredOn: string;
    roomId: string;
    note: string;
  } = { category: 'municipal', rand: null, incurredOn: this.today, roomId: '', note: '' };

  /**
   * The edit form's working copy.
   *
   * `sharedAmenities` is a comma-separated STRING here and a string[] on the
   * wire. A landlord typing "kitchen, tap, washing line" is doing the obvious
   * thing, and making them add rows one at a time for three short phrases
   * would be a worse form for no gain.
   */
  protected form: {
    houseRules: string;
    sharedAmenities: string;
    currentHousemates: number | null;
    housemateProfile: HousemateProfile;
  } = { houseRules: '', sharedAmenities: '', currentHousemates: null, housemateProfile: 'unstated' };

  ngOnInit() {
    this.loadSummary();
    this.reload();
  }

  private reload() {
    this.loading.set(true);
    this.properties.loadDashboard().subscribe({
      next: (d) => {
        this.loading.set(false);
        this.graceDays = d.rentGraceDays;
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message ?? 'Could not load your property.');
      },
    });
  }

  protected saveGraceDays() {
    const days = Number(this.graceDays);
    if (!Number.isInteger(days) || days < 0 || days > 28) {
      this.graceError.set('Pick a whole number of days between 0 and 28.');
      return;
    }
    this.graceError.set(null);
    this.graceSaved.set(false);
    this.savingGrace.set(true);
    this.properties.setGraceDays(days).subscribe({
      next: () => {
        this.savingGrace.set(false);
        this.graceSaved.set(true);
      },
      error: (err) => {
        this.savingGrace.set(false);
        this.graceError.set(err?.error?.message ?? 'Could not save that.');
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
  /**
   * One line describing what the whole address shares, or null.
   *
   * Null when the landlord has said nothing, so the yard shows nothing rather
   * than an empty scaffold. `unstated` is deliberately not rendered: it is the
   * absence of an answer, and printing "who lives here: not stated" would put
   * a non-answer on screen as though it were information.
   */
  protected sharedSummary(property: Property): string | null {
    const parts: string[] = [];
    if (property.sharedAmenities?.length) parts.push(property.sharedAmenities.join(', '));
    if (property.currentHousemates != null) {
      parts.push(`${property.currentHousemates} living here`);
    }
    if (property.housemateProfile && property.housemateProfile !== 'unstated') {
      parts.push(HOUSEMATE_LABELS[property.housemateProfile]);
    }
    if (property.houseRules) parts.push(property.houseRules);
    return parts.length ? parts.join(' · ') : null;
  }

  protected editShared(property: Property) {
    this.sharedError.set(null);
    this.form = {
      houseRules: property.houseRules ?? '',
      sharedAmenities: (property.sharedAmenities ?? []).join(', '),
      currentHousemates: property.currentHousemates ?? null,
      housemateProfile: property.housemateProfile ?? 'unstated',
    };
    this.editing.set(property.id);
  }

  protected saveShared(id: string) {
    if (this.savingShared()) return;
    this.savingShared.set(true);
    this.sharedError.set(null);

    const amenities = this.form.sharedAmenities
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);

    this.properties
      .update(id, {
        houseRules: this.form.houseRules.trim(),
        sharedAmenities: amenities,
        // Sent only when given. Omitting leaves the stored value alone, which
        // is why an empty box cannot silently zero a real count.
        ...(this.form.currentHousemates != null ? { currentHousemates: this.form.currentHousemates } : {}),
        housemateProfile: this.form.housemateProfile,
      })
      .subscribe({
        next: () => {
          this.savingShared.set(false);
          this.editing.set(null);
          this.reload();
        },
        error: () => {
          this.savingShared.set(false);
          this.sharedError.set('That did not save. Check your connection and try again.');
        },
      });
  }

  /**
   * Relist every relistable room in this yard.
   *
   * Confirmed first, because relisting archives the previous cycle's
   * applicants on every room it touches — the same consequence the single-room
   * relist warns about, multiplied.
   *
   * The result names what was skipped rather than reporting a count. A
   * landlord who pressed "relist all" on six rooms and got four back needs to
   * know which two and why, and "4 of 6 relisted" is the shape of message that
   * sends someone hunting through the list themselves.
   */
  protected async relistYard(id: string, name: string) {
    const confirmed = await this.dialogs.confirm(
      `Relist every room in ${name}?`,
      'Rooms that are let, paused or removed go back on the board. Anyone who applied in the previous round is archived, as they are when you relist one room. Rooms already listed are left alone.',
      'Relist them',
      'Not now',
    );
    if (!confirmed) return;

    this.relisting.set(id);
    this.properties.relistAll(id).subscribe({
      next: (result) => {
        this.relisting.set(null);
        this.reload();
        const lines = [`${result.relisted.length} room(s) back on the board.`];
        for (const s of result.skipped) lines.push(`${s.title} — ${s.reason}`);
        void this.dialogs.confirm('Relisted', lines.join('\n'), 'OK', '');
      },
      error: () => {
        this.relisting.set(null);
        this.error.set('Could not relist those rooms. Check your connection and try again.');
      },
    });
  }

  /** What this yard has spent this month, from the summary already loaded. */
  protected yardSpend(propertyId: string): number | null {
    const row = this.summary()?.properties.find((p) => p.propertyId === propertyId);
    return row && row.expenseCents > 0 ? row.expenseCents : null;
  }

  protected categoryLabel(c: ExpenseCategory): string {
    return EXPENSE_LABELS[c] ?? c;
  }

  protected toggleExpenses(propertyId: string) {
    if (this.openExpenses() === propertyId) {
      this.openExpenses.set(null);
      return;
    }
    this.openExpenses.set(propertyId);
    this.expenseError.set(null);
    this.expenses.set([]);
    this.loadingExpenses.set(true);
    this.properties.listExpenses(propertyId).subscribe({
      next: (list) => {
        this.expenses.set(list);
        this.loadingExpenses.set(false);
      },
      error: () => {
        this.loadingExpenses.set(false);
        this.expenseError.set('Could not load what you have spent. Try again.');
      },
    });
  }

  protected addExpense(propertyId: string) {
    if (this.savingExpense()) return;
    const rand = Number(this.expenseForm.rand);
    if (!rand || rand <= 0) {
      // Caught here as well as in the API, because a form that posts and comes
      // back with a 400 teaches people the button is unreliable.
      this.expenseError.set('Enter how much you paid, in rand.');
      return;
    }

    this.savingExpense.set(true);
    this.expenseError.set(null);
    this.properties
      .createExpense({
        propertyId,
        // Rounded, not truncated: R450.555 typed by accident should not quietly
        // become R450.55 in one place and R450.56 in a total.
        amountCents: Math.round(rand * 100),
        category: this.expenseForm.category,
        incurredOn: this.expenseForm.incurredOn,
        ...(this.expenseForm.roomId ? { roomId: this.expenseForm.roomId } : {}),
        ...(this.expenseForm.note.trim() ? { note: this.expenseForm.note.trim() } : {}),
      })
      .subscribe({
        next: (created) => {
          this.savingExpense.set(false);
          this.expenses.update((list) => [created, ...list]);
          this.expenseForm = {
            category: 'municipal', rand: null, incurredOn: this.today, roomId: '', note: '',
          };
          this.loadSummary();
        },
        error: (err) => {
          this.savingExpense.set(false);
          this.expenseError.set(
            err?.status === 403
              ? 'That room is not in this yard.'
              : 'That did not save. Check your connection and try again.',
          );
        },
      });
  }

  protected async deleteExpense(expense: Expense) {
    const confirmed = await this.dialogs.confirm(
      'Remove this expense?',
      `${(expense.amountCents / 100).toFixed(2)} rand, ${this.categoryLabel(expense.category)}. This only removes your record of it — it does not undo the payment.`,
      'Remove it',
      'Keep it',
    );
    if (!confirmed) return;

    this.properties.deleteExpense(expense.id).subscribe({
      next: () => {
        this.expenses.update((list) => list.filter((e) => e.id !== expense.id));
        this.loadSummary();
      },
      error: () => this.expenseError.set('Could not remove that. Try again.'),
    });
  }

  private loadSummary() {
    this.properties.expenseSummary().subscribe({
      next: (s) => this.summary.set(s),
      // Silent: the money card is additional context, and a dashboard that
      // shows an error banner because one panel failed is worse than one that
      // shows the rest.
      error: () => {},
    });
  }

  /**
   * The CSV, as a file the browser saves.
   *
   * Built from the response rather than linking to the endpoint, because the
   * endpoint needs the bearer token and a plain <a href> carries no header.
   */
  protected downloadCsv(propertyId: string, name: string) {
    this.downloadingCsv.set(true);
    const year = new Date().getFullYear();
    this.properties.expenseCsv(propertyId, year).subscribe({
      next: (res) => {
        this.downloadingCsv.set(false);
        if (!res.count) {
          this.expenseError.set(`Nothing recorded for ${name} in ${year} yet.`);
          return;
        }
        const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res.filename;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => {
        this.downloadingCsv.set(false);
        this.expenseError.set('Could not build the file. Try again.');
      },
    });
  }

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
