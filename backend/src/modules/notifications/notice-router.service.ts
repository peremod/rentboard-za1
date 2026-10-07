import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

/** Who to reach, and by what. Only the fields the decision needs. */
export interface Recipient {
  id: string;
  email: string | null;
  phone?: string | null;
  phoneVerified?: boolean;
  fullName?: string;
}

/** What to say, when there is no email to say it in. */
export interface NoticeInput {
  /** Mirrors the email template name, so both channels name the same event. */
  kind: string;
  title: string;
  body?: string;
  /** An in-app path. Never absolute — see the Notice model. */
  link?: string;
}

/**
 * One place that decides how a person hears from us — Phase 7g.
 *
 * ── Why this is a router and not sixteen edits
 *
 * Email stopped being required in v1.85.0, which created a way to lose somebody's
 * applications silently: every notification in the codebase was
 * `sendSomethingEmail(user.email, …)`, and for an account with no address that is
 * a send to nowhere. There were **twenty-two** such call sites, found by making
 * the column nullable and reading the compiler's list.
 *
 * Patching each one would mean sixteen copies of the same channel decision, and
 * the seventeenth notification anyone adds would not have it. So the decision
 * lives here, once, and a call site says what it wants to say rather than how.
 *
 * ── Email still behaves exactly as it did
 *
 * When there is an address, the caller's own email function runs unchanged. This
 * is deliberately not a rewrite of the email path: the regression risk of
 * reworking sixteen working notifications is far larger than the problem being
 * fixed, which is only ever about accounts with no address.
 *
 * ── WhatsApp is attempted and NOT assumed
 *
 * Every outbound message here is free-form `type: 'text'`, which Meta permits
 * only inside the 24-hour customer service window. Outside it, a
 * business-initiated message is rejected with error 131047 unless an approved
 * template exists — and the templates are not approved yet (see
 * docs/OUTSTANDING.md §7). So a WhatsApp-only fallback would fail for exactly the
 * people who have not messaged recently, which is most of them.
 *
 * The Notice row is therefore written FIRST and unconditionally, and WhatsApp is
 * a best-effort improvement on top. `whatsappSentAt` is set only from a
 * successful send; the failure reason is kept. The same rule as FileDeletion,
 * for the same reason: this codebase has already shipped a column whose name
 * asserted a delivery that never happened.
 */
@Injectable()
export class NoticeRouter {
  private readonly log = new Logger(NoticeRouter.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
  ) {}

  /**
   * Tell someone something, by whatever actually reaches them.
   *
   * `sendEmail` is the caller's existing email function, invoked only when there
   * is an address. It receives the address, so the caller keeps its own template
   * and data and nothing about the email path changes.
   *
   * Never throws. A notification failing must not fail the thing it was about —
   * an application should still be accepted if the "you were accepted" message
   * cannot be delivered.
   */
  async deliver(
    to: Recipient,
    notice: NoticeInput,
    sendEmail?: (email: string) => Promise<unknown>,
  ): Promise<void> {
    if (to.email && sendEmail) {
      try {
        await sendEmail(to.email);
        return;
      } catch (e) {
        // Email was possible and failed. Fall through to a notice rather than
        // losing it — a bounced address is exactly when the in-app copy matters.
        this.log.warn(`email failed for user ${to.id} (${notice.kind}), falling back: ${String(e)}`);
      }
    }

    // Written before the WhatsApp attempt, so the message exists even if that
    // attempt throws. This is the channel that cannot fail for reasons outside
    // our control.
    const row = await this.prisma.notice.create({
      data: {
        userId: to.id,
        kind: notice.kind,
        title: notice.title,
        body: notice.body ?? null,
        link: notice.link ?? null,
      },
    });

    // Only to a number the person confirmed is theirs. Messaging an unverified
    // number is messaging whoever actually holds it.
    if (!to.phone || !to.phoneVerified) return;

    // ⚠️ Phase 8j. Return BEFORE the attempt, so `whatsappError` stays null.
    //
    // Without this the send returns false, the catch-all below writes "WhatsApp
    // declined the message. Most likely outside the 24-hour window with no
    // approved template" — and the notices screen renders "WhatsApp could not
    // deliver this one" against every notice ever written. That reason would be
    // false (nothing was declined; nothing was sent) and the screen would be
    // telling a person their notice half-failed when it did not.
    //
    // Null means "we never tried", which is exactly right and is the
    // distinction the column was added to preserve.
    if (!this.whatsapp.isEnabled()) return;

    const text = [notice.title, notice.body].filter(Boolean).join('\n\n');
    try {
      const sent = await this.whatsapp.sendToNumber(to.phone, text);
      await this.prisma.notice.update({
        where: { id: row.id },
        data: sent
          ? { whatsappSentAt: new Date() }
          : {
              // Named rather than left null, so "no WhatsApp" is distinguishable
              // from "we never tried".
              whatsappError:
                'WhatsApp declined the message. Most likely outside the 24-hour window with no approved template.',
            },
      });
    } catch (e) {
      await this.prisma.notice.update({
        where: { id: row.id },
        data: { whatsappError: String(e).slice(0, 300) },
      });
    }
  }

  /** Somebody's unread notices, newest first. */
  unread(userId: string) {
    return this.prisma.notice.findMany({
      where: { userId, readAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** Everything, read or not — for a notifications screen. */
  all(userId: string) {
    return this.prisma.notice.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Mark read. Scoped to the owner in the WHERE, not checked afterwards. */
  async markRead(userId: string, id: string) {
    const result = await this.prisma.notice.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notice.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
