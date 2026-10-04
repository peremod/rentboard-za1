import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesInboxController } from './messages-inbox.controller';
import { MessagesService } from './messages.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [WhatsappModule, NotificationsModule],
  controllers: [MessagesController, MessagesInboxController],
  providers: [MessagesService],
})
export class MessagesModule {}
