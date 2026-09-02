import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdminService, ReferralStats, LaunchCode } from '../../../core/services/admin.service';
import { PortalShell } from '../../../shared/components/portal-shell/portal-shell';
import { ADMIN_NAV } from '../admin-nav';

/**
 * Referral performance and the launch invite codes.
 *
 * Per-city redemption is the point: fifty codes handed out in Johannesburg and
 * three redeemed tells you something a national total never would.
 */
@Component({
  selector: 'app-admin-referrals',
  standalone: true,
  imports: [DatePipe, PortalShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems" roleLabel="Admin" avatarColour="var(--ink2)">
      <div class="dash-section-title">Referrals</div>

      @if (stats(); as s) {
        <div class="insight-banner">
          💡
          <span>
            A referral counts only once the person does something — a landlord
            publishing a room, a tenant applying. Conversion below is signups
            that went on to act, not signups alone.
          </span>
        </div>

        <div class="stat-row">
          <div class="stat-box"><div class="val">{{ s.total }}</div><div class="lbl">Referred signups</div></div>
          <div class="stat-box"><div class="val">{{ s.qualified }}</div><div class="lbl">Became active</div></div>
          <div class="stat-box">
            <div class="val" [class.stat-warn]="s.conversionPct < 30">{{ s.conversionPct }}%</div>
            <div class="lbl">Conversion</div>
          </div>
          <div class="stat-box"><div class="val">{{ s.pending }}</div><div class="lbl">Signed up only</div></div>
        </div>

        <section class="dash-section">
          <div class="dash-section-title">Launch codes by city</div>
          @if (s.byCity.length === 0) {
            <p class="muted">
              No launch codes seeded. Run
              <code>SEED_LAUNCH_CODES=true npx ts-node prisma/seed.ts</code>.
            </p>
          } @else {
            @for (c of s.byCity; track c.city) {
              <div class="app-card">
                <div class="app-thumb portal-thumb" aria-hidden="true">📍</div>
                <div class="app-info">
                  <div class="app-room">{{ c.city }}</div>
                  <div class="app-location">
                    {{ c.redemptions }} of {{ c.codes }} codes redeemed
                    ({{ redemptionPct(c) }}%)
                  </div>
                </div>
                <div class="portal-row-actions">
                  <button type="button" class="btn btn-sm btn-ghost-light" (click)="showCodes(c.city)">
                    {{ openCity() === c.city ? 'Hide codes' : 'Show codes' }}
                  </button>
                </div>
              </div>

              @if (openCity() === c.city) {
                @if (loadingCodes()) {
                  <p class="muted">Loading…</p>
                } @else {
                  <div class="code-grid">
                    @for (code of codes(); track code.id) {
                      <span class="code-chip" [class.code-chip--used]="code.useCount > 0">
                        {{ code.code }}
                        @if (code.useCount > 0) { ✓ }
                      </span>
                    }
                  </div>
                  <p class="field-hint">
                    Ticked codes have been redeemed. Hand the rest out individually —
                    a code shared publicly gets farmed.
                  </p>
                }
              }
            }
          }
        </section>
      } @else if (loading()) {
        <p class="muted">Loading…</p>
      }
    </app-portal-shell>
  `,
  styles: [`
    .code-grid { display: flex; flex-wrap: wrap; gap: .4rem; padding: .75rem 0 .25rem; }
    .code-chip { font-family: var(--font-mono); font-size: .78rem; padding: .25rem .5rem;
                 background: var(--cream2); border: 1px solid var(--border);
                 border-radius: var(--r4); color: var(--ink2); }
    .code-chip--used { background: rgba(61,112,64,.1); border-color: rgba(61,112,64,.3);
                       color: var(--sage); text-decoration: line-through; }
  `],
})
export class AdminReferrals implements OnInit {
  private admin = inject(AdminService);

  readonly navItems = ADMIN_NAV;

  stats = signal<ReferralStats | null>(null);
  codes = signal<LaunchCode[]>([]);
  loading = signal(true);
  loadingCodes = signal(false);
  openCity = signal<string | null>(null);

  ngOnInit() {
    this.admin.getReferralStats().subscribe({
      next: (s) => { this.stats.set(s); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  redemptionPct(c: { codes: number; redemptions: number }) {
    return c.codes > 0 ? Math.round((c.redemptions / c.codes) * 100) : 0;
  }

  showCodes(city: string) {
    if (this.openCity() === city) {
      this.openCity.set(null);
      return;
    }
    this.openCity.set(city);
    this.loadingCodes.set(true);
    this.admin.getLaunchCodes(city).subscribe({
      next: (list) => { this.codes.set(list); this.loadingCodes.set(false); },
      error: () => this.loadingCodes.set(false),
    });
  }
}
