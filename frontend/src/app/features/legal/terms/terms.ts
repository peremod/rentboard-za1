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
          <p class="legal-meta">Last updated: 28 July 2026 · Republic of South Africa · ECTA 25 of 2002</p>
          <p class="legal-intro">
            By using RentBoard you accept these terms under <strong>ECTA Section 11</strong>. RentBoard is an online
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
          <h2>4. Subscription Plans (ZAR, VAT inclusive)</h2>
          <table class="legal-table">
            <thead><tr><th>Plan</th><th>Monthly</th><th>Annual</th></tr></thead>
            <tbody>
              <tr><td>Free</td><td>R 0</td><td>R 0</td></tr>
              <tr><td>Pro</td><td>R 349</td><td>R 2,999</td></tr>
              <tr><td>Agency</td><td>R 1,499</td><td>R 12,999</td></tr>
              <tr><td>Renter's Passport</td><td>R 89</td><td>R 799</td></tr>
            </tbody>
          </table>
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
