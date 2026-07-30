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
              <tr><td>Strictly necessary</td><td>Login sessions, security, core site function</td><td>No — cannot be disabled</td></tr>
              <tr><td>Analytics</td><td>Understand how RentBoard is used, improve the platform</td><td>Yes</td></tr>
              <tr><td>Partner / referral</td><td>Track referrals to broadband/insurance/removals partners</td><td>Yes</td></tr>
            </tbody>
          </table>
        </section>
        <section>
          <h2>2. Your Choices</h2>
          <p>The consent banner on every first visit lets you accept all, reject all optional cookies, or customise
          per category — rejecting is exactly as easy as accepting, per Information Regulator guidance. You can
          change your choice at any time; your preference is re-asked after 365 days or when this policy changes.</p>
        </section>
      </div>
    </div>
  `,
})
export class Cookies {}
