export type MessageChannel = 'in_app' | 'whatsapp';

export interface Message {
  id: string;
  applicationId: string;
  senderId: string;
  channel: MessageChannel;
  body: string;
  createdAt: string;
}

/**
 * One conversation in the unified inbox — Phase 7c.
 *
 * Messages were reachable only from inside one application, so a landlord with
 * six rooms and eleven applicants had seventeen places to look for "did anybody
 * reply". `GET /messages/inbox` answers that in one list, for both sides: a
 * tenant with four applications had the same problem in miniature, and a
 * sub-lessor has conversations on both sides of it at once.
 */
export interface MessageThreadSummary {
  applicationId: string;
  status: string;
  /** Rejected, withdrawn or relisted. The thread stays readable; sending is refused. */
  closed: boolean;
  room: { id: string; title: string };
  withName: string;
  withAvatarPath?: string | null;
  /** Which side of this conversation the signed-in account is on. */
  iAmLandlord: boolean;
  unread: number;
  messageCount: number;
  lastMessage: {
    body: string;
    channel: MessageChannel;
    createdAt: string;
    fromMe: boolean;
  };
  /**
   * Every channel this conversation has used. More than one is the case the
   * screen warns about: a tenant's message is forwarded to the landlord over
   * WhatsApp, and a reply typed there is threaded back here — so the landlord's
   * last answer may have gone out somewhere other than where they are now
   * typing, and nothing else on the screen would say so.
   */
  channelsUsed: MessageChannel[];
}

export interface MessageInbox {
  data: MessageThreadSummary[];
  total: number;
  unreadThreads: number;
}
