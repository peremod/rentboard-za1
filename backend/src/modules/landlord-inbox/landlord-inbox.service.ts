import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SurveysService } from '../surveys/surveys.service';
import { LeaseService } from '../tenancies/lease.service';

/**
 * What kind of thing needs doing. The screen renders per kind; it never guesses.
 *
 * ⚠️ VALUES, not only a type, and the reason is a count that was NaN.
 *
 * `viewing_elapsed` below was added to the union and never added to the
 * hand-written counts object in `inbox()`, so `counts.viewing_elapsed++`
 * incremented `undefined` and this endpoint answered `"viewing_elapsed": null`
 * for every landlord with a viewing that had been and gone. The compiler could
 * not see it because the object was cast `as Record<InboxKind, number>`, and a
 * cast is where type checking stops. The tenant inbox had the identical hole,
 * on the same kind, from the same phase.
 *
 * The counts are built from this array now, so a new kind is counted by
 * existing rather than by being remembered.
 */
export const LANDLORD_INBOX_KINDS = [
  'application_waiting',
  'lease_ending',
  'notice_given',
  'rent_unmarked',
  'rent_disputed',
  'unread_message',
  /**
   * A room marked `let` with nobody in it — a letting ended and it was never
   * put back on the board.
   *
   * ⚠️ This exists because a NOTICE is not a task. `TenanciesService.end`
   * sends `room_needs_relisting` once, and a notice that is read and not acted
   * on is gone. The room then sits `let` indefinitely: off the public board,
   * out of the sitemap, invisible to every tenant, with nothing on any screen
   * saying so. The landlord's only clue was a notification they may have
   * dismissed on a bus.
   *
   * A task list is the right shape for this because it persists until the
   * state changes, which is exactly what "this room is empty and nobody can
   * find it" needs.
   */
  'room_vacant',
  'viewing_elapsed',
  'survey_open',
] as const;

export type InboxKind = (typeof LANDLORD_INBOX_KINDS)[number];

/**
 * One thing to do, with everything the row needs to be acted on in place.
 *
 * `actionPath` and `actionLabel` come from the API rather than being rebuilt in
 * the template, because the inbox is a list of heterogeneous items and a
 * template deciding each one's destination is a template that will get one
 * wrong. `entityId` is what the action operates on.
 */
export interface InboxItem {
  kind: InboxKind;
  /** Sort key. Lower is more urgent. Derived here, never in the browser. */
  urgency: number;
  /** The sentence a landlord reads. Plain English, no jargon, no enum names. */
  title: string;
  /** One line of context under it, or null. */
  detail: string | null;
  entityId: string;
  roomTitle: string | null;
  /** Days until this matters. Negative means already past. Null when undated. */
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
 * One list answering "what needs my attention right now", and one paragraph
 * answering "how is the business doing" — Phase 5a and 5d.
 *
 * ── An aggregation layer, deliberately
 *
 * No new tables. Everything here is a read across what Phases 1–4 already
 * record, which is the whole point: a landlord should not have to visit four
 * screens to discover that an applicant has been waiting five days, a lease ends
 * in a fortnight and nobody has marked March as paid.
 *
 * ── Urgency is computed here, not in the browser
 *
 * Two screens sorting the same list by their own rules is two screens that
 * eventually disagree, and the one a landlord trusts is whichever they saw
 * first. So the API emits `urgency` and the template renders in the order it is
 * given. Lower is more pressing; an overdue item sorts ahead of a future one by
 * carrying a negative day count into the same scale.
 *
 * ── What is NOT in here, and why
 *
 * The brief lists four sources: applications, renewals, unpaid rent, and
 * "unresolved maintenance items (Phase 2 Tier 2)". **There is no maintenance
 * log.** Tier 2 was deliberately not built — the brief gates it on survey data
 * that does not exist yet (see docs/FLOW-AUDIT.md §5.6). So this aggregates the
 * three that exist and does not pretend to a fourth. When a maintenance log
 * lands, it adds a `kind` here and nothing else changes.
 */

/**
 * Where a room's rent lives — Phase 7d. The lease section is below it.
 *
 * ⚠️ Every item in this list used to point at `/landlord/yard#money` or
 * `/landlord/yard#ending-soon`, and Phase 7b turned `/landlord/yard` into a
 * REDIRECT to the properties list. A redirect drops the fragment, so the two
 * most important buttons on the dashboard — "Mark it" on an unpaid month and
 * "Decide on the lease" — landed a landlord on a list of addresses with no
 * explanation. Nothing errored and no check covered it: the nav audit's unit is
 * a route, and these paths are strings in the API rather than links in a
 * template. scripts/nav-audit.mjs now resolves them too.
 *
 * `#ending-soon` was worse than stale — it was an id that existed on no screen
 * at all, so even the un-redirected path could not have worked.
 *
 * 'ungrouped' is a real destination, not a placeholder: a landlord who never
 * grouped their rooms has no property id, and the detail screen now accepts
 * that word for exactly this reason.
 */
function moneyPath(propertyId: string | null | undefined): string {
  return `/landlord/properties/${propertyId ?? 'ungrouped'}#money`;
}

/**
 * The lease section, on the same screen.
 *
 * Two near-identical functions rather than one with a `section` parameter, and
 * that is deliberate: `scripts/nav-audit.mjs` now resolves these paths and
 * checks the fragment against the ids that exist in the app, and it can only do
 * that if the fragment is a literal in the string. A parameterised version
 * emitted `#${section}`, which the audit could only report as unverifiable —
 * and a check that reports "cannot tell" about the exact thing it was written
 * for is a check that will be switched off. Six lines to keep it honest.
 */
function leasePath(propertyId: string | null | undefined): string {
  return `/landlord/properties/${propertyId ?? 'ungrouped'}#ending-soon`;
}

@Injectable()
export class LandlordInboxService {
  private readonly logger = new Logger(LandlordInboxService.name);

  constructor(
    private prisma: PrismaService,
    private lease: LeaseService,
    private surveys: SurveysService,
  ) {}

  /**
   * Everything waiting on this landlord, most pressing first.
   *
   * Three queries rather than one join: they are over unrelated tables with
   * different shapes, and a single query would need the code to un-merge them
   * anyway. Run concurrently, so the inbox costs one round trip's latency.
   */
  async inbox(landlordId: string): Promise<{
    items: InboxItem[];
    counts: Record<InboxKind, number>;
    partial: boolean;
  }> {
    /**
     * ⚠️ Seven independent lists, and `Promise.all` let any one of them take
     * the whole dashboard down.
     *
     * A single bad row in any one section answered the WHOLE endpoint with a
     * 500, and the landlord dashboard calls this on load — so the screen became
     * a "Server error" dialog with nothing behind it. Reported from a phone
     * twice, on both dashboards.
     *
     * These lists are unrelated: an unread message does not depend on a rent
     * period, and a vacant room does not depend on a survey. One failing
     * section is one missing section now, logged by NAME so the next occurrence
     * says which, with `partial` telling the screen that what it shows is
     * incomplete rather than that there is nothing to do.
     */
    const failed: string[] = [];
    const section = async (
      name: string,
      run: () => Promise<InboxItem[]>,
    ): Promise<InboxItem[]> => {
      try {
        return await run();
      } catch (err) {
        failed.push(name);
        this.logger.error(
          `landlord inbox: the "${name}" section failed for landlord ${landlordId} — `
          + 'the rest of the list is served without it',
          err instanceof Error ? err.stack : String(err),
        );
        return [];
      }
    };

    const lists = await Promise.all([
      section('applications', () => this.waitingApplications(landlordId)),
      section('elapsed viewings', () => this.elapsedViewings(landlordId)),
      section('lease', () => this.leaseItems(landlordId)),
      section('rent', () => this.rentItems(landlordId)),
      section('messages', () => this.unreadMessages(landlordId)),
      section('vacant rooms', () => this.vacantRooms(landlordId)),
      section('survey', () => this.surveyItems(landlordId)),
    ]);

    const items = lists.flat().sort((a, b) => a.urgency - b.urgency);

    // Counted per kind so the screen can say "3 applicants waiting" in a header
    // without re-deriving it from the list and getting the plural wrong. Built
    // from LANDLORD_INBOX_KINDS — see the note there for the count that was NaN.
    const counts = Object.fromEntries(
      LANDLORD_INBOX_KINDS.map((k) => [k, 0]),
    ) as Record<InboxKind, number>;
    for (const i of items) counts[i.kind]++;

    return { items, counts, partial: failed.length > 0 };
  }

  /**
   * Applications nobody has answered.
   *
   * `pending` and `viewed` both count as waiting: opening an application is not
   * replying to it, and a landlord who read one four days ago and did nothing is
   * exactly who this list is for. `shortlisted` is excluded — that IS a
   * response, and the applicant has been told.
   *
   * Only the current letting cycle. A relisted room archives its previous
   * applicants, and resurfacing them would ask a landlord to answer people who
   * applied to a room that has since been let and freed twice.
   */
  /**
   * Somebody wrote to you and you have not opened it — Phase 8e.
   *
   * ── Why it belongs HERE and not in a badge of its own
   *
   * The owner's report was "there's no notification that says I have a new
   * message in the dashboard". The obvious answer is a red dot somewhere. This
   * screen already has a ranked list of what needs doing, and its component
   * says a new kind needs no change to it — so an unread message becomes a row
   * beside the applicant who has waited nine days, carrying its own
   * destination, rather than a dot the landlord has to interpret.
   *
   * ⚠️ This is only honest because `Message.readAt` is now written. It sat on
   * the model unwritten from the day messaging shipped — the defect
   * `messages.service.ts` records beside the fix — and an unread count built on
   * it then would have counted every message ever sent, for ever.
   *
   * One row per conversation, not per message: five messages from one person is
   * one thing to do.
   */
  private async unreadMessages(landlordId: string): Promise<InboxItem[]> {
    const grouped = await this.prisma.message.groupBy({
      by: ['applicationId'],
      where: {
        readAt: null,
        // Never your own. Marking your own words unread is meaningless, and it
        // is the same reasoning the read-marking itself uses.
        senderId: { not: landlordId },
        application: { room: { landlordId } },
      },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    if (!grouped.length) return [];

    const applications = await this.prisma.application.findMany({
      where: { id: { in: grouped.map((g) => g.applicationId) } },
      select: {
        id: true,
        room: { select: { id: true, title: true } },
        tenant: { select: { fullName: true } },
      },
    });
    const byId = new Map(applications.map((a) => [a.id, a]));

    return grouped.flatMap((g) => {
      const app = byId.get(g.applicationId);
      if (!app) return [];
      const count = g._count._all;
      const oldest = g._min.createdAt ?? new Date();
      const waitingDays = -daysUntil(oldest);
      return [{
        kind: 'unread_message' as const,
        // Same scale as a waiting applicant: negated waiting time, so a message
        // unanswered for nine days outranks a lease ending in nine.
        urgency: -waitingDays,
        title: `${app.tenant.fullName} sent you ${count === 1 ? 'a message' : `${count} messages`}`,
        detail: waitingDays > 0
          ? `Unanswered for ${waitingDays} ${waitingDays === 1 ? 'day' : 'days'}`
          : 'Came in today',
        entityId: app.id,
        roomTitle: app.room.title,
        daysUntil: null,
        actionLabel: 'Read and reply',
        actionPath: '/account/messages',
      }];
    });
  }

  /**
   * A viewing this landlord arranged whose time has passed, with nothing
   * recorded — Phase 8n. The mirror of the tenant's row.
   *
   * ⚠️ Derived, never stored: `accepted` + `startsAt` in the past + no
   * outcome. See tenant-inbox.service.ts for why there is no "elapsed" flag.
   *
   * Both sides are asked because both sides know different halves of it, and
   * because the two likeliest answers belong to different people: "we met
   * another time" is usually the tenant's to tell, and "it has gone to
   * somebody else" is always the landlord's.
   */
  private async elapsedViewings(landlordId: string): Promise<InboxItem[]> {
    const rows = await this.prisma.roomViewing.findMany({
      where: {
        status: 'accepted',
        startsAt: { lt: new Date() },
        outcome: null,
        application: {
          archivedAt: null,
          status: { notIn: ['withdrawn', 'rejected'] },
          room: { landlordId },
        },
      },
      select: {
        id: true, startsAt: true,
        application: {
          select: { room: { select: { id: true, title: true } }, tenant: { select: { fullName: true } } },
        },
      },
      orderBy: { startsAt: 'desc' },
      take: 10,
    });

    return rows.map((v) => {
      const since = -daysUntil(v.startsAt);
      return {
        kind: 'viewing_elapsed' as const,
        urgency: -900,
        title: `Did ${v.application.tenant.fullName} come and see it?`,
        detail:
          `The viewing was ${since <= 0 ? 'earlier today' : `${since} day${since === 1 ? '' : 's'} ago`}. `
          + 'Say what happened, or offer another time — they are still waiting on you either way.',
        entityId: v.id,
        roomTitle: v.application.room.title,
        daysUntil: -since,
        actionLabel: 'Say what happened',
        actionPath: `/landlord/rooms/${v.application.room.id}/applicants`,
      };
    });
  }

  private async waitingApplications(landlordId: string): Promise<InboxItem[]> {
    const rows = await this.prisma.application.findMany({
      where: {
        status: { in: ['pending', 'viewed'] },
        archivedAt: null,
        /**
         * ⚠️ THE ROOM MUST STILL BE TAKING APPLICANTS.
         *
         * This asked only about the application, so a room that had been let,
         * paused or deleted kept generating "<name> is waiting to hear from
         * you" for every pending applicant on it — a landlord chased to answer
         * people about a room nobody can have, with the only action being
         * "Open the application" on a letting that is closed.
         *
         * The mirror of the tenant-side fault found the same day: a shortlist
         * card survived the letting it belonged to. One row, two readers, and
         * on both sides the reader that was wrong was the one that never asked
         * what state the ROOM was in. See tenant-inbox.service.ts.
         *
         * `active` is the only status on the board — `let` and `reserved` mean
         * somebody else has it, `draft`, `paused` and `deleted` mean it is not
         * published. Those applicants are still in the room's own applicant
         * list, where the room's state is on screen beside them; they are just
         * not a thing the landlord is late on.
         */
        room: { landlordId, status: 'active' },
      },
      select: {
        id: true,
        createdAt: true,
        status: true,
        room: { select: { id: true, title: true } },
        tenant: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((r) => {
      const waitingDays = -daysUntil(r.createdAt);
      return {
        kind: 'application_waiting' as const,
        // Urgency counts UP with waiting time, so it must be negated to sort
        // alongside deadlines, where a smaller number is sooner. An applicant
        // waiting nine days outranks a lease ending in nine.
        urgency: -waitingDays,
        title: `${r.tenant.fullName} is waiting to hear from you`,
        detail:
          waitingDays <= 0
            ? 'Applied today.'
            : `Applied ${waitingDays} day${waitingDays === 1 ? '' : 's'} ago${
                r.status === 'viewed' ? ", and you've seen it" : ''
              }.`,
        entityId: r.id,
        roomTitle: r.room.title,
        daysUntil: -waitingDays,
        actionLabel: 'Open the application',
        actionPath: `/landlord/rooms/${r.room.id}/applicants`,
      };
    });
  }

  /**
   * Leases ending and tenancies under notice.
   *
   * Reuses LeaseService rather than re-querying: it already decides which
   * tenancies are inside the lead window and why, and a second implementation of
   * that rule is a second answer to the same question. See its own header for
   * why the flag is computed per read.
   */
  private async leaseItems(landlordId: string): Promise<InboxItem[]> {
    const rows = await this.lease.upcoming(landlordId);
    return rows.map((r) => ({
      kind: r.reason === 'notice_given' ? ('notice_given' as const) : ('lease_ending' as const),
      // Already-past items sort first by carrying their negative day count.
      urgency: r.daysUntilEmpty ?? 999,
      title:
        r.reason === 'notice_given'
          ? `${r.tenant.fullName} is leaving — get the room back on the board`
          : `${r.tenant.fullName}'s lease is ending — renew it or relist`,
      detail: r.overdue
        ? 'This date has already passed.'
        : r.daysUntilEmpty === null
          ? null
          : `The room frees up in ${r.daysUntilEmpty} day${r.daysUntilEmpty === 1 ? '' : 's'}.`,
      entityId: r.tenancyId,
      roomTitle: r.room.title,
      daysUntil: r.daysUntilEmpty,
      /**
       * ⚠️ Once the date has PASSED the action changes, and this is the whole
       * of Phase G.
       *
       * It used to read "Get it back on the board" and point at the property
       * screen for every notice, overdue or not — and relisting a room with
       * somebody still recorded in it was accepted, put the room on the public
       * board while occupied, archived every open application and bumped
       * `relistCount`. `RoomsService.relist` now refuses, which is right, but
       * a row whose action 400s is its own defect.
       *
       * So: while the countdown is running, relisting is the right thing to be
       * getting ready for. Once it has run out, the step that unblocks
       * everything is recording the move-out — the room cannot go back on the
       * board until it exists, and this platform does not infer one from a
       * date.
       *
       * The anchor is the lifecycle panel, which is where `end()` is reachable
       * from. Phase 8c mounted that panel with no id and a task row pointing at
       * it had nowhere to land; `#moving-in-out` exists for exactly this.
       */
      actionLabel:
        r.reason !== 'notice_given'
          ? 'Decide on the lease'
          : r.overdue
            ? 'Record the move-out'
            : 'Get it back on the board',
      actionPath:
        r.reason === 'notice_given' && r.overdue
          ? '/landlord/dashboard#moving-in-out'
          : leasePath(r.room.propertyId),
    }));
  }

  /**
   * This month's rent: not marked either way, or disputed by the tenant.
   *
   * Two different things, deliberately not merged. An unmarked month is the
   * landlord's own admin — nobody has said anything yet. A disputed month is the
   * tenant saying the landlord's record is wrong, which needs reading rather
   * than clicking, and Mastande has not checked who is right and does not claim
   * to.
   *
   * Only active tenancies, and only the current month. A tenancy that ended in
   * February should not generate an April task.
   */
  /**
   * Rooms that are empty but still marked as let.
   *
   * ── The state this catches
   *
   * Accepting an application sets the room `let`. Ending the tenancy does NOT
   * set it back — deliberately, because `relist()` republishes the room with
   * its old photos at its old price and archives every open application, and
   * that is the landlord's decision rather than a side effect of somebody
   * moving out. So the room waits, correctly, for them to act.
   *
   * What was missing is anything that keeps asking. The Phase C notice fires
   * once; a notice read and not acted on is gone, and the room is then off the
   * board and out of the sitemap with no screen saying so.
   *
   * ── Why `tenancies: none` rather than looking for an ended one
   *
   * `some: { status: 'ended' }` would miss a room marked let by hand through
   * `markLet()` with no tenancy behind it at all — which is a real path, and
   * leaves the room every bit as invisible. The question is not "did a letting
   * end here", it is "is anybody actually in this room". So: no pending and no
   * active tenancy.
   *
   * `paused` and `deleted` are not included. A landlord who paused a room has
   * said something more recent than this, and `pause()` exists precisely so
   * they can stop enquiries without the destructive alternative.
   */
  /**
   * The welcome questions, if they are still open — Phase 9a.
   *
   * ⚠️ LAST, always, and the only row here that is about US rather than about
   * this landlord's rooms. Everything else in this list is somebody waiting
   * on them. The dashboard card this replaces had no such discipline: it sat
   * at the top of the screen every visit, which is what the owner reported.
   */
  private async surveyItems(landlordId: string): Promise<InboxItem[]> {
    const row = await this.surveys.inboxItem(landlordId);
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

  private async vacantRooms(landlordId: string): Promise<InboxItem[]> {
    const rooms = await this.prisma.room.findMany({
      where: {
        landlordId,
        status: 'let',
        tenancies: { none: { status: { in: ['pending', 'active'] } } },
      },
      select: {
        id: true, title: true, propertyId: true, letAt: true,
        tenancies: {
          where: { status: 'ended' },
          orderBy: { endDate: 'desc' },
          take: 1,
          select: { endDate: true, tenant: { select: { fullName: true } } },
        },
      },
    });

    const DAY = 24 * 60 * 60 * 1000;
    return rooms.map((room) => {
      const last = room.tenancies[0];
      const since = last?.endDate ?? room.letAt;
      const days = since ? Math.floor((Date.now() - since.getTime()) / DAY) : null;

      return {
        kind: 'room_vacant' as const,
        /**
         * Between a lease ending and rent admin, and it gets MORE urgent the
         * longer it sits — which is the opposite of how the dated items work
         * and is right: an empty room is lost rent every day, and a room that
         * has been invisible for a month is a worse problem than one empty
         * since yesterday.
         *
         * Floored at 300 so it can never outrank a tenant disputing their rent
         * record (-1000) or an application nobody has answered.
         */
        urgency: Math.max(300, 450 - (days ?? 0) * 5),
        title: `"${room.title}" is empty and not listed`,
        detail:
          (last
            ? `${last.tenant.fullName} moved out${days !== null ? ` ${days} day${days === 1 ? '' : 's'} ago` : ''}. `
            : 'It is marked as let, but nobody is in it. ') +
          'Nobody can find it or apply while it is off the board.',
        entityId: room.id,
        roomTitle: room.title,
        daysUntil: null,
        actionLabel: 'Put it back on the board',
        actionPath: room.propertyId
          ? `/landlord/properties/${room.propertyId}`
          : '/landlord/dashboard',
      };
    });
  }

  private async rentItems(landlordId: string): Promise<InboxItem[]> {
    const start = monthStart();
    const tenancies = await this.prisma.tenancy.findMany({
      where: { landlordId, status: 'active' },
      select: {
        id: true,
        tenant: { select: { fullName: true } },
        room: { select: { title: true, propertyId: true } },
        rentPeriods: {
          where: { periodStart: start },
          select: { id: true, status: true, tenantDisputedAt: true, tenantNote: true },
        },
      },
    });

    const monthName = start.toLocaleString('en-ZA', { month: 'long', timeZone: 'UTC' });
    const out: InboxItem[] = [];

    for (const t of tenancies) {
      const period = t.rentPeriods[0];

      // A tenant disputing takes precedence: it is the one that needs a person
      // to read something rather than press a button.
      if (period?.tenantDisputedAt) {
        out.push({
          kind: 'rent_disputed',
          // Ahead of everything dated: somebody is telling you your record is
          // wrong, and every day it stands unread is a day of bad feeling.
          urgency: -1000,
          title: `${t.tenant.fullName} says they have paid ${monthName}`,
          detail: period.tenantNote ? `They added: “${period.tenantNote}”` : 'They added no note.',
          entityId: t.id,
          roomTitle: t.room.title,
          daysUntil: null,
          actionLabel: 'Look at the month',
          actionPath: moneyPath(t.room.propertyId),
        });
        continue;
      }

      // Unmarked, or explicitly unpaid — both are "this is not settled".
      if (!period || period.status === 'unpaid') {
        out.push({
          kind: 'rent_unmarked',
          // Mild. Rent admin is not a deadline, and putting it above a lease
          // ending next week would train people to ignore the whole list.
          urgency: 500,
          title: period
            ? `${t.tenant.fullName} has not paid ${monthName} yet`
            : `${monthName}'s rent is not recorded for ${t.tenant.fullName}`,
          detail: 'Mastande does not handle the money — this is your own record of it.',
          entityId: t.id,
          roomTitle: t.room.title,
          daysUntil: null,
          actionLabel: 'Mark it',
          actionPath: moneyPath(t.room.propertyId),
        });
      }
    }
    return out;
  }

  /**
   * Phase 5d — how the business is doing, as a paragraph rather than a gauge.
   *
   * ── Why sentences and not numbers
   *
   * The brief asks for "a readable sentence/card, not a raw numeric dashboard",
   * and the reason is not decoration: "occupancy 66.7%" invites a landlord with
   * three rooms to think something has been measured, when what happened is that
   * one room is empty. So every figure here ships with its denominator, and
   * anything computed from too little data says so instead of rounding a guess
   * into a percentage.
   *
   * ── Every number states what it is FROM
   *
   * `daysToFill` is from rooms that actually filled. `paymentReliability` is
   * from months actually marked. A landlord who has marked nothing has no
   * reliability rate — not 0%, which reads as "my tenants never pay".
   */
  async health(landlordId: string) {
    const [rooms, filled, periods] = await Promise.all([
      this.prisma.room.findMany({
        where: { landlordId, status: { not: 'deleted' } },
        select: { status: true },
      }),
      // Rooms that went from published to let, which is the only pair of dates
      // that can answer "how long does a room take to fill".
      this.prisma.room.findMany({
        where: { landlordId, letAt: { not: null }, publishedAt: { not: null } },
        select: { publishedAt: true, letAt: true },
      }),
      this.prisma.rentPeriod.findMany({
        where: { tenancy: { landlordId } },
        select: { status: true },
      }),
    ]);

    const live = rooms.filter((r) => r.status !== 'draft');
    const occupied = rooms.filter((r) => r.status === 'let' || r.status === 'reserved').length;
    const vacant = rooms.filter((r) => r.status === 'active').length;

    const fillDays = filled
      .map((r) => Math.round((r.letAt!.getTime() - r.publishedAt!.getTime()) / 86_400_000))
      // A negative span means the dates were set out of order by a backfill or a
      // manual correction; it is not a zero-day let and must not drag the mean
      // down as if it were.
      .filter((d) => d >= 0);
    const avgFill = fillDays.length
      ? Math.round(fillDays.reduce((a, b) => a + b, 0) / fillDays.length)
      : null;

    // `waived` is excluded from both sides: the landlord chose not to collect it,
    // so counting it as unpaid would make a kindness look like a bad tenant, and
    // counting it as paid would overstate what arrived.
    const counted = periods.filter((p) => p.status !== 'waived');
    const paid = counted.filter((p) => p.status === 'paid').length;
    const reliability = counted.length >= 3 ? Math.round((paid / counted.length) * 100) : null;

    return {
      rooms: { total: rooms.length, live: live.length, occupied, vacant },
      /** Of LIVE rooms, not of all rooms — a draft is not a vacancy. */
      occupancyPct: live.length ? Math.round((occupied / live.length) * 100) : null,
      daysToFill: avgFill,
      /** How many lettings the average is from, so the reader can judge it. */
      daysToFillFrom: fillDays.length,
      paymentReliabilityPct: reliability,
      paymentReliabilityFrom: counted.length,
      /**
       * The whole thing as one plain-English paragraph, built here rather than in
       * the template — the wording has to change with the data (singular/plural,
       * "not enough yet" vs a figure) and that logic belongs next to the numbers
       * it describes, not spread across an Angular template.
       */
      summary: this.summarise({
        total: rooms.length, live: live.length, occupied, vacant,
        avgFill, fillCount: fillDays.length, reliability, countedPeriods: counted.length,
      }),
    };
  }

  /** The paragraph. Honest about small numbers rather than smoothing them. */
  private summarise(d: {
    total: number; live: number; occupied: number; vacant: number;
    avgFill: number | null; fillCount: number;
    reliability: number | null; countedPeriods: number;
  }): string {
    if (d.total === 0) return 'You have not posted a room yet. When you do, this is where it will be summed up.';

    const parts: string[] = [];

    // Counts, not a percentage, at these volumes. "67% occupancy" across three
    // rooms sounds like a measurement; "two of your three rooms are taken" is
    // the same fact without the false precision.
    if (d.live === 0) {
      parts.push(`You have ${d.total} room${d.total === 1 ? '' : 's'}, none of them live yet.`);
    } else if (d.vacant === 0) {
      parts.push(`All ${d.live} of your live room${d.live === 1 ? '' : 's'} ${d.live === 1 ? 'is' : 'are'} taken.`);
    } else {
      parts.push(
        `${d.occupied} of your ${d.live} live room${d.live === 1 ? '' : 's'} ${d.occupied === 1 ? 'is' : 'are'} taken, ` +
        `and ${d.vacant} ${d.vacant === 1 ? 'is' : 'are'} looking for someone.`,
      );
    }

    if (d.avgFill !== null && d.fillCount >= 2) {
      parts.push(`A room takes about ${d.avgFill} day${d.avgFill === 1 ? '' : 's'} to fill, across the ${d.fillCount} you have let.`);
    } else if (d.fillCount === 1) {
      parts.push(`Your one letting so far took ${d.avgFill} day${d.avgFill === 1 ? '' : 's'} — too few to call that an average.`);
    }

    if (d.reliability !== null) {
      parts.push(
        d.reliability === 100
          ? `Every one of the ${d.countedPeriods} months you have recorded was paid.`
          : `${d.reliability}% of the ${d.countedPeriods} months you have recorded were paid.`,
      );
    } else if (d.countedPeriods > 0) {
      parts.push(`You have recorded ${d.countedPeriods} month${d.countedPeriods === 1 ? '' : 's'} of rent — not enough yet to say anything about how reliably it arrives.`);
    }

    return parts.join(' ');
  }
}
