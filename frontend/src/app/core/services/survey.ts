import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '@env/environment';

/** One question as the API returns it. Mirrors prisma/surveys.ts. */
export interface SurveyQuestion {
  id: string;
  prompt: string;
  kind: 'choice' | 'text';
  options?: string[];
  optionalText?: boolean;
  textLabel?: string;
  micro?: boolean;
}

export interface SurveyPrompt {
  slug: string;
  /** Which edition. Answers belong to the edition that asked them. */
  version: number;
  title: string;
  intro: string | null;
  questions: SurveyQuestion[];
  /** What this person has already said, so a part-answered set resumes. */
  answers: Record<string, SurveyAnswer>;
  /** How many of the questions that is. */
  answered: number;
  /** The single question the post-letting prompt asks. */
  microQuestion: SurveyQuestion | null;
}

/** A choice answer, which may carry free text alongside it. */
export type SurveyAnswer = string | { choice: string; text?: string };

/** Where an answer came from. The surfaces do not measure the same thing. */
export type SurveySource = 'onboarding' | 'micro' | 'dashboard' | 'whatsapp';

export interface SurveySaveResult {
  recorded: number;
  answered: number;
  total: number;
  complete: boolean;
}

@Injectable({ providedIn: 'root' })
export class SurveyService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /**
   * What to ask, or null for "ask nothing".
   *
   * Null is the normal state and is not an error. Every caller renders nothing
   * when this is null, which is why it starts null rather than undefined —
   * a template that distinguishes "not loaded yet" from "nothing to ask"
   * flashes a prompt on every dashboard load before deciding to hide it.
   */
  readonly prompt = signal<SurveyPrompt | null>(null);

  /** Whether the ask has been resolved at all this session. */
  readonly checked = signal(false);

  load() {
    return this.http.get<SurveyPrompt | null>(`${this.api}/surveys/prompt`).pipe(
      tap((data) => {
        this.prompt.set(data ?? null);
        this.checked.set(true);
      }),
    );
  }

  /**
   * Finish a set. The prompt goes quiet afterwards.
   */
  submit(
    slug: string,
    answers: Record<string, SurveyAnswer>,
    source: SurveySource = 'dashboard',
  ) {
    return this.http
      .post<SurveySaveResult>(`${this.api}/surveys/${slug}/responses`, { answers, source, complete: true })
      .pipe(tap(() => this.prompt.set(null)));
  }

  /**
   * One question, answered at the moment it is relevant — Phase 9b.
   *
   * ⚠️ `complete: false`, and that is the whole point. Answering the
   * contextual question is answering ONE of seven: finishing the set here
   * would record six unanswered questions as a finished survey and close the
   * door on the rest. It merges into the same open set, which the task inbox
   * then offers to finish.
   *
   * The prompt signal is cleared so the card goes away for this visit.
   */
  submitMicro(slug: string, answers: Record<string, SurveyAnswer>) {
    return this.http
      .post<SurveySaveResult>(`${this.api}/surveys/${slug}/responses`,
        { answers, source: 'micro', complete: false })
      .pipe(tap(() => this.prompt.set(null)));
  }

  /**
   * Save what has been answered so far WITHOUT finishing.
   *
   * ⚠️ This is what makes the welcome questions survivable. A person who
   * closes the tab on question four has answered three questions, and before
   * this there was nowhere to put them: the only write was a complete
   * submission. Each step saves on the server, not in this browser, so
   * starting on a phone and finishing on a laptop keeps the answers.
   *
   * The prompt signal is deliberately NOT cleared — the set is still open.
   */
  saveProgress(slug: string, answers: Record<string, SurveyAnswer>, source: SurveySource = 'onboarding') {
    return this.http.post<SurveySaveResult>(
      `${this.api}/surveys/${slug}/responses`, { answers, source, complete: false },
    );
  }

  /** "Not now." The server honours it for 30 days; nothing is stored locally. */
  dismiss(slug: string) {
    return this.http
      .post<{ askAgainInDays: number }>(`${this.api}/surveys/${slug}/dismiss`, {})
      .pipe(tap(() => this.prompt.set(null)));
  }
}
