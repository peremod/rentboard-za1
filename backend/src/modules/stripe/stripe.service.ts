import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const BOOST_DURATION_DAYS = 7;

/**
 * All Stripe integration: landlord plan subscriptions (Pro/Agency), Renter's
 * Passport subscriptions, and one-off room boosts. Every checkout is created
 * server-side (never a raw price shown to the client) and every state
 * change — upgrade, downgrade, cancellation, boost activation — happens
 * ONLY inside the webhook handler, never optimistically on the checkout-
 * creation response. This is deliberate: the webhook is the only source
 * Stripe itself guarantees is authoritative.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe;
  private readonly frontendUrl: string;
  private readonly webhookSecret?: string;

  constructor(private config: ConfigService, private prisma: PrismaService, private notifications: NotificationsService) {
    const secretKey = this.config.get<string>('stripe.secretKey');
    if (!secretKey) {
      this.logger.warn('STRIPE_SECRET_KEY not set — Stripe endpoints will fail until configured (see .env.example)');
    }
    this.stripe = new Stripe(secretKey ?? 'sk_test_placeholder', { apiVersion: '2024-12-18.acacia' });
    this.frontendUrl = this.config.get<string>('frontendUrl')!;
    this.webhookSecret = this.config.get<string>('stripe.webhookSecret');
  }

  // ── Checkout session creation ──

  async createPlanCheckout(landlordId: string, planTier: 'pro' | 'agency', interval: 'monthly' | 'annual') {
    const profile = await this.prisma.landlordProfile.findUniqueOrThrow({ where: { userId: landlordId }, include: { user: true } });
    const priceId = this.resolvePlanPriceId(planTier, interval);

    const customerId = await this.ensureCustomer(profile.stripeCustomerId, profile.user.email, landlordId, 'LandlordProfile');
    if (customerId !== profile.stripeCustomerId) {
      await this.prisma.landlordProfile.update({ where: { id: profile.id }, data: { stripeCustomerId: customerId } });
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${this.frontendUrl}/landlord/dashboard?upgraded=1`,
      cancel_url: `${this.frontendUrl}/landlord/dashboard`,
      metadata: { type: 'plan_subscription', landlordProfileId: profile.id, planTier },
    });
    return { url: session.url };
  }

  async createPassportCheckout(tenantId: string, interval: 'monthly' | 'annual') {
    const tenant = await this.prisma.user.findUniqueOrThrow({ where: { id: tenantId } });
    const priceId = interval === 'monthly'
      ? this.config.get<string>('stripe.prices.passportMonthly')
      : this.config.get<string>('stripe.prices.passportAnnual');
    if (!priceId) throw new BadRequestException('Renter\'s Passport pricing is not configured yet');

    const existing = await this.prisma.rentersPassport.findUnique({ where: { tenantId } });
    const customerId = await this.ensureCustomer(existing?.stripeCustomerId ?? null, tenant.email, tenantId, 'RentersPassport');

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${this.frontendUrl}/tenant/dashboard?passport=1`,
      cancel_url: `${this.frontendUrl}/tenant/dashboard`,
      metadata: { type: 'passport_subscription', tenantId },
    });
    return { url: session.url };
  }

  async createBoostCheckout(roomId: string, landlordId: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('Room not found');
    if (room.landlordId !== landlordId) throw new ForbiddenException('You do not own this room');

    const priceId = this.config.get<string>('stripe.prices.roomBoost');
    if (!priceId) throw new BadRequestException('Room boost pricing is not configured yet');

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${this.frontendUrl}/landlord/dashboard?boosted=1`,
      cancel_url: `${this.frontendUrl}/landlord/dashboard`,
      metadata: { type: 'room_boost', roomId },
    });

    const price = await this.stripe.prices.retrieve(priceId);
    await this.prisma.roomBoost.create({
      data: {
        roomId,
        stripeSessionId: session.id,
        amountCents: price.unit_amount ?? 0,
        durationDays: BOOST_DURATION_DAYS,
        status: 'pending',
      },
    });
    return { url: session.url };
  }

  // ── Webhook ──

  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    if (!this.webhookSecret) throw new BadRequestException('Webhook secret not configured');
    return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }

  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.onSubscriptionChanged(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_failed':
        await this.onPaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        this.logger.log(`Unhandled Stripe event type: ${event.type}`);
    }
  }

  private async onCheckoutCompleted(session: Stripe.Checkout.Session) {
    const type = session.metadata?.['type'];

    if (type === 'plan_subscription') {
      const { landlordProfileId, planTier } = session.metadata as any;
      await this.prisma.landlordProfile.update({
        where: { id: landlordProfileId },
        data: { planTier, stripeSubscriptionId: session.subscription as string },
      });
      this.logger.log(`Landlord ${landlordProfileId} upgraded to ${planTier}`);
    }

    if (type === 'passport_subscription') {
      const { tenantId } = session.metadata as any;
      await this.prisma.rentersPassport.upsert({
        where: { tenantId },
        create: {
          tenantId,
          status: 'active',
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: session.subscription as string,
          purchasedAt: new Date(),
        },
        update: {
          status: 'active',
          stripeSubscriptionId: session.subscription as string,
          purchasedAt: new Date(),
        },
      });
    }

    if (type === 'room_boost') {
      const boost = await this.prisma.roomBoost.findUnique({ where: { stripeSessionId: session.id } });
      if (!boost || boost.status === 'active') return; // idempotent — webhook can retry/duplicate-deliver

      const boostedFrom = new Date();
      const boostedUntil = new Date(boostedFrom.getTime() + boost.durationDays * 24 * 60 * 60 * 1000);

      await this.prisma.$transaction([
        this.prisma.roomBoost.update({ where: { id: boost.id }, data: { status: 'active', boostedFrom, boostedUntil } }),
        this.prisma.room.update({ where: { id: boost.roomId }, data: { isFeatured: true, featuredUntil: boostedUntil } }),
      ]);
      this.logger.log(`Room ${boost.roomId} boosted until ${boostedUntil.toISOString()}`);
    }
  }

  private async onSubscriptionChanged(subscription: Stripe.Subscription) {
    if (subscription.status === 'active') return; // handled by checkout.session.completed on first activation

    // Subscription cancelled/past_due/etc — downgrade whichever entity owns it.
    const landlord = await this.prisma.landlordProfile.findUnique({ where: { stripeSubscriptionId: subscription.id } });
    if (landlord) {
      await this.prisma.landlordProfile.update({ where: { id: landlord.id }, data: { planTier: 'free' } });
      return;
    }
    const passport = await this.prisma.rentersPassport.findFirst({ where: { stripeSubscriptionId: subscription.id } });
    if (passport) {
      await this.prisma.rentersPassport.update({ where: { id: passport.id }, data: { status: 'cancelled' } });
    }
  }

  private async onPaymentFailed(invoice: Stripe.Invoice) {
    const customerId = invoice.customer as string;
    const landlord = await this.prisma.landlordProfile.findFirst({ where: { stripeCustomerId: customerId }, include: { user: true } });
    if (landlord) {
      this.logger.warn(`Payment failed for landlord ${landlord.id} — plan remains active until Stripe's dunning retries are exhausted`);
      // Intentionally not downgrading immediately — Stripe's own retry
      // schedule handles this; we only downgrade on the final
      // customer.subscription.deleted/updated(status!=active) event.
    }
  }

  private async ensureCustomer(existingId: string | null, email: string, ownerId: string, ownerType: string): Promise<string> {
    if (existingId) return existingId;
    const customer = await this.stripe.customers.create({ email, metadata: { ownerId, ownerType } });
    return customer.id;
  }

  private resolvePlanPriceId(planTier: 'pro' | 'agency', interval: 'monthly' | 'annual'): string {
    const key = `stripe.prices.${planTier}${interval === 'monthly' ? 'Monthly' : 'Annual'}`;
    const priceId = this.config.get<string>(key);
    if (!priceId) throw new BadRequestException(`Pricing for ${planTier}/${interval} is not configured yet`);
    return priceId;
  }
}
