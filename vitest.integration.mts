import { defineConfig } from 'vitest/config';

/**
 * Integration tests: the real Nest app, real guards, a real database.
 *
 * Separate from vitest.config.mts on purpose. The unit suite is pure and
 * runs in under a second with no setup at all; these need a migrated
 * PostgreSQL and boot the whole application per file. Running them together
 * would make `npm run test:backend` — the thing CI runs on every push —
 * depend on a database, and the fast suite would stop being run locally.
 */
export default defineConfig({
  test: {
    name: 'integration',
    root: './backend',
    environment: 'node',
    include: ['test/**/*.int-spec.ts'],
    globalSetup: ['./test/support/global-setup.ts'],
    /**
     * ⚠️ ONE AT A TIME. Every test truncates every table, so two files
     * running concurrently would delete each other's fixtures and fail in
     * ways that look like application bugs. Determinism beats speed here.
     */
    fileParallelism: false,
    // Vitest 4 moved poolOptions to the top level; the nested form is
    // accepted-and-ignored, which is the quiet kind of wrong.
    pool: 'forks',
    maxForks: 1,
    minForks: 1,
    // Booting the Nest app and migrating dominates; the assertions are fast.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
