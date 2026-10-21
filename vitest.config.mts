import { defineConfig } from 'vitest/config';

/**
 * Backend unit tests.
 *
 * ── Why vitest and not jest
 *
 * NestJS ships a jest setup by default, and this project never installed it:
 * `backend/package.json` carried `"test": "echo … && exit 0"`, which CI ran
 * as a step called **Test**. A green tick over nothing.
 *
 * Vitest was chosen over adding that jest setup because vitest was already in
 * this repository — `frontend` runs it through `@angular/build:unit-test`, the
 * supported runner for Angular 21 — so this is one dependency rather than a
 * second ecosystem (jest + ts-jest + @types/jest + a transform config), and
 * one runner to learn for both halves.
 *
 * ── Scope
 *
 * Backend only. The frontend has its own runner, invoked by `ng test`, which
 * builds the app's own tsconfig and test environment; pointing this config at
 * `frontend/src` as well would run those specs a second time under different
 * compilation settings, and the two would disagree the first time one of them
 * was wrong.
 *
 * `environment: 'node'` because none of this touches a DOM: these are pure
 * functions — date rules, money rules, parsers, validators.
 */
export default defineConfig({
  test: {
    name: 'backend',
    root: './backend',
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // Deterministic by construction: no file may reach a network or a
    // database, so there is nothing to wait on and nothing to flake.
    testTimeout: 5_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: '../coverage/backend',
      /**
       * ⚠️ THE DENOMINATOR IS THE WHOLE BACKEND, deliberately, and the
       * headline number is therefore small — about 2%.
       *
       * This comment used to claim the include/exclude limited it to "what
       * the suite actually targets". It did not: controllers and services
       * were counted all along, so the comment described a config that did
       * not exist. Left honest rather than narrowed, because a scope tuned
       * until the percentage looks respectable measures the scope, not the
       * tests.
       *
       * Read it as: this suite covers pure business logic, and pure business
       * logic is a small fraction of a Prisma-coupled API. The useful figure
       * is per-file, printed in the table above the summary — the extracted
       * date and rent rules are near-total, and everything DI-bound is zero
       * because nothing here mocks Prisma yet.
       */
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/dto/**', 'src/main.ts', 'src/**/*.module.ts'],
    },
  },
});
