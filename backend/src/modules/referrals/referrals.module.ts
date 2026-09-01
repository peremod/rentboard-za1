import { Module } from '@nestjs/common';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

@Module({
  controllers: [ReferralsController],
  providers: [ReferralsService],
  // Auth records signups; rooms and applications trigger qualification.
  exports: [ReferralsService],
})
export class ReferralsModule {}
