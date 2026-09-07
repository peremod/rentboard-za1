import { test, expect } from '@playwright/test';
import { register, uniqueEmail, gotoAuthed } from './helpers';

/**
 * Editing a live listing must not create a second one.
 *
 * Paging forward through an edit used to call createRoom, leaving the original
 * live and a new draft holding the changes. The landlord saw two listings and
 * their edit apparently saved to drafts.
 */
test.describe('listing wizard', () => {
  test('editing a listing does not duplicate it', async ({ page }) => {
    await register(page, 'landlord', uniqueEmail('e2e-wizard'));

    await gotoAuthed(page, '/landlord/rooms/new');
    const title = `E2E room ${Date.now()}`;

    await page.getByLabel('Room type').selectOption({ index: 1 });
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Description').fill(
      'A bright room in a quiet house, close to transport and shops. Suitable for a working professional.',
    );
    await page.getByRole('button', { name: /next/i }).click();

    await page.getByLabel('Monthly rent (ZAR)').fill('3500');
    await page.getByLabel('Province').selectOption('Gauteng');
    await page.getByLabel('City / suburb').fill('Johannesburg');
    await page.getByLabel('Location display').fill('Braamfontein, Johannesburg');
    await page.getByLabel('Available from').fill('2026-12-01');
    await page.getByRole('button', { name: /next/i }).click();

    // Cancel must exist on every step — it was missing on step 1 for a while.
    await expect(page.getByRole('button', { name: /^cancel$/i })).toBeVisible();

    await page.getByRole('button', { name: /next/i }).click();
    await gotoAuthed(page, '/landlord/dashboard');

    const before = await page.locator('.app-card, app-room-card').count();

    // Re-enter the wizard on the same draft and page forward again.
    await page.getByRole('link', { name: /continue|edit/i }).first().click();
    await page.getByRole('button', { name: /next/i }).click();
    await page.getByRole('button', { name: /next/i }).click();
    await gotoAuthed(page, '/landlord/dashboard');

    const after = await page.locator('.app-card, app-room-card').count();
    expect(after, 'editing created a duplicate listing').toBe(before);
  });
});
