import {
  ChangeDetectionStrategy, Component, OnInit, inject, input, signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LandlordNotesService } from '../../../core/services/landlord-notes.service';
import { LandlordNote } from '../../../core/models/landlord-note.model';
import { DialogService } from '../../../core/services/dialog.service';

/**
 * A landlord's private notes about one person — Phase 5e.
 *
 * ── The copy does the most important work here
 *
 * A note field beside an applicant's name, with no explanation, reads like a
 * review — something the platform collects and might act on. It is not. So the
 * panel says, every time and without being asked: only you can see this, the
 * tenant cannot, and it is not a rating.
 *
 * That is not throat-clearing. A landlord who believes these notes are shared
 * writes differently — either performing for an audience, or withholding the
 * thing they actually needed to remember. And a landlord who believes the tenant
 * will read it writes nothing useful at all.
 *
 * ── Collapsed by default
 *
 * On a list of applicants this sits behind a toggle. Six applicants should not
 * mean six open text areas, and the note is a thing you go to deliberately
 * rather than something the screen puts in front of you.
 */
@Component({
  selector: 'app-tenant-notes',
  standalone: true,
  imports: [DatePipe, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="notes-block">
      <button type="button" class="link-btn"
              [attr.aria-expanded]="open()"
              [attr.aria-label]="(open() ? 'Hide' : 'Show') + ' your private notes about ' + tenantName()"
              (click)="toggle()">
        {{ open() ? 'Hide my notes' : notesLabel() }}
      </button>

      @if (open()) {
        <div class="notes-body">
          <p class="muted notes-privacy">
            🔒 Only you can see these. {{ tenantName() }} cannot, and neither can
            anyone else — not other landlords, not Mastande's staff. They are not
            a rating and they do not affect anyone's listing or application.
          </p>

          @if (loading()) {
            <p class="muted">Loading…</p>
          } @else {
            @if (notes().length === 0) {
              <p class="muted">Nothing written yet.</p>
            } @else {
              <ul class="notes-list">
                @for (n of notes(); track n.id) {
                  <li class="note">
                    @if (editing() === n.id) {
                      <textarea [(ngModel)]="draft" name="edit" rows="3" maxlength="2000"></textarea>
                      <span class="notes-actions">
                        <button type="button" class="btn btn-sm btn-primary"
                                [disabled]="busy()" (click)="saveEdit(n)">Save</button>
                        <button type="button" class="btn btn-sm btn-outline"
                                [disabled]="busy()" (click)="cancelEdit()">Cancel</button>
                      </span>
                    } @else {
                      <p class="note-body">{{ n.body }}</p>
                      <span class="note-meta muted">
                        {{ n.createdAt | date: 'd MMM y' }}
                        @if (n.updatedAt !== n.createdAt) { · edited }
                      </span>
                      <span class="notes-actions">
                        <button type="button" class="link-btn"
                                [attr.aria-label]="'Edit the note from ' + (n.createdAt | date: 'd MMMM y')"
                                (click)="startEdit(n)">Edit</button>
                        <button type="button" class="link-btn"
                                [attr.aria-label]="'Delete the note from ' + (n.createdAt | date: 'd MMMM y')"
                                [disabled]="busy()" (click)="remove(n)">Delete</button>
                      </span>
                    }
                  </li>
                }
              </ul>
            }

            <label class="field">
              <span class="field-label">Add a note</span>
              <textarea [(ngModel)]="newBody" name="new" rows="3" maxlength="2000"
                        placeholder="Phoned twice about the gate. Polite, asked good questions."></textarea>
            </label>
            <button type="button" class="btn btn-sm btn-primary"
                    [disabled]="busy() || !newBody.trim()" (click)="add()">
              {{ busy() ? 'Saving…' : 'Save note' }}
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .notes-block { margin-top: 0.5rem; }
      .notes-body { border-left: 3px solid var(--line); margin-top: 0.4rem; padding-left: 0.7rem; }
      .notes-privacy { font-size: 0.8rem; line-height: 1.5; }
      .notes-list { list-style: none; margin: 0.6rem 0; padding: 0; }
      .note { border-bottom: 1px solid var(--line); padding: 0.5rem 0; }
      .note:last-child { border-bottom: 0; }
      .note-body { margin: 0; white-space: pre-wrap; }
      .note-meta { display: block; font-size: 0.75rem; margin-top: 0.15rem; }
      .notes-actions { display: inline-flex; gap: 0.6rem; margin-top: 0.3rem; }
      .notes-block textarea { width: 100%; }
    `,
  ],
})
export class TenantNotes implements OnInit {
  private service = inject(LandlordNotesService);
  private dialog = inject(DialogService);

  readonly tenantId = input.required<string>();
  /** Used in the copy and in every accessible name, so rows are distinguishable. */
  readonly tenantName = input<string>('this person');

  readonly notes = signal<LandlordNote[]>([]);
  readonly open = signal(false);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly editing = signal<string | null>(null);

  newBody = '';
  draft = '';

  /** Loaded eagerly but not rendered, so the toggle can show a count. */
  ngOnInit() { this.load(); }

  notesLabel() {
    const n = this.notes().length;
    if (n === 0) return 'Add a private note';
    return `My notes (${n})`;
  }

  toggle() { this.open.update((o) => !o); }

  private load() {
    this.loading.set(true);
    this.service.forTenant(this.tenantId()).subscribe({
      next: (n) => { this.notes.set(n); this.loading.set(false); },
      // Silent: the interceptor reports it, and reporting a fault twice is a
      // defect this codebase has already shipped once.
      error: () => this.loading.set(false),
    });
  }

  add() {
    const body = this.newBody.trim();
    if (!body) return;
    this.busy.set(true);
    this.service.write(this.tenantId(), body).subscribe({
      next: (n) => {
        this.notes.update((list) => [n, ...list]);
        this.newBody = '';
        this.busy.set(false);
      },
      error: () => this.busy.set(false),
    });
  }

  startEdit(n: LandlordNote) { this.editing.set(n.id); this.draft = n.body; }
  cancelEdit() { this.editing.set(null); this.draft = ''; }

  saveEdit(n: LandlordNote) {
    const body = this.draft.trim();
    if (!body) return;
    this.busy.set(true);
    this.service.update(n.id, body).subscribe({
      next: (updated) => {
        this.notes.update((list) => list.map((x) => (x.id === n.id ? updated : x)));
        this.cancelEdit();
        this.busy.set(false);
      },
      error: () => this.busy.set(false),
    });
  }

  async remove(n: LandlordNote) {
    // Names what goes, rather than asking "are you sure?".
    const yes = await this.dialog.confirm(
      'Delete this note?',
      'It is gone for good. Nobody else could see it, so nobody else will notice.',
      'Delete it',
    );
    if (!yes) return;
    this.busy.set(true);
    this.service.remove(n.id).subscribe({
      next: () => {
        this.notes.update((list) => list.filter((x) => x.id !== n.id));
        this.busy.set(false);
      },
      error: () => this.busy.set(false),
    });
  }
}
