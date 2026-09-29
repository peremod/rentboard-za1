import { Module } from '@nestjs/common';
import { TenanciesController } from './tenancies.controller';
import { TenanciesService } from './tenancies.service';
import { TenancyFlagsService } from './tenancy-flags.service';
import { LeaseService } from './lease.service';
import { LeaseDocumentsService } from './lease-documents.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  // StorageModule because removing a lease document must delete the file, not
  // just the row pointing at it.
  imports: [StorageModule],
  controllers: [TenanciesController],
  providers: [TenanciesService, TenancyFlagsService, LeaseService, LeaseDocumentsService],
  // ApplicationsModule opens a tenancy when an application is accepted.
  exports: [TenanciesService, TenancyFlagsService, LeaseService],
})
export class TenanciesModule {}
