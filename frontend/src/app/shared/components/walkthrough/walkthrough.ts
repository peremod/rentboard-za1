import {
  ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, signal, viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { WalkthroughService } from '../../../core/services/walkthrough.service';

/** One card of the tour. `route` is where the thing being described lives. */
interface Step {
  icon: string;
  title: string;
  body: string;
  /** Optional: a link straight to the thing, for somebody who wants it now. */
  route?: string;
  linkLabel?: string;
}

/**
 * Four steps, not nine.
 *
 * ⚠️ Four was the original count, and the owner overruled it — Phase 8b.
 *
 * The argument for four was that it is what somebody reads before they start
 * tapping. The report from the person who actually uses this was the opposite:
 * "the walkthrough is minimal, it doesn't go through all the features, it
 * doesn't show how to use the features." Four cards cannot teach a screen, and
 * four cards that skip grouping, viewings, rent and the forms leave a landlord
 * believing the product does less than it does.
 *
 * So the tour is wider, and the teaching moved to where it can land: a
 * first-use hint at the top of each screen the first time that account opens
 * it (`app-screen-hint`, Phase 8b). The tour says what exists; the hint says
 * what this screen is for, at the moment somebody is looking at it. Neither
 * does the other's job, which is why four steps felt thin and eight would have
 * felt long without them.
 *
 * What has NOT changed: every step is a thing this product actually does. No
 * step describes a feature behind a flag or waiting on a template approval,
 * because a tour that promises something the app cannot do is worse than no
 * tour. ⚠️ That rule is why there is no step about confirming a move-in: the
 * endpoint exists and nothing in the UI calls it (docs/OUTSTANDING.md §18).
 */
const LANDLORD_STEPS: Step[] = [
  {
    icon: '🏠',
    title: 'Listing a room is free, and stays free',
    body:
      'No fee to post, no fee to keep it up, no commission when you let it. Up to '
      + '20 photos a room. You can start a listing here or just send the photos to '
      + 'us on WhatsApp and finish it later.',
    route: '/landlord/rooms/new',
    linkLabel: 'List a room',
  },
  {
    icon: '📥',
    title: 'Everyone who applies, in one place',
    body:
      'Applicants from all your rooms on one screen, with the ones still waiting '
      + 'on you first. Shortlist, accept or turn somebody down — and if you accept '
      + 'by mistake you have thirty minutes to undo it.',
    route: '/landlord/applicants',
    linkLabel: 'See applicants',
  },
  {
    icon: '💬',
    title: 'Messages reach you on WhatsApp too',
    body:
      'When somebody writes to you we send it to WhatsApp as well, and your reply '
      + 'there lands back in the same conversation. The inbox says which way each '
      + 'message came in, so you always know where your last answer went.',
    route: '/account/messages',
    linkLabel: 'Open messages',
  },
  {
    icon: '🪪',
    title: 'Getting verified gets you more applicants',
    body:
      'A verified badge is the main thing a tenant looks for, because anyone can '
      + 'post a room anywhere. We check your ID and your ownership once, delete the '
      + 'documents afterwards, and keep only the outcome.',
    route: '/landlord/verification',
    linkLabel: 'Get verified',
  },
  {
    icon: '🏘️',
    title: 'Rooms at one address belong together',
    body:
      'A property groups the rooms at one address, so you set the house rules and '
      + 'what everyone shares once instead of typing them into every room. It is '
      + 'optional — rooms without one work exactly the same.',
    route: '/landlord/properties',
    linkLabel: 'My properties',
  },
  {
    icon: '📅',
    title: 'Agree a viewing without losing it in the chat',
    body:
      'Invite an applicant to view before you decide. They answer yes or no, it '
      + 'sits on both your screens with the date, and nobody has to scroll back '
      + 'through a conversation to find what was agreed.',
    route: '/landlord/applicants',
    linkLabel: 'See applicants',
  },
  {
    icon: '📒',
    title: 'Rent, written down in one place',
    body:
      'Mark each month paid, unpaid, part-paid or waived, room by room. This is '
      + 'your own record — Mastande never holds your rent or your deposit — and '
      + 'your tenant can answer a month they disagree with, beside your note.',
    route: '/landlord/properties',
    linkLabel: 'Open a property',
  },
  {
    icon: '📄',
    title: 'The paperwork, free to print',
    body:
      'A lease, a renewal, a move-in inspection and a deposit receipt, ready to '
      + 'download and sign on paper. The inspection is the one that decides a '
      + 'deposit argument later, and most people skip it.',
    route: '/landlord/templates',
    linkLabel: 'Forms and templates',
  },
];

const TENANT_STEPS: Step[] = [
  {
    icon: '🔍',
    title: 'Applying is free. Always.',
    body:
      'No application fee, no fee to message a landlord, no subscription. You are '
      + 'dealing with the landlord direct — there is no agent in between taking a '
      + 'cut, which is the whole point of this board.',
    route: '/',
    linkLabel: 'Browse rooms',
  },
  {
    icon: '🛂',
    title: "The Renter's Passport puts you ahead",
    body:
      'Get your ID, your income and a reference checked once, and every landlord '
      + 'you apply to sees the badge. It is free, and your documents are deleted '
      + 'after the check — only the outcome is kept, never the paperwork.',
    route: '/tenant/passport',
    linkLabel: 'Start my Passport',
  },
  {
    icon: '📋',
    title: 'You can see exactly where you stand',
    body:
      'Every application says what has happened in plain words — whether nobody '
      + 'has opened it yet, or the landlord has read it and not answered. If '
      + 'something needs you, it is at the top of your dashboard.',
    route: '/tenant/dashboard',
    linkLabel: 'My dashboard',
  },
  {
    icon: '🧾',
    title: 'Rent, and your side of the record',
    body:
      'Once you move in, your landlord records what was paid. If their record is '
      + 'wrong you can say so, and it sits beside theirs rather than replacing it. '
      + 'Mastande never handles the money — this is a record, not a payment.',
    route: '/tenant/rent',
    linkLabel: 'Rent',
  },
  {
    icon: '📅',
    title: 'A viewing you can both look up',
    body:
      'When a landlord invites you to see a room, it arrives here with the date '
      + 'and the place. Say yes or no, and it stays on the screen for both of you '
      + 'instead of being buried in the chat.',
    route: '/tenant/dashboard',
    linkLabel: 'Your applications',
  },
  {
    icon: '💬',
    title: 'Messages reach you on WhatsApp too',
    body:
      'A thread starts when you apply for a room. We send it to WhatsApp as well, '
      + 'and a reply there lands back in the same conversation, so you do not have '
      + 'to keep the site open to hear back.',
    route: '/account/messages',
    linkLabel: 'Open messages',
  },
];

const ADMIN_STEPS: Step[] = [
  {
    icon: '🪪',
    title: 'The verification queue is the product',
    body:
      'Everything Mastande claims about a person rests on what gets approved here. '
      + 'Documents are deleted once a decision is recorded, so the queue is the '
      + 'only place they exist — and only until you have looked.',
    route: '/admin/verifications',
    linkLabel: 'Open the queue',
  },
  {
    icon: '🚩',
    title: 'Reports and disputes',
    body:
      'Scam reports come in from the public without an account, because a scam '
      + 'listing left up costs more than a false report costs you. Disputes are '
      + 'between a landlord and a tenant and Mastande does not decide who is right.',
    route: '/admin/reports',
    linkLabel: 'Reports',
  },
  {
    icon: '📊',
    title: 'What the numbers do and do not say',
    body:
      'Every figure here ships with what it is from. Anything computed from too '
      + 'little data says so instead of rounding a guess into a percentage.',
    route: '/admin/analytics',
    linkLabel: 'Usage',
  },
];

/**
 * The first-run walkthrough — Phase 7f.
 *
 * ── Rendered by the layout, once
 *
 * It hangs off `PortalLayout`, so it is available on every screen behind a
 * login and defined in one place. The same reasoning as the sidebar in Phase
 * 7e: twenty-three screens remembering to include something is twenty-three
 * chances to forget, and two of them had.
 *
 * ── Role-appropriate, and that is not cosmetic
 *
 * A landlord and a tenant use this product for opposite things. A tenant shown
 * "listing a room is free" learns nothing, and a landlord shown the Renter's
 * Passport is being sold somebody else's feature. An admin gets the three
 * queues their account exists for.
 *
 * ── Skippable, and it comes back on request
 *
 * Close it and the account is stamped, so it does not return on the next login
 * — the brief is explicit about that. "Show me around again" in account
 * settings clears the stamp, which is why the record is a nullable timestamp
 * rather than a boolean that only goes one way.
 *
 * ── On a phone first
 *
 * A sheet from the bottom at phone width and a centred card above it, because
 * a fixed-width modal at 360px is the thing you cannot close. Every control is
 * at least 44px, Escape closes it, and focus moves into the card on open.
 */
@Component({
  selector: 'app-walkthrough',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  /**
   * ⚠️ Escape is bound on the DOCUMENT, not on the card.
   *
   * It was `(keydown.escape)` on the card with `tabindex="-1"`, and nothing
   * ever focused the card — so the key event had nowhere to land and Escape
   * did nothing. A drive caught it; by hand it is the kind of thing you only
   * notice if you happen to try. A modal that can only be left with a pointer
   * is a trap for anybody on a keyboard, and the card is a full-screen sheet on
   * a phone, so there is nothing else to click.
   *
   * Focus is moved into the card on open as well, which is what a dialog should
   * do regardless — and it means the Tab order starts inside the thing that is
   * covering the screen rather than behind it.
   */
  host: { '(document:keydown.escape)': 'onEscape()' },
  template: `
    @if (walkthrough.shouldShow()) {
      <div class="wt-overlay" (click)="skip()">
        <!-- role="dialog" with the heading as its label, and the click stopped
             from bubbling so tapping the card does not dismiss it. -->
        <div class="wt-card" role="dialog" aria-modal="true" aria-labelledby="wt-title"
             (click)="$event.stopPropagation()" tabindex="-1" #card>
          <div class="wt-head">
            <span class="wt-step">Step {{ index() + 1 }} of {{ steps().length }}</span>
            <!-- Skip is a real button with a word on it, not an ✕. An icon
                 alone is the thing people cannot find when they want out. -->
            <button type="button" class="wt-skip" (click)="skip()">Skip</button>
          </div>

          @if (step(); as s) {
            <div class="wt-icon" aria-hidden="true">{{ s.icon }}</div>
            <h2 class="wt-title" id="wt-title">{{ s.title }}</h2>
            <p class="wt-body">{{ s.body }}</p>

            <div class="wt-dots" aria-hidden="true">
              @for (d of steps(); track $index) {
                <span class="wt-dot" [class.is-on]="$index === index()"></span>
              }
            </div>

            <div class="wt-actions">
              @if (index() > 0) {
                <button type="button" class="btn btn-ghost-light" (click)="back()">Back</button>
              }
              @if (!last()) {
                <button type="button" class="btn btn-primary" (click)="next()">Next</button>
              } @else {
                <button type="button" class="btn btn-primary" (click)="skip()">Got it</button>
              }
              @if (s.route && s.linkLabel) {
                <!-- Take me there NOW. Somebody who wants the thing should not
                     have to finish being told about it first. Dismisses on the
                     way out, because they have seen enough to act. -->
                <a class="wt-go" [routerLink]="s.route" (click)="skip()">{{ s.linkLabel }} →</a>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: `
    .wt-overlay {
      position: fixed; inset: 0; z-index: 400;
      background: rgba(26, 20, 16, .55);
      display: flex; align-items: center; justify-content: center;
      padding: 1rem;
    }
    .wt-card {
      background: var(--card, #fff); border-radius: var(--r12, 12px);
      box-shadow: 0 18px 50px rgba(0, 0, 0, .3);
      max-width: 30rem; width: 100%; padding: 1.5rem;
      max-height: calc(100vh - 2rem); overflow-y: auto;
    }
    .wt-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    .wt-step { font-size: .72rem; color: var(--slate); font-weight: 600; letter-spacing: .02em; }
    /* 44px, because this is the control somebody reaches for when they are not
       in the mood to be shown anything. */
    .wt-skip {
      background: none; border: none; font: inherit; font-size: .82rem; font-weight: 600;
      color: var(--slate); text-decoration: underline; cursor: pointer;
      min-height: 44px; padding: 0 .25rem;
    }
    .wt-icon { font-size: 2rem; line-height: 1; margin: .5rem 0 .75rem; }
    .wt-title { font-size: 1.15rem; margin: 0 0 .5rem; line-height: 1.3; }
    .wt-body { margin: 0; line-height: 1.65; color: var(--ink2); }
    .wt-dots { display: flex; gap: .3rem; margin: 1.1rem 0 1rem; }
    .wt-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--border); }
    .wt-dot.is-on { background: var(--terra); width: 20px; border-radius: 4px; }
    .wt-actions { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; }
    .wt-actions .btn { min-height: 44px; }
    .wt-go {
      font-size: .82rem; font-weight: 600; margin-left: auto;
      min-height: 44px; display: inline-flex; align-items: center;
    }

    /* A sheet from the bottom on a phone. A centred fixed-width card at 360px
       is the one somebody cannot get out of, and the thumb is at the bottom. */
    @media (max-width: 480px) {
      .wt-overlay { align-items: flex-end; padding: 0; }
      .wt-card {
        max-width: none; border-radius: var(--r12, 12px) var(--r12, 12px) 0 0;
        padding: 1.25rem 1.1rem 1.5rem; max-height: 88vh;
      }
      .wt-actions .btn { flex: 1; justify-content: center; }
      .wt-go { margin-left: 0; width: 100%; justify-content: center; }
    }
  `,
})
export class Walkthrough {
  private auth = inject(AuthService);
  protected walkthrough = inject(WalkthroughService);

  protected readonly index = signal(0);

  private readonly card = viewChild<ElementRef<HTMLElement>>('card');

  constructor() {
    // Focus the sheet as it opens. Guarded on the element existing, because the
    // effect also runs on the pass where it has just been removed.
    effect(() => {
      if (!this.walkthrough.shouldShow()) return;
      this.card()?.nativeElement.focus({ preventScroll: true });
    });
  }

  /** Only when it is actually open — the binding is on the document. */
  protected onEscape() {
    if (this.walkthrough.shouldShow()) this.skip();
  }

  protected readonly steps = computed<Step[]>(() =>
    this.auth.isAdmin() ? ADMIN_STEPS : this.auth.isLandlord() ? LANDLORD_STEPS : TENANT_STEPS,
  );

  protected readonly step = computed<Step | undefined>(() => this.steps()[this.index()]);
  protected readonly last = computed(() => this.index() >= this.steps().length - 1);

  protected next() { this.index.update((i) => Math.min(i + 1, this.steps().length - 1)); }
  protected back() { this.index.update((i) => Math.max(i - 1, 0)); }

  /**
   * Skip, finish and "take me there" all land here.
   *
   * They are the same event as far as the record goes: this person has been
   * shown round and should not be shown round again. Recording which step they
   * reached would only invite a later version to resume them in the middle of
   * something they walked away from.
   */
  protected skip() { this.walkthrough.dismiss(); }
}
