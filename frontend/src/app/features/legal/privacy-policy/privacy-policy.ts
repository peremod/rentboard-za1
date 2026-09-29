import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Privacy Policy — POPIA (Protection of Personal Information Act 4 of 2013) compliant.
 *
 * The responsible party is named here as registered at CIPC, and the
 * Information Officer by name as POPIA s.56 requires — it is a person, not a
 * role, and for a private body it is the head of that body by default.
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
          <p class="legal-meta">Last updated: 28 September 2026 · Version 1.1 · Republic of South Africa · POPIA compliant</p>
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
          <p><strong>Information Officer:</strong> Thebeyapelo Modise, Chief Executive Officer · privacy&#64;umastande.co.za</p>
          <p><strong>Registered address:</strong> 16 Mokgatle Street, Kwa Thema, Springs, Gauteng, 1575, South Africa</p>
          <p>Registered with the Information Regulator (South Africa) under
          registration number <strong>2026-067370</strong>.</p>
        </section>

        <section>
          <h2>2. Personal Information We Collect</h2>
          <ul>
            <li><strong>Identity:</strong> full name, ID number (optional), date of birth</li>
            <li><strong>Contact:</strong> email address, phone number</li>
            <li><strong>Account:</strong> hashed password — never stored in plain text</li>
            <li><strong>Listing data:</strong> property details, pricing in ZAR, photographs</li>
            <li><strong>Application data:</strong> employment status, income, cover notes</li>
            <li><strong>Financial:</strong> if you pay the R149 verification fee, your name, email
            address and the amount are passed to <strong>PayFast</strong>, our payment processor, in
            ZAR. You enter your card or banking details on PayFast's own pages — they never reach
            Mastande, and we never store them. This is the only payment we take.</li>
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
              <tr><td>Usage measurement</td><td>Not personal information — daily counts only, no cookie</td></tr>
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
          <h2>6. Who Else Handles Your Information (Operators)</h2>
          <p>We use other companies to run Mastande. Under POPIA they are <strong>Operators</strong>:
          they process your information on our instructions, and we stay responsible for it. We do
          not sell your personal information to anyone, and we do not use it for advertising.</p>
          <table class="legal-table">
            <thead><tr><th>Operator</th><th>What it receives</th><th>Where it is processed</th></tr></thead>
            <tbody>
              <tr>
                <td><strong>PayFast</strong><br/>payments</td>
                <td>Only if you pay the R149 verification fee: your first name, email address, the
                amount, and a reference number. Your card or banking details are entered on
                PayFast's own pages and never reach us.</td>
                <td>South Africa</td>
              </tr>
              <tr>
                <td><strong>Neon</strong><br/>database</td>
                <td>Everything you give us that we store — your account, listings, applications and
                messages.</td>
                <td><strong>Frankfurt, Germany</strong></td>
              </tr>
              <tr>
                <td><strong>Render</strong><br/>application hosting</td>
                <td>Everything the site processes while you use it.</td>
                <td><strong>Frankfurt, Germany</strong></td>
              </tr>
              <tr>
                <td><strong>Vercel</strong><br/>website hosting</td>
                <td>Your IP address and the pages you request.</td>
                <td>Outside South Africa</td>
              </tr>
              <tr>
                <td><strong>ImageKit</strong><br/>photo and document storage</td>
                <td>Room photographs, any identity or supporting document you upload, and any lease
                or related paperwork stored against a tenancy. These go from your browser straight
                to ImageKit. Documents are stored privately and are not publicly viewable; opening
                one uses a link that expires.
                <br/><br/>
                <strong>Identity and supporting documents are deleted from storage once reviewed</strong>
                — only the outcome is kept (POPIA s.26). Deletion is retried until it is confirmed by
                the storage provider, and we record the outcome rather than assuming it.
                <br/><br/>
                <strong>A lease is different and is kept</strong>, because both you and the other
                party need it for as long as the agreement can be disputed — deleting the only copy
                of what you agreed would be the harm, not the protection. Only the two parties to
                the tenancy can open it; we do not read it, and our staff cannot. Whoever uploaded a
                document can remove it at any time, which deletes the file itself.</td>
                <td>Outside South Africa</td>
              </tr>
              <tr>
                <td><strong>Resend</strong><br/>email delivery</td>
                <td>Your email address and name, and the contents of emails we send you.</td>
                <td>Outside South Africa</td>
              </tr>
              <tr>
                <td><strong>Meta Platforms</strong><br/>WhatsApp messages</td>
                <td>Only if you use WhatsApp with us: your phone number and the contents of those
                messages.</td>
                <td>Outside South Africa</td>
              </tr>
              <tr>
                <td><strong>Google</strong><br/>sign-in</td>
                <td>Only if you choose to sign in with Google: Google tells us your email address,
                name and profile photo, and Google learns that you signed in to Mastande. We ask
                for nothing else from your Google account.</td>
                <td>Outside South Africa</td>
              </tr>
            </tbody>
          </table>
          <p><strong>Information sent outside South Africa (POPIA s.72).</strong> As the table shows,
          most of these operators process your information outside the country — our database and
          application servers are in Frankfurt, Germany. We use them under their standard data
          protection terms, which require them to protect your information and to process it only
          on our instructions. If you would like details of the safeguards that apply, email
          <strong>privacy&#64;umastande.co.za</strong>.</p>
        </section>

        <section>
          <h2>7. Information Regulator</h2>
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
