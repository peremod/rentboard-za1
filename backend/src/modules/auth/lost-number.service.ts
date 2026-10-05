import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { NoticeRouter } from '../notifications/notice-router.service';
import { normaliseSaMobile } from '../../common/utils/phone.util';

const CODE_TTL_MINUTES = 30;
const MAX_ATTEMPTS = 5;

/**
 * Getting back in when the phone itself is gone — Phase 7q.
 *
 * ⚠️ This is the most dangerous path in the product. The account on the other
 * side of it holds rooms, applications, tenancies, a rent record and
 * conversations with tenants. Getting it wrong does not inconvenience
 * somebody; it hands a stranger a landlord's entire history with the people
 * living in their rooms.
 *
 * ── Why it has to exist
 *
 * An account made from a mobile number has no email and no password. Phase 7o
 * made the number changeable with the new one proven first, which covers
 * switching SIMs — the common case — and covers nothing when the handset is
 * gone, because every route needs the old number in hand. A person in that
 * position currently has no way back to their own rooms, ever.
 *
 * ── The two proofs
 *
 * Neither is sufficient alone, and that is the design:
 *
 *   1. A PERSON proves identity to an admin, offline, and the admin records
 *      WHAT was checked and WHEN. Named, dated outcomes — the same pattern as
 *      the contractor checks and VerificationRequest. An approval with no
 *      recorded check is refused by a CHECK constraint as well as by this
 *      service, because the rule matters more than the route.
 *   2. The NEW HANDSET answers a code. An admin cannot type a number in and
 *      have it become the way in: somebody has to be holding that phone.
 *
 * ── The narrowing that matters most
 *
 * `open` REFUSES when the account has an email address or a password. Then
 * there is a self-service way in — `forgot-password`, or signing in with the
 * password — and nobody has to be trusted at all. The dangerous path stays as
 * small as it can be, and the refusal says which safer route to use.
 *
 * ── ⚠️ What this cannot do
 *
 * It cannot warn the real owner in time. The notice is written the moment a
 * request opens, to every channel the account has — and in the case this exists
 * for there is no email and the owner cannot sign in to read a Notice. So the
 * warning lands only once they are back in, after the fact. There is no honest
 * way around it: a person with no email, no password and no phone has no
 * channel left.
 *
 * The mitigation is therefore the RECORD, not the warning. Every recovery is
 * permanent, attributable to a named admin, and reconstructable in a dispute;
 * and a recovered account is shown what happened and when, so an owner who does
 * get back in finds out rather than wondering.
 *
 * A second admin approval is the standard control here and is deliberately NOT
 * required: this platform is run by one person, so a two-admin rule would make
 * the feature unusable by the only admin there is. Recorded as a decision in
 * docs/OUTSTANDING.md rather than quietly skipped.
 */
@Injectable()
export class LostNumberService {
  private readonly logger = new Logger(LostNumberService.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
    private notice: NoticeRouter,
    private config: ConfigService,
  ) {}

  /** Same scheme as every other code here, keyed with the server secret. */
  private hash(code: string, phone: string) {
    const key = this.config.get<string>('jwt.secret') ?? '';
    return crypto.createHmac('sha256', key).update(`recover:${phone}:${code}`).digest('hex');
  }

  private requirePhone(raw: string): string {
    const phone = normaliseSaMobile(raw);
    if (!phone) {
      throw new BadRequestException('Enter a valid South African mobile number, e.g. 082 123 4567');
    }
    return phone;
  }

  /**
   * Is there an account on this number, and is this flow the right one for it?
   *
   * For an admin with somebody in front of them. It returns the name, because
   * matching the name against an identity document is the entire point of the
   * check they are about to make — and an admin can already search accounts by
   * name on their own dashboard, so nothing is reachable here that was not.
   *
   * It does NOT answer for a number with no account in a way that differs from
   * one that has: both come back as a lookup result with `found`. There is no
   * membership oracle to protect against here (the caller is an admin) but
   * there is no reason to shape it otherwise either.
   */
  async lookup(rawPhone: string) {
    const phone = this.requirePhone(rawPhone);
    const user = await this.prisma.user.findFirst({
      where: { phone, phoneVerified: true },
      select: {
        id: true, fullName: true, email: true, passwordHash: true,
        role: true, createdAt: true, isActive: true, deletedAt: true,
      },
    });
    if (!user) return { found: false as const };

    const hasEmail = user.email !== null;
    const hasPassword = user.passwordHash !== null;
    const live = await this.prisma.accountRecovery.findFirst({
      where: { userId: user.id, status: { in: ['open', 'approved'] } },
      select: { id: true, status: true, newPhone: true, createdAt: true },
    });

    return {
      found: true as const,
      userId: user.id,
      fullName: user.fullName,
      role: user.role,
      memberSince: user.createdAt,
      closed: user.deletedAt !== null || !user.isActive,
      hasEmail,
      hasPassword,
      /**
       * ⚠️ The whole point of this field. When there is a safer route, say so,
       * and the admin does not have to be trusted with anything.
       */
      recoverable: !hasEmail && !hasPassword && user.deletedAt === null && user.isActive,
      saferRoute: hasEmail
        ? 'This account has an email address. Send them a password reset instead — nobody has to be trusted.'
        : hasPassword
          ? 'This account has a password. They can sign in with it, or reset it if they have an address.'
          : null,
      liveRequest: live,
    };
  }

  /**
   * Open a request. Nothing is checked and nothing moves.
   *
   * The account is told immediately, through every channel it has. See the
   * class note on why that is not a protection in the case this exists for.
   */
  async open(
    adminId: string,
    dto: { phone: string; newPhone: string; note?: string },
  ) {
    const oldPhone = this.requirePhone(dto.phone);
    const newPhone = this.requirePhone(dto.newPhone);
    if (oldPhone === newPhone) {
      throw new BadRequestException(
        'That is the same number. If they still have the handset, use "Change my number" on their own settings screen — it needs no admin.',
      );
    }

    const user = await this.prisma.user.findFirst({
      where: { phone: oldPhone, phoneVerified: true },
      select: { id: true, email: true, phone: true, phoneVerified: true, fullName: true, passwordHash: true, isActive: true, deletedAt: true },
    });
    if (!user) throw new NotFoundException('No account is signed in with that number.');
    if (user.deletedAt || !user.isActive) {
      throw new BadRequestException('That account is closed or paused. It cannot be recovered this way.');
    }

    // ⚠️ The narrowing. A safer route exists, so this one is refused.
    if (user.email) {
      throw new BadRequestException(
        'That account has an email address, so it does not need this. Send a password reset to it instead — '
        + 'that way nobody has to be trusted with a hand-over.',
      );
    }
    if (user.passwordHash) {
      throw new BadRequestException(
        'That account has a password. They can sign in with it, or reset it if they add an address — '
        + 'neither needs a hand-over.',
      );
    }

    const taken = await this.prisma.user.findFirst({
      where: { phone: newPhone, phoneVerified: true, id: { not: user.id } },
    });
    if (taken) {
      throw new BadRequestException('That new number is already signed in on another account.');
    }

    const live = await this.prisma.accountRecovery.findFirst({
      where: { userId: user.id, status: { in: ['open', 'approved'] } },
    });
    if (live) {
      throw new BadRequestException(
        'There is already a request open on this account. Finish or refuse that one first.',
      );
    }

    const row = await this.prisma.accountRecovery.create({
      data: {
        userId: user.id,
        oldPhone,
        newPhone,
        openedByAdminId: adminId,
        // The admin's words about the conversation, if they wrote any. About the
        // REQUEST, never about the person.
        idSeenNote: null,
        knowledgeCheckedNote: dto.note?.trim() || null,
      },
    });

    // Every channel the account has. In the case this exists for that is a
    // Notice the owner cannot currently read — see the class note. It is written
    // anyway, because an owner who does get back in should find out.
    await this.notice
      .deliver(user, {
        kind: 'account_recovery_requested',
        title: 'Somebody has asked to move your account to a new number',
        body:
          `A request was opened to change the number on your account from ${oldPhone} to ${newPhone}. `
          + 'Nothing has changed yet. If this was not you, contact us immediately — and if you still have '
          + 'your old number, nobody can take your account without proving who they are to us first.',
        link: '/account/settings',
      })
      .catch(() => {});

    this.logger.warn(
      `Lost-number recovery OPENED for user ${user.id} (${oldPhone} -> ${newPhone}) by admin ${adminId}`,
    );
    return {
      id: row.id,
      status: row.status,
      message:
        'Request opened. Nothing has moved. Check who they are, record what you checked, then approve — '
        + 'the code goes to the new number and they have to enter it themselves.',
    };
  }

  /**
   * Record what was actually checked. Named, dated, in the admin's words.
   *
   * ⚠️ Only outcomes persist. There is deliberately no document upload here:
   * the same rule as VerificationRequest (POPIA s.19). "Store the ID so we can
   * re-check it later" is a reasonable-sounding thing somebody adds, and a
   * stored identity document is a liability that outlives its usefulness.
   */
  async recordCheck(
    id: string,
    dto: { idSeenNote?: string; knowledgeCheckedNote?: string },
  ) {
    const row = await this.prisma.accountRecovery.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('No such recovery request.');
    if (row.status !== 'open') {
      throw new BadRequestException(`That request is ${row.status}. Checks can only be recorded while it is open.`);
    }

    const idNote = dto.idSeenNote?.trim();
    const knowNote = dto.knowledgeCheckedNote?.trim();
    if (!idNote && !knowNote) {
      throw new BadRequestException('Say what you checked. A tick with no words is not a record.');
    }

    const updated = await this.prisma.accountRecovery.update({
      where: { id },
      data: {
        ...(idNote ? { idSeenAt: new Date(), idSeenNote: idNote } : {}),
        ...(knowNote ? { knowledgeCheckedAt: new Date(), knowledgeCheckedNote: knowNote } : {}),
      },
    });
    return {
      id: updated.id,
      idSeenAt: updated.idSeenAt,
      knowledgeCheckedAt: updated.knowledgeCheckedAt,
    };
  }

  /**
   * Approve, and send a code to the new number.
   *
   * ⚠️ Refuses without a recorded identity check. The database refuses it too.
   * This is the one guard that stops the flow from being "an admin typed a
   * number in", and a service-only version of it is one direct UPDATE away from
   * being no guard at all.
   */
  async approve(adminId: string, id: string) {
    const row = await this.prisma.accountRecovery.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('No such recovery request.');
    if (row.status !== 'open') {
      throw new BadRequestException(`That request is already ${row.status}.`);
    }
    if (!row.idSeenAt) {
      throw new BadRequestException(
        'Record what identity document you saw before approving. Handing over an account on a '
        + 'conversation alone is not something this can let you do.',
      );
    }

    // Re-checked: somebody may have verified the new number since it was asked for.
    const taken = await this.prisma.user.findFirst({
      where: { phone: row.newPhone, phoneVerified: true, id: { not: row.userId } },
    });
    if (taken) {
      throw new BadRequestException('That number is now signed in on another account. Refuse this request.');
    }

    const code = String(crypto.randomInt(100000, 999999));
    await this.prisma.accountRecovery.update({
      where: { id },
      data: {
        status: 'approved',
        approvedByAdminId: adminId,
        approvedAt: new Date(),
        codeHash: this.hash(code, row.newPhone),
        codeExpiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
        attempts: 0,
      },
    });

    await this.whatsapp
      .sendOtp(row.newPhone, code, CODE_TTL_MINUTES)
      .catch((err) => this.logger.error(`Recovery code send failed for ${row.newPhone}`, err));

    this.logger.warn(
      `Lost-number recovery APPROVED for user ${row.userId} by admin ${adminId}; code sent to ${row.newPhone}`,
    );
    return {
      id,
      status: 'approved',
      message:
        `A code is on its way to ${row.newPhone}. They enter it themselves — you cannot finish this for them. `
        + `It expires in ${CODE_TTL_MINUTES} minutes.`,
      // Deliberately absent: the code.
    };
  }

  async refuse(adminId: string, id: string, reason: string) {
    const row = await this.prisma.accountRecovery.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('No such recovery request.');
    if (row.status === 'recovered') {
      throw new BadRequestException('That account has already been handed over. Refusing it now changes nothing.');
    }
    const trimmed = reason.trim();
    if (!trimmed) throw new BadRequestException('Say why. A refusal with no reason is not reviewable.');

    await this.prisma.accountRecovery.update({
      where: { id },
      data: {
        status: 'refused',
        refusedAt: new Date(),
        refusedReason: trimmed,
        // The code dies with the refusal, rather than staying live on a request
        // somebody has decided against.
        codeHash: null,
        codeExpiresAt: null,
      },
    });
    this.logger.warn(`Lost-number recovery REFUSED for user ${row.userId} by admin ${adminId}: ${trimmed}`);
    return { id, status: 'refused' };
  }

  /**
   * The new handset answered. Move the account.
   *
   * ⚠️ Deliberately NOT authenticated, and keyed on the number plus the code.
   *
   * The person has no session — that is the entire premise — so there is nothing
   * to authenticate. What stands in for it is holding the handset the approved
   * code went to. The request id is not required: an id read out over a phone
   * line is one more thing to mistype, and it adds nothing a code to that
   * number does not already prove.
   *
   * Errors are the same sentence whichever way it failed, for the usual reason:
   * "no request for that number" tells somebody whose account is mid-recovery.
   */
  async confirm(rawPhone: string, code: string) {
    const phone = this.requirePhone(rawPhone);
    const wrong = new BadRequestException('That code is wrong or has expired. Ask us to send a new one.');

    const row = await this.prisma.accountRecovery.findFirst({
      where: { newPhone: phone, status: 'approved', codeHash: { not: null } },
      orderBy: { approvedAt: 'desc' },
    });
    if (!row || !row.codeExpiresAt || row.codeExpiresAt < new Date()) throw wrong;
    if (row.attempts >= MAX_ATTEMPTS) throw wrong;

    if (this.hash(code.trim(), phone) !== row.codeHash) {
      // Counted per request, so a guesser gets one budget for this account
      // however many addresses they come from.
      await this.prisma.accountRecovery.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      });
      throw wrong;
    }

    // Last check: the number must still be free. Two accounts signing in on one
    // number is the takeover this whole file exists to avoid.
    const taken = await this.prisma.user.findFirst({
      where: { phone, phoneVerified: true, id: { not: row.userId } },
    });
    if (taken) throw wrong;

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: row.userId },
        // The old number is REPLACED, not kept beside the new one. It is in
        // somebody else's hands; leaving it able to sign in would be the point
        // of the exercise undone.
        data: { phone, phoneVerified: true },
      }),
      this.prisma.accountRecovery.update({
        where: { id: row.id },
        data: {
          status: 'recovered',
          recoveredAt: new Date(),
          codeHash: null,
          codeExpiresAt: null,
        },
      }),
    ]);

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: row.userId },
      select: { id: true, email: true, phone: true, phoneVerified: true, fullName: true },
    });

    // ⚠️ Written to the account, permanently, where whoever holds it will see
    // it. If this hand-over was wrong, this notice is how the real owner finds
    // out — it is the only thing that can reach them at all.
    await this.notice
      .deliver(user, {
        kind: 'account_recovery_completed',
        title: 'The number on your account was changed',
        body:
          `Your account now signs in with ${phone}, after somebody proved to us who they were. `
          + `It used to be ${row.oldPhone}. If that was not you, contact us immediately and tell us `
          + 'this was not you — we keep a record of who approved it and what they checked.',
        link: '/account/settings',
      })
      .catch(() => {});

    this.logger.warn(
      `Lost-number recovery COMPLETED for user ${row.userId}: ${row.oldPhone} -> ${phone}`,
    );
    return {
      message: 'That is your number now. Sign in with a WhatsApp code to it.',
      phone,
    };
  }

  /** The queue, for an admin. Stored is not the same as readable. */
  async list(status?: 'open' | 'approved' | 'recovered' | 'refused' | 'expired') {
    const rows = await this.prisma.accountRecovery.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, status: true, oldPhone: true, newPhone: true,
        idSeenAt: true, idSeenNote: true,
        knowledgeCheckedAt: true, knowledgeCheckedNote: true,
        approvedAt: true, refusedAt: true, refusedReason: true, recoveredAt: true,
        createdAt: true, attempts: true,
        user: { select: { id: true, fullName: true, role: true } },
        openedByAdmin: { select: { id: true, fullName: true } },
        approvedByAdmin: { select: { id: true, fullName: true } },
      },
    });
    return rows;
  }

  /**
   * Expire requests nobody finished.
   *
   * POPIA: an open or approved request holds the new mobile number of somebody
   * who was never recovered. The status changes and the NUMBER GOES — the row
   * stays as the record that a request existed and was never completed, which
   * is what a dispute needs, without keeping a number belonging to a person who
   * got nothing.
   */
  async expireStale(olderThanHours = 72) {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60_000);
    const stale = await this.prisma.accountRecovery.findMany({
      where: { status: { in: ['open', 'approved'] }, createdAt: { lt: cutoff } },
      select: { id: true },
    });
    if (!stale.length) return { expired: 0 };
    await this.prisma.accountRecovery.updateMany({
      where: { id: { in: stale.map((s) => s.id) } },
      data: {
        status: 'expired',
        codeHash: null,
        codeExpiresAt: null,
        // The number of somebody who was never recovered does not need keeping.
        newPhone: '(expired)',
      },
    });
    this.logger.log(`Expired ${stale.length} stale recovery request(s)`);
    return { expired: stale.length };
  }
}
