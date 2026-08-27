import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, PendingVerification } from '../../../core/services/admin.service';
import { PortalShell, PortalNavItem } from '../../../shared/components/portal-shell/portal-shell';

/**
 * Verification review queue.
 *
 * This is the piece that makes landlord verification function at all: the
 * backend has been complete since v1.7.0, but with nothing able to approve a
 * request, `idVerified` could never become true and the badge on room cards
 * meant nothing.
 *
 * Approving or rejecting deletes the document either way — an ID is special
 * personal information under POPIA s.26 and is kept only as long as the
 * decision needs it.
 */
@Component({
  selector: 'app-admin-verifications',
  standalone: true,
  imports: [DatePipe, FormsModule, PortalShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems" roleLabel="Admin" avatarColour="var(--ink2)">
      <div class="dash-section-title">Verification queue</div>

      <div class="insight-banner">
        🔒
        <span>
          Documents are deleted the moment you decide, approved or rejected —
          only the outcome is kept. Approving an identity check is what sets the
          verified badge on that landlord's listings.
        </span>
      </div>

      @if (loading()) {
        <p class="muted">Loading queue…</p>
      } @else if (error()) {
        <p class="field-error" role="alert">{{ error() }}</p>
      } @else if (requests().length === 0) {
        <div class="empty-state">
          <h3>Nothing waiting</h3>
          <p>New verification submissions will appear here.</p>
        </div>
      } @else {
        @for (req of requests(); track req.id) {
          <div class="app-card">
            <div class="app-thumb portal-thumb" aria-hidden="true">📄</div>

            <div class="app-info">
              <div class="app-room">{{ req.user.fullName }} — {{ typeLabel(req.type) }}</div>
              <div class="app-location">{{ req.user.email }}</div>
              <div class="app-location">
                Submitted {{ req.createdAt | date:'d MMM yyyy, HH:mm' }} ·
                account created {{ req.user.createdAt | date:'MMM yyyy' }}
              </div>

              @if (req.documentPath) {
                <div class="app-location">
                  <a [href]="req.documentPath" target="_blank" rel="noopener">Open document ↗</a>
                </div>
              } @else {
                <div class="field-error">Document missing — reject and ask for a resubmission.</div>
              }

              @if (rejectingId() === req.id) {
                <div class="form-row" style="margin-top:.75rem">
                  <label [attr.for]="'reason-' + req.id">Reason (shown to the landlord)</label>
                  <input [id]="'reason-' + req.id" type="text" [(ngModel)]="rejectReason"
                         placeholder="e.g. Photo is too blurry to read the ID number"/>
                </div>
              }

              @if (actionError() === req.id) {
                <div class="field-error" role="alert">That did not save. Try again.</div>
              }
            </div>

            <div class="portal-row-actions">
              @if (rejectingId() === req.id) {
                <button type="button" class="btn btn-sm btn-danger"
                        [disabled]="!rejectReason.trim() || busy() === req.id"
                        (click)="confirmReject(req)">
                  Confirm rejection
                </button>
                <button type="button" class="btn btn-sm btn-ghost-light" (click)="cancelReject()">Cancel</button>
              } @else {
                <button type="button" class="btn btn-sm btn-sage"
                        [disabled]="busy() === req.id || !req.documentPath"
                        (click)="approve(req)">
                  {{ busy() === req.id ? 'Saving…' : 'Approve' }}
                </button>
                <button type="button" class="btn btn-sm btn-ghost-light"
                        [disabled]="busy() === req.id" (click)="startReject(req)">
                  Reject
                </button>
              }
            </div>
          </div>
        }
      }
    </app-portal-shell>
  `,
})
export class AdminVerifications implements OnInit {
  private adminService = inject(AdminService);

  readonly navItems: PortalNavItem[] = [
    { label: 'Overview', icon: '📊', route: '/admin/dashboard', exact: true },
    { label: 'Verifications', icon: '📄', route: '/admin/verifications' },
    { label: 'Reports', icon: '🚩', route: '/admin/reports' },
  ];

  requests = signal<PendingVerification[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  busy = signal<string | null>(null);
  actionError = signal<string | null>(null);
  rejectingId = signal<string | null>(null);
  rejectReason = '';

  ngOnInit() {
    this.load();
  }

  typeLabel(type: string): string {
    const labels: Record<string, string> = {
      identity: 'Identity document',
      proof_of_address: 'Proof of address',
      proof_of_ownership: 'Proof of ownership / mandate',
    };
    return labels[type] ?? type;
  }

  approve(req: PendingVerification) {
    this.decide(req, 'approved');
  }

  startReject(req: PendingVerification) {
    this.rejectReason = '';
    this.actionError.set(null);
    this.rejectingId.set(req.id);
  }

  cancelReject() {
    this.rejectingId.set(null);
    this.rejectReason = '';
  }

  confirmReject(req: PendingVerification) {
    this.decide(req, 'rejected', this.rejectReason.trim());
  }

  private decide(req: PendingVerification, status: 'approved' | 'rejected', note?: string) {
    this.busy.set(req.id);
    this.actionError.set(null);
    this.adminService.reviewVerification(req.id, status, note).subscribe({
      next: () => {
        // Drop it locally rather than refetching — the queue is decided one at a time.
        this.requests.update((list) => list.filter((r) => r.id !== req.id));
        this.busy.set(null);
        this.rejectingId.set(null);
        this.rejectReason = '';
      },
      error: () => {
        this.actionError.set(req.id);
        this.busy.set(null);
      },
    });
  }

  private load() {
    this.loading.set(true);
    this.adminService.pendingVerifications().subscribe({
      next: (list) => {
        this.requests.set(list);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load the verification queue.');
        this.loading.set(false);
      },
    });
  }
}
