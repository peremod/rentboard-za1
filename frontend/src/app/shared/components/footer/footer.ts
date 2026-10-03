import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../pipes/translate.pipe';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="footer">
      <div class="footer-inner">
        <div>
          <a class="footer-logo" routerLink="/">Mas<span>tande</span></a>
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
          <h2>For Landlords</h2>
          <ul>
            <li><a routerLink="/auth/register">Post a room free</a></li>
                        <li><a routerLink="/how-it-works">How it works</a></li>
            <li><a routerLink="/pricing">Pricing</a></li>
            <li><a routerLink="/landlord/dashboard">Landlord portal</a></li>
          </ul>
        </div>

        <div class="footer-col">
          <h2>For Tenants</h2>
          <ul>
            <li><a routerLink="/">Browse rooms</a></li>
            <!-- Phase 7a: this said "My applications" and opened the dashboard
                 root, so the one thing it named was the one thing the person
                 then had to go looking for. The portal nav already points at
                 the section; the footer does now too. -->
            <li><a routerLink="/tenant/dashboard" fragment="your-applications">My applications</a></li>
            <li><a routerLink="/auth/register">Create account</a></li>
          </ul>
        </div>

        <div class="footer-col">
          <h2>Business</h2>
          <ul>
            <li><a routerLink="/advertise">Advertise with us</a></li>
            <li><a routerLink="/pricing">Pricing</a></li>
          </ul>
        </div>

        <div class="footer-col">
          <!-- The only part of the footer the bundles carry translations for,
               and nothing had ever read them. These five links are on every
               page of the site. -->
          <h2>{{ 'nav.legal' | translate }}</h2>
          <ul>
            <li><a routerLink="/legal/privacy">{{ 'footer.privacy' | translate }}</a></li>
            <li><a routerLink="/legal/terms">{{ 'footer.terms' | translate }}</a></li>
            <li><a routerLink="/legal/disclaimer">{{ 'footer.disclaimer' | translate }}</a></li>
            <li><a routerLink="/legal/cookies">{{ 'footer.cookies' | translate }}</a></li>
            <li><a routerLink="/legal/paia">{{ 'footer.paia' | translate }}</a></li>
            <!-- Phase 6's page, missing from here until the Phase 7a audit
                 looked: a tenant who read it once while deciding on a room had
                 no way back to it.

                 English in every locale, deliberately. The other five labels in
                 this column are among the 46 translated keys; af.json and
                 zu.json hold exactly those 46 and nothing else, so adding a key
                 means adding a translation to both. "Onderverhuring" is sound
                 Afrikaans and I am not confident enough of the isiZulu to put
                 it in front of a person deciding where to live — this project
                 already holds eight locales back for that reason rather than
                 shipping guesses. It reads as English here, which is what every
                 other untranslated string in the app does. -->
            <li><a routerLink="/legal/sublet">Sub-letting</a></li>
          </ul>
        </div>
      </div>

      <div class="footer-bottom">
        <div>
          &copy; {{ year }} Umastande (Pty) Ltd · CIPC Reg No. 2026/757331/07<br/>
          Mastande is an intermediary platform — not an estate agent (PPRA).
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
