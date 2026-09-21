import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Pricing.
 *
 * The model is deliberately simple and NOT the three-tier table in the visual
 * spec, which predates the decision: listing is free for landlords, applying is
 * free for tenants, and the only charge is a once-off verification fee.
 *
 * The page says what the fee buys and what it does not. Verification means a
 * person checked a document — calling it anything more would be the same
 * overclaim the disclaimer exists to prevent.
 */
@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section">
      <div class="section-inner">
        <div class="section-eyebrow">Pricing</div>
        <h1 class="section-title">Free to list. Free to apply.<br/>One optional fee.</h1>
        <p class="section-sub">
          Mastande makes no commission on any tenancy. We are not an estate agent,
          so there is nothing to take a cut of.
        </p>

        <div class="pricing-grid">
          <div class="plan-card">
            <div class="plan-name">Tenants</div>
            <div class="plan-price">R 0<span> forever</span></div>
            <div class="plan-desc">Everything a tenant needs, at no cost.</div>
            <ul class="plan-features">
              <li>Browse every room</li>
              <li>Unlimited applications</li>
              <li>Room alerts by email</li>
              <li>Save rooms and compare</li>
              <li>Message landlords directly</li>
            </ul>
            <a routerLink="/auth/register" class="btn btn-outline" style="width:100%">Find a room</a>
          </div>

          <div class="plan-card">
            <div class="plan-name">Landlords</div>
            <div class="plan-price">R 0<span> forever</span></div>
            <div class="plan-desc">List as many rooms as you have. No listing fee, no commission.</div>
            <ul class="plan-features">
              <li>Unlimited listings</li>
              <li>Up to 20 photos per room</li>
              <li>Applicant shortlisting</li>
              <li>One-click relist</li>
              <li>WhatsApp and email notifications</li>
            </ul>
            <a routerLink="/auth/register" class="btn btn-outline" style="width:100%">List a room</a>
          </div>

          <div class="plan-card featured">
            <div class="plan-name">Verification</div>
            <div class="plan-price">R 149<span> once off</span></div>
            <div class="plan-desc">
              A one-time check for landlords. Not a subscription — pay once, keep the badge.
            </div>
            <ul class="plan-features">
              <li>Verified badge on all your listings</li>
              <li>A person checks your ID document</li>
              <li>Reviewed within 2 business days</li>
              <li>Your document is deleted once reviewed</li>
              <li class="no">Not a credit check</li>
              <li class="no">Not a criminal record check</li>
            </ul>
            @if (auth.isLandlord()) {
              <a routerLink="/landlord/verification" class="btn btn-primary" style="width:100%">
                Get verified
              </a>
            } @else {
              <a routerLink="/auth/register" class="btn btn-primary" style="width:100%">
                Create a landlord account
              </a>
            }
          </div>
        </div>

        <section class="pricing-faq">
          <h2>Straight answers</h2>

          <div class="faq-item">
            <h3>Why is verification the only thing you charge for?</h3>
            <p>
              It is the one part that costs us real time — a person reads your document.
              Everything else is software, and charging for it would just put a wall
              between a landlord with a room and a tenant who needs one.
            </p>
          </div>

          <div class="faq-item">
            <h3>Do I have to be verified to list a room?</h3>
            <p>
              No. Listing is free and unverified listings are treated the same by the
              search. Verified landlords tend to get more applications because tenants
              are cautious about scams, but it is your choice.
            </p>
          </div>

          <div class="faq-item">
            <h3>What does the badge actually mean?</h3>
            <p>
              That someone at Mastande looked at your identity document and matched it
              to your account. It is not a credit check, not a criminal record check,
              and not a guarantee about the room. Tenants should still view in person
              before paying anything.
            </p>
          </div>

          <div class="faq-item">
            <h3>Do you take commission on rent?</h3>
            <p>
              No. We are not a property practitioner under the Property Practitioners
              Act 22 of 2019 and earn nothing from your tenancy. The rent is between
              you and your tenant.
            </p>
          </div>

          <div class="faq-item">
            <h3>Can I get a refund on verification?</h3>
            <p>
              If we cannot verify you, yes — you are refunded in full. Under the
              Consumer Protection Act you may also cancel within 5 business days of
              purchase if it was sold to you through direct marketing.
            </p>
          </div>
        </section>

        <p class="pricing-note">All prices in South African Rand, VAT inclusive.</p>
      </div>
    </section>
  `,
})
export class Pricing {
  auth = inject(AuthService);
}
