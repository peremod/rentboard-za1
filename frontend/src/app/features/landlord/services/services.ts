import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ServiceDirectoryService } from '../../../core/services/service-directory.service';
import {
  SERVICE_LABELS, ServiceCategory, ServiceProvider, whatsappLink,
} from '../../../core/models/service-provider.model';
import { PortalShell, PortalNavItem } from '../../../shared/components/portal-shell/portal-shell';
import { landlordNav } from '../landlord-nav';

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
  imports: [FormsModule, PortalShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems" roleLabel="Landlord" pageTitle="Who to call">

      <div class="insight-banner">
        🔧
        <span>
          People we have checked out and can pass on. We do not book them and we take
          no money — you phone them, and whatever you agree is between you and them.
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
              We are still building this list. It is names we have checked, not an open directory.
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
    </app-portal-shell>
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
      .provider__note { margin: 0.25rem 0 0.5rem; }
      .provider__actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    `,
  ],
})
export class LandlordServices implements OnInit {
  private directory = inject(ServiceDirectoryService);
  navItems: PortalNavItem[] = landlordNav();

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

  protected label(c: ServiceCategory) {
    return SERVICE_LABELS[c] ?? c;
  }

  /** Shared helper, so this and the admin screen cannot disagree about wa.me. */
  protected waLink(p: ServiceProvider) {
    return whatsappLink(p.phone);
  }
}
