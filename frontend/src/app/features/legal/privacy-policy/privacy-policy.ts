import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Privacy Policy — POPIA (Protection of Personal Information Act 4 of 2013) compliant.
 *
 * The responsible party is named here as registered at CIPC. The Information
 * Officer is still a placeholder: POPIA s.56 makes that a named person, not a
 * role, and it is not something to invent — fill it in before launch.
 *
 * This is a legal document. Have a South African attorney review it, not just
 * the fields that were blank.
 */
@Component({
  selector: 'app-privacy-policy',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legal-page">
      <div class="legal-container">
        <header class="legal-header">
          <h1>Privacy Policy</h1>
          <p class="legal-meta">Last updated: 28 July 2026 · Version 1.0 · Republic of South Africa · POPIA compliant</p>
          <p class="legal-intro">
            Mastande is committed to protecting your personal information in accordance with the
            <strong>Protection of Personal Information Act 4 of 2013 (POPIA)</strong>. This policy explains how we
            collect, process, store and share your personal information when you use umastande.co.za.
          </p>
        </header>

        <section>
          <h2>1. Who We Are (Responsible Party)</h2>
          <p>Mastande is operated by <strong>Umastande (Pty) Ltd</strong>, CIPC Reg. No. <strong>2026/757331/07</strong>.
          For the purposes of POPIA, we are the <strong>Responsible Party</strong>.</p>
          <p><strong>Information Officer:</strong> [NAME] · privacy&#64;umastande.co.za</p>
        </section>

        <section>
          <h2>2. Personal Information We Collect</h2>
          <ul>
            <li><strong>Identity:</strong> full name, ID number (optional), date of birth</li>
            <li><strong>Contact:</strong> email address, phone number</li>
            <li><strong>Account:</strong> hashed password — never stored in plain text</li>
            <li><strong>Listing data:</strong> property details, pricing in ZAR, photographs</li>
            <li><strong>Application data:</strong> employment status, income, cover notes</li>
            <li><strong>Financial:</strong> billing details processed by Stripe in ZAR — we never store card numbers</li>
          </ul>
        </section>

        <section>
          <h2>3. Lawful Grounds (POPIA Section 11)</h2>
          <table class="legal-table">
            <thead><tr><th>Processing activity</th><th>Lawful ground</th></tr></thead>
            <tbody>
              <tr><td>Account management</td><td>Contract — s.11(1)(b)</td></tr>
              <tr><td>Payment processing (ZAR)</td><td>Contract — s.11(1)(b)</td></tr>
              <tr><td>Marketing emails</td><td>Consent — s.11(1)(a)</td></tr>
              <tr><td>Analytics cookies</td><td>Consent — s.11(1)(a)</td></tr>
              <tr><td>WhatsApp notifications</td><td>Consent + Contract</td></tr>
              <tr><td>Fraud prevention</td><td>Legitimate interest — s.11(1)(f)</td></tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2>4. Your POPIA Rights</h2>
          <ul>
            <li><strong>Access (s.23):</strong> request a copy of all personal information we hold</li>
            <li><strong>Correction (s.24):</strong> request correction or deletion of inaccurate data</li>
            <li><strong>Object (s.11(3)):</strong> object to processing based on legitimate interest</li>
            <li><strong>Withdraw consent:</strong> at any time, without affecting prior processing</li>
            <li><strong>Delete:</strong> request deletion of your account and associated data</li>
          </ul>
          <p>Email <strong>privacy&#64;umastande.co.za</strong> — we respond within <strong>30 days</strong> (POPIA requirement).</p>
        </section>

        <section>
          <h2>5. Data Retention</h2>
          <p>Financial records are retained for 5 years in line with the Tax Administration Act 28 of 2011 (SARS
          requirement). Account data is retained until deletion plus 30 days. Analytics data is anonymised after 2 years.</p>
        </section>

        <section>
          <h2>6. Information Regulator</h2>
          <p>You have the right to lodge a complaint with the <strong>Information Regulator (South Africa)</strong>:</p>
          <address>
            JD House, 27 Stiemens Street, Braamfontein, Johannesburg, 2001<br/>
            Email: complaints.IR&#64;justice.gov.za · Website: www.inforegulator.org.za
          </address>
        </section>
      </div>
    </div>
  `,
})
export class PrivacyPolicy {}
