import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma, UserRole, VerificationType, VerificationActor } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmitVerificationDto } from './dto/submit-verification.dto';
import { ReviewVerificationDto } from './dto/review-verification.dto';
import { VERIFICATION_RULES, typesFor, requiresPayment, maySubmit } from './verification.rules';

/** A Tenant Passport lasts a year before the proofs need refreshing. */
const PASSPORT_VALID_MONTHS = 12;

/**
 * Verification, both sides of the market.
 *
 * POPIA shapes the whole design. An ID document is special personal
 * information under s.26, so this service
 *   - never returns documentPath to anyone but the submitter and an admin,
 *   - clears documentPath once a decision is made, keeping only the outcome,
 *   - records every step in VerificationEvent, so a decision is auditable
 *     without retaining the document itself.
 *
 * That last point is the change in v1.56.0. `idVerified = true` is not
 * evidence; a badge that cannot show what was checked is a claim, not a
 * verification. The trail deliberately outlives the document: it records THAT
 * a SASSA letter was checked and the name matched, never what the letter said.
 *
 * Verification here still means "a person checked a document", not a credit or
 * criminal check, and the disclaimer must keep saying listings are not vetted.
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(private prisma: PrismaService) {}

  /** The types this person may submit, with the guidance shown beside each. */
  availableTypes(role: UserRole) {
    return typesFor(role).map((type) => ({
      type,
      ...VERIFICATION_RULES[type],
      requiresPayment: requiresPayment(type, role),
    }));
  }

  /**
   * Appends to the audit trail.
   *
   * Takes a transaction client so a step can never be recorded for a change
   * that rolled back, nor a change land without its step.
   */
  private recordEvent(
    tx: Prisma.TransactionClient,
    requestId: string,
    actor: VerificationActor,
    step: string,
    detail?: string,
    actorId?: string,
  ) {
    return tx.verificationEvent.create({
      data: { requestId, actor, actorId, step, detail },
    });
  }

  /** The subject's own requests, with their history. Documents are withheld. */
  async listMine(userId: string) {
    const requests = await this.prisma.verificationRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        reference: {
          // The referee's phone number is the tenant's own submission, so they
          // may see it. The response token hash never leaves the server.
          select: {
            refereeName: true, refereePhone: true, status: true,
            rating: true, comment: true, contactedAt: true, respondedAt: true,
          },
        },
      },
    });
    return requests.map(({ documentPath, ...rest }) => ({
      ...rest,
      hasDocument: documentPath !== null,
      label: VERIFICATION_RULES[rest.type].label,
    }));
  }

  async submit(dto: SubmitVerificationDto, user: { id: string; role: UserRole }) {
    const rule = VERIFICATION_RULES[dto.type];
    if (!rule) throw new BadRequestException('Unknown verification type');

    // A landlord submitting a SASSA letter, or a tenant submitting a title
    // deed, is a confused client rather than an attack — but accepting it
    // would put a check on a profile that has no field to hold it.
    if (!maySubmit(dto.type, user.role)) {
      throw new BadRequestException(
        `${rule.label} is not something a ${user.role.toLowerCase()} submits.`,
      );
    }

    if (rule.needsDocument && !dto.documentPath) {
      throw new BadRequestException(`${rule.label} needs a document.`);
    }
    if (!rule.needsDocument && dto.documentPath) {
      throw new BadRequestException(`${rule.label} is a phone call, not a document.`);
    }
    if (dto.type === 'landlord_reference' && !dto.reference) {
      throw new BadRequestException(
        'A previous landlord reference needs their name and mobile number.',
      );
    }

    const existing = await this.prisma.verificationRequest.findFirst({
      where: { userId: user.id, type: dto.type, status: { in: ['pending', 'pending_payment'] } },
    });
    if (existing) {
      throw new BadRequestException(
        'You already have a check of this type waiting. We will let you know once it has been looked at.',
      );
    }

    const needsPayment = requiresPayment(dto.type, user.role);

    const request = await this.prisma.$transaction(async (tx) => {
      const created = await tx.verificationRequest.create({
        data: {
          userId: user.id,
          type: dto.type,
          documentPath: dto.documentPath ?? null,
          // The fee waits for payment before review; everything else goes
          // straight to the queue.
          status: needsPayment ? 'pending_payment' : 'pending',
        },
      });

      if (dto.reference) {
        await tx.landlordReference.create({
          data: {
            requestId: created.id,
            refereeName: dto.reference.refereeName,
            refereePhone: dto.reference.refereePhone,
            propertyDescription: dto.reference.propertyDescription,
            tenancyStartedAt: dto.reference.tenancyStartedAt
              ? new Date(dto.reference.tenancyStartedAt) : null,
            tenancyEndedAt: dto.reference.tenancyEndedAt
              ? new Date(dto.reference.tenancyEndedAt) : null,
          },
        });
      }

      await this.recordEvent(
        tx, created.id, 'applicant', 'submitted',
        rule.needsDocument
          ? `${rule.label} submitted for review.`
          : `${rule.label} submitted — ${dto.reference?.refereeName} to be contacted.`,
      );
      if (needsPayment) {
        await this.recordEvent(
          tx, created.id, 'system', 'awaiting_payment',
          'Waiting for the R149 verification fee before review.',
        );
      }
      return created;
    });

    this.logger.log(`Verification submitted: ${dto.type} by ${user.role} ${user.id}`);
    const { documentPath, ...safe } = request;
    return { ...safe, hasDocument: documentPath !== null, label: rule.label };
  }

  /** Admin queue. Includes documentPath — a reviewer must see the document. */
  listPending() {
    return this.prisma.verificationRequest.findMany({
      // pending_payment is excluded deliberately: reviewing before payment
      // means chasing money from someone you have just told no.
      where: { status: 'pending' },
      include: {
        user: {
          select: {
            id: true, fullName: true, email: true, role: true,
            createdAt: true, openFlagCount: true,
          },
        },
        reference: true,
        events: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Approve or reject.
   *
   * Approval is the only thing that sets a badge. For a landlord that is
   * LandlordProfile.idVerified, which the room card reflects. For a tenant it
   * is the Tenant Passport, which needs identity AND one income proof — see
   * refreshPassport.
   */
  async review(id: string, dto: ReviewVerificationDto, reviewerId: string) {
    const request = await this.prisma.verificationRequest.findUnique({
      where: { id },
      include: { user: { select: { role: true } }, reference: true },
    });
    if (!request) throw new NotFoundException('Verification request not found');
    if (request.status !== 'pending') {
      throw new BadRequestException('This request has already been reviewed');
    }
    if (dto.status === 'rejected' && !dto.reviewNote) {
      throw new BadRequestException(
        'A reason is required when rejecting, so the person knows what to fix',
      );
    }

    const rule = VERIFICATION_RULES[request.type];

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.verificationRequest.update({
        where: { id },
        data: {
          status: dto.status,
          reviewNote: dto.reviewNote,
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          // The document has served its purpose. Keep the outcome, not the ID.
          documentPath: null,
          documentDeletedAt: request.documentPath ? new Date() : request.documentDeletedAt,
        },
      });

      await this.recordEvent(
        tx, id, 'admin', dto.status,
        dto.status === 'approved'
          ? `${rule.label} checked and accepted.`
          : `${rule.label} not accepted: ${dto.reviewNote}`,
        reviewerId,
      );
      if (request.documentPath) {
        await this.recordEvent(
          tx, id, 'system', 'document_deleted',
          'The uploaded document was deleted. Only this outcome is kept — POPIA s.26.',
        );
      }

      if (dto.status === 'approved') {
        // Keyed on the account's role, not on the rule's subject: identity is
        // submittable by both, and it sets a different flag on each side.
        if (request.user.role === 'LANDLORD') {
          if (request.type === 'identity') {
            await tx.landlordProfile.updateMany({
              where: { userId: request.userId },
              data: { idVerified: true },
            });
          }
        } else {
          await this.refreshPassport(tx, request.userId);
        }
      }

      return result;
    });

    this.logger.log(`Verification ${dto.status}: ${id} by admin ${reviewerId}`);
    return updated;
  }

  /**
   * Recalculates the Tenant Passport from the checks that have passed.
   *
   * The rule, stated once here rather than inferred from flags: a Passport
   * needs identity confirmed AND at least one income proof. Either alone is
   * not enough — knowing who someone is says nothing about whether rent
   * arrives, and a bank statement without an identity could belong to anyone.
   *
   * Recomputed from the approved requests every time rather than incremented,
   * so a rejection, an expiry or a hand-edited row cannot leave a Passport
   * standing on a check that no longer holds.
   */
  private async refreshPassport(tx: Prisma.TransactionClient, userId: string) {
    const approved = await tx.verificationRequest.findMany({
      where: { userId, status: 'approved' },
      select: { type: true },
    });
    const types = new Set(approved.map((a) => a.type));

    const idVerified = types.has('identity');
    const incomeVerified = [...types].some(
      (type) => VERIFICATION_RULES[type as VerificationType]?.provesIncome,
    );
    const hasPassport = idVerified && incomeVerified;

    await tx.tenantProfile.updateMany({
      where: { userId },
      data: {
        idVerified,
        incomeVerified,
        hasPassport,
        passportExpiresAt: hasPassport
          ? new Date(Date.now() + PASSPORT_VALID_MONTHS * 30 * 24 * 60 * 60 * 1000)
          : null,
      },
    });
  }

  /**
   * The public basis for a badge: which checks a person passed and when.
   *
   * Visible to a landlord looking at an applicant, and to the person
   * themselves. It is a list of outcomes — never a document, never a note an
   * admin wrote about a rejection, and never a check that did not pass. A
   * landlord seeing "income proof: rejected" would be reading a private
   * failure as a signal to screen on, which is neither its purpose nor
   * defensible under PEPUDA.
   */
  async badgeBasis(userId: string) {
    const [user, approved] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, tenantProfile: true, landlordProfile: true },
      }),
      this.prisma.verificationRequest.findMany({
        where: { userId, status: 'approved' },
        select: { type: true, reviewedAt: true },
        orderBy: { reviewedAt: 'asc' },
      }),
    ]);
    if (!user) throw new NotFoundException('No such account');

    const checks = approved.map((a) => ({
      type: a.type,
      label: VERIFICATION_RULES[a.type].label,
      confirmedAt: a.reviewedAt,
    }));

    return {
      checks,
      hasPassport: user.tenantProfile?.hasPassport ?? false,
      passportExpiresAt: user.tenantProfile?.passportExpiresAt ?? null,
      idVerified:
        user.role === 'LANDLORD'
          ? (user.landlordProfile?.idVerified ?? false)
          : (user.tenantProfile?.idVerified ?? false),
    };
  }

  /** The subject's own trail for one request. Not another person's. */
  async history(requestId: string, userId: string) {
    const request = await this.prisma.verificationRequest.findUnique({
      where: { id: requestId },
      select: { userId: true },
    });
    if (!request) throw new NotFoundException('Verification request not found');
    if (request.userId !== userId) throw new ForbiddenException('That is not your verification');

    return this.prisma.verificationEvent.findMany({
      where: { requestId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, actor: true, step: true, detail: true, createdAt: true },
    });
  }
}
