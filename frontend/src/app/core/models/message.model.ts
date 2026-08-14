export type MessageChannel = 'rentboard' | 'whatsapp';

export interface Message {
  id: string;
  applicationId: string;
  senderId: string;
  channel: MessageChannel;
  body: string;
  createdAt: string;
}
