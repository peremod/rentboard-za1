import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TEMPLATES } from './template-content';
import { SeoService } from '../../core/services/seo.service';

/**
 * The four documents a landlord keeps asking for — Phase 8a.
 *
 * Public rather than behind the portal, on purpose. A landlord searching for
 * "lease agreement template South Africa" is somebody who has rooms and no
 * tools, which is exactly who this product is for — and a tenant who wants to
 * see a blank inspection form before signing one should be able to.
 */
@Component({
  selector: 'app-templates-list',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section">
      <div class="tpl-intro">
        <h1>Forms and templates</h1>
        <p class="lede">
          Free to download, free to use, and yours to change. Open one, fill it in on paper or on
          your phone, and save it as a PDF to send on WhatsApp.
        </p>
        <p class="muted">
          <strong>Nothing is signed on Mastande.</strong> These are documents you print and sign
          with the other person. Mastande is not a law firm, does not give legal advice, and does
          not hold deposits or rent.
        </p>
      </div>

      <div class="tpl-grid">
        @for (t of templates; track t.slug) {
          <a class="tpl-card" [routerLink]="['/templates', t.slug]">
            <h2>{{ t.title }}</h2>
            <p class="tpl-card__purpose">{{ t.purpose }}</p>
            <p class="tpl-card__why">{{ t.why }}</p>
            @if (t.reviewState === 'awaiting_legal_review') {
              <span class="tpl-flag">Not checked by a lawyer yet — a starting point</span>
            } @else {
              <span class="tpl-ok">Ready to use</span>
            }
          </a>
        }
      </div>
    </section>
  `,
  styles: [`
    .tpl-intro { max-width: 640px; margin-bottom: 2rem; }
    .tpl-intro h1 { margin-bottom: .6rem; }
    .lede { font-size: 1rem; line-height: 1.6; margin-bottom: .75rem; }

    .tpl-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .tpl-card {
      display: block; text-decoration: none; color: inherit;
      background: var(--card); border: 1.5px solid var(--border);
      border-radius: var(--r8); padding: 1.25rem;
      transition: border-color .15s, transform .15s;
    }
    .tpl-card:hover { border-color: var(--terra); transform: translateY(-2px); }
    .tpl-card h2 { font-size: 1.05rem; margin: 0 0 .5rem; }
    .tpl-card__purpose { font-size: .88rem; color: var(--ink2); margin: 0 0 .6rem; line-height: 1.5; }
    .tpl-card__why { font-size: .82rem; color: var(--slate); margin: 0 0 .9rem; line-height: 1.55; }

    .tpl-flag, .tpl-ok {
      display: inline-block; font-size: .72rem; font-weight: 700;
      padding: .3rem .6rem; border-radius: var(--r-full);
    }
    .tpl-flag { background: rgba(192, 78, 40, .1); color: var(--terra); }
    .tpl-ok { background: rgba(61, 112, 64, .12); color: var(--sage-deep); }
  `],
})
export class TemplatesList implements OnInit {
  private seo = inject(SeoService);
  readonly templates = TEMPLATES;

  ngOnInit() {
    this.seo.apply({
      title: 'Free lease, inspection and deposit templates — Mastande',
      description:
        'Free South African room-letting forms: lease agreement, renewal addendum, move-in '
        + 'inspection and deposit receipt. Download, print, sign.',
      path: '/templates',
    });
  }
}
