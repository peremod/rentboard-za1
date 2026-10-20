import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { MessagesService } from '../../../core/services/messages.service';
import { Message } from '../../../core/models/message.model';
import { Loading } from '../loading/loading';
import { Icon } from '../icon/icon';

/**
 * Reusable conversation thread — embedded in the tenant dashboard (per
 * application), the landlord applicant manager (per applicant) and the unified
 * inbox (per thread).
 *
 * What it SENDS is always an in-app message (`channel: 'in_app'`). What it
 * RENDERS may not be: a tenant's message is forwarded to the landlord over
 * WhatsApp, and if the landlord replies there the webhook threads that reply
 * back into this same conversation as `channel: 'whatsapp'`. So one thread
 * genuinely mixes channels, every message carries which one it came in on, and
 * the inbox screen says out loud where a reply typed here will go — Phase 7c.
 */
@Component({
  selector: 'app-message-thread',
  standalone: true,
  imports: [Icon, FormsModule, Loading],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="thread">
      <div class="thread__messages">
        @if (loading()) {
          <app-loading>Loading conversation…</app-loading>
        } @else if (messages().length === 0) {
          <p class="muted">No messages yet — say hello <app-icon name="hand"/></p>
        } @else {
          @for (m of messages(); track m.id) {
            <div class="thread__message" [class.mine]="m.senderId === auth.user()?.id">
              <p>{{ m.body }}</p>
              @if (m.channel === 'whatsapp') { <span class="thread__channel">via WhatsApp</span> }
            </div>
          }
        }
      </div>
      <!-- A closed conversation stays readable and cannot be added to. The
           server already refuses the send; until Phase 7c the refusal was
           caught and dropped, so the message simply vanished from the input
           with no explanation. Hiding the composer says why BEFORE somebody
           types. -->
      @if (closed()) {
        <p class="thread__closed">{{ closedReason() }}</p>
      } @else {
        <div class="thread__composer">
          <input type="text" [(ngModel)]="draft" placeholder="Type a message…" (keyup.enter)="send()"/>
          <button type="button" [disabled]="!draft.trim() || sending()" (click)="send()">Send</button>
        </div>
        <!-- Every other failure, said out loud. A send that fails silently
             looks exactly like a send that worked. -->
        @if (sendError()) {
          <p class="thread__error" role="alert">{{ sendError() }}</p>
        }
      }
    </div>
  `,
  styles: [`
    .thread { border: 1px solid var(--border); border-radius: var(--r8); overflow: hidden; margin-top: .75rem; }
    .thread__messages { max-height: 260px; overflow-y: auto; padding: .75rem; display: flex; flex-direction: column; gap: .5rem; background: #FDFAF5; }
    .muted { font-size: .8rem; color: var(--slate); }
    .thread__message { align-self: flex-start; background: #F2EDE3; padding: .5rem .7rem; border-radius: var(--r12); max-width: 80%; font-size: .82rem; }
    .thread__message.mine { align-self: flex-end; background: var(--terra); color: var(--white); }
    .thread__channel { display: block; font-size: .6rem; opacity: .7; margin-top: .2rem; }
    .thread__composer { display: flex; border-top: 1px solid var(--border); }
    /* ⚠️ min-width:0. A flex child with flex:1 still refuses to go below its
       INTRINSIC width, and a text input's intrinsic width is about twenty
       characters — so at 360px the composer was wider than the card holding
       it and pushed the page sideways. Found by a11y-drive once it was run
       at 360 instead of only at 412; it is invisible at the wider size,
       which is why four widths are a standing rule and not a preference. */
    .thread__composer input {
      flex: 1; min-width: 0; border: none; padding: .6rem .7rem;
      font-size: .82rem; font-family: inherit; min-height: 44px;
    }
    /* flex-shrink:0 so the input absorbs the squeeze rather than the Send
       button losing its label; 44px because this is a control on a phone
       (WCAG 2.5.8) and it had no height of its own at all. */
    .thread__composer button {
      border: none; background: #1A1410; color: var(--white); padding: 0 1rem;
      cursor: pointer; font-weight: 700; font-size: .8rem;
      flex-shrink: 0; min-height: 44px;
    }
    .thread__composer button:disabled { opacity: .5; cursor: not-allowed; }
    .thread__closed { margin: 0; padding: .6rem .7rem; font-size: .75rem; color: var(--slate);
                      border-top: 1px solid var(--border); background: #FDFAF5; line-height: 1.5; }
    .thread__error { margin: 0; padding: .5rem .7rem; font-size: .75rem; color: var(--danger);
                     border-top: 1px solid var(--border); background: rgba(214,59,59,.06); }
  `],
})
export class MessageThread implements OnInit {
  applicationId = input.required<string>();

  /**
   * Hides the composer. Passed by a caller that already knows the application
   * is rejected, withdrawn or relisted — the server refuses those sends, and
   * this component has no business guessing at the reason itself.
   */
  closed = input(false);
  closedReason = input('This conversation is closed. The messages stay here to read.');

  auth = inject(AuthService);
  private messagesService = inject(MessagesService);

  messages = signal<Message[]>([]);
  loading = signal(true);
  sending = signal(false);
  sendError = signal<string | null>(null);
  draft = '';

  ngOnInit() {
    this.messagesService.getThread(this.applicationId()).subscribe({
      next: (msgs) => { this.messages.set(msgs); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  send() {
    const body = this.draft.trim();
    if (!body) return;
    this.sending.set(true);
    this.sendError.set(null);
    this.messagesService.send(this.applicationId(), body).subscribe({
      next: (msg) => {
        this.messages.update((m) => [...m, msg]);
        this.draft = '';
        this.sending.set(false);
      },
      error: (err) => {
        this.sending.set(false);
        // The draft is deliberately left in the input: clearing it on failure
        // is how somebody loses what they wrote and does not find out.
        this.sendError.set(
          err?.error?.message ?? 'That did not send. Check your connection and try again.',
        );
      },
    });
  }
}
