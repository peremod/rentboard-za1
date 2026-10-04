import { Module } from '@nestjs/common';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { ContractorLeadsService } from './contractor-leads.service';

@Module({
  controllers: [ServicesController],
  providers: [ServicesService, ContractorLeadsService],
  exports: [ServicesService],
})
export class ServicesModule {}
