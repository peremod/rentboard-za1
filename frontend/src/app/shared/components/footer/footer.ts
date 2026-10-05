import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
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

        <!-- ── The quick links, audited in Phase 7e ──────────────────────
             Three faults, all of which the nav audit could not see because
             every one of these links resolves to a real route:

             1. "Landlord portal" (/landlord/dashboard) and "My applications"
                (/tenant/dashboard) are behind authGuard, and the footer's main
                reader is a signed-OUT visitor on the public board. They asked
                for a portal and got a login form. Not a 404 — worse, because
                nothing explains it.
             2. Pricing was listed twice, under "For Landlords" and under
                "Business". It addresses a landlord ("free to list, free to
                apply"), so it is in that column once.
             3. A signed-in person was shown "Create account" and "Post a room
                free", which are both sign-up links.

             So each column now says what is true for whoever is reading it.
             Not a second nav: the sidebar is the portal's navigation (see
             PortalLayout), and these are the few destinations worth a footer. -->
        <div class="footer-col">
          <h2>For Landlords</h2>
          <ul>
            @if (auth.isLandlord()) {
              <li><a routerLink="/landlord/dashboard">Your dashboard</a></li>
              <li><a routerLink="/landlord/properties">My properties</a></li>
              <li><a routerLink="/landlord/applicants">All applicants</a></li>
              <li><a routerLink="/landlord/services">Who to call</a></li>
              <li><a routerLink="/templates">Forms and templates</a></li>
            } @else {
              <li><a routerLink="/auth/register">Post a room free</a></li>
              <li><a routerLink="/how-it-works">How it works</a></li>
              <li><a routerLink="/pricing">Pricing</a></li>
              <!-- Phase 8a. In the VISITOR branch too: somebody searching for a
                   lease template is a landlord with rooms and no account yet,
                   which is the point of having it public. -->
              <li><a routerLink="/templates">Free forms and templates</a></li>
            }
          </ul>
        </div>

        <div class="footer-col">
          <h2>For Tenants</h2>
          <ul>
            <li><a routerLink="/">Browse rooms</a></li>
            @if (auth.isAuthenticated() && !auth.isLandlord() && !auth.isAdmin()) {
              <!-- Phase 7a: this said "My applications" and opened the dashboard
                   root, so the one thing it named was the one thing the person
                   then had to go looking for. The portal nav already points at
                   the section; the footer does now too. -->
              <li><a routerLink="/tenant/dashboard" fragment="your-applications">My applications</a></li>
              <li><a routerLink="/tenant/passport">Renter's Passport</a></li>
              <li><a routerLink="/tenant/rent">Rent</a></li>
            } @else if (!auth.isAuthenticated()) {
              <li><a routerLink="/how-it-works">How it works</a></li>
              <li><a routerLink="/auth/register">Create account</a></li>
            } @else {
              <!-- ⚠️ Signed in, but not as a tenant — a landlord or an admin.
                   The first version of this had two branches, so a landlord
                   fell into the visitor one and was offered "Create account":
                   a sign-up link shown to somebody who had already signed up,
                   which is one of the three faults this audit was fixing. A
                   landlord browsing rooms is a real thing (they rent somewhere
                   too), so the column keeps Browse rooms above and says
                   nothing else. -->
              <li><a routerLink="/how-it-works">How it works</a></li>
            }
          </ul>
        </div>

        @if (auth.isAuthenticated()) {
          <!-- Both roles get these, and an admin too: they are account
               surfaces rather than role surfaces, which is why they live in
               /account. Shown only when signed in, because to a visitor they
               are three more links to a login form. -->
          <div class="footer-col">
            <h2>Your account</h2>
            <ul>
              <li><a routerLink="/account/messages">Messages</a></li>
              <li><a routerLink="/account/notices">Notices</a></li>
              <li><a routerLink="/account/settings">Settings</a></li>
            </ul>
          </div>
        } @else {
          <div class="footer-col">
            <h2>Business</h2>
            <ul>
              <li><a routerLink="/advertise">Advertise with us</a></li>
            </ul>
          </div>
        }

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
  /**
   * The footer's links differ for a visitor and for a signed-in account.
   *
   * See the comment above the columns for the three faults that made this
   * necessary. The footer renders on every page, public and guarded, so it is
   * read by both and until Phase 7e it addressed neither correctly.
   */
  readonly auth = inject(AuthService);

  /** Rendered into the copyright line. */
  readonly year = new Date().getFullYear();
}
