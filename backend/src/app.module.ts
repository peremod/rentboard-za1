import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LastSeenInterceptor } from './common/interceptors/last-seen.interceptor';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './modules/health/health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { VerificationModule } from './modules/verification/verification.module';
import { AdminModule } from './modules/admin/admin.module';
import { UsersModule } from './modules/users/users.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AdsModule } from './modules/ads/ads.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { PlacesModule } from './modules/places/places.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { TenanciesModule } from './modules/tenancies/tenancies.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SeoModule } from './modules/seo/seo.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { MessagesModule } from './modules/messages/messages.module';
// Billing is not wired to a provider. Stripe was removed in v1.54.0: it does
// not operate in South Africa for receiving payments, so a ZA-registered
// business cannot accept money through it. PayFast already handles verification
// payments; subscriptions and boosts would need PayFast recurring billing,
// which is not built. See docs/PAYMENTS.md.
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
    // Required for @Cron in AlertsDigest to run at all.
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    RoomsModule,
    AlertsModule,
    VerificationModule,
    AdminModule,
    UsersModule,
    PaymentsModule,
    AdsModule,
    ReferralsModule,
    PlacesModule,
    AnalyticsModule,
    TenanciesModule,
    ReviewsModule,
    ReportsModule,
    SeoModule,
    NotificationsModule,
    WhatsappModule,
    ApplicationsModule,
    UploadsModule,
    MessagesModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: LastSeenInterceptor }],
})
export class AppModule {}
