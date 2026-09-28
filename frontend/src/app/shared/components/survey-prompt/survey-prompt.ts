import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SurveyAnswer, SurveyQuestion, SurveyService } from '../../../core/services/survey';

/**
 * The survey, asked either as one question or as all of them.
 *
 * One component for both because they are the same form with a different
 * question list — the alternative was two components that would drift, which
 * this repo has already paid for once with the portal nav (checklist row 21).
 *
 * `mode` decides which questions are shown:
 *
 *   'micro' — the single question marked micro in prisma/surveys.ts, asked
 *             right after a landlord marks a room let. One question, because
 *             someone who has just finished a task will answer one and close
 *             anything longer.
 *   'full'  — every question, reached from the dashboard link.
 *
 * Nothing renders until the server says there is something to ask. The service
 * returns null for most people — already answered, dismissed inside the
 * 30-day window, not in the audience — and null is the normal case, not an
 * error state.
 *
 * ── On the heading level
 *
 * `headingLevel` is an input, and the host sets it, because only the host
 * knows what this card is nested inside. The first version hardcoded an h3 on
 * the reasoning that it sat inside a section opening with an h2 — it does not,
 * it sits directly under the page h1, so it skipped a level.
 *
 * That is the same defect the accessibility drive had just caught on the admin
 * queues, reintroduced by the person who had just fixed it, one commit later.
 * A component cannot know its own depth, so guessing is the bug; the drive
 * caught it because it walks the rendered page rather than reading the
 * template.
 */
@Component({
  selector: 'app-survey-prompt',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="card survey-prompt">
        @if (done()) {
          @if (headingLevel() === 2) { <h2>Thank you</h2> } @else { <h3>Thank you</h3> }
          <p class="muted">That is recorded. It genuinely decides what gets built next.</p>
        } @else {
          <!-- Real h2/h3 elements rather than a div with role="heading" and
               aria-level: assistive technology handles both, but every checker
               and every "jump to next heading" implementation handles the real
               tag, and this card exists to be read. -->
          @if (headingLevel() === 2) { <h2>{{ heading() }}</h2> } @else { <h3>{{ heading() }}</h3> }
          @if (mode() === 'full' && survey()?.intro) {
            <p class="muted">{{ survey()!.intro }}</p>
          }

          @for (q of questions(); track q.id) {
            <fieldset class="survey-q">
              <legend>{{ q.prompt }}</legend>

              @if (q.kind === 'choice') {
                @for (opt of q.options ?? []; track opt) {
                  <label class="survey-opt">
                    <input
                      type="radio"
                      [name]="q.id"
                      [value]="opt"
                      [checked]="choiceOf(q.id) === opt"
                      (change)="setChoice(q.id, opt)"
                    />
                    <span>{{ opt }}</span>
                  </label>
                }
                @if (q.optionalText) {
                  <label class="survey-text">
                    <span>{{ q.textLabel ?? 'Anything to add?' }}</span>
                    <input
                      type="text"
                      [value]="textOf(q.id)"
                      (input)="setText(q.id, $any($event.target).value)"
                      [attr.aria-label]="q.textLabel ?? 'Anything to add?'"
                    />
                  </label>
                }
              } @else {
                <label class="survey-text">
                  <!-- No visible span: the fieldset's legend already carries
                       this question's text, and repeating it would read the
                       prompt twice to a screen reader. The aria-label is what
                       names the control itself, which the accessibility drive
                       checks for. -->
                  <textarea
                    rows="3"
                    [value]="textOf(q.id)"
                    (input)="setText(q.id, $any($event.target).value)"
                    [attr.aria-label]="q.prompt"
                  ></textarea>
                </label>
              }
            </fieldset>
          }

          @if (error()) {
            <p class="field-error" role="alert">{{ error() }}</p>
          }

          <div class="survey-actions">
            <button type="button" class="btn btn-primary" [disabled]="busy() || !anyAnswer()" (click)="send()">
              {{ busy() ? 'Sending…' : 'Send' }}
            </button>
            <button type="button" class="link-btn" [disabled]="busy()" (click)="skip()">Not now</button>
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      .survey-prompt {
        margin-block: 1rem;
      }
      .survey-q {
        border: 0;
        margin: 0 0 1rem;
        padding: 0;
      }
      .survey-q legend {
        font-weight: 600;
        margin-bottom: 0.4rem;
        padding: 0;
      }
      .survey-opt {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.35rem 0;
        cursor: pointer;
      }
      .survey-text {
        display: block;
        margin-top: 0.6rem;
      }
      .survey-text span {
        display: block;
        margin-bottom: 0.25rem;
      }
      .survey-text input,
      .survey-text textarea {
        width: 100%;
      }
      .survey-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
    `,
  ],
})
export class SurveyPrompt {
  private surveys = inject(SurveyService);

  /** 'micro' asks the one question; 'full' asks all of them. */
  readonly mode = input<'micro' | 'full'>('micro');

  /**
   * The level for this card's heading, set by whoever places it — see the
   * note above. Defaults to 3, the safe choice for a card inside a section,
   * so a host that forgets is wrong only when the card is top-level.
   */
  readonly headingLevel = input<2 | 3>(3);

  /** Fired once the card has finished with itself, so a host can collapse it. */
  readonly closed = output<void>();

  readonly survey = this.surveys.prompt;
  readonly busy = signal(false);
  readonly done = signal(false);
  readonly error = signal<string | null>(null);

  private answers = signal<Record<string, SurveyAnswer>>({});

  readonly questions = computed<SurveyQuestion[]>(() => {
    const s = this.survey();
    if (!s) return [];
    if (this.mode() === 'full') return s.questions;
    return s.microQuestion ? [s.microQuestion] : [];
  });

  /**
   * Hidden when there is nothing to ask — including when the mode is 'micro'
   * and the survey has no micro question. Rendering an empty card with a Send
   * button that submits nothing is worse than rendering nothing at all.
   */
  readonly visible = computed(() => this.done() || this.questions().length > 0);

  readonly heading = computed(() =>
    this.mode() === 'micro' ? 'One quick question' : (this.survey()?.title ?? 'A few questions'),
  );

  readonly anyAnswer = computed(() =>
    Object.values(this.answers()).some((a) =>
      typeof a === 'string' ? a.trim().length > 0 : Boolean(a.choice) || Boolean(a.text?.trim()),
    ),
  );

  choiceOf(id: string): string {
    const a = this.answers()[id];
    return typeof a === 'string' ? a : (a?.choice ?? '');
  }

  textOf(id: string): string {
    const a = this.answers()[id];
    return typeof a === 'string' ? a : (a?.text ?? '');
  }

  setChoice(id: string, choice: string) {
    const current = this.answers()[id];
    const text = typeof current === 'string' ? undefined : current?.text;
    this.answers.update((all) => ({ ...all, [id]: text ? { choice, text } : choice }));
  }

  /**
   * Text on a choice question rides alongside the choice; on a text question it
   * is the whole answer. Storing a bare string for the second case is what the
   * API expects — see the note on readText in surveys.service.ts, where
   * conflating the two silently lost every open-text answer.
   */
  setText(id: string, text: string) {
    const q = this.questions().find((x) => x.id === id);
    this.answers.update((all) => {
      if (q?.kind === 'text') return { ...all, [id]: text };
      const choice = this.choiceOf(id);
      return { ...all, [id]: { choice, text } };
    });
  }

  send() {
    const s = this.survey();
    if (!s || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.surveys.submit(s.slug, this.answers(), this.mode() === 'micro' ? 'micro' : 'dashboard').subscribe({
      next: () => {
        this.busy.set(false);
        this.done.set(true);
        this.closed.emit();
      },
      error: () => {
        this.busy.set(false);
        // Says what to do, not just that something went wrong. The answers are
        // still in the form, so "try again" is a real instruction.
        this.error.set('That did not send. Check your connection and try again.');
      },
    });
  }

  skip() {
    const s = this.survey();
    if (!s || this.busy()) return;
    this.busy.set(true);
    this.surveys.dismiss(s.slug).subscribe({
      next: () => {
        this.busy.set(false);
        this.closed.emit();
      },
      error: () => {
        this.busy.set(false);
        this.error.set('That did not send. Check your connection and try again.');
      },
    });
  }
}
