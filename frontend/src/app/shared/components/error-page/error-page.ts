import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-error-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="min-height:60vh;display:flex;align-items:center;justify-content:center;text-align:center;font-family:sans-serif">
      <div>
        <!-- h1, not h2: this is the page's only heading, and a document whose
             hierarchy starts at h2 is both an accessibility defect and the
             thing Lighthouse flags as a skipped heading level. -->
        <h1>Page not found</h1>
        <p><a routerLink="/">Back to home</a></p>
      </div>
    </div>
  `,
})
export class ErrorPage {}
