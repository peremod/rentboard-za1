import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminService, AdminUserDetail } from '../../../core/services/admin.service';
import { PortalShell } from '../../../shared/components/portal-shell/portal-shell';
import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';
import { ADMIN_NAV } from '../admin-nav';

/**
 * One account, everything about it.
 *
 * Built for the moment someone emails support: their listings, applications,
 * tenancies, payments, verifications and whether anyone has reported them, all
 * on one screen instead of six queries.
 *
 * Message content is deliberately absent — counts and counterparties resolve a
 * dispute, and reading private conversations is a power the platform does not
 * need and should not have.
 */
@Component({
  selector: 'app-admin-user-detail',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, PortalShell, ZarCentsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems" roleLabel="Admin" avatarColour="var(--ink2)">
      <a routerLink="/admin/dashboard" class="muted">← Back to accounts</a>

      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (error()) {
        <p class="field-error" role="alert">{{ error() }}</p>
      } @else if (detail(); as d) {

        <div class="dash-section-title" style="margin-top:1rem">
          {{ d.user.fullName }}
          @if (!d.user.isActive) { <span class="badge badge-reserved">Suspended</span> }
          @if (d.user.landlordProfile?.idVerified) { <span class="badge badge-verified">✓ Verified</span> }
        </div>

        @if (d.activity.reportsAgainst > 0) {
          <div class="insight-banner" style="background:rgba(178,59,59,.08);border-color:rgba(178,59,59,.25)">
            🚩
            <span>
              This account has been reported <strong>{{ d.activity.reportsAgainst }}</strong>
              time{{ d.activity.reportsAgainst === 1 ? '' : 's' }}.
              <a routerLink="/admin/reports">Open the report queue</a>
            </span>
          </div>
        }

        <section class="dash-section">
          <div class="dash-section-title">Account</div>
          <div class="detail__facts">
            <dl>
              <div><dt>Email</dt><dd>{{ d.user.email }}</dd></div>
              <div><dt>Phone</dt><dd>{{ d.user.phone || '—' }}</dd></div>
              <div><dt>Role</dt><dd>{{ d.user.role }}</dd></div>
              <div><dt>Signs in with</dt><dd>{{ d.user.authProvider || 'email' }}</dd></div>
              <div><dt>Joined</dt><dd>{{ d.user.createdAt | date:'d MMM yyyy' }}</dd></div>
              <div><dt>Last seen</dt><dd>{{ d.user.lastLoginAt ? (d.user.lastLoginAt | date:'d MMM yyyy') : 'Never' }}</dd></div>
              <div><dt>Marketing email</dt><dd>{{ d.user.marketingEmails === false ? 'Opted out' : 'Opted in' }}</dd></div>
              @if (d.user.landlordProfile?.rating) {
                <div><dt>Rating</dt><dd>★ {{ d.user.landlordProfile!.rating!.toFixed(1) }} ({{ d.user.landlordProfile!.ratingCount }})</dd></div>
              }
            </dl>
          </div>
        </section>

        <div class="stat-row">
          <div class="stat-box"><div class="val">{{ d.rooms.length }}</div><div class="lbl">Listings</div></div>
          <div class="stat-box"><div class="val">{{ d.applications.length }}</div><div class="lbl">Applications</div></div>
          <div class="stat-box"><div class="val">{{ d.activity.messagesSent }}</div><div class="lbl">Messages sent</div></div>
          <div class="stat-box">
            <div class="val" [class.stat-warn]="d.activity.reportsAgainst > 0">{{ d.activity.reportsAgainst }}</div>
            <div class="lbl">Reports against</div>
          </div>
        </div>

        @if (d.rooms.length > 0) {
          <section class="dash-section">
            <div class="dash-section-title">Listings</div>
            @for (r of d.rooms; track r.id) {
              <div class="app-card">
                <div class="app-thumb portal-thumb" aria-hidden="true">🏠</div>
                <div class="app-info">
                  <div class="app-room">{{ r.title }}</div>
                  <div class="app-location">{{ r.locationDisplay }} · {{ r.rentCents | zarCents:'monthly' }}</div>
                  <div class="app-location">
                    <span [class]="'status-dot status-dot--' + r.status">● {{ r.status }}</span>
                    · {{ r.viewCount }} views · {{ r.applicationCount }} applicants
                    @if (r.relistCount > 0) { · relisted {{ r.relistCount }}× }
                  </div>
                </div>
                <div class="portal-row-actions">
                  <a class="btn btn-sm btn-ghost-light" [routerLink]="['/rooms', r.id]">View</a>
                </div>
              </div>
            }
          </section>
        }

        @if (d.applications.length > 0) {
          <section class="dash-section">
            <div class="dash-section-title">Applications</div>
            @for (a of d.applications; track a.id) {
              <div class="app-card" [class.app-card--closed]="!!a.archivedAt">
                <div class="app-thumb portal-thumb" aria-hidden="true">📋</div>
                <div class="app-info">
                  <div class="app-room">{{ a.room?.title ?? 'Room removed' }}</div>
                  <div class="app-location">
                    {{ a.room?.locationDisplay }} · applied {{ a.createdAt | date:'d MMM yyyy' }}
                  </div>
                </div>
                <div class="portal-row-actions">
                  <span class="app-status" [class]="'app-status status-' + a.status">{{ a.status }}</span>
                </div>
              </div>
            }
          </section>
        }

        @if (d.tenancies.length > 0) {
          <section class="dash-section">
            <div class="dash-section-title">Tenancies</div>
            @for (t of d.tenancies; track t.id) {
              <div class="app-card">
                <div class="app-thumb portal-thumb" aria-hidden="true">🔑</div>
                <div class="app-info">
                  <div class="app-room">{{ t.room?.title ?? 'Room removed' }}</div>
                  <div class="app-location">
                    {{ t.status }} · {{ t.rentCents | zarCents:'monthly' }}
                    @if (t.startDate) { · from {{ t.startDate | date:'MMM yyyy' }} }
                    @if (t.endDate) { to {{ t.endDate | date:'MMM yyyy' }} }
                  </div>
                </div>
              </div>
            }
          </section>
        }

        @if (d.verifications.length > 0) {
          <section class="dash-section">
            <div class="dash-section-title">Verification history</div>
            @for (v of d.verifications; track v.id) {
              <div class="app-card">
                <div class="app-thumb portal-thumb" aria-hidden="true">🪪</div>
                <div class="app-info">
                  <div class="app-room">{{ v.type }}</div>
                  <div class="app-location">
                    Submitted {{ v.createdAt | date:'d MMM yyyy' }}
                    @if (v.reviewedAt) { · decided {{ v.reviewedAt | date:'d MMM yyyy' }} }
                  </div>
                  @if (v.reviewNote) { <div class="app-location">"{{ v.reviewNote }}"</div> }
                </div>
                <div class="portal-row-actions">
                  <span class="app-status" [class]="'app-status status-' + verificationClass(v.status)">
                    {{ v.status }}
                  </span>
                </div>
              </div>
            }
          </section>
        }

        @if (d.payments.length > 0) {
          <section class="dash-section">
            <div class="dash-section-title">Payments</div>
            @for (p of d.payments; track p.id) {
              <div class="app-card">
                <div class="app-thumb portal-thumb" aria-hidden="true">💳</div>
                <div class="app-info">
                  <div class="app-room">{{ p.amountCents | zarCents }} — {{ p.purpose }}</div>
                  <div class="app-location">
                    {{ p.status }}
                    @if (p.paidAt) { · paid {{ p.paidAt | date:'d MMM yyyy' }} }
                    @else { · started {{ p.createdAt | date:'d MMM yyyy' }} }
                  </div>
                </div>
              </div>
            }
          </section>
        }

        @if (d.reviewsReceived.length > 0) {
          <section class="dash-section">
            <div class="dash-section-title">Reviews received</div>
            @for (r of d.reviewsReceived; track r.id) {
              <div class="app-card" [class.app-card--closed]="r.isHidden">
                <div class="app-thumb portal-thumb" aria-hidden="true">⭐</div>
                <div class="app-info">
                  <div class="app-room">{{ stars(r.rating) }} <span class="muted">({{ r.type }})</span></div>
                  <p class="cover-note">"{{ r.comment }}"</p>
                  @if (r.isHidden) { <div class="field-error">Hidden by moderation.</div> }
                </div>
              </div>
            }
          </section>
        }
      }
    </app-portal-shell>
  `,
})
export class AdminUserDetailPage implements OnInit {
  private admin = inject(AdminService);

  readonly navItems = ADMIN_NAV;
  /** Routed input, bound from the :id path parameter. */
  readonly id = input.required<string>();

  detail = signal<AdminUserDetail | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  ngOnInit() {
    this.admin.getUserDetail(this.id()).subscribe({
      next: (d) => { this.detail.set(d); this.loading.set(false); },
      error: () => {
        this.error.set('Could not load that account.');
        this.loading.set(false);
      },
    });
  }

  stars(rating: number) {
    return '★'.repeat(rating) + '☆'.repeat(5 - rating);
  }

  verificationClass(s: string) {
    return { approved: 'accepted', rejected: 'rejected', pending: 'pending', pending_payment: 'viewed' }[s] ?? 'pending';
  }
}
