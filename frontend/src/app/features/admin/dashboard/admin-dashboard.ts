import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe, LowerCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AdminService, AdminStats, AdminUser, AdminKpis, AssistedSignup,
} from '../../../core/services/admin.service';
import { PaymentsService, RefundDue } from '../../../core/services/payments.service';
import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';
import { PluralPipe } from '../../../shared/pipes/plural.pipe';

/**
 * Admin overview: platform counts, and account support.
 *
 * Deliberately does not expose message threads. Suspension is reversible and
 * destroys nothing — a suspended landlord's rooms are paused, but applications
 * and messages survive because a tenant may need that history in a dispute.
 */
@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [PluralPipe, RouterLink, DatePipe, LowerCasePipe, FormsModule, ZarCentsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `

      @if (stats(); as s) {
        @if (s.moderation.pendingVerifications > 0) {
          <div class="insight-banner">
            📄
            <span>
              <strong>{{ s.moderation.pendingVerifications }}</strong>
              verification {{ s.moderation.pendingVerifications === 1 ? 'document is' : 'documents are' }}
              waiting for review.
              <a routerLink="/admin/verifications">Open the queue</a>
            </span>
          </div>
        }

        <div class="stat-row">
          <div class="stat-box"><div class="val">{{ s.rooms.active }}</div><div class="lbl">Active rooms</div></div>
          <div class="stat-box"><div class="val">{{ s.users.landlords }}</div><div class="lbl">Landlords</div></div>
          <div class="stat-box"><div class="val">{{ s.users.tenants }}</div><div class="lbl">Tenants</div></div>
          <div class="stat-box"><div class="val">{{ s.applications.total }}</div><div class="lbl">Applications</div></div>
        </div>

        @if (kpis(); as k) {
          <section class="dash-section">
            <h2 class="dash-section-title">
              Marketplace health
              <span class="dash-count">(last {{ k.periodDays }} days)</span>
            </h2>

            <div class="insight-banner">
              💡
              <span>
                Totals tell you how much data exists. These tell you whether the
                board is working: listings nobody applies to, and applications
                landlords never open, are how a marketplace dies quietly.
              </span>
            </div>

            <div class="stat-row">
              <div class="stat-box">
                <div class="val" [class.stat-warn]="k.health.listingsWithApplicationsPct < 40">
                  {{ k.health.listingsWithApplicationsPct }}%
                </div>
                <div class="lbl">Listings with applicants</div>
              </div>
              <div class="stat-box">
                <div class="val" [class.stat-warn]="k.health.landlordResponsePct < 60">
                  {{ k.health.landlordResponsePct }}%
                </div>
                <div class="lbl">Applications opened by landlords</div>
              </div>
              <div class="stat-box">
                <div class="val">{{ k.health.applicationsPerActiveRoom }}</div>
                <div class="lbl">Applications per active room</div>
              </div>
              <div class="stat-box">
                <div class="val">{{ k.health.roomsLet }}</div>
                <div class="lbl">Rooms let</div>
              </div>
            </div>

            <div class="stat-row">
              <div class="stat-box">
                <div class="val">{{ k.growth.newUsers }}</div>
                <div class="lbl">New users {{ change(k.growth.newUsersChange) }}</div>
              </div>
              <div class="stat-box">
                <div class="val">{{ k.growth.newRooms }}</div>
                <div class="lbl">New listings {{ change(k.growth.newRoomsChange) }}</div>
              </div>
              <div class="stat-box">
                <div class="val">{{ k.growth.newApplications }}</div>
                <div class="lbl">New applications {{ change(k.growth.newApplicationsChange) }}</div>
              </div>
              <div class="stat-box">
                <div class="val">{{ k.trust.verifiedPct }}%</div>
                <div class="lbl">Landlords verified</div>
              </div>
            </div>

            @if (k.queues.openReports > 0 || k.queues.pendingVerifications > 0 || k.queues.newEnquiries > 0) {
              <div class="insight-banner">
                📥
                <span>
                  Waiting on you:
                  @if (k.queues.openReports > 0) {
                    <a routerLink="/admin/reports">{{ k.queues.openReports }} open report{{ k.queues.openReports === 1 ? '' : 's' }}</a>
                  }
                  @if (k.queues.pendingVerifications > 0) {
                    · <a routerLink="/admin/verifications">{{ k.queues.pendingVerifications }} verification{{ k.queues.pendingVerifications === 1 ? '' : 's' }}</a>
                  }
                  @if (k.queues.newEnquiries > 0) {
                    · <a routerLink="/admin/advertising">{{ k.queues.newEnquiries }} ad enquir{{ k.queues.newEnquiries === 1 ? 'y' : 'ies' }}</a>
                  }
                </span>
              </div>
            }
          </section>
        }

        <div class="stat-row">
          <div class="stat-box"><div class="val">{{ s.rooms.let }}</div><div class="lbl">Let</div></div>
          <div class="stat-box"><div class="val">{{ s.rooms.draft }}</div><div class="lbl">Drafts</div></div>
          <div class="stat-box"><div class="val">{{ s.moderation.pendingVerifications }}</div><div class="lbl">Awaiting review</div></div>
          <div class="stat-box"><div class="val">{{ s.users.suspended }}</div><div class="lbl">Suspended</div></div>
        </div>
      } @else if (loading()) {
        <p class="muted">Loading…</p>
      }

      @if (refunds().length) {
        <section class="dash-section">
          <h2 class="dash-section-title">
            Refunds owed
            <span class="dash-count">({{ refunds().length }})</span>
          </h2>

          <div class="insight-banner">
            💸
            <span>
              The pricing page promises a full refund when we cannot verify
              someone, so each of these is a commitment already made. PayFast
              has no refund API — move the money in their dashboard, then
              record it here.
            </span>
          </div>

          @for (r of refunds(); track r.id) {
            <div class="app-card">
              <div class="app-info">
                <div class="app-room">{{ r.user.fullName }} — {{ r.amountCents | zarCents }}</div>
                <div class="app-location">
                  {{ r.user.email }} · rejected {{ r.refundDueAt | date:'d MMM yyyy' }}
                </div>
                <div class="app-location">
                  PayFast ref <code>{{ r.providerReference || r.merchantReference }}</code>
                </div>
                @if (refundError() === r.id) {
                  <div class="field-error" role="alert">{{ refundErrorMessage() }}</div>
                }
              </div>
              <div class="portal-row-actions">
                <button type="button" class="btn btn-sm btn-outline"
                        [disabled]="refunding() === r.id" (click)="markRefunded(r)">
                  {{ refunding() === r.id ? 'Recording…' : 'Refunded in PayFast' }}
                </button>
              </div>
            </div>
          }
        </section>
      }

      <!-- ── Assisted sign-up — Phase 7p ──────────────────────────────
           On the overview rather than behind a new nav entry: it is a thing an
           admin does while sitting with somebody, not a screen they go looking
           for, and a new nav item is a new way to ship a dead link.

           The code goes to THEIR handset. The screen says so, because this is
           the control and a helper who does not know it will keep asking why
           no code arrived on their own phone. -->
      <section class="dash-section">
        <h2 class="dash-section-title">
          Help somebody sign up
          @if (assisted().length) {
            <span class="dash-count">({{ assisted().length }})</span>
          }
        </h2>

        <div class="insight-banner">
          📲
          <span>
            For a landlord sitting with you who has a phone and no email address.
            <strong>The code goes to their handset, not yours</strong> — ask them to
            read it out or type it in. They have to accept the Terms themselves on
            the last step; you cannot do that part for them.
          </span>
        </div>

        <div class="form-row">
          <label for="assist-phone">Their mobile number</label>
          <input id="assist-phone" type="tel" inputmode="tel" [(ngModel)]="assistPhone"
                 placeholder="e.g. 082 123 4567" autocomplete="off"/>
        </div>
        <button type="button" class="btn btn-outline"
                [disabled]="assisting() || assistPhone.trim().length < 10"
                (click)="startAssisted()">
          {{ assisting() ? 'Sending…' : 'Send them a code' }}
        </button>

        @if (assistMessage()) { <p class="field-hint">{{ assistMessage() }}</p> }
        @if (assistError()) { <p class="field-error" role="alert">{{ assistError() }}</p> }

        @if (assisted().length) {
          <!-- Stored is not readable. This codebase has shipped a notice
               channel nobody could read; a column recording who helped is an
               audit trail only if somebody can see it. -->
          @for (a of assisted(); track a.id) {
            <div class="app-card">
              <div class="app-info">
                <div class="app-room">
                  @if (a.becameAnAccount) {
                    ✅ Finished — they accepted
                    {{ a.theyAcceptedAt | date:'d MMM, HH:mm' }}
                  } @else if (a.stillOpen) {
                    ⏳ Waiting for {{ a.phone }}
                  } @else {
                    ⌛ Expired — {{ a.phone }} never finished
                  }
                </div>
                <div class="app-location">
                  Started {{ a.startedAt | date:'d MMM, HH:mm' }}
                  @if (a.numberProvenAt && !a.becameAnAccount) {
                    · number proven, Terms not accepted yet
                  }
                </div>
              </div>
            </div>
          }
        } @else if (!loadingAssisted()) {
          <p class="muted">You have not started any yet.</p>
        }
      </section>

      <section class="dash-section">
        <h2 class="dash-section-title">Accounts</h2>

        <div class="form-row">
          <label for="user-search">Search by name or email</label>
          <input id="user-search" type="search" [(ngModel)]="query"
                 (keyup.enter)="search()" placeholder="e.g. sarah@ or Mokoena"/>
        </div>
        <button type="button" class="btn btn-sm btn-outline" (click)="search()">Search</button>

        @if (searching()) {
          <p class="muted">Searching…</p>
        } @else if (users().length > 0) {
          @for (u of users(); track u.id) {
            <div class="app-card" [class.app-card--closed]="!u.isActive">
              <div class="app-thumb portal-thumb" aria-hidden="true">
                {{ u.role === 'LANDLORD' ? '🔑' : '🏠' }}
              </div>
              <div class="app-info">
                <div class="app-room">
                  <a [routerLink]="['/admin/users', u.id]">{{ u.fullName }}</a>
                  @if (u.landlordProfile?.idVerified) { <span class="badge badge-new">Verified</span> }
                  @if (!u.isActive) { <span class="badge badge-reserved">Suspended</span> }
                </div>
                <div class="app-location">{{ u.email }} · {{ u.role | lowercase }}</div>
                <div class="app-location">
                  Joined {{ u.createdAt | date:'MMM yyyy' }}
                  @if (u._count) { · {{ u._count.rooms | plural: 'room' }} }
                  @if (u.lastLoginAt) { · last seen {{ u.lastLoginAt | date:'d MMM' }} }
                </div>

                @if (suspendingId() === u.id) {
                  <div class="form-row" style="margin-top:.75rem">
                    <label [attr.for]="'sr-' + u.id">Reason for suspension (recorded)</label>
                    <input [id]="'sr-' + u.id" type="text" [(ngModel)]="suspendReason"
                           placeholder="e.g. Repeated fake listings"/>
                  </div>
                }
              </div>

              <div class="portal-row-actions">
                <a class="btn btn-sm btn-ghost-light" [routerLink]="['/admin/users', u.id]">Open</a>
                @if (u.role === 'ADMIN') {
                  <span class="muted">Admin</span>
                } @else if (!u.isActive) {
                  <button type="button" class="btn btn-sm btn-sage"
                          [disabled]="busy() === u.id" (click)="restore(u)">Restore</button>
                } @else if (suspendingId() === u.id) {
                  <button type="button" class="btn btn-sm btn-danger"
                          [disabled]="!suspendReason.trim() || busy() === u.id" (click)="confirmSuspend(u)">
                    Confirm
                  </button>
                  <button type="button" class="btn btn-sm btn-ghost-light" (click)="suspendingId.set(null)">
                    Cancel
                  </button>
                } @else {
                  <button type="button" class="btn btn-sm btn-ghost-light" (click)="startSuspend(u)">
                    Suspend
                  </button>
                }
              </div>
            </div>
          }
        } @else if (searched()) {
          <p class="muted">No accounts matched.</p>
        }
      </section>
  `,
})
export class AdminDashboard implements OnInit {
  private adminService = inject(AdminService);
  private payments = inject(PaymentsService);

  stats = signal<AdminStats | null>(null);
  kpis = signal<AdminKpis | null>(null);
  loading = signal(true);
  users = signal<AdminUser[]>([]);
  searching = signal(false);
  searched = signal(false);
  busy = signal<string | null>(null);
  suspendingId = signal<string | null>(null);
  query = '';
  suspendReason = '';
  refunds = signal<RefundDue[]>([]);
  refunding = signal<string | null>(null);
  refundError = signal<string | null>(null);
  refundErrorMessage = signal('');

  // Assisted sign-up — Phase 7p.
  assisted = signal<AssistedSignup[]>([]);
  loadingAssisted = signal(true);
  assisting = signal(false);
  assistMessage = signal<string | null>(null);
  assistError = signal<string | null>(null);
  assistPhone = '';

  /** Arrow with sign, or nothing when there is no prior period to compare. */
  change(pct: number): string {
    if (pct === 0) return '';
    return pct > 0 ? `↑ ${pct}%` : `↓ ${Math.abs(pct)}%`;
  }

  /**
   * Start a sign-up for somebody sitting with the admin.
   *
   * ⚠️ The list is reloaded on success, not patched optimistically. What the
   * server stores is the audit trail, and a screen that draws a row the server
   * did not write is a record of help that may not have happened.
   */
  startAssisted() {
    this.assisting.set(true);
    this.assistMessage.set(null);
    this.assistError.set(null);
    this.adminService.startAssistedSignup(this.assistPhone.trim()).subscribe({
      next: (res) => {
        this.assisting.set(false);
        this.assistMessage.set(`${res.message} ${res.theyMustAccept}`);
        this.assistPhone = '';
        this.loadAssisted();
      },
      error: (err) => {
        this.assisting.set(false);
        this.assistError.set(err?.error?.message ?? 'Could not send a code to that number.');
      },
    });
  }

  private loadAssisted() {
    this.adminService.assistedSignups().subscribe({
      next: (rows) => { this.assisted.set(rows); this.loadingAssisted.set(false); },
      error: () => this.loadingAssisted.set(false),
    });
  }

  ngOnInit() {
    this.loadAssisted();
    this.adminService.getKpis().subscribe({
      next: (k) => this.kpis.set(k),
      error: () => {},   // the overview must still render without them
    });

    this.adminService.getStats().subscribe({
      next: (s) => { this.stats.set(s); this.loading.set(false); },
      error: () => this.loading.set(false),
    });

    this.loadRefunds();
  }

  private loadRefunds() {
    this.payments.refundsDue().subscribe({
      next: (r) => this.refunds.set(r),
      // An empty section is the right failure here: the rest of the overview
      // is more useful than an error about a queue that is usually empty.
      error: () => this.refunds.set([]),
    });
  }

  /**
   * Records a refund already issued in PayFast.
   *
   * The reason is fixed rather than typed: every row in this list is here for
   * the same reason, and it is written onto the person's own audit trail, so
   * a free-text box would mostly produce inconsistent notes on a document
   * someone reads about themselves.
   */
  markRefunded(refund: RefundDue) {
    this.refunding.set(refund.id);
    this.refundError.set(null);
    this.payments
      .recordRefund(refund.id, 'We could not verify your identity, so the fee was refunded in full.')
      .subscribe({
        next: () => {
          this.refunding.set(null);
          this.refunds.update((list) => list.filter((r) => r.id !== refund.id));
        },
        error: (err) => {
          this.refunding.set(null);
          this.refundError.set(refund.id);
          this.refundErrorMessage.set(
            err?.error?.message ?? 'Could not record that refund. Please try again.',
          );
        },
      });
  }

  search() {
    this.searching.set(true);
    this.adminService.findUsers(this.query.trim() || undefined).subscribe({
      next: (list) => {
        this.users.set(list);
        this.searching.set(false);
        this.searched.set(true);
      },
      error: () => { this.searching.set(false); this.searched.set(true); },
    });
  }

  startSuspend(user: AdminUser) {
    this.suspendReason = '';
    this.suspendingId.set(user.id);
  }

  confirmSuspend(user: AdminUser) {
    this.setActive(user, false, this.suspendReason.trim());
  }

  restore(user: AdminUser) {
    this.setActive(user, true);
  }

  private setActive(user: AdminUser, isActive: boolean, reason?: string) {
    this.busy.set(user.id);
    this.adminService.setUserActive(user.id, isActive, reason).subscribe({
      next: () => {
        this.users.update((list) => list.map((u) => (u.id === user.id ? { ...u, isActive } : u)));
        this.busy.set(null);
        this.suspendingId.set(null);
      },
      error: () => this.busy.set(null),
    });
  }
}
