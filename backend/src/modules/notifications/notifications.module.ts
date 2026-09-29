import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NoticeRouter } from './notice-router.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

/**
 * WhatsappModule because NoticeRouter attempts a WhatsApp send as a best-effort
 * improvement on the in-app notice — see its header for why it is only ever an
 * improvement and never the fallback itself.
 */
@Module({
  imports: [WhatsappModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NoticeRouter],
  exports: [NotificationsService, NoticeRouter],
})
export class NotificationsModule {}
