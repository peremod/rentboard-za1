import { Module } from '@nestjs/common';
import { LandlordNotesController } from './landlord-notes.controller';
import { LandlordNotesService } from './landlord-notes.service';

@Module({
  controllers: [LandlordNotesController],
  providers: [LandlordNotesService],
})
export class LandlordNotesModule {}
