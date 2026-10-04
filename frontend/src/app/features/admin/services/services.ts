import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ServiceDirectoryService } from '../../../core/services/service-directory.service';
import {
  SERVICE_LABELS, ServiceCategory, ServiceProvider, whatsappLink,
} from '../../../core/models/service-provider.model';

import { DialogService } from '../../../core/services/dialog.service';

/**
 * Curating the contractor directory.
 *
 * This screen is the only way a provider gets into the list — there is no
 * landlord-facing submission, deliberately. See the schema note: recommending a
 * stranger to someone's tenants is a risk the platform would carry with no way
 * to manage it.
 *
 * New entries are added switched OFF, so a half-typed provider is never live.
 * Switching one on is a separate, visible act.
 */
@Component({
  selector: 'app-admin-services',
  standalone: true,
  imports: [FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `

      <div class="insight-banner">
        💡
        <span>
          This list is curated — landlords cannot add to it. Anyone here is being passed
          on as checked, so add a name only if that is true. New entries stay off until
          you switch them on.
        </span>
      </div>

      <section class="dash-section">
        <h2 class="dash-section-title">Add someone</h2>
        <form class="provider-form" (ngSubmit)="create()">
          <label>
            <span>Trade</span>
            <select [(ngModel)]="form.category" name="category">
              @for (c of categories; track c) {
                <option [value]="c">{{ label(c) }}</option>
              }
            </select>
          </label>
          <label>
            <span>Name</span>
            <input type="text" [(ngModel)]="form.name" name="name" placeholder="Sipho — Tembisa Plumbing"/>
          </label>
          <label>
            <span>Mobile number</span>
            <!-- Any SA format; the API normalises to +27… so the same person
                 cannot be listed twice under two spellings. -->
            <input type="tel" [(ngModel)]="form.phone" name="phone" placeholder="082 123 4567"/>
          </label>
          <label>
            <span>Areas they cover, separated by commas</span>
            <input type="text" [(ngModel)]="form.areas" name="areas" placeholder="Tembisa, Kempton Park"/>
          </label>
          <label>
            <span>Note (optional)</span>
            <input type="text" [(ngModel)]="form.note" name="note" placeholder="Geysers and blocked drains. Cash or EFT."/>
          </label>
          <label class="provider-form__check">
            <input type="checkbox" [(ngModel)]="form.whatsapp" name="whatsapp"/>
            <span>This number is on WhatsApp</span>
          </label>
          @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }
          <button type="submit" class="btn btn-primary btn-sm" [disabled]="saving()">
            {{ saving() ? 'Saving…' : 'Add, switched off' }}
          </button>
        </form>
      </section>

      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (providers().length === 0) {
        <div class="empty-state">
          <h2>Nobody in the directory</h2>
          <p>Add the first name above. Landlords see nothing until something is switched on.</p>
        </div>
      } @else {
        <section class="dash-section">
          <h2 class="dash-section-title">Everyone ({{ liveCount() }} live)</h2>
          @for (p of providers(); track p.id) {
            <div class="provider" [class.provider--off]="!p.active">
              <div class="provider__head">
                <strong>{{ p.name }}</strong>
                <span class="pill">{{ label(p.category) }}</span>
                @if (!p.active) { <span class="pill pill--off">Not live</span> }
              </div>
              <p class="muted">{{ p.phone }} · {{ p.areas.join(', ') || 'no areas set' }}</p>
              @if (p.note) { <p class="provider__note">{{ p.note }}</p> }

              <!-- ⚠️ What has actually been checked — Phase 7j.
                   The landlord screen used to say "people we have checked out"
                   with nothing in the product recording a check. This is where
                   the checks get recorded, and the row shows which are missing
                   so a half-checked name is visible rather than inferred. -->
              <ul class="svc-checks">
                @for (c of checkRows(p); track c.key) {
                  <li [class.svc-checks--missing]="!c.on">
                    {{ c.on ? '✓' : '—' }} {{ c.label }}
                    @if (c.on) {
                      <span class="muted">{{ c.on | date: 'd MMM yyyy' }}</span>
                    } @else {
                      <button type="button" class="link-btn" [disabled]="busy() === p.id"
                              (click)="recordCheck(p, c.key)">Record it</button>
                    }
                  </li>
                }
              </ul>
              @if (p.tradeRegistration) {
                <p class="muted svc-reg">Registration: {{ p.tradeRegistration }}</p>
              }

              <div class="provider__actions">
                <!-- ⚠️ Disabled, with the reason, rather than offered and
                     refused. The API and a CHECK constraint both reject
                     publishing somebody nobody has rung; a button that looks
                     live and fails is the worse version of the same rule. -->
                <button type="button" class="btn btn-sm"
                        [class.btn-sage]="!p.active" [class.btn-outline]="p.active"
                        [disabled]="busy() === p.id || (!p.active && !p.phoneConfirmedAt)"
                        [attr.title]="!p.active && !p.phoneConfirmedAt
                          ? 'Ring the number and record that first — the directory tells landlords these names were checked'
                          : null"
                        (click)="toggle(p)">
                  {{ p.active ? 'Switch off' : 'Switch on' }}
                </button>
                @if (!p.active && !p.phoneConfirmedAt) {
                  <span class="svc-blocked">
                    Ring the number and record it before listing this person.
                  </span>
                }
                @if (p.whatsapp) {
                  <a class="link-btn" [href]="waLink(p)" target="_blank" rel="noopener">Test the WhatsApp link</a>
                }
                <button type="button" class="link-btn" [disabled]="busy() === p.id"
                        (click)="remove(p)">Remove</button>
              </div>
            </div>
          }
        </section>
      }
  `,
  styles: [
    `
      .provider-form { display: grid; gap: 0.6rem; max-width: 30rem; }
      .provider-form label span { display: block; margin-bottom: 0.2rem; }
      .provider-form input[type='text'],
      .provider-form input[type='tel'],
      .provider-form select { width: 100%; }
      .provider-form__check { display: flex; align-items: center; gap: 0.5rem; }
      .provider-form__check span { margin: 0; }
      .provider { border-top: 1px solid var(--line); padding: 0.75rem 0; }
      .provider--off { opacity: 0.72; }
      .provider__head { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; }
      .provider__note { margin: 0.25rem 0 0.5rem; }
    .svc-checks {
      list-style: none; margin: .4rem 0 .5rem; padding: 0;
      font-size: .78rem; line-height: 1.9; color: var(--ink2);
    }
    .svc-checks li { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; }
    .svc-checks--missing { color: var(--slate); }
    .svc-reg { font-size: .78rem; margin: 0 0 .5rem; }
    .svc-blocked { font-size: .78rem; color: var(--slate); line-height: 1.6; max-width: 26rem; }
      .provider__actions { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; }
      .pill--off { background: rgba(26, 20, 16, 0.08); }
    `,
  ],
})
export class AdminServices implements OnInit {
  private directory = inject(ServiceDirectoryService);
  private dialogs = inject(DialogService);

  protected readonly categories: ServiceCategory[] = [
    'plumber', 'electrician', 'locksmith', 'cleaner', 'other',
  ];

  protected readonly providers = signal<ServiceProvider[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected form = {
    category: 'plumber' as ServiceCategory,
    name: '',
    phone: '',
    areas: '',
    note: '',
    whatsapp: true,
  };

  ngOnInit() {
    this.load();
  }

  protected liveCount() {
    return this.providers().filter((p) => p.active).length;
  }

  private load() {
    this.loading.set(true);
    this.directory.listAll().subscribe({
      next: (list) => {
        this.providers.set(list);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Could not load the directory. Try again.');
      },
    });
  }

  protected create() {
    if (this.saving()) return;
    if (!this.form.name.trim() || !this.form.phone.trim()) {
      this.error.set('A name and a mobile number are both needed.');
      return;
    }
    const areas = this.form.areas.split(',').map((a) => a.trim()).filter(Boolean);
    if (!areas.length) {
      // Not optional: a provider with no areas can never be found by the filter
      // a landlord actually uses, so it would be in the list and unreachable.
      this.error.set('Add at least one area they cover.');
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    this.directory
      .create({
        category: this.form.category,
        name: this.form.name.trim(),
        phone: this.form.phone.trim(),
        areas,
        whatsapp: this.form.whatsapp,
        ...(this.form.note.trim() ? { note: this.form.note.trim() } : {}),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.form = {
            category: 'plumber', name: '', phone: '', areas: '', note: '', whatsapp: true,
          };
          this.load();
        },
        error: (err) => {
          this.saving.set(false);
          // The global error interceptor already shows a dialog for a 400 or 422
          // carrying a string message — "that does not look like a South African
          // mobile number", which is exactly what an admin needs. Setting an
          // inline copy as well printed the same sentence twice, once in a modal
          // and once under the form. Found by driving it: the modal then
          // intercepted the next click, which is how the duplication surfaced.
          const apiMessage = err?.error?.message;
          if (typeof apiMessage === 'string') return;
          this.error.set('That did not save. Try again.');
        },
      });
  }

  /**
   * The three checks, present or missing, in the order they are usually done.
   *
   * Rendered for every provider including the ones with nothing recorded, so a
   * half-checked name shows as half-checked. A list that only showed what was
   * present would make "we rang them" and "we rang them, saw ID and called a
   * reference" look the same at a glance.
   */
  protected checkRows(p: ServiceProvider) {
    return [
      { key: 'phoneConfirmedAt' as const, label: 'Rang the number and reached them', on: p.phoneConfirmedAt },
      { key: 'idCheckedAt' as const, label: 'Saw an identity document', on: p.idCheckedAt },
      { key: 'referenceCheckedAt' as const, label: 'Spoke to a landlord they worked for', on: p.referenceCheckedAt },
    ];
  }

  /**
   * Record a check as of now.
   *
   * ⚠️ Today's date, because this records a check being made now. The API
   * accepts any ISO date so a call made on Tuesday and recorded on Thursday can
   * be entered as Tuesday — back-dating is the honest option and the field
   * allows it — but a one-tap button must not quietly claim a date it does not
   * know. Admin screens get the tap; correcting a date is a database job until
   * somebody needs it on screen.
   */
  protected recordCheck(p: ServiceProvider, key: 'phoneConfirmedAt' | 'idCheckedAt' | 'referenceCheckedAt') {
    this.busy.set(p.id);
    this.error.set(null);
    this.directory.update(p.id, { [key]: new Date().toISOString() }).subscribe({
      next: () => { this.busy.set(null); this.load(); },
      error: () => {
        this.busy.set(null);
        this.error.set('Could not record that. Try again.');
      },
    });
  }

  protected toggle(p: ServiceProvider) {
    this.busy.set(p.id);
    this.directory.update(p.id, { active: !p.active }).subscribe({
      next: () => {
        this.busy.set(null);
        this.load();
      },
      error: () => {
        this.busy.set(null);
        this.error.set('Could not change that. Try again.');
      },
    });
  }

  protected async remove(p: ServiceProvider) {
    const confirmed = await this.dialogs.confirm(
      `Remove ${p.name}?`,
      'They come off the directory entirely. Switching them off instead keeps the record and hides them from landlords.',
      'Remove them',
      'Keep them',
    );
    if (!confirmed) return;

    this.busy.set(p.id);
    this.directory.remove(p.id).subscribe({
      next: () => {
        this.busy.set(null);
        this.load();
      },
      error: () => {
        this.busy.set(null);
        this.error.set('Could not remove that. Try again.');
      },
    });
  }

  protected label(c: ServiceCategory) {
    return SERVICE_LABELS[c] ?? c;
  }

  protected waLink(p: ServiceProvider) {
    return whatsappLink(p.phone);
  }
}
