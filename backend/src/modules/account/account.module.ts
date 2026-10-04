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
})
export class AccountModule {}
