import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * "Loading…" — once, and announced — Phase J2.
 *
 * ── Why this exists
 *
 * Counted: 38 loading states across 28 components, 23 of them written as the
 * identical paragraph with the muted class. So the COPY was already
 * consistent; the problem was that there was nothing to improve once. And one
 * thing badly needed improving.
 *
 * ⚠️ None of them was announced. A paragraph that is replaced by content when
 * a request lands is silent to a screen reader: no role, no aria-live, so
 * nothing says the screen is busy and nothing says it has finished. There are
 * 81 live regions in this app and 68 of them are role="alert" on field errors;
 * exactly 11 paragraphs carry role="status", none of them a loading state in a
 * template. axe does not flag a missing live region, so a11y-drive has never
 * reported this and never could.
 *
 * Worse on three screens: notices, messages and applicants-inbox used ONE
 * element for both the error and the loading state, with role="alert" on it —
 * so "Loading…" was announced as an ALERT, the politeness level reserved for
 * something going wrong.
 *
 * So: role="status" with aria-live="polite", in one place.
 *
 * ── Why the text is projected
 *
 * Ten screens say something more specific than "Loading…" — "Loading your
 * listings…", "Loading the record…", "Loading rent record…". That is better
 * copy, not drift, so it is kept:
 *
 *     <app-loading/>
 *     <app-loading>Loading your listings…</app-loading>
 *
 * ng-content with FALLBACK CONTENT, supported since Angular 18 and this is 21.
 * The first version of this component carried a flag set from an input
 * transform — a side effect in a transform, to work around something the
 * framework already solves.
 */
@Component({
  selector: 'app-loading',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="loading muted" role="status" aria-live="polite">
      <ng-content>Loading…</ng-content>
    </p>
  `,
  styles: [`
    /* The muted class carries colour and size. This adds only what a loading
       line needs that a paragraph does not: room to breathe when it is the
       only thing on the screen. */
    .loading { padding: .5rem 0; }
  `],
})
export class Loading {}
