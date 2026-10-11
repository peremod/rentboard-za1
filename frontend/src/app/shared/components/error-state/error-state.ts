import { ChangeDetectionStrategy, Component, output } from '@angular/core';

/**
 * "We could not load this" — Phase J2.
 *
 * ── Why this exists
 *
 * Three screens had written the same thing:
 *
 *   notices.ts          <p class="notices-empty" role="alert">
 *   messages.ts         <p class="msg-empty" role="alert">
 *   applicants-inbox.ts <p class="ai-empty" role="alert">
 *
 *   "We could not load your {notices,messages,applicants} just now — this is a
 *    problem at our end, not an empty {list,inbox,list}." + Try again
 *
 * Identical copy, identical structure, three class names. And each of those
 * elements ALSO carried the screen's loading state, so a class named for an
 * empty list did error, loading and empty at once — and the error had no error
 * styling at all. It rendered as ordinary muted body text, which is exactly
 * what css-coverage-audit was written for after .form-error did the same.
 *
 * ⚠️ The sentence is the point and it stays. "This is a problem at our end,
 * not an empty list" is the most useful thing an error can say on this
 * product: the alternative reading — "nobody applied" — is the one a landlord
 * will believe and act on, and it is false. So this takes the copy as content
 * and supplies only the structure, the retry and the treatment.
 *
 * ── Why var(--danger) and not the red that was there
 *
 * The three .error rules in photo-upload, create-room and room-detail each
 * said color: #D63B3B, hand-typed, at .82rem. Measured: 4.32:1 on --cream and
 * 3.96:1 on --cream2, under the 4.5:1 small-text floor, three times over —
 * and five more components had the same literal.
 *
 * $color-danger: #B23B3B has existed in _variables.scss all along and is
 * 5.48:1 on cream. The components could not reach it: an SCSS variable is
 * invisible to an inline styles block, which is the audit's §H2 finding, so
 * each one typed a red from memory and all of them got a worse one. There is
 * now a --danger custom property, which they can read.
 */
@Component({
  selector: 'app-error-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="err" role="alert">
      <ng-content>We could not load this just now — this is a problem at our end.</ng-content>
      <button type="button" class="link-button err__retry" (click)="retry.emit()">
        Try again
      </button>.
    </p>
  `,
  styles: [`
    .err {
      color: var(--danger);
      font-size: .86rem;
      line-height: 1.6;
      margin: 0;
      padding: .6rem .75rem;
      /* The edge, not the card — the same device as .state-edge. A tinted box
         would read as a form field; a rule reads as a margin note, which is
         what this is. */
      border-left: 3px solid var(--danger);
      background: var(--cream2);
    }
    /* The retry is the only control in the message, so it has to look like
       one. The link-button class carries the reset; this carries the weight. */
    .err__retry { font-weight: 700; color: var(--danger); text-decoration: underline; }
  `],
})
export class ErrorState {
  /** The caller reloads; this component does not know how. */
  retry = output<void>();
}
