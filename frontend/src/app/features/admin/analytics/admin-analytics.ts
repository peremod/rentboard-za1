import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { PortalShell } from '../../../shared/components/portal-shell/portal-shell';
import { AdminService, Funnels, ContentSignals } from '../../../core/services/admin.service';
import { ADMIN_NAV } from '../admin-nav';

/**
 * UX measurement, aggregate only.
 *
 * Two sections on purpose. The funnels come from counters and answer "where do
 * people give up". The content signals come from data the platform already had
 * and answer "which listings are failing and why" — the second needed no
 * tracking at all, which is worth seeing side by side.
 */
@Component({
  selector: 'app-admin-analytics',
  standalone: true,
  imports: [PortalShell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems" roleLabel="Admin" avatarColour="var(--ink2)">
      <div class="dash-section-title">How the site is used</div>

      <div class="insight-banner">
        🔒
        <span>
          Counts only — no user ids, no session ids, no journeys. This tells you
          how many people left at a step, never which person did. That is the
          trade that lets the Advertise page say we run no profiling.
        </span>
      </div>

      @if (funnels(); as f) {
        <section class="dash-section">
          <div class="dash-section-title">
            Listing a room
            <span class="dash-count">(last {{ f.periodDays }} days)</span>
          </div>
          <p class="muted">
            A landlord who abandons the wizard is a room the board never gets.
            The biggest drop is where to look first.
          </p>
          @for (s of f.listingFunnel; track s.step) {
            <div class="funnel-row">
              <div class="funnel-row__label">{{ s.step }}</div>
              <div class="funnel-row__bar">
                <div class="funnel-row__fill" [style.width.%]="s.ofStart"></div>
              </div>
              <div class="funnel-row__figures">
                <strong>{{ s.count }}</strong>
                <span class="muted">{{ s.ofStart }}%</span>
                @if (s.dropFromPrevious > 0) {
                  <span class="funnel-drop" [class.funnel-drop--bad]="s.dropFromPrevious >= 40">
                    −{{ s.dropFromPrevious }}%
                  </span>
                }
              </div>
            </div>
          }
        </section>

        <section class="dash-section">
          <div class="dash-section-title">Applying for a room</div>
          @for (s of f.applyFunnel; track s.step) {
            <div class="funnel-row">
              <div class="funnel-row__label">{{ s.step }}</div>
              <div class="funnel-row__bar">
                <div class="funnel-row__fill" [style.width.%]="s.ofStart"></div>
              </div>
              <div class="funnel-row__figures">
                <strong>{{ s.count }}</strong>
                <span class="muted">{{ s.ofStart }}%</span>
                @if (s.dropFromPrevious > 0) {
                  <span class="funnel-drop" [class.funnel-drop--bad]="s.dropFromPrevious >= 40">
                    −{{ s.dropFromPrevious }}%
                  </span>
                }
              </div>
            </div>
          }
        </section>

        <section class="dash-section">
          <div class="dash-section-title">Feature use</div>
          <p class="muted">
            Low numbers here are worth acting on: a feature nobody uses is either
            not wanted or not findable, and those need different fixes.
          </p>
          <div class="stat-row">
            <div class="stat-box"><div class="val">{{ f.featureUse.filtersUsed }}</div><div class="lbl">Filters used</div></div>
            <div class="stat-box"><div class="val">{{ f.featureUse.alertsSaved }}</div><div class="lbl">Alerts saved</div></div>
            <div class="stat-box"><div class="val">{{ f.featureUse.roomsSaved }}</div><div class="lbl">Rooms saved</div></div>
            <div class="stat-box"><div class="val">{{ f.featureUse.suggestionsUsed }}</div><div class="lbl">Suggestions used</div></div>
          </div>
        </section>
      } @else if (loading()) {
        <p class="muted">Loading…</p>
      }

      @if (signals(); as sig) {
        <section class="dash-section">
          <div class="dash-section-title">Listing quality</div>
          <p class="muted">
            From data the platform already had — no tracking involved. Each of
            these is a fixable problem rather than a mystery.
          </p>
          <div class="stat-row">
            <div class="stat-box">
              <div class="val" [class.stat-warn]="sig.activeRoomsWithoutPhoto > 0">
                {{ sig.activeRoomsWithoutPhoto }}
              </div>
              <div class="lbl">Live rooms with no photo</div>
            </div>
            <div class="stat-box">
              <div class="val" [class.stat-warn]="sig.viewedButNeverApplied > 0">
                {{ sig.viewedButNeverApplied }}
              </div>
              <div class="lbl">20+ views, no applications</div>
            </div>
            <div class="stat-box">
              <div class="val">{{ sig.draftsAbandonedOverAWeek }}</div>
              <div class="lbl">Drafts stalled over a week</div>
            </div>
            <div class="stat-box">
              <div class="val">{{ sig.averageViewsPerActiveRoom }}</div>
              <div class="lbl">Average views per room</div>
            </div>
          </div>
        </section>
      }
    </app-portal-shell>
  `,
  styles: [`
    .funnel-row { display: flex; align-items: center; gap: .85rem; padding: .5rem 0; flex-wrap: wrap; }
    .funnel-row__label { flex: 0 0 11rem; font-size: .88rem; color: var(--ink2); }
    .funnel-row__bar { flex: 1 1 8rem; height: 22px; background: var(--cream2);
                       border-radius: var(--r4); overflow: hidden; min-width: 6rem; }
    .funnel-row__fill { height: 100%; background: var(--terra); transition: width .3s ease; }
    .funnel-row__figures { flex: 0 0 9rem; display: flex; align-items: baseline; gap: .5rem;
                           font-size: .85rem; }
    .funnel-drop { font-size: .78rem; color: var(--slate); }
    .funnel-drop--bad { color: var(--terra); font-weight: 600; }
  `],
})
export class AdminAnalytics implements OnInit {
  private admin = inject(AdminService);

  readonly navItems = ADMIN_NAV;
  funnels = signal<Funnels | null>(null);
  signals = signal<ContentSignals | null>(null);
  loading = signal(true);

  ngOnInit() {
    this.admin.getFunnels().subscribe({
      next: (f) => { this.funnels.set(f); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
    this.admin.getContentSignals().subscribe({
      next: (s) => this.signals.set(s),
      error: () => {},
    });
  }
}
