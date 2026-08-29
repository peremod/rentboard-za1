import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmitVerificationDto } from './dto/submit-verification.dto';
import { ReviewVerificationDto } from './dto/review-verification.dto';

/**
 * Landlord verification.
 *
 * POPIA note, which shapes the whole design: an ID number and ID document are
 * "special personal information" under s.26, so this service
 *   - never returns documentPath to anyone but the submitter and an admin,
 *   - clears documentPath once a decision is made, keeping only the outcome,
 *   - records who reviewed and when, so a decision is auditable without
 *     retaining the document itself.
 *
 * Verification here means "a human checked a document", not a credit or
 * criminal check. The disclaimer must keep saying listings are not vetted.
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(private prisma: PrismaService) {}

  /** The landlord's own requests. Document paths are withheld once decided. */
  async listMine(userId: string) {
    const requests = await this.prisma.verificationRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map(({ documentPath, ...rest }) => ({
      ...rest,
      hasDocument: documentPath !== null,
    }));
  }

  async submit(dto: SubmitVerificationDto, userId: string) {
    const existing = await this.prisma.verificationRequest.findFirst({
      where: { userId, type: dto.type, status: { in: ['pending', 'pending_payment'] } },
    });
    if (existing) {
      throw new BadRequestException(
        'You already have a document of this type awaiting review. We will email you once it has been checked.',
      );
    }

    const request = await this.prisma.verificationRequest.create({
      data: {
        userId,
        type: dto.type,
        documentPath: dto.documentPath,
        // Identity checks carry the fee and wait for payment before review.
        // The other document types are free and go straight to the queue.
        status: dto.type === 'identity' ? 'pending_payment' : 'pending',
      },
    });

    this.logger.log(`Verification submitted: ${dto.type} by user ${userId}`);
    const { documentPath, ...safe } = request;
    return { ...safe, hasDocument: true };
  }

  /** Admin queue. Includes documentPath — reviewers must see the document. */
  listPending() {
    return this.prisma.verificationRequest.findMany({
      // pending_payment is deliberately excluded: reviewing before payment
      // means chasing money from someone you have just told no.
      where: { status: 'pending' },
      include: { user: { select: { id: true, fullName: true, email: true, createdAt: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Approving identity sets LandlordProfile.idVerified, which is what the
   * "verified" badge on a room card reflects. Nothing else sets that flag.
   */
  async review(id: string, dto: ReviewVerificationDto, reviewerId: string) {
    const request = await this.prisma.verificationRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Verification request not found');
    if (request.status !== 'pending') {
      throw new BadRequestException('This request has already been reviewed');
    }
    if (dto.status === 'rejected' && !dto.reviewNote) {
      throw new BadRequestException('A reason is required when rejecting, so the landlord knows what to fix');
    }

    const updated = await this.prisma.verificationRequest.update({
      where: { id },
      data: {
        status: dto.status,
        reviewNote: dto.reviewNote,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        // The document has served its purpose. Keep the outcome, not the ID.
        documentPath: null,
        documentDeletedAt: new Date(),
      },
    });

    if (dto.status === 'approved' && request.type === 'identity') {
      await this.prisma.landlordProfile.updateMany({
        where: { userId: request.userId },
        data: { idVerified: true },
      });
    }

    this.logger.log(`Verification ${dto.status}: ${id} by admin ${reviewerId}`);
    return updated;
  }
}
