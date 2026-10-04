import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { NoticesService } from './notices';
import { ApplicationsService } from './applications.service';
import { LandlordInboxService } from './landlord-inbox.service';

/**
 * The counts the portal sidebar shows, loaded once for the whole portal.
 *
 * ── Why a service and not inputs
 *
 * Until Phase 7e every screen built its own nav items and passed its own
 * badges, so a count was only right on the screens that happened to fetch it:
 * the landlord dashboard knew the drafts count, the notices screen knew the
 * unread count, and nowhere knew both. Four screens had grown their own
 * `refreshUnread()` call just to stop the sidebar lying on that one page.
 *
 * The sidebar is now drawn once, by `PortalLayout`, so the counts belong once
 * too. A screen that CHANGES one of them calls `refresh()`.
 *
 * ── Loaded once per portal visit, not per page
 *
 * `loaded` guards it. Navigating between six portal screens must not be six
 * rounds of the same three requests — on a cheap phone on a slow connection
 * that is the whole difference between a portal that feels instant and one
 * that does not.
 *
 * ── Every failure is silent
 *
 * A badge is a hint. The HTTP interceptor already reports the error, and a
 * sidebar that cannot count is a sidebar without a number on it, not an error
 * banner on top of somebody's dashboard.
 */
@Injectable({ providedIn: 'root' })
export class PortalBadgesService {
  private auth = inject(AuthService);
  private notices = inject(NoticesService);
  private applications = inject(ApplicationsService);
  private landlordInbox = inject(LandlordInboxService);

  /**
   * Applicants waiting on this landlord — never opened, or they have said
   * something since. Phase 7d narrowed it from "every application ever", which
   * only went up and so was never read.
   */
  readonly applicantsWaiting = signal<number | undefined>(undefined);
  /** Rooms started and never published. */
  readonly drafts = signal<number | undefined>(undefined);

  /** Unread in-app notices. Lives on NoticesService, which the screen also reads. */
  readonly noticesUnread = this.notices.unreadCount;

  private loaded = false;

  /** Called by the layout on first paint. Does nothing on later navigations. */
  load() {
    if (this.loaded) return;
    this.loaded = true;
    this.refresh();
  }

  /**
   * Re-reads every count. For a screen that has just changed one of them —
   * accepting an applicant, publishing a draft, marking a notice read.
   */
  refresh() {
    this.notices.refreshUnread().subscribe({ error: () => {} });
    if (!this.auth.isLandlord()) return;

    this.applications.inbox({ sortBy: 'unread' }).subscribe({
      // Left undefined on failure rather than set to 0: a zero says "nobody is
      // waiting on you", which is a different claim from "we could not find out".
      next: (res) => this.applicantsWaiting.set(res.needsAttention),
      error: () => {},
    });
    /**
     * Drafts come from the health figures rather than from the rooms list.
     *
     * `rooms.total - rooms.live` is the draft count, and health is a small
     * response. Fetching every room with its photos and amenities to draw one
     * number in a sidebar would be the expensive way round.
     */
    this.landlordInbox.health().subscribe({
      next: (h) => this.drafts.set(Math.max(0, h.rooms.total - h.rooms.live)),
      error: () => {},
    });
  }
}
