import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="footer">
      <div class="footer-inner">
        <div>
          <a class="footer-logo" routerLink="/">Rent<span>Board</span></a>
          <p class="footer-desc">
            South Africa's dedicated room-letting notice board. Find rooms direct from
            landlords — no estate agent, no fees to apply.
          </p>
          <p class="footer-popia">
            🔒 POPIA Compliant · Information Officer registered with the Information Regulator<br/>
            Rental Housing Act 50 of 1999 aligned · ECTA 25 of 2002 compliant
          </p>
        </div>

        <div class="footer-col">
          <h4>For Landlords</h4>
          <ul>
            <li><a routerLink="/auth/register">Post a room free</a></li>
                        <li><a routerLink="/how-it-works">How it works</a></li>
            <li><a routerLink="/pricing">Pricing</a></li>
            <li><a routerLink="/landlord/dashboard">Landlord portal</a></li>
          </ul>
        </div>

        <div class="footer-col">
          <h4>For Tenants</h4>
          <ul>
            <li><a routerLink="/">Browse rooms</a></li>
            <li><a routerLink="/tenant/dashboard">My applications</a></li>
            <li><a routerLink="/auth/register">Create account</a></li>
          </ul>
        </div>

        <div class="footer-col">
          <h4>Business</h4>
          <ul>
            <li><a routerLink="/advertise">Advertise with us</a></li>
            <li><a routerLink="/pricing">Pricing</a></li>
          </ul>
        </div>

        <div class="footer-col">
          <h4>Legal</h4>
          <ul>
            <li><a routerLink="/legal/privacy">Privacy Policy (POPIA)</a></li>
            <li><a routerLink="/legal/terms">Terms &amp; Conditions</a></li>
            <li><a routerLink="/legal/disclaimer">Disclaimer</a></li>
            <li><a routerLink="/legal/cookies">Cookie Policy</a></li>
            <li><a routerLink="/legal/paia">PAIA Manual</a></li>
          </ul>
        </div>
      </div>

      <div class="footer-bottom">
        <div>
          &copy; {{ year }} [YOUR COMPANY NAME] (Pty) Ltd · CIPC Reg No. [NUMBER]<br/>
          RentBoard is an intermediary platform — not an estate agent (PPRA).
          Not registered under the Property Practitioners Act 22 of 2019.
        </div>
        <div style="text-align:right;line-height:1.8">
          <a href="https://www.inforegulator.org.za" target="_blank" rel="noopener">Information Regulator ↗</a><br/>
          <span>All prices in South African Rand (ZAR)</span>
        </div>
      </div>
    </footer>
  `,
})
export class Footer {
  /** Rendered into the copyright line. */
  readonly year = new Date().getFullYear();
}
