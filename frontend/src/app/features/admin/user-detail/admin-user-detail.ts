import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminService, AdminUserDetail } from '../../../core/services/admin.service';
import { DeletionPreview } from '../../../core/services/account-lifecycle.service';

import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';

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
  imports: [DatePipe, FormsModule, RouterLink, ZarCentsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
      <a routerLink="/admin/dashboard" class="muted">← Back to accounts</a>

      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (error()) {
        <p class="field-error" role="alert">{{ error() }}</p>
      } @else if (detail(); as d) {

        <h2 class="dash-section-title" style="margin-top:1rem">
          {{ d.user.fullName }}
          @if (!d.user.isActive) { <span class="badge badge-reserved">Suspended</span> }
          @if (d.user.landlordProfile?.idVerified) { <span class="badge badge-verified">✓ Verified</span> }
        </h2>

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
          <h2 class="dash-section-title">Account</h2>
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
            <h2 class="dash-section-title">Listings</h2>
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
            <h2 class="dash-section-title">Applications</h2>
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
            <h2 class="dash-section-title">Tenancies</h2>
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
            <h2 class="dash-section-title">Verification history</h2>
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
            <h2 class="dash-section-title">Payments</h2>
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
            <h2 class="dash-section-title">Reviews received</h2>
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

        <!-- ── Ending the account, on the owner's request ─────────────────
             Phase 7i. Here rather than in the dashboard's user list, where
             suspension lives: suspension is reversible and quick, and belongs
             inline. This erases the email, the name and the number, so it
             belongs on a screen that can show what it will do BEFORE offering
             the button — the same reasoning that kept it off the settings
             screen for the owner's own closure. -->
        @if (d.user.role !== 'ADMIN' && !closed()) {
          <section class="dash-section ac-danger">
            <h2 class="dash-section-title">End this account on the owner's request</h2>
            <p class="ac-lead">
              For a request this person cannot carry out themselves — an account
              that signs in with a phone number has no password, so the
              close-account screen cannot confirm it. This is
              <strong>not suspension</strong>: it cannot be undone, and there is
              no way to restore the account afterwards.
            </p>
            <p class="ac-lead muted">
              Only do this on a request from the account holder. What you type
              below is kept permanently and is the only lasting evidence that it
              was asked for — the email, name and number are erased.
            </p>

            @if (loadingPreview()) {
              <p class="muted">Working out what this would do…</p>
            } @else if (previewFailed()) {
              <p class="ac-lead" role="alert">
                We could not check what is on this account, so the button is not
                being offered — you would be confirming a list that never
                arrived.
                <button type="button" class="link-btn" (click)="loadPreview()">Try again</button>
              </p>
            } @else if (preview(); as p) {
              <h3 class="ac-sub">What gets erased</h3>
              <ul class="ac-list">
                @for (row of p.erased; track row.label) {
                  <li>{{ row.label }}@if (row.count !== null) { — {{ row.count }} }</li>
                }
              </ul>

              @if (p.kept.length) {
                <h3 class="ac-sub">What stays, with their name taken off it</h3>
                <ul class="ac-list ac-list--kept">
                  @for (row of p.kept; track row.label) {
                    <li>
                      <strong>{{ row.label }} ({{ row.count }})</strong>
                      <span class="ac-why">{{ row.why }}</span>
                    </li>
                  }
                </ul>
              }

              <form class="ac-form" (ngSubmit)="closeAccount()">
                <label>
                  <span>How did the request reach you?</span>
                  <input type="text" name="reason" [(ngModel)]="reason"
                         placeholder="Emailed from the registered address on 3 Oct, ticket 412"/>
                  <span class="field-hint">
                    Kept permanently. Write about the request, never about the
                    person — this record outlives everything else about them.
                  </span>
                </label>

                <label>
                  <span>Type CLOSE to confirm</span>
                  <input type="text" name="confirm" autocomplete="off" spellcheck="false"
                         [(ngModel)]="confirm" placeholder="CLOSE"/>
                </label>

                <label class="ac-check">
                  <input type="checkbox" name="understood" [(ngModel)]="understood"/>
                  <span>
                    I have read what this erases and what it keeps, the account
                    holder asked for it, and I understand it cannot be undone.
                  </span>
                </label>

                @if (closeError()) { <p class="field-error" role="alert">{{ closeError() }}</p> }

                <button type="submit" class="btn btn-danger"
                        [disabled]="!canClose() || closing()">
                  {{ closing() ? 'Ending the account…' : 'End this account for good' }}
                </button>
              </form>
            }
          </section>
        }

        @if (closed()) {
          <section class="dash-section ac-done">
            <h2 class="dash-section-title">This account has been ended</h2>
            <p role="status">
              The person has been erased and the shared records kept, with their
              name taken off them. The request you recorded is stored against
              this account permanently.
              <a routerLink="/admin/dashboard">Back to accounts</a>
            </p>
          </section>
        }
      }
  `,
  styles: `
    .ac-lead { line-height: 1.7; max-width: 42rem; }
    .ac-sub { font-size: .9rem; margin: 1.1rem 0 .4rem; }
    .ac-list { margin: 0 0 .75rem; padding-left: 1.2rem; line-height: 1.7; max-width: 42rem; }
    .ac-list--kept li { margin-bottom: .6rem; }
    .ac-why { display: block; font-size: .85rem; color: var(--slate); line-height: 1.6; }
    .ac-danger {
      border: 1px solid rgba(214, 59, 59, .35);
      background: rgba(214, 59, 59, .04);
    }
    .ac-done { border-left: 3px solid var(--sage); }
    .ac-form { margin-top: 1rem; max-width: 28rem; display: flex; flex-direction: column; gap: .9rem; }
    .ac-form label { display: flex; flex-direction: column; gap: .25rem; font-size: .85rem; }
    .ac-form input[type="text"] {
      font: inherit; padding: .55rem .6rem; border: 1px solid var(--border);
      border-radius: 6px; min-height: 44px;
    }
    .ac-check { flex-direction: row !important; align-items: flex-start; gap: .55rem; line-height: 1.6; }
    .ac-check input { width: 20px; height: 20px; margin-top: .15rem; flex-shrink: 0; }
    .btn-danger {
      background: #D63B3B; color: #fff; border: none;
      &:disabled { opacity: .5; cursor: not-allowed; }
    }
    @media (max-width: 480px) {
      .ac-form, .ac-lead, .ac-list { max-width: none; }
      .btn-danger { width: 100%; }
    }
  `,
})
export class AdminUserDetailPage implements OnInit {
  private admin = inject(AdminService);

  /** Routed input, bound from the :id path parameter. */
  readonly id = input.required<string>();

  detail = signal<AdminUserDetail | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  // ── Ending the account on the owner's request — Phase 7i ───────────────
  protected reason = '';
  protected confirm = '';
  protected understood = false;

  protected readonly preview = signal<DeletionPreview | null>(null);
  protected readonly loadingPreview = signal(true);
  /**
   * ⚠️ Distinguished from "nothing to show". If the preview cannot be loaded
   * the button is NOT offered: an admin would otherwise be confirming they had
   * read a list that never arrived, on somebody else's account.
   */
  protected readonly previewFailed = signal(false);
  protected readonly closing = signal(false);
  protected readonly closeError = signal<string | null>(null);
  protected readonly closed = signal(false);

  protected canClose(): boolean {
    if (!this.preview() || this.previewFailed()) return false;
    return this.reason.trim().length >= 10
      && this.confirm.trim() === 'CLOSE'
      && this.understood;
  }

  ngOnInit() {
    this.admin.getUserDetail(this.id()).subscribe({
      next: (d) => {
        this.detail.set(d);
        this.loading.set(false);
        // Already ended: there is nothing to preview and nothing to offer.
        if (d.user.deletedAt) {
          this.closed.set(true);
          this.loadingPreview.set(false);
        } else if (d.user.role !== 'ADMIN') {
          this.loadPreview();
        } else {
          this.loadingPreview.set(false);
        }
      },
      error: () => {
        this.error.set('Could not load that account.');
        this.loading.set(false);
        this.loadingPreview.set(false);
      },
    });
  }

  protected loadPreview() {
    this.loadingPreview.set(true);
    this.previewFailed.set(false);
    this.admin.closurePreview(this.id()).subscribe({
      next: (p) => { this.preview.set(p); this.loadingPreview.set(false); },
      error: () => { this.loadingPreview.set(false); this.previewFailed.set(true); },
    });
  }

  protected closeAccount() {
    if (!this.canClose()) return;
    this.closing.set(true);
    this.closeError.set(null);
    this.admin.closeUserAccount(this.id(), this.reason.trim()).subscribe({
      next: () => {
        this.closing.set(false);
        this.closed.set(true);
      },
      error: (err) => {
        this.closing.set(false);
        this.closeError.set(
          err?.error?.message ?? 'That did not work just now. Try again in a moment.',
        );
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
