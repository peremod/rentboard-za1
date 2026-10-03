import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { RoomsService } from '../../../core/services/rooms.service';
import { SA_PROVINCES, AMENITIES } from '../../../core/models/room.model';
import { PropertiesService } from '../../../core/services/properties.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { DialogService } from '../../../core/services/dialog.service';
import { PhotoUpload, UploadedPhoto } from '../../../shared/components/photo-upload/photo-upload';

/**
 * Create-room wizard — 4 steps: basics → pricing/location → preferences → photos.
 * The room is created as a `draft` the moment step 3 completes (so the
 * PhotoUpload component has a real roomId to scope its ImageKit folder to),
 * then updated + published on step 4's submit.
 *
 * Rent is entered and displayed in whole Rands throughout the UI — the
 * ZAR-cents conversion happens only at the two API call boundaries
 * (create/update), matching the "cents only crosses the wire" rule the
 * project's Audit Report calls out.
 */
@Component({
  selector: 'app-create-room',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, PhotoUpload],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wizard">
      <!-- The page's H1, and it had none — found by adding this screen to the
           accessibility drive for Phase 6. Every step of the wizard opened with
           an H2, so the heading outline of the most important form in the
           landlord portal started at level two and the page never said what it
           was. It has been like that since the wizard shipped; nothing audited
           it, because the drive covered the dashboard and not the forms.

           It names the flow, so a sub-lessor and an owner are not told they are
           doing the same thing. -->
      <h1 class="wizard__title">
        {{ isSublet() ? 'Sublet a room in your place' : 'List a room' }}
      </h1>

      <div class="wizard__steps">
        @for (s of [1,2,3,4]; track s) {
          <div class="wizard__step" [class.active]="step() === s" [class.done]="step() > s">{{ s }}</div>
        }
      </div>

      <!-- Which flow this is. A sub-lessor who thinks they are listing as an
           owner would tick a box that says something untrue about who they are
           to every applicant, so the wizard says it plainly and links to what
           applicants will be told. -->
      @if (isSublet()) {
        <div class="sublet-banner">
          <p><strong>🔑 You are listing a room in a place you rent.</strong></p>
          <p>
            Applicants are told this plainly, and told that we have not confirmed
            you are allowed to sublet. You can upload your lease and your
            landlord's written consent afterwards, from your dashboard — it is
            <strong>free</strong>, and listings that have been checked get taken
            far more seriously.
          </p>
          <p>
            Check your own lease first: most require the owner's written consent,
            and you are the one who loses their home if it is cancelled.
            <a routerLink="/legal/sublet" target="_blank">What applicants are told →</a>
          </p>
        </div>
      }

      @if (step() === 1) {
        <form [formGroup]="basicsForm">
          <h2>Tell us about the room</h2>
          <label>Room type
            <select formControlName="roomType">
              <option value="shared_house">Shared house</option>
              <option value="en_suite">En-suite</option>
              <option value="studio">Studio</option>
              <option value="private">Private room</option>
            </select>
          </label>
          <div class="form-row"><label>Title</label><input type="text" formControlName="title" placeholder="e.g. Bright en-suite near Gautrain"/></div>
          <div class="form-row"><label>Description</label><textarea formControlName="description" rows="4" placeholder="Describe the room, the house, and who you're looking for (min. 50 characters)"></textarea></div>
          <p class="muted">{{ basicsForm.get('description')?.value?.length ?? 0 }}/50 characters minimum</p>
          <div class="wizard__actions">
            <button type="button" class="btn btn-ghost-light" (click)="cancel()">Cancel</button>
            <button type="button" [disabled]="basicsForm.invalid" (click)="goToStep(2)">Next →</button>
          </div>
        </form>
      }

      @if (step() === 2) {
        <form [formGroup]="pricingForm">
          <h2>Pricing &amp; location</h2>

          <!-- ── The property picker — Phase 7b ──────────────────────────────
               The brief's diagnosis, and it reads true: landlords create rooms
               one at a time without realising there is a grouping concept to
               opt into, because grouping lived on a different screen, below the
               rent tracking, behind a button that said "yard".

               So the question is asked HERE, in the landlord's own words, with
               the places they already have shown as cards they can recognise —
               a photo and the name they chose, not an address in a dropdown.

               Only shown to somebody who HAS a property. A landlord with one
               address is never asked: the brief is explicit that structure must
               not be forced on people who do not need it, and a picker with one
               option and a "no" is a question that teaches nothing. -->
          @if (!isSublet() && myProperties().length > 0) {
            <fieldset class="prop-picker">
              <legend>Is this room at an address where you already have a room listed?</legend>

              <div class="prop-picker__options">
                @for (p of myProperties(); track p.id) {
                  <button type="button" class="prop-picker__card"
                          [class.is-chosen]="chosenPropertyId() === p.id"
                          [attr.aria-pressed]="chosenPropertyId() === p.id"
                          (click)="choosePropertyFor(p)">
                    @if (p.thumbnail) {
                      <img class="prop-picker__img" [src]="p.thumbnail" alt="" width="64" height="48"/>
                    } @else {
                      <span class="prop-picker__img prop-picker__img--none" aria-hidden="true">🏘️</span>
                    }
                    <span class="prop-picker__text">
                      <strong>{{ p.name }}</strong>
                      <span class="muted">{{ p.where }} · {{ p.roomCount }} {{ p.roomCount === 1 ? 'room' : 'rooms' }}</span>
                    </span>
                  </button>
                }

                <button type="button" class="prop-picker__card prop-picker__card--no"
                        [class.is-chosen]="chosenPropertyId() === null && pickerAnswered()"
                        [attr.aria-pressed]="chosenPropertyId() === null && pickerAnswered()"
                        (click)="chooseNoProperty()">
                  <span class="prop-picker__img prop-picker__img--none" aria-hidden="true">＋</span>
                  <span class="prop-picker__text">
                    <strong>No — somewhere new</strong>
                    <span class="muted">You can group it later</span>
                  </span>
                </button>
              </div>

              @if (chosenPropertyId()) {
                <p class="field-hint">
                  The province, city and location below have been filled in from that
                  property. Change them if this room is somewhere else.
                </p>
              }
            </fieldset>
          }

          <div class="form-row"><label>Monthly rent (ZAR)</label><input type="number" formControlName="rent" min="100" placeholder="5500"/></div>
          <div class="form-row"><label>Deposit (ZAR, optional)</label><input type="number" formControlName="deposit" min="0"/></div>
          <label class="check-row">
            <input type="checkbox" formControlName="billsIncluded"/>
            <span class="check-row__text">
              <span class="check-row__label">Bills included</span>
              <span class="check-row__hint">
                Water, electricity and rates are covered by the rent.
              </span>
            </span>
          </label>
          <label>Province
            <select formControlName="province">
              <option value="" disabled>Select a province</option>
              @for (p of provinces; track p) { <option [value]="p">{{ p }}</option> }
            </select>
          </label>
          <div class="form-row"><label>City / suburb</label><input type="text" formControlName="city" placeholder="Sandton"/></div>
          <div class="form-row"><label>Location display</label><input type="text" formControlName="locationDisplay" placeholder="Sandton, Gauteng"/></div>
          <div class="form-row"><label>Available from</label><input type="date" formControlName="availableFrom"/></div>
          <div class="wizard__actions">
            <button type="button" (click)="step.set(1)">← Back</button>
            <button type="button" class="btn btn-ghost-light" (click)="cancel()">Cancel</button>
            <button type="button" [disabled]="pricingForm.invalid" (click)="goToStep(3)">Next →</button>
          </div>
        </form>
      }

      @if (step() === 3) {
        <form [formGroup]="preferencesForm">
          <h2>Housemate preferences</h2>
          <div class="form-row"><label>Current housemates</label><input type="number" formControlName="housematesCount" min="0"/></div>
          <label class="check-row">
            <input type="checkbox" formControlName="couplesAllowed"/>
            <span class="check-row__text">
              <span class="check-row__label">Couples welcome</span>
              <span class="check-row__hint">Two people may share the room.</span>
            </span>
          </label>

          <label class="check-row">
            <input type="checkbox" formControlName="dssAccepted"/>
            <span class="check-row__text">
              <span class="check-row__label">SASSA grant recipients welcome</span>
              <span class="check-row__hint">
                You'll consider tenants whose income is a government grant —
                old age, disability, child support or similar.
              </span>
            </span>
          </label>

          <label class="check-row">
            <input type="checkbox" formControlName="guarantorAccepted"/>
            <span class="check-row__text">
              <span class="check-row__label">Guarantor accepted</span>
              <span class="check-row__hint">
                If a tenant can't show enough income on their own, you'll accept
                someone — often a parent or employer — who agrees in writing to
                cover the rent if they don't.
              </span>
            </span>
          </label>
          <label class="check-row">
            <input type="checkbox" formControlName="petsAllowed"/>
            <span class="check-row__text">
              <span class="check-row__label">Pets allowed</span>
              <span class="check-row__hint">Cats or dogs are welcome in the house.</span>
            </span>
          </label>
          <!-- The household — Phase 6.
               Only for a sublet, and that is not gatekeeping: somebody taking a
               room in a house the lister LIVES IN is choosing housemates as
               much as a room, which is the one thing every listing on every
               competitor leaves out. An owner letting a backroom often knows
               none of this, and asking them would produce guesses.

               Every select can be left on "Rather not say" — and that is a
               real stored value, never rendered to a tenant, rather than a
               default masquerading as an answer. -->
          @if (isSublet()) {
            <h3 class="amenities__heading">Who lives in the house?</h3>
            <p class="field-hint">
              This is what people ask first when they are moving in with
              strangers, and it is the main reason somebody picks your room over
              another at the same price. Leave anything blank if you would rather
              not say — nothing is shown unless you answer it.
            </p>

            <div class="form-row">
              <label for="hh-profile">The people here are</label>
              <select id="hh-profile" formControlName="housemateProfile">
                <option value="unstated">Rather not say</option>
                <option value="professionals">Mostly working people</option>
                <option value="students">Mostly students</option>
                <option value="mixed">A mix of people</option>
                <option value="couples">Mostly couples</option>
              </select>
            </div>

            <div class="form-row">
              <label for="hh-schedule">Hours people keep</label>
              <select id="hh-schedule" formControlName="householdSchedule">
                <option value="unstated">Rather not say</option>
                <option value="weekday_working">Out at work or college on weekdays</option>
                <option value="shift_work">Somebody works shifts</option>
                <option value="mostly_home">Somebody is usually home</option>
                <option value="varied">Everybody keeps different hours</option>
              </select>
            </div>

            <div class="form-row">
              <label for="hh-clean">How tidy the house is kept</label>
              <select id="hh-clean" formControlName="householdCleanliness">
                <option value="unstated">Rather not say</option>
                <option value="very_tidy">Very tidy — there is a cleaning rota</option>
                <option value="tidy_enough">Tidy enough</option>
                <option value="relaxed">Relaxed</option>
              </select>
            </div>

            <div class="form-row">
              <label for="hh-social">Sociable or quiet</label>
              <select id="hh-social" formControlName="householdSocial">
                <option value="unstated">Rather not say</option>
                <option value="social">Sociable — people eat together, visitors are normal</option>
                <option value="quiet">Quiet — friendly, but people keep to themselves</option>
                <option value="balanced">In between</option>
              </select>
            </div>

            <div class="form-row">
              <label for="hh-rules">House rules, in your own words</label>
              <textarea id="hh-rules" formControlName="houseRules" rows="3"
                        placeholder="e.g. Gate locked at 9. No visitors after 10 on weeknights. Kitchen cleaned the same day."></textarea>
              <p class="field-hint">
                The specific ones that matter here. Tenants read these closely, and
                saying them up front saves an argument in month two.
              </p>
            </div>
          }

          @if (creatingDraft()) { <p class="muted">Saving draft…</p> }
          @if (createError()) { <p class="error">{{ createError() }}</p> }
          
          <h3 class="amenities__heading">What does the room have?</h3>
          <p class="field-hint">
            Tenants filter on these, and a listing that lists nothing looks
            like it is hiding something. Tick what applies.
          </p>

          @for (group of amenityGroups; track group.group) {
            <div class="amenities__group">
              <div class="amenities__group-name">{{ group.group }}</div>
              <div class="amenities__items">
                @for (item of group.items; track item.value) {
                  <label class="amenity-chip" [class.amenity-chip--on]="hasAmenity(item.value)">
                    <input type="checkbox" [checked]="hasAmenity(item.value)"
                           (change)="toggleAmenity(item.value)"/>
                    {{ item.label }}
                  </label>
                }
              </div>
            </div>
          }

          <div class="wizard__actions">
            <button type="button" (click)="step.set(2)">← Back</button>
            <button type="button" class="btn btn-ghost-light" (click)="cancel()">Cancel</button>
            <button type="button" [disabled]="creatingDraft()" (click)="createDraftAndContinue()">Next →</button>
          </div>
        </form>
      }

      @if (step() === 4 && roomId()) {
        <div>
          <h2>Add photos</h2>
          <app-photo-upload [folder]="'rooms/' + roomId()"
                            [initialPhotos]="photos()"
                            (photosChange)="onPhotosChange($event)"/>
          @if (publishError()) { <p class="error">{{ publishError() }}</p> }
          @if (saveError()) { <p class="error">{{ saveError() }}</p> }
          @if (savedMessage()) { <p class="field-hint">{{ savedMessage() }}</p> }

          <div class="wizard__actions">
            <button type="button" class="btn btn-outline" (click)="step.set(3)">← Back</button>
            <button type="button" class="btn btn-ghost-light" (click)="cancel()">Cancel</button>

            @if (isPublished()) {
              <!-- Live listing: saving keeps it on the board rather than
                   re-publishing it, which would reset publishedAt. -->
              <button type="button" class="btn btn-primary"
                      [disabled]="photos().length === 0 || saving()" (click)="saveChanges()">
                {{ saving() ? 'Saving…' : 'Save changes' }}
              </button>
            } @else {
              <button type="button" class="btn btn-primary"
                      [disabled]="photos().length === 0 || publishing()" (click)="publish()">
                {{ publishing() ? 'Publishing…' : 'Publish listing 🎉' }}
              </button>
            }
          </div>
        </div>
      }
    </div>

    @if (savedDialog()) {
      <div class="save-dialog" role="alertdialog" aria-modal="true"
           aria-labelledby="save-dialog-title">
        <div class="save-dialog__panel">
          <div class="save-dialog__icon" aria-hidden="true">✅</div>
          <h2 id="save-dialog-title" class="save-dialog__title">Changes saved</h2>
          <p class="save-dialog__body">Your listing is still live.</p>
          <button type="button" class="btn btn-primary save-dialog__ok"
                  (click)="dismissSaved()" #savedOk>
            Back to dashboard
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    /* Blocks the page deliberately: the landlord has finished a task and the
       only sensible next step is leaving, so a dismissable dialog is clearer
       than a notification that fades while they are still reading it. */
    .save-dialog {
      position: fixed; inset: 0; z-index: 300;
      background: rgba(26, 20, 16, .55);
      display: flex; align-items: center; justify-content: center; padding: 1.5rem;
    }
    .save-dialog__panel {
      background: var(--card, #fff); border-radius: 12px;
      padding: 1.75rem 1.5rem; max-width: 22rem; width: 100%; text-align: center;
      box-shadow: 0 18px 44px rgba(0, 0, 0, .22);
    }
    .save-dialog__icon { font-size: 2rem; line-height: 1; margin-bottom: .5rem; }
    .save-dialog__title { font-size: 1.15rem; font-weight: 700; margin-bottom: .35rem; }
    .save-dialog__body { font-size: .9rem; color: var(--ink2, #5A5044); margin-bottom: 1.25rem; }
    .save-dialog__ok { width: 100%; }

    .wizard { max-width: 520px; margin: 2rem auto; padding: 0 1.25rem; font-family: sans-serif; }
    .wizard__steps { display: flex; gap: .5rem; margin-bottom: 2rem; }
    /* The sublet banner. Amber and bordered, like the notice an applicant sees
       on the room page — the two should look like the same fact stated to the
       two sides of it. */
    .sublet-banner {
      border: 1.5px solid #C9792B;
      border-left-width: 5px;
      background: #FDF6EC;
      border-radius: var(--r8, 8px);
      padding: .85rem 1rem;
      margin-bottom: 1.25rem;
      font-size: .88rem;
      line-height: 1.55;
    }
    .sublet-banner p { margin: 0 0 .5rem; }
    .sublet-banner p:last-child { margin-bottom: 0; }
    .wizard__title { font-size: 1.3rem; font-weight: 700; margin: 0 0 1rem; }
    .wizard__step { flex: 1; height: 4px; background: #DDD5C8; border-radius: 4px; }
    .wizard__step.active, .wizard__step.done { background: var(--terra); }
    h2 { font-size: 1.2rem; margin-bottom: 1rem; }
    /* Scoped away from checkboxes. Angular's emulated encapsulation makes a
       component style beat any global rule, so these two lines overrode the
       app-wide checkbox handling and stretched every box to the full form
       width — which is why the glyph rendered centred with its label beneath.
       The global rules already cover controls correctly; these only need to
       carry what is specific to this wizard. */
    label:not(.check-row):not(.amenity-chip) {
      display: block; font-size: .85rem; font-weight: 600; margin-bottom: .9rem;
    }
    input:not([type='checkbox']):not([type='radio']),
    select,
    textarea {
      width: 100%; padding: .55rem .7rem; border: 1.5px solid #DDD5C8;
      border-radius: 6px; font-size: .85rem; margin-top: .3rem; font-family: inherit;
    }
    .muted { font-size: .78rem; color: var(--slate); }
    .error { color: #D63B3B; font-size: .82rem; }
    .wizard__actions { display: flex; justify-content: space-between; margin-top: 1.5rem; }
    button { padding: .6rem 1.2rem; border-radius: 6px; border: none; background: var(--terra); color: #fff; font-weight: 700; cursor: pointer; }
    button:disabled { opacity: .5; cursor: not-allowed; }
  `],
})
export class CreateRoom implements OnInit {
  private fb = inject(FormBuilder);
  private roomsService = inject(RoomsService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private analytics = inject(AnalyticsService);
  private dialogs = inject(DialogService);
  private properties = inject(PropertiesService);

  provinces = SA_PROVINCES;

  /**
   * Is this the sublet flow — Phase 6.
   *
   * From route DATA (`{ listerType: 'sublessor' }` on the /tenant/sublet
   * routes), not from the signed-in role. A landlord who owns a yard can also
   * rent a flat and sublet its spare room, and asking "what is your role" would
   * give that person the wrong wizard. The route they chose says which kind of
   * listing they are making; the API then re-decides it from the account's role
   * and never trusts this (RoomsService.create).
   */
  /**
   * The landlord's existing properties, as recognisable cards — Phase 7b.
   *
   * Loaded from the same dashboard call the properties screen uses, flattened
   * to what a card needs: the name they chose, where it is, how many rooms are
   * there, and a photo borrowed from one of those rooms. A property photo would
   * be a second upload flow and a second thing to delete under POPIA; the rooms
   * at an address already carry pictures of it.
   *
   * Failure is silent and the picker simply does not appear: a landlord in the
   * middle of listing a room must not be stopped by a grouping feature.
   */
  readonly myProperties = signal<
    { id: string; name: string; where: string; roomCount: number; thumbnail: string | null;
      province: string; city: string; suburb: string | null }[]
  >([]);

  /** Which property this room is being added to, if any. */
  readonly chosenPropertyId = signal<string | null>(null);
  /** Whether the landlord has answered the question at all — "no" is an answer. */
  readonly pickerAnswered = signal(false);

  readonly isSublet = signal(
    this.route.snapshot.data['listerType'] === 'sublessor',
  );

  step = signal(1);
  roomId = signal<string | null>(null);
  photos = signal<UploadedPhoto[]>([]);

  /** True when resuming an existing draft via /landlord/rooms/:roomId/edit. */
  isEditing = signal(false);
  /** Editing a live listing rather than a draft — changes the save action. */
  isPublished = signal(false);
  saving = signal(false);
  saveError = signal<string | null>(null);
  savedMessage = signal<string | null>(null);
  savedDialog = signal(false);
  loadingDraft = signal(false);

  readonly amenityGroups = AMENITIES;
  amenities = signal<string[]>([]);

  creatingDraft = signal(false);
  createError = signal<string | null>(null);
  publishing = signal(false);
  publishError = signal<string | null>(null);

  /**
   * Saves edits to a live listing without taking it off the board. Details and
   * gallery go in separate calls because photos have their own endpoint, which
   * enforces that a published room keeps at least one image.
   */
  /**
   * Leave the wizard. Confirms only when there is something to lose — a draft
   * is already saved server-side, so the warning is about unsaved edits to a
   * live listing, not about the draft disappearing.
   */
  hasAmenity(value: string) {
    return this.amenities().includes(value);
  }

  toggleAmenity(value: string) {
    this.amenities.update((list) =>
      list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
    );
  }

  /**
   * Wizard progress, aggregate only.
   *
   * Landlord drop-off is the single most valuable thing to measure here: a
   * landlord who abandons the wizard is a room the board never gets, and they
   * almost never come back to say why.
   */
  /** Forward navigation only — a Back click is not funnel progress. */
  goToStep(step: number) {
    this.step.set(step);
    this.trackStep(step);
  }

  private trackStep(step: number) {
    const events: Record<number, string> = {
      1: 'wizard.started',
      2: 'wizard.step2_reached',
      3: 'wizard.step3_reached',
      4: 'wizard.step4_reached',
    };
    if (events[step]) this.analytics.track(events[step]);
  }

  /** Acknowledging the save is what returns to the dashboard. */
  dismissSaved() {
    this.savedDialog.set(false);
    this.router.navigate(['/landlord/dashboard']);
  }

  async cancel() {
    this.analytics.track('wizard.abandoned');

    const confirmed = this.isPublished()
      ? await this.dialogs.confirm(
          'Discard your changes?',
          'This listing stays live with its current details. Anything you have changed here will be lost.',
          'Discard changes',
          'Keep editing',
        )
      : await this.dialogs.confirm(
          'Leave this listing?',
          'Your draft is saved. You can finish it from your dashboard whenever you are ready.',
          'Leave',
          'Keep going',
        );

    if (!confirmed) return;
    this.router.navigate(['/landlord/dashboard']);
  }

  saveChanges() {
    const id = this.roomId();
    if (!id) return;

    this.saving.set(true);
    this.saveError.set(null);
    this.savedMessage.set(null);

    const basics = this.basicsForm.getRawValue();
    const pricing = this.pricingForm.getRawValue();

    this.roomsService.updateRoom(id, {
      roomType: basics.roomType as any,
      title: basics.title!,
      description: basics.description!,
      rentCents: Math.round((pricing.rent ?? 0) * 100),
      depositCents: pricing.deposit ? Math.round(pricing.deposit * 100) : undefined,
      billsIncluded: !!pricing.billsIncluded,
      province: pricing.province!,
      city: pricing.city!,
      locationDisplay: pricing.locationDisplay!,
      availableFrom: pricing.availableFrom!,
      ...this.preferencesForm.getRawValue(),
      amenities: this.amenities(),
    } as any).subscribe({
      next: () => {
        this.roomsService.updatePhotos(id, this.photos().map((p) => p.path)).subscribe({
          next: () => {
            this.saving.set(false);
            // A dialog rather than a toast: this is the end of a task, and a
            // notification that fades can be missed entirely on a page the
            // landlord is about to leave.
            this.savedDialog.set(true);
          },
          error: (err) => {
            this.saving.set(false);
            this.saveError.set(err?.error?.message ?? 'Photos could not be saved.');
          },
        });
      },
      error: (err) => {
        this.saving.set(false);
        this.saveError.set(err?.error?.message ?? 'Changes could not be saved.');
      },
    });
  }

  /**
   * Choose a property: fill in the location from it — Phase 7b.
   *
   * The pre-filling is the point. A landlord who has to retype the suburb for
   * the second room at the same address will not come back to this screen to
   * group anything, which is the behaviour the brief is trying to change. The
   * fields stay editable, because the picker is an assumption and not a rule.
   */
  choosePropertyFor(p: { id: string; province: string; city: string; suburb: string | null; name: string }) {
    this.chosenPropertyId.set(p.id);
    this.pickerAnswered.set(true);
    this.pricingForm.patchValue({
      province: p.province,
      city: p.city,
      // What the board shows. The suburb when there is one, because that is
      // what a tenant recognises and it is as precise as this platform goes.
      locationDisplay: p.suburb ? `${p.suburb}, ${p.city}` : p.city,
    });
  }

  chooseNoProperty() {
    this.chosenPropertyId.set(null);
    this.pickerAnswered.set(true);
  }

  ngOnInit() {
    this.analytics.track('wizard.started');

    // The picker's cards, and the property this room may already belong to —
    // Phase 7b. `?propertyId=` arrives from "+ Add a room to this property" on
    // the property detail screen, which is the flow that makes grouping
    // effortless rather than a thing to remember.
    const preset = this.route.snapshot.queryParamMap.get('propertyId');
    this.properties.loadDashboard().subscribe({
      next: (d) => {
        this.myProperties.set(
          d.properties
            .filter((g) => !!g.property)
            .map((g) => ({
              id: g.property!.id,
              name: g.property!.name,
              where: [g.property!.suburb, g.property!.city].filter(Boolean).join(', '),
              roomCount: g.roomCount,
              thumbnail: g.rooms.find((r) => r.heroImagePath)?.heroImagePath ?? null,
              province: g.property!.province,
              city: g.property!.city,
              suburb: g.property!.suburb ?? null,
            })),
        );
        const match = this.myProperties().find((p) => p.id === preset);
        if (match) this.choosePropertyFor(match);
      },
      error: () => {},
    });

    const id = this.route.snapshot.paramMap.get('roomId');
    if (!id) return;   // creating a new listing

    this.isEditing.set(true);
    this.loadingDraft.set(true);
    this.roomId.set(id);

    this.roomsService.getRoom(id).subscribe({
      next: (room) => {
        this.basicsForm.patchValue({
          roomType: room.roomType,
          title: room.title,
          description: room.description ?? '',
        });
        this.pricingForm.patchValue({
          rent: room.rentCents / 100,
          deposit: room.depositCents ? room.depositCents / 100 : null,
          billsIncluded: room.billsIncluded,
          province: room.province,
          city: room.city,
          locationDisplay: room.locationDisplay,
          // The input is type=date, which only accepts yyyy-MM-dd.
          availableFrom: room.availableFrom ? room.availableFrom.split('T')[0] : '',
        });

        // Phase 6. The flow is known from the route for a new listing and from
        // the ROOM when resuming one, so /tenant/sublet/:id/edit and
        // /landlord/rooms/:id/edit both show the right wizard for what the
        // listing actually is.
        if (room.listerType === 'sublessor') this.isSublet.set(true);
        if (room.property) {
          this.preferencesForm.patchValue({
            housemateProfile: room.property.housemateProfile ?? 'unstated',
            householdSchedule: room.property.householdSchedule ?? 'unstated',
            householdCleanliness: room.property.householdCleanliness ?? 'unstated',
            householdSocial: room.property.householdSocial ?? 'unstated',
            houseRules: room.property.houseRules ?? '',
          });
        }

        // Preferences were not restored at all, so editing a listing silently
        // reset couples/pets/SASSA to false and housemates to 0 on save.
        this.amenities.set(room.amenities ?? []);
        this.preferencesForm.patchValue({
          housematesCount: room.housematesCount ?? 0,
          couplesAllowed: room.couplesAllowed,
          dssAccepted: room.dssAccepted,
          guarantorAccepted: room.guarantorAccepted,
          petsAllowed: room.petsAllowed,
        });
        // Cover first, then the rest of the gallery.
        const gallery = [
          ...(room.heroImagePath ? [room.heroImagePath] : []),
          ...(room.imagePaths ?? []),
        ];
        this.photos.set(gallery.map((path) => ({ path, url: path })));

        this.isPublished.set(room.status !== 'draft');
        // A draft opens at photos, since a missing cover is the usual reason it
        // stalled. A live listing opens at step 1, because the landlord is more
        // often correcting a detail than adding an image.
        this.step.set(room.status === 'draft' ? 4 : 1);
        this.loadingDraft.set(false);
      },
      error: () => {
        this.loadingDraft.set(false);
        this.createError.set('Could not load this draft. It may have been discarded.');
      },
    });
  }

  basicsForm = this.fb.group({
    roomType: ['shared_house', Validators.required],
    title: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(80)]],
    description: ['', [Validators.required, Validators.minLength(50)]],
  });

  pricingForm = this.fb.group({
    rent: [null as number | null, [Validators.required, Validators.min(100)]],
    deposit: [null as number | null],
    billsIncluded: [false],
    province: ['', Validators.required],
    city: ['', Validators.required],
    locationDisplay: ['', Validators.required],
    availableFrom: ['', Validators.required],
  });

  preferencesForm = this.fb.group({
    housematesCount: [0],
    couplesAllowed: [false],
    dssAccepted: [false],
    guarantorAccepted: [false],
    petsAllowed: [false],
    // ── The household — Phase 6, sublet listings only ───────────────────
    //
    // In the same form group as the other preferences rather than a group of
    // their own, because step 3 is one form and one save; and sent to the API
    // as a nested `household` block, because they are stored on the PROPERTY
    // (four rooms at one address have one household — see the ListerType and
    // Property comments in schema.prisma). The split happens in
    // householdPayload() so there is exactly one place that knows it.
    housemateProfile: ['unstated'],
    householdSchedule: ['unstated'],
    householdCleanliness: ['unstated'],
    householdSocial: ['unstated'],
    houseRules: [''],
  });

  /**
   * The household fields, shaped for the API — or undefined when nothing was
   * said.
   *
   * Returns undefined rather than a block of `unstated`s for an owner listing,
   * so an ordinary backroom listing sends exactly what it always did and no
   * Property is created behind the landlord's back.
   */
  private householdPayload() {
    if (!this.isSublet()) return undefined;
    const p = this.preferencesForm.getRawValue();
    const rules = (p.houseRules ?? '').trim();
    const said =
      p.housemateProfile !== 'unstated' || p.householdSchedule !== 'unstated' ||
      p.householdCleanliness !== 'unstated' || p.householdSocial !== 'unstated' ||
      !!rules;
    if (!said) return undefined;
    return {
      housemateProfile: p.housemateProfile ?? 'unstated',
      householdSchedule: p.householdSchedule ?? 'unstated',
      householdCleanliness: p.householdCleanliness ?? 'unstated',
      householdSocial: p.householdSocial ?? 'unstated',
      // The lister's own count of who is already there, which for a sublet is
      // the same number they entered as housemates.
      currentHousemates: p.housematesCount ?? 0,
      houseRules: rules || undefined,
    };
  }

  onPhotosChange(photos: UploadedPhoto[]) {
    this.photos.set(photos);
  }

  /**
   * Step 3 → 4.
   *
   * When editing, this must UPDATE the room being edited. It used to call
   * createRoom unconditionally, so a landlord who paged forward through an
   * edit ended up with a second listing — the original still live, and a new
   * draft holding their changes.
   */
  createDraftAndContinue() {
    if (this.isEditing() && this.roomId()) {
      this.saveAndContinue();
      return;
    }
    this.createNewDraft();
  }

  /** Saves edits in place, then moves to photos. No new room is created. */
  private saveAndContinue() {
    const id = this.roomId();
    if (!id) return;

    this.creatingDraft.set(true);
    this.createError.set(null);

    const basics = this.basicsForm.getRawValue();
    const pricing = this.pricingForm.getRawValue();
    const prefs = this.preferencesForm.getRawValue();

    this.roomsService.updateRoom(id, {
      roomType: basics.roomType,
      title: basics.title,
      description: basics.description,
      rentCents: Math.round((pricing.rent ?? 0) * 100),
      depositCents: pricing.deposit ? Math.round(pricing.deposit * 100) : undefined,
      billsIncluded: !!pricing.billsIncluded,
      province: pricing.province,
      city: pricing.city,
      locationDisplay: pricing.locationDisplay,
      availableFrom: pricing.availableFrom,
      ...prefs,
      // The household fields live in the same form group but are stored on the
      // property, so they go as their own block — and the flat copies in
      // `...prefs` would be unknown fields on Room. Stripped explicitly rather
      // than left to the API's whitelist to reject, because a 400 here reads to
      // the lister as "your listing could not be saved".
      housemateProfile: undefined,
      householdSchedule: undefined,
      householdCleanliness: undefined,
      householdSocial: undefined,
      houseRules: undefined,
      household: this.householdPayload(),
      amenities: this.amenities(),
    } as any).subscribe({
      next: () => {
        this.creatingDraft.set(false);
        this.goToStep(4);
      },
      error: (err) => {
        this.creatingDraft.set(false);
        this.createError.set(err?.error?.message ?? 'Could not save your changes. Please try again.');
      },
    });
  }

  private createNewDraft() {
    if (this.preferencesForm.invalid) return;
    this.creatingDraft.set(true);
    this.createError.set(null);

    const basics = this.basicsForm.getRawValue();
    const pricing = this.pricingForm.getRawValue();
    const prefs = this.preferencesForm.getRawValue();
    const amenities = this.amenities();

    this.roomsService.createRoom({
      roomType: basics.roomType as any,
      title: basics.title!,
      description: basics.description!,
      // Rands entered by the landlord → ZAR cents for the API. The only place this conversion happens.
      rentCents: Math.round((pricing.rent ?? 0) * 100),
      depositCents: pricing.deposit ? Math.round(pricing.deposit * 100) : undefined,
      billsIncluded: pricing.billsIncluded ?? false,
      province: pricing.province!,
      city: pricing.city!,
      locationDisplay: pricing.locationDisplay!,
      availableFrom: pricing.availableFrom!,
      housematesCount: prefs.housematesCount ?? 0,
      couplesAllowed: prefs.couplesAllowed ?? false,
      dssAccepted: prefs.dssAccepted ?? false,
      guarantorAccepted: prefs.guarantorAccepted ?? false,
      petsAllowed: prefs.petsAllowed ?? false,
      amenities,
      // Phase 6. Sent, and then re-decided server-side from the account's role:
      // a TENANT account can only ever hold a sublet listing, whatever arrives
      // here. See the DTO comment for why it overrides rather than refuses.
      listerType: this.isSublet() ? 'sublessor' : 'owner_landlord',
      household: this.householdPayload(),
      // Phase 7b. Null when the landlord said "somewhere new", or when they
      // were never asked because they have no properties yet — and the API
      // validates it against their own, so a wrong id is refused rather than
      // quietly dropped.
      propertyId: this.chosenPropertyId() ?? undefined,
    } as any).subscribe({
      next: (room) => {
        this.roomId.set(room.id);
        this.creatingDraft.set(false);
        this.step.set(4);
      },
      error: (err) => {
        this.creatingDraft.set(false);
        this.createError.set(err?.error?.message ?? 'Could not save your listing. Please try again.');
      },
    });
  }

  publish() {
    const id = this.roomId();
    if (!id || this.photos().length === 0) return;

    this.publishing.set(true);
    this.publishError.set(null);

    const [hero, ...rest] = this.photos();
    this.roomsService.updateRoom(id, {
      heroImagePath: hero.path,
      imagePaths: rest.map((p) => p.path),
    } as any).subscribe({
      next: () => {
        this.roomsService.publishRoom(id).subscribe({
          next: () => this.router.navigate(['/landlord/dashboard']),
          error: (err) => {
            this.publishing.set(false);
            this.publishError.set(err?.error?.message ?? 'Could not publish. Please try again.');
          },
        });
      },
      error: (err) => {
        this.publishing.set(false);
        this.publishError.set(err?.error?.message ?? 'Could not save photos. Please try again.');
      },
    });
  }
}
