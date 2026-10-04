import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { ViewingsService } from './viewings.service';
import { TenanciesModule } from '../tenancies/tenancies.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [TenanciesModule, ReferralsModule, NotificationsModule, WhatsappModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService, ViewingsService],
})
export class ApplicationsModule {}
