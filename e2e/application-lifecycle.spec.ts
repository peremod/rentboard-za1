import { test, expect } from '@playwright/test';
import { register, login, logout, uniqueEmail, gotoAuthed } from './helpers';

/**
 * The withdraw → re-apply loop.
 *
 * Written because this exact flow was broken in three separate ways that the
 * API suite passed straight through: withdrawing left the application under
 * 'Your applications', re-applying was blocked by the unique constraint, and
 * an older archived row resurfaced under 'Available again' the moment a tenant
 * withdrew — which read as though the withdrawal had moved there.
 *
 * Each assertion below corresponds to one of those.
 */
test.describe('tenant application lifecycle', () => {
  test('withdrawing files under Closed, and re-applying returns it to live', async ({ page }) => {
    const tenant = uniqueEmail('e2e-tenant');
    await register(page, 'tenant', tenant);

    // Apply for whatever is on the board. The seed guarantees at least one room.
    await page.goto('/');
    const firstRoom = page.locator('app-room-card a').first();
    await expect(firstRoom).toBeVisible();
    await firstRoom.click();

    // The apply form is already on the page — there is no step that opens it.
    // My first attempt clicked the submit button to 'open' the form and then
    // clicked it again, racing its own disabled 'Sending…' state.
    await page.getByPlaceholder(/introduce yourself/i).fill(
      'I am interested in this room and can move in at the start of next month.',
    );
    await page.getByRole('button', { name: /apply free/i }).click();
    await expect(page.getByText(/application sent/i)).toBeVisible();

    await gotoAuthed(page, '/tenant/dashboard');
    const live = page.locator('section', { hasText: 'Your applications' });
    await expect(live).toBeVisible();

    // Withdraw it.
    await live.getByRole('button', { name: /withdraw/i }).first().click();
    await page.getByRole('button', { name: /^withdraw$/i }).click();   // dialog

    // It must land in Closed, and NOT in Available again.
    const closed = page.locator('section', { hasText: 'Closed applications' });
    await expect(closed).toBeVisible();
    await expect(closed).toContainText('You withdrew this application');

    const availableAgain = page.locator('section', { hasText: 'Available again' });
    await expect(availableAgain).toHaveCount(0);

    // Re-applying must work, and move it back to live.
    await closed.getByRole('link', { name: /apply again/i }).first().click();
    await page.getByPlaceholder(/introduce yourself/i).fill(
      'I withdrew earlier but I am still interested and would like to be considered.',
    );
    await page.getByRole('button', { name: /apply free/i }).click();
    await expect(page.getByText(/application sent/i)).toBeVisible();

    await gotoAuthed(page, '/tenant/dashboard');
    await expect(page.locator('section', { hasText: 'Your applications' })).toBeVisible();
  });
});
