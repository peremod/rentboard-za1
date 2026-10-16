import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SurveysService } from '../surveys/surveys.service';

/** What kind of thing needs doing. The screen renders per kind; it never guesses. */
export type TenantInboxKind =
  | 'message_unread'
  | 'application_accepted'
  | 'application_shortlisted'
  | 'rent_unrecorded'
  | 'lease_ending'
  | 'notice_given'
  | 'passport_expired'
  | 'passport_expiring'
  | 'viewing_elapsed'
  | 'survey_open';

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
  constructor(
    private prisma: PrismaService,
    private surveys: SurveysService,
  ) {}

  /**
   * Everything waiting on this tenant, most pressing first.
   *
   * Four queries rather than one join: they are over unrelated tables with
   * unrelated shapes. Run concurrently, so the list costs one round trip.
   */
  async inbox(tenantId: string): Promise<{ items: TenantInboxItem[]; counts: Record<TenantInboxKind, number> }> {
    const [applications, viewings, messages, rent, lease, passport, survey] = await Promise.all([
      this.applicationItems(tenantId),
      this.elapsedViewingItems(tenantId),
      this.messageItems(tenantId),
      this.rentItems(tenantId),
      this.leaseItems(tenantId),
      this.passportItems(tenantId),
      this.surveyItems(tenantId),
    ]);

    const items = [...applications, ...viewings, ...messages, ...rent, ...lease, ...passport, ...survey]
      .sort((a, b) => a.urgency - b.urgency);

    const counts = {
      message_unread: 0, application_accepted: 0, application_shortlisted: 0, survey_open: 0,
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
   *
   * ── ⚠️ The tenancy is read, and that is the point of this query
   *
   * An `Application` stays `accepted` for as long as it exists. It does not
   * become "moved in" — the move-in is a `Tenancy`, which Phase 8c finally gave
   * a screen to. So before this, a tenant who had agreed a date, moved in, and
   * confirmed it was STILL shown "You have been accepted — talk to the landlord
   * about moving in" at urgency -2000, which is the top of the list, for the
   * whole duration of the tenancy. Reported in those words: "shouldn't that
   * message be removed because I have already spoken to the landlord and moved
   * in?"
   *
   * This codebase's recurring defect, once more: the lifecycle advanced and the
   * list derived from it did not read the advance.
   *
   *   · pending     → accepting OPENS a tenancy, immediately, so this is the
   *                   state a fresh acceptance is actually in. Two things are
   *                   outstanding and the row says both: agree a date with the
   *                   landlord, and record the day the move happened. The
   *                   action is the one that finishes it.
   *   · active      → they live there. Nothing needs them.
   *   · ended /
   *     cancelled   → over. Nothing needs them.
   *   · no tenancy  → should not happen, because accept opens one in the same
   *                   transaction. Handled rather than assumed: if the open
   *                   ever failed, the acceptance is still news and the
   *                   conversation is still the way forward. NOT given a kind
   *                   of its own — a second kind for a state the product
   *                   cannot reach is a branch nothing would ever exercise,
   *                   which is the fault this file keeps being fixed for.
   */
  private async applicationItems(tenantId: string): Promise<TenantInboxItem[]> {
    const rows = await this.prisma.application.findMany({
      where: { tenantId, status: { in: ['accepted', 'shortlisted'] }, archivedAt: null },
      select: {
        id: true, status: true, decidedAt: true, createdAt: true,
        // ⚠️ `status` on the room, because a shortlist is only news while the
        // room is still taking applicants. See the shortlisted branch below.
        room: { select: { id: true, title: true, locationDisplay: true, status: true } },
        tenancy: { select: { id: true, status: true } },
      },
      orderBy: { decidedAt: 'desc' },
    });

    const out: TenantInboxItem[] = [];
    for (const r of rows) {
      const since = -daysUntil(r.decidedAt ?? r.createdAt);
      if (r.status === 'accepted') {
        const tenancy = r.tenancy;

        // Living there, or finished. Either way this is history, and a list
        // called "needs you" that leads with something needing nothing is a
        // list people stop reading — the same reasoning that keeps a disputed
        // month out of here.
        if (tenancy && tenancy.status !== 'pending') continue;

        const ago = since <= 0 ? 'Accepted today.' : `Accepted ${since} day${since === 1 ? '' : 's'} ago.`;

        out.push({
          kind: 'application_accepted',
          // Ahead of everything. Somebody has offered a person a place to live
          // and is waiting to hear back; a day of silence here can cost them it.
          urgency: -2000,
          title: tenancy
            ? 'You have been accepted — agree a date, then record the day you move in'
            : 'You have been accepted — talk to the landlord about moving in',
          detail: tenancy
            ? `${ago} Agree a date and what you need to bring, then say which day the move happened — ` +
              'that is what starts the rent record. It is a note of what happened, not a payment; ' +
              'Mastande never holds rent or a deposit.'
            : `${ago} Agree a date and what you need to bring.`,
          entityId: tenancy ? tenancy.id : r.id,
          roomTitle: r.room.title,
          daysUntil: -since,
          // The action is the step that FINISHES this, not the one that opens
          // it: the conversation already exists and they can reach it from the
          // row above or from Messages, while nothing else on the dashboard
          // pointed at the panel that ends the row.
          actionLabel: tenancy ? 'Confirm the move' : 'Open the conversation',
          // The lifecycle panel, by its own anchor. Phase 8c mounted it at the
          // top of this dashboard with no id, so there was nothing for a row
          // like this to point at.
          actionPath: tenancy ? '/tenant/dashboard#moving-in-out' : '/account/messages',
        });
        continue;
      }
      /**
       * ⚠️ A SHORTLIST IS ONLY NEWS WHILE THE LETTING IS STILL OPEN.
       *
       * The `accepted` branch above has checked the tenancy since Phase D —
       * `if (tenancy && tenancy.status !== 'pending') continue`. This branch
       * had no state check of any kind: not the tenancy, not the room. So a
       * shortlisted row kept generating "A landlord wants to meet you" after
       * the letting it belonged to was over.
       *
       * Reported from a live dashboard on 14 October, and the contradiction
       * was visible in one screenshot: the card named a room, and lower down
       * the same page listed that room as a PAST letting, while the summary
       * underneath read "None of your applications are still open." Three
       * readers of one row, two of them right.
       *
       * That is the same fault as Phase D itself — `activeApplications()` on
       * the dashboard was taught every finished state and this list was not,
       * so the frontend and the backend disagreed about the word "open".
       *
       * Three reasons a shortlist is no longer news, and the room's own state
       * is the one neither side was reading:
       */
      // 1. They have a tenancy for it. Shortlisting is behind them whatever
      //    happened next — they moved in, or they moved out again.
      if (r.tenancy) continue;

      // 2. The room is not taking applicants. `let` and `reserved` mean
      //    somebody else got it; `deleted`, `paused` and `draft` mean it is
      //    not on the board. Telling somebody a landlord wants to meet them
      //    about a room nobody can have is worse than silence.
      const roomIsOpen = r.room.status === 'active';

      if (!roomIsOpen) {
        // ⚠️ Suppressed, not reworded into a new kind. The honest message —
        // that this room has gone — belongs in the applications list where
        // the row and its state already live, not in a list called "needs
        // you" whose every entry is meant to have an action. A kind with no
        // action is how that list stops being read, which is the fault this
        // file's own header warns about.
        continue;
      }

      out.push({
        kind: 'application_shortlisted' as const,
        urgency: -500,
        title: 'A landlord wants to meet you — message them to set up a viewing',
        detail: `Shortlisted for ${r.room.locationDisplay}.`,
        entityId: r.id,
        roomTitle: r.room.title,
        daysUntil: -since,
        actionLabel: 'Message the landlord',
        actionPath: '/account/messages',
      });
    }
    return out;
  }

  /**
   * The welcome questions, if they are still open — Phase 9a.
   *
   * ⚠️ LAST in the list, always. Everything else here is somebody waiting on
   * this person: a landlord who wants an answer, a month of rent nobody
   * recorded. A questionnaire is not that, and putting it anywhere but the
   * bottom would teach people that this list is where they get asked for
   * favours. It is also the only row here that is about us rather than them,
   * which is exactly why it has to be the quietest thing on the screen.
   */
  private async surveyItems(tenantId: string): Promise<TenantInboxItem[]> {
    const row = await this.surveys.inboxItem(tenantId);
    if (!row) return [];
    return [{
      kind: 'survey_open' as const,
      urgency: 9000,
      title: row.title,
      detail: row.detail,
      entityId: row.slug,
      roomTitle: null,
      daysUntil: null,
      actionLabel: row.actionLabel,
      actionPath: row.actionPath,
    }];
  }

  /**
   * Messages the tenant has not read.
   *
   * One item per conversation rather than per message: three unread messages in
   * one thread is one thing to do. Reads `Message.readAt`, which Phase 7c made
   * real — before that it was a column nothing wrote, so this item could not
   * have existed without counting every message ever sent as unread.
   */
  /**
   * A viewing whose agreed time has passed, that nobody has said anything
   * about — Phase 8n.
   *
   * ⚠️ Derived, not stored. `accepted` + `startsAt` in the past + no outcome.
   * There is no "elapsed" flag on the row and there must not be: the clock
   * already answers that question, and a stored copy of it needs a job to keep
   * it true and goes wrong the first time the job does not run. The same
   * reasoning as an elapsed notice period in Phase G.
   *
   * Before this, a viewing simply stayed `accepted` for ever. The tenant
   * dashboard kept saying "They are coming" about a Saturday three weeks gone,
   * and neither side was ever asked what became of it — so the commonest real
   * answers, "we met another time we agreed ourselves" and "I took another
   * room", were unrecordable and the asking never stopped.
   */
  private async elapsedViewingItems(tenantId: string): Promise<TenantInboxItem[]> {
    const rows = await this.prisma.roomViewing.findMany({
      where: {
        status: 'accepted',
        startsAt: { lt: new Date() },
        outcome: null,
        application: {
          tenantId,
          archivedAt: null,
          // A letting that is over, or an application already closed, is not
          // waiting on anybody. Learned from the shortlist that outlived its
          // letting - see tenant-inbox's applicationItems and §66.
          status: { notIn: ['withdrawn', 'rejected'] },
        },
      },
      select: {
        id: true, startsAt: true, meetingPlace: true,
        application: { select: { id: true, room: { select: { title: true } } } },
      },
      orderBy: { startsAt: 'desc' },
      take: 10,
    });

    return rows.map((v) => {
      const since = -daysUntil(v.startsAt);
      return {
        kind: 'viewing_elapsed' as const,
        // Between an acceptance (-2000) and a shortlist (-500): it is not a
        // decision about somewhere to live, but it is a thing with a date on
        // it that has already gone by.
        urgency: -900,
        title: 'That viewing has been and gone — what happened?',
        detail:
          `You agreed to see ${v.application.room.title} `
          + `${since <= 0 ? 'earlier today' : `${since} day${since === 1 ? '' : 's'} ago`}, `
          + `at ${v.meetingPlace}. Say what happened, or arrange another time.`,
        entityId: v.id,
        roomTitle: v.application.room.title,
        daysUntil: -since,
        actionLabel: 'Say what happened',
        actionPath: '/tenant/dashboard#viewings',
      };
    });
  }

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
          /**
           * ⚠️ Three different situations, not two — Phase G.
           *
           * While the countdown runs, somebody told to leave needs another
           * room, and browsing is the action; a paperwork screen is not. That
           * part was right.
           *
           * Once the date has PASSED, neither of those is the thing. The
           * letting is still recorded as running — this platform does not
           * infer a move-out from a date, because where somebody lives is a
           * record of fact — so the rent record keeps going and the room
           * cannot be relisted until the move-out exists. A tenant who has
           * actually gone can say so themselves: `end()` takes either party,
           * and the lifecycle panel on the rent screen is where it lives.
           *
           * Sending them to browse at that point would leave a letting open
           * behind them, and the next thing they hear about it is a rent
           * reminder for a room they left.
           */
          actionLabel:
            days !== null && days < 0
              ? 'Say you have moved out'
              : byThem
                ? 'Start looking'
                : 'See the details',
          actionPath:
            days !== null && days < 0
              ? '/tenant/rent#moving-in-out'
              : byThem
                ? '/'
                : '/tenant/rent',
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
