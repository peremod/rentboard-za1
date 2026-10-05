import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DocTemplate, templateBySlug } from './template-content';
import { SeoService } from '../../core/services/seo.service';

/**
 * One template, laid out to be printed — Phase 8a.
 *
 * ⚠️ No PDF library. The browser already has one, and on the phone this product
 * is built for, Chrome's Print then "Save as PDF" is a path the person already
 * knows. A server-side renderer would be a dependency, a font-licensing
 * question, and a layout nobody here could check on a real handset.
 *
 * So the whole job is a good print stylesheet: A4, the site chrome removed, and
 * sections that do not break across a page in the middle of a signature block.
 */
@Component({
  selector: 'app-template-document',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (doc(); as d) {
      <section class="section tpl-wrap">
        <!-- Screen only. None of this is on the printed page. -->
        <div class="tpl-bar no-print">
          <!-- ⚠️ Relative, not "/templates". These components are mounted twice — the
               public route and /landlord/templates inside the portal — and an absolute
               link threw a landlord out of the portal from the one place they were
               most likely to press. ".." resolves to whichever list they came from. -->
          <a routerLink=".." class="btn btn-outline btn-sm">← All templates</a>
          <button type="button" class="btn btn-primary" (click)="print()">
            Save as PDF or print
          </button>
        </div>

        <p class="tpl-hint no-print">
          On a phone: tap <strong>Save as PDF or print</strong>, then choose
          <strong>Save as PDF</strong>. You can then send it on WhatsApp like any other file.
        </p>

        @if (d.reviewState === 'awaiting_legal_review') {
          <!-- ⚠️ On screen AND on the printed page. A warning that disappears
               when the document is printed is a warning the person holding the
               paper never sees. -->
          <div class="tpl-warn">
            <strong>This one has not been checked by a lawyer yet.</strong>
            It is a starting point, not finished legal advice. A lease and an addendum create
            real obligations — read every line, change what does not fit your situation, and
            have it checked before you rely on it. Mastande is not a law firm.
          </div>
        }

        <article class="tpl-doc">
          <header class="tpl-head">
            <h1>{{ d.title }}</h1>
            <p class="tpl-purpose">{{ d.purpose }}</p>
            <p class="tpl-who"><strong>Who fills this in:</strong> {{ d.who }}</p>
          </header>

          @for (s of d.sections; track s.heading) {
            <section class="tpl-section">
              <h2>{{ s.heading }}</h2>

              @for (p of s.body ?? []; track p) {
                <p class="tpl-para">{{ p }}</p>
              }

              @if (s.note) {
                <p class="tpl-note">{{ s.note }}</p>
              }

              @for (f of s.fields ?? []; track f.label) {
                <div class="tpl-field" [class.is-block]="f.size === 'block'">
                  <span class="tpl-label">
                    {{ f.label }}
                    @if (f.hint) { <em>({{ f.hint }})</em> }
                  </span>
                  @if (f.size === 'block') {
                    <span class="tpl-box"></span>
                  } @else {
                    <span class="tpl-rule" [class.is-long]="f.size === 'long'"></span>
                  }
                </div>
              }

              @if (s.checklist?.length) {
                <table class="tpl-table">
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Condition when moving in</th>
                      <th scope="col">Condition when moving out</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of s.checklist ?? []; track row) {
                      <tr>
                        <th scope="row">{{ row }}</th>
                        <td></td>
                        <td></td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
            </section>
          }

          <section class="tpl-section tpl-signs">
            <h2>Signed</h2>
            @for (who of d.signatories; track who) {
              <div class="tpl-sign">
                <div class="tpl-field">
                  <span class="tpl-label">{{ who }} — full name</span>
                  <span class="tpl-rule is-long"></span>
                </div>
                <div class="tpl-field">
                  <span class="tpl-label">Signature</span>
                  <span class="tpl-rule is-long"></span>
                </div>
                <div class="tpl-field">
                  <span class="tpl-label">Date</span>
                  <span class="tpl-rule"></span>
                </div>
              </div>
            }
            <div class="tpl-field">
              <span class="tpl-label">Witness (optional) — name and signature</span>
              <span class="tpl-rule is-long"></span>
            </div>
          </section>

          <!--
            ⚠️ Printed, not screen-only.

            The sentence that matters most is the one on the paper somebody is
            holding in a room six months from now. "Nothing was signed on
            Mastande" is the same line the lease documents screen carries, for
            the same reason: this platform stores and prints, it does not give a
            signature legal effect and it does not hold anybody's money.
          -->
          <footer class="tpl-foot">
            <p>
              Template from Mastande (umastande.co.za). Mastande is not a law firm and this is
              not legal advice. Nothing is signed on Mastande — this document has effect only
              once the people named on it sign the printed page.
            </p>
            <p>
              Mastande does not hold deposits or rent. Any money mentioned here is paid directly
              between the landlord and the tenant.
            </p>
          </footer>
        </article>
      </section>
    } @else {
      <section class="section">
        <h1>That template does not exist</h1>
        <p class="muted">
          <a routerLink="..">See the templates we do have</a>.
        </p>
      </section>
    }
  `,
  styles: [`
    .tpl-wrap { max-width: 820px; margin: 0 auto; }
    .tpl-bar { display: flex; gap: .75rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .tpl-hint { font-size: .85rem; color: var(--slate); margin-bottom: 1.25rem; }

    .tpl-warn {
      border: 2px solid var(--terra);
      background: rgba(192, 78, 40, .07);
      border-radius: var(--r8);
      padding: 1rem 1.1rem;
      font-size: .9rem;
      line-height: 1.6;
      margin-bottom: 1.5rem;
    }

    .tpl-doc {
      background: var(--white);
      border: 1px solid var(--border);
      border-radius: var(--r8);
      padding: 2rem;
    }
    .tpl-head { border-bottom: 2px solid var(--ink); padding-bottom: 1rem; margin-bottom: 1.5rem; }
    .tpl-head h1 { font-size: 1.5rem; margin: 0 0 .4rem; }
    .tpl-purpose { color: var(--slate); font-size: .9rem; margin: 0 0 .5rem; }
    .tpl-who { font-size: .85rem; margin: 0; }

    .tpl-section { margin-bottom: 1.75rem; break-inside: avoid; }
    .tpl-section h2 {
      font-size: 1rem; text-transform: uppercase; letter-spacing: .04em;
      border-bottom: 1px solid var(--border); padding-bottom: .35rem; margin: 0 0 .9rem;
    }
    .tpl-para { font-size: .88rem; line-height: 1.65; margin: 0 0 .6rem; }
    .tpl-note {
      font-size: .85rem; line-height: 1.6; margin: 0 0 .9rem;
      background: var(--cream2); border-left: 3px solid var(--gold);
      padding: .6rem .8rem; border-radius: 0 var(--r4) var(--r4) 0;
    }

    .tpl-field { display: flex; align-items: baseline; gap: .6rem; margin-bottom: .85rem; }
    .tpl-field.is-block { flex-direction: column; align-items: stretch; gap: .35rem; }
    .tpl-label { font-size: .85rem; white-space: nowrap; }
    .tpl-label em { color: var(--slate); font-style: normal; }
    .tpl-field.is-block .tpl-label { white-space: normal; }
    .tpl-rule { flex: 1; border-bottom: 1px solid var(--ink2); min-width: 90px; height: 1.1rem; }
    .tpl-rule.is-long { min-width: 180px; }
    .tpl-box { border: 1px solid var(--ink2); border-radius: var(--r4); height: 4.5rem; }

    .tpl-table { width: 100%; border-collapse: collapse; font-size: .82rem; }
    .tpl-table th, .tpl-table td { border: 1px solid var(--ink2); padding: .45rem .5rem; text-align: left; }
    .tpl-table thead th { background: var(--cream2); font-size: .78rem; }
    .tpl-table tbody th { font-weight: 400; width: 34%; }
    .tpl-table td { height: 1.9rem; }

    .tpl-signs { margin-top: 2.5rem; }
    .tpl-sign { margin-bottom: 1.25rem; break-inside: avoid; }

    .tpl-foot {
      margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border);
      font-size: .75rem; color: var(--slate); line-height: 1.55;
    }
    .tpl-foot p { margin: 0 0 .4rem; }

    /* The label wraps on a narrow screen rather than pushing the rule off the page. */
    @media (max-width: 480px) {
      .tpl-field { flex-direction: column; align-items: stretch; gap: .3rem; }
      .tpl-label { white-space: normal; }
      .tpl-rule { min-width: 0; }
      .tpl-doc { padding: 1.25rem; }
      .tpl-table { font-size: .75rem; }
      .tpl-table tbody th { width: 40%; }
    }

    /* ── Print ────────────────────────────────────────────────────────────
       The site chrome goes, the paper stays. .no-print is applied to the
       buttons; the header, nav and footer are hidden globally in styles.scss
       so every printable page gets the same treatment. */
    @media print {
      .no-print { display: none !important; }
      .tpl-wrap { max-width: none; padding: 0; }
      .tpl-doc { border: none; border-radius: 0; padding: 0; background: #fff; }
      .tpl-warn {
        border: 2px solid #000; background: #fff;
        page-break-inside: avoid; break-inside: avoid;
      }
      .tpl-section, .tpl-sign { page-break-inside: avoid; }
      .tpl-note { background: #f2f2f2; border-left: 3px solid #000; }
      .tpl-table thead th { background: #f2f2f2; }
    }
  `],
})
export class TemplateDocument implements OnInit {
  private route = inject(ActivatedRoute);
  private seo = inject(SeoService);

  readonly doc = signal<DocTemplate | undefined>(undefined);

  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    const found = templateBySlug(slug);
    this.doc.set(found);
    if (found) {
      this.seo.apply({
        title: found.title + ' — free template — Mastande',
        description: found.purpose,
        path: '/templates/' + found.slug,
      });
    }
  }

  print() {
    // The browser's own dialog. On Android this is where "Save as PDF" lives.
    if (typeof window !== 'undefined') window.print();
  }
}
