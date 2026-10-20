import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';
import { Loading } from '../../../shared/components/loading/loading';
import { Icon } from '../../../shared/components/icon/icon';

interface AggregateQuestion {
  id: string;
  prompt: string;
  kind: 'choice' | 'text';
  options: string[];
  /** counts[segment][option] */
  counts: Record<string, Record<string, number>>;
  texts: { segment: string; text: string }[];
  answered: number;
}

interface SurveyAggregate {
  slug: string;
  version: number;
  title: string;
  active: boolean;
  /** Whose survey this is. Named so two populations cannot be read as one. */
  audienceRole: 'LANDLORD' | 'TENANT' | null;
  role: 'LANDLORD' | 'TENANT' | null;
  responses: number;
  started: number;
  finished: number;
  dismissed: number;
  /** Null when nobody has started: 0% and "nobody asked yet" differ. */
  completionRate: number | null;
  /**
   * Partial on purpose. A survey nobody answered over WhatsApp has no
   * `whatsapp` key at all, so indexing it yields undefined — and typing it as
   * a total Record made the compiler flag the `?? 0` guards as dead code while
   * the runtime still needed them.
   */
  bySource: Partial<Record<string, number>>;
  segmentQuestionId: string | null;
  segments: string[];
  questions: AggregateQuestion[];
}

/**
 * Survey results — counts per option, open text listed, segmented by how many
 * rooms the landlord has.
 *
 * A plain table on purpose. The brief asks for v1 to be readable, and a chart
 * of eleven responses is a chart that implies more confidence than eleven
 * responses can carry.
 *
 * ── Two things this screen says out loud rather than hiding
 *
 * The response count is shown beside every question, because "getting rent on
 * time, 60%" means something very different at 5 responses and at 200. A
 * percentage with no denominator is the most common way a survey misleads the
 * person who commissioned it.
 *
 * Anonymous responses are counted separately and named. They cannot be
 * segmented by room count, so the segment columns may not sum to the total —
 * a reader who spots that without explanation stops trusting the whole table,
 * which is worse than the gap itself.
 *
 * Nothing here shows who said what. The landlord link exists so the same
 * person is not asked twice and so answers can be segmented, not so an
 * individual's opinions can be read back against them.
 */
@Component({
  selector: 'app-admin-surveys',
  standalone: true,
  imports: [Icon, Loading],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `

      @if (loading()) {
        <app-loading>Loading results…</app-loading>
      } @else if (error()) {
        <p class="field-error" role="alert">{{ error() }}</p>
      } @else if (data(); as d) {

        <!-- ⚠️ A picker, because there are two surveys now.
             This screen hardcoded one slug behind a comment saying "a second
             survey would need a picker; the brief is explicit that v1 does not
             build one". The second survey exists, so the condition that
             comment set has come true — and without this the tenant answers
             would have been collected and shown to nobody. -->
        <div class="survey-controls">
          <label>
            <span>Survey</span>
            <select [value]="slug()" (change)="pick($any($event.target).value)">
              <option value="landlord-pain-2026">Landlords — what is hardest</option>
              <option value="tenant-search-2026">Tenants — what they are looking for</option>
            </select>
          </label>
          <label>
            <span>From</span>
            <input type="date" [value]="from()" (change)="setFrom($any($event.target).value)"/>
          </label>
          <label>
            <span>To</span>
            <input type="date" [value]="to()" (change)="setTo($any($event.target).value)"/>
          </label>
          <label class="survey-controls__check">
            <input type="checkbox" [checked]="includePartial()"
                   (change)="setPartial($any($event.target).checked)"/>
            <span>Include unfinished sets</span>
          </label>
          <!-- Aggregate only. A per-person export would hand away the one
               promise this feature makes. -->
          <button type="button" class="btn btn-sm btn-outline" (click)="download()">
            Download CSV
          </button>
        </div>

        <p class="muted">
          Showing <strong>{{ d.audienceRole === 'TENANT' ? 'tenant' : 'landlord' }}</strong> answers,
          edition {{ d.version }}. Landlord and tenant answers are counted separately and are never
          added together — they were asked different questions.
        </p>

        <div class="insight-banner">
          <app-icon name="lightbulb"/>
          <span>
            Counts, not percentages, and the number who answered each question is
            shown beside it — the same answer means a different thing at five
            responses and at two hundred. Nobody is named: this shows what was
            said, never who said it.
          </span>
        </div>

        <div class="stat-row">
          <div class="stat-box"><div class="val">{{ d.finished }}</div><div class="lbl">Finished</div></div>
          <div class="stat-box"><div class="val">{{ d.started }}</div><div class="lbl">Started</div></div>
          <div class="stat-box">
            <div class="val">{{ d.completionRate === null ? '—' : d.completionRate + '%' }}</div>
            <div class="lbl">Finished of started</div>
          </div>
          <div class="stat-box"><div class="val">{{ d.dismissed }}</div><div class="lbl">Said not now</div></div>
          <div class="stat-box"><div class="val">{{ d.bySource['onboarding'] ?? 0 }}</div><div class="lbl">At sign-up</div></div>
          <div class="stat-box"><div class="val">{{ d.bySource['dashboard'] ?? 0 }}</div><div class="lbl">From a dashboard</div></div>
        </div>

        @if (d.responses === 0) {
          <div class="empty-state">
            <h2>Nothing answered yet</h2>
            <p>Answers appear here as people finish them. This survey is {{ d.active ? 'live' : 'not live' }}.</p>
          </div>
        } @else {

          @if (!d.segmentQuestionId) {
            <p class="muted">
              This survey has no room-count question, so the results are not segmented — the single column below is
              everyone.
            </p>
          }

          @for (q of d.questions; track q.id) {
            <section class="dash-section">
              <h2 class="dash-section-title">{{ q.prompt }}</h2>
              <p class="muted">{{ q.answered }} of {{ d.responses }} answered this</p>

              @if (q.kind === 'choice') {
                @if (q.answered === 0) {
                  <p class="muted">No answers yet.</p>
                } @else {
                  <div class="table-scroll">
                    <table class="data-table">
                      <caption class="sr-only">{{ q.prompt }} — counts by number of rooms</caption>
                      <thead>
                        <tr>
                          <th scope="col">Answer</th>
                          @for (seg of activeSegments(); track seg) {
                            <th scope="col">{{ seg }}</th>
                          }
                          <th scope="col">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (opt of q.options; track opt) {
                          <tr>
                            <th scope="row">{{ opt }}</th>
                            @for (seg of activeSegments(); track seg) {
                              <td>{{ q.counts[seg]?.[opt] ?? 0 }}</td>
                            }
                            <td><strong>{{ totalFor(q, opt) }}</strong></td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              }

              @if (q.texts.length) {
                <ul class="survey-texts">
                  @for (t of q.texts; track $index) {
                    <li><span class="survey-seg">{{ t.segment }}</span> {{ t.text }}</li>
                  }
                </ul>
              } @else if (q.kind === 'text') {
                <p class="muted">No answers yet.</p>
              }
            </section>
          }
        }
      }
  `,
  styles: [
    `
      /* The filter row had NO rule at all, so five labels and a button
         stacked as blocks down the left of the admin screen. Found by the
         coverage audit rather than by looking, which is the point of it:
         a class that is styled nowhere renders as unstyled inline content
         and nothing about the template says so. */
      .survey-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 0.75rem;
        margin-bottom: 1rem;
      }
      .survey-controls > label {
        display: grid;
        gap: 0.25rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--ink2);
      }
      /* A checkbox and its words sit on one line; the others are stacked. */
      .survey-controls__check {
        display: flex !important;
        flex-direction: row;
        align-items: center;
        gap: 0.5rem;
        /* 44px, WCAG 2.5.8 — the same floor every other control in this app
           has, and an admin on a phone is still on a phone. */
        min-height: 44px;
      }
      .table-scroll {
        overflow-x: auto;
      }
      .data-table {
        border-collapse: collapse;
        width: 100%;
        min-width: 32rem;
      }
      .data-table th,
      .data-table td {
        border-bottom: 1px solid var(--border);
        padding: 0.5rem 0.6rem;
        text-align: left;
      }
      .data-table thead th {
        font-weight: 600;
      }
      .survey-texts {
        list-style: none;
        margin: 0.5rem 0 0;
        padding: 0;
      }
      .survey-texts li {
        border-left: 3px solid var(--border);
        margin-bottom: 0.6rem;
        padding: 0.3rem 0 0.3rem 0.7rem;
      }
      .survey-seg {
        display: inline-block;
        font-size: 0.8rem;
        margin-right: 0.4rem;
        opacity: 0.75;
      }
      /* Names the table for a screen reader without repeating the heading
         visually. Defined here because the shared stylesheet has no such
         helper — star-rating does the same thing for the same reason. */
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    `,
  ],
})
export class AdminSurveys implements OnInit {
  private http = inject(HttpClient);

  readonly data = signal<SurveyAggregate | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  /**
   * Which survey is on screen. A signal, not a constant, because there are two
   * of them now — landlords and tenants are asked different questions and
   * their answers are never added together.
   */
  readonly slug = signal('landlord-pain-2026');
  readonly from = signal('');
  readonly to = signal('');
  /**
   * ⚠️ Off by default, and labelled.
   *
   * A part-answered set is real data, but counting it beside finished ones
   * weights the early questions: everybody who started answered question one,
   * and only some reached question seven. Making it a visible switch is the
   * difference between a deliberate choice and a silent bias.
   */
  readonly includePartial = signal(false);

  /**
   * Only the segments anyone actually fell into.
   *
   * The API returns every bracket the question offers, and showing all of them
   * means four mostly-empty columns on a phone. An empty column is not
   * information — that nobody has 10+ rooms is already visible from the row
   * of zeros it would replace.
   */
  readonly activeSegments = computed(() => {
    const d = this.data();
    if (!d) return [];
    const used = new Set<string>();
    for (const q of d.questions) {
      for (const seg of Object.keys(q.counts)) used.add(seg);
      for (const t of q.texts) used.add(t.segment);
    }
    return d.segments.filter((s) => used.has(s));
  });

  ngOnInit() {
    this.load();
  }

  pick(slug: string) { this.slug.set(slug); this.load(); }
  setFrom(value: string) { this.from.set(value); this.load(); }
  setTo(value: string) { this.to.set(value); this.load(); }
  setPartial(value: boolean) { this.includePartial.set(value); this.load(); }

  /**
   * The filters, built once and used by BOTH the screen and the download.
   *
   * ⚠️ Two copies of this is how a table and the CSV beside it come to
   * disagree about what "this month, tenants only" means — and the CSV is the
   * one nobody checks.
   */
  private query(): string {
    const params = new URLSearchParams();
    if (this.from()) params.set('from', this.from());
    if (this.to()) params.set('to', `${this.to()}T23:59:59`);
    if (this.includePartial()) params.set('includePartial', 'true');
    const q = params.toString();
    return q ? `?${q}` : '';
  }

  private load() {
    this.loading.set(true);
    this.error.set(null);
    this.http
      .get<SurveyAggregate>(`${environment.apiUrl}/surveys/admin/${this.slug()}/results${this.query()}`)
      .subscribe({
        next: (d) => {
          this.data.set(d);
          this.loading.set(false);
        },
        error: (e) => {
          this.loading.set(false);
          this.error.set(
            e?.status === 404
              ? 'That survey has not been seeded yet. Run prisma/seed-survey.ts --apply.'
              : 'Could not load the results. Try again.',
          );
        },
      });
  }

  /**
   * Download the same counts as a CSV.
   *
   * Fetched as a blob rather than linked, because the API needs the bearer
   * token and an <a href> carries no headers — a plain link would answer 401
   * and look like a broken button.
   */
  download() {
    this.http
      .get(`${environment.apiUrl}/surveys/admin/${this.slug()}/results.csv${this.query()}`,
        { responseType: 'blob' })
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${this.slug()}-results.csv`;
          a.click();
          URL.revokeObjectURL(url);
        },
        error: () => this.error.set('The download failed. Try again.'),
      });
  }

  totalFor(q: AggregateQuestion, option: string): number {
    return Object.values(q.counts).reduce((sum, bySeg) => sum + (bySeg[option] ?? 0), 0);
  }
}
