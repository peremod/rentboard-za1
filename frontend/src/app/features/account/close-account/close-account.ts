import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { AccountLifecycleService, DeletionPreview } from '../../../core/services/account-lifecycle.service';
import { SavedRoomsService } from '../../../core/services/saved-rooms.service';

/**
 * Pausing an account, or ending it — Phase 7g, item 3 of the UX brief.
 *
 * ── Its own screen, not a section under profile edits
 *
 * The irreversible control should not be one scroll below "change your name".
 * Settings links here; this page's whole job is to explain the difference
 * before offering either button.
 *
 * ── The two are explained as what they actually do
 *
 * Not "deactivate vs delete" as jargon. A pause takes your listings off the
 * board and stops everything being sent to you, and nothing is destroyed. The
 * end erases your name, email, phone number, photo and password, and cannot be
 * undone.
 *
 * ── And it is honest about what survives
 *
 * It has to be. Deleting the row outright would cascade into other people's
 * rooms, applications, messages, tenancies, rent history and reviews — the
 * foreign keys were read before this was designed, and the migration lists
 * them. POPIA s.24 is a right to have YOUR personal information deleted, not
 * somebody else's, and not a right to destroy a record two parties share. So
 * the shared rows stay with the name taken off them, and this screen says so,
 * with the real counts from the person's own data, BEFORE they type anything.
 * A dialog promising "permanent deletion" over a mechanism that leaves a named
 * row behind would be the dishonest version.
 */
@Component({
  selector: 'app-close-account',
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="ca-back"><a routerLink="/account/settings">← Back to settings</a></p>

    @if (paused()) {
      <!-- Already asleep. The one thing this screen should lead with. -->
      <section class="dash-section ca-paused">
        <h2 class="dash-section-title">Your account is paused</h2>
        <p>
          Your listings are off the board and we are not sending you anything.
          Nothing has been deleted.
        </p>
        <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="reactivate()">
          {{ busy() ? 'Waking it up…' : 'Use my account again' }}
        </button>
        @if (woken(); as w) {
          <p class="muted" role="status">
            Welcome back.
            @if (w.roomsStillPaused > 0) {
              Your {{ w.roomsStillPaused }}
              {{ w.roomsStillPaused === 1 ? 'room is' : 'rooms are' }} still paused —
              we did not put them back on the board for you, in case one of them is
              taken now. <a routerLink="/landlord/dashboard">Publish them when you are ready.</a>
            }
          </p>
        }
        @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }
      </section>
    } @else {
      <!-- ── Pause ──────────────────────────────────────────────────────── -->
      <section class="dash-section">
        <h2 class="dash-section-title">Take a break</h2>
        <p class="ca-lead">
          Pausing hides your account from everybody else and stops us sending you
          anything. <strong>Nothing is deleted</strong>, and you can come back
          whenever you like by signing in.
        </p>
        <ul class="ca-list">
          <li>Your listings come off the board. They are paused, not deleted.</li>
          <li>Your public page stops being visible.</li>
          <li>No emails, no WhatsApp messages, no notices.</li>
          <li>You can still sign in — that is how you come back.</li>
        </ul>
        <!-- Said plainly, because a pause that quietly left something running
             would be the worse kind of surprise. -->
        <p class="muted ca-caveat">
          It does not withdraw applications you have already sent. If you want
          those withdrawn, do it from your dashboard first — withdrawing cannot
          be undone, so pausing does not do it for you.
        </p>
        <button type="button" class="btn btn-outline" [disabled]="busy()" (click)="deactivate()">
          {{ busy() ? 'Pausing…' : 'Pause my account' }}
        </button>
        @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }
      </section>

      <!-- ── End ────────────────────────────────────────────────────────── -->
      <section class="dash-section ca-danger">
        <h2 class="dash-section-title">Close my account for good</h2>
        <p class="ca-lead">
          This cannot be undone. There is no way to get the account back, and we
          cannot restore it for you.
        </p>

        @if (loadingPreview()) {
          <p class="muted">Working out what this would do…</p>
        } @else if (previewFailed()) {
          <p class="ca-lead" role="alert">
            We could not check what is on your account just now, so we are not
            going to offer you the button. This is a problem at our end — please
            try again in a moment.
            <button type="button" class="link-button" (click)="loadPreview()">Try again</button>
          </p>
        } @else if (preview(); as p) {
          <h3 class="ca-sub">What gets erased</h3>
          <ul class="ca-list">
            @for (row of p.erased; track row.label) {
              <li>{{ row.label }}@if (row.count !== null) { — {{ row.count }} }</li>
            }
          </ul>

          @if (p.kept.length) {
            <h3 class="ca-sub">What stays, with your name taken off it</h3>
            <!-- The honest part. A person told "permanently deleted" and later
                 shown their own words in somebody else's thread would be right
                 to feel misled. -->
            <ul class="ca-list ca-list--kept">
              @for (row of p.kept; track row.label) {
                <li>
                  <strong>{{ row.label }} ({{ row.count }})</strong>
                  <span class="ca-why">{{ row.why }}</span>
                </li>
              }
            </ul>
          }

          <!-- Said explicitly, because it is the one thing the server cannot
               do for them and they would never guess it. -->
          <p class="muted ca-caveat">
            Rooms you saved are kept on this phone or computer rather than on
            our servers. Closing the account clears them from this device — if
            you have saved rooms on another one, clear them there too.
          </p>

          <h3 class="ca-sub">What stops happening</h3>
          <ul class="ca-list">
            @for (line of p.stops; track line) { <li>{{ line }}</li> }
          </ul>

          <form class="ca-form" (ngSubmit)="deleteAccount()">
            @if (hasPassword()) {
              <label>
                <span>Your password</span>
                <input type="password" name="password" autocomplete="current-password"
                       [(ngModel)]="password" required/>
                <span class="field-hint">
                  So a phone somebody left unlocked cannot be used to close your account.
                </span>
              </label>
            } @else {
              <!-- A phone-only account has no password at all (Phase 7g part
                   one). Rather than inventing a weaker confirmation, this says
                   what to do: the API refuses without a fresh code. -->
              <p class="ca-lead">
                Your account signs in with your phone number, so closing it needs
                a code on WhatsApp.
                <a routerLink="/account/settings">Set a password first</a>, or ask
                us to close it for you from
                <a routerLink="/account/notices">your notices</a>.
              </p>
            }

            <label>
              <span>Type DELETE to confirm</span>
              <input type="text" name="confirm" autocomplete="off" spellcheck="false"
                     [(ngModel)]="confirm" placeholder="DELETE"/>
            </label>

            <!-- Arrives UNTICKED and the API refuses an absent value, because
                 a missed checkbox binding ships as "absent" rather than false. -->
            <label class="ca-check">
              <input type="checkbox" name="understood" [(ngModel)]="understood"/>
              <span>
                I have read what gets erased and what stays, and I understand this
                cannot be undone.
              </span>
            </label>

            @if (deleteError()) { <p class="field-error" role="alert">{{ deleteError() }}</p> }

            <button type="submit" class="btn btn-danger"
                    [disabled]="!canDelete() || deleting()">
              {{ deleting() ? 'Closing your account…' : 'Close my account for good' }}
            </button>
          </form>
        }
      </section>
    }
  `,
  styles: `
    .ca-back { font-size: .85rem; }
    .ca-lead { line-height: 1.7; max-width: 38rem; }
    .ca-sub { font-size: .9rem; margin: 1.1rem 0 .4rem; }
    .ca-list { margin: 0 0 .75rem; padding-left: 1.2rem; line-height: 1.7; max-width: 38rem; }
    .ca-list--kept li { margin-bottom: .6rem; }
    .ca-why { display: block; font-size: .85rem; color: var(--slate); line-height: 1.6; }
    .ca-caveat { font-size: .85rem; max-width: 38rem; line-height: 1.6; }
    .ca-paused { border-left: 3px solid var(--terra); padding-left: .9rem; }
    .ca-danger {
      border: 1px solid rgba(214, 59, 59, .35); border-radius: var(--r8, 8px);
      padding: 1.1rem; background: rgba(214, 59, 59, .04);
    }
    .ca-form { margin-top: 1rem; max-width: 26rem; display: flex; flex-direction: column; gap: .9rem; }
    .ca-form label { display: flex; flex-direction: column; gap: .25rem; font-size: .85rem; }
    .ca-form input[type="password"], .ca-form input[type="text"] {
      font: inherit; padding: .55rem .6rem; border: 1px solid var(--border);
      border-radius: 6px; min-height: 44px;
    }
    .ca-check { flex-direction: row !important; align-items: flex-start; gap: .55rem; line-height: 1.6; }
    .ca-check input { width: 20px; height: 20px; margin-top: .15rem; flex-shrink: 0; }
    /* ⚠️ 44px on EVERY button here, not only the dangerous one.
       The base .btn in _spec.scss sets padding and line-height and no
       min-height, which lands at 34px — under WCAG 2.5.8. The danger button
       said min-height because it was written by hand; "Pause my account" and
       "Use my account again" inherited the 34px and were measured at 34px at
       all four widths. Recorded in docs/OUTSTANDING.md, because the base rule
       affects every button in the app and is not this phase's to change. */
    .ca-paused .btn, .dash-section > .btn { min-height: 44px; }
    .btn-danger {
      background: #D63B3B; color: #fff; border: none; min-height: 44px;
      &:disabled { opacity: .5; cursor: not-allowed; }
    }
    .link-button {
      background: none; border: none; padding: 0; font: inherit;
      color: var(--terra); text-decoration: underline; cursor: pointer;
    }
    @media (max-width: 480px) {
      .ca-form, .ca-lead, .ca-list { max-width: none; }
      .btn-danger, .ca-paused .btn, .dash-section > .btn-outline { width: 100%; }
    }
  `,
})
export class CloseAccount implements OnInit {
  private auth = inject(AuthService);
  private lifecycle = inject(AccountLifecycleService);
  private router = inject(Router);
  private savedRooms = inject(SavedRoomsService);

  protected password = '';
  protected confirm = '';
  protected understood = false;

  protected readonly busy = signal(false);
  protected readonly deleting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly deleteError = signal<string | null>(null);
  protected readonly woken = signal<{ roomsStillPaused: number } | null>(null);

  protected readonly preview = signal<DeletionPreview | null>(null);
  protected readonly loadingPreview = signal(true);
  /**
   * Distinguished from "nothing to show".
   *
   * ⚠️ If the preview cannot be loaded the delete button is NOT offered. The
   * person would otherwise be asked to confirm they had read a list that never
   * arrived — which is consent to something nobody told them.
   */
  protected readonly previewFailed = signal(false);

  protected readonly paused = () => !!this.auth.user()?.deactivatedAt;
  /** A phone-only account has no password to confirm with (Phase 7g part one). */
  protected readonly hasPassword = () => !!this.auth.user()?.email;

  protected canDelete(): boolean {
    if (!this.preview() || this.previewFailed()) return false;
    if (this.hasPassword() && !this.password) return false;
    if (!this.hasPassword()) return false;
    return this.confirm.trim() === 'DELETE' && this.understood;
  }

  ngOnInit() {
    if (!this.paused()) this.loadPreview();
    else this.loadingPreview.set(false);
  }

  protected loadPreview() {
    this.loadingPreview.set(true);
    this.previewFailed.set(false);
    this.lifecycle.deletionPreview().subscribe({
      next: (p) => { this.preview.set(p); this.loadingPreview.set(false); },
      error: () => { this.loadingPreview.set(false); this.previewFailed.set(true); },
    });
  }

  protected deactivate() {
    this.busy.set(true);
    this.error.set(null);
    this.lifecycle.deactivate().subscribe({
      next: (res) => {
        this.busy.set(false);
        this.auth.patchUser({ deactivatedAt: res.deactivatedAt });
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(err?.error?.message ?? 'That did not work just now. Try again in a moment.');
      },
    });
  }

  protected reactivate() {
    this.busy.set(true);
    this.error.set(null);
    this.lifecycle.reactivate().subscribe({
      next: (res) => {
        this.busy.set(false);
        this.auth.patchUser({ deactivatedAt: null });
        this.woken.set({ roomsStillPaused: res.roomsStillPaused });
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(err?.error?.message ?? 'That did not work just now. Try again in a moment.');
      },
    });
  }

  protected deleteAccount() {
    if (!this.canDelete()) return;
    this.deleting.set(true);
    this.deleteError.set(null);
    this.lifecycle.deleteAccount({
      password: this.password || undefined,
      confirm: 'DELETE',
      understood: true,
    }).subscribe({
      next: () => {
        /**
         * ⚠️ The device's own saved rooms, which the server cannot reach.
         *
         * Saved rooms live in localStorage — the `saved_rooms` table exists and
         * nothing writes to it. So without this, somebody who closed their
         * account would leave the next person to pick up the phone a list of
         * the rooms they had been looking at: personal information about a
         * person who just asked to be forgotten, left behind by the one action
         * that promised to forget them.
         */
        this.savedRooms.clearDevice();
        // Signed out locally straight away. The tokens are gone server-side,
        // so leaving a session in the tab would only produce 401s.
        this.auth.logout();
        this.router.navigate(['/'], { queryParams: { closed: '1' } }).catch(() => {});
      },
      error: (err) => {
        this.deleting.set(false);
        // The actual error, and the typed fields are left alone — a wrong
        // password should not mean filling the form in again.
        this.deleteError.set(err?.error?.message ?? 'That did not work. Nothing has been changed.');
      },
    });
  }
}
