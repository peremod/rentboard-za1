import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the journeys that matter.
 *
 * Deliberately a small suite. The API smoke test already covers 340-odd
 * assertions and it passed through every UI bug found in the last two weeks —
 * a withdrawn application filed under the wrong heading, a saved phone number
 * that never displayed, a missing FormsModule, checkboxes stacked above their
 * labels. None of those are visible from the API, and all of them are
 * immediately visible in a browser.
 *
 * The aim is the paths where being wrong costs a user something, not coverage.
 */
export default defineConfig({
  testDir: './e2e',
  // Sequential: these share a database, and a landlord accepting in one test
  // while another reads the same board is a false failure waiting to happen.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4200',
    // Only on failure: a trace per test is large and nobody reads the passing ones.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Most South African tenants will be on a phone, and several layout bugs
    // this project has hit only appeared at narrow widths.
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /.*\.mobile\.spec\.ts/ },
  ],
});
