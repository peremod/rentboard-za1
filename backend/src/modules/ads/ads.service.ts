import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { rateCard, suggestedRateCents, targetLevel, MINIMUM_MONTHLY_CENTS } from './ad-rates';
import {
  CreateCampaignDto, ReviewCampaignDto, CreateAdvertiserDto,
  CreateAdEnquiryDto, UpdateEnquiryDto,
} from './dto/ads.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  /**
   * Ads for the page being viewed.
   *
   * Matching is on the CONTEXT — which province and room type the visitor is
   * looking at — not on the visitor. Nothing about who they are is read, and
   * the response carries no identifiers, so an advertiser learns only that
   * their ad was shown on Gauteng searches.
   *
   * More specific campaigns win: a Sandton advertiser should outrank a
   * national one on a Sandton page, having paid for that precision.
   */
  async getForContext(params: {
    placement: string;
    province?: string;
    city?: string;
    /// Suburb slug, when the page context is that precise.
    suburbSlug?: string;
    roomType?: string;
    limit?: number;
  }) {
    const now = new Date();

    const campaigns = await this.prisma.adCampaign.findMany({
      where: {
        status: 'active',
        placement: params.placement as any,
        startsAt: { lte: now },
        endsAt: { gte: now },
        AND: [
          { OR: [{ province: null }, ...(params.province ? [{ province: params.province }] : [])] },
          { OR: [{ city: null }, ...(params.city ? [{ city: { equals: params.city, mode: 'insensitive' as const } }] : [])] },
          // A suburb-targeted campaign must not appear outside that suburb —
          // it is the narrowest thing an advertiser can buy and the reason the
          // place taxonomy exists.
          { OR: [{ suburbSlug: null }, ...(params.suburbSlug ? [{ suburbSlug: params.suburbSlug }] : [])] },
          { OR: [{ roomType: null }, ...(params.roomType ? [{ roomType: params.roomType as any }] : [])] },
        ],
      },
      select: {
        id: true, headline: true, body: true, imagePath: true,
        ctaLabel: true, targetUrl: true, placement: true,
        province: true, city: true, suburbSlug: true, roomType: true,
        advertiser: { select: { companyName: true } },
      },
      take: 20,
    });

    // Specificity score, then rotate so one campaign does not monopolise a slot.
    const scored = campaigns
      .map((c) => ({
        campaign: c,
        // Suburb outranks city outranks province: whoever paid for the
        // narrowest targeting gets the slot.
        specificity:
          (c.suburbSlug ? 8 : 0) + (c.city ? 4 : 0) + (c.province ? 2 : 0) + (c.roomType ? 1 : 0),
      }))
      .sort((a, b) => b.specificity - a.specificity);

    // Shuffle within each specificity band rather than picking one and
    // discarding the rest: asking for three equally specific campaigns should
    // return three in a random order, not one. The old version dropped the
    // others entirely, so repeated slots on a page all got the same ad.
    const bands = new Map<number, typeof scored>();
    for (const entry of scored) {
      const band = bands.get(entry.specificity) ?? [];
      band.push(entry);
      bands.set(entry.specificity, band);
    }

    const chosen = [...bands.keys()]
      .sort((a, b) => b - a)
      .flatMap((specificity) => {
        const band = [...bands.get(specificity)!];
        // Fisher-Yates, so no advertiser is permanently first in its band.
        for (let i = band.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [band[i], band[j]] = [band[j], band[i]];
        }
        return band;
      });

    return chosen.slice(0, params.limit ?? 1).map(({ campaign }) => ({
      id: campaign.id,
      headline: campaign.headline,
      body: campaign.body,
      imagePath: campaign.imagePath,
      ctaLabel: campaign.ctaLabel,
      advertiser: campaign.advertiser.companyName,
      // Clicks route through us so they can be counted without a tracker on
      // the page; the destination is not exposed until the click happens.
      clickUrl: `/api/ads/${campaign.id}/click`,
    }));
  }

  /** Fire-and-forget counter. No user, no session, no timestamp per view. */
  async recordImpressions(campaignIds: string[]) {
    if (campaignIds.length === 0) return;
    await this.prisma.adCampaign
      .updateMany({ where: { id: { in: campaignIds } }, data: { impressions: { increment: 1 } } })
      .catch(() => {});
  }

  /** Returns the destination so the controller can redirect. */
  async recordClick(campaignId: string): Promise<string | null> {
    const campaign = await this.prisma.adCampaign.findUnique({
      where: { id: campaignId },
      select: { targetUrl: true, status: true },
    });
    if (!campaign || campaign.status !== 'active') return null;

    await this.prisma.adCampaign
      .update({ where: { id: campaignId }, data: { clicks: { increment: 1 } } })
      .catch(() => {});

    return campaign.targetUrl;
  }

  /**
   * Record an enquiry and alert an admin.
   *
   * Deliberately does not auto-create an advertiser or campaign: placement is
   * sold after a conversation and an invoice, and an unreviewed creative going
   * live on a rental platform is exactly the risk the review step exists for.
   */
  async createEnquiry(dto: CreateAdEnquiryDto) {
    const enquiry = await this.prisma.adEnquiry.create({ data: dto });

    this.logger.log(`Advertising enquiry from ${dto.companyName} (${dto.contactEmail})`);

    // Best-effort: a failed alert must not lose the enquiry, which is already
    // saved by this point.
    this.notifications
      .sendAdEnquiryAlert({
        companyName: dto.companyName,
        contactName: dto.contactName,
        contactEmail: dto.contactEmail,
        industry: dto.industry,
        province: dto.province,
        message: dto.message,
      })
      .catch(() => {});

    return {
      id: enquiry.id,
      message: "Thanks — we've got it. We usually reply within two business days.",
    };
  }

  listEnquiries(status?: string) {
    return this.prisma.adEnquiry.findMany({
      where: status ? { status: status as any } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async updateEnquiry(id: string, dto: UpdateEnquiryDto) {
    const enquiry = await this.prisma.adEnquiry.findUnique({ where: { id } });
    if (!enquiry) throw new NotFoundException('Enquiry not found');
    return this.prisma.adEnquiry.update({ where: { id }, data: dto });
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  createAdvertiser(dto: CreateAdvertiserDto) {
    return this.prisma.advertiser.create({ data: dto });
  }

  listAdvertisers() {
    return this.prisma.advertiser.findMany({
      include: { _count: { select: { campaigns: true } } },
      orderBy: { companyName: 'asc' },
    });
  }

  /** The rate card, for the Advertise page and the admin form. */
  getRateCard() {
    return { placements: rateCard(), minimumMonthlyCents: MINIMUM_MONTHLY_CENTS };
  }

  async createCampaign(dto: CreateCampaignDto) {
    const advertiser = await this.prisma.advertiser.findUnique({ where: { id: dto.advertiserId } });
    if (!advertiser) throw new NotFoundException('Advertiser not found');

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) throw new BadRequestException('The end date must be after the start date.');

    // A rate well under the card for that reach is usually a mistake rather
    // than a discount, so it is worth surfacing before the campaign runs.
    const suggested = suggestedRateCents(dto.placement, dto);
    if (dto.monthlyRateCents < suggested * 0.5) {
      this.logger.warn(
        `Campaign priced at ${dto.monthlyRateCents} against a suggested ${suggested} ` +
        `for ${targetLevel(dto)} ${dto.placement}`,
      );
    }

    return this.prisma.adCampaign.create({
      data: { ...dto, startsAt, endsAt, status: 'pending_review' },
    });
  }

  listCampaigns(status?: string) {
    return this.prisma.adCampaign.findMany({
      where: status ? { status: status as any } : {},
      include: { advertiser: { select: { companyName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Approve or reject a creative before it runs.
   *
   * Not a formality: a scam ad on a rental platform, seen by people about to
   * pay deposits to strangers, does far more damage than the placement earns.
   */
  async reviewCampaign(id: string, dto: ReviewCampaignDto, adminId: string) {
    const campaign = await this.prisma.adCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (dto.status === 'rejected' && !dto.rejectionReason) {
      throw new BadRequestException('A reason is required when rejecting a campaign.');
    }

    const updated = await this.prisma.adCampaign.update({
      where: { id },
      data: {
        status: dto.status === 'approved' ? 'active' : 'rejected',
        approvedById: adminId,
        approvedAt: new Date(),
        rejectionReason: dto.rejectionReason,
      },
    });

    this.logger.log(`Campaign ${id} ${dto.status} by admin ${adminId}`);
    return updated;
  }

  async setStatus(id: string, status: 'active' | 'paused' | 'ended') {
    return this.prisma.adCampaign.update({ where: { id }, data: { status } });
  }

  /** What an advertiser is shown: their own aggregates, nothing about viewers. */
  async getCampaignStats(id: string) {
    const c = await this.prisma.adCampaign.findUnique({
      where: { id },
      select: {
        id: true, name: true, impressions: true, clicks: true,
        startsAt: true, endsAt: true, monthlyRateCents: true, status: true,
        advertiser: { select: { companyName: true } },
      },
    });
    if (!c) throw new NotFoundException('Campaign not found');

    return {
      ...c,
      clickThroughRate: c.impressions > 0 ? +((c.clicks / c.impressions) * 100).toFixed(2) : 0,
    };
  }
}
