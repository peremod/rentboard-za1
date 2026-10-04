import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** What kind of thing needs doing. The screen renders per kind; it never guesses. */
export type TenantInboxKind =
  | 'message_unread'
  | 'application_accepted'
  | 'application_shortlisted'
  | 'rent_unrecorded'
  | 'lease_ending'
  | 'notice_given'
  | 'passport_expired'
  | 'passport_expiring';

/**
 * One thing to do, with everything the row needs to be acted on in place.
 *
 * Deliberately the same shape as the landlord's `InboxItem`: both screens
 * render a list of unlike things, and a second shape would mean a second
 * component and a second set of bugs. `actionPath` comes from here rather than
 * being rebuilt in the template, for the reason Phase 7d had to go and fix on
 * the landlord side — a path assembled in a template is a path no check reads.
 */
export interface TenantInboxItem {
  kind: TenantInboxKind;
  /** Sort key. Lower is more urgent. Derived here, never in the browser. */
  urgency: number;
  /** The sentence a tenant reads. Plain English, no enum names, no jargon. */
  title: string;
  detail: string | null;
  entityId: string;
  roomTitle: string | null;
  daysUntil: number | null;
  actionLabel: string;
  actionPath: string;
}

/** Whole days from now until `date`, negative once past. */
function daysUntil(date: Date): number {
  const MS = 24 * 60 * 60 * 1000;
  const now = new Date();
  const a = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const b = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((b - a) / MS);
}

/** The 1st of the current month, which is what a rent period is keyed on. */
function monthStart(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
}

/**
 * One list answering "what needs my attention right now" — for the tenant.
 *
 * ── Why this exists
 *
 * Phase 5a built this for the landlord and Phase 7d asks for the same thing in
 * BOTH portals. The tenant dashboard opened instead with three bare numbers and
 * a congratulation banner, so a tenant with an unread message from a landlord,
 * an acceptance waiting on them and a month their landlord has not recorded saw
 * none of the three until they went looking on separate screens.
 *
 * ── An aggregation layer, deliberately
 *
 * No new tables. Everything here is a read across what already exists, which is
 * the point: the facts were all recorded and none of them was surfaced.
 *
 * ── What is deliberately NOT in here
 *
 * **A disputed month.** The tenant has already said they paid; it is waiting on
 * the landlord, not on them. A list called "needs you" that fills up with things
 * needing nothing is a list people stop reading, which is how the landlord
 * nav's applicants badge stopped being read (Phase 7c).
 *
 * **A review they could leave.** It has its own card on the dashboard, and
 * "you could write a review" is an invitation rather than a task.
 *
 * **Alert matches.** A new room matching a saved search is an opportunity, not
 * an obligation, and it already has its own section.
 */
@Injectable()
export class TenantInboxService {
  constructor(private prisma: PrismaService) {}

  /**
   * Everything waiting on this tenant, most pressing first.
   *
   * Four queries rather than one join: they are over unrelated tables with
   * unrelated shapes. Run concurrently, so the list costs one round trip.
   */
  async inbox(tenantId: string): Promise<{ items: TenantInboxItem[]; counts: Record<TenantInboxKind, number> }> {
    const [applications, messages, rent, lease, passport] = await Promise.all([
      this.applicationItems(tenantId),
      this.messageItems(tenantId),
      this.rentItems(tenantId),
      this.leaseItems(tenantId),
      this.passportItems(tenantId),
    ]);

    const items = [...applications, ...messages, ...rent, ...lease, ...passport]
      .sort((a, b) => a.urgency - b.urgency);

    const counts = {
      message_unread: 0, application_accepted: 0, application_shortlisted: 0,
      rent_unrecorded: 0, lease_ending: 0, notice_given: 0,
      passport_expired: 0, passport_expiring: 0,
    } as Record<TenantInboxKind, number>;
    for (const i of items) counts[i.kind]++;

    return { items, counts };
  }

  /**
   * An acceptance, or a shortlisting — both are the landlord's move landing on
   * the tenant.
   *
   * `pending` and `viewed` are NOT here: those are the tenant waiting on the
   * landlord, which is the opposite of this list. The dashboard's "Your
   * applications" section is where a tenant watches those.
   */
  private async applicationItems(tenantId: string): Promise<TenantInboxItem[]> {
    const rows = await this.prisma.application.findMany({
      where: { tenantId, status: { in: ['accepted', 'shortlisted'] }, archivedAt: null },
      select: {
        id: true, status: true, decidedAt: true, createdAt: true,
        room: { select: { id: true, title: true, locationDisplay: true } },
      },
      orderBy: { decidedAt: 'desc' },
    });

    return rows.map((r) => {
      const since = -daysUntil(r.decidedAt ?? r.createdAt);
      if (r.status === 'accepted') {
        return {
          kind: 'application_accepted' as const,
          // Ahead of everything. Somebody has offered a person a place to live
          // and is waiting to hear back; a day of silence here can cost them it.
          urgency: -2000,
          title: 'You have been accepted — talk to the landlord about moving in',
          detail: since <= 0
            ? 'Accepted today. Agree a date and what you need to bring.'
            : `Accepted ${since} day${since === 1 ? '' : 's'} ago. Agree a date and what you need to bring.`,
          entityId: r.id,
          roomTitle: r.room.title,
          daysUntil: -since,
          actionLabel: 'Open the conversation',
          actionPath: '/account/messages',
        };
      }
      return {
        kind: 'application_shortlisted' as const,
        urgency: -500,
        title: 'A landlord wants to meet you — message them to set up a viewing',
        detail: `Shortlisted for ${r.room.locationDisplay}.`,
        entityId: r.id,
        roomTitle: r.room.title,
        daysUntil: -since,
        actionLabel: 'Message the landlord',
        actionPath: '/account/messages',
      };
    });
  }

  /**
   * Messages the tenant has not read.
   *
   * One item per conversation rather than per message: three unread messages in
   * one thread is one thing to do. Reads `Message.readAt`, which Phase 7c made
   * real — before that it was a column nothing wrote, so this item could not
   * have existed without counting every message ever sent as unread.
   */
  private async messageItems(tenantId: string): Promise<TenantInboxItem[]> {
    const rows = await this.prisma.application.findMany({
      where: {
        tenantId,
        messages: { some: { senderId: { not: tenantId }, readAt: null } },
      },
      select: {
        id: true,
        room: { select: { title: true, landlord: { select: { fullName: true } } } },
        messages: {
          where: { senderId: { not: tenantId }, readAt: null },
          select: { id: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    return rows.map((r) => {
      const unread = r.messages.length;
      const waiting = -daysUntil(r.messages[0].createdAt);
      return {
        kind: 'message_unread' as const,
        // Counts UP with waiting time, so it is negated to sort alongside
        // deadlines where a smaller number is sooner — the same scale the
        // landlord's list uses, so the two cannot drift apart.
        urgency: -1000 - waiting,
        title: `${r.room.landlord.fullName} has written to you`,
        detail: `${unread} unread message${unread === 1 ? '' : 's'}${
          waiting <= 0 ? ', sent today' : `, the newest ${waiting} day${waiting === 1 ? '' : 's'} ago`
        }.`,
        entityId: r.id,
        roomTitle: r.room.title,
        daysUntil: -waiting,
        actionLabel: 'Read it',
        actionPath: '/account/messages',
      };
    });
  }

  /**
   * A month the landlord has not recorded as paid.
   *
   * ⚠️ Worded with care, and the wording is the substance. Mastande does not
   * handle the money and has not checked whether it arrived: the landlord's
   * record is the landlord's record. So this does NOT say "you have not paid" —
   * a tenant who paid in cash on the 1st being told by an app that they are in
   * arrears is exactly the accusation this product must not make. It says what
   * is true, which is that nothing is recorded, and offers the one action that
   * is actually the tenant's: saying so.
   *
   * Only once a month is actually under way, and only on active tenancies — a
   * tenancy that ended in February must not raise an April task.
   */
  private async rentItems(tenantId: string): Promise<TenantInboxItem[]> {
    const start = monthStart();
    const tenancies = await this.prisma.tenancy.findMany({
      where: { tenantId, status: 'active' },
      select: {
        id: true,
        room: { select: { title: true } },
        rentPeriods: {
          where: { periodStart: start },
          select: { id: true, status: true, tenantDisputedAt: true },
        },
      },
    });

    const monthName = start.toLocaleString('en-ZA', { month: 'long', timeZone: 'UTC' });
    const out: TenantInboxItem[] = [];

    for (const t of tenancies) {
      const period = t.rentPeriods[0];
      // Already said. It is the landlord's to answer now, and a list of things
      // needing nothing is a list nobody reads.
      if (period?.tenantDisputedAt) continue;
      if (period && period.status !== 'unpaid') continue;

      out.push({
        kind: 'rent_unrecorded',
        // Mild, like the landlord's own rent item. Rent admin is not a
        // deadline, and putting it above an acceptance would train people to
        // skim the list.
        urgency: 500,
        title: `Your landlord has not recorded ${monthName}'s rent`,
        detail:
          'If you have paid, you can say so — Mastande does not handle the money, ' +
          'so this is their record rather than ours.',
        entityId: t.id,
        roomTitle: t.room.title,
        daysUntil: null,
        actionLabel: 'Open rent',
        actionPath: '/tenant/rent',
      });
    }
    return out;
  }

  /**
   * A lease ending, or notice given.
   *
   * Not reusing `LeaseService.upcoming` — it is scoped to a landlord and its
   * wording is the landlord's ("get the room back on the board"). The RULE is
   * the same shape but the lead window is read from the same constant, so the
   * two sides agree about which tenancies are inside it.
   */
  private async leaseItems(tenantId: string): Promise<TenantInboxItem[]> {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 60);

    const rows = await this.prisma.tenancy.findMany({
      where: {
        tenantId,
        status: { in: ['pending', 'active'] },
        OR: [{ leaseEndDate: { not: null, lte: horizon } }, { noticeGivenAt: { not: null } }],
      },
      select: {
        id: true, leaseEndDate: true, noticeGivenAt: true, noticePeriodDays: true,
        noticeGivenById: true, tenantId: true,
        room: { select: { title: true } },
      },
      orderBy: [{ noticeGivenAt: 'asc' }, { leaseEndDate: 'asc' }],
    });

    return rows.map((t) => {
      const noticeEnds = t.noticeGivenAt
        ? new Date(t.noticeGivenAt.getTime() + t.noticePeriodDays * 86_400_000)
        : null;
      const endsOn = noticeEnds ?? t.leaseEndDate;
      const days = endsOn ? daysUntil(endsOn) : null;
      const byThem = !!t.noticeGivenAt && t.noticeGivenById !== t.tenantId;

      if (t.noticeGivenAt) {
        return {
          kind: 'notice_given' as const,
          urgency: days ?? 999,
          title: byThem
            ? 'Your landlord has given notice — you will need somewhere to go'
            : 'You gave notice on this room',
          detail: days === null
            ? null
            : days < 0
              ? 'That date has already passed.'
              : `You move out in ${days} day${days === 1 ? '' : 's'}.`,
          entityId: t.id,
          roomTitle: t.room.title,
          daysUntil: days,
          // Browsing is the action for somebody who has to move, not a
          // paperwork screen. The one thing they need is another room.
          actionLabel: byThem ? 'Start looking' : 'See the details',
          actionPath: byThem ? '/' : '/tenant/rent',
        };
      }

      return {
        kind: 'lease_ending' as const,
        urgency: days ?? 999,
        title: 'Your lease is coming to an end — ask your landlord what happens next',
        detail: days === null
          ? null
          : days < 0
            ? 'That date has already passed.'
            : `It ends in ${days} day${days === 1 ? '' : 's'}.`,
        entityId: t.id,
        roomTitle: t.room.title,
        daysUntil: days,
        actionLabel: 'Message your landlord',
        actionPath: '/account/messages',
      };
    });
  }

  /**
   * A Renter's Passport that has expired, or is about to.
   *
   * It is free (Phase 1 removed the subscription) and it is the one thing a
   * tenant can do that makes a landlord more likely to pick them, so an expired
   * one quietly costing them applications is worth a line. 30 days' warning,
   * because the checks take a person to review.
   */
  private async passportItems(tenantId: string): Promise<TenantInboxItem[]> {
    const profile = await this.prisma.tenantProfile.findUnique({
      where: { userId: tenantId },
      select: { hasPassport: true, passportExpiresAt: true },
    });
    if (!profile?.hasPassport || !profile.passportExpiresAt) return [];

    const days = daysUntil(profile.passportExpiresAt);
    if (days > 30) return [];

    return [{
      kind: days < 0 ? ('passport_expired' as const) : ('passport_expiring' as const),
      // Not urgent against an acceptance or a move-out date, and not trivial
      // either: it is the difference between being shortlisted and not.
      urgency: days < 0 ? 300 : 400,
      title: days < 0
        ? 'Your Renter’s Passport has run out — landlords no longer see the badge'
        : 'Your Renter’s Passport is about to run out',
      detail: days < 0
        ? 'Renewing it is free and takes one upload.'
        : `It expires in ${days} day${days === 1 ? '' : 's'}. Renewing it is free.`,
      entityId: tenantId,
      roomTitle: null,
      daysUntil: days,
      actionLabel: days < 0 ? 'Renew it' : 'Check it',
      actionPath: '/tenant/passport',
    }];
  }
}
