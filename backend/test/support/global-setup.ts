import { PrismaClient } from '@prisma/client';
import { assertTestDatabase } from './test-app';

/**
 * A number, not a name: Postgres advisory locks are keyed on a bigint. Any
 * constant does, as long as both runs choose the same one.
 */
const SUITE_LOCK = 8_123_457_001;

/**
 * Runs once, before any test file.
 *
 * It exists to make the database guard fire EARLY and loudly. Without it the
 * refusal would happen inside the first test, be reported as that test
 * failing, and read as a broken test rather than as "you pointed this at the
 * wrong database".
 *
 * ⚠️ And to refuse a SECOND concurrent run, which is the same defect pointed
 * at a different target. These tests truncate every table between cases, so
 * two runs sharing one database delete each other's fixtures mid-test. It
 * happened: a background run and a foreground run of the same suite produced
 * **40 failures across four files** — missing applications, missing
 * tenancies, 404s on rows that had just been created — and every one of them
 * read as a product bug. Run alone, the same commit was 137 passed.
 *
 * `fileParallelism: false` does not cover this. It serialises files within one
 * vitest process and says nothing about a second process.
 *
 * A session-level advisory lock, taken without waiting: it is released when
 * this connection closes, so a crashed run does not leave the suite wedged,
 * and the refusal names the cause rather than letting it surface forty tests
 * later as nonsense.
 */
export default async function setup() {
  const name = assertTestDatabase();

  const prisma = new PrismaClient();
  const [{ locked }] = await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${SUITE_LOCK}::bigint) AS locked
  `;
  if (!locked) {
    await prisma.$disconnect();
    throw new Error(
      `Another integration run already holds "${name}".\n` +
        'These tests truncate every table between cases, so two runs sharing one\n' +
        'database delete each other\'s fixtures and the failures look like product\n' +
        'bugs. Wait for the other run to finish, or point this one at its own database.',
    );
  }

  // eslint-disable-next-line no-console
  console.log(`\n  integration tests → database "${name}" (every table is truncated between tests)\n`);

  // Teardown: vitest calls the returned function when the run ends. Releasing
  // the lock explicitly rather than relying on the socket closing, so a
  // long-lived pooled connection cannot hold it past the run.
  return async () => {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${SUITE_LOCK}::bigint)`;
    await prisma.$disconnect();
  };
}
