import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/** What deletion will actually touch, counted from this person's own rows. */
export interface DeletionPreview {
  /** Erased outright — personal information nobody else has a claim on. */
  erased: { label: string; count: number | null }[];
  /** Kept, with this person's identity removed, because it is somebody else's record too. */
  kept: { label: string; count: number; why: string }[];
  /** Things that stop happening the moment the account ends. */
  stops: string[];
}

/**
 * Deactivating and ending an account — Phase 7g.
 *
 * ── Two states, because `isActive` could not be one of them
 *
 * `User.isActive` already existed and every sign-in path refuses a false value
 * with "Your account has been suspended. Please contact support." That is an
 * administrator locking somebody out. It cannot be what a person uses on
 * themselves, because an account you cannot sign into is one you can never
 * reactivate — the control would be a trapdoor. So deactivation is its own
 * column and sign-in keeps working.
 *
 * ── Deletion erases the person, not the shared record
 *
 * The foreign keys were read before this was designed. `DELETE FROM users`
 * cascades into rooms (and from there into OTHER tenants' applications, their
 * saved rooms and the reviews they wrote), into applications and from there
 * into messages — so deleting a tenant erases the landlord's own side of the
 * conversation — into tenancies and their rent history, into reviews this
 * person WROTE about somebody else, and into payments.
 *
 * POPIA s.24 is a right to have YOUR personal information deleted. It is not a
 * right to delete somebody else's, and it does not require destroying a record
 * two parties share. So the row becomes a tombstone: every personal field
 * erased and unrecoverable, the shared rows kept with the identity removed.
 *
 * The screen says precisely that before anything happens. A dialog promising
 * "permanent deletion" over a mechanism that leaves a named row behind would be
 * the dishonest version; this one leaves no name behind.
 */
@Injectable()
export class AccountLifecycleService {
  private readonly log = new Logger(AccountLifecycleService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  // ── Deactivation ─────────────────────────────────────────────────────────

  /**
   * Put the account to sleep. Nothing is destroyed.
   *
   * Rooms are PAUSED rather than deleted: pause is the existing status for
   * "off the board but not finished with", it keeps the applications and the
   * tenancy attached, and it is what reactivation has to be able to undo.
   */
  async deactivate(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { deletedAt: true, deactivatedAt: true },
    });
    if (user.deletedAt) throw new BadRequestException('This account has already been ended.');
    if (user.deactivatedAt) return { deactivatedAt: user.deactivatedAt, roomsPaused: 0 };

    const [paused] = await this.prisma.$transaction([
      this.prisma.room.updateMany({
        where: { landlordId: userId, status: { in: ['active', 'reserved'] } },
        data: { status: 'paused' },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { deactivatedAt: new Date() },
      }),
    ]);

    return { deactivatedAt: new Date(), roomsPaused: paused.count };
  }

  /**
   * Wake it up again.
   *
   * ⚠️ Rooms are NOT republished. They were paused on the way out and a
   * landlord may have let one in the meantime; putting a room back on the board
   * without being asked would advertise a room that is taken, to people who
   * then apply for it. The screen says so and the rooms are one tap each.
   */
  async reactivate(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { deletedAt: true },
    });
    if (user.deletedAt) throw new BadRequestException('This account has been ended and cannot be reopened.');

    await this.prisma.user.update({ where: { id: userId }, data: { deactivatedAt: null } });
    const paused = await this.prisma.room.count({ where: { landlordId: userId, status: 'paused' } });
    return { deactivatedAt: null, roomsStillPaused: paused };
  }

  // ── What deletion will do, from the real rows ────────────────────────────

  /**
   * The preview the screen shows before the confirmation.
   *
   * Counted from this person's own data rather than written as static copy: a
   * landlord with a live tenancy and a tenant who has applied for one room need
   * to be told different things, and a paragraph that covers both says nothing
   * useful to either. The brief asks what happens to listings, rooms,
   * applications and personal information; this answers it with their numbers.
   */
  async previewDeletion(userId: string): Promise<DeletionPreview> {
    const [rooms, applications, tenanciesAsTenant, tenanciesAsLandlord, reviewsWritten,
           messages, savedRooms, savedSearches, notes, verifications] = await Promise.all([
      this.prisma.room.count({ where: { landlordId: userId, status: { not: 'deleted' } } }),
      this.prisma.application.count({ where: { tenantId: userId } }),
      this.prisma.tenancy.count({ where: { tenantId: userId, status: { in: ['pending', 'active'] } } }),
      this.prisma.tenancy.count({ where: { landlordId: userId, status: { in: ['pending', 'active'] } } }),
      this.prisma.review.count({ where: { authorId: userId } }),
      this.prisma.message.count({ where: { senderId: userId } }),
      this.prisma.savedRoom.count({ where: { tenantId: userId } }),
      this.prisma.savedSearch.count({ where: { tenantId: userId } }),
      this.prisma.landlordNote.count({ where: { landlordId: userId } }),
      this.prisma.verificationRequest.count({ where: { userId } }),
    ]);

    const erased: DeletionPreview['erased'] = [
      { label: 'Your name, email address, phone number and photo', count: null },
      { label: 'Your password, so nobody can sign in as you again', count: null },
    ];
    if (verifications) {
      erased.push({
        label: 'Your verification checks and what they were based on',
        count: verifications,
      });
    }
    if (savedRooms) erased.push({ label: 'Rooms you saved', count: savedRooms });
    if (savedSearches) erased.push({ label: 'Your room alerts', count: savedSearches });
    if (notes) erased.push({ label: 'Private notes you wrote about tenants', count: notes });

    const kept: DeletionPreview['kept'] = [];
    if (messages) {
      kept.push({
        label: 'Messages you sent',
        count: messages,
        why: 'A conversation belongs to both of you. Your name comes off it; the words stay, '
          + 'because deleting them would leave holes in somebody else’s thread.',
      });
    }
    if (reviewsWritten) {
      kept.push({
        label: 'Reviews you wrote',
        count: reviewsWritten,
        why: 'Other people read these when deciding where to live, or who to let to. '
          + 'They stay, shown as written by a former member.',
      });
    }
    if (tenanciesAsTenant || tenanciesAsLandlord) {
      kept.push({
        label: 'Your tenancy records and their rent history',
        count: tenanciesAsTenant + tenanciesAsLandlord,
        why: 'This is the other party’s record as much as yours — who paid what, and when. '
          + 'It stays, without your name on it.',
      });
    }
    if (rooms) {
      kept.push({
        label: 'Rooms you listed',
        count: rooms,
        why: 'Taken off the board immediately and never shown again. The rooms themselves are '
          + 'kept, because deleting them would delete other people’s applications and the '
          + 'reviews they left.',
      });
    }

    const stops: string[] = [
      'You will be signed out everywhere and cannot sign in again.',
      'Nothing more is sent to you — no email, no WhatsApp, no notices.',
    ];
    if (rooms) stops.push(`Your ${rooms} ${rooms === 1 ? 'listing comes' : 'listings come'} off the board straight away.`);
    if (applications) stops.push(`Your ${applications} ${applications === 1 ? 'application is' : 'applications are'} withdrawn.`);
    if (tenanciesAsLandlord) {
      stops.push(
        'Your tenants keep their rent records, but they will no longer be able to reach you '
        + 'through Mastande. Tell them how to contact you before you do this.',
      );
    }

    return { erased, kept, stops };
  }

  // ── Deletion ─────────────────────────────────────────────────────────────

  /**
   * End the account.
   *
   * ── Re-authentication is required
   *
   * The settings screen already demands the current password to change an email
   * address, on the reasoning that "a session someone walked away from should
   * not be enough to take an account over". That applies far more here: this is
   * the one action with nothing behind it. A phone-only account has no password,
   * so it confirms with a fresh WhatsApp code instead — the caller proves that
   * first and passes `phoneVerified`.
   */
  async deleteAccount(
    userId: string,
    proof: { password?: string; phoneConfirmed?: boolean },
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true, email: true, passwordHash: true, avatarPath: true, deletedAt: true, role: true,
      },
    });
    if (user.deletedAt) throw new BadRequestException('This account has already been ended.');

    if (user.passwordHash) {
      if (!proof.password) throw new BadRequestException('Enter your password to confirm.');
      const valid = await bcrypt.compare(proof.password, user.passwordHash);
      /**
       * ⚠️ 403, not 401 — see the note in AccountRecoveryService.changePassword.
       *
       * A 401 here sent the person to the login page with "your session has
       * expired" instead of "that password is not right", because the error
       * interceptor refreshed the session and retried the DELETE with the same
       * wrong password. On this screen that also threw away the typed DELETE and
       * the ticked acknowledgement, and spent two of the ten attempts the
       * endpoint allows per quarter hour.
       */
      if (!valid) throw new ForbiddenException('That password is not right.');
    } else if (!proof.phoneConfirmed) {
      // No password on the account at all — a phone-only sign-up. The caller
      // must have proved the number with a fresh code first.
      throw new BadRequestException(
        'Confirm the code we sent to your WhatsApp number before ending your account.',
      );
    }

    return this.erase(user, { actor: 'owner' });
  }

  /**
   * End somebody else's account, on their request — Phase 7i.
   *
   * ── Why an admin needs this at all
   *
   * A phone-only account has no password, so /account/close cannot confirm it;
   * that screen says to ask us, and until now there was nothing behind the
   * asking. POPIA s.24 is a right, not a feature request: if the only
   * self-service path requires a credential some accounts do not have, the
   * operator has to be able to act on the request.
   *
   * ── It is not suspension, and the two must not blur
   *
   * `setUserActive(false)` is reversible, keeps the email and is a moderation
   * decision we make. This is irreversible, erases the email and is a decision
   * the OWNER made and we are carrying out. Different verbs, different screens,
   * different records.
   *
   * ── The erasure is the same code, deliberately
   *
   * Not a second implementation. Two erasures that start identical drift, and
   * the one that drifts is the one nobody drives — so the day a column is added
   * to the self-service path, the admin path would quietly stop erasing it.
   */
  async closeOnBehalf(
    userId: string,
    adminId: string,
    detail: { reason: string },
  ) {
    const reason = detail.reason?.trim();
    if (!reason || reason.length < 10) {
      throw new BadRequestException(
        'Record how the request reached you — this is the only lasting evidence that it was asked for.',
      );
    }

    /**
     * ⚠️ An admin cannot close their OWN account from here.
     *
     * Not tidiness: this route takes no password, so an admin using it on
     * themselves would be skipping the re-authentication that /account/close
     * exists to demand — and the whole point of that check is that a session
     * somebody walked away from must not be enough.
     *
     * ⚠️ Falsifying it showed something worth keeping. Removed, the request
     * still fails — the ADMIN-role check below catches it, because the caller
     * of this route is always an admin. But it fails saying "use the database
     * directly", which tells an admin to go and DELETE their own user row:
     * the one action the whole tombstone design exists to prevent, because it
     * cascades into other people's applications, conversations and tenancies.
     * So this guard is not redundant. It is the difference between a correct
     * instruction and one that advises the damage.
     */
    if (userId === adminId) {
      throw new BadRequestException(
        'Close your own account from Settings, where it asks for your password.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, passwordHash: true, avatarPath: true, deletedAt: true, role: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.deletedAt) throw new BadRequestException('This account has already been ended.');

    // The same rule suspension already applies, for the same reason: an admin
    // removing another admin is a database decision with a person watching, not
    // a button on a support screen.
    if (user.role === 'ADMIN') {
      throw new BadRequestException(
        'Admin accounts cannot be ended from here — use the database directly.',
      );
    }

    return this.erase(user, { actor: 'admin', adminId, reason });
  }

  /**
   * The erasure itself — the one copy of it.
   *
   * ⚠️ Everything in ONE transaction, the photo's deletion and the audit row
   * included.
   *
   * `StorageService.enqueueDelete` takes the transaction client for exactly
   * this reason: the queue row and the erasure commit together or not at all.
   * Queued outside it, a failure half way through would leave a live account
   * whose photo was already on its way to being destroyed.
   *
   * The queue rather than a direct ImageKit call, because that service marks a
   * deletion done only from ImageKit's own response — the pattern this codebase
   * had to go back and make true after shipping a column whose name asserted a
   * deletion that never happened. A face is personal information and this is
   * the request where "we meant to" is not good enough.
   *
   * The audit row goes in the same transaction for the same reason: a closure
   * with no record of who asked for it, or a record of a closure that did not
   * happen, are both worse than either alone.
   */
  private async erase(
    user: { id: string; email: string | null; avatarPath: string | null; role: string },
    by: { actor: 'owner' | 'admin'; adminId?: string; reason?: string },
  ) {
    const userId = user.id;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      if (user.avatarPath) {
        await this.storage.enqueueDelete(tx, user.avatarPath, 'account_deleted');
      }
      await Promise.all([
      // Off the board first, so nothing is reachable while the rest runs.
      tx.room.updateMany({
        where: { landlordId: userId, status: { not: 'deleted' } },
        data: { status: 'deleted' },
      }),
      // Open applications are withdrawn rather than left pending on somebody
      // else's screen for ever.
      tx.application.updateMany({
        where: { tenantId: userId, status: { in: ['pending', 'viewed', 'shortlisted'] } },
        data: { status: 'withdrawn', decidedAt: now },
      }),

      // ── Erased: personal information with no counterparty ───────────────
      tx.savedRoom.deleteMany({ where: { tenantId: userId } }),
      tx.savedSearch.deleteMany({ where: { tenantId: userId } }),
      tx.landlordNote.deleteMany({ where: { landlordId: userId } }),
      tx.whatsappDraft.deleteMany({ where: { landlordId: userId } }),
      tx.notice.deleteMany({ where: { userId } }),
      tx.authToken.deleteMany({ where: { userId } }),
      tx.refreshToken.deleteMany({ where: { userId } }),
      tx.phoneSignup.deleteMany({ where: { userId } }),
      // Income, employment status and the verification outcomes go with the
      // profiles. The documents behind them were already deleted at review
      // time — only outcomes ever persisted, and now not even those.
      tx.verificationRequest.deleteMany({ where: { userId } }),

      /**
       * ⚠️ Contractor leads: the PERSON goes, the record stays — Phase 7k.
       *
       * A lead says a contractor's number was passed on, and it is the basis
       * on which that contractor may be invoiced. Deleting it would destroy a
       * third party's record of work we sent them, which is the same mistake
       * as deleting the conversation; keeping the landlord id would retain
       * personal information about somebody who asked to be forgotten.
       *
       * So the id is nulled and the lead is kept. The foreign key is already
       * ON DELETE SET NULL, which handles a real row deletion; this handles the
       * tombstone, where the row does not go anywhere.
       */
      tx.contractorLead.updateMany({ where: { landlordId: userId }, data: { landlordId: null } }),
      tx.tenantProfile.deleteMany({ where: { userId } }),
      tx.landlordProfile.deleteMany({ where: { userId } }),

      /**
       * ── The record of the closure ───────────────────────────────────────
       *
       * Holds the user id, who acted and why — never the email, the name or
       * the number. An audit trail that keeps what the erasure removed defeats
       * the erasure it audits.
       */
      tx.accountClosure.create({
        data: {
          userId,
          actor: by.actor,
          closedByAdminId: by.actor === 'admin' ? by.adminId : null,
          reason: by.reason ?? null,
        },
      }),

      /**
       * ── The tombstone ───────────────────────────────────────────────────
       *
       * ⚠️ The email is replaced rather than nulled, and that is forced by a
       * CHECK constraint: Phase 7g part one made email optional but requires
       * email OR phone, because an account with neither is one nobody can sign
       * into or notify. A reserved `.invalid` domain (RFC 2606) can never
       * reach anybody and is not personal information, so it satisfies the
       * constraint without identifying a person.
       *
       * `isActive: false` as well, so every existing sign-in path refuses this
       * row even if some future code path forgets about `deletedAt`. Two
       * independent reasons to refuse, because this is the one that must not
       * be got wrong.
       */
      tx.user.update({
        where: { id: userId },
        data: {
          deletedAt: now,
          deactivatedAt: null,
          isActive: false,
          fullName: 'Former member',
          email: `deleted-${userId}@deleted.mastande.invalid`,
          passwordHash: null,
          phone: null,
          phoneVerified: false,
          avatarPath: null,
          authProviderId: null,
          marketingEmails: false,
        },
      }),
      ]);
    });

    this.log.log(
      by.actor === 'admin'
        ? `Account ${userId} (${user.role}) ended by admin ${by.adminId} — ${by.reason}`
        : `Account ${userId} (${user.role}) ended at the owner's request`,
    );
    return { deletedAt: now };
  }
}