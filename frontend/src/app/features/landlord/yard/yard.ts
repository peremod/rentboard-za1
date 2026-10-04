import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
import { LeaseDocuments } from '../../../shared/components/lease-documents/lease-documents';

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
/**
 * The path segment that means "the rooms that are in no property".
 *
 * A word rather than a uuid because it is not an entity — there is no
 * `Property` row for ungrouped rooms and inventing one would force structure on
 * a landlord who was promised they did not need it.
 */
const UNGROUPED = 'ungrouped';

@Component({
  selector: 'app-yard',
  standalone: true,
  imports: [
    PluralPipe, NgTemplateOutlet, DatePipe, FormsModule, RouterLink,
    ZarCentsPipe, PortalShell, LeasePanel, LeaseDocuments,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems" roleLabel="Landlord" pageTitle="Your property">

      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (propertyId() && !scoped()) {
        <!-- A property id that is not this landlord's, or has been deleted.
             Said as what it is, rather than drawn as an empty screen. -->
        <div class="empty-state">
          <h2>That property is not here</h2>
          <p>It may have been deleted, or it belongs to another account.</p>
          <a class="btn btn-primary" routerLink="/landlord/properties">Back to my properties</a>
        </div>
      } @else if (scoped(); as one) {
        <!-- ── The property detail view — Phase 7b ────────────────────────
             Scoped to one property. The landlord-wide sections (totals across
             everything, "This month", the rent-reminder window) are NOT drawn
             here: a four-property total shown inside one property is the kind
             of half-true number this project keeps having to take back out.
             They live on /landlord/properties. -->
        <p class="yard-back"><a routerLink="/landlord/properties">← My properties</a></p>

        @if (isUngrouped()) {
          <!-- Said plainly, because somebody who arrived here from a task
               button needs to know which rooms they are looking at. -->
          <p class="muted yard-ungrouped-note">
            These are your rooms that are not grouped under a property. Their
            rent and their paperwork work exactly the same; grouping is only for
            setting the house rules and the shared facilities once per address.
          </p>
        }

        <div class="yard-totals">
          <div class="yard-total">
            <strong>{{ one.roomCount }}</strong><span>{{ one.roomCount === 1 ? 'room' : 'rooms' }}</span>
          </div>
          <div class="yard-total" [class.yard-total--good]="one.vacant === 0">
            <strong>{{ one.vacant }}</strong><span>vacant</span>
          </div>
          <div class="yard-total" [class.yard-total--alert]="one.waitingApplicants > 0">
            <strong>{{ one.waitingApplicants }}</strong><span>waiting</span>
          </div>
        </div>

        @if (error()) { <div class="form-error" role="alert">{{ error() }}</div> }

        <!-- Add a room HERE, with this property already chosen — the brief asks
             for exactly this, and it is where grouping is won or lost: a
             landlord made to re-type the suburb does not come back to do it. -->
        <!-- Guarded on the group's property: the ungrouped view has none,
             and a non-null assertion on it would have put the word
             "undefined" into the wizard's query string. -->
        @if (one.property; as prop) {
          <div class="yard-detail-actions">
            <a class="btn btn-primary" routerLink="/landlord/rooms/new"
               [queryParams]="{ propertyId: prop.id }">
              + Add a room to this property
            </a>
            <button type="button" class="btn btn-outline" (click)="editShared(prop)">
              Edit this property
            </button>
          </div>
        } @else {
          <div class="yard-detail-actions">
            <a class="btn btn-primary" routerLink="/landlord/rooms/new">+ List another room</a>
            <a class="btn btn-outline" routerLink="/landlord/properties">Group these into a property</a>
          </div>
        }

        <ng-container [ngTemplateOutlet]="yardTpl"
                      [ngTemplateOutletContext]="{ $implicit: one }"/>

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
              + Group rooms into a property
            </button>
          }
        </div>

        <!-- The reminder window used to be here, in the landlord-wide view
             that Phase 7b left without a route. It is on /landlord/properties
             now, which is where the brief said the landlord-wide things belong
             and, more to the point, where a landlord can actually reach it. -->
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
      @if (money(); as m) {
        <section class="dash-section" id="money">
          <h2 class="dash-section-title">This month</h2>

          <!-- ⚠️ Scoped to the property this screen is about — Phase 7d.
               It was the landlord's PORTFOLIO total, rendered here unchanged, so
               opening one of four yards showed the rent and the spend of all
               four under that yard's name. The comment at the top of the scoped
               branch had already written down why that must not happen ("a
               four-property total shown inside one property is the kind of
               half-true number this project keeps having to take back out") and
               the section it was about sat outside the branch it described. -->
          <p class="muted money-scope">{{ m.scope }}</p>

          <div class="stat-row">
            <div class="stat-box">
              <div class="val">{{ m.rentCents | zarCents: 'exact' }}</div>
              <div class="lbl">Rent marked paid</div>
            </div>
            @if (m.expenseCents !== null) {
              <div class="stat-box">
                <div class="val">{{ m.expenseCents | zarCents: 'exact' }}</div>
                <div class="lbl">Spent</div>
              </div>
              <div class="stat-box">
                <div class="val" [class.stat-warn]="m.netCents! < 0">{{ m.netCents | zarCents: 'exact' }}</div>
                <div class="lbl">Left over</div>
              </div>
            }
          </div>

          @if (m.expenseCents === null) {
            <!-- An expense is recorded against a property, so there is no
                 figure to show here rather than a zero. A zero would read as
                 "you spent nothing", which is a different claim. -->
            <p class="muted">
              Expenses are recorded against a property, so there is nothing to
              total for rooms that are not in one.
            </p>
          }

          <p class="muted money-basis">{{ money()!.basis }}</p>
          @if (!scoped() && money()!.ungroupedRentCents > 0) {
            <p class="muted">
              {{ money()!.ungroupedRentCents | zarCents: 'exact' }} of that rent is on rooms not in a property, so the
              per-yard rows below add up to less than the total.
            </p>
          }
        </section>
      }

      <ng-template #yardTpl let-group>
        <div class="yard">
          <div class="yard__head">
            <div>
              <strong>{{ group.property?.name || 'Rooms not in a property' }}</strong>
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
                  Delete this property
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
              <!-- Nickname and address, Phase 7b. Editable here and nowhere
                   else, so there is one place a property is renamed — and
                   separate from editing an individual room, which the brief
                   asks for explicitly and which landlords conflate: "edit my
                   property" and "edit the listing" are different jobs. -->
              <label>
                <span>What you call this place</span>
                <input type="text" [(ngModel)]="form.name" name="name" required maxlength="120"
                       placeholder="Ext 7 back rooms"/>
              </label>
              <label>
                <span>Street address <span class="muted">(optional)</span></span>
                <input type="text" [(ngModel)]="form.addressLine" name="addressLine" maxlength="200"
                       placeholder="1423 Vilakazi Street"/>
                <span class="field-hint">
                  Only you see this. It is never on a listing and never sent to an
                  applicant — it is here so you can tell your own places apart.
                </span>
              </label>
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

              <!-- Per-room actions — Phase 7b asks for them to be clear and
                   separately visible. "Edit listing" and "Take out of this
                   property" are different jobs and landlords conflate them, so
                   they are two controls with two sets of words — and the one
                   that sounds destructive destroys nothing, which is why it
                   says what it does rather than "Remove". -->
              @if (group.property) {
                <div class="yard-room__actions">
                  <a class="link-btn" [routerLink]="['/landlord/rooms', room.id, 'edit']">Edit listing</a>
                  <button type="button" class="link-btn" [disabled]="busy()"
                          (click)="removeRoomFromProperty(room.id, room.title)">
                    Take out of this property
                  </button>
                </div>
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
                  <!-- On demand, like the rent record above it, and for the same
                       reason: a yard with six tenancies would otherwise open with
                       six upload forms nobody asked for. -->
                  <button type="button" class="link-btn"
                          [attr.aria-expanded]="showDocs().has(tenancy.id)"
                          [attr.aria-label]="'Paperwork for ' + tenancy.tenant.fullName"
                          (click)="toggleDocs(tenancy.id)">
                    {{ showDocs().has(tenancy.id) ? 'Hide paperwork' : 'Paperwork' }}
                  </button>
                </div>
                @if (showDocs().has(tenancy.id)) {
                  <!-- headingLevel 2, not 3, and this was wrong first time round.
                       The yard blocks are rendered by the ngTemplateOutlet near
                       the TOP of this template, above the reminders and money
                       sections, and the yard's own name is a <strong> rather than
                       a heading — so an h3 here landed directly under the page h1
                       and skipped a level. The drive caught it; reasoning about
                       the template did not, because the outlet is 140 lines from
                       the definition. -->
                  <app-lease-documents [tenancyId]="tenancy.id" [headingLevel]="2"/>
                }
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
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  /**
   * Which property this screen is about — Phase 7b.
   *
   * Null on the old /landlord/yard path (now a redirect) and set on
   * /landlord/properties/:propertyId, which is how this one screen serves as
   * the detail view the brief asks for. Reuse, deliberately: the rooms, their
   * rent, the expenses against the address, the lease documents and the private
   * notes are all already built here, per property. A second component drawing
   * the same things would be the copy that misses the next fix — this codebase
   * has paid for that with the nav defined six times and the shared-living
   * fields held twice.
   *
   * ⚠️ Declared BEFORE anything that reads it. Class fields initialise in
   * order, so `inject(ActivatedRoute)` has to come first; the first attempt at
   * this put the signal above the injection and the compiler said `route` did
   * not exist on the class, which reads like a missing import.
   */
  protected readonly propertyId = signal<string | null>(
    this.route.snapshot.paramMap.get('propertyId'),
  );

  protected readonly navItems: PortalNavItem[] = landlordNav();

  protected readonly dash = this.properties.dashboard;

  /**
   * The one group this screen shows when it is scoped to a property.
   *
   * ⚠️ `'ungrouped'` is a real destination, not a sentinel hack — Phase 7d.
   *
   * Phase 7b turned `/landlord/yard` into a redirect, and the only screen that
   * renders a room's rent, its lease paperwork and the expenses against it is
   * this one, reached as `/landlord/properties/:propertyId`. A landlord who
   * never grouped their rooms has no property id, so for them that screen had
   * no address at all: the properties list sent their ungrouped card to the
   * dashboard, and the task inbox's "Mark it" button sent them to the list.
   * Grouping is optional by design (Phase 7b insisted on it), so it cannot be
   * the price of reaching your own rent records.
   */
  protected readonly scoped = computed(() => {
    const id = this.propertyId();
    if (!id) return null;
    if (id === UNGROUPED) return this.dash()?.ungrouped ?? null;
    return this.dash()?.properties.find((g) => g.property?.id === id) ?? null;
  });

  /** True when this screen is showing the rooms that are in no property. */
  protected readonly isUngrouped = computed(() => this.propertyId() === UNGROUPED);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly creating = signal(false);
  protected readonly error = signal<string | null>(null);
  /**
   * Which tenancies have their paperwork open.
   *
   * A Set rather than a single id: a landlord comparing two leases should not
   * have one close as the other opens.
   */
  protected readonly showDocs = signal<Set<string>>(new Set());

  protected toggleDocs(tenancyId: string) {
    this.showDocs.update((open) => {
      const next = new Set(open);
      if (next.has(tenancyId)) next.delete(tenancyId);
      else next.add(tenancyId);
      return next;
    });
  }

  /** Rent periods by tenancy id, fetched on demand rather than with the list. */
  protected readonly rent = signal<Record<string, RentPeriod[]>>({});

  protected newName = '';
  protected newSuburb = '';
  protected newCity = '';
  protected newProvince = '';

  /** Mirrors the saved value, so the box shows what is actually being applied. */

  // ── Shared living, and bulk relist ────────────────────────────────────────
  protected readonly editing = signal<string | null>(null);
  protected readonly savingShared = signal(false);
  protected readonly sharedError = signal<string | null>(null);
  protected readonly relisting = signal<string | null>(null);

  // ── Expenses ──────────────────────────────────────────────────────────────
  protected readonly summary = signal<ExpenseSummary | null>(null);

  /**
   * "This month", for whatever this screen is actually about — Phase 7d.
   *
   * One computed rather than three branches in the template: the figures, the
   * sentence that says whose they are, and whether an expense total exists at
   * all have to move together, and a template deciding each separately is a
   * template that will show one property's rent under another's name.
   *
   * `expenseCents` is null rather than 0 for ungrouped rooms, because an
   * expense hangs off a property and "you spent nothing" is a different claim
   * from "there is nothing to total".
   */
  protected readonly money = computed(() => {
    const sum = this.summary();
    if (!sum) return null;

    const id = this.propertyId();
    if (id && id !== UNGROUPED) {
      const row = sum.properties.find((p) => p.propertyId === id);
      return {
        scope: `For ${row?.name ?? 'this property'} only.`,
        rentCents: row?.rentCents ?? 0,
        expenseCents: row?.expenseCents ?? 0,
        netCents: row?.netCents ?? 0,
        basis: sum.rentBasis,
        ungroupedRentCents: sum.ungroupedRentCents,
      };
    }
    if (id === UNGROUPED) {
      return {
        scope: 'For your rooms that are not in a property.',
        rentCents: sum.ungroupedRentCents,
        expenseCents: null as number | null,
        netCents: null as number | null,
        basis: sum.rentBasis,
        ungroupedRentCents: sum.ungroupedRentCents,
      };
    }
    return {
      scope: 'Across everything you let.',
      rentCents: sum.totalRentCents,
      expenseCents: sum.totalExpenseCents as number | null,
      netCents: sum.netCents as number | null,
      basis: sum.rentBasis,
      ungroupedRentCents: sum.ungroupedRentCents,
    };
  });
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
    name: string;
    addressLine: string;
  } = {
    houseRules: '', sharedAmenities: '', currentHousemates: null,
    housemateProfile: 'unstated', name: '', addressLine: '',
  };

  ngOnInit() {
    this.loadSummary();
    this.reload();
  }

  private reload() {
    this.loading.set(true);
    this.properties.loadDashboard().subscribe({
      // The payload lands in PropertiesService.dashboard, which `dash` reads.
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
          this.error.set(err?.error?.message ?? 'Could not create that property.');
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
      name: property.name,
      addressLine: property.addressLine ?? '',
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
        // Phase 7b. The name is required by the API, so it is sent as typed and
        // only when it is not empty — a blank box must fail the form, not
        // rename the property to nothing.
        ...(this.form.name.trim() ? { name: this.form.name.trim() } : {}),
        // Sent even when empty, unlike the count below: clearing the address is
        // a thing a landlord may want to do, and an empty string is how they say
        // "take it off". The column is theirs alone.
        addressLine: this.form.addressLine.trim(),
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
              ? 'That room is not in this property.'
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

  /**
   * Delete a property — Phase 7b, and never silently.
   *
   * The confirmation names the number of rooms and says what will and will not
   * happen to them, rather than asking "Are you sure?" and leaving a landlord
   * to guess whether six live listings and their applications are about to go.
   * The API refuses the call outright unless `ungroupRooms` is passed, so this
   * dialog is what earns the flag — the rule is enforced server-side, not here.
   */
  protected async deleteYard(id: string, name: string) {
    const group = this.dash()?.properties.find((g) => g.property?.id === id);
    const rooms = group?.roomCount ?? 0;

    const detail = rooms === 0
      ? 'It has no rooms grouped under it, so nothing else changes.'
      : `The ${rooms} ${rooms === 1 ? 'room' : 'rooms'} grouped under it will NOT be deleted. ` +
        `${rooms === 1 ? 'It stays' : 'They stay'} exactly as ${rooms === 1 ? 'it is' : 'they are'} — ` +
        'still on the board, still with their applications and tenants — and simply stop being grouped. ' +
        'What you lose is the grouping itself: the house rules, the shared facilities and the ' +
        'housemate details you set once for this address.';

    const confirmed = await this.dialogs.confirm(`Delete "${name}"?`, detail);
    if (!confirmed) return;

    this.busy.set(true);
    this.properties.remove(id, true).subscribe({
      next: () => {
        this.busy.set(false);
        // On the detail screen the thing this page is about has just gone, so
        // staying here would show "That property is not here" to somebody who
        // just deleted it on purpose.
        if (this.propertyId() === id) {
          this.router.navigate(['/landlord/properties']);
          return;
        }
        this.reload();
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(err?.error?.message ?? 'Could not delete that property.');
      },
    });
  }

  /**
   * Take a room out of this property — Phase 7b.
   *
   * The brief asks for this to be separately visible and unmistakeable, because
   * "remove" next to a listing reads as "delete my listing". It does not: the
   * room keeps its photos, its applications and its place on the board, and
   * only stops being grouped at this address.
   */
  protected async removeRoomFromProperty(roomId: string, title: string) {
    const confirmed = await this.dialogs.confirm(
      `Take "${title}" out of this property?`,
      'The listing is NOT deleted. It stays on the board exactly as it is, with its photos, ' +
      'its applications and its tenant if it has one — it just stops being grouped at this ' +
      'address, and stops using the house rules and shared facilities set here. ' +
      'You can group it again at any time.',
    );
    if (!confirmed) return;

    this.busy.set(true);
    this.properties.unassignRoom(roomId).subscribe({
      next: () => { this.busy.set(false); this.reload(); },
      error: (err) => {
        this.busy.set(false);
        this.error.set(err?.error?.message ?? 'Could not take that room out of the property.');
      },
    });
  }
}
