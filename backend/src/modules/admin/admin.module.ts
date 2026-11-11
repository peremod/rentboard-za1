import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AccountModule } from '../account/account.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

/**
 * AccountModule for the one erasure, which the admin close-account route
 * delegates to rather than re-implementing — Phase 7i.
 *
 * WhatsappModule so `getStats()` can report whether phone codes can be sent at
 * all. The admin dashboard offers assisted sign-up, which sends the code over
 * WhatsApp — and with the channel off the screen was promising a message
 * nobody would receive. CLAUDE.md: "Nothing on screen may promise a WhatsApp
 * message while it is off." Read through WhatsappService.isEnabled() rather
 * than a second look at the environment variable, so there is one answer.
 */
@Module({
  imports: [AccountModule, WhatsappModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
