import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-terms',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legal-page">
      <div class="legal-container">
        <header class="legal-header">
          <h1>Terms &amp; Conditions</h1>
          <p class="legal-meta">Last updated: 28 September 2026 · Republic of South Africa · ECTA 25 of 2002</p>
          <p class="legal-intro">
            By using Mastande you accept these terms under <strong>ECTA Section 11</strong>. Mastande is an online
            intermediary — <strong>not an estate agent</strong> registered with the PPRA.
          </p>
        </header>

        <section>
          <h2>1. Eligibility</h2>
          <p>You must be at least <strong>18 years of age</strong> with legal capacity under South African law.
          Landlords must have authority to let any listed property.</p>
        </section>

        <section>
          <h2>2. Consumer Protection Act 68 of 2008</h2>
          <ul>
            <li><strong>Cooling-off:</strong> cancel within <strong>5 business days</strong> if purchased via direct marketing (CPA s.16)</li>
            <li><strong>Cancellation:</strong> cancel at any time with 20 business days' notice, no penalties (CPA s.14)</li>
            <li><strong>Price changes:</strong> 20 business days' notice to existing subscribers</li>
          </ul>
        </section>

        <section>
          <h2>3. Landlord Obligations</h2>
          <ul>
            <li><strong>Rental Housing Act 50/1999:</strong> written lease, inspections, deposit in an interest-bearing account, returned within 14 days</li>
            <li><strong>PIE Act 19/1998:</strong> no self-help evictions — a court order is always required</li>
            <li><strong>PEPUDA / Equality Act:</strong> no discrimination on any Constitution s.9 ground — no "no DSS/SASSA" policies</li>
            <li><strong>SARS:</strong> declare all rental income to the South African Revenue Service</li>
          </ul>
        </section>

        <section>
          <h2>4. What Mastande Charges (ZAR)</h2>
          <p><strong>There are no subscription plans.</strong> Listing a room is free and
          applying for one is free, with no commission on rent and no limit on how many
          rooms a landlord may list.</p>
          <table class="legal-table">
            <thead><tr><th>What</th><th>Who pays</th><th>Price</th></tr></thead>
            <tbody>
              <tr><td>Listing a room</td><td>Landlords</td><td>R 0</td></tr>
              <tr><td>Applying for a room</td><td>Tenants</td><td>R 0</td></tr>
              <tr><td>Renter's Passport</td><td>Tenants</td><td>R 0</td></tr>
              <tr><td>Landlord identity verification</td><td>Landlords, optional</td><td>R 149 once off</td></tr>
            </tbody>
          </table>
          <p>The <strong>R 149 identity check is the only charge</strong>. It is a once-off
          amount, not a recurring one, and it is optional — an unverified listing is shown
          and searched exactly the same way as a verified one. If we cannot verify you, the
          R 149 is refunded in full. A further attempt after a rejection is a new R 149.</p>
          <p>Advertising on the board is charged separately to advertisers under its own
          terms, and is not a charge to any landlord or tenant.</p>
          <p>Should paid plans ever be offered, these terms will be updated first and the
          notice periods in section 2 will apply. Until then, nothing on Mastande renews,
          and no payment method is stored.</p>
        </section>

        <section>
          <h2>5. Dispute Resolution</h2>
          <p>Governed by South African law. For rental disputes, contact your provincial
          <strong>Rental Housing Tribunal</strong> — a free government service. Legal Aid SA: <strong>0800 110 110</strong> (toll-free).</p>
        </section>

        <p><a routerLink="/legal/disclaimer">Read the full Disclaimer →</a></p>
      </div>
    </div>
  `,
})
export class Terms {}
