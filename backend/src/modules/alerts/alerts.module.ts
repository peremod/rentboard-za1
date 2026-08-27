import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertsDigest } from './alerts.digest';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertsDigest],
  // RoomsModule calls notifyMatchingTenants when a room goes live.
  exports: [AlertsService],
})
export class AlertsModule {}
