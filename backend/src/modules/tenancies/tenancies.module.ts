import { Module } from '@nestjs/common';
import { TenanciesController } from './tenancies.controller';
import { TenanciesService } from './tenancies.service';
import { TenancyFlagsService } from './tenancy-flags.service';

@Module({
  controllers: [TenanciesController],
  providers: [TenanciesService, TenancyFlagsService],
  // ApplicationsModule opens a tenancy when an application is accepted.
  exports: [TenanciesService, TenancyFlagsService],
})
export class TenanciesModule {}
