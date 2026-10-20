import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { NoticesService, Notice } from '../../../core/services/notices';
import { Loading } from '../../../shared/components/loading/loading';
import { ErrorState } from '../../../shared/components/error-state/error-state';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';

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
  imports: [DatePipe, Loading, ErrorState, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
      <section class="dash-section">
        <div class="notices-head">
          <h2 class="dash-section-title">Everything we have told you</h2>
          @if (notices.unreadCount() > 0) {
            <!-- ⚠️ btn-ghost-LIGHT. btn-ghost is the navbar's: cream text at
                 75% on a transparent background, which is right on the dark
                 header bar and invisible on this cream page. a11y-drive
                 measured it at 1.00:1 the moment it first rendered here —
                 and it only rendered here once notices started being written
                 for people with an email address, because the button is only
                 shown when something is unread. An invisible control nothing
                 could see, behind a row nothing wrote. -->
            <button type="button" class="btn btn-ghost-light" (click)="markAllRead()">
              Mark all as read
            </button>
          }
        </div>

        <!-- Three states, not two. "Nothing yet" on a failed request is the
             page telling somebody nobody applied, which is the one thing this
             screen exists to get right. -->
        @if (failed()) {
          <app-error-state (retry)="reload()">
            We could not load your notices just now — this is a problem at our
            end, not an empty list.
          </app-error-state>
        } @else if (loading()) {
          <app-loading/>
        } @else if (notices.notices().length === 0) {
          <!-- ⚠️ This used to end "— and on WhatsApp if we can reach you
               there." WHATSAPP_ENABLED is false, so that was a promise of a
               message that is never sent, which CLAUDE.md forbids outright.
               whatsapp-off-drive could not see it: it checked four
               hardcoded files and this was not one of them. -->
          <app-empty-state>
            Nothing yet. When somebody applies for one of your rooms, or there is
            something you need to know, it will appear here. This screen is the
            record — nothing is sent anywhere else.
          </app-empty-state>
        }

        <!-- ── One open at a time ───────────────────────────────────
             Reported 15 October: a long list of notices, every one fully
             expanded, with the body text running past the edge of a phone.
             A notice is a headline plus a detail somebody may not need, so
             the headline is what the list shows and the rest opens on a tap.

             The head is a real <button> with aria-expanded and aria-controls,
             not a clickable div: the applicant cards on the landlord side had
             to be fixed for exactly that, and a list nobody can reach with a
             keyboard is a list some people cannot read at all. -->
        <ul class="notices-list">
          @for (n of notices.notices(); track n.id) {
            <li class="notice" [class.is-unread]="!n.readAt" [class.is-open]="openId() === n.id">
              <button type="button" class="notice-head"
                      [attr.aria-expanded]="openId() === n.id"
                      [attr.aria-controls]="'notice-body-' + n.id"
                      (click)="toggle(n)">
                <span class="notice-headline">
                  <span class="notice-title">{{ n.title }}</span>
                  <span class="notice-meta">
                    {{ n.createdAt | date: 'd MMM y, HH:mm' }}
                    @if (n.whatsappSentAt) {
                      · also sent on WhatsApp
                    } @else if (n.whatsappError) {
                      · WhatsApp could not deliver this one
                    }
                    @if (!n.readAt) { · <span class="notice-new">new</span> }
                  </span>
                </span>
                <span class="notice-chevron" aria-hidden="true">{{ openId() === n.id ? '▲' : '▼' }}</span>
              </button>

              @if (openId() === n.id) {
                <div class="notice-detail" [id]="'notice-body-' + n.id">
                  @if (n.body) {
                    <p class="notice-body">{{ n.body }}</p>
                  } @else {
                    <p class="notice-body muted">
                      There is nothing more to this one than the line above.
                    </p>
                  }
                  <div class="notice-actions">
                    @if (n.link) {
                      <button type="button" class="btn btn-primary btn-sm" (click)="open(n)">
                        Open
                      </button>
                    }
                    @if (!n.readAt) {
                      <button type="button" class="btn btn-ghost-light btn-sm" (click)="markRead(n)">
                        Mark read
                      </button>
                    }
                  </div>
                </div>
              }
            </li>
          }
        </ul>
      </section>
  `,
  styles: `
    .notices-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 1rem; flex-wrap: wrap;
    }
    .notices-empty { color: var(--slate); line-height: 1.6; max-width: 34rem; }
    .notices-list { list-style: none; padding: 0; margin: 1rem 0 0; }
    .notice { border-bottom: 1px solid var(--border); }
    /* Unread is marked with a left bar rather than a bold font: on a cheap
       phone screen in daylight a weight change is close to invisible. */
    .notice.is-unread {
      border-left: 3px solid var(--terra);
      padding-left: .75rem;
      margin-left: -.75rem;
    }
    .notice-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: .75rem; width: 100%; min-height: 44px;
      padding: .75rem 0; border: none; background: none; cursor: pointer;
      font: inherit; color: var(--ink); text-align: left;
    }
    /* min-width: 0 on the growing child. A flex item will not shrink below its
       content, so without this a long title holds the row open and the text
       runs past the edge of a 360px screen — the defect reported here, and the
       same one that pushed the room page sideways by 171px. */
    .notice-headline { display: grid; gap: .2rem; min-width: 0; flex: 1 1 auto; }
    .notice-title {
      font-size: .95rem; font-weight: 700; line-height: 1.35;
      /* The title is a sentence with a room name in it: it wraps, and a word
         longer than the box breaks rather than spilling out of it. */
      white-space: normal; overflow-wrap: anywhere;
    }
    .notice-meta { font-size: .75rem; color: var(--slate); white-space: normal; }
    .notice-new { color: var(--terra); font-weight: 700; }
    .notice-chevron { font-size: .7rem; color: var(--slate); flex-shrink: 0; line-height: 2; }
    .notice-detail { padding: 0 0 .75rem; display: grid; gap: .5rem; }
    .notice-body {
      margin: 0; line-height: 1.6; max-width: 42rem;
      white-space: pre-line; overflow-wrap: anywhere;
    }
    .notice-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
    /* A button that reads as a link, so the retry sits inside the sentence
       rather than below it as a second block. */
  `,
})
export class Notices implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  notices = inject(NoticesService);

  /** Distinguished from "no notices" — see the template. */
  readonly loading = signal(true);
  readonly failed = signal(false);

  /**
   * The one notice that is open. One at a time, deliberately: this list is
   * read newest-first to find a single thing, and a screen of open panels is
   * what it looked like before.
   */
  readonly openId = signal<string | null>(null);

  /**
   * Opening a notice is reading it, so it stops being unread.
   *
   * ⚠️ Marked read on OPEN, not on render. A list that marks everything read
   * as it scrolls past clears the badge for things nobody looked at, and the
   * badge is the only thing telling somebody to come back here.
   */
  toggle(n: Notice) {
    const next = this.openId() === n.id ? null : n.id;
    this.openId.set(next);
    if (next && !n.readAt) this.markRead(n);
  }

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
