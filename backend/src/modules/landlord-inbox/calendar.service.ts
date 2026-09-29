import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LeaseService } from '../tenancies/lease.service';

export type CalendarKind = 'rent_due' | 'lease_ends' | 'notice_expires' | 'room_free';

/** One dated thing. `date` is a plain YYYY-MM-DD — these are days, not instants. */
export interface CalendarEntry {
  date: string;
  kind: CalendarKind;
  title: string;
  detail: string | null;
  tenancyId: string | null;
  roomTitle: string | null;
}

/** YYYY-MM-DD in UTC. Never toISOString on a local-time date — it shifts the day. */
function day(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * One calendar over rent, leases and notice — Phase 5f.
 *
 * ── Dates, not timestamps
 *
 * Every entry is a DAY. "Rent is due on the 1st" is not an instant, and rendering
 * it as one invites a timezone bug where a South African landlord sees the 31st.
 * So dates are built and emitted in UTC as YYYY-MM-DD strings, and nothing here
 * calls `toISOString()` on a locally-constructed Date — which is the exact
 * mistake that produces an off-by-one-day calendar.
 *
 * ── Rent due dates are GENERATED, not stored
 *
 * There is no RentSchedule table. Rent is due on the 1st, which is the market's
 * near-universal convention and is what RentPeriod is already keyed on, so future
 * due dates are computed from the live tenancies rather than written down.
 * Storing them would mean a row per tenancy per month that goes stale the moment
 * a tenancy ends, and a job to clean it up.
 *
 * ── What is deliberately absent
 *
 * Inspection dates. The brief lists them "(if built)" — they are not. There is
 * no inspection model, and inventing an empty category would put a heading on a
 * calendar with nothing under it.
 *
 * The .ics feed is also not built; see the controller for why it needs a decision
 * rather than an afternoon.
 */
@Injectable()
export class CalendarService {
  constructor(
    private prisma: PrismaService,
    private lease: LeaseService,
  ) {}

  /**
   * Everything dated in a window, soonest first.
   *
   * Defaults to 90 days: long enough that a lease ending next quarter is visible,
   * short enough that a landlord with twelve tenancies does not get a wall of
   * generated rent dates.
   */
  async entries(landlordId: string, days = 90): Promise<CalendarEntry[]> {
    const from = new Date();
    const to = new Date();
    to.setUTCDate(to.getUTCDate() + days);

    const [tenancies, upcoming] = await Promise.all([
      this.prisma.tenancy.findMany({
        where: { landlordId, status: 'active' },
        select: {
          id: true, rentCents: true,
          tenant: { select: { fullName: true } },
          room: { select: { title: true } },
        },
      }),
      this.lease.upcoming(landlordId),
    ]);

    const out: CalendarEntry[] = [];

    // Rent, on the 1st of each month in the window.
    for (const t of tenancies) {
      const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
      while (cursor <= to) {
        if (cursor >= new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))) {
          out.push({
            date: day(cursor),
            kind: 'rent_due',
            title: `Rent due — ${t.tenant.fullName}`,
            // Said every time, because a calendar entry that looks like a bill
            // is the place someone would assume we collect it.
            detail: 'Your own record. Mastande does not collect rent.',
            tenancyId: t.id,
            roomTitle: t.room.title,
          });
        }
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    }

    // Leases ending and notice running out — from LeaseService, so the window
    // rule lives in one place. Its rows already say which and why.
    for (const u of upcoming) {
      if (!u.emptiesOn) continue;
      const d = new Date(u.emptiesOn);
      if (d > to) continue;
      out.push({
        date: day(d),
        kind: u.reason === 'notice_given' ? 'notice_expires' : 'lease_ends',
        title:
          u.reason === 'notice_given'
            ? `${u.tenant.fullName} moves out`
            : `${u.tenant.fullName}'s lease ends`,
        detail: u.overdue ? 'This date has already passed.' : null,
        tenancyId: u.tenancyId,
        roomTitle: u.room.title,
      });
      // The day the room is actually free to relist is the thing a landlord
      // plans around, and it is not always the same conversation as the lease
      // ending — so it is its own entry rather than a note on that one.
      out.push({
        date: day(d),
        kind: 'room_free',
        title: `${u.room.title} free to relist`,
        detail: null,
        tenancyId: u.tenancyId,
        roomTitle: u.room.title,
      });
    }

    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
}
