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
import { PropertiesModule } from './modules/properties/properties.module';
import { ServicesModule } from './modules/services/services.module';
import { SurveysModule } from './modules/surveys/surveys.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { TenanciesModule } from './modules/tenancies/tenancies.module';
import { StorageModule } from './modules/storage/storage.module';
import { LandlordInboxModule } from './modules/landlord-inbox/landlord-inbox.module';
import { TenantInboxModule } from './modules/tenant-inbox/tenant-inbox.module';
import { StorefrontModule } from './modules/storefront/storefront.module';
import { LandlordNotesModule } from './modules/landlord-notes/landlord-notes.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SeoModule } from './modules/seo/seo.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { MessagesModule } from './modules/messages/messages.module';
// No StripeModule. Stripe was dropped in v1.54.0 — it does not operate in
// South Africa for receiving payments, so a ZA-registered business cannot
// take money through it — but only the import was removed then. The module,
// its service and a POST /stripe/webhook controller stayed in the tree for
// four months, unmounted: no route served them and no code called them, while
// the webhook still appeared in the generated list of endpoints reachable
// without a token. Deleted now.
//
// PayFast handles the one charge that exists, the R149 verification fee.
// Subscriptions and boosts would need PayFast recurring billing, which is not
// built and is not currently planned. See docs/PAYMENTS.md.
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
    /**
     * Rate limiting.
     *
     * ⚠️ Two things were wrong here for every release up to v1.85.1, and the
     * second one hid the first:
     *
     *   1. The throttler was named 'global', while all nineteen `@Throttle`
     *      decorators in the codebase key on 'default'. A key that matches no
     *      configured throttler is ignored, so every per-route limit resolved
     *      back to this bucket.
     *   2. ThrottlerGuard was never registered — not here as an APP_GUARD, not
     *      on a controller. So nothing was limited at all: not this bucket, not
     *      the decorators, and not /auth/login, which had no decorator either.
     *
     * Both were found by probing the route rather than reading the decorator:
     * eight requests in a row to a route marked `limit: 5` all returned 200.
     * Comments elsewhere in this codebase asserted that "the per-route
     * @Throttle is what actually limits code guessing" — it was not; it was
     * nothing. The per-account caps in PhoneOtpService were doing all of the
     * work on their own.
     *
     * ── Why this bucket is a backstop and not a security control
     *
     * It is per IP, and in this market per IP means almost nothing:
     *
     *   • Mobile carriers here put very large numbers of subscribers behind
     *     carrier-grade NAT, so one address can be a township's worth of
     *     people. A limit tight enough to stop an attacker locks out a
     *     neighbourhood.
     *   • The SSR server calls this API for every server-rendered page, from
     *     one address, for all visitors at once. A tight per-IP limit here
     *     throttles the whole site under load, which is why the guard is applied
     *     per controller (below) rather than globally.
     *
     * So this number is set to stop a single runaway client, and the real
     * controls are the per-route decorators on sensitive actions plus the
     * per-account and per-number caps in the services.
     *
     * ⚠️ Storage is in-memory, so each instance keeps its own counts: two
     * instances behind a load balancer means roughly double every limit here.
     * Fine for a backstop; it is noted in docs/OUTSTANDING.md because it is NOT
     * fine as the only defence.
     */
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 15 * 60 * 1000, limit: 1000 },
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
    PropertiesModule,
    ServicesModule,
    SurveysModule,
    AnalyticsModule,
    TenanciesModule,
    // Listed here as well as being imported by the modules that use it, so the
    // hourly deletion drain keeps running even if both of those importers
    // change. A file we promised to delete should not stop being deleted
    // because of an unrelated refactor.
    StorageModule,
    LandlordInboxModule,
    TenantInboxModule,
    StorefrontModule,
    LandlordNotesModule,
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
