import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';
import { PortalShell } from '../../../shared/components/portal-shell/portal-shell';
import { ADMIN_NAV } from '../admin-nav';

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
  title: string;
  active: boolean;
  responses: number;
  anonymous: number;
  bySource: Record<string, number>;
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
  imports: [PortalShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems" roleLabel="Admin" avatarColour="var(--ink2)" pageTitle="Survey">

      @if (loading()) {
        <p class="muted">Loading results…</p>
      } @else if (error()) {
        <p class="field-error" role="alert">{{ error() }}</p>
      } @else if (data(); as d) {

        <div class="insight-banner">
          💡
          <span>
            Counts, not percentages, and the number who answered each question is
            shown beside it — the same answer means a different thing at five
            responses and at two hundred. Nobody is named: this shows what was
            said, never who said it.
          </span>
        </div>

        <div class="stat-row">
          <div class="stat-box"><div class="val">{{ d.responses }}</div><div class="lbl">Responses</div></div>
          <div class="stat-box"><div class="val">{{ d.bySource['dashboard'] ?? 0 }}</div><div class="lbl">From the dashboard</div></div>
          <div class="stat-box"><div class="val">{{ d.bySource['micro'] ?? 0 }}</div><div class="lbl">After a letting</div></div>
          <div class="stat-box"><div class="val">{{ d.bySource['whatsapp'] ?? 0 }}</div><div class="lbl">Over WhatsApp</div></div>
        </div>

        @if (d.responses === 0) {
          <div class="empty-state">
            <h2>Nothing answered yet</h2>
            <p>Responses appear here as landlords answer. The survey is {{ d.active ? 'live' : 'not live' }}.</p>
          </div>
        } @else {

          @if (d.anonymous > 0) {
            <p class="muted">
              {{ d.anonymous }} response{{ d.anonymous === 1 ? '' : 's' }} came in without a landlord account, so
              {{ d.anonymous === 1 ? 'it cannot' : 'they cannot' }} be segmented by room count. The segment columns
              below will not add up to the totals because of this.
            </p>
          }
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
    </app-portal-shell>
  `,
  styles: [
    `
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
        border-bottom: 1px solid var(--line);
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
        border-left: 3px solid var(--line);
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
  navItems = ADMIN_NAV;

  readonly data = signal<SurveyAggregate | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  /** Matches the seeded survey. A second survey would need a picker; the brief
   *  is explicit that v1 does not build one. */
  private slug = 'landlord-pain-2026';

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
    this.http
      .get<SurveyAggregate>(`${environment.apiUrl}/surveys/admin/${this.slug}/results`)
      .subscribe({
        next: (d) => {
          this.data.set(d);
          this.loading.set(false);
        },
        error: (e) => {
          this.loading.set(false);
          this.error.set(
            e?.status === 404
              ? 'No survey has been seeded yet. Run prisma/seed-survey.ts --apply.'
              : 'Could not load the results. Try again.',
          );
        },
      });
  }

  totalFor(q: AggregateQuestion, option: string): number {
    return Object.values(q.counts).reduce((sum, bySeg) => sum + (bySeg[option] ?? 0), 0);
  }
}
