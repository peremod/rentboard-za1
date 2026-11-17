import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../../shared/components/icon/icon';

/**
 * About Mastande — the entity page.
 *
 * ── Why this page exists (SEO/AEO/GEO)
 *
 * Search engines and AI answer engines both ask one plain question of a site:
 * what is this, who runs it, who is it for, where does it operate. Before this
 * page the only machine-readable answer was the Organization/WebSite JSON-LD in
 * core/seo/site-identity.ts; there was no human-readable page stating it. This
 * is that page.
 *
 * Every claim here is verifiable on the site or in law — ECTA, the PPRA
 * position and the "not an agent / holds no money" stance are the disclaimer's,
 * the pricing is the pricing page's, the company name is the legal pages'.
 * Nothing is invented: no address, no phone, no founding date, no statistics,
 * no superlatives. That is deliberate — the same discipline site-identity.ts
 * applies to the structured data, applied to the prose a person reads.
 */
@Component({
  selector: 'app-about',
  standalone: true,
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legal-page">
      <div class="legal-container">
        <header class="legal-header">
          <h1>About Mastande</h1>
          <p class="legal-meta">Umastande (Pty) Ltd · Republic of South Africa</p>
          <p>
            Mastande is a South African notice board for letting rooms directly —
            no estate agent, and no commission. People with a room to let post it
            themselves; people looking for a room browse, filter and apply. It is
            operated by Umastande (Pty) Ltd.
          </p>
        </header>

        <section>
          <h2>Who Mastande is for</h2>
          <ul>
            <li>Tenants looking for a room, a cottage or a place in a shared home.</li>
            <li>Landlords letting out rooms — from a single back room to several.</li>
            <li>
              Sub-lessors: a tenant letting a room with the owner's permission. A
              sub-lessor listing a room is treated as a landlord listing a room,
              and it is just as free.
            </li>
          </ul>
        </section>

        <section>
          <h2>What it costs</h2>
          <p>
            Browsing is free. Applying is free, always. Listing is free for a
            landlord — the first rooms cost nothing to post, with paid plans only
            for larger portfolios. There is no application fee and no agent
            commission on any tenancy.
          </p>
          <p>
            See <a routerLink="/pricing">Pricing</a> for the plans, and
            <a routerLink="/how-it-works">How Mastande works</a> for the steps.
          </p>
        </section>

        <section>
          <h2>What Mastande is — and is not</h2>
          <ul>
            <li>It is an online intermediary under <strong>ECTA 25 of 2002</strong>.</li>
            <li>
              It is <strong>not</strong> a PPRA-registered estate agent, and earns
              no commission on any tenancy.
            </li>
            <li>
              It does <strong>not</strong> hold deposits or rent, and is not a
              party to any lease. The rent tracker is a landlord's own record, and
              nothing is signed on Mastande that carries legal effect.
            </li>
            <li>
              Identity checks are offered where a tenant or landlord chooses them —
              the Renter's Passport for tenants, verification for landlords — but
              Mastande does not vet every listing or person.
            </li>
          </ul>
          <p>
            <app-icon name="alert"/> For your safety, always view a room in person
            before paying anything. The
            <a routerLink="/legal/disclaimer">platform disclaimer</a> explains
            your rights and lists the Rental Housing Tribunal contacts for each
            province.
          </p>
        </section>

        <section>
          <h2>Where it works, and in which languages</h2>
          <p>
            Mastande serves the whole of South Africa and is available in eleven
            languages, so a room can be posted and read in the language the people
            letting and renting it actually speak.
          </p>
        </section>

        <section>
          <h2>How people use it</h2>
          <p>
            <strong>Tenants</strong> browse rooms, apply free, hear back from the
            person letting the room, and arrange to view and move in.
            <strong>Landlords</strong> post a room in a few minutes, receive
            applications, and choose a tenant themselves. The full walkthrough is
            on <a routerLink="/how-it-works">How Mastande works</a>.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            Report a suspicious listing to safety&#64;umastande.co.za, or the SAPS
            on 10111. Our <a routerLink="/legal/privacy">privacy policy</a>,
            <a routerLink="/legal/terms">terms</a> and
            <a routerLink="/legal/paia">PAIA manual</a> set out how we handle
            information and who we are.
          </p>
        </section>
      </div>
    </div>
  `,
})
export class About {}
