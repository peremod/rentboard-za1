import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, AdCampaign, AdEnquiry } from '../../../core/services/admin.service';
import { PortalShell, PortalNavItem } from '../../../shared/components/portal-shell/portal-shell';
import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';
import { ADMIN_NAV } from '../admin-nav';

/**
 * Advertising: the enquiry pipeline and campaign management in one place,
 * because they are the same job — an enquiry becomes a campaign.
 */
@Component({
  selector: 'app-admin-advertising',
  standalone: true,
  imports: [DatePipe, FormsModule, PortalShell, ZarCentsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems" roleLabel="Admin" avatarColour="var(--ink2)">

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
          Campaigns
          @if (pendingReviewCount() > 0) {
            <span class="dash-count">({{ pendingReviewCount() }} awaiting review)</span>
          }
        </div>

        @if (loadingCampaigns()) {
          <p class="muted">Loading…</p>
        } @else if (campaigns().length === 0) {
          <p class="muted">
            No campaigns. Create one via the API once an enquiry converts —
            <code>POST /api/ads/campaigns</code>.
          </p>
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

  readonly navItems: PortalNavItem[] = ADMIN_NAV;

  enquiries = signal<AdEnquiry[]>([]);
  campaigns = signal<AdCampaign[]>([]);
  loadingEnquiries = signal(true);
  loadingCampaigns = signal(true);
  busy = signal<string | null>(null);
  rejectingId = signal<string | null>(null);
  rejectReason = '';

  ngOnInit() {
    this.admin.listEnquiries().subscribe({
      next: (list) => { this.enquiries.set(list); this.loadingEnquiries.set(false); },
      error: () => this.loadingEnquiries.set(false),
    });
    this.admin.listCampaigns().subscribe({
      next: (list) => { this.campaigns.set(list); this.loadingCampaigns.set(false); },
      error: () => this.loadingCampaigns.set(false),
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
