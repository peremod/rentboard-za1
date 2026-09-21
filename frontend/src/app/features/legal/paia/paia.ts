import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * PAIA Manual — Promotion of Access to Information Act 2 of 2000, Section 51.
 * LEGAL REQUIREMENT: must be filed with the SAHRC (paia@sahrc.org.za, Form 2,
 * no fee) before launch — see project's Audit Report / MVP Summary docs.
 */
@Component({
  selector: 'app-paia',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legal-page">
      <div class="legal-container">
        <header class="legal-header">
          <h1>PAIA Manual</h1>
          <p class="legal-meta">
            Promotion of Access to Information Act 2 of 2000 (PAIA) · Section 51 Manual · Version 1.0 · 2026
          </p>
          <p class="legal-intro">
            In terms of Section 51 of PAIA, <strong>[YOUR COMPANY NAME] (Pty) Ltd</strong> hereby publishes its
            PAIA Manual. This manual must be filed with the South African Human Rights Commission (SAHRC).
          </p>
        </header>

        <section>
          <h2>1. Contact Details of the Private Body</h2>
          <p><strong>Name:</strong> [YOUR COMPANY NAME] (Pty) Ltd</p>
          <p><strong>CIPC Registration Number:</strong> [REGISTRATION NUMBER]</p>
          <p><strong>Physical Address:</strong> [REGISTERED ADDRESS], South Africa</p>
          <p><strong>Email:</strong> paia&#64;mastande.co.za</p>
        </section>

        <section>
          <h2>2. Information Officer</h2>
          <p><strong>Information Officer:</strong> [FULL NAME] · paia&#64;mastande.co.za</p>
          <p>Registered with the Information Regulator (South Africa) as required by POPIA.
          Reg. No: <strong>[IR REGISTRATION NUMBER]</strong>.</p>
        </section>

        <section>
          <h2>3. Categories of Records Held</h2>
          <ul>
            <li>User account records (name, email, phone)</li>
            <li>Room listing and rental application records</li>
            <li>Communication records (platform messages)</li>
            <li>Financial records (ZAR transactions, retained 5 years — SARS)</li>
            <li>Company registration and statutory documents</li>
          </ul>
        </section>

        <section>
          <h2>4. How to Submit a Request for Access to Records</h2>
          <ol>
            <li>Complete <strong>Form C</strong> (available at
              <a href="https://www.justice.gov.za/paia/paia.htm" target="_blank" rel="noopener">justice.gov.za/paia</a>)</li>
            <li>Submit to <strong>paia&#64;mastande.co.za</strong></li>
            <li>Pay the prescribed request fee of <strong>R140</strong></li>
          </ol>
          <p>We acknowledge requests within <strong>5 business days</strong> and decide within <strong>30 days</strong>.</p>
        </section>

        <section>
          <h2>5. SAHRC Contact Details</h2>
          <address>
            South African Human Rights Commission (SAHRC)<br/>
            Private Bag 2700, Houghton, 2041<br/>
            Tel: 011 877 3600 · paia&#64;sahrc.org.za · www.sahrc.org.za
          </address>
        </section>
      </div>
    </div>
  `,
})
export class Paia {}
