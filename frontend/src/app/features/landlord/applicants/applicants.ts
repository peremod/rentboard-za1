import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApplicationsService } from '../../../core/services/applications.service';
import { Application } from '../../../core/models/application.model';
import { MessageThread } from '../../../shared/components/message-thread/message-thread';

/**
 * Applicant manager — one room's full applicant list, with shortlist/accept/
 * reject actions wired to the emails built in pass 0.5.0. Opening an
 * applicant's card marks it viewed (fires sendApplicationViewedEmail once,
 * idempotently — see backend markViewed()).
 */
@Component({
  selector: 'app-applicants',
  standalone: true,
  imports: [RouterLink, MessageThread],
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
        @for (app of applications(); track app.id) {
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
                    }
                    <button type="button" class="accept" (click)="accept(app)">✓ Accept</button>
                    <button type="button" class="reject" (click)="reject(app)">✕ Reject</button>
                  </div>
                }

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
    .applicant-card__actions { display: flex; gap: .5rem; margin-bottom: .5rem; }
    .applicant-card__actions button { padding: .4rem .8rem; border-radius: 6px; border: 1px solid #DDD5C8; background: #fff; cursor: pointer; font-size: .78rem; font-weight: 600; }
    .applicant-card__actions .accept { background: #3D7040; color: #fff; border: none; }
    .applicant-card__actions .reject { background: #D63B3B; color: #fff; border: none; }
  `],
})
export class Applicants implements OnInit {
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
