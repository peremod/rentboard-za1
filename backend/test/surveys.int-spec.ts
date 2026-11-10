import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestApp, resetDatabase, resetRateLimits, signUp, signUpAdmin, TestContext,
} from './support/test-app';
import {
  LANDLORD_PAIN_QUESTIONS, LANDLORD_PAIN_SURVEY_SLUG,
} from '../prisma/surveys';

/**
 * Surveys — Phase 9a, and the fourth correction to `docs/API-TESTING.md` §6.
 *
 * ── What is already checked, so this file does not re-check it
 *
 * `scripts/smoke-test.sh` (lines 4437-4540) covers the flow properly, and CI
 * derives ADMIN_TOKEN so the admin section runs rather than being skipped:
 * a part-answered set is accepted, answers MERGE across steps (2 kept), an
 * unfinished set comes back resumable at 2 of 7, a tenant is asked their own
 * survey and gets a 404 on the landlord's, an unknown question id is dropped
 * (`recorded` is 1, not 2), results are refused to a non-admin with 403, and
 * the admin aggregate answers 200 with a `segmentQuestionId`.
 *
 * ── What nothing checked
 *
 * Four guarantees, each written down as a decision and each resting on one
 * line of code that nothing reads back:
 *
 *   1. The aggregate "never returns who said what" (the service's words, and
 *      the controller's). That rests ENTIRELY on the `select` list of one
 *      query. `select: { answers, source, role, completedAt, createdAt }` is
 *      what makes the POPIA claim true; adding `userId`, or a
 *      `user: { select: { fullName: true } }` for context, breaks it in a
 *      payload that still answers 200 with a `segmentQuestionId`, which is
 *      all the smoke suite looks at. §6 is explicit about the stakes: the
 *      open-text answers are things landlords said about their tenants.
 *      The CSV download has the same claim and the same single point of
 *      failure.
 *
 *   2. The newest EDITION is chosen by version, not by when the row was
 *      written — `findForRole` says so, with a warning, because a correction
 *      to edition 2 touches its timestamp.
 *
 *   3. A dismissal is honoured for 30 days AND THEN EXPIRES. Nothing drove
 *      either half; a dismissal that silently became permanent would read as
 *      people losing interest.
 *
 *   4. A finished set is not reopened by a later partial submit.
 *
 * ── And one guarantee that was false
 *
 *   5. `matchesAudience` carries the note that eligibility "cannot be a
 *      client-side check ... a client that decides its own eligibility can be
 *      asked to lie about it by anyone". `promptFor` honoured it. `submit`
 *      never called it, so the audience was enforced on the read path only
 *      and a crafted POST wrote straight past it. Latent today — neither
 *      shipped survey sets `minRooms` — which is exactly why it would have
 *      been found by the first survey that did. Fixed in the service, and the
 *      last test here is the one that fails without the fix.
 */
describe('Surveys — the aggregate, the editions, and the audience', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx?.close();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    await resetRateLimits(ctx);
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /**
   * The landlord survey, seeded here rather than taken from the seed script:
   * `resetDatabase` truncates every table, so each case states the editions
   * it depends on.
   */
  function seedLandlordSurvey(over: {
    version?: number; active?: boolean; title?: string; minRooms?: number;
  } = {}) {
    return ctx.prisma.survey.create({
      data: {
        slug: LANDLORD_PAIN_SURVEY_SLUG,
        version: over.version ?? 1,
        title: over.title ?? 'What is hardest about renting out your rooms?',
        intro: 'Seven short questions.',
        questions: LANDLORD_PAIN_QUESTIONS as unknown as object[],
        audience: { role: 'LANDLORD', ...(over.minRooms ? { minRooms: over.minRooms } : {}) },
        active: over.active ?? true,
      },
    });
  }

  /** A landlord whose name, email and id are all unmistakable in a payload. */
  async function respondent() {
    const landlord = await signUp(ctx, 'LANDLORD');
    await ctx.prisma.user.update({
      where: { id: landlord.userId },
      data: { fullName: 'Nomvula Mthembu-Respondent' },
    });
    return landlord;
  }

  /** Every identifier that must not appear anywhere in an aggregate. */
  const identifiers = (l: { userId: string; email: string }) =>
    [l.userId, l.email, 'Nomvula Mthembu-Respondent'];

  /**
   * A complete set of answers, including the open text that §6 is worried
   * about — the free text is what makes an attributable row dangerous rather
   * than merely wrong.
   */
  const COMPLETE_ANSWERS = {
    q1_find_tenants: { choice: 'Something else', text: 'A sign at the spaza shop' },
    q2_most_stressful: 'Getting rent on time',
    q3_room_count: '2 to 4',
    q4_rent_tracking: 'A notebook',
    q5_scammed: { choice: 'Yes', text: 'He paid one month and then vanished with my gate key' },
    q6_trust: 'If you checked the ID of whoever applies',
    q7_wish: 'One place that shows me who has paid',
  };

  describe('the admin aggregate', () => {
    it('answers with counts and open text and nothing that names the respondent', async () => {
      const survey = await seedLandlordSurvey();
      const landlord = await respondent();
      const admin = await signUpAdmin(ctx);

      await ctx.http().post(`/api/surveys/${survey.slug}/responses`)
        .set(auth(landlord.token))
        .send({ answers: COMPLETE_ANSWERS, source: 'onboarding', complete: true })
        .expect(201);

      const res = await ctx.http().get(`/api/surveys/admin/${survey.slug}/results`)
        .set(auth(admin.token)).expect(200);

      // The aggregate is really reading the response, so a pass below is not
      // "the payload is empty".
      expect(res.body.responses).toBe(1);
      expect(res.body.finished).toBe(1);
      const q5 = res.body.questions.find((q: { id: string }) => q.id === 'q5_scammed');
      expect(q5.counts['2 to 4']).toEqual({ Yes: 1 });
      expect(q5.texts).toEqual([
        { segment: '2 to 4', text: 'He paid one month and then vanished with my gate key' },
      ]);

      /**
       * The POPIA assertion, over the whole serialised payload rather than
       * over the keys this test happens to know about: a respondent could be
       * named anywhere, including inside a nested object a future field adds.
       */
      const serialised = JSON.stringify(res.body);
      for (const id of identifiers(landlord)) {
        expect(serialised, `the aggregate named the respondent (${id})`).not.toContain(id);
      }
    });

    it('returns exactly the aggregate keys, so an added field cannot slip in', async () => {
      const survey = await seedLandlordSurvey();
      const landlord = await respondent();
      const admin = await signUpAdmin(ctx);

      await ctx.http().post(`/api/surveys/${survey.slug}/responses`)
        .set(auth(landlord.token))
        .send({ answers: COMPLETE_ANSWERS, source: 'onboarding', complete: true })
        .expect(201);

      const res = await ctx.http().get(`/api/surveys/admin/${survey.slug}/results`)
        .set(auth(admin.token)).expect(200);

      /**
       * Exact, not a subset — the same reasoning as the column test in
       * `view-counting.int-spec.ts`. `toContain` would pass happily on a
       * payload that had gained a `respondents` array, which is the only
       * failure these two tests exist to catch. A deliberate new field is one
       * line here; a field nobody meant to publish is a POPIA incident.
       */
      expect(Object.keys(res.body).sort()).toEqual([
        'active', 'audienceRole', 'bySource', 'completionRate', 'dismissed',
        'finished', 'questions', 'responses', 'role', 'segmentQuestionId',
        'segments', 'slug', 'started', 'title', 'version',
      ]);

      for (const q of res.body.questions) {
        expect(Object.keys(q).sort()).toEqual([
          'answered', 'counts', 'id', 'kind', 'options', 'prompt', 'texts',
        ]);
      }
      for (const q of res.body.questions) {
        for (const t of q.texts) expect(Object.keys(t).sort()).toEqual(['segment', 'text']);
      }
    });

    it('downloads a CSV of counts and text with no row that carries a person', async () => {
      const survey = await seedLandlordSurvey();
      const landlord = await respondent();
      const admin = await signUpAdmin(ctx);

      await ctx.http().post(`/api/surveys/${survey.slug}/responses`)
        .set(auth(landlord.token))
        .send({ answers: COMPLETE_ANSWERS, source: 'onboarding', complete: true })
        .expect(201);

      const res = await ctx.http().get(`/api/surveys/admin/${survey.slug}/results.csv`)
        .set(auth(admin.token)).expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      // The download carries the open text — it is the point of the export,
      // and without it this test would pass on an empty file.
      expect(res.text).toContain('vanished with my gate key');

      for (const id of identifiers(landlord)) {
        expect(res.text, `the CSV named the respondent (${id})`).not.toContain(id);
      }

      /**
       * And the column list is fixed, for the same reason as the JSON above:
       * a `respondent` or `user_id` column is how "aggregate only" becomes a
       * spreadsheet of who said what.
       */
      const header = res.text.split('\n').find((l) => l.startsWith('question_id'));
      expect(header).toBe('question_id,question,kind,segment,answer,count,answered_total');
    });

    it('counts finished sets only, until an admin asks for the partial ones', async () => {
      const survey = await seedLandlordSurvey();
      const finisher = await signUp(ctx, 'LANDLORD');
      const quitter = await signUp(ctx, 'LANDLORD');
      const admin = await signUpAdmin(ctx);

      await ctx.http().post(`/api/surveys/${survey.slug}/responses`)
        .set(auth(finisher.token))
        .send({ answers: COMPLETE_ANSWERS, source: 'onboarding', complete: true })
        .expect(201);
      await ctx.http().post(`/api/surveys/${survey.slug}/responses`)
        .set(auth(quitter.token))
        .send({ answers: { q2_most_stressful: 'A notebook' }, source: 'onboarding', complete: false })
        .expect(201);

      const closed = await ctx.http().get(`/api/surveys/admin/${survey.slug}/results`)
        .set(auth(admin.token)).expect(200);
      // Two started, one finished: the completion rate is the number that
      // only exists because the two states are distinguishable.
      expect(closed.body.started).toBe(2);
      expect(closed.body.finished).toBe(1);
      expect(closed.body.responses).toBe(1);
      expect(closed.body.completionRate).toBe(50);

      const all = await ctx.http().get(`/api/surveys/admin/${survey.slug}/results?includePartial=true`)
        .set(auth(admin.token)).expect(200);
      expect(all.body.responses).toBe(2);
      // Still 1 of 2 finished — includePartial widens what is counted, it
      // does not change what finishing means.
      expect(all.body.completionRate).toBe(50);
    });
  });

  describe('editions', () => {
    it('serves the highest version, not the row written last', async () => {
      /**
       * Version 2 FIRST, then version 1. So `createdAt desc` and
       * `updatedAt desc` both name the wrong edition, and only ordering by
       * version gets this right. Written this way round on purpose: with 1
       * before 2, an `orderBy: createdAt` regression would pass.
       */
      await seedLandlordSurvey({ version: 2, title: 'Edition two' });
      await seedLandlordSurvey({ version: 1, title: 'Edition one' });
      // And a correction to edition 2 touches its updatedAt as well, which is
      // the case the warning in `findForRole` was written for.
      await ctx.prisma.survey.update({
        where: { slug_version: { slug: LANDLORD_PAIN_SURVEY_SLUG, version: 1 } },
        data: { intro: 'Reworded after edition two shipped.' },
      });

      const landlord = await signUp(ctx, 'LANDLORD');
      const res = await ctx.http().get('/api/surveys/prompt')
        .set(auth(landlord.token)).expect(200);

      expect(res.body.version, `served "${res.body.title}"`).toBe(2);
      expect(res.body.title).toBe('Edition two');
    });

    it('ignores a higher version that is not active', async () => {
      await seedLandlordSurvey({ version: 1, title: 'Edition one', active: true });
      await seedLandlordSurvey({ version: 2, title: 'Edition two, still being written', active: false });

      const landlord = await signUp(ctx, 'LANDLORD');
      const res = await ctx.http().get('/api/surveys/prompt')
        .set(auth(landlord.token)).expect(200);

      // A half-written survey that is live by accident is worse than one
      // nobody can find — the schema comment on `active`.
      expect(res.body.version).toBe(1);
    });
  });

  describe('not now', () => {
    it('stops asking for the window and then asks again', async () => {
      const survey = await seedLandlordSurvey();
      const landlord = await signUp(ctx, 'LANDLORD');

      await ctx.http().post(`/api/surveys/${survey.slug}/dismiss`)
        .set(auth(landlord.token)).send({}).expect(201);

      const quiet = await ctx.http().get('/api/surveys/prompt')
        .set(auth(landlord.token)).expect(200);
      // Null over HTTP is an empty body, not the string "null".
      expect(quiet.body, 'a dismissal was not honoured').toEqual({});

      /**
       * Backdated past the 30-day window rather than waited out. The second
       * half is the half that matters: a dismissal that quietly became
       * permanent looks exactly like people losing interest, and no screen
       * anywhere would say which it was.
       */
      await ctx.prisma.surveyDismissal.updateMany({
        where: { surveyId: survey.id, userId: landlord.userId },
        data: { dismissedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
      });

      const again = await ctx.http().get('/api/surveys/prompt')
        .set(auth(landlord.token)).expect(200);
      expect(again.body.slug, 'a dismissal never expired').toBe(survey.slug);
    });
  });

  describe('a finished set', () => {
    it('is not reopened by a later partial submit', async () => {
      const survey = await seedLandlordSurvey();
      const landlord = await signUp(ctx, 'LANDLORD');

      await ctx.http().post(`/api/surveys/${survey.slug}/responses`)
        .set(auth(landlord.token))
        .send({ answers: COMPLETE_ANSWERS, source: 'onboarding', complete: true })
        .expect(201);

      // A stale tab, or a back button, resubmitting one step with
      // complete:false the way each welcome step does.
      const late = await ctx.http().post(`/api/surveys/${survey.slug}/responses`)
        .set(auth(landlord.token))
        .send({ answers: { q4_rent_tracking: 'A spreadsheet' }, source: 'dashboard', complete: false })
        .expect(201);
      expect(late.body.complete, 'a finished set was reopened').toBe(true);

      const row = await ctx.prisma.surveyResponse.findFirstOrThrow({
        where: { surveyId: survey.id, userId: landlord.userId },
      });
      expect(row.completedAt).not.toBeNull();
      // The late answer is still kept — merging is the rule; what must not
      // change is that the set is finished.
      expect((row.answers as Record<string, unknown>).q4_rent_tracking).toBe('A spreadsheet');

      const after = await ctx.http().get('/api/surveys/prompt')
        .set(auth(landlord.token)).expect(200);
      expect(after.body).toEqual({});
    });
  });

  describe('the audience', () => {
    it('refuses an answer from somebody outside it, not only the prompt', async () => {
      // minRooms, which neither shipped survey sets — and which is the reason
      // `matchesAudience` reads the room count from the database instead of
      // believing the request.
      const survey = await seedLandlordSurvey({ minRooms: 2 });
      const landlord = await signUp(ctx, 'LANDLORD');

      const prompt = await ctx.http().get('/api/surveys/prompt')
        .set(auth(landlord.token)).expect(200);
      expect(prompt.body, 'the read path leaked an out-of-audience survey').toEqual({});

      /**
       * The same request the client would never make, which is the only kind
       * worth checking: the audience is a server-side filter or it is nothing.
       * 404 and not 403 — the same answer a landlord gets for the tenant
       * survey, so the response does not confirm which surveys exist.
       */
      await ctx.http().post(`/api/surveys/${survey.slug}/responses`)
        .set(auth(landlord.token))
        .send({ answers: { q2_most_stressful: 'Getting rent on time' }, source: 'onboarding' })
        .expect(404);

      const stored = await ctx.prisma.surveyResponse.count({ where: { surveyId: survey.id } });
      expect(stored, 'an out-of-audience answer was stored').toBe(0);
    });

    it('accepts the same answer once the person is inside it', async () => {
      const survey = await seedLandlordSurvey({ minRooms: 2 });
      const landlord = await signUp(ctx, 'LANDLORD');

      const property = await ctx.http().post('/api/properties').set(auth(landlord.token)).send({
        name: 'Ext 7 back rooms', city: 'Johannesburg', province: 'Gauteng', suburb: 'Tembisa',
      }).expect(201);
      for (const title of ['Back room one', 'Back room two']) {
        await ctx.http().post('/api/rooms').set(auth(landlord.token)).send({
          title,
          description:
            'A private back room with its own entrance and a separate gate key. ' +
            'Shared kitchen and outside tap. Close to the taxi rank and the clinic.',
          roomType: 'shared_house',
          rentCents: 350000,
          province: 'Gauteng',
          city: 'Johannesburg',
          locationDisplay: 'Tembisa, Johannesburg',
          availableFrom: '2026-06-01',
          propertyId: property.body.id,
        }).expect(201);
      }

      // The counterpart to the test above, and the reason it is here: a guard
      // that refuses everybody is not a guard either.
      await ctx.http().post(`/api/surveys/${survey.slug}/responses`)
        .set(auth(landlord.token))
        .send({ answers: { q2_most_stressful: 'Getting rent on time' }, source: 'onboarding' })
        .expect(201);

      const prompt = await ctx.http().get('/api/surveys/prompt')
        .set(auth(landlord.token)).expect(200);
      // Finished, so nothing is asked again.
      expect(prompt.body).toEqual({});
    });
  });
});
