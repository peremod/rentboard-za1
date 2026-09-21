import { Module, OnModuleInit } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { ListingBotService } from './listing-bot.service';

@Module({
  controllers: [WhatsappController],
  providers: [WhatsappService, ListingBotService],
  exports: [WhatsappService, ListingBotService],
})
export class WhatsappModule implements OnModuleInit {
  constructor(
    private whatsapp: WhatsappService,
    private listingBot: ListingBotService,
  ) {}

  /**
   * The webhook hands unthreaded messages to the listing bot, and the bot
   * does not depend on the webhook. Wiring it here rather than injecting both
   * ways avoids a circular dependency that would otherwise need forwardRef.
   */
  onModuleInit() {
    this.whatsapp.setListingBot(this.listingBot);
  }
}
