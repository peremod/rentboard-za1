import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe, LowerCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, RecoveryLookup, AccountRecovery } from '../../../core/services/admin.service';

/**
 * Handing an account back when the phone is gone — Phase 7q.
 *
 * ⚠️ The most dangerous screen in the product. The account on the other side of
 * it holds rooms, applications, tenancies, a rent record and conversations with
 * tenants.
 *
 * The screen is written to slow the admin down at the one place it matters: the
 * approve button says what it does, the identity note is required before it can
 * be pressed, and the lookup refuses the whole flow out loud when the account
 * has an email or a password — because then a password reset does the same job
 * and nobody has to be trusted.
 */
@Component({
  selector: 'app-admin-recoveries',
  standalone: true,
  imports: [FormsModule, DatePipe, LowerCasePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="insight-banner">
      ⚠️
      <span>
        This is the only way to move an account whose owner has lost their phone,
        and it is the only thing here that can hand somebody's rooms, tenants and
        rent record to the wrong person. <strong>Two things have to be true:</strong>
        you have checked who they are in person and written down what you saw, and
        the code we send answers on their new handset. You cannot do the second
        part for them.
      </span>
    </div>

    <section class="dash-section">
      <h2 class="dash-section-title">Start with the number they used to sign in</h2>

      <div class="form-row">
        <label for="lookup-phone">The number on the account</label>
        <input id="lookup-phone" type="tel" inputmode="tel" [(ngModel)]="lookupPhone"
               placeholder="e.g. 082 123 4567"/>
      </div>
      <button type="button" class="btn btn-outline"
              [disabled]="looking() || lookupPhone.trim().length < 10"
              (click)="doLookup()">
        {{ looking() ? 'Looking…' : 'Look it up' }}
      </button>
      @if (lookupError()) { <p class="field-error" role="alert">{{ lookupError() }}</p> }

      @if (found(); as f) {
        @if (!f.found) {
          <p class="field-hint">No account signs in with that number.</p>
        } @else {
          <div class="app-card">
            <div class="app-info">
              <div class="app-room">{{ f.fullName }}</div>
              <div class="app-location">
                {{ f.role | lowercase }} · with us since {{ f.memberSince | date:'MMM yyyy' }}
              </div>
              <div class="app-location">
                Email: {{ f.hasEmail ? 'yes' : 'none' }} ·
                Password: {{ f.hasPassword ? 'yes' : 'none' }}
              </div>
            </div>
          </div>

          @if (f.saferRoute) {
            <!-- The narrowing, said out loud. If this account can be recovered
                 without trusting anybody, it should be. -->
            <p class="field-error" role="alert">
              <strong>Do not use this.</strong> {{ f.saferRoute }}
            </p>
          } @else if (f.closed) {
            <p class="field-error" role="alert">That account is closed or paused.</p>
          } @else if (f.liveRequest) {
            <p class="field-hint">
              There is already a request on this account
              ({{ f.liveRequest.status }}, opened {{ f.liveRequest.createdAt | date:'d MMM, HH:mm' }}).
              Finish or refuse it below.
            </p>
          } @else {
            <div class="form-row">
              <label for="new-phone">Their new number</label>
              <input id="new-phone" type="tel" inputmode="tel" [(ngModel)]="newPhone"
                     placeholder="e.g. 082 987 6543"/>
            </div>
            <div class="form-row">
              <label for="open-note">What they told you</label>
              <textarea id="open-note" rows="2" [(ngModel)]="openNote"
                        placeholder="e.g. Phone stolen at the taxi rank, came in person."></textarea>
              <span class="field-hint">
                About the request, not about the person. Opening it changes nothing
                and tells the account somebody has asked.
              </span>
            </div>
            <button type="button" class="btn btn-primary"
                    [disabled]="opening() || newPhone.trim().length < 10"
                    (click)="doOpen(f)">
              {{ opening() ? 'Opening…' : 'Open a request' }}
            </button>
            @if (openError()) { <p class="field-error" role="alert">{{ openError() }}</p> }
          }
        }
      }
    </section>

    <section class="dash-section">
      <h2 class="dash-section-title">
        Requests
        @if (rows().length) { <span class="dash-count">({{ rows().length }})</span> }
      </h2>

      @if (!rows().length && !loading()) {
        <p class="muted">Nothing here. Nobody has asked.</p>
      }

      @for (r of rows(); track r.id) {
        <div class="app-card">
          <div class="app-info">
            <div class="app-room">
              {{ r.user.fullName }} — {{ r.status }}
            </div>
            <div class="app-location">
              {{ r.oldPhone }} → {{ r.newPhone }} ·
              opened {{ r.createdAt | date:'d MMM, HH:mm' }}
              @if (r.openedByAdmin) { by {{ r.openedByAdmin.fullName }} }
            </div>

            @if (r.idSeenAt) {
              <div class="app-location">
                🪪 ID seen {{ r.idSeenAt | date:'d MMM' }} — {{ r.idSeenNote }}
              </div>
            }
            @if (r.knowledgeCheckedAt) {
              <div class="app-location">
                💬 Asked {{ r.knowledgeCheckedAt | date:'d MMM' }} — {{ r.knowledgeCheckedNote }}
              </div>
            }
            @if (r.approvedAt) {
              <div class="app-location">
                ✅ Approved {{ r.approvedAt | date:'d MMM, HH:mm' }}
                @if (r.approvedByAdmin) { by {{ r.approvedByAdmin.fullName }} }
                @if (!r.recoveredAt) { · waiting for them to enter the code }
                @if (r.attempts) { · {{ r.attempts }} wrong code(s) }
              </div>
            }
            @if (r.recoveredAt) {
              <div class="app-location">
                🔑 Handed over {{ r.recoveredAt | date:'d MMM, HH:mm' }}
              </div>
            }
            @if (r.refusedAt) {
              <div class="app-location">
                🚫 Refused {{ r.refusedAt | date:'d MMM' }} — {{ r.refusedReason }}
              </div>
            }

            @if (r.status === 'open') {
              <div class="form-row">
                <label [attr.for]="'id-' + r.id">What identity document did you see?</label>
                <textarea [attr.id]="'id-' + r.id" rows="2" [(ngModel)]="idNotes[r.id]"
                          placeholder="e.g. Green ID book, photo and name match the account."></textarea>
                <span class="field-hint">
                  Required before you can approve. We keep what you saw, never the
                  document itself.
                </span>
              </div>
              <div class="form-row">
                <label [attr.for]="'kn-' + r.id">Anything only the owner could answer?</label>
                <textarea [attr.id]="'kn-' + r.id" rows="2" [(ngModel)]="knowNotes[r.id]"
                          placeholder="e.g. Named both tenants and the rent on the back room."></textarea>
              </div>
              <div class="portal-row-actions">
                <button type="button" class="btn btn-sm btn-outline"
                        [disabled]="busy() === r.id"
                        (click)="doRecord(r)">Save what I checked</button>
                <button type="button" class="btn btn-sm btn-primary"
                        [disabled]="busy() === r.id || !r.idSeenAt"
                        (click)="doApprove(r)">
                  Approve — send them a code
                </button>
              </div>
              @if (!r.idSeenAt) {
                <p class="field-hint">
                  Approving is off until you have recorded what you checked.
                </p>
              }
            }

            @if (r.status === 'open' || r.status === 'approved') {
              <div class="form-row">
                <label [attr.for]="'ref-' + r.id">Refuse, and why</label>
                <input [attr.id]="'ref-' + r.id" type="text" [(ngModel)]="refuseReasons[r.id]"
                       placeholder="e.g. Name on the ID does not match."/>
              </div>
              <button type="button" class="btn btn-sm link-btn"
                      [disabled]="busy() === r.id || (refuseReasons[r.id] ?? '').trim().length < 5"
                      (click)="doRefuse(r)">Refuse this request</button>
            }

            @if (rowError() === r.id) {
              <p class="field-error" role="alert">{{ rowErrorMessage() }}</p>
            }
            @if (rowMessage() === r.id) {
              <p class="field-hint" role="status">{{ rowMessageText() }}</p>
            }
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    .dash-count { font-weight: 400; color: var(--slate); }
  `],
})
export class AdminRecoveries implements OnInit {
  private admin = inject(AdminService);

  lookupPhone = '';
  newPhone = '';
  openNote = '';
  idNotes: Record<string, string> = {};
  knowNotes: Record<string, string> = {};
  refuseReasons: Record<string, string> = {};

  looking = signal(false);
  opening = signal(false);
  loading = signal(true);
  busy = signal<string | null>(null);
  found = signal<RecoveryLookup | null>(null);
  rows = signal<AccountRecovery[]>([]);
  lookupError = signal<string | null>(null);
  openError = signal<string | null>(null);
  rowError = signal<string | null>(null);
  rowErrorMessage = signal('');
  rowMessage = signal<string | null>(null);
  rowMessageText = signal('');

  ngOnInit() { this.load(); }

  private load() {
    this.admin.recoveries().subscribe({
      next: (rows) => { this.rows.set(rows); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  doLookup() {
    this.looking.set(true);
    this.lookupError.set(null);
    this.found.set(null);
    this.admin.recoveryLookup(this.lookupPhone.trim()).subscribe({
      next: (res) => { this.looking.set(false); this.found.set(res); },
      error: (err) => {
        this.looking.set(false);
        this.lookupError.set(err?.error?.message ?? 'Could not look that number up.');
      },
    });
  }

  doOpen(f: RecoveryLookup) {
    this.opening.set(true);
    this.openError.set(null);
    this.admin.openRecovery(this.lookupPhone.trim(), this.newPhone.trim(), this.openNote.trim())
      .subscribe({
        next: () => {
          this.opening.set(false);
          this.newPhone = '';
          this.openNote = '';
          this.found.set(null);
          this.load();
        },
        error: (err) => {
          this.opening.set(false);
          this.openError.set(err?.error?.message ?? 'Could not open a request.');
        },
      });
  }

  doRecord(r: AccountRecovery) {
    this.busy.set(r.id);
    this.rowError.set(null);
    this.admin.recordRecoveryCheck(r.id, this.idNotes[r.id] ?? '', this.knowNotes[r.id] ?? '')
      .subscribe({
        next: () => { this.busy.set(null); this.load(); },
        error: (err) => {
          this.busy.set(null);
          this.rowError.set(r.id);
          this.rowErrorMessage.set(err?.error?.message ?? 'Could not save that.');
        },
      });
  }

  doApprove(r: AccountRecovery) {
    this.busy.set(r.id);
    this.rowError.set(null);
    this.admin.approveRecovery(r.id).subscribe({
      next: (res) => {
        this.busy.set(null);
        this.rowMessage.set(r.id);
        this.rowMessageText.set(res.message);
        this.load();
      },
      error: (err) => {
        this.busy.set(null);
        this.rowError.set(r.id);
        this.rowErrorMessage.set(err?.error?.message ?? 'Could not approve that.');
      },
    });
  }

  doRefuse(r: AccountRecovery) {
    this.busy.set(r.id);
    this.rowError.set(null);
    this.admin.refuseRecovery(r.id, (this.refuseReasons[r.id] ?? '').trim()).subscribe({
      next: () => { this.busy.set(null); this.load(); },
      error: (err) => {
        this.busy.set(null);
        this.rowError.set(r.id);
        this.rowErrorMessage.set(err?.error?.message ?? 'Could not refuse that.');
      },
    });
  }
}
