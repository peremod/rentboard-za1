import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-disclaimer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legal-page">
      <div class="legal-container">
        <header class="legal-header">
          <h1>Platform Disclaimer</h1>
          <p class="legal-meta">Last updated: 28 July 2026 · Republic of South Africa</p>
          <div class="disclaimer-banner">
            ⚠️ RentBoard is an online intermediary under <strong>ECTA 25 of 2002</strong>. We are
            <strong>NOT</strong> a PPRA-registered estate agent, and are not party to any tenancy agreement.
          </div>
        </header>

        <section>
          <h2>1. Not an Estate Agent</h2>
          <p>RentBoard is not registered with the <strong>Property Practitioners Regulatory Authority (PPRA)</strong>
          under the Property Practitioners Act 22 of 2019. We earn no commission on any tenancy.</p>
        </section>

        <section>
          <h2>2. No Verification of Listings</h2>
          <p>We do not verify property descriptions, landlord authority, or municipal by-law compliance.</p>
          <p><strong>⚠️ Tenants must NEVER pay a deposit before viewing a room in person and signing a lease.</strong></p>
          <ul>
            <li>Always view in person before committing</li>
            <li>Request proof the landlord is authorised to let the property</li>
            <li>Insist on a written lease and confirm the deposit is in an interest-bearing account (Rental Housing Act)</li>
            <li>Report suspicious listings to safety&#64;rentboard.co.za or SAPS on 10111</li>
          </ul>
        </section>

        <section>
          <h2>3. Rental Housing Tribunal Contacts</h2>
          <table class="legal-table">
            <thead><tr><th>Province</th><th>Contact</th></tr></thead>
            <tbody>
              <tr><td>Gauteng</td><td>011 355 4000</td></tr>
              <tr><td>Western Cape</td><td>021 483 5020</td></tr>
              <tr><td>KwaZulu-Natal</td><td>031 336 5300</td></tr>
              <tr><td>Eastern Cape</td><td>040 609 3200</td></tr>
              <tr><td>Legal Aid SA (all provinces)</td><td>0800 110 110 (free)</td></tr>
              <tr><td>SAPS (emergency)</td><td>10111</td></tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2>4. Reporting Concerns</h2>
          <p>Report fraudulent, discriminatory or illegal listings via safety&#64;rentboard.co.za. We investigate within 24 hours.</p>
        </section>
      </div>
    </div>
  `,
})
export class Disclaimer {}
