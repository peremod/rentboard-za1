import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { StorageModule } from '../storage/storage.module';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { ReferencesController } from './references.controller';
import { ReferencesService } from './references.service';

@Module({
  // WhatsApp delivers the reference request to a previous landlord, who has
  // no account and no other way to be reached.
  // StorageModule because deciding a request must actually delete the document
  // it was about, not merely stop pointing at it.
  imports: [WhatsappModule, StorageModule],
  controllers: [VerificationController, ReferencesController],
  providers: [VerificationService, ReferencesService],
  exports: [VerificationService],
})
export class VerificationModule {}
