import {
  ChangeDetectionStrategy, Component, OnInit, inject, input, signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LeaseDocumentsService } from '../../../core/services/lease-documents.service';
import { UploadsService } from '../../../core/services/uploads.service';
import { DialogService } from '../../../core/services/dialog.service';
import {
  LEASE_DOC_KIND_LABELS, LeaseDocument, LeaseDocumentKind,
} from '../../../core/models/lease-document.model';

/** Bytes as a person reads them — the point is "will this cost me my data". */
function humanSize(bytes?: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The lease, kept where both parties can find it.
 *
 * ── What this screen is careful NOT to say
 *
 * It never says signed, agreed, executed, verified or binding about anything it
 * holds. A landlord and a tenant sign on paper; this keeps the photograph. The
 * copy says so out loud rather than leaving a reader to assume that a document
 * living inside a platform has been checked by it — because that assumption is
 * exactly what a half-built e-signature would trade on.
 *
 * ── Both parties, same component
 *
 * Rendered on the landlord's tenancy view and on the tenant's, from one
 * definition. A lease names two people and both of them need it; two copies of
 * this screen would be two copies to disagree. The API decides whether a
 * document is the reader's to change (`mine`) and this does not re-derive it
 * from ids — the same reasoning as the lease panel's `reason`.
 *
 * Removal is a real deletion and the confirmation says so, naming the
 * consequence rather than asking "are you sure?".
 */
@Component({
  selector: 'app-lease-documents',
  standalone: true,
  imports: [DatePipe, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="dash-section" id="lease-documents">
      @if (headingLevel() === 2) {
        <h2 class="dash-section-title">Lease and paperwork</h2>
      } @else {
        <h3 class="dash-section-title">Lease and paperwork</h3>
      }

      <p class="muted">
        Keep the signed lease here so you both have it. Mastande stores the file
        and nothing more — it does not sign anything, check anything or confirm
        what either of you agreed.
      </p>

      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else {

        @if (docs().length === 0) {
          <p class="muted">Nothing stored yet.</p>
        } @else {
          <ul class="doc-list">
            @for (d of docs(); track d.id) {
              <li class="doc-row">
                <div class="doc-main">
                  <button
                    type="button"
                    class="btn-link doc-open"
                    [disabled]="opening() === d.id"
                    (click)="open(d)">
                    {{ d.label }}
                  </button>
                  <span class="muted doc-meta">
                    {{ kindLabel(d.kind) }}
                    @if (d.sizeBytes) { · {{ size(d.sizeBytes) }} }
                    · added {{ d.createdAt | date: 'd MMM y' }}
                    @if (!d.mine) { · added by the other party }
                  </span>
                  @if (d.note) { <span class="muted doc-note">{{ d.note }}</span> }
                </div>
                @if (d.mine) {
                  <button
                    type="button"
                    class="btn-ghost btn-sm"
                    [disabled]="busy() === d.id"
                    [attr.aria-label]="'Remove ' + d.label"
                    (click)="remove(d)">
                    Remove
                  </button>
                }
              </li>
            }
          </ul>
        }

        <div class="doc-add">
          <label class="field">
            <span class="field-label">What is it?</span>
            <select [(ngModel)]="kind" name="kind">
              @for (k of kinds; track k) {
                <option [value]="k">{{ kindLabel(k) }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span class="field-label">Name it</span>
            <input
              type="text"
              [(ngModel)]="label"
              name="label"
              maxlength="120"
              placeholder="Signed lease, March 2026"/>
          </label>
          <label class="field">
            <span class="field-label">Choose a file</span>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/heic"
              [disabled]="uploading()"
              (change)="pick($event)"/>
          </label>
          @if (uploading()) { <p class="muted" role="status">Uploading…</p> }
          @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }
          <p class="muted doc-small">
            A photograph of each page is fine. Stored privately — nobody but the
            two of you can open it, and links expire after five minutes.
          </p>
        </div>
      }
    </section>
  `,
  styles: [
    `
      .doc-list { list-style: none; margin: 0.5rem 0 1rem; padding: 0; }
      .doc-row {
        align-items: flex-start;
        border-bottom: 1px solid var(--line);
        display: flex;
        gap: 0.75rem;
        justify-content: space-between;
        padding: 0.6rem 0;
      }
      .doc-main { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
      .doc-open { text-align: left; }
      .doc-meta, .doc-note { font-size: 0.85rem; }
      .doc-add { display: flex; flex-direction: column; gap: 0.6rem; }
      .doc-small { font-size: 0.8rem; }
    `,
  ],
})
export class LeaseDocuments implements OnInit {
  private service = inject(LeaseDocumentsService);
  private uploads = inject(UploadsService);
  private dialog = inject(DialogService);

  /** The tenancy whose paperwork this is. */
  readonly tenancyId = input.required<string>();
  /**
   * The host's to declare, because a component cannot know its own depth. The
   * same defect was shipped twice in this codebase — the survey card and the ad
   * slot both hardcoded a level and broke heading order on the page that used
   * them.
   */
  readonly headingLevel = input<2 | 3>(2);

  readonly docs = signal<LeaseDocument[]>([]);
  readonly loading = signal(true);
  readonly uploading = signal(false);
  readonly busy = signal<string | null>(null);
  readonly opening = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  readonly kinds: LeaseDocumentKind[] = [
    'lease', 'addendum', 'inspection', 'deposit_receipt', 'other',
  ];
  kind: LeaseDocumentKind = 'lease';
  label = '';

  kindLabel(k: LeaseDocumentKind) { return LEASE_DOC_KIND_LABELS[k]; }
  size(b?: number | null) { return humanSize(b); }

  ngOnInit() { this.load(); }

  private load() {
    this.service.list(this.tenancyId()).subscribe({
      next: (d) => { this.docs.set(d); this.loading.set(false); },
      // No inline message: the HTTP interceptor already surfaces the failure,
      // and saying it twice was a real defect on the services screen.
      error: () => this.loading.set(false),
    });
  }

  async pick(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.error.set(null);
    this.uploading.set(true);
    try {
      // Private, like a verification document: a lease must not be addressable
      // by anyone who guesses a path.
      const { path } = await this.uploads.uploadPrivate(file, 'leases');
      const label = this.label.trim() || file.name;
      this.service
        .add(this.tenancyId(), {
          path, label, kind: this.kind,
          sizeBytes: file.size, contentType: file.type || undefined,
        })
        .subscribe({
          next: (created) => {
            this.docs.update((list) => [created, ...list]);
            this.label = '';
            this.uploading.set(false);
            input.value = '';
          },
          error: () => this.uploading.set(false),
        });
    } catch (e) {
      // The upload never reached our API, so nothing else will report it.
      this.error.set(e instanceof Error ? e.message : 'The upload failed. Try again.');
      this.uploading.set(false);
    }
  }

  open(doc: LeaseDocument) {
    this.opening.set(doc.id);
    this.service.location(doc.id).subscribe({
      next: ({ url }) => {
        this.opening.set(null);
        window.open(url, '_blank', 'noopener');
      },
      error: () => this.opening.set(null),
    });
  }

  async remove(doc: LeaseDocument) {
    // Names the consequence rather than asking "are you sure?". The file really
    // goes — this is not an unlink.
    const yes = await this.dialog.confirm(
      `Remove ${doc.label}?`,
      'The file is deleted from storage, not hidden. If this is the only copy of your signed lease, neither of you will have it here any more.',
      'Remove it',
    );
    if (!yes) return;
    this.busy.set(doc.id);
    this.service.remove(doc.id).subscribe({
      next: () => {
        this.docs.update((list) => list.filter((d) => d.id !== doc.id));
        this.busy.set(null);
      },
      error: () => this.busy.set(null),
    });
  }
}
