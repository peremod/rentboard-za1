import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountLifecycleService } from './account-lifecycle.service';
import { StorageModule } from '../storage/storage.module';

/**
 * StorageModule for the deletion queue: an avatar is a face, and this is the
 * one request where recording the intent and marking it done only from the
 * provider's own response is the whole point.
 */
@Module({
  imports: [StorageModule],
  controllers: [AccountController],
  providers: [AccountLifecycleService],
  /**
   * Exported for AdminModule — Phase 7i.
   *
   * An admin can end an account on its owner's request (a phone-only account
   * has no password for /account/close to confirm with), and that path uses
   * THIS service rather than a second erasure of its own. Two erasures that
   * start identical drift, and the one that drifts is the one nobody drives.
   */
  exports: [AccountLifecycleService],
})
export class AccountModule {}
