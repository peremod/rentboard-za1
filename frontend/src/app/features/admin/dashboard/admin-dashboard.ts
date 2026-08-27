import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe, LowerCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, AdminStats, AdminUser } from '../../../core/services/admin.service';
import { PortalShell, PortalNavItem } from '../../../shared/components/portal-shell/portal-shell';

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
  imports: [RouterLink, DatePipe, LowerCasePipe, FormsModule, PortalShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems" roleLabel="Admin" avatarColour="var(--ink2)">

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

        <div class="stat-row">
          <div class="stat-box"><div class="val">{{ s.rooms.let }}</div><div class="lbl">Let</div></div>
          <div class="stat-box"><div class="val">{{ s.rooms.draft }}</div><div class="lbl">Drafts</div></div>
          <div class="stat-box"><div class="val">{{ s.moderation.pendingVerifications }}</div><div class="lbl">Awaiting review</div></div>
          <div class="stat-box"><div class="val">{{ s.users.suspended }}</div><div class="lbl">Suspended</div></div>
        </div>
      } @else if (loading()) {
        <p class="muted">Loading…</p>
      }

      <section class="dash-section">
        <div class="dash-section-title">Accounts</div>

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
                  {{ u.fullName }}
                  @if (u.landlordProfile?.idVerified) { <span class="badge badge-new">Verified</span> }
                  @if (!u.isActive) { <span class="badge badge-reserved">Suspended</span> }
                </div>
                <div class="app-location">{{ u.email }} · {{ u.role | lowercase }}</div>
                <div class="app-location">
                  Joined {{ u.createdAt | date:'MMM yyyy' }}
                  @if (u._count) { · {{ u._count.rooms }} room{{ u._count.rooms === 1 ? '' : 's' }} }
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
    </app-portal-shell>
  `,
})
export class AdminDashboard implements OnInit {
  private adminService = inject(AdminService);

  readonly navItems: PortalNavItem[] = [
    { label: 'Overview', icon: '📊', route: '/admin/dashboard', exact: true },
    { label: 'Verifications', icon: '📄', route: '/admin/verifications' },
    { label: 'Reports', icon: '🚩', route: '/admin/reports' },
  ];

  stats = signal<AdminStats | null>(null);
  loading = signal(true);
  users = signal<AdminUser[]>([]);
  searching = signal(false);
  searched = signal(false);
  busy = signal<string | null>(null);
  suspendingId = signal<string | null>(null);
  query = '';
  suspendReason = '';

  ngOnInit() {
    this.adminService.getStats().subscribe({
      next: (s) => { this.stats.set(s); this.loading.set(false); },
      error: () => this.loading.set(false),
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
