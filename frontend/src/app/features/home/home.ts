import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Placeholder Home component. Full notice-board UI (hero, search, filters,
 * room grid) lands in the "Browse & Listing" pass — see RentBoard-Sprint2-Code.html
 * for the reference implementation to port in.
 *
 * All links below are real, verified routes (see app.routes.ts / legal.routes.ts),
 * standing in for the eventual navbar + footer until the UI/CI-CD pass lands.
 */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main style="font-family:sans-serif;padding:2rem;max-width:640px;margin:0 auto">
      <h1>RentBoard 🇿🇦</h1>
      <p>South Africa's room-letting notice board — direct from landlords, no agent fees.</p>
      <p>
        <a routerLink="/auth/login">Log in</a>
        &nbsp;·&nbsp;
        <a routerLink="/auth/register">List a room / find a room — get started free</a>
      </p>
      <p><em>Foundation build. Notice board UI ships in the next pass.</em></p>

      <footer style="margin-top:3rem;padding-top:1rem;border-top:1px solid #DDD5C8;font-size:.78rem;color:#7A6E60">
        <p>
          <a routerLink="/legal/privacy">Privacy (POPIA)</a> ·
          <a routerLink="/legal/terms">Terms &amp; Conditions</a> ·
          <a routerLink="/legal/disclaimer">Disclaimer</a> ·
          <a routerLink="/legal/cookies">Cookie Policy</a> ·
          <a routerLink="/legal/paia">PAIA Manual</a>
        </p>
        <p>RentBoard is an intermediary platform — not a registered estate agent under the Property Practitioners Act 22 of 2019.</p>
      </footer>
    </main>
  `,
})
export class Home {}
