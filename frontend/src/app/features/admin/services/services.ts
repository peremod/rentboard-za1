import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ServiceDirectoryService } from '../../../core/services/service-directory.service';
import {
  SERVICE_LABELS, ServiceCategory, ServiceProvider, whatsappLink,
} from '../../../core/models/service-provider.model';

import { DialogService } from '../../../core/services/dialog.service';
import { ContractorLeadSummary } from '../../../core/services/service-directory.service';
import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';

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
  imports: [FormsModule, DatePipe, ZarCentsPipe],
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

        <!-- ── Leads, and what they come to — Phase 7k ──────────────────
             ⚠️ A RECORD, not an invoice. Nothing here has been billed and
             nothing has been paid, and this product cannot do either: a
             contractor is not a user. No userId, no email — a name, a number
             and the areas they cover. They cannot sign in, see a bill, accept
             terms or dispute a charge. Collecting would need contractor
             accounts first, which is a product and not a column.
             The disclaimer is read out of the PAYLOAD rather than written
             here, so a report or an export built on the same endpoint cannot
             drift from what the screen says. -->
        @if (leads(); as L) {
          <section class="dash-section lead-section">
            <h2 class="dash-section-title">Leads sent, and what they come to</h2>

            <p class="lead-disclaimer" role="note">{{ L.disclaimer }}</p>

            @if (L.noRatesConfigured) {
              <!-- ⚠️ No price exists anywhere in the product: not a constant,
                   not a default, not an env var. Until a rate is set, leads are
                   counted and deliberately not priced. -->
              <p class="lead-norates">
                <strong>No lead fee has been set.</strong> Leads are being counted
                and not priced — which is the honest state of a price nobody has
                decided. Set one below when you have decided what it is.
              </p>
            } @else {
              <ul class="lead-rates">
                @for (r of L.rates; track r.category + r.effectiveFrom) {
                  <li>
                    {{ label(r.category) }}: <strong>{{ r.amountCents | zarCents: 'exact' }}</strong>
                    a lead from {{ r.effectiveFrom | date: 'd MMM yyyy' }}
                    @if (r.note) { <span class="muted">— {{ r.note }}</span> }
                  </li>
                }
              </ul>
            }

            <table class="lead-table">
              <caption class="muted">
                Counted and priced are reported separately on purpose: "we sent
                you eleven and are charging for four" is the honest sentence,
                and one total hides which.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Who</th>
                  <th scope="col">Agreed to pay?</th>
                  <th scope="col">Priced</th>
                  <th scope="col">Counted only</th>
                  <th scope="col">Would come to</th>
                </tr>
              </thead>
              <tbody>
                @for (row of L.rows; track row.provider.id) {
                  <tr>
                    <td data-label="">
                      {{ row.provider.name }}
                      <span class="muted">{{ label(row.provider.category) }}</span>
                    </td>
                    <td data-label="Agreed to pay:">
                      @if (row.agreedToLeadFees) {
                        ✓ <span class="muted">{{ row.agreementNote }}</span>
                      } @else if (agreeingId() === row.provider.id) {
                        <!-- Inline, following the suspend-reason pattern on the
                             admin dashboard rather than a new dialog type. They
                             have no account to accept terms in, so what is typed
                             here is the only record that they agreed — and the
                             API refuses anything under ten characters for the
                             same reason the closure reason does. -->
                        <label class="lead-agree">
                          <span class="muted">How did they agree?</span>
                          <input type="text" [(ngModel)]="agreeNote" name="agreeNote"
                                 placeholder="agreed on the phone, 2 Oct — happy to pay per lead"/>
                        </label>
                        <button type="button" class="btn btn-sm btn-primary"
                                [disabled]="busy() === row.provider.id"
                                (click)="saveAgreement(row.provider.id)">Save</button>
                        <button type="button" class="link-btn"
                                (click)="agreeingId.set(null)">Cancel</button>
                      } @else {
                        <button type="button" class="link-btn" [disabled]="busy() === row.provider.id"
                                (click)="startAgreement(row.provider.id)">
                          Record that they agreed
                        </button>
                      }
                    </td>
                    <td data-label="Priced:">{{ row.leads.billable }}</td>
                    <td data-label="Counted only:">{{ row.leads.notBillable }}</td>
                    <td data-label="Would come to:">
                      @if (row.leads.billable) {
                        {{ row.wouldOweCents | zarCents: 'exact' }}
                      } @else {
                        <span class="muted">—</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>

            <form class="lead-rate-form" (ngSubmit)="saveRate()">
              <h3 class="ac-sub">Set what a lead costs</h3>
              <p class="muted">
                From a date, and never edited afterwards — a lead keeps the rate
                it was recorded under, so changing this cannot re-price what was
                already sent.
              </p>
              <label>
                <span>Trade</span>
                <select [(ngModel)]="rateForm.category" name="rateCategory">
                  @for (c of categories; track c) { <option [value]="c">{{ label(c) }}</option> }
                </select>
              </label>
              <label>
                <span>Rand per lead</span>
                <input type="number" min="1" step="0.01" [(ngModel)]="rateForm.rand" name="rateRand"
                       placeholder="what you have decided"/>
              </label>
              <label>
                <span>From</span>
                <input type="date" [(ngModel)]="rateForm.from" name="rateFrom"/>
              </label>
              <label>
                <span>Why this number (optional)</span>
                <input type="text" [(ngModel)]="rateForm.note" name="rateNote"/>
              </label>
              @if (rateError()) { <p class="field-error" role="alert">{{ rateError() }}</p> }
              @if (rateSaved()) { <p class="muted" role="status">✅ Saved. It applies from the date you gave.</p> }
              <button type="submit" class="btn btn-sm btn-primary" [disabled]="savingRate()">
                {{ savingRate() ? 'Saving…' : 'Set this rate' }}
              </button>
            </form>
          </section>
        }
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
    .lead-section { border-left: 3px solid var(--gold); }
    .lead-disclaimer {
      font-size: .82rem; line-height: 1.7; max-width: 44rem;
      padding: .6rem .8rem; margin: 0 0 .9rem;
      background: rgba(201, 162, 39, .08); border-radius: var(--r4);
    }
    .lead-norates { font-size: .85rem; line-height: 1.7; max-width: 44rem; }
    .lead-rates { font-size: .82rem; line-height: 1.8; margin: 0 0 .9rem; padding-left: 1.2rem; }
    .lead-table { width: 100%; border-collapse: collapse; font-size: .82rem; }
    .lead-table caption { text-align: left; font-size: .78rem; line-height: 1.6; max-width: 44rem; margin-bottom: .5rem; }
    .lead-table th, .lead-table td { text-align: left; padding: .5rem .4rem; border-bottom: 1px solid var(--border); vertical-align: top; }
    .lead-table th { font-size: .76rem; text-transform: uppercase; letter-spacing: .04em; color: var(--slate); }
    .lead-rate-form { display: grid; gap: .7rem; margin-top: 1.1rem; max-width: 26rem; }
    .lead-rate-form label { display: grid; gap: .25rem; font-size: .85rem; font-weight: 600; }
    .lead-rate-form input, .lead-rate-form select {
      font: inherit; font-weight: 400; padding: .55rem .6rem; min-height: 44px;
      border: 1.5px solid var(--border); border-radius: var(--r4);
    }
    @media (max-width: 768px) {
      /* A five-column table on a phone is a horizontal scroller nobody reads.
         The rows become blocks with their headings inline. */
      .lead-table thead { display: none; }
      .lead-table tr { display: grid; gap: .2rem; padding: .6rem 0; border-bottom: 1px solid var(--border); }
      .lead-table td { border: none; padding: 0; }
      .lead-table td::before { content: attr(data-label) ' '; font-weight: 600; color: var(--slate); }
    }
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
    this.loadLeads();
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
  // ── Leads — Phase 7k ───────────────────────────────────────────────────
  protected readonly leads = signal<ContractorLeadSummary | null>(null);
  protected rateForm = {
    category: 'plumber' as ServiceCategory,
    /**
     * ⚠️ Empty, and there is no placeholder number.
     *
     * The brief said not to implement arbitrary pricing assumptions. An example
     * amount in a form is the number somebody accepts, so the field starts
     * blank and the placeholder says "what you have decided".
     */
    rand: null as number | null,
    from: new Date().toISOString().slice(0, 10),
    note: '',
  };
  protected readonly savingRate = signal(false);
  protected readonly rateError = signal<string | null>(null);
  protected readonly rateSaved = signal(false);

  protected loadLeads() {
    this.directory.leadSummary().subscribe({
      next: (l) => this.leads.set(l),
      error: () => this.leads.set(null),
    });
  }

  protected saveRate() {
    const rand = Number(this.rateForm.rand);
    if (!Number.isFinite(rand) || rand <= 0) {
      this.rateError.set('Enter what a lead costs, in rand.');
      return;
    }
    this.savingRate.set(true);
    this.rateError.set(null);
    this.rateSaved.set(false);
    this.directory.setLeadRate({
      category: this.rateForm.category,
      // Rand in, cents over the wire — the one conversion boundary.
      amountCents: Math.round(rand * 100),
      effectiveFrom: new Date(this.rateForm.from).toISOString(),
      note: this.rateForm.note.trim() || undefined,
    }).subscribe({
      next: () => {
        this.savingRate.set(false);
        this.rateSaved.set(true);
        this.rateForm.rand = null;
        this.loadLeads();
      },
      error: (err) => {
        this.savingRate.set(false);
        this.rateError.set(err?.error?.message ?? 'Could not set that rate.');
      },
    });
  }

  protected readonly agreeingId = signal<string | null>(null);
  protected agreeNote = '';

  protected startAgreement(providerId: string) {
    this.agreeNote = '';
    this.error.set(null);
    this.agreeingId.set(providerId);
  }

  /**
   * Record that a contractor agreed to pay for leads.
   *
   * ⚠️ Typed in, not a one-tap toggle. They have no account to agree in, so
   * the note is the only evidence the conversation happened — and the API
   * refuses anything under ten characters for the same reason the closure
   * reason does. Charging somebody for leads they never agreed to receive is
   * not defensible, and nothing is counted as billable without this.
   */
  protected saveAgreement(providerId: string) {
    const note = this.agreeNote.trim();
    if (note.length < 10) {
      this.error.set('Record how they agreed — it is the only evidence, because they have no account to agree in.');
      return;
    }
    this.busy.set(providerId);
    this.error.set(null);
    this.directory.recordLeadFeesAgreed(providerId, note).subscribe({
      next: () => {
        this.busy.set(null);
        this.agreeingId.set(null);
        this.agreeNote = '';
        this.loadLeads();
      },
      error: (err) => {
        this.busy.set(null);
        this.error.set(err?.error?.message ?? 'Could not record that.');
      },
    });
  }

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
