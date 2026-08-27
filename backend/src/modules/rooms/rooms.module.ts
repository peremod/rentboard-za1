import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  // Marking a room let closes every open application, and those tenants are
  // emailed to tell them why — so this module needs the notifications service.
  imports: [NotificationsModule, AlertsModule],
  controllers: [RoomsController],
  providers: [RoomsService],
})
export class RoomsModule {}
