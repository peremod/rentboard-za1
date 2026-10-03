import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma, User } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { NoticeRouter } from '../notifications/notice-router.service';
import { ReferralsService } from '../referrals/referrals.service';
import { normaliseSaMobile } from '../../common/utils/phone.util';

/** How long a code is good for. Matches sign-in, so the two feel the same. */
const CODE_TTL_MINUTES = 10;

/**
 * How long the proof-of-number lasts once the code is right.
 *
 * Long enough to type a name and read two links, short enough that a ticket
 * left in a closed tab is useless by the time anyone finds it. It is not a
 * session: all it says is "this browser proved this number", and it buys
 * nothing but the ability to finish this one sign-up.
 */
const TICKET_TTL_MINUTES = 20;

/** Wrong guesses against one code before it is burned. As sign-in. */
const MAX_ATTEMPTS = 5;

/** Codes to one number in fifteen minutes, and in a day. As sign-in. */
const MAX_CODES_PER_15_MIN = 3;
const MAX_CODES_PER_DAY = 10;

/**
 * How long an abandoned sign-up is kept.
 *
 * It holds the mobile number of somebody who never joined, so POPIA s.14 says
 * do not keep it longer than the purpose needs — and the purpose expires with
 * the ticket. A day, so the rate limits above have a full window to count
 * over, then gone.
 */
const ABANDONED_TTL_HOURS = 24;

/**
 * Creating an account with nothing but a phone number — Phase 7g part two.
 *
 * Sign-in by phone shipped first, which left an odd gap: a landlord could sign
 * in with WhatsApp only if somebody had already made them an account with an
 * email address. The people this feature exists for — WhatsApp-first, often no
 * email at all — could not get through the front door on their own.
 *
 * ── Three steps, and why not fewer
 *
 *   1. `requestCode`  — a code to the number. No account is created.
 *   2. `verify`       — the code, in exchange for a short-lived ticket.
 *   3. `complete`     — name, role, and the person's own acceptance → account.
 *
 * The temptation is to collapse 2 and 3: take the code, the name and the tick in
 * one request. That reads simpler and is worse on a bad line — a dropped
 * response after the code is spent leaves the person with a burned code, no
 * account, and no way to tell which. Proving the number is also the step that
 * needs rate limiting, and the step that must not be retried with different
 * details. So they are separate, and the ticket carries the proof between them.
 *
 * ── The account appears at step 3, by the person's own hand
 *
 * Nothing before `complete` writes a User row. See the PhoneSignup model
 * comment: a sign-up attempt is not a person agreeing to anything, and an
 * account created from a typed-in number is an account somebody else owns.
 *
 * `complete` therefore requires `acceptTerms: true` from the request itself, and
 * records WHEN against the row that proved the number. That is the control that
 * matters for assisted sign-up, where an agent sits with a landlord and helps:
 * the help can reach as far as the handset, and the acceptance still has to come
 * from the person holding it.
 *
 * ⚠️ Delivery is the known weak point, not the flow. `sendOtp` posts free-form
 * WhatsApp text, which Meta allows only inside the 24-hour customer service
 * window; the authentication template that would work outside it is still
 * unapproved (docs/OUTSTANDING.md §7). So a brand-new number — which by
 * definition has never messaged us — may not receive its code until that
 * template is live. The flow is right; the pipe is half-connected.
 */
@Injectable()
export class PhoneSignupService {
  private readonly logger = new Logger(PhoneSignupService.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
    private notices: NoticeRouter,
    private referrals: ReferralsService,
    // For the HMAC key. The secret lives in the environment, so a read-only
    // database leak stops handing out live codes and usable tickets.
    private config: ConfigService,
  ) {}

  /** Keyed MAC, salted with the number — the same scheme as AuthToken. */
  private hashCode(code: string, phone: string) {
    const key = this.config.get<string>('jwt.secret') ?? '';
    return crypto.createHmac('sha256', key).update(`signup:${phone}:${code}`).digest('hex');
  }

  /**
   * Tickets are 256 bits of random, so there is nothing to brute force and the
   * salt does nothing — but they are still stored hashed, so the table never
   * holds a credential that could be used as-is.
   */
  private hashTicket(ticket: string) {
    const key = this.config.get<string>('jwt.secret') ?? '';
    return crypto.createHmac('sha256', key).update(`ticket:${ticket}`).digest('hex');
  }

  private requirePhone(raw: string): string {
    const phone = normaliseSaMobile(raw);
    if (!phone) {
      throw new BadRequestException('Enter a valid South African mobile number, e.g. 082 123 4567');
    }
    return phone;
  }

  /**
   * Step one: send a code to a number that may or may not already be somebody's.
   *
   * Always the same reply. "That number already has an account" is the single
   * most useful sentence you can hand someone testing a list of numbers against
   * a rental site — it says who is a landlord here — so it is not said.
   *
   * The real owner is told, though, which is the part that would otherwise be
   * lost to that silence: an in-app notice, delivered by email where there is
   * one and attempted over WhatsApp where there is not. They learn somebody
   * tried, and they learn they already have an account, and a stranger probing
   * numbers learns neither.
   */
  async requestCode(rawPhone: string) {
    const phone = this.requirePhone(rawPhone);
    const neutral = {
      message:
        `If that number can be used, a code is on its way on WhatsApp. ` +
        `It expires in ${CODE_TTL_MINUTES} minutes.`,
    };

    const existing = await this.prisma.user.findFirst({
      where: { phone, phoneVerified: true },
      select: { id: true, email: true, phone: true, phoneVerified: true, fullName: true, isActive: true },
    });

    if (existing) {
      if (existing.isActive) {
        // Not awaited: the reply must take the same time whether or not the
        // number is known, and a notice that writes a row and calls Meta does
        // not take the same time as doing nothing.
        void this.notices
          .deliver(existing, {
            kind: 'signup_attempt_existing_account',
            title: 'Someone tried to create an account with your number',
            body:
              'Your number already has a Mastande account, so nothing was created and no code was sent. ' +
              'If that was you, just sign in with your number instead — there is nothing to set up again. ' +
              'If it was not you, you can ignore this; nobody can get in without a code from this handset.',
            link: '/auth/login',
          })
          .catch(() => {});
      }
      this.logger.log(`Signup attempt on an existing number (user ${existing.id})`);
      return neutral;
    }

    // Counted as rows in a window, not as a counter on a row: starting a fresh
    // attempt must not hand anybody a fresh budget. Each message costs money and
    // lands on a handset that may not be the requester's.
    const [recent, today] = await Promise.all([
      this.prisma.phoneSignup.count({
        where: { phone, createdAt: { gte: new Date(Date.now() - 15 * 60_000) } },
      }),
      this.prisma.phoneSignup.count({
        where: { phone, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } },
      }),
    ]);
    if (recent >= MAX_CODES_PER_15_MIN) {
      throw new BadRequestException('Too many codes requested. Please wait 15 minutes.');
    }
    if (today >= MAX_CODES_PER_DAY) {
      throw new BadRequestException(
        'Too many codes sent to this number today. Please try again tomorrow.',
      );
    }

    const code = String(crypto.randomInt(100000, 999999));

    // ONE live code at a time, spent in the same transaction as the new one is
    // issued — so there is no instant with two valid codes and none with zero.
    // Only rows still awaiting a code are touched: a row that has already been
    // verified is holding a live ticket, and killing that would log somebody out
    // of a sign-up they are halfway through for the sake of tidiness.
    await this.prisma.$transaction([
      this.prisma.phoneSignup.updateMany({
        where: { phone, userId: null, codeHash: { not: null } },
        data: { codeHash: null },
      }),
      this.prisma.phoneSignup.create({
        data: {
          phone,
          codeHash: this.hashCode(code, phone),
          expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
        },
      }),
    ]);

    this.whatsapp
      .sendOtp(phone, code, CODE_TTL_MINUTES)
      .catch((err) => this.logger.error(`Signup code send failed for ${phone}`, err));

    this.logger.log(`Signup code requested for ${phone}`);
    return neutral;
  }

  /**
   * Step two: the code, for a ticket.
   *
   * Found by whose code it is and then compared, rather than looked up by the
   * hash of what was typed — the latter is tidier and makes counting attempts
   * impossible, which is how MAX_ATTEMPTS sat unread in the sign-in service for
   * three releases.
   */
  async verify(rawPhone: string, rawCode: string) {
    const phone = this.requirePhone(rawPhone);

    const row = await this.prisma.phoneSignup.findFirst({
      where: { phone, userId: null, codeHash: { not: null } },
      orderBy: { createdAt: 'desc' },
    });

    // Expired or never requested. One message for both: which it is tells a
    // guesser whether a code is in flight.
    if (!row || row.expiresAt < new Date()) {
      throw new BadRequestException('That code is wrong or has expired. Request a new one.');
    }

    if (row.attempts >= MAX_ATTEMPTS) {
      await this.prisma.phoneSignup.update({ where: { id: row.id }, data: { codeHash: null } });
      throw new BadRequestException('Too many wrong codes. Request a new one.');
    }

    // Constant time. Both sides are fixed-length hex from the same HMAC, so
    // timingSafeEqual cannot throw on a length mismatch.
    const submitted = Buffer.from(this.hashCode(rawCode.trim(), phone));
    const expected = Buffer.from(row.codeHash!);
    const matches =
      submitted.length === expected.length && crypto.timingSafeEqual(submitted, expected);

    if (!matches) {
      const updated = await this.prisma.phoneSignup.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      const left = MAX_ATTEMPTS - updated.attempts;
      throw new BadRequestException(
        left > 0
          ? `That code is wrong. ${left} ${left === 1 ? 'try' : 'tries'} left before you need a new one.`
          : 'Too many wrong codes. Request a new one.',
      );
    }

    const ticket = crypto.randomBytes(32).toString('base64url');
    await this.prisma.phoneSignup.update({
      where: { id: row.id },
      data: {
        // Cleared, not marked used: a spent code should not still be in the
        // table in a form anybody could check a guess against.
        codeHash: null,
        verifiedAt: new Date(),
        ticketHash: this.hashTicket(ticket),
        ticketExpiresAt: new Date(Date.now() + TICKET_TTL_MINUTES * 60_000),
      },
    });

    this.logger.log(`Signup number proven: ${phone}`);
    return {
      ticket,
      phone,
      expiresInMinutes: TICKET_TTL_MINUTES,
      message: 'Number confirmed. Tell us who you are and you are in.',
    };
  }

  /**
   * Step three: the account.
   *
   * `acceptTerms` is not a formality and is not defaulted anywhere — it has to
   * arrive true from a request the person themselves submitted, and the moment
   * is written against the row that proved their number. An assisted sign-up can
   * do everything up to here; it cannot do this.
   *
   * Returns the User. The caller issues the session, exactly as the magic-link
   * and phone sign-in paths do, so token issuance stays in one place.
   */
  async complete(input: {
    ticket: string;
    fullName: string;
    role: 'TENANT' | 'LANDLORD';
    acceptTerms: boolean;
    referralCode?: string;
  }): Promise<User> {
    // Belt and braces: the DTO already requires `true`. Two checks, because the
    // consequence of this one being missed is an account whose owner never
    // agreed to anything, and the cost of the second check is a line.
    if (input.acceptTerms !== true) {
      throw new BadRequestException(
        'Please accept the Terms and Privacy Policy to create your account.',
      );
    }

    const row = await this.prisma.phoneSignup.findUnique({
      where: { ticketHash: this.hashTicket(input.ticket) },
    });

    if (
      !row ||
      row.userId ||
      !row.verifiedAt ||
      !row.ticketExpiresAt ||
      row.ticketExpiresAt < new Date()
    ) {
      throw new BadRequestException(
        'That sign-up has expired. Start again and we will send a new code.',
      );
    }

    // Checked again here, not only in requestCode: twenty minutes passed, and a
    // number can be verified on another account in that time. The partial unique
    // index is the real guarantee — this is the readable error before it.
    const taken = await this.prisma.user.findFirst({
      where: { phone: row.phone, phoneVerified: true },
      select: { id: true },
    });
    if (taken) {
      throw new BadRequestException(
        'That number now has an account. Sign in with it instead.',
      );
    }

    const now = new Date();
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            // No email and no password: the whole point. The CHECK constraint on
            // `users` is satisfied by the phone, and both can be added later from
            // the account screen.
            email: null,
            passwordHash: null,
            phone: row.phone,
            phoneVerified: true,
            authProvider: 'phone',
            role: input.role,
            fullName: input.fullName.trim(),
            lastLoginAt: now,
            // Opted OUT, against the column default of true.
            //
            // What this person ticked was the Terms, the Privacy Policy and
            // POPIA processing. Marketing is a separate consent under POPIA
            // s.69 and they were not asked for it. There is also no address to
            // market to — so the default costs nothing today and would quietly
            // become an opt-in they never gave the moment they add an email.
            marketingEmails: false,
            ...(input.role === 'LANDLORD'
              ? { landlordProfile: { create: {} } }
              : { tenantProfile: { create: {} } }),
          },
        });

        // Claimed in the same transaction as the account is created, so the
        // ticket cannot be spent twice by two requests arriving together, and
        // the consent cannot end up recorded against no account or an account
        // recorded with no consent.
        const claimed = await tx.phoneSignup.updateMany({
          where: { id: row.id, userId: null },
          data: { userId: created.id, consentAcceptedAt: now },
        });
        if (claimed.count !== 1) {
          throw new BadRequestException('That sign-up has already been completed.');
        }

        return created;
      });

      // Never allowed to fail the sign-up: a bad invite code must not stop
      // somebody joining.
      this.referrals.recordSignup(user.id, input.referralCode).catch(() => {});

      this.logger.log(`Phone signup complete: user ${user.id} (${user.role})`);
      return user;
    } catch (e) {
      // The partial unique index on verified numbers, doing the job the check
      // above cannot do without a lock: two completions for one number, racing.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException(
          'That number now has an account. Sign in with it instead.',
        );
      }
      throw e;
    }
  }

  /**
   * Throws away sign-ups nobody finished.
   *
   * Each one is a mobile number belonging to a person who never became a user,
   * which is the clearest case of data we have no purpose for. Rows that DID
   * become an account are kept — they are that account's consent record — and go
   * when it does, by cascade.
   *
   * Daily, early, in Johannesburg time like every other schedule here.
   */
  @Cron('35 3 * * *', { timeZone: 'Africa/Johannesburg' })
  async pruneAbandoned() {
    const cutoff = new Date(Date.now() - ABANDONED_TTL_HOURS * 60 * 60_000);
    const { count } = await this.prisma.phoneSignup.deleteMany({
      where: { userId: null, createdAt: { lt: cutoff } },
    });
    if (count) this.logger.log(`Pruned ${count} abandoned phone sign-up(s)`);
    return { pruned: count };
  }
}
