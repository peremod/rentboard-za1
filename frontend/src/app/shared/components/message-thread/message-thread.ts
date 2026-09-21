import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { MessagesService } from '../../../core/services/messages.service';
import { Message } from '../../../core/models/message.model';

/**
 * Reusable conversation thread — embedded in both the tenant dashboard
 * (per application) and the landlord applicant manager (per applicant).
 * Tenant→landlord messages also go out over WhatsApp if the landlord has
 * opted in (see backend MessagesService) — that's invisible here, this
 * component only ever renders/sends the in-app (`rentboard`) record.
 */
@Component({
  selector: 'app-message-thread',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="thread">
      <div class="thread__messages">
        @if (loading()) {
          <p class="muted">Loading conversation…</p>
        } @else if (messages().length === 0) {
          <p class="muted">No messages yet — say hello 👋</p>
        } @else {
          @for (m of messages(); track m.id) {
            <div class="thread__message" [class.mine]="m.senderId === auth.user()?.id">
              <p>{{ m.body }}</p>
              @if (m.channel === 'whatsapp') { <span class="thread__channel">via WhatsApp</span> }
            </div>
          }
        }
      </div>
      <div class="thread__composer">
        <input type="text" [(ngModel)]="draft" placeholder="Type a message…" (keyup.enter)="send()"/>
        <button type="button" [disabled]="!draft.trim() || sending()" (click)="send()">Send</button>
      </div>
    </div>
  `,
  styles: [`
    .thread { border: 1px solid #DDD5C8; border-radius: 8px; overflow: hidden; margin-top: .75rem; }
    .thread__messages { max-height: 260px; overflow-y: auto; padding: .75rem; display: flex; flex-direction: column; gap: .5rem; background: #FDFAF5; }
    .muted { font-size: .8rem; color: #7A6E60; }
    .thread__message { align-self: flex-start; background: #F2EDE3; padding: .5rem .7rem; border-radius: 10px; max-width: 80%; font-size: .82rem; }
    .thread__message.mine { align-self: flex-end; background: var(--terra); color: #fff; }
    .thread__channel { display: block; font-size: .6rem; opacity: .7; margin-top: .2rem; }
    .thread__composer { display: flex; border-top: 1px solid #DDD5C8; }
    .thread__composer input { flex: 1; border: none; padding: .6rem .7rem; font-size: .82rem; font-family: inherit; }
    .thread__composer button { border: none; background: #1A1410; color: #fff; padding: 0 1rem; cursor: pointer; font-weight: 700; font-size: .8rem; }
    .thread__composer button:disabled { opacity: .5; cursor: not-allowed; }
  `],
})
export class MessageThread implements OnInit {
  applicationId = input.required<string>();

  auth = inject(AuthService);
  private messagesService = inject(MessagesService);

  messages = signal<Message[]>([]);
  loading = signal(true);
  sending = signal(false);
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
    this.messagesService.send(this.applicationId(), body).subscribe({
      next: (msg) => {
        this.messages.update((m) => [...m, msg]);
        this.draft = '';
        this.sending.set(false);
      },
      error: () => this.sending.set(false),
    });
  }
}
