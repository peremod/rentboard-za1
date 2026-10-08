import { Module } from '@nestjs/common';
import { TenanciesController } from './tenancies.controller';
import { TenanciesService } from './tenancies.service';
import { TenancyFlagsService } from './tenancy-flags.service';
import { LeaseService } from './lease.service';
import { LeaseDocumentsService } from './lease-documents.service';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  // StorageModule because removing a lease document must delete the file, not
  // just the row pointing at it. NotificationsModule because ending a tenancy
  // has to tell both parties — 32 notice kinds existed and not one of them was
  // for a letting starting or ending.
  imports: [StorageModule, NotificationsModule],
  controllers: [TenanciesController],
  providers: [TenanciesService, TenancyFlagsService, LeaseService, LeaseDocumentsService],
  // ApplicationsModule opens a tenancy when an application is accepted.
  exports: [TenanciesService, TenancyFlagsService, LeaseService],
})
export class TenanciesModule {}
