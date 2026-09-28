/**
 * Seed (or update) the landlord pain-point survey, and nothing else.
 *
 * Same shape and the same reasoning as seed-house-ads.ts: the full seed will
 * not run without ADMIN_EMAIL and ADMIN_PASSWORD and **resets that admin's
 * password** on the way past, which is far too large a side effect for
 * publishing a questionnaire.
 *
 *   npx ts-node prisma/seed-survey.ts           # dry run — shows the diff
 *   npx ts-node prisma/seed-survey.ts --apply   # writes
 *
 * ── The check that matters here
 *
 * Question ids are what collected answers are keyed by. If this script is run
 * after responses exist, and the question set has had an id removed or
 * renamed, those answers stop resolving to a question and the admin view
 * silently counts fewer people than answered. So it refuses to change the
 * questions of a survey that already has responses when an id would
 * disappear, and says which one. Adding a question is always safe and is
 * allowed.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { LANDLORD_PAIN_SURVEY, microQuestion, SurveyQuestion } from './surveys';

const prisma = new PrismaClient();

/**
 * Compare JSON by value, not by the text it happens to serialise to.
 *
 * Postgres jsonb does not preserve object key order, so a question that went
 * in as {id, prompt, kind} can come back as {kind, id, prompt} — identical in
 * every way that matters and a different string. A plain JSON.stringify
 * comparison therefore reported "questions changed" on every single run after
 * the first, which is worse than useless: the one thing this script's dry run
 * is for is telling you the stored copy already matches, and it was saying the
 * opposite. Found by running it twice rather than by reading it.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Say which database this is about to change, before changing anything. */
function describeTarget(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return 'DATABASE_URL is not set';
  try {
    const url = new URL(raw);
    return `${url.hostname}${url.port ? ':' + url.port : ''}${url.pathname}`;
  } catch {
    return 'DATABASE_URL is set but could not be parsed';
  }
}

async function main() {
  const apply = process.argv.includes('--apply');

  console.log(`Database: ${describeTarget()}`);
  console.log(`Mode:     ${apply ? 'WRITE' : 'dry run'}\n`);

  // Fails loudly here rather than shipping a survey whose micro-prompt has
  // nothing to ask, or two things to ask and no way to choose.
  const micro = microQuestion();

  const existing = await prisma.survey.findUnique({
    where: { slug: LANDLORD_PAIN_SURVEY.slug },
    include: { _count: { select: { responses: true } } },
  });

  if (!existing) {
    console.log(`No survey with slug "${LANDLORD_PAIN_SURVEY.slug}" — it would be created.`);
    console.log(`  title:     ${LANDLORD_PAIN_SURVEY.title}`);
    console.log(`  questions: ${LANDLORD_PAIN_SURVEY.questions.length}`);
    console.log(`  micro:     ${micro.id} — "${micro.prompt}"`);
    console.log(`  active:    ${LANDLORD_PAIN_SURVEY.active}`);
    if (apply) {
      await prisma.survey.create({
        data: {
          slug: LANDLORD_PAIN_SURVEY.slug,
          title: LANDLORD_PAIN_SURVEY.title,
          intro: LANDLORD_PAIN_SURVEY.intro,
          questions: LANDLORD_PAIN_SURVEY.questions as unknown as Prisma.InputJsonValue,
          audience: LANDLORD_PAIN_SURVEY.audience as unknown as Prisma.InputJsonValue,
          active: LANDLORD_PAIN_SURVEY.active,
        },
      });
      console.log('\n✅ created.');
    } else {
      console.log('\nDry run — nothing written. Re-run with --apply.');
    }
    return;
  }

  const currentQuestions = existing.questions as unknown as SurveyQuestion[];
  const currentIds = new Set(currentQuestions.map((q) => q.id));
  const nextIds = new Set(LANDLORD_PAIN_SURVEY.questions.map((q) => q.id));
  const disappearing = [...currentIds].filter((id) => !nextIds.has(id));

  if (disappearing.length && existing._count.responses > 0) {
    console.error(
      `❌ Refusing to write. ${existing._count.responses} response(s) already exist, and these ` +
        `question ids would disappear: ${disappearing.join(', ')}.\n` +
        '   Answers are keyed by id, so those answers would stop resolving to a question and\n' +
        '   the admin view would quietly count fewer people than answered. Add a question\n' +
        '   rather than renaming one, or clear the responses deliberately first.',
    );
    process.exitCode = 1;
    return;
  }

  const changes: string[] = [];
  if (existing.title !== LANDLORD_PAIN_SURVEY.title) {
    changes.push(`  title\n    now:  ${existing.title}\n    next: ${LANDLORD_PAIN_SURVEY.title}`);
  }
  if (existing.intro !== LANDLORD_PAIN_SURVEY.intro) {
    changes.push(`  intro\n    now:  ${existing.intro ?? '(none)'}\n    next: ${LANDLORD_PAIN_SURVEY.intro}`);
  }
  if (existing.active !== LANDLORD_PAIN_SURVEY.active) {
    changes.push(`  active\n    now:  ${existing.active}\n    next: ${LANDLORD_PAIN_SURVEY.active}`);
  }
  if (canonical(currentQuestions) !== canonical(LANDLORD_PAIN_SURVEY.questions)) {
    changes.push(
      `  questions\n    now:  ${currentQuestions.length} (${[...currentIds].join(', ')})` +
        `\n    next: ${LANDLORD_PAIN_SURVEY.questions.length} (${[...nextIds].join(', ')})`,
    );
  }

  console.log(`Survey "${existing.slug}" exists, with ${existing._count.responses} response(s).`);
  if (!changes.length) {
    console.log('\n✅ Nothing to change — the stored survey already matches.');
    return;
  }

  console.log('\nWould change:\n' + changes.join('\n'));
  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply.');
    return;
  }

  await prisma.survey.update({
    where: { slug: LANDLORD_PAIN_SURVEY.slug },
    data: {
      title: LANDLORD_PAIN_SURVEY.title,
      intro: LANDLORD_PAIN_SURVEY.intro,
      questions: LANDLORD_PAIN_SURVEY.questions as unknown as Prisma.InputJsonValue,
      audience: LANDLORD_PAIN_SURVEY.audience as unknown as Prisma.InputJsonValue,
      active: LANDLORD_PAIN_SURVEY.active,
    },
  });
  console.log('\n✅ updated.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
