import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MessageThread } from '../../../shared/components/message-thread/message-thread';
import { AuthService } from '../../../core/services/auth.service';
import { MessagesService } from '../../../core/services/messages.service';
import { MessageThreadSummary } from '../../../core/models/message.model';
import { ScreenHint } from '../../../shared/components/screen-hint/screen-hint';

/**
 * Your messages — Phase 7c.
 *
 * ── Why this screen exists
 *
 * Until now a conversation was reachable only from inside the application it
 * belonged to. For a landlord that meant opening each room's applicant list and
 * expanding each applicant to find out whether anybody had replied — seventeen
 * places for six rooms and eleven applicants. For a tenant it was the same
 * problem smaller: four applications, four places. Both navs listed "Messages"
 * as a destination and Phase 7a had to mark it `disabled` with a "Soon" chip,
 * because it was a promise nothing kept. This is the page.
 *
 * ── Why ONE screen for both roles, in /account
 *
 * The same reason the notices screen lives here: the page is identical, the
 * endpoint is identical, and the sidebar follows whichever portal the account
 * belongs to. But there is a stronger reason than symmetry — a sub-lessor is a
 * TENANT account that also lets a room, so they have conversations on BOTH
 * sides at once. Two role-scoped screens would split one person's messages in
 * half by a distinction they do not have. Each row says which side it is,
 * because that changes where a reply goes.
 *
 * ── The channel warning is the point, not decoration
 *
 * A tenant's message is forwarded to the landlord over WhatsApp. If the landlord
 * replies there, the webhook threads that reply back into this conversation —
 * so a thread genuinely mixes channels, and the landlord's last answer may have
 * left by a different door from the one they are now typing at. Replies typed
 * here are always in-app messages; a landlord's reply never goes out over
 * WhatsApp, whatever channel the message they are answering arrived on. Nothing
 * else on the screen would tell them that, so this screen says it.
 */
@Component({
  selector: 'app-messages',
  standalone: true,
  imports: [MessageThread, DatePipe, ScreenHint],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
      <app-screen-hint key="messages" heading="Every conversation, in one place">
        A thread starts when somebody applies for your room, or you apply for theirs. Messages reach you on WhatsApp too, and a reply there lands back in the same conversation.
      </app-screen-hint>

      <section class="dash-section">
        <div class="msg-head">
          <h2 class="dash-section-title">Every conversation</h2>
          @if (!loading() && !failed() && unreadThreads() > 0) {
            <p class="msg-count">
              <strong>{{ unreadThreads() }}</strong>
              {{ unreadThreads() === 1 ? 'conversation needs' : 'conversations need' }} a reply
            </p>
          }
        </div>

        <!-- Three states, not two. "No messages" on a failed request tells
             somebody nobody has written to them, which is exactly the wrong
             thing to say when the request simply did not come back. -->
        @if (failed()) {
          <p class="msg-empty" role="alert">
            We could not load your messages just now — this is a problem at our
            end, not an empty inbox.
            <button type="button" class="link-button" (click)="load()">Try again</button>.
          </p>
        } @else if (loading()) {
          <p class="msg-empty">Loading…</p>
        } @else if (threads().length === 0) {
          <p class="msg-empty">
            No conversations yet. A message is always about one application, so a
            thread starts when you apply for a room or somebody applies for
            yours — and it appears here as soon as either of you says anything.
          </p>
        }

        <ul class="msg-list">
          @for (t of threads(); track t.applicationId) {
            <li class="msg-row" [class.is-unread]="t.unread > 0">
              <button type="button" class="msg-row__head" (click)="toggle(t)"
                      [attr.aria-expanded]="openId() === t.applicationId">
                <div class="msg-row__main">
                  <div class="msg-row__who">
                    <strong>{{ t.withName }}</strong>
                    <span class="side">{{ t.iAmLandlord ? 'applied to you' : 'your application' }}</span>
                    @if (t.unread > 0) {
                      <span class="unread">{{ t.unread }} new</span>
                    }
                    @if (t.closed) { <span class="closed">Closed</span> }
                  </div>
                  <p class="msg-row__room">{{ t.room.title }}</p>
                  <p class="msg-row__last">
                    <!-- Which door the last message came through. -->
                    <span class="chan chan--{{ t.lastMessage.channel }}">
                      {{ t.lastMessage.channel === 'whatsapp' ? '💬 WhatsApp' : '📱 In the app' }}
                    </span>
                    <span class="preview">
                      {{ t.lastMessage.fromMe ? 'You: ' : '' }}{{ t.lastMessage.body }}
                    </span>
                  </p>
                  <p class="msg-row__meta">
                    {{ t.lastMessage.createdAt | date: 'd MMM y, HH:mm' }}
                    · {{ t.messageCount }} {{ t.messageCount === 1 ? 'message' : 'messages' }}
                  </p>
                </div>
                <span class="msg-row__chev" aria-hidden="true">
                  {{ openId() === t.applicationId ? '▲' : '▼' }}
                </span>
              </button>

              @if (openId() === t.applicationId) {
                <div class="msg-row__body">
                  <!-- The warning, above the composer rather than below it, and
                       only on threads that have actually used more than one
                       channel. On every other thread it would be noise, and a
                       warning shown everywhere is a warning nobody reads. -->
                  @if (t.channelsUsed.length > 1 && !t.closed) {
                    <p class="chan-warn" role="note">
                      <strong>This conversation has used WhatsApp and the app.</strong>
                      {{ replyGoesTo(t) }}
                    </p>
                  }

                  <app-message-thread
                    [applicationId]="t.applicationId"
                    [closed]="t.closed"
                    [closedReason]="closedReason(t)"/>

                  @if (!t.closed && t.channelsUsed.length <= 1) {
                    <p class="chan-note">{{ replyGoesTo(t) }}</p>
                  }
                </div>
              }
            </li>
          }
        </ul>
      </section>
  `,
  styles: `
    .msg-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
    .msg-count { font-size: .85rem; color: var(--slate); margin: 0; }
    .msg-empty { color: var(--slate); line-height: 1.6; max-width: 34rem; }
    .msg-list { list-style: none; padding: 0; margin: 1rem 0 0; }
    .msg-row { border-bottom: 1px solid var(--border); }
    /* A left bar rather than a bold font: on a cheap phone screen in daylight
       a weight change is close to invisible. */
    .msg-row.is-unread { border-left: 3px solid var(--terra); padding-left: .75rem; margin-left: -.75rem; }
    /* The whole row is the control, so it is a real button — a div with a
       click handler is unreachable by keyboard.
       NOTE: color: inherit is not tidiness. A button picks up the user agent's
       own colour, so without it every row read white-on-cream at 1.06:1 —
       invisible, and reported green by the a11y drive until that drive was
       given rows to look at. font: inherit resets the family and the size but
       NOT the colour. */
    .msg-row__head {
      display: flex; width: 100%; gap: 1rem; align-items: flex-start; justify-content: space-between;
      background: none; border: none; padding: .9rem 0; font: inherit; color: inherit;
      text-align: left; cursor: pointer;
      /* ⚠️ white-space: normal, and this is the whole of the owner's report
         that "the description of the room is not moving to the next line".

         The base rule :where(button) in styles.scss sets white-space: nowrap —
         right for a button that holds a short label, wrong for one used as a
         ROW. white-space inherits, so every piece of text in here was on one
         line: measured at 360px the room title wanted 502px in a 300px column
         and the message preview 993px, and the document was 1012px wide in a
         360px viewport.

         font: inherit above does NOT reset it — font is family, size, weight,
         style, variant and line-height, and nothing else. The note beside it
         about colour is the same lesson learned once already on this element.

         Zero specificity means a plain class wins, so this one declaration is
         the whole fix. Any other button used as a container for wrapping text
         has the same problem; recorded in OUTSTANDING. */
      white-space: normal;
    }
    .msg-row__main { flex: 1; min-width: 0; }
    .msg-row__who { display: flex; align-items: center; gap: .4rem; flex-wrap: wrap; }
    .side { font-size: .7rem; color: var(--slate); }
    .unread { font-size: .65rem; font-weight: 700; background: var(--terra); color: #fff; padding: .1rem .4rem; border-radius: 10px; }
    .closed { font-size: .65rem; font-weight: 700; background: #F2EDE3; color: #3A3228; padding: .1rem .4rem; border-radius: 10px; }
    .msg-row__room { margin: .25rem 0 0; font-size: .85rem; }
    .msg-row__last { margin: .3rem 0 0; font-size: .8rem; display: flex; gap: .4rem; align-items: baseline; flex-wrap: wrap; }
    /* ⚠️ min-width: 0, and without it the whole page scrolled sideways.
       (No backticks in here: a backtick inside this styles template literal
       terminates it, which CLAUDE.md records and which just cost a fourth
       compile failure.)
       A flex item's automatic minimum size is its content, not zero, so this
       span refused to shrink below the width of the last message on one line:
       measured at 360px it was 993px wide inside a 300px container, and the
       document was 1012px wide in a 360px viewport. overflow-wrap: anywhere
       was already here and cannot help on its own — it breaks a long WORD
       inside a box, it does not make the box narrower.
       Horizontal page scroll and "text that becomes a single line hundreds of
       characters wide" are both on the mobile checklist in CLAUDE.md; this was
       one element producing both. */
    .preview { color: var(--slate); overflow-wrap: anywhere; min-width: 0; }
    .msg-row__meta { margin: .3rem 0 0; font-size: .75rem; color: var(--slate); }
    .msg-row__chev { color: var(--slate); font-size: .7rem; flex-shrink: 0; }
    .msg-row__body { padding: 0 0 1rem; }
    .chan { font-size: .65rem; font-weight: 700; padding: .1rem .4rem; border-radius: 10px; white-space: nowrap; }
    .chan--in_app { background: #F2EDE3; color: #3A3228; }
    .chan--whatsapp { background: rgba(37,211,102,.14); color: #0F7A3D; }
    .chan-warn {
      margin: 0 0 .5rem; padding: .6rem .75rem; font-size: .78rem; line-height: 1.5;
      background: rgba(214,154,59,.1); border: 1px solid rgba(214,154,59,.35);
      border-radius: 8px; color: #3A3228;
    }
    .chan-note { margin: .4rem 0 0; font-size: .72rem; color: var(--slate); line-height: 1.5; }
    .link-button {
      background: none; border: none; padding: 0; font: inherit;
      color: var(--terra); text-decoration: underline; cursor: pointer;
    }
  `,
})
export class MessagesInbox implements OnInit {
  private auth = inject(AuthService);
  private messages = inject(MessagesService);

  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly threads = signal<MessageThreadSummary[]>([]);
  readonly unreadThreads = signal(0);
  readonly openId = signal<string | null>(null);

  ngOnInit() {
    this.load();
    // So the Notices badge in the sidebar is a real number on this screen too,
  }

  load() {
    this.loading.set(true);
    this.failed.set(false);
    this.messages.inbox().subscribe({
      next: (res) => {
        this.threads.set(res.data);
        this.unreadThreads.set(res.unreadThreads);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.failed.set(true); },
    });
  }

  /**
   * Opening a thread clears its unread count here as well as on the server.
   *
   * `GET /applications/:id/messages` marks the other party's messages read, so
   * the badge is stale the moment the thread renders. Patched locally rather
   * than refetched: a second request for the whole inbox to learn a number we
   * already know would be slower and would reorder the list under the cursor.
   */
  toggle(t: MessageThreadSummary) {
    const opening = this.openId() !== t.applicationId;
    this.openId.set(opening ? t.applicationId : null);
    if (!opening || t.unread === 0) return;

    this.threads.update((list) =>
      list.map((x) => (x.applicationId === t.applicationId ? { ...x, unread: 0 } : x)),
    );
    this.unreadThreads.update((n) => Math.max(0, n - 1));
  }

  /**
   * Where a reply typed here actually goes, in the words of the person reading.
   *
   * Written from what the server does, not from what feels likely:
   * `MessagesService.send` always writes `channel: 'in_app'` and hands the
   * recipient to `NoticeRouter`, which emails them when there is an address and
   * always writes an in-app notice. WhatsApp is attempted for the LANDLORD only
   * — tenants never opted a number in — so a landlord's reply does not go out
   * over WhatsApp even when the message they are answering arrived on it.
   */
  replyGoesTo(t: MessageThreadSummary): string {
    return t.iAmLandlord
      ? 'A reply you type here is sent in the app and emailed to them. It does not ' +
        'go out on WhatsApp. If you answer in WhatsApp instead, that answer shows up here too.'
      : 'A reply you type here is sent in the app, emailed to them, and forwarded on ' +
        'WhatsApp if they have WhatsApp switched on.';
  }

  /** Why it is closed, in the words that match what happened. */
  closedReason(t: MessageThreadSummary): string {
    if (t.status === 'rejected') {
      return 'This conversation is closed because the application was turned down. ' +
        'The messages stay here to read.';
    }
    if (t.status === 'withdrawn') {
      return 'This conversation is closed because the application was withdrawn. ' +
        'The messages stay here to read.';
    }
    return 'This conversation is closed because the listing was relisted or removed. ' +
      'The messages stay here to read.';
  }
}
