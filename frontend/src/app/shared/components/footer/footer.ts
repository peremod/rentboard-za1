import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="footer">
      <div class="footer__inner">
        <div>
          <div class="footer__logo">Rent<span>Board</span></div>
          <p>South Africa's dedicated room-letting notice board. Direct from landlords — no agent fees, ever.</p>
          <p class="footer__popia">🔒 POPIA Compliant · Rental Housing Act 50 of 1999 aligned · All prices in ZAR</p>
        </div>
        <div>
          <h4>Legal</h4>
          <ul>
            <li><a routerLink="/legal/privacy">Privacy (POPIA)</a></li>
            <li><a routerLink="/legal/terms">Terms &amp; Conditions</a></li>
            <li><a routerLink="/legal/disclaimer">Disclaimer</a></li>
            <li><a routerLink="/legal/cookies">Cookie Policy</a></li>
            <li><a routerLink="/legal/paia">PAIA Manual</a></li>
          </ul>
        </div>
        <div>
          <h4>Account</h4>
          <ul>
            <li><a routerLink="/auth/register">Create account</a></li>
            <li><a routerLink="/auth/login">Log in</a></li>
          </ul>
        </div>
      </div>
      <div class="footer__bottom">
        RentBoard is an intermediary platform — not a registered estate agent under the Property Practitioners Act 22 of 2019.
        All rentals are private agreements between landlords and tenants.
      </div>
    </footer>
  `,
  styles: [`
    .footer { background: #1A1410; color: rgba(255,255,255,.7); margin-top: 3rem; }
    .footer__inner { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 2rem; padding: 2.5rem 1.25rem 1.5rem; }
    .footer__logo { font-family: 'Playfair Display', serif; font-size: 1.3rem; font-weight: 900; color: #F5F0E8; margin-bottom: .5rem; }
    .footer__logo span { color: #C04E28; }
    .footer p { font-size: .82rem; line-height: 1.7; margin-bottom: .5rem; }
    .footer__popia { font-size: .72rem; color: rgba(255,255,255,.4); }
    .footer h4 { color: #F5F0E8; font-size: .75rem; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: .75rem; }
    .footer ul { list-style: none; }
    .footer ul li { margin-bottom: .4rem; }
    .footer ul li a { color: rgba(255,255,255,.6); text-decoration: none; font-size: .82rem; }
    .footer ul li a:hover { color: #F5F0E8; }
    .footer__bottom { border-top: 1px solid rgba(255,255,255,.08); max-width: 1200px; margin: 0 auto; padding: 1rem 1.25rem; font-size: .72rem; color: rgba(255,255,255,.35); line-height: 1.7; }
    @media (max-width: 768px) { .footer__inner { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 480px) { .footer__inner { grid-template-columns: 1fr; } }
  `],
})
export class Footer {}
