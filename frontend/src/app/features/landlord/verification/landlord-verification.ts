import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { VerificationService } from '../../../core/services/verification.service';
import { UploadsService } from '../../../core/services/uploads.service';
import { AuthService } from '../../../core/services/auth.service';
import { PaymentsService } from '../../../core/services/payments.service';
import { ActivatedRoute } from '@angular/router';
import { VerificationType } from '../../../core/models/verification.model';
import { PortalShell, PortalNavItem } from '../../../shared/components/portal-shell/portal-shell';

/**
 * Landlord-facing verification.
 *
 * Documents upload with isPrivateFile so they are never publicly addressable —
 * an ID is special personal information under POPIA s.26. The copy says
 * plainly that the document is deleted once reviewed, because asking someone
 * for their ID without explaining what happens to it is the thing that makes
 * people refuse.
 */
@Component({
  selector: 'app-landlord-verification',
  standalone: true,
  imports: [DatePipe, PortalShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems" roleLabel="Landlord">
      <div class="dash-section-title">Verification</div>

      @if (verification.isIdentityVerified()) {
        <div class="insight-banner" style="background:rgba(61,112,64,.08);border-color:rgba(61,112,64,.2)">
          ✅ <span>Your identity is verified. Your listings carry a verified badge.</span>
        </div>
      } @else {
        <div class="insight-banner">
          🪪
          <span>
            Verified landlords get noticeably more applications — tenants are
            wary of scams, and a badge is the clearest signal you are real.
          </span>
        </div>
      }

      @if (paymentOutcome() === 'success') {
        <div class="insight-banner" style="background:rgba(61,112,64,.08);border-color:rgba(61,112,64,.2)">
          ✅
          <span>
            Payment received. Your document is in the review queue — we usually
            decide within 2 business days and will email you either way.
          </span>
        </div>
      } @else if (paymentOutcome() === 'cancelled') {
        <div class="insight-banner">
          ↩️ <span>Payment cancelled. Your document is saved — you can pay whenever you're ready.</span>
        </div>
      }

      @if (payError()) {
        <p class="field-error" role="alert">{{ payError() }}</p>
      }

      <section class="dash-section">
        <div class="dash-section-title">What happens to your document</div>
        <ul class="verify-facts">
          <li>Uploaded privately — it is never shown on your listings or to tenants</li>
          <li>Seen only by a RentBoard reviewer</li>
          <li><strong>Deleted as soon as it is reviewed</strong>, approved or not. We keep the outcome, not the document</li>
          <li>Verification means a person checked your document. It is not a credit or criminal check</li>
          <li><strong>R149 once off</strong> for the identity check — not a subscription.
              Refunded in full if we cannot verify you. Proof of address and ownership are free</li>
        </ul>
      </section>

      <section class="dash-section">
        <div class="dash-section-title">Submit a document</div>

        @for (type of types; track type.value) {
          <div class="app-card">
            <div class="app-thumb portal-thumb" aria-hidden="true">{{ type.icon }}</div>
            <div class="app-info">
              <div class="app-room">{{ type.label }}</div>
              <div class="app-location">{{ type.hint }}</div>

              @if (statusFor(type.value); as req) {
                <div class="app-location">
                  <span class="app-status" [class]="'app-status status-' + req.status">
                    {{ statusLabel(req.status) }}
                  </span>
                  submitted {{ req.createdAt | date:'d MMM yyyy' }}
                </div>
                @if (req.status === 'rejected' && req.reviewNote) {
                  <div class="field-error">{{ req.reviewNote }} — you can submit a new document.</div>
                }
              }

              @if (error() === type.value) {
                <div class="field-error" role="alert">{{ errorMessage() }}</div>
              }
            </div>

            <div class="portal-row-actions">
              @if (awaitingPayment(type.value)) {
                <button type="button" class="btn btn-sm btn-primary"
                        [disabled]="paying()" (click)="pay(type.value)">
                  {{ paying() ? 'Opening PayFast…' : 'Pay R149 to continue' }}
                </button>
              } @else if (isPending(type.value)) {
                <span class="muted">Awaiting review</span>
              } @else if (isApproved(type.value)) {
                <span class="muted">✓ Approved</span>
              } @else {
                <label class="btn btn-sm btn-outline" [class.is-busy]="uploading() === type.value">
                  {{ uploading() === type.value ? 'Uploading…' : 'Choose file' }}
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
                         hidden [disabled]="uploading() !== null"
                         (change)="onFile($event, type.value)"/>
                </label>
              }
            </div>
          </div>
        }
      </section>
    </app-portal-shell>
  `,
  styles: [`
    .verify-facts { margin: 0 0 0 1.1rem; }
    .verify-facts li { font-size: .88rem; line-height: 1.8; color: var(--ink2); }
    .is-busy { opacity: .6; pointer-events: none; }
  `],
})
export class LandlordVerification implements OnInit {
  verification = inject(VerificationService);
  private uploads = inject(UploadsService);
  private auth = inject(AuthService);
  private payments = inject(PaymentsService);
  private route = inject(ActivatedRoute);

  readonly navItems: PortalNavItem[] = [
    { label: 'Dashboard', icon: '📊', route: '/landlord/dashboard', exact: true },
    { label: 'Verification', icon: '🪪', route: '/landlord/verification' },
  ];

  readonly types: { value: VerificationType; label: string; hint: string; icon: string }[] = [
    {
      value: 'identity',
      label: 'Identity document',
      hint: 'SA ID card, ID book or passport. This is the one that earns the verified badge.',
      icon: '🪪',
    },
    {
      value: 'proof_of_address',
      label: 'Proof of address',
      hint: 'A municipal bill or bank statement from the last three months.',
      icon: '📬',
    },
    {
      value: 'proof_of_ownership',
      label: 'Proof of ownership or mandate',
      hint: 'Title deed, or written permission from the owner if you let on their behalf.',
      icon: '📜',
    },
  ];

  uploading = signal<VerificationType | null>(null);
  paying = signal(false);
  payError = signal<string | null>(null);
  paymentOutcome = signal<'success' | 'cancelled' | null>(null);
  error = signal<VerificationType | null>(null);
  errorMessage = signal('');

  ngOnInit() {
    // PayFast returns the browser here; the ITN webhook is what actually
    // confirms payment, so this only sets the message the landlord sees.
    const outcome = this.route.snapshot.queryParamMap.get('payment');
    if (outcome === 'success' || outcome === 'cancelled') {
      this.paymentOutcome.set(outcome);
    }
    this.verification.load().subscribe({ error: () => {} });
  }

  /** True once a document is uploaded but the fee has not been paid. */
  awaitingPayment(type: VerificationType): boolean {
    return this.verification.requests().some(
      (r) => r.type === type && r.status === 'pending_payment',
    );
  }

  pay(type: VerificationType) {
    const request = this.verification.requests().find(
      (r) => r.type === type && r.status === 'pending_payment',
    );
    if (!request) return;

    this.paying.set(true);
    this.payError.set(null);
    this.payments.startVerificationPayment(request.id).subscribe({
      next: (session) => this.payments.redirectToPayfast(session),
      error: (err) => {
        this.paying.set(false);
        this.payError.set(err?.error?.message ?? 'Could not start the payment. Please try again.');
      },
    });
  }

  statusFor(type: VerificationType) {
    return this.verification.requests().find((r) => r.type === type) ?? null;
  }

  isPending(type: VerificationType) {
    return this.verification.requests().some((r) => r.type === type && r.status === 'pending');
  }

  isApproved(type: VerificationType) {
    return this.verification.requests().some((r) => r.type === type && r.status === 'approved');
  }

  statusLabel(status: string) {
    return { pending: '⏳ Awaiting review', approved: '✓ Approved', rejected: '✕ Not accepted' }[status] ?? status;
  }

  async onFile(event: Event, type: VerificationType) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';   // allow re-selecting the same file after a failure

    if (file.size > 10 * 1024 * 1024) {
      this.fail(type, 'That file is over 10MB. Please use a smaller photo or scan.');
      return;
    }

    this.uploading.set(type);
    this.error.set(null);

    try {
      // Private folder, scoped per user — never under the public rooms path.
      const userId = this.auth.user()?.id ?? 'unknown';
      const uploaded = await this.uploads.uploadPrivate(file, `private/verification/${userId}`);
      this.verification.submit(type, uploaded.path).subscribe({
        next: () => this.uploading.set(null),
        error: (err) => {
          this.uploading.set(null);
          this.fail(type, err?.error?.message ?? 'That could not be submitted. Please try again.');
        },
      });
    } catch (err) {
      this.uploading.set(null);
      this.fail(type, err instanceof Error ? err.message : 'Upload failed. Please try again.');
    }
  }

  private fail(type: VerificationType, message: string) {
    this.error.set(type);
    this.errorMessage.set(message);
  }
}
