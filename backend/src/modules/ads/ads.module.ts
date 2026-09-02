import { Module } from '@nestjs/common';
import { AdsController } from './ads.controller';
import { AdsService } from './ads.service';
import { AdsReporting } from './ads.reporting';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [AdsController],
  providers: [AdsService, AdsReporting],
})
export class AdsModule {}
