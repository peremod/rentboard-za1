import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { RoomsService } from '../../../core/services/rooms.service';
import { SA_PROVINCES, AMENITIES } from '../../../core/models/room.model';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { ToastService } from '../../../core/services/toast.service';
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
  imports: [ReactiveFormsModule, PhotoUpload],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wizard">
      <div class="wizard__steps">
        @for (s of [1,2,3,4]; track s) {
          <div class="wizard__step" [class.active]="step() === s" [class.done]="step() > s">{{ s }}</div>
        }
      </div>

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
          <button type="button" [disabled]="basicsForm.invalid" (click)="goToStep(2)">Next →</button>
        </form>
      }

      @if (step() === 2) {
        <form [formGroup]="pricingForm">
          <h2>Pricing &amp; location</h2>
          <div class="form-row"><label>Monthly rent (ZAR)</label><input type="number" formControlName="rent" min="100" placeholder="5500"/></div>
          <div class="form-row"><label>Deposit (ZAR, optional)</label><input type="number" formControlName="deposit" min="0"/></div>
          <label><input type="checkbox" formControlName="billsIncluded"/> Bills included</label>
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
            <button type="button" [disabled]="pricingForm.invalid" (click)="goToStep(3)">Next →</button>
          </div>
        </form>
      }

      @if (step() === 3) {
        <form [formGroup]="preferencesForm">
          <h2>Housemate preferences</h2>
          <div class="form-row"><label>Current housemates</label><input type="number" formControlName="housematesCount" min="0"/></div>
          <label><input type="checkbox" formControlName="couplesAllowed"/> Couples welcome</label>
          <label><input type="checkbox" formControlName="dssAccepted"/> DSS / SASSA accepted</label>
          <label><input type="checkbox" formControlName="guarantorAccepted"/> Guarantor accepted</label>
          <label><input type="checkbox" formControlName="petsAllowed"/> Pets allowed</label>
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
  `,
  styles: [`
    .wizard { max-width: 520px; margin: 2rem auto; padding: 0 1.25rem; font-family: sans-serif; }
    .wizard__steps { display: flex; gap: .5rem; margin-bottom: 2rem; }
    .wizard__step { flex: 1; height: 4px; background: #DDD5C8; border-radius: 4px; }
    .wizard__step.active, .wizard__step.done { background: #C04E28; }
    h2 { font-size: 1.2rem; margin-bottom: 1rem; }
    label { display: block; font-size: .85rem; font-weight: 600; margin-bottom: .9rem; }
    input, select, textarea { width: 100%; padding: .55rem .7rem; border: 1.5px solid #DDD5C8; border-radius: 6px; font-size: .85rem; margin-top: .3rem; font-family: inherit; }
    .muted { font-size: .78rem; color: #7A6E60; }
    .error { color: #D63B3B; font-size: .82rem; }
    .wizard__actions { display: flex; justify-content: space-between; margin-top: 1.5rem; }
    button { padding: .6rem 1.2rem; border-radius: 6px; border: none; background: #C04E28; color: #fff; font-weight: 700; cursor: pointer; }
    button:disabled { opacity: .5; cursor: not-allowed; }
  `],
})
export class CreateRoom implements OnInit {
  private fb = inject(FormBuilder);
  private roomsService = inject(RoomsService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private analytics = inject(AnalyticsService);
  private toast = inject(ToastService);

  provinces = SA_PROVINCES;
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

  cancel() {
    this.analytics.track('wizard.abandoned');
    const message = this.isPublished()
      ? 'Discard your unsaved changes to this listing?'
      : 'Leave this listing? Your draft is saved and you can finish it from your dashboard.';
    if (!confirm(message)) return;
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
            // Back to the dashboard rather than leaving them on a form with
            // nothing left to do. The toast confirms it after the navigation,
            // so the message is seen next to the updated listing.
            this.toast.success('Changes saved — your listing is still live.');
            this.router.navigate(['/landlord/dashboard']);
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

  ngOnInit() {
    this.analytics.track('wizard.started');

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
  });

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
