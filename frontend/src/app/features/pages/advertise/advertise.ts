import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdsService } from '../../../core/services/ads.service';
import { SA_PROVINCES } from '../../../core/models/room.model';

/**
 * "Advertise with us" — the front door for inventory.
 *
 * Rates are stated rather than hidden behind "contact us for pricing". A small
 * regional advertiser deciding whether to bother emailing wants to know if
 * this is a R2,000 or a R20,000 conversation, and most will not ask.
 */
@Component({
  selector: 'app-advertise',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" style="background:var(--ink);padding-bottom:3rem">
      <div class="section-inner">
        <div class="section-eyebrow" style="color:var(--terra2)">Advertise</div>
        <h1 class="section-title" style="color:var(--cream)">
          Reach people at the moment they move
        </h1>
        <p class="hero-sub">
          Everyone on RentBoard is either moving into a room or letting one.
          Few audiences are this predictable about what they need next.
        </p>
      </div>
    </section>

    <div class="section">
      <div class="section-inner">

        <section class="dash-section">
          <h2 class="advertise-h2">Who's here</h2>
          <div class="hiw-grid">
            <div class="hiw-step">
              <div class="hiw-icon">📦</div>
              <div class="hiw-title">People about to move</div>
              <div class="hiw-desc">
                Movers, van hire, storage, boxes. A tenant who has just been accepted
                has a date and an address.
              </div>
            </div>
            <div class="hiw-step">
              <div class="hiw-icon">📶</div>
              <div class="hiw-title">New addresses</div>
              <div class="hiw-desc">
                Fibre and ISPs. Moving is the one moment people genuinely reconsider
                their provider.
              </div>
            </div>
            <div class="hiw-step">
              <div class="hiw-icon">🛋️</div>
              <div class="hiw-title">Furnishing a room</div>
              <div class="hiw-desc">
                Furniture and appliance rental, bedding, small electricals. Many rooms
                are let unfurnished.
              </div>
            </div>
            <div class="hiw-step">
              <div class="hiw-icon">🔧</div>
              <div class="hiw-title">Landlords with property</div>
              <div class="hiw-desc">
                Electricians, plumbers, painters, cleaning. Between tenants is when
                the work gets done.
              </div>
            </div>
          </div>
        </section>

        <section class="dash-section">
          <h2 class="advertise-h2">Placements and rates</h2>
          <p class="muted">
            Flat monthly rate, invoiced monthly. No contracts, cancel with a month's
            notice. All prices exclude VAT.
          </p>
          <p class="muted">
            Rates are per month, not per impression. You are buying a slot — if the
            board gets busier, you get more views at the same price.
          </p>

          <table class="rate-table">
            <thead>
              <tr>
                <th>Placement</th>
                <th>Nationwide</th>
                <th>One province</th>
                <th>One city</th>
                <th>One suburb</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Sidebar</strong>
                  <span class="rate-table__note">Beside the filters, whole search</span>
                </td>
                <td>R2,500</td><td>R1,250</td><td>R700</td><td>R450</td>
              </tr>
              <tr>
                <td>
                  <strong>In-grid</strong>
                  <span class="rate-table__note">After every sixth room</span>
                </td>
                <td>R4,000</td><td>R2,000</td><td>R1,100</td><td>R600</td>
              </tr>
              <tr>
                <td>
                  <strong>Room detail</strong>
                  <span class="rate-table__note">Below a listing</span>
                </td>
                <td>R3,000</td><td>R1,500</td><td>R850</td><td>R450</td>
              </tr>
            </tbody>
          </table>

          <p class="muted" style="margin-top:1rem">
            <strong>Narrower targeting costs less, not more.</strong> A nationwide
            sidebar runs on every search; a Sandton one runs only on Sandton
            searches. You pay for the reach you get.
          </p>
          <p class="muted">
            It does cost more <em>per impression</em>, and deliberately so — an
            advert for storage in Sandton, shown to people moving into Sandton,
            is worth more than the same advert shown to the whole country.
          </p>
        </section>

        <section class="dash-section">
          <h2 class="advertise-h2">How we handle your ad, and our users</h2>
          <ul class="verify-facts">
            <li><strong>Targeting is contextual.</strong> We match your ad to the page —
                province, city, room type — never to a profile of the person viewing it.</li>
            <li><strong>We don't share user data.</strong> Not names, not emails, not
                behaviour. You get impressions, clicks and click-through rate for your
                own campaign, and nothing else.</li>
            <li><strong>No third-party trackers.</strong> Clicks are counted by us, so
                no pixel or script of yours runs on our pages.</li>
            <li><strong>Every ad is labelled "Advertisement".</strong> Our users are
                deciding who to trust with a deposit; an ad that reads like a listing
                would be dangerous and we won't run one.</li>
            <li><strong>We review creatives before they go live</strong>, and the
                destination must be https.</li>
          </ul>
        </section>

        <section class="dash-section" id="enquire">
          <h2 class="advertise-h2">Get in touch</h2>

          @if (sent()) {
            <div class="insight-banner" style="background:rgba(61,112,64,.08);border-color:rgba(61,112,64,.2)">
              ✅ <span>{{ response() }}</span>
            </div>
          } @else {
            <form [formGroup]="form" (ngSubmit)="onSubmit()" class="advertise-form">
              <div class="form-row">
                <label for="companyName">Company</label>
                <input id="companyName" type="text" formControlName="companyName"/>
              </div>
              <div class="form-row">
                <label for="contactName">Your name</label>
                <input id="contactName" type="text" formControlName="contactName"/>
              </div>
              <div class="form-row">
                <label for="contactEmail">Email</label>
                <input id="contactEmail" type="email" formControlName="contactEmail"/>
              </div>
              <div class="form-row">
                <label for="contactPhone">Phone (optional)</label>
                <input id="contactPhone" type="tel" formControlName="contactPhone"/>
              </div>
              <div class="form-row">
                <label for="industry">What do you sell? (optional)</label>
                <input id="industry" type="text" formControlName="industry"
                       placeholder="e.g. Fibre, removals, furniture rental"/>
              </div>
              <div class="form-row">
                <label for="province">Area of interest (optional)</label>
                <select id="province" formControlName="province">
                  <option value="">Nationwide</option>
                  @for (p of provinces; track p) { <option [value]="p">{{ p }}</option> }
                </select>
              </div>
              <div class="form-row">
                <label for="message">What are you looking to do?</label>
                <textarea id="message" formControlName="message" rows="4"
                          placeholder="Budget, placements you're interested in, when you'd want to start."></textarea>
              </div>

              @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }

              <button type="submit" class="btn btn-primary btn-lg"
                      [disabled]="form.invalid || sending()">
                {{ sending() ? 'Sending…' : 'Send enquiry' }}
              </button>
              <p class="field-hint">
                We reply within two business days. Your details are used to answer this
                enquiry and nothing else.
              </p>
            </form>
          }
        </section>

        <p class="pricing-note">
          RentBoard is an intermediary platform, not an estate agent.
          <a routerLink="/legal/terms">Terms</a> ·
          <a routerLink="/legal/privacy">Privacy</a>
        </p>
      </div>
    </div>
  `,
  styles: [`
    .advertise-h2 { font-family: var(--font-display); font-size: 1.4rem; margin-bottom: 1rem; }
    .advertise-form { max-width: 32rem; }
  `],
})
export class Advertise {
  private fb = inject(FormBuilder);
  private ads = inject(AdsService);

  provinces = SA_PROVINCES;
  sending = signal(false);
  sent = signal(false);
  response = signal('');
  error = signal<string | null>(null);

  form = this.fb.group({
    companyName: ['', [Validators.required, Validators.minLength(2)]],
    contactName: ['', [Validators.required, Validators.minLength(2)]],
    contactEmail: ['', [Validators.required, Validators.email]],
    contactPhone: [''],
    industry: [''],
    province: [''],
    message: ['', [Validators.required, Validators.minLength(20)]],
  });

  onSubmit() {
    if (this.form.invalid) return;
    this.sending.set(true);
    this.error.set(null);

    const raw = this.form.getRawValue();
    this.ads.submitEnquiry({
      companyName: raw.companyName!,
      contactName: raw.contactName!,
      contactEmail: raw.contactEmail!,
      contactPhone: raw.contactPhone || undefined,
      industry: raw.industry || undefined,
      province: raw.province || undefined,
      message: raw.message!,
    }).subscribe({
      next: (res) => {
        this.sending.set(false);
        this.response.set(res.message);
        this.sent.set(true);
      },
      error: (err) => {
        this.sending.set(false);
        this.error.set(
          err?.status === 429
            ? 'That is a few enquiries in a short time. Please email us directly instead.'
            : err?.error?.message ?? 'Could not send that. Please try again.',
        );
      },
    });
  }
}
