import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { WhatsappDraftsService, WhatsappDraft } from '../../../core/services/whatsapp-drafts.service';
import { AuthService } from '../../../core/services/auth.service';
import { RoomsService } from '../../../core/services/rooms.service';
import { DialogService } from '../../../core/services/dialog.service';
import { Room } from '../../../core/models/room.model';
import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';
import { BILLING_ENABLED } from '../../../core/config/feature-flags';
import { PortalShell, PortalNavItem } from '../../../shared/components/portal-shell/portal-shell';
import { ReviewPrompt } from '../../../shared/components/review-prompt/review-prompt';
import { ReferralPanel } from '../../../shared/components/referral-panel/referral-panel';

/**
 * Billing (Upgrade link, Boost button) is hidden behind BILLING_ENABLED —
 * see core/config/feature-flags.ts. While it's off, every listing is free,
 * unlimited, up to 20 photos, with one-click relist for archived rooms —
 * the "Relist" section below is that feature actually surfaced in the UI
 * (previously the backend/service method existed but nothing called it).
 */
@Component({
  selector: 'app-landlord-dashboard',
  standalone: true,
  imports: [RouterLink, ZarCentsPipe, DatePipe, PortalShell, ReviewPrompt, ReferralPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-portal-shell [navItems]="navItems()" roleLabel="Landlord"
                      [primaryAction]="{ label: '+ List a Room', route: '/landlord/rooms/new' }">

      <!-- A listing dictated over WhatsApp, waiting to be finished. Top of
           the page because the landlord sent it from their phone and is
           coming here to find it — burying it below the stats would mean the
           feature quietly not working. -->
      @for (draft of whatsappDrafts.drafts(); track draft.id) {
        <div class="wa-draft">
          <div class="wa-draft__head">
            <strong>💬 A listing you started on WhatsApp</strong>
            <span>{{ draft.imagePaths.length }} photo{{ draft.imagePaths.length === 1 ? '' : 's' }}</span>
          </div>
          <p class="wa-draft__parsed">
            {{ draft.parsedTitle || 'No title yet' }}
            @if (draft.parsedRentCents) { · {{ draft.parsedRentCents | zarCents }}/mo }
            @if (draft.parsedSuburb || draft.parsedCity) { · {{ draft.parsedSuburb || draft.parsedCity }} }
          </p>
          <p class="wa-draft__note">
            Nothing is on the board yet. Open it to check what we read, add
            anything missing, and publish.
          </p>
          <button type="button" class="btn btn-primary btn-sm"
                  [disabled]="claiming() === draft.id" (click)="claimDraft(draft)">
            {{ claiming() === draft.id ? 'Opening…' : 'Check and publish' }}
          </button>
        </div>
      }

      <div class="insight-banner">
        📊
        <span>
          You have <strong>{{ activeCount() }}</strong> active
          {{ activeCount() === 1 ? 'room' : 'rooms' }} and
          <strong>{{ totalApplicants() }}</strong> total
          {{ totalApplicants() === 1 ? 'applicant' : 'applicants' }}.
          Landlords who reply within 24 hours get far more viewings.
        </span>
      </div>

      <div class="stat-row">
        <div class="stat-box"><div class="val">{{ totalViews() }}</div><div class="lbl">Total views</div></div>
        <div class="stat-box"><div class="val">{{ totalApplicants() }}</div><div class="lbl">Applications</div></div>
        <div class="stat-box"><div class="val">{{ activeCount() }}</div><div class="lbl">Active rooms</div></div>
        <div class="stat-box"><div class="val">{{ archivedRooms().length }}</div><div class="lbl">Previously let</div></div>
      </div>

      @if (!billingEnabled) {
        <div class="insight-banner" style="background:rgba(61,112,64,.08);border-color:rgba(61,112,64,.2)">
          🎉 <span>Free for everyone right now — unlimited listings, up to 20 photos per room, one-click relist.</span>
        </div>
      }

      <app-review-prompt/>

      <section class="dash-section">
        <div class="dash-section-title">Active listings</div>

        @if (loading()) {
          <p class="muted">Loading…</p>
        } @else if (rooms().length === 0) {
          <div class="empty-state">
            <h3>No rooms listed yet</h3>
            <p>List your first room — it's free, and takes a couple of minutes.</p>
            <a class="btn btn-primary" routerLink="/landlord/rooms/new">List a room free</a>
          </div>
        } @else {
          @for (room of activeRooms(); track room.id) {
            <div class="app-card">
              <div class="app-thumb portal-thumb" aria-hidden="true">🏠</div>
              <div class="app-info">
                <div class="app-room">
                  {{ room.title }}
                  @if (room.isFeatured) { <span class="badge badge-featured">⭐ Featured</span> }
                </div>
                <div class="app-location">{{ room.locationDisplay }}</div>
                <div class="app-rent">
                  {{ room.rentCents | zarCents:'monthly' }} ·
                  <span [class]="'status-dot status-dot--' + room.status">● {{ room.status }}</span>
                </div>
              </div>
              <div class="portal-row-actions">
                <a class="btn btn-sm btn-outline"
                   [routerLink]="['/landlord/rooms', room.id, 'applicants']">
                  {{ room.applicationCount }} applicant{{ room.applicationCount === 1 ? '' : 's' }}
                </a>
                <a class="btn btn-sm btn-ghost-light" [routerLink]="['/landlord/rooms', room.id, 'edit']">
                  Edit
                </a>
                <a class="btn btn-sm btn-ghost-light" [routerLink]="['/rooms', room.id]">View</a>
                @if (room.status === 'active') {
                  <button type="button" class="btn btn-sm btn-sage"
                          [disabled]="marking() === room.id" (click)="markLet(room)">
                    {{ marking() === room.id ? 'Saving…' : 'Mark as Let ✓' }}
                  </button>
                  <button type="button" class="btn btn-sm btn-ghost-light"
                          [disabled]="pausing() === room.id" (click)="pause(room)">
                    Pause
                  </button>
                }
                @if (room.status !== 'draft') {
                  <button type="button" class="btn btn-sm btn-ghost-light"
                          [disabled]="removing() === room.id" (click)="removeListing(room)">
                    @if (removing() === room.id) {
                      Working…
                    } @else {
                      {{ room.applicationCount === 0 ? 'Delete' : 'Remove' }}
                    }
                  </button>
                }
                @if (billingEnabled && !room.isFeatured && room.status === 'active') {
                  <button type="button" class="btn btn-sm btn-sage" (click)="boost(room.id)">⭐ Boost R99</button>
                }
              </div>
            </div>
          }
        }
      </section>

      <app-referral-panel/>

      @if (pausedRooms().length > 0) {
        <section class="dash-section">
          <div class="dash-section-title">
            Paused
            <span class="dash-count">({{ pausedRooms().length }})</span>
          </div>
          <p class="muted">
            Off the board and not visible to tenants. Existing applications are
            untouched — resume whenever you're ready.
          </p>

          @for (room of pausedRooms(); track room.id) {
            <div class="app-card app-card--closed">
              <div class="app-thumb portal-thumb" aria-hidden="true">⏸</div>
              <div class="app-info">
                <div class="app-room">{{ room.title }}</div>
                <div class="app-location">{{ room.locationDisplay }}</div>
                <div class="app-rent">{{ room.rentCents | zarCents:'monthly' }}</div>
              </div>
              <div class="portal-row-actions">
                <button type="button" class="btn btn-sm btn-sage"
                        [disabled]="pausing() === room.id" (click)="unpause(room)">
                  {{ pausing() === room.id ? 'Resuming…' : 'Resume' }}
                </button>
                <a class="btn btn-sm btn-ghost-light"
                   [routerLink]="['/landlord/rooms', room.id, 'edit']">Edit</a>
                <button type="button" class="btn btn-sm btn-ghost-light"
                        [disabled]="removing() === room.id" (click)="removeListing(room)">
                  Remove
                </button>
              </div>
            </div>
          }
        </section>
      }

      <section class="dash-section">
        <div class="dash-section-title">
          Drafts
          @if (draftRooms().length > 0) { <span class="dash-count">({{ draftRooms().length }})</span> }
        </div>

        @if (draftRooms().length === 0) {
          <p class="muted">No drafts. Rooms you start but do not publish appear here.</p>
        } @else {
          @for (room of draftRooms(); track room.id) {
            <div class="app-card app-card--archived">
              <div class="app-thumb portal-thumb" aria-hidden="true">📝</div>
              <div class="app-info">
                <div class="app-room">{{ room.title || 'Untitled draft' }}</div>
                <div class="app-location">
                  {{ room.locationDisplay }} · not visible to tenants
                </div>
                <div class="app-rent">{{ room.rentCents | zarCents:'monthly' }}</div>
                @if (discardError() === room.id) {
                  <div class="field-error" role="alert">Could not discard this draft.</div>
                }
              </div>
              <div class="portal-row-actions">
                <a class="btn btn-sm btn-primary" [routerLink]="['/landlord/rooms', room.id, 'edit']">
                  Continue editing
                </a>
                <button type="button" class="btn btn-sm btn-ghost-light"
                        [disabled]="discarding() === room.id" (click)="discard(room)">
                  {{ discarding() === room.id ? 'Discarding…' : 'Discard' }}
                </button>
              </div>
            </div>
          }
        }
      </section>

      <section class="dash-section">
        <div class="dash-section-title">Previously let — relist instantly</div>

        @if (loadingArchived()) {
          <p class="muted">Loading…</p>
        } @else if (archivedRooms().length === 0) {
          <p class="muted">No let rooms yet. When you mark a room as let it will appear here, ready to relist.</p>
        } @else {
          @for (room of archivedRooms(); track room.id) {
            <div class="app-card app-card--archived">
              <div class="app-thumb portal-thumb" aria-hidden="true">🏠</div>
              <div class="app-info">
                <div class="app-room">{{ room.title }}</div>
                <div class="app-location">
                  Let {{ room.letAt | date:'MMM yyyy' }} · {{ room.rentCents | zarCents:'monthly' }}
                </div>
                @if (relistError() === room.id) {
                  <div class="field-error" role="alert">Could not relist — please try again.</div>
                }
              </div>
              <div class="portal-row-actions">
                <button type="button" class="btn btn-sm btn-primary"
                        [disabled]="relisting() === room.id" (click)="relist(room.id)">
                  {{ relisting() === room.id ? 'Relisting…' : '🔁 Relist' }}
                </button>
              </div>
            </div>
          }
        }
      </section>
    </app-portal-shell>
  `,
  // Layout comes from the global spec + responsive layers. Scoped styles here
  // would be more specific than those and would break the breakpoints.
})
export class LandlordDashboard implements OnInit {
  protected readonly whatsappDrafts = inject(WhatsappDraftsService);
  protected readonly claiming = signal<string | null>(null);

  auth = inject(AuthService);
  private roomsService = inject(RoomsService);
  private router = inject(Router);
  private dialogs = inject(DialogService);

  billingEnabled = BILLING_ENABLED;

  /**
   * Computed so the Applicants badge tracks the live total. My Rooms,
   * Applicants and Messages all resolve to this dashboard, which is where
   * each of those views currently lives.
   */
  readonly navItems = computed<PortalNavItem[]>(() => [
    { label: 'Dashboard', icon: '📊', route: '/landlord/dashboard', exact: true },
    { label: 'My Rooms', icon: '🏠', route: '/landlord/dashboard' },
    { label: 'Applicants', icon: '👥', route: '/landlord/dashboard', badge: this.totalApplicants() },
    { label: 'Messages', icon: '💬', route: '/landlord/dashboard' },
    { label: 'Verification', icon: '🪪', route: '/landlord/verification' },
    { label: 'Settings', icon: '⚙️', route: '/account/settings' },
    ...(BILLING_ENABLED
      ? [{ label: 'Billing', icon: '💳', route: '/landlord/upgrade' }]
      : []),
  ]);

  rooms = signal<Room[]>([]);
  loading = signal(true);

  archivedRooms = signal<Room[]>([]);
  loadingArchived = signal(true);
  relisting = signal<string | null>(null);
  relistError = signal<string | null>(null);
  /** Which room is showing the edit-or-keep prompt. */
  relistChoice = signal<string | null>(null);
  marking = signal<string | null>(null);
  pausing = signal<string | null>(null);
  removing = signal<string | null>(null);
  discarding = signal<string | null>(null);
  discardError = signal<string | null>(null);

  ngOnInit() {
    this.whatsappDrafts.load().subscribe({ error: () => {} });
    this.roomsService.getLandlordRooms().subscribe({
      next: (rooms) => { this.rooms.set(rooms); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
    this.loadArchived();
  }

  /**
   * Relisting is the natural moment to change the rent — the market has moved
   * since it was first posted, and a landlord who has to relist first and edit
   * afterwards usually just leaves the old price. Asking costs one tap.
   */
  askRelist(roomId: string) {
    this.relistChoice.set(roomId);
  }

  /** Relist unchanged, then open the wizard so details can be adjusted. */
  relistAndEdit(roomId: string) {
    this.relistChoice.set(null);
    this.relisting.set(roomId);
    this.relistError.set(null);
    this.roomsService.relistRoom(roomId).subscribe({
      next: () => {
        this.relisting.set(null);
        this.router.navigate(['/landlord/rooms', roomId, 'edit']);
      },
      error: () => {
        this.relisting.set(null);
        this.relistError.set(roomId);
      },
    });
  }

  relist(roomId: string) {
    this.relistChoice.set(null);
    this.relisting.set(roomId);
    this.relistError.set(null);
    this.roomsService.relistRoom(roomId).subscribe({
      next: () => {
        this.relisting.set(null);
        // Room moves from archived back to active — refresh both lists.
        this.ngOnInit();
      },
      error: () => {
        this.relisting.set(null);
        this.relistError.set(roomId);
      },
    });
  }

  /** Kept for when BILLING_ENABLED flips back to true — see feature-flags.ts. */
  boost(roomId: string) {
    // No payment provider is wired. Stripe was removed (it does not operate
    // in South Africa for receiving payments) and PayFast recurring billing is
    // not built. Boost is hidden while BILLING_ENABLED is false.
    this.dialogs.alert(
      'Not available yet',
      'Boosting a listing is not open yet. Nothing has been charged.',
      'info',
    );
  }

  /**
   * Marking a room let closes the current cycle: it leaves the public board and
   * moves to the relist section. Confirmed because outstanding applicants are
   * notified, which cannot be undone after the 30-minute window.
   */
  async markLet(room: Room) {
    const applicants = room.applicationCount;
    const confirmed = await this.dialogs.confirm(
      'Mark this room as let?',
      applicants > 0
        ? `"${room.title}" comes off the board and ${applicants} applicant${applicants === 1 ? ' is' : 's are'} told it has gone. You have 30 minutes to undo this.`
        : `"${room.title}" comes off the board. You have 30 minutes to undo this.`,
      'Mark as let',
      'Not yet',
    );
    if (!confirmed) return;

    this.marking.set(room.id);
    this.roomsService.markLet(room.id).subscribe({
      next: () => {
        this.marking.set(null);
        this.ngOnInit();   // reload both lists, as relist does
      },
      error: () => this.marking.set(null),
    });
  }

  /**
   * Off the board without closing anyone's application — for a landlord who
   * is away, or the room is being repaired. Distinct from Mark as Let, which
   * closes and emails every applicant.
   */
  pause(room: Room) {
    this.pausing.set(room.id);
    this.roomsService.pause(room.id).subscribe({
      next: () => { this.pausing.set(null); this.ngOnInit(); },
      error: () => this.pausing.set(null),
    });
  }

  /** Resume, not relist — relisting would close every open application. */
  unpause(room: Room) {
    this.pausing.set(room.id);
    this.roomsService.unpause(room.id).subscribe({
      next: () => { this.pausing.set(null); this.ngOnInit(); },
      error: () => this.pausing.set(null),
    });
  }

  /**
   * Removes a published listing entirely. Confirmed hard, because open
   * applicants are closed and emailed and that cannot be taken back.
   */
  /**
   * A listing nobody applied for can be deleted outright. One with
   * applications is removed instead — those records belong to the tenants too,
   * and the privacy policy commits to keeping them for two years.
   */
  async removeListing(room: Room) {
    const applicants = room.applicationCount;

    if (applicants === 0) {
      const confirmed = await this.dialogs.confirm(
        'Delete this listing?',
        `"${room.title}" will be deleted completely. Nobody has applied for it, so nothing else is lost. This cannot be undone.`,
        'Delete permanently',
        'Keep it',
      );
      if (!confirmed) return;

      this.removing.set(room.id);
      this.roomsService.deletePermanently(room.id).subscribe({
        next: () => {
          this.removing.set(null);
          this.rooms.update((list) => list.filter((r) => r.id !== room.id));
        },
        error: (err) => {
          this.removing.set(null);
          this.dialogs.error(err?.error?.message ?? 'That could not be deleted.');
        },
      });
      return;
    }

    const confirmed = await this.dialogs.confirm(
      'Remove this listing?',
      `${applicants} applicant${applicants === 1 ? ' is' : 's are'} told the room is gone, and it comes off the board. ` +
      'Their applications are kept, so the listing is not deleted outright. This cannot be undone.',
      'Remove',
      'Keep it',
    );
    if (!confirmed) return;

    this.removing.set(room.id);
    this.roomsService.removelisting(room.id).subscribe({
      next: () => { this.removing.set(null); this.ngOnInit(); },
      error: () => this.removing.set(null),
    });
  }


  /** my-rooms returns active, reserved and drafts together; split for display. */
  /** On the board, or reserved. Paused rooms get their own section. */
  activeRooms() {
    return this.rooms().filter((r) => r.status === 'active' || r.status === 'reserved');
  }

  /**
   * Off the board but not finished with. Separated so a landlord can see at a
   * glance that a room is not being seen by anyone — mixed in with the live
   * listings it looks the same as one that is working.
   */
  pausedRooms() {
    return this.rooms().filter((r) => r.status === 'paused');
  }

  draftRooms() {
    return this.rooms().filter((r) => r.status === 'draft');
  }

  /**
   * Drafts are never seen by tenants and carry no applications, so discarding
   * is a hard delete. Confirmed first because it cannot be undone.
   */
  async discard(room: Room) {
    const confirmed = await this.dialogs.confirm(
      'Discard this draft?',
      `"${room.title || 'This draft'}" will be deleted. It has never been visible to tenants, and this cannot be undone.`,
      'Discard',
      'Keep it',
    );
    if (!confirmed) return;

    this.discarding.set(room.id);
    this.discardError.set(null);
    this.roomsService.discardDraft(room.id).subscribe({
      next: () => {
        this.rooms.update((list) => list.filter((r) => r.id !== room.id));
        this.discarding.set(null);
      },
      error: () => {
        this.discardError.set(room.id);
        this.discarding.set(null);
      },
    });
  }

  /** Derived dashboard counters — computed from the loaded rooms, not stored. */
  activeCount() {
    return this.rooms().filter((r) => r.status === 'active').length;
  }

  totalApplicants() {
    return this.rooms().reduce((sum, r) => sum + r.applicationCount, 0);
  }

  totalViews() {
    return this.rooms().reduce((sum, r) => sum + (r.viewCount ?? 0), 0);
  }

  private loadArchived() {
    this.loadingArchived.set(true);
    this.roomsService.getArchivedRooms().subscribe({
      next: (rooms) => { this.archivedRooms.set(rooms); this.loadingArchived.set(false); },
      error: () => this.loadingArchived.set(false),
    });
  }

  /**
   * Opens a WhatsApp draft as a room draft in the wizard.
   *
   * Goes to the edit wizard rather than publishing: the whole point is that
   * the landlord sees what was read from their message before anyone else
   * does. The API is idempotent, so a double tap on a slow connection returns
   * the same room instead of creating two listings.
   */
  claimDraft(draft: WhatsappDraft) {
    this.claiming.set(draft.id);
    this.whatsappDrafts.claim(draft.id).subscribe({
      next: ({ roomId }) => {
        this.claiming.set(null);
        this.whatsappDrafts.load().subscribe({ error: () => {} });
        this.router.navigate(['/landlord/rooms', roomId, 'edit']);
      },
      error: () => {
        this.claiming.set(null);
        this.dialogs.alert('Could not open that', 'Please try again in a moment.', 'error');
      },
    });
  }
}
