import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SurveySource, UserRole } from '@prisma/client';
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
  /**
   * The survey to show this PERSON right now, with whatever they have already
   * answered — or null.
   *
   * ── What changed, and why it had to
   *
   * This used to open by looking up a landlord profile and returning null
   * without one, which made the whole feature landlord-only at its first line.
   * A tenant survey was not unbuilt; it was unreachable and unstorable.
   *
   * The audience is matched against the USER's role now, and the newest active
   * version of the matching survey wins — editions exist so that rewording a
   * question does not rewrite the meaning of answers already given.
   *
   * ── Null is the normal answer
   *
   * No active survey for this role, they have finished it, or they said not
   * now inside the window. A prompt that reappears the moment somebody
   * dismisses it is how people learn to click it away without reading.
   *
   * ⚠️ A PART-ANSWERED set is NOT null. It comes back with its answers and the
   * step to resume at, because the thing that was missing from this feature is
   * a way to come back to it.
   */
  async promptFor(userId: string, slug?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) return null;

    const survey = await this.findForRole(user.role, slug);
    if (!survey) return null;

    const [response, dismissal] = await Promise.all([
      this.prisma.surveyResponse.findUnique({
        where: { surveyId_userId: { surveyId: survey.id, userId } },
        select: { answers: true, completedAt: true },
      }),
      this.prisma.surveyDismissal.findUnique({
        where: { surveyId_userId: { surveyId: survey.id, userId } },
        select: { dismissedAt: true },
      }),
    ]);

    if (response?.completedAt) return null;

    if (dismissal) {
      const until = new Date(dismissal.dismissedAt);
      until.setDate(until.getDate() + DISMISSAL_DAYS);
      if (until > new Date()) return null;
    }

    if (!(await this.matchesAudience(user.id, survey.audience as unknown as SurveyAudience))) {
      return null;
    }

    const questions = survey.questions as unknown as SurveyQuestion[];
    const answers = (response?.answers ?? {}) as Record<string, unknown>;
    return {
      slug: survey.slug,
      version: survey.version,
      title: survey.title,
      intro: survey.intro,
      questions,
      /** Already given, so the screen can resume rather than start again. */
      answers,
      answered: questions.filter((q) => q.id in answers).length,
      /** The single question the contextual prompt asks. Null rather than a
       *  throw: a missing micro question should not take a dashboard down. */
      microQuestion: questions.find((q) => q.micro) ?? null,
    };
  }

  /**
   * The newest active survey for a role.
   *
   * ⚠️ Ordered by version, not by createdAt. A correction to edition 2 touches
   * its row's timestamp and would otherwise make an older edition the newest
   * thing in the table.
   */
  private async findForRole(role: UserRole, slug?: string) {
    const candidates = await this.prisma.survey.findMany({
      where: { active: true, ...(slug ? { slug } : {}) },
      orderBy: [{ slug: 'asc' }, { version: 'desc' }],
    });
    return candidates.find((c) => {
      const audience = (c.audience ?? {}) as unknown as SurveyAudience;
      return !audience.role || audience.role === role;
    }) ?? null;
  }

  /**
   * Audience filter, evaluated against the database rather than the request.
   *
   * `minRooms` counts rooms the landlord actually has, which is why it cannot
   * be a client-side check: the point of asking "2+ rooms only" is to reach
   * people whose situation the product does not yet know, and a client that
   * decides its own eligibility can be asked to lie about it by anyone.
   */
  private async matchesAudience(userId: string, audience: SurveyAudience): Promise<boolean> {
    if (!audience) return true;

    // ⚠️ minRooms counts rooms the person actually has, read here rather than
    // taken from the request: the whole point of targeting by size is to reach
    // people whose situation the product does not know, so a client that
    // decides its own eligibility can be asked to lie about it.
    if (audience.minRooms && audience.minRooms > 0) {
      const rooms = await this.prisma.room.count({ where: { landlordId: userId } });
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
  async submit(
    userId: string,
    slug: string,
    answers: Record<string, unknown>,
    source: SurveySource,
    { complete = true }: { complete?: boolean } = {},
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new BadRequestException('No such account.');

    const survey = await this.findForRole(user.role, slug);
    if (!survey) throw new NotFoundException('No such survey for this account.');
    if (!survey.active) throw new BadRequestException('That survey is closed.');

    const questions = survey.questions as unknown as SurveyQuestion[];
    const known = new Set(questions.map((q) => q.id));
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(answers ?? {})) {
      if (known.has(key)) cleaned[key] = value;
    }

    /**
     * ⚠️ Answers MERGE, they do not replace.
     *
     * Each step of the welcome questions saves what it has, so a replace would
     * throw away every earlier answer the moment somebody answered question
     * four. A person who leaves halfway through and comes back a week later
     * must find what they already said still there.
     */
    const existing = await this.prisma.surveyResponse.findUnique({
      where: { surveyId_userId: { surveyId: survey.id, userId } },
      select: { answers: true, completedAt: true },
    });
    const merged = { ...((existing?.answers ?? {}) as Record<string, unknown>), ...cleaned };

    const completedAt = complete ? (existing?.completedAt ?? new Date()) : existing?.completedAt ?? null;

    await this.prisma.surveyResponse.upsert({
      where: { surveyId_userId: { surveyId: survey.id, userId } },
      update: { answers: merged as Prisma.InputJsonValue, source, completedAt },
      create: {
        surveyId: survey.id,
        userId,
        // Copied at answer time. An account that changes role later must not
        // silently move its answers into the other group's counts.
        role: user.role,
        source,
        answers: merged as Prisma.InputJsonValue,
        completedAt,
      },
    });

    return {
      recorded: Object.keys(cleaned).length,
      answered: Object.keys(merged).length,
      total: questions.length,
      complete: !!completedAt,
    };
  }

  /** "Not now." Honoured for DISMISSAL_DAYS, then asked again. */
  async dismiss(userId: string, slug: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new BadRequestException('No such account.');

    const survey = await this.findForRole(user.role, slug);
    if (!survey) throw new NotFoundException('No such survey for this account.');

    await this.prisma.surveyDismissal.upsert({
      where: { surveyId_userId: { surveyId: survey.id, userId } },
      update: { dismissedAt: new Date() },
      create: { surveyId: survey.id, userId },
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
  async aggregate(
    slug: string,
    opts: { version?: number; role?: UserRole; from?: Date; to?: Date; includePartial?: boolean } = {},
  ) {
    const survey = opts.version
      ? await this.prisma.survey.findUnique({
          where: { slug_version: { slug, version: opts.version } },
        })
      : await this.prisma.survey.findFirst({ where: { slug }, orderBy: { version: 'desc' } });
    if (!survey) throw new NotFoundException('No such survey.');

    const questions = survey.questions as unknown as SurveyQuestion[];
    /**
     * ⚠️ Finished sets only, unless asked otherwise.
     *
     * A part-answered set is real data, but counting it beside finished ones
     * silently weights the early questions: everybody who started answered
     * question one and only some reached question seven. `includePartial`
     * makes that a deliberate choice with a number beside it, rather than the
     * default nobody can see.
     */
    const responses = await this.prisma.surveyResponse.findMany({
      where: {
        surveyId: survey.id,
        ...(opts.role ? { role: opts.role } : {}),
        ...(opts.includePartial ? {} : { completedAt: { not: null } }),
        ...(opts.from || opts.to
          ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
          : {}),
      },
      select: { answers: true, source: true, role: true, completedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    // The denominator for a completion rate: everyone who started, in the same
    // window and the same role.
    const started = await this.prisma.surveyResponse.count({
      where: {
        surveyId: survey.id,
        ...(opts.role ? { role: opts.role } : {}),
        ...(opts.from || opts.to
          ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
          : {}),
      },
    });
    const finished = await this.prisma.surveyResponse.count({
      where: {
        surveyId: survey.id,
        completedAt: { not: null },
        ...(opts.role ? { role: opts.role } : {}),
        ...(opts.from || opts.to
          ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
          : {}),
      },
    });
    const dismissed = await this.prisma.surveyDismissal.count({ where: { surveyId: survey.id } });

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
      version: survey.version,
      title: survey.title,
      active: survey.active,
      /** Which population this is. Named in the payload so a screen cannot
       *  show landlord and tenant numbers under one heading by accident. */
      audienceRole: ((survey.audience ?? {}) as { role?: string }).role ?? null,
      role: opts.role ?? null,
      responses: responses.length,
      started,
      finished,
      dismissed,
      /** Whole percent, or null when nobody has started — a rate of 0% and
       *  "nobody has been asked yet" are different things. */
      completionRate: started ? Math.round((finished / started) * 100) : null,
      bySource,
      segmentQuestionId: segmentKey,
      segments,
      questions: perQuestion,
    };
  }

  /**
   * The one row either inbox shows for a survey that is still open — 9a.
   *
   * ⚠️ This is what REPLACES the dashboard card. The owner's instruction was
   * that a survey answered at sign-up must not come back as a prompt, and that
   * somebody who skipped needs "the least intrusive way to resume". So: no
   * card, no dialog, no banner — one line in the list of things waiting, which
   * a person already reads top to bottom, and which disappears the moment they
   * finish or say not now.
   *
   * Null for everybody with nothing open, which is the normal answer.
   */
  async inboxItem(userId: string) {
    const prompt = await this.promptFor(userId);
    if (!prompt) return null;

    const part = prompt.answered > 0;
    return {
      slug: prompt.slug,
      answered: prompt.answered,
      total: prompt.questions.length,
      title: part
        ? `Finish the questions you started — ${prompt.answered} of ${prompt.questions.length} done`
        : prompt.title,
      detail: part
        ? 'Your answers are saved. It takes about a minute to finish.'
        : 'A minute of questions, so we build the right things. Every one is optional.',
      actionLabel: part ? 'Finish them' : 'Answer them',
      actionPath: '/welcome',
    };
  }

  /**
   * The aggregate as a CSV.
   *
   * ⚠️ Built from `aggregate()`, not from a second query. Two readers of the
   * same data that each do their own counting is the defect this repository
   * keeps finding — the screen and the download would drift and only the
   * screen gets looked at.
   *
   * One row per option per segment, then the open text. No row carries a
   * person.
   */
  async csv(slug: string, opts: Parameters<SurveysService['aggregate']>[1] = {}) {
    const data = await this.aggregate(slug, opts);
    const esc = (v: unknown) => {
      const t = String(v ?? '');
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const lines: string[] = [];
    lines.push(['survey', 'version', 'audience', 'filtered_role', 'started', 'finished', 'completion_%', 'dismissed']
      .map(esc).join(','));
    lines.push([data.slug, data.version, data.audienceRole ?? 'everyone', data.role ?? 'all',
      data.started, data.finished, data.completionRate ?? '', data.dismissed].map(esc).join(','));
    lines.push('');
    lines.push(['question_id', 'question', 'kind', 'segment', 'answer', 'count', 'answered_total']
      .map(esc).join(','));
    for (const q of data.questions) {
      for (const [segment, counts] of Object.entries(q.counts)) {
        for (const [option, count] of Object.entries(counts)) {
          lines.push([q.id, q.prompt, q.kind, segment, option, count, q.answered].map(esc).join(','));
        }
      }
      for (const t of q.texts) {
        lines.push([q.id, q.prompt, 'text', t.segment, t.text, '', q.answered].map(esc).join(','));
      }
    }
    return lines.join('\n') + '\n';
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
