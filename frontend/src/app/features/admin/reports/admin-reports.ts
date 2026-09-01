import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReportsService } from '../../../core/services/reports.service';
import { PortalShell, PortalNavItem } from '../../../shared/components/portal-shell/portal-shell';
import { ADMIN_NAV } from '../admin-nav';

/** Reasons that mean someone may be about to lose money. Surfaced first. */
const URGENT = ['upfront_payment_demanded', 'agent_posing_as_landlord', 'not_a_real_listing'];

@Component({
  selector: 'app-admin-reports',
  standalone: true,
  imports: [RouterLink, DatePipe, FormsModule, PortalShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems" roleLabel="Admin" avatarColour="var(--ink2)">
      <div class="dash-section-title">Reports</div>

      <div class="insight-banner">
        🚩
        <span>
          A single report is weak evidence. The prior-report counts below are
          the signal — a landlord with several reports across different rooms
          is the pattern worth acting on.
        </span>
      </div>

      @if (loading()) {
        <p class="muted">Loading reports…</p>
      } @else if (reports().length === 0) {
        <div class="empty-state">
          <h3>Nothing open</h3>
          <p>Reports from tenants and visitors will appear here.</p>
        </div>
      } @else {
        @for (r of reports(); track r.id) {
          <div class="app-card" [class.report--urgent]="isUrgent(r.reason)">
            <div class="app-thumb portal-thumb" aria-hidden="true">
              {{ isUrgent(r.reason) ? '🔴' : '🚩' }}
            </div>

            <div class="app-info">
              <div class="app-room">
                {{ label(r.reason) }}
                @if (isUrgent(r.reason)) { <span class="badge badge-reserved">Urgent</span> }
                <span class="app-status" [class]="'app-status status-' + statusClass(r.status)">
                  {{ r.status }}
                </span>
              </div>

              @if (r.room) {
                <div class="app-location">
                  Listing: <a [routerLink]="['/rooms', r.room.id]" target="_blank">{{ r.room.title }}</a>
                  · {{ r.room.locationDisplay }} · {{ r.room.status }}
                </div>
              }
              @if (r.reportedUser) {
                <div class="app-location">
                  Account: {{ r.reportedUser.fullName }} ({{ r.reportedUser.email }})
                  @if (!r.reportedUser.isActive) { · <strong>already suspended</strong> }
                </div>
              }

              <p class="report-details">{{ r.details }}</p>

              <div class="app-location">
                {{ r.reporter ? 'Reported by ' + r.reporter.email : 'Reported anonymously' }}
                @if (r.contactEmail) { ({{ r.contactEmail }}) }
                · {{ r.createdAt | date:'d MMM yyyy, HH:mm' }}
              </div>

              @if (context()[r.id]; as ctx) {
                <div class="app-location">
                  <strong>{{ ctx.priorReportsOnRoom }}</strong> prior on this listing ·
                  <strong>{{ ctx.priorReportsOnUser }}</strong> prior on this landlord
                </div>
              } @else {
                <button type="button" class="btn btn-sm btn-ghost-light" (click)="loadContext(r.id)">
                  Check for prior reports
                </button>
              }

              @if (notingId() === r.id) {
                <div class="form-row" style="margin-top:.75rem">
                  <label [attr.for]="'note-' + r.id">What did you do, and why?</label>
                  <input [id]="'note-' + r.id" type="text" [(ngModel)]="note"
                         placeholder="e.g. Listing removed, landlord suspended pending ID check"/>
                </div>
                <div class="portal-row-actions" style="margin-top:.5rem">
                  <button type="button" class="btn btn-sm btn-danger" (click)="resolve(r, 'actioned')">Actioned</button>
                  <button type="button" class="btn btn-sm btn-ghost-light" (click)="resolve(r, 'dismissed')">Dismiss</button>
                  <button type="button" class="btn btn-sm btn-ghost-light" (click)="notingId.set(null)">Cancel</button>
                </div>
              }
            </div>

            @if (notingId() !== r.id) {
              <div class="portal-row-actions">
                @if (r.status === 'open') {
                  <button type="button" class="btn btn-sm btn-outline"
                          [disabled]="busy() === r.id" (click)="resolve(r, 'investigating')">
                    Investigating
                  </button>
                }
                <button type="button" class="btn btn-sm btn-ghost-light" (click)="startNote(r)">Resolve</button>
              </div>
            }
          </div>
        }
      }
    </app-portal-shell>
  `,
  styles: [`
    .report--urgent { border-color: rgba(178,59,59,.4); box-shadow: 0 0 0 1px rgba(178,59,59,.15); }
    .report-details {
      font-size: .88rem; line-height: 1.7; color: var(--ink2);
      background: var(--cream2); border-radius: var(--r8);
      padding: .75rem; margin: .6rem 0; white-space: pre-line;
    }
  `],
})
export class AdminReports implements OnInit {
  private reportsService = inject(ReportsService);

  readonly navItems: PortalNavItem[] = ADMIN_NAV;

  reports = signal<any[]>([]);
  context = signal<Record<string, { priorReportsOnRoom: number; priorReportsOnUser: number }>>({});
  loading = signal(true);
  busy = signal<string | null>(null);
  notingId = signal<string | null>(null);
  note = '';

  ngOnInit() {
    this.load();
  }

  isUrgent(reason: string) {
    return URGENT.includes(reason);
  }

  label(reason: string) {
    return reason.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }

  statusClass(status: string) {
    return { open: 'pending', investigating: 'viewed', actioned: 'accepted', dismissed: 'rejected' }[status] ?? 'pending';
  }

  loadContext(id: string) {
    this.reportsService.context(id).subscribe({
      next: (ctx) => this.context.update((c) => ({ ...c, [id]: ctx })),
      error: () => {},
    });
  }

  startNote(report: any) {
    this.note = '';
    this.notingId.set(report.id);
  }

  resolve(report: any, status: 'investigating' | 'actioned' | 'dismissed') {
    this.busy.set(report.id);
    this.reportsService.resolve(report.id, status, this.note.trim() || undefined).subscribe({
      next: () => {
        this.busy.set(null);
        this.notingId.set(null);
        // Resolved reports leave the default queue.
        if (status === 'actioned' || status === 'dismissed') {
          this.reports.update((list) => list.filter((r) => r.id !== report.id));
        } else {
          this.reports.update((list) => list.map((r) => (r.id === report.id ? { ...r, status } : r)));
        }
      },
      error: () => this.busy.set(null),
    });
  }

  private load() {
    this.loading.set(true);
    this.reportsService.listForAdmin().subscribe({
      next: (list) => {
        // Urgent first, then oldest.
        this.reports.set(
          [...list].sort((a, b) => Number(this.isUrgent(b.reason)) - Number(this.isUrgent(a.reason))),
        );
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
