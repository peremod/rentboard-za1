import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ServiceDirectoryService } from '../../../core/services/service-directory.service';
import {
  SERVICE_LABELS, ServiceCategory, ServiceProvider, checksFor, whatsappLink,
} from '../../../core/models/service-provider.model';

/**
 * Who to phone when something breaks.
 *
 * The product's job ends at the number. Tap to call or open WhatsApp, and the
 * landlord and the tradesperson arrange it between themselves — no booking, no
 * payment, nothing that would make Mastande a party to the job.
 *
 * Grouped by trade rather than listed flat, because the question is never "show
 * me everyone", it is "I need a plumber".
 */
@Component({
  selector: 'app-landlord-services',
  standalone: true,
  imports: [FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `

      <!-- ⚠️ This used to read "People we have checked out and can pass on",
           and nothing in the product recorded a check of any kind. A blanket
           claim is unfalsifiable; "we rang this number on 3 Oct" is not. So the
           banner says what the list IS, and each name carries the checks it
           actually has. -->
      <div class="insight-banner">
        🔧
        <span>
          Names we have looked into ourselves — <strong>each one says below what
          we checked and when</strong>, so you can judge it rather than take our
          word. We do not book them and we take no money: you phone them, and
          whatever you agree is between you and them.
        </span>
      </div>

      <div class="services-filter">
        <label>
          <span>Where is the work?</span>
          <input type="text" [(ngModel)]="area" name="area" (keyup.enter)="load()"
                 placeholder="Tembisa, Soweto…"/>
        </label>
        <button type="button" class="btn btn-sm btn-outline" (click)="load()">Filter</button>
        @if (area) {
          <button type="button" class="link-btn" (click)="clearArea()">Show all areas</button>
        }
      </div>

      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (providers().length === 0) {
        <div class="empty-state">
          <h2>Nobody listed yet</h2>
          <p>
            @if (area) {
              We have nobody for {{ area }} yet. Try without the area filter.
            } @else {
              We are still building this list. Nobody appears here until we have
              rung their number and reached them — it is not an open directory.
            }
          </p>
        </div>
      } @else {
        @for (group of grouped(); track group.category) {
          <section class="dash-section">
            <h2 class="dash-section-title">{{ label(group.category) }}</h2>
            @for (p of group.items; track p.id) {
              <div class="provider">
                <div class="provider__head">
                  <strong>{{ p.name }}</strong>
                  <span class="muted">{{ p.areas.join(', ') }}</span>
                </div>
                @if (p.note) { <p class="provider__note">{{ p.note }}</p> }

                <!-- What we checked, from the stored outcomes. The list cannot
                     say more than the data holds, which is the point. -->
                @if (checks(p); as done) {
                  @if (done.length) {
                    <ul class="provider__checks">
                      @for (c of done; track c.label) {
                        <li>✓ {{ c.label }} <span class="muted">— {{ c.on | date: 'd MMM yyyy' }}</span></li>
                      }
                    </ul>
                  } @else {
                    <!-- Unreachable while the API refuses to list anybody without
                         a phone check, and here anyway: if that rule is ever
                         relaxed this screen must not quietly go back to implying
                         a check it does not have. -->
                    <p class="provider__checks provider__checks--none">
                      We have not recorded any checks on this person.
                    </p>
                  }
                }
                @if (p.tradeRegistration) {
                  <!-- Verbatim, so a landlord can check it with the body
                       themselves — the only thing that makes it worth storing. -->
                  <p class="provider__reg">
                    Registration given as <strong>{{ p.tradeRegistration }}</strong>.
                    We pass it on as they gave it; you can check it with the body yourself.
                  </p>
                }
                <div class="provider__actions">
                  <!-- tel: and wa.me, not an in-app message. The whole point is
                       to get the landlord onto the phone. -->
                  <a class="btn btn-sm btn-primary" [href]="'tel:' + p.phone">📞 Call {{ p.phone }}</a>
                  @if (p.whatsapp) {
                    <a class="btn btn-sm btn-sage" [href]="waLink(p)" target="_blank" rel="noopener">
                      WhatsApp {{ p.name }}
                    </a>
                  }
                </div>
              </div>
            }
          </section>
        }
      }
  `,
  styles: [
    `
      .services-filter {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: flex-end;
        margin-bottom: 1rem;
      }
      .services-filter label { flex: 1 1 10rem; }
      .services-filter label span { display: block; margin-bottom: 0.25rem; }
      .services-filter input { width: 100%; }
      .provider {
        border-top: 1px solid var(--line);
        padding: 0.75rem 0;
      }
      .provider__head {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: baseline;
      }
      /* ⚠️ A reading measure, because without one these ran 976px wide at
         1280px — a line of text hundreds of characters long, which is the
         fourth item in CLAUDE.md's mobile list and just as wrong on a desktop.
         Found by measuring the rendered box, not by looking at the page. */
      .provider__note,
      .provider__checks,
      .provider__reg { max-width: 42rem; }
      .provider__note { margin: 0.25rem 0 0.5rem; }
      .provider__checks {
        margin: 0.35rem 0 0.5rem;
        padding-left: 0;
        list-style: none;
        font-size: 0.8rem;
        line-height: 1.7;
        color: var(--ink2);
      }
      .provider__checks--none { color: var(--slate); font-style: italic; }
      .provider__reg {
        margin: 0 0 0.5rem;
        font-size: 0.78rem;
        line-height: 1.6;
        color: var(--ink2);
      }
      .provider__actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    `,
  ],
})
export class LandlordServices implements OnInit {
  private directory = inject(ServiceDirectoryService);

  protected readonly providers = signal<ServiceProvider[]>([]);
  protected readonly loading = signal(true);
  protected area = '';

  /**
   * Grouped by trade, in the order the API returned them.
   *
   * The API orders by the enum's declaration order — plumber first, because
   * that is what comes up most — so the groups are built by walking the list
   * rather than sorting again. Re-sorting here would silently override a
   * deliberate order decided on the server.
   */
  protected readonly grouped = computed(() => {
    const groups: { category: ServiceCategory; items: ServiceProvider[] }[] = [];
    for (const p of this.providers()) {
      const last = groups[groups.length - 1];
      if (last && last.category === p.category) last.items.push(p);
      else groups.push({ category: p.category, items: [p] });
    }
    return groups;
  });

  ngOnInit() {
    this.load();
  }

  protected load() {
    this.loading.set(true);
    this.directory.list({ area: this.area }).subscribe({
      next: (list) => {
        this.providers.set(list);
        this.loading.set(false);
      },
      error: () => {
        this.providers.set([]);
        this.loading.set(false);
      },
    });
  }

  protected clearArea() {
    this.area = '';
    this.load();
  }

  /**
   * The checks we can honestly name for this person.
   *
   * Delegates to the shared helper so the admin screen and this one cannot
   * disagree about what counts as a check — and so the list is built from the
   * stored outcomes rather than from a sentence somebody wrote.
   */
  protected checks(p: ServiceProvider) {
    return checksFor(p);
  }

  protected label(c: ServiceCategory) {
    return SERVICE_LABELS[c] ?? c;
  }

  /** Shared helper, so this and the admin screen cannot disagree about wa.me. */
  protected waLink(p: ServiceProvider) {
    return whatsappLink(p.phone);
  }
}
