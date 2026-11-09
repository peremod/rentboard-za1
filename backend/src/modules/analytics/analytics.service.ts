import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Events the frontend may report. An allowlist, so a typo or an injected
 *  event name cannot create arbitrary rows. */
export const TRACKED_EVENTS = [
  // Listing wizard — where landlords give up
  'wizard.started', 'wizard.step2_reached', 'wizard.step3_reached',
  'wizard.step4_reached', 'wizard.published', 'wizard.abandoned',
  // Tenant funnel
  'board.filtered', 'board.filters_cleared', 'room.viewed',
  'apply.started', 'apply.submitted',
  // Features we are unsure earn their place
  'alert.saved', 'room.saved', 'search.suggestion_used',
  'referral.shared', 'ad.clicked',
] as const;

export type TrackedEvent = (typeof TRACKED_EVENTS)[number];

/**
 * The only segment values `record()` will store.
 *
 * ⚠️ The schema says this column is "'mobile', 'desktop', or 'all'. Never
 * anything that could identify a person", and until now NOTHING ENFORCED IT.
 * There is no DTO on POST /analytics/event — the body is an inline TypeScript
 * type, which erases at runtime — so the only guard was
 * `segment.length <= 24`, on a PUBLIC, UNAUTHENTICATED endpoint. Twenty-four
 * characters is a phone number, an email prefix, an ID number.
 *
 * Reproduced before fixing, against the real API with no credentials:
 *
 *   POST /api/analytics/event {"event":"wizard.started","segment":"0821234567"}
 *   → 204
 *   select … from ux_counters → wizard.started | 0821234567 | 1
 *
 * The smoke suite said PASS throughout, because it asserts the 204 — which is
 * the same answer a stored event gives.
 *
 * ⚠️ `ad.eligible` is NOT affected and must not be added here: ads.service.ts
 * writes those rows directly rather than through record(), and its levels
 * (national/province/city/suburb) are properties of a campaign, not of a
 * person. This list is what the BROWSER may put in the column, and the
 * browser sends exactly two things.
 */
export const SAFE_SEGMENTS = ['all', 'mobile', 'desktop'] as const;

/**
 * Aggregate UX measurement.
 *
 * Deliberately counts, not journeys. Every method here either increments a
 * daily counter or reads existing business data — nothing stores who did what.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private prisma: PrismaService) {}

  /** Never throws: a failed counter must not affect the page that reported it. */
  async record(event: string, segment?: string) {
    if (!TRACKED_EVENTS.includes(event as TrackedEvent)) return;

    // Date only — an exact timestamp on a rare event narrows it to a person.
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);

    // 'all' rather than null: a nullable column in a compound unique index
    // never collides in Postgres, so the upsert would insert forever instead
    // of incrementing.
    //
    // ⚠️ An ALLOWLIST, not a length limit. The old test was
    // `segment.length <= 24`, which accepted any short string and stored it
    // verbatim — see SAFE_SEGMENTS. Anything unrecognised becomes 'all', the
    // same way an unrecognised EVENT is dropped above: the count is still
    // worth having, the dimension is not worth a person's phone number.
    const safeSegment =
      segment && (SAFE_SEGMENTS as readonly string[]).includes(segment) ? segment : 'all';

    try {
      await this.prisma.uxCounter.upsert({
        where: { event_segment_day: { event, segment: safeSegment, day } },
        create: { event, segment: safeSegment, day, count: 1 },
        update: { count: { increment: 1 } },
      });
    } catch (err) {
      this.logger.debug(`Counter failed for ${event}`);
    }
  }

  /**
   * The listing funnel, from counters.
   *
   * Landlord drop-off is the most valuable thing to know: a landlord who
   * abandons the wizard is a room the board never gets, and they rarely
   * come back to tell you why.
   */
  async getFunnels(days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    since.setUTCHours(0, 0, 0, 0);

    const rows = await this.prisma.uxCounter.groupBy({
      by: ['event'],
      where: { day: { gte: since } },
      _sum: { count: true },
    });

    const total = (event: string) => rows.find((r) => r.event === event)?._sum.count ?? 0;

    const wizard = [
      { step: 'Started', count: total('wizard.started') },
      { step: 'Reached pricing', count: total('wizard.step2_reached') },
      { step: 'Reached preferences', count: total('wizard.step3_reached') },
      { step: 'Reached photos', count: total('wizard.step4_reached') },
      { step: 'Published', count: total('wizard.published') },
    ];

    const applying = [
      { step: 'Viewed a room', count: total('room.viewed') },
      { step: 'Opened the form', count: total('apply.started') },
      { step: 'Applied', count: total('apply.submitted') },
    ];

    return {
      periodDays: days,
      // Percentages relative to the first step, plus the drop from the
      // previous one — the second is what points at the broken screen.
      listingFunnel: this.withRates(wizard),
      applyFunnel: this.withRates(applying),
      featureUse: {
        alertsSaved: total('alert.saved'),
        roomsSaved: total('room.saved'),
        suggestionsUsed: total('search.suggestion_used'),
        referralsShared: total('referral.shared'),
        filtersUsed: total('board.filtered'),
        adClicks: total('ad.clicked'),
      },
    };
  }

  private withRates(steps: { step: string; count: number }[]) {
    const first = steps[0]?.count ?? 0;
    return steps.map((s, i) => {
      const previous = i === 0 ? s.count : steps[i - 1].count;
      return {
        ...s,
        ofStart: first > 0 ? Math.round((s.count / first) * 100) : 0,
        // Where people leave, which is more actionable than the total.
        dropFromPrevious: previous > 0 ? Math.round(((previous - s.count) / previous) * 100) : 0,
      };
    });
  }

  /**
   * Signals drawn purely from business data — no counters, no new collection.
   *
   * These existed the whole time and answer most UX questions on their own:
   * a room with many views and no applications has a listing problem, not a
   * traffic problem.
   */
  async getContentSignals() {
    const [noPhotoRooms, highViewNoApply, staleDrafts, avgPhotos] = await Promise.all([
      this.prisma.room.count({ where: { status: 'active', heroImagePath: null } }),
      this.prisma.room.count({
        where: { status: 'active', viewCount: { gte: 20 }, applicationCount: 0 },
      }),
      this.prisma.room.count({
        where: {
          status: 'draft',
          createdAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.room.aggregate({ where: { status: 'active' }, _avg: { viewCount: true } }),
    ]);

    return {
      // Each of these is a fixable listing problem, not a mystery.
      activeRoomsWithoutPhoto: noPhotoRooms,
      viewedButNeverApplied: highViewNoApply,
      draftsAbandonedOverAWeek: staleDrafts,
      averageViewsPerActiveRoom: Math.round(avgPhotos._avg.viewCount ?? 0),
    };
  }
}
