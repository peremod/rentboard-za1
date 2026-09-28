import { Module } from '@nestjs/common';
import { SurveysController } from './surveys.controller';
import { SurveysService } from './surveys.service';

@Module({
  controllers: [SurveysController],
  providers: [SurveysService],
  // Exported so the WhatsApp bot can record an answer through the same path
  // the portal uses, rather than writing its own.
  exports: [SurveysService],
})
export class SurveysModule {}
