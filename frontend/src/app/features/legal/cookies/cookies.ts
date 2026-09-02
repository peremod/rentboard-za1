import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-cookies',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legal-page">
      <div class="legal-container">
        <header class="legal-header">
          <h1>Cookie Policy</h1>
          <p class="legal-meta">Last updated: 28 July 2026 · POPIA s.11(1)(a) consent</p>
        </header>
        <section>
          <h2>1. What Cookies We Use</h2>
          <table class="legal-table">
            <thead><tr><th>Category</th><th>Purpose</th><th>Consent required?</th></tr></thead>
            <tbody>
              <tr>
                <td>Strictly necessary</td>
                <td>
                  One cookie, <code>rb_refresh</code>, which keeps you signed in.
                  It is httpOnly, so scripts cannot read it, and restricted to the
                  refresh endpoint.
                </td>
                <td>No — it is required for the site to work</td>
              </tr>
              <tr>
                <td>Analytics</td>
                <td><strong>None.</strong> We measure usage with daily counts that carry no
                    identifier of any kind, so no cookie is involved.</td>
                <td>Not applicable</td>
              </tr>
              <tr>
                <td>Advertising</td>
                <td><strong>None.</strong> Adverts are matched to the page you are viewing,
                    not to you. No advertiser script runs on this site.</td>
                <td>Not applicable</td>
              </tr>
              <tr>
                <td>Third-party trackers</td>
                <td><strong>None.</strong> No Google Analytics, no Meta Pixel, no session
                    recording.</td>
                <td>Not applicable</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section>
          <h2>2. Your Choices</h2>
          <p>There is nothing to opt out of, because we set no optional cookies. The notice on your
          first visit is an acknowledgement rather than a consent request — asking permission for
          trackers we do not run would imply they exist. If we ever add an optional cookie, this
          page and the notice will change to a real consent choice, with rejecting exactly as easy
          as accepting, per Information Regulator guidance. You can
          change your choice at any time; your preference is re-asked after 365 days or when this policy changes.</p>
        </section>
      </div>
    </div>
  `,
})
export class Cookies {}
