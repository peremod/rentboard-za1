import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PayfastService } from './payfast.service';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, PayfastService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
