import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { VerificationService } from '../../../core/services/verification.service';
import { BadgeBasis } from '../../../core/models/verification.model';
import { ApplicationsService } from '../../../core/services/applications.service';
import { Application } from '../../../core/models/application.model';
import { TenantNotes } from '../../../shared/components/tenant-notes/tenant-notes';
import { MessageThread } from '../../../shared/components/message-thread/message-thread';
import { ReviewList } from '../../../shared/components/review-list/review-list';
import { ReviewsService } from '../../../core/services/reviews.service';
import { DialogService } from '../../../core/services/dialog.service';
import { TenantReferences } from '../../../core/models/review.model';

/**
 * Applicant manager — one room's full applicant list, with shortlist/accept/
 * reject actions wired to the emails built in pass 0.5.0. Opening an
 * applicant's card marks it viewed (fires sendApplicationViewedEmail once,
 * idempotently — see backend markViewed()).
 */
@Component({
  selector: 'app-applicants',
  standalone: true,
  imports: [DatePipe, RouterLink, MessageThread, ReviewList, TenantNotes],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="applicants">
      <!-- Phase 6. A sub-lessor reaches this same screen from
           /tenant/sublet/:roomId/applicants, and a tenant account cannot open
           /landlord/dashboard — the link would have been a dead end back to a
           guard. The route's own data says which portal we are in. -->
      <p class="applicants__back">
        <a [routerLink]="backLink()">← Back to dashboard</a>
        <!-- Phase 7c. The portfolio-wide list is in the nav, but this screen is
             most often reached from a room card rather than from there, and
             somebody checking one room's applicants is usually about to check
             the next. The sub-lessor side has no such screen — see the route. -->
        @if (route.snapshot.data['listerType'] !== 'sublessor') {
          <a routerLink="/landlord/applicants">All applicants across your rooms →</a>
        }
      </p>

      @if (loading()) {
        <p>Loading…</p>
      } @else if (applications().length === 0) {
        <p class="muted">No applications yet for this room.</p>
      } @else {
        <!-- Grouped, shortlist first. A flat list meant a landlord with
             fifteen applicants had to re-find the three they liked every time
             they came back. -->
        @if (shortlisted().length > 0) {
          <div class="applicant-group">
            <h3 class="applicant-group__title">
              ⭐ Shortlisted <span class="applicant-group__count">({{ shortlisted().length }})</span>
            </h3>
            <p class="applicant-group__hint">
              Arrange viewings with these, then accept one. Accepting closes the
              room and tells everyone else.
            </p>
          </div>
        }

        @for (app of ordered(); track app.id) {
          @if (isFirstOf(app, 'other')) {
            <div class="applicant-group">
              <h3 class="applicant-group__title">
                New and viewed <span class="applicant-group__count">({{ others().length }})</span>
              </h3>
            </div>
          }
          @if (isFirstOf(app, 'decided')) {
            <div class="applicant-group">
              <h3 class="applicant-group__title">
                Decided <span class="applicant-group__count">({{ decided().length }})</span>
              </h3>
              <p class="applicant-group__hint">Accepted, rejected or withdrawn. No action needed.</p>
            </div>
          }
          <div class="applicant-card">
            <!-- A real button, not a clickable div.
                 This was a div with a (click) handler and no role, tabindex or
                 key handler, so the ONLY way to open an applicant was to tap or
                 click: a landlord on a keyboard could not reach any applicant's
                 details, references, or the Accept and Reject buttons at all.
                 Phase 7c fixed exactly this on the unified inbox, for exactly
                 this reason; this older per-room screen kept the div, and
                 Phase 7e then made the screen reachable from the nav. -->
            <button type="button" class="applicant-card__header"
                    [attr.aria-expanded]="openId() === app.id"
                    [attr.aria-controls]="'applicant-body-' + app.id"
                    (click)="toggleOpen(app)">
              <span class="applicant-card__who">
                <strong>{{ app.tenant?.fullName }}</strong>
                @if (app.tenant?.isVerified) { <span class="pill">✓ Verified</span> }
                @if (app.tenant?.tenantProfile?.hasPassport) { <span class="pill pill--passport">🛂 Passport</span> }
                <span class="status status--{{ app.status }}">{{ app.status }}</span>
              </span>
              <span aria-hidden="true">{{ openId() === app.id ? '▲' : '▼' }}</span>
            </button>

            @if (openId() === app.id) {
              <div class="applicant-card__body" [id]="'applicant-body-' + app.id">
                <!-- The landlord's own private notes (Phase 5e). Here because
                     this is where they actually look at a person — and only
                     inside the expanded card, so a list of six applicants is not
                     six open text areas. -->
                @if (app.tenant?.id) {
                  <app-tenant-notes
                    [tenantId]="app.tenant!.id"
                    [tenantName]="app.tenant?.fullName ?? 'this person'"/>
                }
                @if (app.tenant?.tenantProfile?.hasPassport) {
                  <!-- What the badge rests on. Passed checks and their dates,
                       nothing else: the API deliberately never returns a
                       rejection or an admin's note, because a landlord reading
                       "income proof: rejected" would be screening on a private
                       failure. -->
                  <div class="passport-basis">
                    <strong>🛂 Renter's Passport</strong>
                    @if (basis()[app.tenant!.id]; as checks) {
                      <ul>
                        @for (check of checks.checks; track check.type) {
                          <li>✓ {{ check.label }}<span>{{ check.confirmedAt | date: 'MMM yyyy' }}</span></li>
                        }
                      </ul>
                    } @else {
                      <button type="button" class="link-btn" (click)="loadBasis(app.tenant!.id)">
                        See what was checked
                      </button>
                    }
                    <p>
                      Mastande checked these documents and deleted them. It is not a
                      credit check — it means a person confirmed the paperwork.
                    </p>
                  </div>
                }
                @if (app.coverNote) { <p class="cover-note">"{{ app.coverNote }}"</p> }

                <!-- Accepting lets the room and rejects everyone else, so the
                     way back has to be visible at the moment it matters. -->
                @if (app.status === 'accepted' && canUndo(app)) {
                  <div class="undo-banner">
                    <span>
                      Accepted. The room is off the board and the other applicants
                      have been told.
                    </span>
                    <button type="button" class="btn btn-sm btn-outline"
                            [disabled]="undoing() === app.id" (click)="undoAccept(app)">
                      {{ undoing() === app.id ? 'Undoing…' : 'Undo' }}
                    </button>
                  </div>
                  <p class="undo-note">You can reverse this for 30 minutes.</p>
                }

                @if (!['accepted','rejected','withdrawn'].includes(app.status)) {
                  <div class="applicant-card__actions">
                    @if (app.status !== 'shortlisted') {
                      <button type="button" (click)="shortlist(app)">⭐ Shortlist</button>
                    } @else {
                      <button type="button" (click)="unshortlist(app)">Remove from shortlist</button>
                    }
                    <button type="button" class="accept" (click)="accept(app)">✓ Accept</button>
                    <button type="button" class="reject" (click)="reject(app)">✕ Reject</button>
                  </div>
                }

                <div class="applicant-card__refs">
                  <button type="button" class="refs-toggle" (click)="toggleRefs(app)">
                    {{ openRefs() === app.id ? 'Hide references' : '📄 References' }}
                  </button>

                  @if (openRefs() === app.id) {
                    @if (refsLoading()) {
                      <p class="muted">Loading…</p>
                    } @else if (refsError()) {
                      <p class="field-error">{{ refsError() }}</p>
                    } @else if (refs(); as data) {
                      @if (data.note) {
                        <p class="muted">{{ data.note }}</p>
                      }
                      <app-review-list [reviews]="data.reviews" emptyMessage=""/>
                      <p class="refs-note">
                        References are shown only while this application is open, and only to you.
                        They are not public and do not appear on this person's profile.
                      </p>
                    }
                  }
                </div>

                <app-message-thread [applicationId]="app.id"/>
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .applicants { max-width: 640px; margin: 2rem auto; padding: 0 1.25rem; font-family: sans-serif; }
    .applicants__back { display: flex; gap: 1rem; flex-wrap: wrap; justify-content: space-between; font-size: .85rem; }
    h1 { font-size: 1.3rem; margin: .5rem 0 1.5rem; }
    .muted { color: var(--slate); }
    .applicant-card { border: 1px solid #DDD5C8; border-radius: 8px; margin-bottom: .75rem; overflow: hidden; }
    /* ⚠️ A button needs its inherited text put back BY NAME.
       The font: inherit shorthand restores family and size and NOT colour -
       which is how Phase 7c shipped inbox rows rendering white-on-cream at
       1.06:1, present and invisible. So colour and text-align are explicit
       here. (No backticks in a styles block: they close the template literal.
       Fourth compile failure in this codebase from that, CLAUDE.md names it.) */
    .applicant-card__header {
      padding: .8rem 1rem; display: flex; justify-content: space-between;
      align-items: center; cursor: pointer; background: #FDFAF5;
      width: 100%; border: none; font: inherit; color: var(--ink);
      text-align: left; gap: .5rem; min-height: 44px;
    }
    .applicant-card__who { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem; }
    .pill { font-size: .6rem; font-weight: 700; background: rgba(61,112,64,.1); color: #3D7040; padding: .1rem .4rem; border-radius: 10px; margin-left: .4rem; }
    .status { font-size: .65rem; font-weight: 700; text-transform: uppercase; padding: .15rem .5rem; border-radius: 10px; background: #F2EDE3; margin-left: .5rem; }
    .status--accepted { background: rgba(61,112,64,.15); color: #3D7040; }
    .status--rejected { background: rgba(214,59,59,.1); color: #D63B3B; }
    .applicant-card__body { padding: 0 1rem 1rem; }
    .cover-note { font-style: italic; color: #3A3228; margin: .5rem 0; }
    .applicant-card__refs { margin: .75rem 0; padding: .75rem 0; border-top: 1px solid #E0D5C4; }
    .refs-toggle { background: none; border: 1px solid #E0D5C4; border-radius: 6px; padding: .35rem .75rem;
                   font-size: .78rem; font-weight: 600; cursor: pointer; color: #3A3228; }
    .refs-note { font-size: .72rem; color: var(--slate); line-height: 1.6; margin-top: .6rem; }
    .undo-banner { display: flex; align-items: center; justify-content: space-between;
                   gap: .75rem; flex-wrap: wrap; padding: .7rem .9rem; margin-bottom: .4rem;
                   background: rgba(61,112,64,.08); border: 1px solid rgba(61,112,64,.25);
                   border-radius: 8px; font-size: .85rem; color: #3A3228; }
    .undo-note { font-size: .75rem; color: var(--slate); margin-bottom: .5rem; }
    .applicant-group { margin: 1.25rem 0 .5rem; }
    .applicant-group__title { font-size: .95rem; font-weight: 700; color: #3A3228; }
    .applicant-group__count { color: var(--slate); font-weight: 400; }
    .applicant-group__hint { font-size: .8rem; color: var(--slate); line-height: 1.6; margin-top: .2rem; }
    .applicant-card__actions { display: flex; gap: .6rem; margin-bottom: .5rem; flex-wrap: wrap; }
    /* ⚠️ These measured 28px tall and sat 8px apart — Accept beside Reject, on
       a phone, on the landlord's most consequential screen. Under the 44px tap
       target of WCAG 2.5.8, and a mis-tap decides somebody's housing. (It is
       reversible for 30 minutes, which is why this is a size fix rather than a
       redesign of the row.) */
    .applicant-card__actions button {
      padding: .4rem .9rem; min-height: 44px; border-radius: 6px;
      border: 1px solid #DDD5C8; background: #fff; cursor: pointer;
      font-size: .78rem; font-weight: 600;
    }
    .applicant-card__actions .accept { background: #3D7040; color: #fff; border: none; }
    .applicant-card__actions .reject { background: #D63B3B; color: #fff; border: none; }

    /* Mobile — PRE-LAUNCH-CHECKLIST.md #9.
       480px, not 400px: the breakpoints this codebase uses are 900/768/480
       (styles/_responsive.scss), and at 430px — an iPhone 14 Pro Max — the
       400px rule did not apply, so the row kept its desktop layout on one of
       the commonest phone widths in the market. */
    @media (max-width: 480px) {
      .applicant-card__header { flex-wrap: wrap; gap: .4rem; }
      .applicant-card__actions button { flex: 1; min-width: 90px; }
    }
  `],
})
export class Applicants implements OnInit {
  /**
   * Where "back" goes: the portal this screen was opened from.
   *
   * Read from route data rather than from the signed-in role, because the role
   * is not the question — an ADMIN opening a sub-lessor's applicants in support
   * belongs back where they came from too.
   */
  route = inject(ActivatedRoute);

  backLink(): string {
    return this.route.snapshot.data['listerType'] === 'sublessor'
      ? '/tenant/dashboard'
      : '/landlord/dashboard';
  }

  private reviewsService = inject(ReviewsService);
  private dialogs = inject(DialogService);

  undoing = signal<string | null>(null);
  private verification = inject(VerificationService);
  /**
   * Badge bases, by tenant id, fetched on demand.
   *
   * Not loaded with the list on purpose. Pulling every applicant's checks
   * eagerly would mean requesting personal information about people whose
   * applications the landlord may never open — the same call already made for
   * tenant references on this page.
   */
  basis = signal<Record<string, BadgeBasis>>({});
  openRefs = signal<string | null>(null);
  refs = signal<TenantReferences | null>(null);
  refsLoading = signal(false);
  refsError = signal<string | null>(null);

  /**
   * References are fetched on demand rather than with the applicant list: the
   * API only permits them while the application is live, and pulling them
   * eagerly would mean requesting personal information about people whose
   * applications the landlord may never open.
   */
  /** Shortlisted first, then undecided, then finished. */
  shortlisted() {
    return this.applications().filter((a) => a.status === 'shortlisted');
  }

  others() {
    return this.applications().filter((a) => a.status === 'pending' || a.status === 'viewed');
  }

  decided() {
    return this.applications().filter((a) =>
      ['accepted', 'rejected', 'withdrawn'].includes(a.status),
    );
  }

  ordered() {
    return [...this.shortlisted(), ...this.others(), ...this.decided()];
  }

  /** Drives the group heading before the first row of each band. */
  isFirstOf(app: { id: string }, band: 'other' | 'decided') {
    const list = band === 'other' ? this.others() : this.decided();
    return list.length > 0 && list[0].id === app.id;
  }

  /**
   * The undo window is 30 minutes from the decision, matching the server. The
   * button is hidden rather than shown-and-failing once it has passed.
   */
  canUndo(app: Application): boolean {
    if (app.status !== 'accepted' || !app.decidedAt) return false;
    return Date.now() - new Date(app.decidedAt).getTime() < 30 * 60 * 1000;
  }

  async undoAccept(app: Application) {
    const confirmed = await this.dialogs.confirm(
      'Undo this acceptance?',
      'The room goes back on the board and the applicants this acceptance rejected are reinstated. ' +
      'Anyone you rejected yourself stays rejected.',
      'Undo it',
      'Leave it',
    );
    if (!confirmed) return;

    this.undoing.set(app.id);
    this.applicationsService.undoAccept(app.id).subscribe({
      next: (res) => {
        this.undoing.set(null);
        this.dialogs.success('Acceptance undone', res.message);
        this.ngOnInit();   // the existing refresh path, as relist uses
      },
      error: (err) => {
        this.undoing.set(null);
        this.dialogs.error(err?.error?.message ?? 'That could not be undone.');
      },
    });
  }

  toggleRefs(app: { id: string; tenant?: { id: string } }) {
    if (this.openRefs() === app.id) {
      this.openRefs.set(null);
      return;
    }
    const tenantId = app.tenant?.id;
    if (!tenantId) return;

    this.openRefs.set(app.id);
    this.refs.set(null);
    this.refsError.set(null);
    this.refsLoading.set(true);

    this.reviewsService.getTenantReferences(tenantId).subscribe({
      next: (data) => { this.refs.set(data); this.refsLoading.set(false); },
      error: (err) => {
        this.refsLoading.set(false);
        this.refsError.set(err?.error?.message ?? 'References are not available for this applicant.');
      },
    });
  }

  /** Bound from :roomId route segment. */
  roomId = input.required<string>();

  private applicationsService = inject(ApplicationsService);

  applications = signal<Application[]>([]);
  loading = signal(true);
  openId = signal<string | null>(null);

  ngOnInit() {
    this.applicationsService.getRoomApplications(this.roomId()).subscribe({
      next: (apps) => {
        this.applications.set(apps);
        this.loading.set(false);
        this.openRequested(apps);
      },
      error: () => this.loading.set(false),
    });
  }

  /**
   * `?open=<applicationId>` expands that applicant — Phase 7c.
   *
   * The all-applicants screen lists people across every room; its rows have to
   * land somewhere, and landing on the room alone would mean a list that tells
   * you somebody is waiting and then makes you find them again. That is not
   * saved work, it is moved work.
   *
   * An id that is not in this room's list is ignored rather than errored: a
   * stale link, or one for an application that has since been archived, should
   * open the room's applicants normally. Only read on the first load — after
   * that the landlord is driving, and re-expanding a card they just collapsed
   * because the URL still says so would fight them.
   */
  private openRequested(apps: Application[]) {
    const wanted = this.route.snapshot.queryParamMap.get('open');
    if (!wanted) return;
    const match = apps.find((a) => a.id === wanted);
    if (match) this.toggleOpen(match);
  }

  toggleOpen(app: Application) {
    const opening = this.openId() !== app.id;
    this.openId.set(opening ? app.id : null);
    if (opening && app.status === 'pending') {
      this.applicationsService.markViewed(app.id).subscribe((updated) => this.patch(app.id, updated));
    }
  }

  shortlist(app: Application) {
    this.applicationsService.shortlist(app.id).subscribe((updated) => this.patch(app.id, updated));
  }
  unshortlist(app: Application) {
    this.applicationsService.unshortlist(app.id).subscribe((updated) => this.patch(app.id, updated));
  }

  accept(app: Application) {
    this.applicationsService.accept(app.id).subscribe(() => {
      // Accepting one applicant auto-rejects the rest server-side — simplest correct
      // client behaviour is to reload the full list rather than patch every row.
      this.ngOnInit();
    });
  }

  reject(app: Application) {
    this.applicationsService.reject(app.id).subscribe((updated) => this.patch(app.id, updated));
  }

  private patch(id: string, updated: Application) {
    this.applications.update((apps) => apps.map((a) => (a.id === id ? { ...a, ...updated } : a)));
  }

  loadBasis(tenantId: string) {
    if (this.basis()[tenantId]) return;
    this.verification.badgeBasis(tenantId).subscribe({
      next: (b) => this.basis.update((map) => ({ ...map, [tenantId]: b })),
      // Silent: a badge whose detail will not load is a missing explanation,
      // not an error worth interrupting the applicant list for.
      error: () => {},
    });
  }
}
