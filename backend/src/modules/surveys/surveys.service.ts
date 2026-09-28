import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SurveySource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** One question as stored. Mirrors prisma/surveys.ts — see the note there on ids. */
export interface SurveyQuestion {
  id: string;
  prompt: string;
  kind: 'choice' | 'text';
  options?: string[];
  optionalText?: boolean;
  textLabel?: string;
  micro?: boolean;
}

/** Who a survey is for. Applied server-side; never trusted from the client. */
interface SurveyAudience {
  role?: 'LANDLORD' | 'TENANT';
  minRooms?: number;
}

/** How long a "not now" is honoured. The brief's 30 days. */
const DISMISSAL_DAYS = 30;

/** Question 3's id. Imported shape, but the seed module is not on the API's
 *  import path, so it is asserted against the stored survey instead — see
 *  `segmentKeyFor`, which fails loudly rather than segmenting by nothing. */
const ROOM_COUNT_QUESTION_ID = 'q3_room_count';

@Injectable()
export class SurveysService {
  constructor(private prisma: PrismaService) {}

  /**
   * The survey to show this landlord right now, or null.
   *
   * Null is the normal answer and means "do not ask": no active survey, they
   * have answered, they dismissed it inside the window, or they are not in the
   * audience. The caller renders nothing. A prompt that reappears the moment
   * someone dismisses it is how people learn to click it away without reading.
   */
  async promptFor(userId: string, slug?: string) {
    const landlord = await this.prisma.landlordProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!landlord) return null;

    const survey = await this.prisma.survey.findFirst({
      where: { active: true, ...(slug ? { slug } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    if (!survey) return null;

    const [answered, dismissal] = await Promise.all([
      this.prisma.surveyResponse.findUnique({
        where: {
          surveyId_landlordProfileId: { surveyId: survey.id, landlordProfileId: landlord.id },
        },
        select: { id: true },
      }),
      this.prisma.surveyDismissal.findUnique({
        where: {
          surveyId_landlordProfileId: { surveyId: survey.id, landlordProfileId: landlord.id },
        },
        select: { dismissedAt: true },
      }),
    ]);

    if (answered) return null;

    if (dismissal) {
      const until = new Date(dismissal.dismissedAt);
      until.setDate(until.getDate() + DISMISSAL_DAYS);
      if (until > new Date()) return null;
    }

    if (!(await this.matchesAudience(landlord.id, survey.audience as unknown as SurveyAudience))) {
      return null;
    }

    const questions = survey.questions as unknown as SurveyQuestion[];
    return {
      slug: survey.slug,
      title: survey.title,
      intro: survey.intro,
      questions,
      /** The single question the post-letting prompt asks. Null rather than a
       *  throw: a missing micro question should not take the dashboard down. */
      microQuestion: questions.find((q) => q.micro) ?? null,
    };
  }

  /**
   * Audience filter, evaluated against the database rather than the request.
   *
   * `minRooms` counts rooms the landlord actually has, which is why it cannot
   * be a client-side check: the point of asking "2+ rooms only" is to reach
   * people whose situation the product does not yet know, and a client that
   * decides its own eligibility can be asked to lie about it by anyone.
   */
  private async matchesAudience(landlordProfileId: string, audience: SurveyAudience): Promise<boolean> {
    if (!audience) return true;

    if (audience.minRooms && audience.minRooms > 0) {
      const profile = await this.prisma.landlordProfile.findUnique({
        where: { id: landlordProfileId },
        select: { userId: true },
      });
      if (!profile) return false;
      const rooms = await this.prisma.room.count({ where: { landlordId: profile.userId } });
      if (rooms < audience.minRooms) return false;
    }

    return true;
  }

  /**
   * Record answers.
   *
   * Partial submissions are accepted on purpose. Someone who answers two
   * questions and stops has told us something, and rejecting it to insist on a
   * complete set biases the result toward people with time — which is the
   * opposite of who this survey is trying to hear from.
   *
   * Unknown question ids are dropped rather than stored. They can only come
   * from a stale client or a crafted request, and keeping them would put keys
   * in the aggregate that no question explains.
   */
  async submit(userId: string, slug: string, answers: Record<string, unknown>, source: SurveySource) {
    const landlord = await this.prisma.landlordProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!landlord) throw new BadRequestException('Only a landlord account can answer this survey.');

    const survey = await this.prisma.survey.findUnique({ where: { slug } });
    if (!survey) throw new NotFoundException('No such survey.');
    if (!survey.active) throw new BadRequestException('That survey is closed.');

    const questions = survey.questions as unknown as SurveyQuestion[];
    const known = new Set(questions.map((q) => q.id));
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(answers ?? {})) {
      if (known.has(key)) cleaned[key] = value;
    }

    // Upsert rather than create: the unique constraint already stops a second
    // response, and a 500 from a double-tapped Submit is a worse answer than
    // simply keeping the later one.
    await this.prisma.surveyResponse.upsert({
      where: {
        surveyId_landlordProfileId: { surveyId: survey.id, landlordProfileId: landlord.id },
      },
      update: { answers: cleaned as Prisma.InputJsonValue, source },
      create: {
        surveyId: survey.id,
        landlordProfileId: landlord.id,
        source,
        answers: cleaned as Prisma.InputJsonValue,
      },
    });

    return { recorded: Object.keys(cleaned).length };
  }

  /** "Not now." Honoured for DISMISSAL_DAYS, then asked again. */
  async dismiss(userId: string, slug: string) {
    const landlord = await this.prisma.landlordProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!landlord) throw new BadRequestException('Only a landlord account can dismiss this survey.');

    const survey = await this.prisma.survey.findUnique({ where: { slug }, select: { id: true } });
    if (!survey) throw new NotFoundException('No such survey.');

    await this.prisma.surveyDismissal.upsert({
      where: {
        surveyId_landlordProfileId: { surveyId: survey.id, landlordProfileId: landlord.id },
      },
      update: { dismissedAt: new Date() },
      create: { surveyId: survey.id, landlordProfileId: landlord.id },
    });

    return { askAgainInDays: DISMISSAL_DAYS };
  }

  /**
   * Aggregate for the admin view: counts per option, open text listed,
   * segmented by the room-count question.
   *
   * Never returns who said what. The link to a landlord exists so the same
   * person is not asked twice and so answers can be segmented — not so an
   * individual's opinions can be read back against them.
   */
  async aggregate(slug: string) {
    const survey = await this.prisma.survey.findUnique({ where: { slug } });
    if (!survey) throw new NotFoundException('No such survey.');

    const questions = survey.questions as unknown as SurveyQuestion[];
    const responses = await this.prisma.surveyResponse.findMany({
      where: { surveyId: survey.id },
      select: { answers: true, source: true, landlordProfileId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const segmentKey = this.segmentKeyFor(questions);
    const segments = segmentKey
      ? ['(not answered)', ...(questions.find((q) => q.id === segmentKey)?.options ?? [])]
      : ['everyone'];

    const bySource: Record<string, number> = {};
    for (const r of responses) bySource[r.source] = (bySource[r.source] ?? 0) + 1;

    const perQuestion = questions.map((q) => {
      /** counts[segment][option] */
      const counts: Record<string, Record<string, number>> = {};
      const texts: { segment: string; text: string }[] = [];

      for (const r of responses) {
        const answers = (r.answers ?? {}) as Record<string, unknown>;
        if (!(q.id in answers)) continue;

        const segment = segmentKey
          ? this.readChoice((answers as Record<string, unknown>)[segmentKey]) ?? '(not answered)'
          : 'everyone';

        const raw = answers[q.id];

        if (q.kind === 'text') {
          // A text question's answer IS the string. Reading it with readText,
          // which exists for the { choice, text } pair, returns null for a
          // bare string — so questions 6 and 7, the two open questions the
          // whole survey is really for, would have shown as answered-by-nobody.
          const t = typeof raw === 'string' ? raw.trim() : this.readText(raw);
          if (t) texts.push({ segment, text: t });
          continue;
        }

        const choice = this.readChoice(raw);
        if (choice) {
          counts[segment] ??= {};
          counts[segment][choice] = (counts[segment][choice] ?? 0) + 1;
        }
        // A choice question may also carry free text ("Something else — …").
        const extra = this.readText(raw);
        if (extra) texts.push({ segment, text: extra });
      }

      return {
        id: q.id,
        prompt: q.prompt,
        kind: q.kind,
        options: q.options ?? [],
        counts,
        texts,
        answered: responses.filter((r) => q.id in ((r.answers ?? {}) as Record<string, unknown>)).length,
      };
    });

    return {
      slug: survey.slug,
      title: survey.title,
      active: survey.active,
      responses: responses.length,
      /** Anonymous responses cannot be segmented by room count. Reported rather
       *  than dropped, so a reader knows why the segments may not sum to the
       *  total instead of quietly mistrusting the numbers. */
      anonymous: responses.filter((r) => !r.landlordProfileId).length,
      bySource,
      segmentQuestionId: segmentKey,
      segments,
      questions: perQuestion,
    };
  }

  /**
   * The question to segment by, or null.
   *
   * Returns null rather than guessing when the room-count question is absent,
   * and the admin view says "not segmented" — a table silently segmented by
   * nothing looks exactly like a table where everyone gave the same answer.
   */
  private segmentKeyFor(questions: SurveyQuestion[]): string | null {
    return questions.some((q) => q.id === ROOM_COUNT_QUESTION_ID) ? ROOM_COUNT_QUESTION_ID : null;
  }

  /** An answer is either a bare string, or { choice, text } when it carries both. */
  private readChoice(raw: unknown): string | null {
    if (typeof raw === 'string') return raw || null;
    if (raw && typeof raw === 'object' && 'choice' in raw) {
      const c = (raw as { choice?: unknown }).choice;
      return typeof c === 'string' && c ? c : null;
    }
    return null;
  }

  private readText(raw: unknown): string | null {
    if (typeof raw === 'string') return null;
    if (raw && typeof raw === 'object' && 'text' in raw) {
      const t = (raw as { text?: unknown }).text;
      return typeof t === 'string' && t.trim() ? t.trim() : null;
    }
    return null;
  }
}
