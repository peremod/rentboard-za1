import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * The sub-letting disclaimer — Phase 6.
 *
 * ── Written from scratch, and that was an instruction
 *
 * The brief says in terms: do not treat this as boilerplate to copy from the
 * existing landlord disclaimer. The two cover different risks and different
 * people. The landlord disclaimer says we are not an estate agent and do not
 * vet listings; this one says something sharper and more specific — that the
 * person letting you this room may not be allowed to, that we cannot tell you
 * whether they are, and that if they are not, the loss falls on you and not on
 * us.
 *
 * ── Addressed to the applicant, not to our own liability
 *
 * Also an instruction, and the right one. A disclaimer written to protect the
 * platform tells somebody nothing they can act on. So each section answers a
 * question an applicant would actually ask: what could go wrong, what happens
 * to my deposit, what should I ask for, who do I phone. The liability sentence
 * is there, once, and it is not the point of the page.
 *
 * ⚠️ NOT attorney-reviewed yet. `docs/OUTSTANDING.md` §8 carries this — it goes
 * to the same South African attorney as the other legal pages, as its own item,
 * because the Rental Housing Act and the common law on sub-letting are not
 * something to paraphrase from memory. Nothing on this page is presented as
 * legal advice and the two statutory references below are the ones the rest of
 * the site already relies on.
 */
@Component({
  selector: 'app-sublet',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legal-page">
      <div class="legal-container">
        <header class="legal-header">
          <h1>Renting a room from a tenant (sub-letting)</h1>
          <p class="legal-meta">Last updated: 3 October 2026 · Republic of South Africa</p>
          <div class="disclaimer-banner">
            ⚠️ Some rooms on Mastande are let by a <strong>tenant</strong>, not by the owner.
            Mastande does <strong>not</strong> confirm or guarantee that such a person is
            legally allowed to sublet. If they are not, the person who loses the room and
            the money is <strong>you</strong>.
          </div>
        </header>

        <section>
          <h2>1. What "sub-letting" means here</h2>
          <p>
            A sub-lessor is somebody who rents a place from an owner and then lets out a
            room in it to somebody else. This is common and often completely legitimate —
            a three-bedroom flat shared by three working people usually has one name on the
            lease and two housemates who pay that person.
          </p>
          <p>
            Every listing of this kind on Mastande is marked <strong>"Sublet by a
            tenant"</strong> on the room page. If a listing does not carry that mark, the
            person letting it has told us they are the owner or hold the owner's mandate.
          </p>
        </section>

        <section>
          <h2>2. What can go wrong</h2>
          <p>
            Most South African leases either forbid sub-letting outright or allow it only
            with the landlord's written consent. If your sub-lessor does not have that
            consent, three things can follow, and they can follow quickly:
          </p>
          <ul>
            <li>
              <strong>You can be told to leave.</strong> You have no agreement with the
              owner, so the owner is not obliged to house you. In practice this can mean
              weeks, not months.
            </li>
            <li>
              <strong>Your deposit can be hard to recover.</strong> You paid the
              sub-lessor, not the owner. If they disappear or cannot pay it back, there is
              nobody else holding it.
            </li>
            <li>
              <strong>The whole household can be evicted at once</strong> if the head lease
              is cancelled for breaching it — including the people who did nothing wrong.
            </li>
          </ul>
        </section>

        <section>
          <h2>3. What Mastande does and does not check</h2>
          <p>
            A sub-lessor can submit their lease and either the clause permitting
            sub-letting or their landlord's written consent. When an administrator has
            looked at those documents, the room page says so, with the date:
            <em>"Lease and consent to sublet checked on 14 March 2026"</em>.
          </p>
          <p>That sentence means exactly what it says, and no more:</p>
          <ul>
            <li>We saw documents that appeared to be a lease and a consent for this address.</li>
            <li>We did <strong>not</strong> phone the owner to confirm it.</li>
            <li>We cannot know whether consent was withdrawn the day after we looked.</li>
            <li>
              We do <strong>not</strong> guarantee that the right to sublet is valid, and
              nothing on this platform should be read as such a guarantee.
            </li>
          </ul>
          <p>
            Where the room page says nothing about a check, no documents have been
            submitted. That is not an accusation — most listings have not been checked —
            but it does mean you have only the sub-lessor's word.
          </p>
        </section>

        <section>
          <h2>4. What to ask for before you pay anything</h2>
          <p>Ask for these in writing, and keep them. A sub-lessor acting honestly will not mind.</p>
          <ul>
            <li>
              <strong>Their lease</strong>, or at least the page showing the clause about
              sub-letting, and the owner's or agent's name.
            </li>
            <li>
              <strong>The owner's written consent</strong>, naming this address. A WhatsApp
              message from the owner is better than nothing, and far better than "it's fine".
            </li>
            <li>
              <strong>A written sub-lease</strong> between you and them: the rent, what it
              includes, the deposit, the notice period, and what happens to your deposit if
              their own lease ends first.
            </li>
            <li>
              <strong>How long their lease still has to run.</strong> Your room cannot
              outlast it. If their lease ends in four months, treat four months as the
              longest you can rely on.
            </li>
          </ul>
          <p>
            <strong>Never pay a deposit before viewing the room in person</strong>, and be
            cautious of anyone who wants money before you have seen the place or met the
            people already living there.
          </p>
        </section>

        <section>
          <h2>5. Your deposit</h2>
          <p>
            The Rental Housing Act 50 of 1999 requires a deposit to be held in an
            interest-bearing account and returned with interest, less what is properly
            owed. That duty falls on the person you paid — your sub-lessor. Ask them, in
            writing, where your deposit is held.
          </p>
          <p>
            Mastande never holds, collects or releases deposits or rent. We are an online
            intermediary under ECTA 25 of 2002 and are not a party to your agreement.
          </p>
        </section>

        <section>
          <h2>6. If something goes wrong</h2>
          <p>
            A dispute with a sub-lessor is a rental housing dispute, and the Rental Housing
            Tribunal in your province hears it for free. You do not need a lawyer and you
            do not need the owner's permission to approach them.
          </p>
          <table class="legal-table">
            <thead><tr><th>Where</th><th>Contact</th></tr></thead>
            <tbody>
              <tr><td>Gauteng Rental Housing Tribunal</td><td>011 355 4000</td></tr>
              <tr><td>Western Cape</td><td>021 483 5020</td></tr>
              <tr><td>KwaZulu-Natal</td><td>031 336 5300</td></tr>
              <tr><td>Eastern Cape</td><td>040 609 3200</td></tr>
              <tr><td>Legal Aid SA (all provinces, free)</td><td>0800 110 110</td></tr>
              <tr><td>SAPS (emergency)</td><td>10111</td></tr>
            </tbody>
          </table>
          <p>
            If you believe a listing is dishonest about who is letting it, report it from
            the room page or email safety&#64;umastande.co.za. We read every report.
          </p>
        </section>

        <section>
          <h2>7. If you are the one sub-letting</h2>
          <p>
            Check your own lease before you list a room. If it requires your landlord's
            consent, get it in writing first — you are the one who loses their home if the
            head lease is cancelled, and you would be taking somebody else's deposit on a
            promise you could not keep.
          </p>
          <p>
            Submitting your lease and consent for a check is <strong>free</strong>. There is
            no fee to list a room on Mastande, and there is no fee for this check either.
          </p>
        </section>

        <p class="legal-meta">
          This page explains how Mastande treats sub-let listings. It is not legal advice.
          See also the <a routerLink="/legal/disclaimer">platform disclaimer</a> and the
          <a routerLink="/legal/terms">terms</a>.
        </p>
      </div>
    </div>
  `,
})
export class Sublet {}
