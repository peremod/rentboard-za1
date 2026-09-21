import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { RentService } from './rent.service';

@Module({
  // Rent reminders go out over WhatsApp — the channel tenants in this market
  // actually read.
  imports: [WhatsappModule],
  controllers: [PropertiesController],
  providers: [PropertiesService, RentService],
  exports: [PropertiesService, RentService],
})
export class PropertiesModule {}
