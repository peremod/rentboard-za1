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
     * 🔴 The harness supplies this, because `backend/.env` is not in the repo.
     *
     * `SITE_URL` is required at boot — `seo.controller.ts` throws by name
     * without it, and every deployment target sets it. Locally the file
     * provides it, so the first integration test to fetch `/sitemap.xml`
     * passed here and failed in CI with four 500s: CI's integration step sets
     * DATABASE_URL, DIRECT_URL, JWT_SECRET and NODE_ENV and nothing else, and
     * there is no `.env` on a runner. Added in §106 after exactly that run.
     *
     * It belongs here rather than in the workflow so the suite is
     * self-sufficient wherever it runs — a test that needs an untracked file
     * to pass is a test that only its author can run.
     *
     * ⚠️ The value matters to the assertions as little as possible: the
     * sitemap cases match on the room id and the storefront slug, never on
     * the host, so a different origin here cannot make them pass wrongly.
     * Anything else the app demands at boot comes from the npm script, and
     * the next variable like this one will fail the same way — in CI, not
     * here — unless it is added alongside.
     */
    env: {
      SITE_URL: 'http://localhost:4200',
    },
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
