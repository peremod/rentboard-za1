import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { VerificationService } from '../../../core/services/verification.service';
import { BadgeBasis } from '../../../core/models/verification.model';
import { RoomViewing, ViewingOutcome } from '../../../core/services/applications.service';
import { ApplicationsService } from '../../../core/services/applications.service';
import { Application } from '../../../core/models/application.model';
import { TenantNotes } from '../../../shared/components/tenant-notes/tenant-notes';
import { MessageThread } from '../../../shared/components/message-thread/message-thread';
import { ReviewList } from '../../../shared/components/review-list/review-list';
import { ReviewsService } from '../../../core/services/reviews.service';
import { DialogService } from '../../../core/services/dialog.service';
import { TenantReferences } from '../../../core/models/review.model';
import { applicationState, stateClass } from '../../../core/models/state.model';
import { ScreenHint } from '../../../shared/components/screen-hint/screen-hint';
import { Loading } from '../../../shared/components/loading/loading';
import { Icon } from '../../../shared/components/icon/icon';

/**
 * Applicant manager — one room's full applicant list, with shortlist/accept/
 * reject actions wired to the emails built in pass 0.5.0. Opening an
 * applicant's card marks it viewed (fires sendApplicationViewedEmail once,
 * idempotently — see backend markViewed()).
 */
@Component({
  selector: 'app-applicants',
  standalone: true,
  imports: [Icon, DatePipe, FormsModule, RouterLink, MessageThread, ReviewList, TenantNotes, ScreenHint, Loading],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
      <app-screen-hint key="landlord-applicants" heading="Everyone who applied, across every room">
        The ones still waiting on you come first. Shortlist to keep somebody in mind, invite them to view before you decide, and if you accept by mistake you have thirty minutes to undo it.
      </app-screen-hint>

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
        <app-loading/>
      } @else if (applications().length === 0) {
        <p class="muted">No applications yet for this room.</p>
      } @else {
        <!-- ⚠️ h2, not h3. The portal shell supplies this screen's only h1, so
             an h3 section heading skipped a level — H3 straight after H1. Found
             by a11y-drive the first time it ever audited this screen: the page
             list was static paths and this route needs a room id, so
             applicants.ts had never been checked at all. The portfolio-wide
             inbox at /landlord/applicants is a different component. -->
        <!-- Grouped, shortlist first. A flat list meant a landlord with
             fifteen applicants had to re-find the three they liked every time
             they came back. -->
        @if (shortlisted().length > 0) {
          <div class="applicant-group">
            <h2 class="applicant-group__title">
              <app-icon name="star" filled/> Shortlisted <span class="applicant-group__count">({{ shortlisted().length }})</span>
            </h2>
            <p class="applicant-group__hint">
              Arrange viewings with these, then accept one. Accepting closes the
              room and tells everyone else.
            </p>
          </div>
        }

        @for (app of ordered(); track app.id) {
          @if (isFirstOf(app, 'other')) {
            <div class="applicant-group">
              <h2 class="applicant-group__title">
                New and viewed <span class="applicant-group__count">({{ others().length }})</span>
              </h2>
            </div>
          }
          @if (isFirstOf(app, 'decided')) {
            <div class="applicant-group">
              <h2 class="applicant-group__title">
                Decided <span class="applicant-group__count">({{ decided().length }})</span>
              </h2>
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
                @if (app.tenant?.isVerified) { <span class="pill"><app-icon name="check"/> Verified</span> }
                @if (app.tenant?.tenantProfile?.hasPassport) { <span class="pill pill--passport"><app-icon name="id-card"/> Passport</span> }
                <span [class]="'state ' + stateClass(applicationState(app.status))">{{ app.status }}</span>
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
                    <strong><app-icon name="id-card"/> Renter's Passport</strong>
                    @if (basis()[app.tenant!.id]; as checks) {
                      <ul>
                        @for (check of checks.checks; track check.type) {
                          <li><app-icon name="check"/> {{ check.label }}<span>{{ check.confirmedAt | date: 'MMM yyyy' }}</span></li>
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
                      <button type="button" (click)="shortlist(app)"><app-icon name="star" filled/> Shortlist</button>
                    } @else {
                      <button type="button" class="unshortlist"
                              (click)="unshortlist(app)">Remove from shortlist</button>
                    }
                    <button type="button" (click)="startInvite(app)"><app-icon name="calendar"/> Invite to view</button>
                    <button type="button" class="accept" (click)="accept(app)"><app-icon name="check"/> Accept</button>
                    <button type="button" class="reject" (click)="reject(app)"><app-icon name="x"/> Reject</button>
                  </div>

                  <!-- ── Viewings — Phase 7l ─────────────────────────────
                       There was no such thing before: "I'll meet you Saturday
                       at four" lived in the message thread, with no date either
                       side could look up and nothing the tenant could answer. -->
                  @if (viewingFor(app.id); as v) {
                    <div class="viewing" [class.viewing--off]="v.status === 'cancelled' || v.status === 'declined'"
                         [class.viewing--gone]="elapsed(v)">
                      <strong>{{ viewingLabel(v) }}</strong>
                      <span>{{ v.startsAt | date: 'EEEE d MMM, HH:mm' }} — {{ v.meetingPlace }}</span>
                      @if (v.note) { <span class="muted">{{ v.note }}</span> }
                      @if (v.declineReason) { <span class="muted">They said: {{ v.declineReason }}</span> }
                      @if (elapsed(v)) {
                        <!-- ── The day came and went — Phase 8n ──────────────
                             The row stayed "accepted" for ever and said "They
                             are coming" about a Saturday weeks gone. Both
                             sides are asked, because each knows a different
                             half: "they did not come" and "I could not go"
                             are one outcome told from two ends. -->
                        <strong class="viewing__gone">⏰ That time has been and gone — what happened?</strong>
                        @if (chosenOutcome(app.id); as o) {
                          <label class="viewing__note">
                            <span>Anything to add? (optional)</span>
                            <input type="text" [(ngModel)]="outcomeNote" name="outcomeNote"
                                   placeholder="They came but wanted it from December"/>
                          </label>
                          <!-- ⚠️ The consequence before the tap, not after. -->
                          @if (o.closes) {
                            <p class="viewing__closing" role="status">
                              This closes {{ app.tenant?.fullName }}'s application and tells
                              them. It does NOT accept anybody else — accepting is its own
                              step, with its own 30 minutes to undo it.
                            </p>
                          }
                          <div class="viewing-form__actions">
                            <button type="button" class="btn btn-sm btn-primary"
                                    [disabled]="busyViewing() === app.id" (click)="saveOutcome(app, v)">
                              {{ busyViewing() === app.id ? 'Saving…' : (o.closes ? 'Save and close it' : 'Save') }}
                            </button>
                            <button type="button" class="link-btn"
                                    (click)="pickOutcome(app.id, null)">Back</button>
                          </div>
                        } @else {
                          <div class="viewing__outcomes">
                            @for (o of outcomes; track o.value) {
                              <button type="button" class="viewing__outcome"
                                      (click)="pickOutcome(app.id, o.value)"><app-icon [name]="o.icon"/> {{ o.label }}</button>
                            }
                          </div>
                          <!-- The reschedule option. It works because invite()
                               only treats a viewing still to come as one
                               already arranged — a past time gives nobody
                               anywhere to be. -->
                          <button type="button" class="link-btn"
                                  (click)="startInvite(app)"><app-icon name="calendar"/> Offer another time</button>
                        }
                      } @else if (v.status === 'proposed' || v.status === 'accepted') {
                        <button type="button" class="link-btn" [disabled]="busyViewing() === app.id"
                                (click)="callOff(app, v)">Call it off</button>
                      }
                    </div>
                  }

                  @if (invitingId() === app.id) {
                    <form class="viewing-form" (ngSubmit)="sendInvite(app)">
                      <h4 class="viewing-form__title">Invite {{ app.tenant?.fullName }} to see the room</h4>
                      <label>
                        <span>When</span>
                        <input type="datetime-local" [(ngModel)]="inviteForm.when" name="when"/>
                      </label>
                      <label>
                        <span>Where to meet</span>
                        <input type="text" [(ngModel)]="inviteForm.place" name="place"
                               placeholder="e.g. 14 Vilakazi Street — the blue gate"/>
                        <!-- ⚠️ Said out loud, because the landlord typed their
                             property address into a form that promised "Only
                             you see this. It is never on a listing and never
                             sent to an applicant." Nothing pre-fills it here;
                             this is them choosing to tell one person. -->
                        <span class="field-hint">
                          <strong>This is sent to {{ app.tenant?.fullName }}.</strong>
                          We never use the address you saved on your property —
                          that stays private. Type what you want this one person
                          to know.
                        </span>
                      </label>
                      <label>
                        <span>Anything else (optional)</span>
                        <input type="text" [(ngModel)]="inviteForm.note" name="viewingNote"
                               placeholder="Ask for Sipho at the gate."/>
                      </label>
                      @if (inviteError()) { <p class="field-error" role="alert">{{ inviteError() }}</p> }
                      <div class="viewing-form__actions">
                        <button type="submit" class="btn btn-sm btn-primary" [disabled]="busyViewing() === app.id">
                          {{ busyViewing() === app.id ? 'Sending…' : 'Send the invitation' }}
                        </button>
                        <button type="button" class="link-btn" (click)="invitingId.set(null)">Cancel</button>
                      </div>
                    </form>
                  }
                }

                <div class="applicant-card__refs">
                  <button type="button" class="refs-toggle" (click)="toggleRefs(app)">
                    {{ openRefs() === app.id ? 'Hide references' : 'References' }}
                  </button>

                  @if (openRefs() === app.id) {
                    @if (refsLoading()) {
                      <app-loading/>
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
    /* ⚠️ 24px, because these two are TARGETS and not a sentence.
       They were 20px tall with 16px of clear air — an AA failure under 2.5.8
       — and the sweep had been excusing them for one reason only: they sit in
       a <p>, and the prose exemption used to test the parent's TAG NAME. This
       row is a flex row; nothing about it is running text. The exemption
       asks whether there are words beside the link now, so these two became
       visible the moment that was fixed: one over-strict rule had been hiding
       a genuine failure, which is the other direction of the same defect. */
    .applicants__back a { display: inline-flex; align-items: center; min-height: 1.5rem; }
    h1 { font-size: 1.3rem; margin: .5rem 0 1.5rem; }
    .muted { color: var(--slate); }
    .applicant-card { border: 1px solid var(--border); border-radius: var(--r8); margin-bottom: .75rem; overflow: hidden; }
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
    .pill { font-size: .6rem; font-weight: 700; background: rgba(61,112,64,.1); color: var(--sage); padding: .1rem .4rem; border-radius: var(--r-full); margin-left: .4rem; }
    /* The chip is '.state' from styles.scss. Only the gap beside the name is
       this screen's business. Measured before the swap: '.status--accepted'
       (#3D7040 on sage 15%) was 4.12:1 on --cream2 and '.status--rejected'
       (#D63B3B on red 10%) 3.46:1 — both under the 4.5:1 small-text floor, in
       two components, and a11y-drive could not see either because its fixture
       never accepts or rejects an application. */
    .state { margin-left: .5rem; }
    .applicant-card__body { padding: 0 1rem 1rem; }
    .cover-note { font-style: italic; color: var(--ink2); margin: .5rem 0; }
    .applicant-card__refs { margin: .75rem 0; padding: .75rem 0; border-top: 1px solid var(--border); }
    .refs-toggle { background: none; border: 1px solid var(--border); border-radius: var(--r4); padding: .35rem .75rem;
                   font-size: .78rem; font-weight: 600; cursor: pointer; color: var(--ink2); }
    .refs-note { font-size: .72rem; color: var(--slate); line-height: 1.6; margin-top: .6rem; }
    .undo-banner { display: flex; align-items: center; justify-content: space-between;
                   gap: .75rem; flex-wrap: wrap; padding: .7rem .9rem; margin-bottom: .4rem;
                   background: rgba(61,112,64,.08); border: 1px solid rgba(61,112,64,.25);
                   border-radius: var(--r8); font-size: .85rem; color: var(--ink2); }
    .undo-note { font-size: .75rem; color: var(--slate); margin-bottom: .5rem; }
    .applicant-group { margin: 1.25rem 0 .5rem; }
    .applicant-group__title { font-size: .95rem; font-weight: 700; color: var(--ink2); }
    .applicant-group__count { color: var(--slate); font-weight: 400; }
    .applicant-group__hint { font-size: .8rem; color: var(--slate); line-height: 1.6; margin-top: .2rem; }
    .applicant-card__actions { display: flex; gap: .6rem; margin-bottom: .5rem; flex-wrap: wrap; }
    /* ⚠️ These measured 28px tall and sat 8px apart — Accept beside Reject, on
       a phone, on the landlord's most consequential screen. Under the 44px tap
       target of WCAG 2.5.8, and a mis-tap decides somebody's housing. (It is
       reversible for 30 minutes, which is why this is a size fix rather than a
       redesign of the row.) */
    /* color is NOT optional here. :where(button) sets color:var(--white) with a
       terracotta background; this rule overrides the background and, without a
       colour, leaves white text on a white button at 1.00:1 - Shortlist and
       Invite to view were blank boxes on a live phone, the emoji visible and
       the words not. The warning 40 lines above says exactly this and was not
       applied to the next button rule in the same file. */
    .applicant-card__actions button {
      padding: .4rem .9rem; min-height: 44px; border-radius: var(--r4);
      border: 1px solid var(--border); background: var(--white); cursor: pointer;
      color: var(--ink);
      font-size: .78rem; font-weight: 600;
      /* ⚠️ :where(button) sets white-space:nowrap. With flex:1 and min-width:90px
         below, two buttons share the row at phone width and "Remove from
         shortlist" cannot wrap - so it rendered wider than its own box, the
         text spilling past both borders. Same root cause as the archive card
         header: a global nowrap meant for short labels, inherited by a control
         whose label is a sentence. */
      white-space: normal; line-height: 1.25; text-align: center;
    }
    .viewing {
      display: grid; gap: .2rem; margin: .5rem 0;
      padding: .6rem .7rem; font-size: .82rem; line-height: 1.6;
      border-left: 3px solid var(--sage); background: rgba(61,112,64,.06);
      border-radius: var(--r4);
    }
    .viewing--off { border-left-color: var(--slate); background: var(--cream2); }
    .viewing--gone { border-left-color: var(--terra); background: rgba(193,102,61,.07); }
    .viewing__gone { color: var(--terra); }
    .viewing__outcomes { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .25rem; }
    .viewing__outcome {
      font: inherit; font-size: .8rem; text-align: left;
      /* 44px, WCAG 2.5.8 — and min-width:0, because a flex item defaults to
         its content width and these labels are sentences. */
      min-height: 44px; padding: .5rem .75rem; min-width: 0; max-width: 100%;
      white-space: normal; line-height: 1.3;
      background: var(--white); color: var(--ink);
      border: 1.5px solid var(--border); border-radius: var(--r4); cursor: pointer;
    }
    .viewing__outcome:hover { border-color: var(--terra); }
    .viewing__note { display: grid; gap: .25rem; margin-top: .5rem; font-weight: 600; }
    .viewing__note input {
      font: inherit; font-weight: 400; padding: .5rem .75rem; min-height: 44px;
      border: 1.5px solid var(--border); border-radius: var(--r4); max-width: 24rem;
    }
    .viewing__closing {
      margin: .5rem 0 0; padding: .5rem .75rem; border-radius: var(--r4);
      background: rgba(214,59,59,.07); font-weight: 600; line-height: 1.6;
    }
    .viewing-form { display: grid; gap: .7rem; margin: .6rem 0; max-width: 28rem; }
    .viewing-form__title { font-size: .9rem; margin: 0; }
    .viewing-form label { display: grid; gap: .25rem; font-size: .82rem; font-weight: 600; }
    .viewing-form input {
      font: inherit; font-weight: 400; padding: .5rem .75rem; min-height: 44px;
      border: 1.5px solid var(--border); border-radius: var(--r4);
    }
    .viewing-form .field-hint { font-weight: 400; line-height: 1.6; }
    .viewing-form__actions { display: flex; flex-wrap: wrap; align-items: center; gap: .9rem; }
    /* ⚠️ Undoing a shortlist is not inviting someone to a viewing, and the
       two rendered as the same button. Reversible, so not the danger
       treatment Delete gets — slate on a slate hairline, which reads as
       "step back" beside three actions that step forward. */
    .applicant-card__actions .unshortlist {
      color: var(--slate); border-color: var(--border-strong); background: var(--cream2);
    }
    .applicant-card__actions .accept { background: var(--sage); color: var(--white); border: none; }
    .applicant-card__actions .reject { background: var(--danger); color: var(--white); border: none; }

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
  /** The vocabulary's mapping, shared — see core/models/state.model.ts. */
  protected readonly applicationState = applicationState;
  protected readonly stateClass = stateClass;

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

  // ── Viewings — Phase 7l ────────────────────────────────────────────────
  //
  // There was no such thing before: ApplicationStatus's `viewed` means the
  // LANDLORD opened the application, so "I'll meet you Saturday at four" lived
  // in the message thread with no date either side could look up and nothing
  // the tenant could answer.
  invitingId = signal<string | null>(null);
  busyViewing = signal<string | null>(null);
  inviteError = signal<string | null>(null);
  /** applicationId → its latest viewing. */
  viewings = signal<Record<string, RoomViewing>>({});
  inviteForm = { when: '', place: '', note: '' };

  viewingFor(applicationId: string): RoomViewing | null {
    return this.viewings()[applicationId] ?? null;
  }

  viewingLabel(v: RoomViewing): string {
    // ⚠️ An elapsed viewing is NOT "they are coming". That sentence was on
    // this screen about Saturdays weeks gone, which is the bug Phase 8n fixes.
    if (this.elapsed(v)) return 'The agreed time has passed';
    if (v.outcome) return this.outcomeLabel(v.outcome);
    return {
      proposed: 'Invited, waiting for an answer',
      accepted: 'They are coming',
      declined: 'They cannot make it',
      cancelled: 'Called off',
    }[v.status];
  }

  // ── A viewing whose time has passed — Phase 8n ───────────────────
  /** applicationId → the answer being given, before it is saved. */
  readonly outcomeChoice = signal<Record<string, ViewingOutcome>>({});
  outcomeNote = '';

  /**
   * The five answers, in the LANDLORD's words.
   *
   * ⚠️ The same five values read differently on the tenant's dashboard —
   * only the values are shared, never the wording, because "they did not come"
   * and "I could not go" are one outcome told from two ends.
   */
  readonly outcomes: ReadonlyArray<{ value: ViewingOutcome; icon: string; label: string; closes: boolean }> = [
    { value: 'happened', icon: 'check-circle', label: 'They came and saw it', closes: false },
    { value: 'rearranged_privately', icon: 'clock', label: 'We met at a different time', closes: false },
    { value: 'no_answer', icon: 'x', label: 'They did not turn up', closes: false },
    { value: 'fell_through_other_room', icon: 'door', label: 'They have taken another room', closes: true },
    { value: 'fell_through_other_tenant', icon: 'lock', label: 'I have let it to somebody else', closes: true },
  ];

  private outcomeLabel(o: ViewingOutcome): string {
    return this.outcomes.find((x) => x.value === o)?.label ?? o;
  }

  /**
   * The agreed time is in the past and nobody has said what happened.
   *
   * ⚠️ Derived from the clock, never stored. A column saying "this has
   * passed" would need a job to keep it true — the reason Phase G derives an
   * elapsed notice period the same way.
   */
  elapsed(v: RoomViewing): boolean {
    return v.status === 'accepted' && !v.outcome && new Date(v.startsAt).getTime() < Date.now();
  }

  chosenOutcome(applicationId: string) {
    const value = this.outcomeChoice()[applicationId];
    return this.outcomes.find((o) => o.value === value) ?? null;
  }

  pickOutcome(applicationId: string, value: ViewingOutcome | null) {
    this.outcomeNote = '';
    this.outcomeChoice.update((m) => {
      const next = { ...m };
      if (value) next[applicationId] = value; else delete next[applicationId];
      return next;
    });
  }

  saveOutcome(app: Application, v: RoomViewing) {
    const choice = this.chosenOutcome(app.id);
    if (!choice) return;
    this.busyViewing.set(app.id);
    this.applicationsService.recordViewingOutcome(v.id, choice.value, this.outcomeNote.trim() || undefined)
      .subscribe({
        next: (res) => {
          this.busyViewing.set(null);
          this.pickOutcome(app.id, null);
          this.viewings.update((m) => ({ ...m, [app.id]: res }));
          /**
           * ⚠️ Said out loud, because "I have let it to somebody else" IS an
           * acceptance in the landlord's head and must not be one in the
           * database. Nothing here accepts anybody, and the dialog carries
           * the server's own words about the two honest next steps.
           */
          if (res.nextStep) {
            this.dialogs.alert('Nobody has been accepted', res.nextStep);
          }
          if (res.applicationClosed) this.reloadApplications();
        },
        error: (err) => {
          this.busyViewing.set(null);
          this.dialogs.error(err?.error?.message ?? 'That did not save. Try again.');
        },
      });
  }

  /**
   * Load the viewings for the applicants on screen.
   *
   * One request per application rather than a batch endpoint: this screen shows
   * one room's applicants, which is a handful, and a list endpoint nobody else
   * needs is a second thing to keep right.
   */
  loadViewings(ids: string[]) {
    for (const id of ids) {
      this.applicationsService.viewingsFor(id).subscribe({
        next: (list) => {
          // The latest by start time: an older cancelled one under it is noise.
          const latest = [...list].sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
          if (latest) this.viewings.update((m) => ({ ...m, [id]: latest }));
        },
        error: () => {},
      });
    }
  }

  startInvite(app: { id: string }) {
    this.inviteError.set(null);
    /**
     * ⚠️ Empty, not pre-filled with the property address.
     *
     * The landlord typed that address into a field promising "Only you see
     * this. It is never on a listing and never sent to an applicant."
     * Pre-filling it here would break that on their behalf, without their
     * knowing it had happened.
     */
    this.inviteForm = { when: '', place: '', note: '' };
    this.invitingId.set(app.id);
  }

  sendInvite(app: { id: string }) {
    const when = this.inviteForm.when;
    const place = this.inviteForm.place.trim();
    if (!when) { this.inviteError.set('Pick a day and a time.'); return; }
    if (place.length < 3) {
      this.inviteError.set('Say where to meet. An invitation with no place is one nobody can turn up to.');
      return;
    }
    // datetime-local carries no timezone, so the browser reads it as local
    // time — which for everybody using this is SAST, the time they meant.
    const startsAt = new Date(when);
    if (startsAt.getTime() <= Date.now()) {
      this.inviteError.set('Pick a time that has not already passed.');
      return;
    }

    this.busyViewing.set(app.id);
    this.inviteError.set(null);
    this.applicationsService.inviteToViewing(app.id, {
      startsAt: startsAt.toISOString(),
      meetingPlace: place,
      note: this.inviteForm.note.trim() || undefined,
    }).subscribe({
      next: (v) => {
        this.busyViewing.set(null);
        this.invitingId.set(null);
        this.viewings.update((m) => ({ ...m, [app.id]: v }));
      },
      error: (err) => {
        this.busyViewing.set(null);
        this.inviteError.set(err?.error?.message ?? 'That did not send. Try again.');
      },
    });
  }

  async callOff(app: { id: string }, v: RoomViewing) {
    const confirmed = await this.dialogs.confirm(
      'Call off the viewing?',
      'We will tell them it is off so nobody turns up. You can offer another time afterwards.',
      'Call it off',
    );
    if (!confirmed) return;
    this.busyViewing.set(app.id);
    this.applicationsService.cancelViewing(v.id).subscribe({
      next: (updated) => {
        this.busyViewing.set(null);
        this.viewings.update((m) => ({ ...m, [app.id]: updated }));
      },
      error: (err) => {
        this.busyViewing.set(null);
        this.dialogs.error(err?.error?.message ?? 'Could not call that off. Try again.');
      },
    });
  }

  ngOnInit() {
    this.reloadApplications();
  }

  /**
   * Re-read the list.
   *
   * Called again after an outcome that CLOSES an application: the row's status
   * changed server-side, and a screen still offering Accept and Reject on an
   * application the server now calls closed is the oldest defect in this
   * codebase — one state, two readers, disagreeing.
   */
  private reloadApplications() {
    this.applicationsService.getRoomApplications(this.roomId()).subscribe({
      next: (apps) => {
        this.applications.set(apps);
        this.loading.set(false);
        this.openRequested(apps);
        this.loadViewings(apps.map((a) => a.id));
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
