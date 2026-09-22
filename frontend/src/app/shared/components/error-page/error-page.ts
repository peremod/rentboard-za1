import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-error-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!--
      The marker the server reads to set the status.

      A component cannot set an HTTP status in Angular 21 — @angular/ssr takes
      it from the matched SERVER route, and a ':lang' server route matches any
      single segment, so '/foo' and '/xx/pricing' render this page without ever
      reaching the catch-all that says 404. Rather than keep a second copy of
      the route table in server.ts and let the two drift, the page that IS the
      404 declares itself, and server.ts turns that into the status. See
      NOT_FOUND_MARKER in src/server.ts — the two strings must match.
    -->
    <meta name="mastande-status" content="404"/>
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
