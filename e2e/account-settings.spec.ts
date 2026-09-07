import { test, expect } from '@playwright/test';
import { register, login, logout, uniqueEmail } from './helpers';

/**
 * A saved phone number must still be there after signing in again.
 *
 * This was broken twice, in two different places, and neither was visible from
 * the API: /auth/me omitted the field, and then the login response omitted it
 * too. Both times the number saved correctly and the form showed nothing,
 * which is indistinguishable from a failed save.
 */
test.describe('account settings', () => {
  test('a saved phone number survives a sign-out and back in', async ({ page }) => {
    const email = uniqueEmail('e2e-settings');
    await register(page, 'landlord', email);

    await page.goto('/account/settings');
    await page.getByLabel('Phone number').fill('0821234567');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText(/saved/i)).toBeVisible();

    // A reload alone was enough to lose it before.
    await page.reload();
    await expect(page.getByLabel('Phone number')).toHaveValue('+27821234567');

    // And signing in fresh is the path that actually broke.
    await logout(page);
    await login(page, email);
    await page.goto('/account/settings');
    await expect(page.getByLabel('Phone number')).toHaveValue('+27821234567');

    // Saving must not be enough to sign in with — verification is separate.
    await expect(page.getByText(/verify this number/i)).toBeVisible();
  });
});
