import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LeaseService } from '../tenancies/lease.service';

/** What kind of thing needs doing. The screen renders per kind; it never guesses. */
export type InboxKind =
  | 'application_waiting'
  | 'lease_ending'
  | 'notice_given'
  | 'rent_unmarked'
  | 'rent_disputed';

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
  constructor(
    private prisma: PrismaService,
    private lease: LeaseService,
  ) {}

  /**
   * Everything waiting on this landlord, most pressing first.
   *
   * Three queries rather than one join: they are over unrelated tables with
   * different shapes, and a single query would need the code to un-merge them
   * anyway. Run concurrently, so the inbox costs one round trip's latency.
   */
  async inbox(landlordId: string): Promise<{ items: InboxItem[]; counts: Record<InboxKind, number> }> {
    const [applications, upcoming, rentGaps] = await Promise.all([
      this.waitingApplications(landlordId),
      this.leaseItems(landlordId),
      this.rentItems(landlordId),
    ]);

    const items = [...applications, ...upcoming, ...rentGaps].sort((a, b) => a.urgency - b.urgency);

    // Counted per kind so the screen can say "3 applicants waiting" in a header
    // without re-deriving it from the list and getting the plural wrong.
    const counts = {
      application_waiting: 0, lease_ending: 0, notice_given: 0,
      rent_unmarked: 0, rent_disputed: 0,
    } as Record<InboxKind, number>;
    for (const i of items) counts[i.kind]++;

    return { items, counts };
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
  private async waitingApplications(landlordId: string): Promise<InboxItem[]> {
    const rows = await this.prisma.application.findMany({
      where: {
        room: { landlordId },
        status: { in: ['pending', 'viewed'] },
        archivedAt: null,
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
      actionLabel: r.reason === 'notice_given' ? 'Get it back on the board' : 'Decide on the lease',
      actionPath: leasePath(r.room.propertyId),
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
