/**
 * Seed (or update) the landlord pain-point survey, and nothing else.
 *
 * Same shape and the same reasoning as seed-house-ads.ts: the full seed will
 * not run without ADMIN_EMAIL and ADMIN_PASSWORD and **resets that admin's
 * password** on the way past, which is far too large a side effect for
 * publishing a questionnaire.
 *
 *   npm run seed:survey             # dry run — shows the diff
 *   npm run seed:survey -- --apply  # writes
 *
 * ⚠️ Use the npm script, not `npx ts-node prisma/seed-survey.ts` directly.
 * The script runs `prisma generate` first, and without that a generated
 * client left behind by a pull fails this file with six TypeScript errors
 * that all name THIS file and none of which is about it — see
 * scripts/prisma-client-check.mjs and docs/OUTSTANDING.md §76.
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
import { ALL_SURVEYS, microQuestion, SeedSurvey, SurveyQuestion } from './surveys';

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

  let wrote = 0;
  for (const survey of ALL_SURVEYS) {
    const done = await seedOne(survey, apply);
    if (done === 'refused') {
      process.exitCode = 1;
      return;
    }
    if (done === 'written') wrote += 1;
  }

  /**
   * ⚠️ The count, because this script now writes TWO surveys and the old one
   * wrote one. A run that silently did half the job would look identical to a
   * run that did all of it — the exact failure mode seed-house-ads.ts was
   * rewritten for, where "✅ 3 house ads written" was printed over a wrong
   * advert still live.
   */
  console.log(`\n${ALL_SURVEYS.length} survey(s) checked, ${wrote} written.`);
  if (!apply) console.log('Dry run — nothing written. Re-run with --apply.');
}

/** One survey. Returns what happened, so main() can count and stop. */
async function seedOne(
  survey: SeedSurvey,
  apply: boolean,
): Promise<'written' | 'unchanged' | 'refused'> {
  // Fails loudly rather than shipping a survey whose contextual prompt has
  // nothing to ask, or two things to ask and no way to choose.
  const micro = microQuestion(survey.questions);

  console.log(`\n── ${survey.slug} v${survey.version} (${survey.audience.role}) ──`);

  const existing = await prisma.survey.findUnique({
    where: { slug_version: { slug: survey.slug, version: survey.version } },
    include: { _count: { select: { responses: true } } },
  });

  if (!existing) {
    console.log(`  not present — it would be created.`);
    console.log(`  title:     ${survey.title}`);
    console.log(`  questions: ${survey.questions.length}`);
    console.log(`  micro:     ${micro.id} — "${micro.prompt}"`);
    console.log(`  active:    ${survey.active}`);
    if (!apply) return 'unchanged';
    await prisma.survey.create({
      data: {
        slug: survey.slug,
        version: survey.version,
        title: survey.title,
        intro: survey.intro,
        questions: survey.questions as unknown as Prisma.InputJsonValue,
        audience: survey.audience as unknown as Prisma.InputJsonValue,
        active: survey.active,
      },
    });
    console.log('  ✅ created.');
    return 'written';
  }

  const currentQuestions = existing.questions as unknown as SurveyQuestion[];
  const currentIds = new Set(currentQuestions.map((q) => q.id));
  const nextIds = new Set(survey.questions.map((q) => q.id));
  const disappearing = [...currentIds].filter((id) => !nextIds.has(id));

  /**
   * ⚠️ Still refuses, and now has a better answer to offer.
   *
   * Answers are keyed by question id, so a disappearing id leaves answers
   * that resolve to no question. Before versions existed the only options
   * were "add a question" or "delete the answers". Now the right move is a
   * NEW VERSION: bump `version` in prisma/surveys.ts and the old edition keeps
   * its answers while the new one collects its own.
   */
  if (disappearing.length && existing._count.responses > 0) {
    console.error(
      `  ❌ Refusing to write. ${existing._count.responses} response(s) exist on this edition, and ` +
        `these question ids would disappear: ${disappearing.join(', ')}.\n` +
        '     Answers are keyed by id, so those answers would stop resolving to a question.\n' +
        '     Bump `version` in prisma/surveys.ts to ask the new wording as a new edition.',
    );
    return 'refused';
  }

  const changes: string[] = [];
  if (existing.title !== survey.title) {
    changes.push(`    title\n      now:  ${existing.title}\n      next: ${survey.title}`);
  }
  if (existing.intro !== survey.intro) {
    changes.push(`    intro\n      now:  ${existing.intro ?? '(none)'}\n      next: ${survey.intro}`);
  }
  if (existing.active !== survey.active) {
    changes.push(`    active\n      now:  ${existing.active}\n      next: ${survey.active}`);
  }
  if (canonical(currentQuestions) !== canonical(survey.questions)) {
    changes.push(
      `    questions\n      now:  ${currentQuestions.length} (${[...currentIds].join(', ')})` +
        `\n      next: ${survey.questions.length} (${[...nextIds].join(', ')})`,
    );
  }

  console.log(`  exists, with ${existing._count.responses} response(s).`);
  if (!changes.length) {
    console.log('  ✅ nothing to change — the stored survey already matches.');
    return 'unchanged';
  }

  console.log('  would change:\n' + changes.join('\n'));
  if (!apply) return 'unchanged';

  await prisma.survey.update({
    where: { slug_version: { slug: survey.slug, version: survey.version } },
    data: {
      title: survey.title,
      intro: survey.intro,
      questions: survey.questions as unknown as Prisma.InputJsonValue,
      audience: survey.audience as unknown as Prisma.InputJsonValue,
      active: survey.active,
    },
  });
  console.log('  ✅ updated.');
  return 'written';
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
