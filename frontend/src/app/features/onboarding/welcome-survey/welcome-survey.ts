import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { SurveyService, SurveyAnswer, SurveyQuestion } from '../../../core/services/survey';
import { Loading } from '../../../shared/components/loading/loading';

/**
 * The welcome questions — Phase 9a.
 *
 * ── Why this is AFTER the account exists, not inside the sign-up form
 *
 * The account is created by one POST and this screen is the next route. So a
 * person who refreshes, loses signal, closes the tab or simply walks away has
 * an account: nothing they typed into the registration form is at risk, which
 * is the one thing that must never depend on a questionnaire. The owner's
 * brief asks for exactly this — "do not unnecessarily prevent a user from
 * creating an account … because they skipped a nonessential survey".
 *
 * ── Why one question at a time
 *
 * This product is used on a cheap Android phone, often on mobile data. Seven
 * questions in one scroll is a wall; one question with a progress line is a
 * decision a person can make seven times. Every step is saved on the SERVER as
 * it is answered, so the answers survive the tab closing, and survive moving
 * from a phone to a laptop.
 *
 * ── Nothing here is mandatory, and that is said before the first question
 *
 * Skip is on every step, and so is "finish later". There is no question whose
 * absence blocks anything, because nothing downstream reads these answers to
 * decide what a person may do — see the brief's section G, which this
 * deliberately does not cross: answers never change a tenancy, an application
 * or a rent record.
 */
@Component({
  selector: 'app-welcome-survey',
  standalone: true,
  imports: [FormsModule, Loading],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="welcome">
      @if (loading()) {
        <app-loading>Getting your questions…</app-loading>
      } @else if (!survey()) {
        <!-- Nothing to ask: no active survey for this role, already answered,
             or skipped inside the window. Not an error, and not a dead end —
             this bounces straight on to where they were going. -->
        <p class="muted">Taking you to your dashboard…</p>
      } @else {
        <header class="welcome__head">
          <p class="welcome__eyebrow">{{ roleLine() }}</p>
          <h1 class="welcome__title">{{ survey()!.title }}</h1>
          @if (step() === 0 && survey()!.intro) {
            <p class="welcome__intro">{{ survey()!.intro }}</p>
          }
          <!-- Said once, before the first question, exactly as the brief asks:
               what is required, before anybody starts. -->
          @if (step() === 0) {
            <p class="welcome__optional">
              Every question is optional, and you can stop at any point — what
              you have answered is kept.
            </p>
          }
        </header>

        <!-- Progress. aria-valuenow as well as the bar, because "4 of 7" read
             aloud is the whole point of a progress indicator for somebody who
             cannot see it. -->
        <div class="welcome__progress" role="progressbar"
             [attr.aria-valuenow]="step() + 1" aria-valuemin="1"
             [attr.aria-valuemax]="total()"
             [attr.aria-label]="'Question ' + (step() + 1) + ' of ' + total()">
          <div class="welcome__bar" [style.width.%]="percent()"></div>
        </div>
        <p class="welcome__count">Question {{ step() + 1 }} of {{ total() }}</p>

        @if (current(); as q) {
          <fieldset class="welcome__q">
            <legend class="welcome__prompt">{{ q.prompt }}</legend>

            @if (q.kind === 'choice') {
              <div class="welcome__options">
                @for (option of q.options ?? []; track option) {
                  <button type="button" class="welcome__option"
                          [class.is-chosen]="chosen(q) === option"
                          [attr.aria-pressed]="chosen(q) === option"
                          (click)="choose(q, option)">
                    {{ option }}
                  </button>
                }
              </div>
              @if (q.optionalText) {
                <label class="welcome__text">
                  <span>{{ q.textLabel || 'Anything to add?' }}</span>
                  <input type="text" [ngModel]="text(q)" name="extra"
                         (ngModelChange)="setText(q, $event)"/>
                </label>
              }
            } @else {
              <label class="welcome__text">
                <span class="visually-hidden">{{ q.prompt }}</span>
                <textarea rows="4" [ngModel]="text(q)" name="answer"
                          (ngModelChange)="setText(q, $event)"
                          placeholder="In your own words"></textarea>
              </label>
            }
          </fieldset>

          @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }

          <div class="welcome__actions">
            @if (step() > 0) {
              <button type="button" class="btn btn-outline" [disabled]="busy()" (click)="back()">
                Back
              </button>
            }
            <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="next()">
              {{ busy() ? 'Saving…' : (isLast() ? 'Done' : 'Next') }}
            </button>
            <!-- Skipping a QUESTION is not skipping the survey: it moves on
                 and keeps everything already answered. -->
            <button type="button" class="link-btn" [disabled]="busy()" (click)="next(true)">
              Skip this one
            </button>
          </div>

          <!-- Leaving entirely. Recorded on the server, so it is honoured on
               every device rather than only in this browser. -->
          <button type="button" class="link-btn welcome__later" [disabled]="busy()" (click)="later()">
            I will do this later
          </button>
        }
      }
    </section>
  `,
  styles: [`
    .welcome {
      max-width: 34rem; margin: 0 auto; padding: 1.5rem 1rem 3rem;
      display: grid; gap: 1rem;
    }
    .welcome__head { display: grid; gap: .5rem; }
    .welcome__eyebrow {
      margin: 0; font-size: .8rem; font-weight: 700; letter-spacing: .04em;
      text-transform: uppercase; color: var(--terra);
    }
    .welcome__title { margin: 0; font-size: 1.25rem; line-height: 1.25; }
    .welcome__intro, .welcome__optional {
      margin: 0; font-size: .85rem; line-height: 1.6; color: var(--slate);
    }
    .welcome__optional { font-weight: 600; }
    .welcome__progress {
      height: 6px; border-radius: var(--r-full); background: var(--cream2);
      overflow: hidden;
    }
    .welcome__bar { height: 100%; background: var(--terra); transition: width .2s ease; }
    .welcome__count { margin: 0; font-size: .75rem; color: var(--slate); }
    .welcome__q { border: none; padding: 0; margin: 0; display: grid; gap: .75rem; }
    .welcome__prompt {
      padding: 0; font-size: 1rem; font-weight: 700; line-height: 1.35;
      /* A legend is a sentence here, so it wraps and breaks rather than
         pushing the card wider than a 360px screen. */
      white-space: normal; overflow-wrap: anywhere;
    }
    .welcome__options { display: grid; gap: .5rem; }
    .welcome__option {
      /* 44px, WCAG 2.5.8 — tapped on a phone, one-handed, often outdoors. */
      min-height: 44px; min-width: 0; padding: .75rem;
      font: inherit; font-size: .9rem; text-align: left;
      white-space: normal; line-height: 1.3;
      background: var(--white); color: var(--ink);
      border: 1.5px solid var(--border); border-radius: var(--r8); cursor: pointer;
    }
    .welcome__option:hover { border-color: var(--terra); }
    .welcome__option.is-chosen {
      border-color: var(--terra); background: rgba(193,102,61,.08); font-weight: 700;
    }
    .welcome__text { display: grid; gap: .25rem; font-size: .8rem; font-weight: 600; }
    .welcome__text input, .welcome__text textarea {
      font: inherit; font-weight: 400; padding: .75rem; min-height: 44px;
      border: 1.5px solid var(--border); border-radius: var(--r4);
      background: var(--white); color: var(--ink); width: 100%;
    }
    .welcome__actions { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; }
    .welcome__later { justify-self: start; font-size: .8rem; }
  `],
})
export class WelcomeSurvey implements OnInit {
  private surveys = inject(SurveyService);
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly step = signal(0);

  /** The answers being built, seeded from whatever was already saved. */
  readonly answers = signal<Record<string, SurveyAnswer>>({});

  readonly survey = computed(() => this.surveys.prompt());
  readonly total = computed(() => this.survey()?.questions.length ?? 0);
  readonly current = computed<SurveyQuestion | null>(
    () => this.survey()?.questions[this.step()] ?? null,
  );
  readonly isLast = computed(() => this.step() >= this.total() - 1);
  readonly percent = computed(() =>
    this.total() ? Math.round(((this.step() + 1) / this.total()) * 100) : 0);

  /** Whose answers these are, said out loud so nobody wonders. */
  readonly roleLine = computed(() =>
    this.auth.user()?.role === 'LANDLORD'
      ? 'Welcome — a few questions about your rooms'
      : 'Welcome — a few questions about your search');

  ngOnInit() {
    this.surveys.load().subscribe({
      next: (prompt) => {
        this.loading.set(false);
        if (!prompt) {
          this.home();
          return;
        }
        // ⚠️ Resume where they stopped. The answers come back from the server,
        // so this works on a different device from the one that started.
        this.answers.set({ ...(prompt.answers ?? {}) });
        const firstUnanswered = prompt.questions.findIndex((q) => !(q.id in (prompt.answers ?? {})));
        this.step.set(firstUnanswered === -1 ? 0 : firstUnanswered);
      },
      // A survey that cannot load must not strand somebody on a blank screen
      // between signing up and their dashboard.
      error: () => { this.loading.set(false); this.home(); },
    });
  }

  chosen(q: SurveyQuestion): string | null {
    const a = this.answers()[q.id];
    if (typeof a === 'string') return a;
    return a?.choice ?? null;
  }

  text(q: SurveyQuestion): string {
    const a = this.answers()[q.id];
    if (typeof a === 'string') return q.kind === 'text' ? a : '';
    return a?.text ?? '';
  }

  choose(q: SurveyQuestion, option: string) {
    const extra = this.text(q);
    this.answers.update((m) => ({ ...m, [q.id]: extra ? { choice: option, text: extra } : option }));
  }

  setText(q: SurveyQuestion, value: string) {
    const trimmed = value ?? '';
    this.answers.update((m) => {
      const next = { ...m };
      if (q.kind === 'text') {
        if (trimmed.trim()) next[q.id] = trimmed; else delete next[q.id];
        return next;
      }
      const choice = this.chosen(q);
      if (!choice) return next;
      next[q.id] = trimmed.trim() ? { choice, text: trimmed } : choice;
      return next;
    });
  }

  back() {
    this.error.set(null);
    this.step.update((s) => Math.max(0, s - 1));
  }

  /**
   * Save this step and move on.
   *
   * ⚠️ Saved per step rather than once at the end, which is what makes an
   * interrupted sign-up keep its answers. `skip` leaves the question out
   * without ending anything.
   */
  next(skip = false) {
    const q = this.current();
    const s = this.survey();
    if (!q || !s) return;

    const answer = skip ? undefined : this.answers()[q.id];
    const last = this.isLast();
    this.busy.set(true);
    this.error.set(null);

    const payload = answer === undefined ? {} : { [q.id]: answer };
    const request = last
      ? this.surveys.submit(s.slug, { ...this.answers() }, 'onboarding')
      : this.surveys.saveProgress(s.slug, payload);

    request.subscribe({
      next: () => {
        this.busy.set(false);
        if (last) { this.finish(); return; }
        this.step.update((n) => n + 1);
      },
      error: () => {
        this.busy.set(false);
        this.error.set(
          last
            ? 'That did not save. Try again — nothing you answered is lost.'
            : 'That did not save just now. Try again, or carry on and finish later.',
        );
      },
    });
  }

  /**
   * "I will do this later."
   *
   * Recorded as a dismissal so nothing nags for 30 days, and whatever is
   * already answered stays answered — a skip is not a withdrawal.
   */
  later() {
    const s = this.survey();
    if (!s) { this.home(); return; }
    this.busy.set(true);
    this.surveys.dismiss(s.slug).subscribe({
      next: () => { this.busy.set(false); this.home(); },
      // Even a failed dismissal must not trap somebody on this screen.
      error: () => { this.busy.set(false); this.home(); },
    });
  }

  private finish() {
    this.home();
  }

  private home() {
    const role = this.auth.user()?.role ?? 'TENANT';
    this.router.navigateByUrl(this.auth.homeRouteFor(role)).catch(() => {});
  }
}
