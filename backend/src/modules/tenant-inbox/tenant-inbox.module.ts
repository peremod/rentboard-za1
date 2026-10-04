import { Module } from '@nestjs/common';
import { TenantInboxController } from './tenant-inbox.controller';
import { TenantInboxService } from './tenant-inbox.service';

/**
 * The tenant side of the task inbox — Phase 7d.
 *
 * Its own module rather than a second service inside LandlordInboxModule: that
 * one pulls in TenanciesModule for LeaseService and is named for the role it
 * serves. Nothing here needs those providers.
 */
@Module({
  controllers: [TenantInboxController],
  providers: [TenantInboxService],
})
export class TenantInboxModule {}
