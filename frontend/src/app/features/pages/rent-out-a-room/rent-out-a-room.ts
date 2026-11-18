import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../../shared/components/icon/icon';

/**
 * Landlord-acquisition content pillar — "How to rent out a room in South Africa".
 *
 * ── Why this page exists (SEO/AEO)
 *
 * The strategy named landlord acquisition as the highest-ROI, lowest-competition
 * content: real intent ("how to rent out a room", "advertise a room for free",
 * "find a tenant", "tenant screening south africa") that portals do not answer
 * well, mapped to pages Mastande can make genuinely useful. This is the one
 * flagship guide for that cluster — deliberately one substantial, answer-first
 * page rather than several thin ones, which is the doorway pattern the audit
 * forbids. Each H2 is a question and its first sentence answers it, so an answer
 * engine can lift a complete answer.
 *
 * ── The lines it must hold (every claim here is true on the site or in law)
 *
 * Free to list, free to apply, no estate agent, no commission. Mastande holds no
 * deposit and no rent and is not a party to any lease — the deposit and lease
 * sections say so on screen. The legal content is general information sourced to
 * the Rental Housing Act 50 of 1999, NOT legal advice, and it links the
 * disclaimer that says as much; the templates are described the same way. No
 * claim is made about how many languages the site is translated into (only three
 * are), and nothing here implies Mastande vets every listing or person.
 *
 * ── No page-level JSON-LD
 *
 * The site Organization/WebSite graph is emitted app-wide and appears here too.
 * No FAQPage is emitted: that schema over content whose legal parts are not
 * attorney-reviewed is exactly what the audit declined. The answer-first prose
 * is the AEO play; the schema would add risk, not eligibility.
 */
@Component({
  selector: 'app-rent-out-a-room',
  standalone: true,
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legal-page">
      <div class="legal-container">
        <header class="legal-header">
          <h1>How to rent out a room in South Africa</h1>
          <p class="legal-meta">A free, step-by-step guide for landlords and sub-lessors</p>
          <p>
            Renting out a room on Mastande is free: you post the room yourself,
            tenants apply free, and there is no estate agent and no commission on
            the tenancy. This guide covers what to charge, how to prepare and
            describe the room, how to choose a tenant safely, and what the law
            expects of the lease and the deposit. It is general information, not
            legal advice — see the
            <a routerLink="/legal/disclaimer">platform disclaimer</a>.
          </p>
        </header>

        <section>
          <h2>Is it free to list a room?</h2>
          <p>
            Yes. Listing is free for a landlord — the first rooms cost nothing to
            post — with paid plans only for larger portfolios. Tenants apply free,
            always, and Mastande earns no commission on any tenancy. See
            <a routerLink="/pricing">Pricing</a> for the plans, and
            <a routerLink="/how-it-works">How Mastande works</a> for the steps
            end to end. A sub-lessor letting a room with the owner's permission
            lists exactly as a landlord does, and it is just as free — see
            <a routerLink="/legal/sublet">sub-letting</a> for what to tell an
            applicant.
          </p>
        </section>

        <section>
          <h2>How much should you charge for a room?</h2>
          <p>
            Set the rent against what comparable rooms in the same area are asking,
            then adjust for what yours includes. The quickest way to gauge the
            local rate is to <a routerLink="/">browse rooms</a> in your suburb and
            filter by room type. Price in Rand per month, and state plainly:
          </p>
          <ul>
            <li>Whether water, electricity and Wi-Fi are included or billed separately.</li>
            <li>The deposit you ask for, usually one month's rent.</li>
            <li>What the room shares — bathroom, kitchen, yard — and how many people.</li>
            <li>Any rules that affect who it suits: couples, pets, smoking, visitors.</li>
          </ul>
          <p>
            An honest, specific price attracts the right applicants and cuts the
            back-and-forth. A room priced well above the area rarely gets replies.
          </p>
        </section>

        <section>
          <h2>How do you prepare a room before listing it?</h2>
          <p>
            Clean it, clear it, and fix the small things a viewer will notice. A
            room that shows well lets faster and holds a better tenant:
          </p>
          <ul>
            <li>Repair anything broken — a door that does not lock, a dripping tap, a dead globe.</li>
            <li>Make sure the room is private and secure, with a working lock on the door.</li>
            <li>Agree the house rules with anyone already living there before a new person moves in.</li>
            <li>Take photos in daylight, with the curtains open, after tidying — this is the single biggest thing that gets replies.</li>
          </ul>
        </section>

        <section>
          <h2>How do you write a listing that gets replies?</h2>
          <p>
            Describe the room honestly and say who it would suit. Tenants scrolling
            a board are deciding in seconds, so the listing that is specific and
            truthful wins:
          </p>
          <ul>
            <li>Add several clear photos — the room, the shared spaces, the outside of the house.</li>
            <li>Say where it is (suburb and nearest transport), the rent, the deposit and what bills are included.</li>
            <li>Describe the household and the kind of tenant who would fit in.</li>
            <li>Get verified. A once-off identity check puts a verified badge on your listings, and tenants wary of scams treat it as the clearest sign you are real.</li>
          </ul>
          <p>
            You can <a routerLink="/auth/register">post a room free</a> in a few
            minutes, and relist it in one click when a tenant moves on.
          </p>
        </section>

        <section>
          <h2>How do you find and screen a tenant safely?</h2>
          <p>
            Shortlist from the applications, meet people in person, and ask for
            what you need to decide — without collecting more than you will use.
            A sensible, lawful screening looks like this:
          </p>
          <ul>
            <li>Read the cover notes, shortlist the applicants who fit, and arrange viewings.</li>
            <li>Meet at the property in daylight, and trust how someone treats the viewing.</li>
            <li>Ask for identity and, where relevant, proof of income or a reference — a tenant can share a Renter's Passport on Mastande rather than loose documents.</li>
            <li>Choose the tenant yourself and tell the others politely. You are never obliged to accept anyone.</li>
          </ul>
          <p>
            <app-icon name="alert"/> Mastande does not vet every listing or every
            person; verification and the Renter's Passport are offered where each
            side chooses them. Keep the arrangement on the platform until you have
            met and are satisfied.
          </p>
        </section>

        <section>
          <h2>What does the law expect of the lease and the deposit?</h2>
          <p>
            Put the agreement in writing and handle the deposit the way the Rental
            Housing Act 50 of 1999 requires. In general terms under that Act:
          </p>
          <ul>
            <li>A tenant may ask for the lease in writing, and a written lease protects you both.</li>
            <li>The deposit must be held in an interest-bearing account, and the interest belongs to the tenant.</li>
            <li>After the tenant leaves you inspect the room and refund the deposit, with interest and less the cost of any damage beyond fair wear, within the period the Act sets.</li>
            <li>A joint incoming and outgoing inspection is what lets you deduct fairly and prove it later.</li>
          </ul>
          <p>
            Free starting-point <a routerLink="/templates">forms and templates</a>
            are on Mastande. They are general templates, not legal advice and not
            attorney-reviewed — have anything that matters checked for your
            situation. <strong>Mastande holds no deposit and no rent, and is not a
            party to your lease.</strong> Any money and any signature are between
            you and your tenant.
          </p>
        </section>

        <section>
          <h2>What Mastande is — and is not</h2>
          <p>
            Mastande is an online notice board under ECTA 25 of 2002. It is
            <strong>not</strong> a PPRA-registered estate agent and earns no
            commission; it does <strong>not</strong> hold deposits or rent, and it
            is not a party to any lease. For the full position, and the Rental
            Housing Tribunal contacts for each province, see the
            <a routerLink="/legal/disclaimer">disclaimer</a> and
            <a routerLink="/about">about page</a>.
          </p>
        </section>

        <div class="hiw-cta">
          <a routerLink="/auth/register" class="btn btn-primary btn-lg">Post a room free →</a>
          <a routerLink="/how-it-works" class="btn btn-outline btn-lg">How it works</a>
        </div>
      </div>
    </div>
  `,
  styles: ``,
})
export class RentOutARoom {}
