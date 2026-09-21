import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { ReferencesController } from './references.controller';
import { ReferencesService } from './references.service';

@Module({
  // WhatsApp delivers the reference request to a previous landlord, who has
  // no account and no other way to be reached.
  imports: [WhatsappModule],
  controllers: [VerificationController, ReferencesController],
  providers: [VerificationService, ReferencesService],
  exports: [VerificationService],
})
export class VerificationModule {}
