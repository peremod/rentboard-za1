import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Placeholder Home component for the foundation release.
 * Full notice-board UI (hero, search, filters, room grid) lands in the
 * "Part 2 — Browse & Listing" build pass; see RentBoard-Sprint2-Code.html
 * for the reference implementation to port in.
 */
@Component({
  selector: 'app-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main style="font-family:sans-serif;padding:2rem;max-width:640px;margin:0 auto">
      <h1>RentBoard 🇿🇦</h1>
      <p>South Africa's room-letting notice board — direct from landlords, no agent fees.</p>
      <p><em>Foundation build. Notice board UI ships in the next pass.</em></p>
    </main>
  `,
})
export class Home {}
