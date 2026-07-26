import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Placeholder Home component. Full notice-board UI (hero, search, filters,
 * room grid) lands in the "Browse & Listing" pass — see RentBoard-Sprint2-Code.html
 * for the reference implementation to port in.
 *
 * Links below are real routes (verified against app.routes.ts), not placeholders —
 * this is the seam the 0.2.0 Auth pass needed to prove end-to-end.
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
    </main>
  `,
})
export class Home {}
