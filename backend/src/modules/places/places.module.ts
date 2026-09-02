import { Module } from '@nestjs/common';
import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';

@Module({
  controllers: [PlacesController],
  providers: [PlacesService],
  // Ads use it to widen a suburb to its city when matching.
  exports: [PlacesService],
})
export class PlacesModule {}
