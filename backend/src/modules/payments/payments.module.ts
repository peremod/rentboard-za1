import { Module } from '@nestjs/common';
import { VerificationModule } from '../verification/verification.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PayfastService } from './payfast.service';

@Module({
  // For the audit trail. A fee that moves a check into the review queue
  // without appearing on that check's own history leaves a gap exactly where
  // someone would look to ask why a badge was granted. One-directional:
  // VerificationModule does not import this one back, and the shared fee
  // figure lives in payments.constants.ts so it does not have to.
  imports: [VerificationModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PayfastService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
