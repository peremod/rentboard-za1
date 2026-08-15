import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './modules/health/health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { SeoModule } from './modules/seo/seo.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { MessagesModule } from './modules/messages/messages.module';
// Billing temporarily disabled (Stripe + Renter's Passport paused) — see
// PRE-LAUNCH-CHECKLIST.md "Temporarily disabled" section. Uncomment this
// import and the registration below, plus StripeController's endpoints in
// the frontend, to re-enable.
// import { StripeModule } from './modules/stripe/stripe.module';

/**
 * Root module — foundation release.
 * Feature modules (Auth, Rooms, Applications, Messages, WhatsApp...)
 * are added incrementally; see README §Roadmap for the build order.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
      cache: true,
    }),
    ThrottlerModule.forRoot([
      { name: 'global', ttl: 15 * 60 * 1000, limit: 150 },
    ]),
    PrismaModule,
    AuthModule,
    RoomsModule,
    SeoModule,
    NotificationsModule,
    WhatsappModule,
    ApplicationsModule,
    UploadsModule,
    MessagesModule,
    // StripeModule, // temporarily disabled — see comment above
  ],
  controllers: [HealthController],
})
export class AppModule {}
