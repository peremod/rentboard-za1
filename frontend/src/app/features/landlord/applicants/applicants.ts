import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApplicationsService } from '../../../core/services/applications.service';
import { Application } from '../../../core/models/application.model';
import { MessageThread } from '../../../shared/components/message-thread/message-thread';
import { ReviewList } from '../../../shared/components/review-list/review-list';
import { ReviewsService } from '../../../core/services/reviews.service';
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
  imports: [RouterLink, MessageThread, ReviewList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="applicants">
      <p><a routerLink="/landlord/dashboard">← Back to dashboard</a></p>
      <h1>Applicants</h1>

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
            <div class="applicant-card__header" (click)="toggleOpen(app)">
              <div>
                <strong>{{ app.tenant?.fullName }}</strong>
                @if (app.tenant?.isVerified) { <span class="pill">✓ Verified</span> }
                <span class="status status--{{ app.status }}">{{ app.status }}</span>
              </div>
              <span>{{ openId() === app.id ? '▲' : '▼' }}</span>
            </div>

            @if (openId() === app.id) {
              <div class="applicant-card__body">
                @if (app.coverNote) { <p class="cover-note">"{{ app.coverNote }}"</p> }

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
    h1 { font-size: 1.3rem; margin: .5rem 0 1.5rem; }
    .muted { color: #7A6E60; }
    .applicant-card { border: 1px solid #DDD5C8; border-radius: 8px; margin-bottom: .75rem; overflow: hidden; }
    .applicant-card__header { padding: .8rem 1rem; display: flex; justify-content: space-between; align-items: center; cursor: pointer; background: #FDFAF5; }
    .pill { font-size: .6rem; font-weight: 700; background: rgba(61,112,64,.1); color: #3D7040; padding: .1rem .4rem; border-radius: 10px; margin-left: .4rem; }
    .status { font-size: .65rem; font-weight: 700; text-transform: uppercase; padding: .15rem .5rem; border-radius: 10px; background: #F2EDE3; margin-left: .5rem; }
    .status--accepted { background: rgba(61,112,64,.15); color: #3D7040; }
    .status--rejected { background: rgba(214,59,59,.1); color: #D63B3B; }
    .applicant-card__body { padding: 0 1rem 1rem; }
    .cover-note { font-style: italic; color: #3A3228; margin: .5rem 0; }
    .applicant-card__refs { margin: .75rem 0; padding: .75rem 0; border-top: 1px solid #E0D5C4; }
    .refs-toggle { background: none; border: 1px solid #E0D5C4; border-radius: 6px; padding: .35rem .75rem;
                   font-size: .78rem; font-weight: 600; cursor: pointer; color: #3A3228; }
    .refs-note { font-size: .72rem; color: #7A6E60; line-height: 1.6; margin-top: .6rem; }
    .applicant-group { margin: 1.25rem 0 .5rem; }
    .applicant-group__title { font-size: .95rem; font-weight: 700; color: #3A3228; }
    .applicant-group__count { color: #7A6E60; font-weight: 400; }
    .applicant-group__hint { font-size: .8rem; color: #7A6E60; line-height: 1.6; margin-top: .2rem; }
    .applicant-card__actions { display: flex; gap: .5rem; margin-bottom: .5rem; flex-wrap: wrap; }
    .applicant-card__actions button { padding: .4rem .8rem; border-radius: 6px; border: 1px solid #DDD5C8; background: #fff; cursor: pointer; font-size: .78rem; font-weight: 600; }
    .applicant-card__actions .accept { background: #3D7040; color: #fff; border: none; }
    .applicant-card__actions .reject { background: #D63B3B; color: #fff; border: none; }

    /* Mobile — PRE-LAUNCH-CHECKLIST.md #9 */
    @media (max-width: 400px) {
      .applicant-card__header { flex-wrap: wrap; gap: .4rem; }
      .applicant-card__actions button { flex: 1; min-width: 90px; }
    }
  `],
})
export class Applicants implements OnInit {
  private reviewsService = inject(ReviewsService);

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
      next: (apps) => { this.applications.set(apps); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
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
}
