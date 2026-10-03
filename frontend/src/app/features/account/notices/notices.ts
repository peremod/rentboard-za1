import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { PortalShell, PortalNavItem } from '../../../shared/components/portal-shell/portal-shell';
import { AuthService } from '../../../core/services/auth.service';
import { NoticesService, Notice } from '../../../core/services/notices';
import { landlordNav } from '../../landlord/landlord-nav';
import { tenantNav } from '../../tenant/tenant-nav';
import { ADMIN_NAV } from '../../admin/admin-nav';

/**
 * Your notices — Phase 7g.
 *
 * ── Why a screen for this at all
 *
 * Because `NoticeRouter` had been writing these rows since v1.85.0 and nothing
 * could read them. For an account with no email address the notice is not a
 * convenience on top of email — it is the only channel that cannot fail for
 * reasons outside our control, since WhatsApp refuses free-form text outside
 * its 24-hour window. So "you have a new applicant" was being recorded
 * faithfully and shown to nobody.
 *
 * ── What it deliberately shows
 *
 * The WhatsApp outcome, per notice, in plain words. A landlord who is waiting
 * on WhatsApp and getting nothing should be able to see that the message was
 * refused rather than conclude the portal is broken or that nobody applied.
 * `whatsappError` exists precisely so that gap is visible instead of silent,
 * and hiding it on screen would put the silence back.
 */
@Component({
  selector: 'app-notices',
  standalone: true,
  imports: [PortalShell, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems()" [roleLabel]="roleLabel()" pageTitle="Your notices">
      <section class="dash-section">
        <div class="notices-head">
          <h2 class="dash-section-title">Everything we have told you</h2>
          @if (notices.unreadCount() > 0) {
            <button type="button" class="btn btn-ghost" (click)="markAllRead()">
              Mark all as read
            </button>
          }
        </div>

        <!-- Three states, not two. "Nothing yet" on a failed request is the
             page telling somebody nobody applied, which is the one thing this
             screen exists to get right. -->
        @if (failed()) {
          <p class="notices-empty" role="alert">
            We could not load your notices just now — this is a problem at our
            end, not an empty list. Pull down to refresh, or
            <button type="button" class="link-button" (click)="reload()">try again</button>.
          </p>
        } @else if (loading()) {
          <p class="notices-empty">Loading…</p>
        } @else if (notices.notices().length === 0) {
          <p class="notices-empty">
            Nothing yet. When somebody applies for one of your rooms, or there is
            something you need to know, it will appear here — and on WhatsApp if
            we can reach you there.
          </p>
        }

        <ul class="notices-list">
          @for (n of notices.notices(); track n.id) {
            <li class="notice" [class.is-unread]="!n.readAt">
              <div class="notice-main">
                <h3 class="notice-title">{{ n.title }}</h3>
                @if (n.body) { <p class="notice-body">{{ n.body }}</p> }
                <p class="notice-meta">
                  {{ n.createdAt | date: 'd MMM y, HH:mm' }}
                  @if (n.whatsappSentAt) {
                    · also sent on WhatsApp
                  } @else if (n.whatsappError) {
                    · WhatsApp could not deliver this one
                  }
                </p>
              </div>
              <div class="notice-actions">
                @if (n.link) {
                  <button type="button" class="btn btn-primary btn-sm" (click)="open(n)">
                    Open
                  </button>
                }
                @if (!n.readAt) {
                  <button type="button" class="btn btn-ghost btn-sm" (click)="markRead(n)">
                    Mark read
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      </section>
    </app-portal-shell>
  `,
  styles: `
    .notices-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 1rem; flex-wrap: wrap;
    }
    .notices-empty { color: var(--slate); line-height: 1.6; max-width: 34rem; }
    .notices-list { list-style: none; padding: 0; margin: 1rem 0 0; }
    .notice {
      display: flex; gap: 1rem; align-items: flex-start; justify-content: space-between;
      padding: .9rem 0; border-bottom: 1px solid var(--border); flex-wrap: wrap;
    }
    /* Unread is marked with a left bar rather than a bold font: on a cheap
       phone screen in daylight a weight change is close to invisible. */
    .notice.is-unread {
      border-left: 3px solid var(--terra);
      padding-left: .75rem;
      margin-left: -.75rem;
    }
    .notice-title { font-size: .95rem; margin: 0 0 .2rem; }
    .notice-body { margin: 0 0 .3rem; line-height: 1.5; }
    .notice-meta { font-size: .75rem; color: var(--slate); margin: 0; }
    .notice-actions { display: flex; gap: .5rem; flex-shrink: 0; }
    /* A button that reads as a link, so the retry sits inside the sentence
       rather than below it as a second block. */
    .link-button {
      background: none; border: none; padding: 0; font: inherit;
      color: var(--terra); text-decoration: underline; cursor: pointer;
    }
  `,
})
export class Notices implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  notices = inject(NoticesService);

  roleLabel = () =>
    this.auth.isAdmin() ? 'Admin' : this.auth.isLandlord() ? 'Landlord' : 'Tenant';

  navItems = (): PortalNavItem[] =>
    this.auth.isAdmin()
      ? ADMIN_NAV
      : this.auth.isLandlord()
        ? landlordNav({ notices: this.notices.unreadCount() })
        : tenantNav({ notices: this.notices.unreadCount() });

  /** Distinguished from "no notices" — see the template. */
  readonly loading = signal(true);
  readonly failed = signal(false);

  ngOnInit() {
    this.reload();
  }

  reload() {
    this.loading.set(true);
    this.failed.set(false);
    this.notices.load().subscribe({
      next: () => this.loading.set(false),
      error: () => { this.loading.set(false); this.failed.set(true); },
    });
  }

  markRead(n: Notice) {
    this.notices.markRead(n.id).subscribe({ error: () => {} });
  }

  markAllRead() {
    this.notices.markAllRead().subscribe({ error: () => {} });
  }

  /**
   * Opening a notice marks it read and goes where it points.
   *
   * The link is always an in-app path — the Notice model forbids an absolute
   * URL, because a hardcoded host is how a staging link ends up in a production
   * notice — so this navigates by router rather than by href.
   */
  open(n: Notice) {
    if (!n.readAt) this.notices.markRead(n.id).subscribe({ error: () => {} });
    if (n.link) this.router.navigateByUrl(n.link).catch(() => {});
  }
}
