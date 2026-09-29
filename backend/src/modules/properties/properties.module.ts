import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { RoomsModule } from '../rooms/rooms.module';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { RentService } from './rent.service';
import { ExpensesService } from './expenses.service';

@Module({
  // Rent reminders go out over WhatsApp — the channel tenants in this market
  // actually read.
  // RoomsModule for the relist rule, which bulk relist calls rather than
  // reimplementing — see PropertiesService.relistAll.
  imports: [WhatsappModule, RoomsModule],
  controllers: [PropertiesController],
  providers: [PropertiesService, RentService, ExpensesService],
  exports: [PropertiesService, RentService, ExpensesService],
})
export class PropertiesModule {}
