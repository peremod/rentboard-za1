import { Module } from '@nestjs/common';
import { TenanciesController } from './tenancies.controller';
import { TenanciesService } from './tenancies.service';

@Module({
  controllers: [TenanciesController],
  providers: [TenanciesService],
  // ApplicationsModule opens a tenancy when an application is accepted.
  exports: [TenanciesService],
})
export class TenanciesModule {}
