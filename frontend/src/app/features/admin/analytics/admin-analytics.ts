import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { PortalShell } from '../../../shared/components/portal-shell/portal-shell';
import { AdminService, Funnels, ContentSignals, Growth } from '../../../core/services/admin.service';
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

      @if (growth(); as g) {
        <section class="dash-section">
          <div class="dash-section-title">
            Active users
            <span class="live-dot" [class.live-dot--on]="g.active.onlineNow > 0"
                  aria-hidden="true"></span>
            <span class="dash-count">{{ g.active.onlineNow }} online now</span>
          </div>

          <div class="stat-row">
            <div class="stat-box"><div class="val">{{ g.active.daily }}</div><div class="lbl">Today</div></div>
            <div class="stat-box"><div class="val">{{ g.active.weekly }}</div><div class="lbl">This week</div></div>
            <div class="stat-box"><div class="val">{{ g.active.monthly }}</div><div class="lbl">This month</div></div>
            <div class="stat-box">
              <div class="val" [class.stat-warn]="g.active.stickiness < 20 && g.active.monthly > 20">
                {{ g.active.stickiness }}%
              </div>
              <div class="lbl">Daily / monthly</div>
            </div>
          </div>

          <p class="muted">
            Daily-over-monthly is the retention number: below about 20% means
            people sign up and don't come back. It's meaningless until you have
            a few hundred users.
          </p>

          @if (g.dailyActive.length > 0) {
            <div class="spark" role="img" aria-label="Active users over the last 30 days">
              @for (d of g.dailyActive; track d.day) {
                <div class="spark__bar" [style.height.%]="barHeight(d.users, maxActive())"
                     [title]="d.day + ': ' + d.users"></div>
              }
            </div>
          }

          <p class="field-hint">
            Active-user history starts when this measurement shipped, so earlier
            days read as zero. A person active on several days counts on the most
            recent, because only their latest visit is stored — no per-visit log
            exists.
          </p>
        </section>

        <section class="dash-section">
          <div class="dash-section-title">
            New sign-ups
            <span class="dash-count">
              ({{ g.totals.tenants + g.totals.landlords }} total)
            </span>
          </div>

          <div class="stat-row">
            <div class="stat-box"><div class="val">{{ g.signups.today }}</div><div class="lbl">Today</div></div>
            <div class="stat-box"><div class="val">{{ g.signups.week }}</div><div class="lbl">This week</div></div>
            <div class="stat-box"><div class="val">{{ g.signups.month }}</div><div class="lbl">This month</div></div>
            <div class="stat-box"><div class="val">{{ g.signups.year }}</div><div class="lbl">This year</div></div>
          </div>

          <table class="growth-table">
            <thead>
              <tr><th>Role</th><th>Today</th><th>Week</th><th>Month</th><th>Year</th><th>Total</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Tenants</td>
                <td>{{ g.signups.tenants.today }}</td>
                <td>{{ g.signups.tenants.week }}</td>
                <td>{{ g.signups.tenants.month }}</td>
                <td>{{ g.signups.tenants.year }}</td>
                <td><strong>{{ g.totals.tenants }}</strong></td>
              </tr>
              <tr>
                <td>Landlords</td>
                <td>{{ g.signups.landlords.today }}</td>
                <td>{{ g.signups.landlords.week }}</td>
                <td>{{ g.signups.landlords.month }}</td>
                <td>{{ g.signups.landlords.year }}</td>
                <td><strong>{{ g.totals.landlords }}</strong></td>
              </tr>
            </tbody>
          </table>

          <p class="muted">
            A room board needs both sides. If landlords stall while tenants grow,
            the board empties out and tenants leave — that ratio is worth more
            attention than either number alone.
          </p>
        </section>
      }

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
    .live-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
                background: var(--border); margin: 0 .4rem; vertical-align: middle; }
    .live-dot--on { background: var(--sage); box-shadow: 0 0 0 3px rgba(61,112,64,.18); }

    /* A sparkline rather than a chart library: it answers 'is this going up'
       at a glance, which is the only question at this scale. */
    .spark { display: flex; align-items: flex-end; gap: 2px; height: 60px;
             margin: 1rem 0 .5rem; }
    .spark__bar { flex: 1; background: var(--terra2); border-radius: 2px 2px 0 0;
                  min-height: 2px; transition: height .2s ease; }
    .spark__bar:hover { background: var(--terra); }

    .growth-table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: .85rem; }
    .growth-table th { text-align: left; font-weight: 600; color: var(--slate);
                       font-size: .75rem; text-transform: uppercase; letter-spacing: .05em;
                       padding: .4rem .5rem; border-bottom: 1px solid var(--border); }
    .growth-table td { padding: .5rem; border-bottom: 1px solid var(--border); color: var(--ink2); }
    .growth-table td:first-child { font-weight: 600; color: var(--ink); }

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
  growth = signal<Growth | null>(null);
  funnels = signal<Funnels | null>(null);
  signals = signal<ContentSignals | null>(null);
  loading = signal(true);

  /** Scales a bar to the tallest day, so a quiet month still shows shape. */
  barHeight(value: number, max: number) {
    return max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 4;
  }

  maxActive() {
    return Math.max(...(this.growth()?.dailyActive.map((d) => d.users) ?? [0]), 1);
  }

  ngOnInit() {
    this.admin.getGrowth().subscribe({
      next: (g) => this.growth.set(g),
      error: () => {},
    });

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
