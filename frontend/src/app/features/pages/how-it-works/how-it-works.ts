import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * How it works. Structure follows the visual spec's two-audience layout
 * (tenants, then landlords), with the safety guidance from the disclaimer
 * carried through — a tenant reading this page is the one most likely to be
 * about to pay a deposit to a stranger.
 */
@Component({
  selector: 'app-how-it-works',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" style="background:var(--ink);padding-bottom:3rem">
      <div class="section-inner">
        <div class="section-eyebrow" style="color:var(--terra2)">How Mastande works</div>
        <h1 class="section-title" style="color:var(--cream)">
          Simple for landlords.<br/>Simple for tenants.
        </h1>
        <p class="hero-sub">
          No estate agents, no application fees. Rooms posted directly by the people letting them.
        </p>
      </div>
    </section>

    <div class="section" style="padding-top:2.5rem">
      <div class="section-inner">
        <p class="hiw-audience">For tenants</p>
        <div class="hiw-grid">
          <div class="hiw-step">
            <div class="hiw-num">01</div><div class="hiw-icon">🔍</div>
            <div class="hiw-title">Browse rooms</div>
            <div class="hiw-desc">
              Search by city, suburb, price and room type. Filter for bills included,
              SASSA accepted, couples or pets welcome.
            </div>
          </div>
          <div class="hiw-step">
            <div class="hiw-num">02</div><div class="hiw-icon">🔔</div>
            <div class="hiw-title">Set an alert</div>
            <div class="hiw-desc">
              Rooms are often taken within days. Save your search and we'll email you
              the moment a matching room is listed.
            </div>
          </div>
          <div class="hiw-step">
            <div class="hiw-num">03</div><div class="hiw-icon">📝</div>
            <div class="hiw-title">Apply free</div>
            <div class="hiw-desc">
              A short cover note is all it takes. No CV, no application fee — free to
              apply, always.
            </div>
          </div>
          <div class="hiw-step">
            <div class="hiw-num">04</div><div class="hiw-icon">💬</div>
            <div class="hiw-title">Talk directly</div>
            <div class="hiw-desc">
              Message the landlord on Mastande, arrange a viewing, and agree a
              move-in date between you.
            </div>
          </div>
        </div>

        <aside class="hiw-safety">
          <h2>Before you pay anything</h2>
          <p>
            Mastande does not verify that a room exists or that a landlord may let it.
            Protect yourself:
          </p>
          <ul>
            <li><strong>View the room in person first.</strong> Never pay a deposit for a room you have not seen.</li>
            <li>Ask for proof the landlord owns the property or is permitted to let it.</li>
            <li>Insist on a written lease. Your deposit must be held in an interest-bearing account
                and returned within 14 days of you leaving (Rental Housing Act 50 of 1999).</li>
            <li>Anyone demanding money before a viewing is the clearest sign of a scam.
                Use the report button on the listing, or SAPS on <strong>10111</strong>.</li>
          </ul>
          <p class="hiw-safety-note">
            Free help with rental disputes: your provincial Rental Housing Tribunal, or
            Legal Aid SA on <strong>0800 110 110</strong>.
          </p>
        </aside>

        <div class="divider"></div>

        <p class="hiw-audience">For landlords</p>
        <div class="hiw-grid">
          <div class="hiw-step">
            <div class="hiw-num">01</div><div class="hiw-icon">📸</div>
            <div class="hiw-title">List your room free</div>
            <div class="hiw-desc">
              Add photos, set your rent in Rand, and describe the house and who would
              suit it. Takes a few minutes. No listing fee.
            </div>
          </div>
          <div class="hiw-step">
            <div class="hiw-num">02</div><div class="hiw-icon">🪪</div>
            <div class="hiw-title">Get verified</div>
            <div class="hiw-desc">
              A once-off check puts a verified badge on your listings. Tenants are wary
              of scams, and it is the clearest signal you are real.
            </div>
          </div>
          <div class="hiw-step">
            <div class="hiw-num">03</div><div class="hiw-icon">⭐</div>
            <div class="hiw-title">Shortlist and choose</div>
            <div class="hiw-desc">
              Review applicants, shortlist the ones you like, arrange viewings, and
              accept the right tenant. Everyone else is told politely.
            </div>
          </div>
          <div class="hiw-step">
            <div class="hiw-num">04</div><div class="hiw-icon">🔁</div>
            <div class="hiw-title">Relist in one click</div>
            <div class="hiw-desc">
              When a tenant moves on, relist the same room instantly. Photos and details
              are kept; the old applications are closed out cleanly.
            </div>
          </div>
        </div>

        <div class="hiw-cta">
          <a routerLink="/auth/register" class="btn btn-primary btn-lg">Get started free →</a>
          <a routerLink="/" class="btn btn-outline btn-lg">Browse rooms</a>
        </div>
      </div>
    </div>
  `,
})
export class HowItWorks {}
