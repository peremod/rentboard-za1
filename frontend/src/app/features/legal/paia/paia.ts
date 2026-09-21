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
            In terms of Section 51 of PAIA, <strong>Umastande (Pty) Ltd</strong> hereby publishes its
            PAIA Manual. This manual must be filed with the South African Human Rights Commission (SAHRC).
          </p>
        </header>

        <section>
          <h2>1. Contact Details of the Private Body</h2>
          <p><strong>Name:</strong> Umastande (Pty) Ltd</p>
          <p><strong>CIPC Registration Number:</strong> 2026/757331/07</p>
          <p><strong>Physical Address:</strong> [REGISTERED ADDRESS], South Africa</p>
          <p><strong>Email:</strong> paia&#64;umastande.co.za</p>
        </section>

        <section>
          <h2>2. Information Officer</h2>
          <p><strong>Information Officer:</strong> [FULL NAME] · paia&#64;umastande.co.za</p>
          <p>Registered with the Information Regulator (South Africa) as required by POPIA.
          Registration No: <strong>2026-067370</strong>.</p>
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
          <h2>3A. Personal Information Processed, by Data Subject</h2>
          <p>
            Published in terms of section 51(1)(c) and 51(1)(e) of PAIA, read with
            section 17 of POPIA. Each category below is processed for the stated
            purpose and no other; where consent is the lawful basis it is obtained
            at the point of collection and may be withdrawn.
          </p>

          <table class="legal-table">
            <thead>
              <tr>
                <th>Category of data subject</th>
                <th>Categories of personal information</th>
                <th>Purpose of processing</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Tenants</strong> (people seeking accommodation)</td>
                <td>
                  Identity and contact details (full name, email address, mobile
                  number); account credentials (password, stored only as a hash);
                  optional employment status and income range; rental applications
                  and the messages they contain; saved searches and saved rooms;
                  tenancy history and rent records; reviews written and received.
                </td>
                <td>
                  To create and operate the account (POPIA s.11(1)(b), contract);
                  to transmit an application to a landlord and let the two parties
                  correspond; to send alerts the tenant has asked for
                  (s.11(1)(a), consent); to maintain the reputation record both
                  sides rely on.
                </td>
              </tr>
              <tr>
                <td><strong>Tenants applying for a Renter's Passport</strong></td>
                <td>
                  <strong>Special personal information</strong> — identity document,
                  SASSA grant confirmation, employer confirmation, bank-activity
                  screenshots, and the name and mobile number of a previous landlord
                  given as a reference.
                </td>
                <td>
                  To verify identity and that rent can be paid, so a landlord can
                  assess an application on evidence rather than assumption
                  (s.11(1)(a), consent; s.27(1)(a) for special personal
                  information). <strong>Documents are deleted the moment a decision
                  is made.</strong> Only the outcome and an audit record of what was
                  checked are retained — never the contents of the document.
                </td>
              </tr>
              <tr>
                <td><strong>Landlords</strong> (people letting accommodation)</td>
                <td>
                  Identity and contact details (full name, email address, mobile
                  number, optional company name); room listings, photographs and
                  suburb-level location; applications received; rent records kept
                  against their own tenancies; rating and review history; payment
                  references for the verification fee.
                </td>
                <td>
                  To create and operate the account and publish listings
                  (s.11(1)(b), contract); to receive and respond to applications;
                  to take payment for an optional identity check. <strong>No card
                  or bank-account details are held</strong> — payment is processed
                  by PayFast and only a transaction reference is stored.
                </td>
              </tr>
              <tr>
                <td><strong>Landlords applying for verification</strong></td>
                <td>
                  <strong>Special personal information</strong> — identity document;
                  proof of address; proof of the right to let the property.
                </td>
                <td>
                  To confirm a landlord is who they say they are before a tenant
                  is asked to trust them with a deposit (s.11(1)(a), consent;
                  s.27(1)(a)). Documents are deleted on decision, as above.
                </td>
              </tr>
              <tr>
                <td><strong>Previous landlords given as a reference</strong></td>
                <td>Name, mobile number, and the answer they give about a former tenant.</td>
                <td>
                  To confirm a tenant's rental history at the tenant's own request
                  (s.11(1)(f), legitimate interest, the tenant having supplied the
                  details). The referee needs no account. The link expires after
                  14 days and the number is used once, for that purpose only.
                </td>
              </tr>
              <tr>
                <td><strong>Advertisers</strong></td>
                <td>Company name, contact person, business email and telephone number, campaign and billing records.</td>
                <td>
                  To sell, deliver, invoice and report on board advertising
                  (s.11(1)(b), contract). Advertisers receive aggregate impression
                  and click counts for their own campaign and nothing about any
                  individual who saw it.
                </td>
              </tr>
              <tr>
                <td><strong>Website visitors</strong> (not signed in)</td>
                <td>
                  <strong>No personal information.</strong> A single session cookie
                  is set only once a person signs in. Aggregate daily counters
                  record that an event happened, never who caused it — they carry
                  no user identifier, no session identifier, no IP address and no
                  timestamp beyond the date.
                </td>
                <td>
                  To understand where people abandon a task and fix it. No
                  profiling, no behavioural advertising, no third-party analytics
                  and no third-party trackers are used. The counters cannot
                  reconstruct an individual's activity, including by us.
                </td>
              </tr>
              <tr>
                <td><strong>People who report a safety concern</strong></td>
                <td>Contact email (optional), the listing reported and what they say about it.</td>
                <td>
                  To investigate the report and protect other users
                  (s.11(1)(d), legitimate interest of the data subject and the
                  public). A report may be made without an account.
                </td>
              </tr>
              <tr>
                <td><strong>Employees, directors and contractors</strong></td>
                <td>
                  Identity and contact details, banking details for remuneration,
                  tax reference numbers, employment contracts and payroll records.
                </td>
                <td>
                  To administer employment and to meet obligations under the Basic
                  Conditions of Employment Act, the Income Tax Act and the Labour
                  Relations Act (s.11(1)(c), legal obligation).
                </td>
              </tr>
              <tr>
                <td><strong>Suppliers and service providers</strong></td>
                <td>Company name, contact person, business contact details, banking details for settlement, contracts and invoices.</td>
                <td>
                  To procure, pay for and account for services
                  (s.11(1)(b), contract; s.11(1)(c) for tax record-keeping).
                </td>
              </tr>
            </tbody>
          </table>

          <p>
            <strong>Cross-border transfer.</strong> Personal information is
            processed in South Africa and the European Union (database and
            application hosting). Any transfer outside the Republic is made only
            to a jurisdiction with comparable protection or under a written
            agreement imposing equivalent obligations, as section 72 of POPIA
            requires. We do not send user content to third-party artificial
            intelligence services.
          </p>

          <p>
            <strong>Retention.</strong> Account records are kept for as long as
            the account is open and for a reasonable period afterwards;
            transaction records are kept for five years as the Income Tax Act
            and the Companies Act require; verification documents are deleted on
            decision and are never retained.
          </p>
        </section>

        <section>
          <h2>4. How to Submit a Request for Access to Records</h2>
          <ol>
            <li>Complete <strong>Form C</strong> (available at
              <a href="https://www.justice.gov.za/paia/paia.htm" target="_blank" rel="noopener">justice.gov.za/paia</a>)</li>
            <li>Submit to <strong>paia&#64;umastande.co.za</strong></li>
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
