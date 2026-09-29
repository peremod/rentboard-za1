import { Module } from '@nestjs/common';
import { LandlordInboxController } from './landlord-inbox.controller';
import { LandlordInboxService } from './landlord-inbox.service';
import { TenanciesModule } from '../tenancies/tenancies.module';

/**
 * TenanciesModule for LeaseService: the inbox reuses its "what is ending" rule
 * rather than re-deriving it. Two implementations of the same window would
 * eventually disagree, and the landlord would trust whichever they saw first.
 */
@Module({
  imports: [TenanciesModule],
  controllers: [LandlordInboxController],
  providers: [LandlordInboxService],
})
export class LandlordInboxModule {}
