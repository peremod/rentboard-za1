import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe, LowerCasePipe } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { AdminService, AdCampaign, AdEnquiry, ReachAnalysis } from '../../../core/services/admin.service';
import { PortalShell, PortalNavItem } from '../../../shared/components/portal-shell/portal-shell';
import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';
import { ADMIN_NAV } from '../admin-nav';
import { SA_PROVINCES } from '../../../core/models/room.model';
import { UploadsService } from '../../../core/services/uploads.service';
import { DialogService } from '../../../core/services/dialog.service';
import { getImageUrl } from '../../../shared/utils/imagekit.utils';

/**
 * Advertising: the enquiry pipeline and campaign management in one place,
 * because they are the same job — an enquiry becomes a campaign.
 */
@Component({
  selector: 'app-admin-advertising',
  standalone: true,
  imports: [DatePipe, DecimalPipe, LowerCasePipe, FormsModule, ReactiveFormsModule, PortalShell, ZarCentsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems" roleLabel="Admin" avatarColour="var(--ink2)">

      @if (reach(); as r) {
        <section class="dash-section">
          <div class="dash-section-title">Are the rates right?</div>

          @if (!r.hasBaseline) {
            <p class="muted">
              Nothing to compare against yet. This needs at least one nationwide
              campaign running alongside targeted ones — without a national
              baseline there is no way to tell whether a suburb campaign is
              reaching 3% of traffic or 30%.
            </p>
          } @else {
            <p class="muted">
              The rate card assumes each targeting level reaches a share of
              national traffic. This is what they actually deliver, measured as
              impressions per day so campaigns of different lengths compare
              fairly.
            </p>

            <table class="growth-table">
              <thead>
                <tr>
                  <th>Targeting</th>
                  <th>Campaigns</th>
                  <th>Impressions/day</th>
                  <th>Actual reach</th>
                  <th>Priced at</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                @for (l of r.levels; track l.level) {
                  <tr>
                    <td>{{ l.level }}</td>
                    <td>{{ l.campaigns }}</td>
                    <td>{{ l.impressionsPerDay }}</td>
                    <td>{{ l.actualSharePct }}%</td>
                    <td>{{ l.pricedSharePct }}%</td>
                    <td>
                      @if (!l.reliable) {
                        <span class="muted">Too little data</span>
                      } @else if (l.gapPct > 8) {
                        <span class="verdict verdict--under">
                          Underpriced by {{ l.gapPct }} points
                        </span>
                      } @else if (l.gapPct < -8) {
                        <span class="verdict verdict--over">
                          Overpriced by {{ -l.gapPct }} points
                        </span>
                      } @else {
                        <span class="verdict verdict--ok">About right</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>

            <p class="field-hint">
              'Too little data' means fewer than three campaigns or under a month
              at that level — below that any ratio is one advertiser's luck
              rather than a pattern. A gap under 8 points is noise.
            </p>
            <p class="field-hint">
              If a level is underpriced, raise it in
              <code>backend/src/modules/ads/ad-rates.ts</code> and the admin form,
              Advertise page and this table all follow.
            </p>
          }
        </section>
      }

      <section class="dash-section">
        <div class="dash-section-title">
          Enquiries
          @if (newEnquiryCount() > 0) { <span class="dash-count">({{ newEnquiryCount() }} new)</span> }
        </div>

        @if (loadingEnquiries()) {
          <p class="muted">Loading…</p>
        } @else if (enquiries().length === 0) {
          <p class="muted">No enquiries yet. They arrive from the Advertise page.</p>
        } @else {
          @for (e of enquiries(); track e.id) {
            <div class="app-card" [class.app-card--closed]="e.status === 'lost'">
              <div class="app-thumb portal-thumb" aria-hidden="true">📣</div>
              <div class="app-info">
                <div class="app-room">
                  {{ e.companyName }}
                  <span class="app-status" [class]="'app-status status-' + enquiryClass(e.status)">
                    {{ e.status }}
                  </span>
                </div>
                <div class="app-location">
                  {{ e.contactName }} · {{ e.contactEmail }}
                  @if (e.contactPhone) { · {{ e.contactPhone }} }
                </div>
                <div class="app-location">
                  @if (e.industry) { {{ e.industry }} · }
                  {{ e.province ?? 'Nationwide' }} ·
                  {{ e.createdAt | date:'d MMM yyyy' }}
                </div>
                <p class="cover-note">"{{ e.message }}"</p>
              </div>
              <div class="portal-row-actions">
                @for (next of nextStatuses(e.status); track next) {
                  <button type="button" class="btn btn-sm btn-ghost-light"
                          [disabled]="busy() === e.id" (click)="setEnquiry(e, next)">
                    {{ next }}
                  </button>
                }
              </div>
            </div>
          }
        }
      </section>

      <section class="dash-section">
        <div class="dash-section-title">
          New campaign
          <button type="button" class="btn btn-sm btn-outline" style="margin-left:auto"
                  (click)="showForm.set(!showForm())">
            {{ showForm() ? 'Close' : '+ Create' }}
          </button>
        </div>

        @if (showForm()) {
          <form [formGroup]="campaignForm" (ngSubmit)="createCampaign()" class="campaign-form">
            <div class="form-row">
              <label for="advertiserId">Advertiser</label>
              <select id="advertiserId" formControlName="advertiserId">
                <option value="">Select…</option>
                @for (a of advertisers(); track a.id) {
                  <option [value]="a.id">{{ a.companyName }}</option>
                }
              </select>
              @if (advertisers().length === 0) {
                <p class="field-hint">
                  No advertisers yet. Convert an enquiry above first — an advertiser
                  should exist because you spoke to them, not because a form needed one.
                </p>
              }
            </div>

            <div class="form-row">
              <label for="cname">Internal name</label>
              <input id="cname" type="text" formControlName="name"
                     placeholder="e.g. Vodacom fibre — Gauteng Q4"/>
            </div>

            <div class="form-row">
              <label for="placement">Placement</label>
              <select id="placement" formControlName="placement">
                <option value="board_sidebar">Sidebar — R2,500/mo</option>
                <option value="board_inline">In-grid — R4,000/mo</option>
                <option value="room_detail">Room detail — R3,000/mo</option>
              </select>
            </div>

            <div class="form-row">
              <label for="headline">Headline <span class="muted">(max 80)</span></label>
              <input id="headline" type="text" formControlName="headline" maxlength="80"/>
            </div>

            <div class="form-row">
              <label for="cbody">Body <span class="muted">(optional, max 200)</span></label>
              <textarea id="cbody" formControlName="body" rows="2" maxlength="200"></textarea>
            </div>

            <div class="form-row">
              <label>Creative image <span class="muted">(optional)</span></label>

              @if (imagePath()) {
                <div class="creative-preview">
                  <img [src]="previewUrl()" alt="Creative preview"/>
                  <button type="button" class="btn btn-sm btn-ghost-light" (click)="clearImage()">
                    Remove
                  </button>
                </div>
              } @else {
                <label class="btn btn-sm btn-outline" [class.is-busy]="uploading()">
                  {{ uploading() ? 'Uploading…' : 'Choose image' }}
                  <input type="file" accept="image/jpeg,image/png,image/webp" hidden
                         [disabled]="uploading()" (change)="onCreative($event)"/>
                </label>
              }

              <p class="field-hint">
                Shown at 600×400. Anything else is centre-cropped to that shape,
                so keep the message away from the edges. Under 2MB.
                Text-only ads work well in the sidebar.
              </p>
              @if (uploadError()) { <p class="field-error" role="alert">{{ uploadError() }}</p> }
            </div>

            <div class="form-row">
              <label for="targetUrl">Destination (https only)</label>
              <input id="targetUrl" type="url" formControlName="targetUrl"
                     placeholder="https://example.co.za/offer"/>
            </div>

            <div class="form-row">
              <label for="cprovince">Province <span class="muted">(blank = nationwide)</span></label>
              <select id="cprovince" formControlName="province">
                <option value="">Nationwide</option>
                @for (p of provinces; track p) { <option [value]="p">{{ p }}</option> }
              </select>
            </div>

            <div class="form-row">
              <label for="ccity">City <span class="muted">(optional)</span></label>
              <input id="ccity" type="text" formControlName="city" placeholder="e.g. Johannesburg"/>
            </div>

            <div class="form-row">
              <label for="csuburb">Suburb slug <span class="muted">(optional, narrowest)</span></label>
              <input id="csuburb" type="text" formControlName="suburbSlug"
                     placeholder="e.g. johannesburg-sandton"/>
              <p class="field-hint">
                From /api/places/suggest. A suburb campaign is served only in that
                suburb, never across the whole city.
              </p>
            </div>

            <div class="form-row">
              <label for="rate">Monthly rate (Rand)</label>
              <input id="rate" type="number" formControlName="monthlyRand" min="0"/>
              <p class="field-hint">
                Card rate for {{ targetLevelLabel() }} {{ placementLabel(campaignForm.value.placement!) | lowercase }}:
                <strong>R{{ (suggestedRand() | number) }}</strong>
                @if (suggestedRand() !== campaignForm.value.monthlyRand) {
                  · <button type="button" class="linkish" (click)="useSuggested()">use this</button>
                }
              </p>
              <p class="field-hint">
                Narrower targeting reaches fewer people, so it costs less overall —
                but more per impression, because those impressions are worth more.
              </p>
            </div>

            <div class="form-row">
              <label for="starts">Starts</label>
              <input id="starts" type="date" formControlName="startsAt"/>
            </div>

            <div class="form-row">
              <label for="ends">Ends</label>
              <input id="ends" type="date" formControlName="endsAt"/>
            </div>

            <div class="insight-banner">
              ⚠️
              <span>
                Creating a campaign does not publish it. It enters review, where the
                creative and destination are checked before anything is served.
              </span>
            </div>

            @if (formError()) { <p class="field-error" role="alert">{{ formError() }}</p> }

            <div class="campaign-form__actions">
              <button type="submit" class="btn btn-primary"
                      [disabled]="campaignForm.invalid || saving()">
                {{ saving() ? 'Creating…' : 'Create for review' }}
              </button>
              <button type="button" class="btn btn-outline"
                      [disabled]="saving()" (click)="cancelCampaign()">
                Cancel
              </button>
            </div>
          </form>
        }
      </section>

      <section class="dash-section">
        <div class="dash-section-title">
          Campaigns
          @if (pendingReviewCount() > 0) {
            <span class="dash-count">({{ pendingReviewCount() }} awaiting review)</span>
          }
        </div>

        @if (loadingCampaigns()) {
          <p class="muted">Loading…</p>
        } @else if (campaigns().length === 0) {
          <p class="muted">No campaigns yet. Create one above once an enquiry converts.</p>
        } @else {
          @for (c of campaigns(); track c.id) {
            <div class="app-card">
              <div class="app-thumb portal-thumb" aria-hidden="true">📢</div>
              <div class="app-info">
                <div class="app-room">
                  {{ c.name }}
                  <span class="app-status" [class]="'app-status status-' + campaignClass(c.status)">
                    {{ c.status }}
                  </span>
                </div>
                <div class="app-location">
                  {{ c.advertiser?.companyName }} · {{ placementLabel(c.placement) }} ·
                  {{ c.province ?? 'Nationwide' }}
                </div>
                <div class="app-location">"{{ c.headline }}"</div>
                <div class="app-rent">
                  {{ c.monthlyRateCents | zarCents }}/mo ·
                  {{ c.impressions }} impressions ·
                  {{ c.clicks }} clicks ({{ ctr(c) }}%)
                </div>
                <div class="app-location">
                  {{ c.startsAt | date:'d MMM' }} – {{ c.endsAt | date:'d MMM yyyy' }}
                </div>

                @if (rejectingId() === c.id) {
                  <div class="form-row" style="margin-top:.75rem">
                    <label [attr.for]="'rr-' + c.id">Reason (shown to the advertiser)</label>
                    <input [id]="'rr-' + c.id" type="text" [(ngModel)]="rejectReason"
                           placeholder="e.g. Destination page makes claims we can't verify"/>
                  </div>
                }
              </div>

              <div class="portal-row-actions">
                @if (c.status === 'pending_review') {
                  @if (rejectingId() === c.id) {
                    <button type="button" class="btn btn-sm btn-danger"
                            [disabled]="!rejectReason.trim() || busy() === c.id"
                            (click)="confirmReject(c)">Confirm</button>
                    <button type="button" class="btn btn-sm btn-ghost-light"
                            (click)="rejectingId.set(null)">Cancel</button>
                  } @else {
                    <button type="button" class="btn btn-sm btn-sage"
                            [disabled]="busy() === c.id" (click)="approve(c)">Approve</button>
                    <button type="button" class="btn btn-sm btn-ghost-light"
                            (click)="startReject(c)">Reject</button>
                  }
                } @else if (c.status === 'active') {
                  <button type="button" class="btn btn-sm btn-ghost-light"
                          [disabled]="busy() === c.id" (click)="setStatus(c, 'paused')">Pause</button>
                } @else if (c.status === 'paused') {
                  <button type="button" class="btn btn-sm btn-sage"
                          [disabled]="busy() === c.id" (click)="setStatus(c, 'active')">Resume</button>
                }
              </div>
            </div>
          }
        }
      </section>
    </app-portal-shell>
  `,
})
export class AdminAdvertising implements OnInit {
  private admin = inject(AdminService);
  private fb = inject(FormBuilder);
  private uploads = inject(UploadsService);
  private dialogs = inject(DialogService);

  readonly navItems: PortalNavItem[] = ADMIN_NAV;

  enquiries = signal<AdEnquiry[]>([]);
  campaigns = signal<AdCampaign[]>([]);
  loadingEnquiries = signal(true);
  loadingCampaigns = signal(true);
  busy = signal<string | null>(null);
  rejectingId = signal<string | null>(null);
  rejectReason = '';
  showForm = signal(false);
  saving = signal(false);
  formError = signal<string | null>(null);
  advertisers = signal<{ id: string; companyName: string }[]>([]);
  reach = signal<ReachAnalysis | null>(null);
  imagePath = signal<string | null>(null);
  uploading = signal(false);
  uploadError = signal<string | null>(null);
  readonly provinces = SA_PROVINCES;

  campaignForm = this.fb.group({
    advertiserId: ['', Validators.required],
    name: ['', [Validators.required, Validators.minLength(2)]],
    placement: ['board_sidebar', Validators.required],
    headline: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(80)]],
    body: ['', Validators.maxLength(200)],
    // https only, matching the API — an ad linking over plain http is a trust
    // problem on a platform warning people about scams.
    targetUrl: ['', [Validators.required, Validators.pattern(/^https:\/\/.+/)]],
    province: [''],
    city: [''],
    suburbSlug: [''],
    monthlyRand: [2500, [Validators.required, Validators.min(0)]],
    startsAt: ['', Validators.required],
    endsAt: ['', Validators.required],
  });

  ngOnInit() {
    this.admin.listAdvertisers().subscribe({
      next: (list) => this.advertisers.set(list),
      error: () => {},
    });

    this.admin.getReachAnalysis().subscribe({
      next: (r) => this.reach.set(r),
      error: () => {},   // the page must still work without it
    });

    this.admin.listEnquiries().subscribe({
      next: (list) => { this.enquiries.set(list); this.loadingEnquiries.set(false); },
      error: () => this.loadingEnquiries.set(false),
    });
    this.admin.listCampaigns().subscribe({
      next: (list) => { this.campaigns.set(list); this.loadingCampaigns.set(false); },
      error: () => this.loadingCampaigns.set(false),
    });
  }

  /**
   * Uploads the creative to a per-advertiser folder.
   *
   * Public, unlike verification documents — an ad image is meant to be seen.
   * The path is stored, not the URL, so the CDN transform is applied at render
   * time and one upload serves every placement size.
   */
  async onCreative(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    if (file.size > 2 * 1024 * 1024) {
      this.uploadError.set('That image is over 2MB. Please compress it first.');
      return;
    }

    this.uploading.set(true);
    this.uploadError.set(null);

    try {
      const advertiserId = this.campaignForm.value.advertiserId || 'unassigned';
      const compressed = await this.uploads.compressImage(file, 1200, 0.85);
      const uploaded = await this.uploads.uploadImage(compressed, `ads/${advertiserId}`);
      this.imagePath.set(uploaded.path);
      this.uploading.set(false);
    } catch (err) {
      this.uploading.set(false);
      this.uploadError.set(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    }
  }

  clearImage() {
    this.imagePath.set(null);
  }

  previewUrl() {
    return getImageUrl(this.imagePath(), 'ad');
  }

  /** Closes the form and clears it, including an uploaded creative. */
  async cancelCampaign() {
    const dirty = this.campaignForm.dirty || this.imagePath() !== null;
    if (dirty) {
      const discard = await this.dialogs.confirm(
        'Discard this campaign?',
        'The details you have entered will be lost.',
        'Discard',
        'Keep editing',
      );
      if (!discard) return;
    }
    this.resetForm();
    this.showForm.set(false);
  }

  private resetForm() {
    this.campaignForm.reset({ placement: 'board_sidebar', monthlyRand: 2500 });
    this.imagePath.set(null);
    this.uploadError.set(null);
    this.formError.set(null);
  }

  /**
   * The narrowest targeting set is what the buyer is paying for. Mirrors the
   * server-side calculation, which remains the authority.
   */
  targetLevelLabel(): string {
    const v = this.campaignForm.value;
    if (v.suburbSlug) return 'suburb';
    if (v.city) return 'city';
    if (v.province) return 'province';
    return 'national';
  }

  suggestedRand(): number {
    const base: Record<string, number> = {
      board_sidebar: 2500, board_inline: 4000, room_detail: 3000,
    };
    const multiplier: Record<string, number> = {
      national: 1, province: 0.5, city: 0.28, suburb: 0.15,
    };
    const raw = (base[this.campaignForm.value.placement ?? 'board_sidebar'] ?? 2500)
      * multiplier[this.targetLevelLabel()];
    // Nearest R50, floored at R450 — same rounding as the server.
    return Math.max(Math.round(raw / 50) * 50, 450);
  }

  useSuggested() {
    this.campaignForm.patchValue({ monthlyRand: this.suggestedRand() });
  }

  createCampaign() {
    if (this.campaignForm.invalid) return;
    this.saving.set(true);
    this.formError.set(null);

    const v = this.campaignForm.getRawValue();
    this.admin.createCampaign({
      advertiserId: v.advertiserId!,
      name: v.name!,
      placement: v.placement!,
      headline: v.headline!,
      body: v.body || undefined,
      imagePath: this.imagePath() || undefined,
      targetUrl: v.targetUrl!,
      province: v.province || undefined,
      city: v.city || undefined,
      suburbSlug: v.suburbSlug || undefined,
      // Stored in cents like every other amount in the system.
      monthlyRateCents: Math.round((v.monthlyRand ?? 0) * 100),
      startsAt: v.startsAt!,
      endsAt: v.endsAt!,
    }).subscribe({
      next: (created) => {
        this.campaigns.update((l) => [created, ...l]);
        this.saving.set(false);
        this.showForm.set(false);
        this.resetForm();
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(err?.error?.message ?? 'Could not create that campaign.');
      },
    });
  }

  newEnquiryCount = () => this.enquiries().filter((e) => e.status === 'new').length;
  pendingReviewCount = () => this.campaigns().filter((c) => c.status === 'pending_review').length;

  ctr(c: AdCampaign) {
    return c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) : '0.00';
  }

  placementLabel(p: string) {
    return { board_sidebar: 'Sidebar', board_inline: 'In-grid', room_detail: 'Room detail' }[p] ?? p;
  }

  enquiryClass(s: string) {
    return { new: 'pending', contacted: 'shortlisted', won: 'accepted', lost: 'rejected' }[s] ?? 'pending';
  }

  campaignClass(s: string) {
    return { active: 'accepted', pending_review: 'pending', rejected: 'rejected', paused: 'viewed', ended: 'withdrawn' }[s] ?? 'pending';
  }

  /** Only forward moves — an enquiry does not go back to new. */
  nextStatuses(current: string): string[] {
    return { new: ['contacted', 'lost'], contacted: ['won', 'lost'], won: [], lost: [] }[current] ?? [];
  }

  setEnquiry(e: AdEnquiry, status: string) {
    this.busy.set(e.id);
    this.admin.updateEnquiry(e.id, status).subscribe({
      next: (updated) => {
        this.enquiries.update((l) => l.map((x) => (x.id === e.id ? updated : x)));
        this.busy.set(null);
      },
      error: () => this.busy.set(null),
    });
  }

  approve(c: AdCampaign) { this.review(c, 'approved'); }
  startReject(c: AdCampaign) { this.rejectReason = ''; this.rejectingId.set(c.id); }
  confirmReject(c: AdCampaign) { this.review(c, 'rejected', this.rejectReason.trim()); }

  private review(c: AdCampaign, status: 'approved' | 'rejected', reason?: string) {
    this.busy.set(c.id);
    this.admin.reviewCampaign(c.id, status, reason).subscribe({
      next: (updated) => {
        this.campaigns.update((l) => l.map((x) => (x.id === c.id ? { ...x, ...updated } : x)));
        this.busy.set(null);
        this.rejectingId.set(null);
      },
      error: () => this.busy.set(null),
    });
  }

  setStatus(c: AdCampaign, status: 'active' | 'paused' | 'ended') {
    this.busy.set(c.id);
    this.admin.setCampaignStatus(c.id, status).subscribe({
      next: (updated) => {
        this.campaigns.update((l) => l.map((x) => (x.id === c.id ? { ...x, ...updated } : x)));
        this.busy.set(null);
      },
      error: () => this.busy.set(null),
    });
  }
}
