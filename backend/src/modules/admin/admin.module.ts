import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AccountModule } from '../account/account.module';

/**
 * AccountModule for the one erasure, which the admin close-account route
 * delegates to rather than re-implementing — Phase 7i.
 */
@Module({
  imports: [AccountModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
