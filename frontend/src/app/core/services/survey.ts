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
  title: string;
  intro: string | null;
  questions: SurveyQuestion[];
  /** The single question the post-letting prompt asks. */
  microQuestion: SurveyQuestion | null;
}

/** A choice answer, which may carry free text alongside it. */
export type SurveyAnswer = string | { choice: string; text?: string };

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

  submit(slug: string, answers: Record<string, SurveyAnswer>, source: 'micro' | 'dashboard' | 'whatsapp') {
    return this.http
      .post<{ recorded: number }>(`${this.api}/surveys/${slug}/responses`, { answers, source })
      .pipe(tap(() => this.prompt.set(null)));
  }

  /** "Not now." The server honours it for 30 days; nothing is stored locally. */
  dismiss(slug: string) {
    return this.http
      .post<{ askAgainInDays: number }>(`${this.api}/surveys/${slug}/dismiss`, {})
      .pipe(tap(() => this.prompt.set(null)));
  }
}
