import { assertTestDatabase } from './test-app';

/**
 * Runs once, before any test file.
 *
 * It exists to make the database guard fire EARLY and loudly. Without it the
 * refusal would happen inside the first test, be reported as that test
 * failing, and read as a broken test rather than as "you pointed this at the
 * wrong database".
 */
export default function setup() {
  const name = assertTestDatabase();
  // eslint-disable-next-line no-console
  console.log(`\n  integration tests → database "${name}" (every table is truncated between tests)\n`);
}
