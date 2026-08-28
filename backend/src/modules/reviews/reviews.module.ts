import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { ReviewsRelease } from './reviews.release';

@Module({
  controllers: [ReviewsController],
  providers: [ReviewsService, ReviewsRelease],
  exports: [ReviewsService],
})
export class ReviewsModule {}
