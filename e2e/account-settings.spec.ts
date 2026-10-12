import { test, expect } from '@playwright/test';
import { register, login, logout, uniqueEmail, gotoAuthed } from './helpers';
import { WHATSAPP_ENABLED } from '../frontend/src/app/core/config/feature-flags';

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

    await gotoAuthed(page, '/account/settings');
    await page.getByLabel('Phone number').fill('0821234567');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText(/saved/i)).toBeVisible();

    // A reload alone was enough to lose it before.
    await page.reload();
    await expect(page.getByLabel('Phone number')).toHaveValue('+27821234567');

    // And signing in fresh is the path that actually broke.
    await logout(page);
    await login(page, email);
    await gotoAuthed(page, '/account/settings');
    await expect(page.getByLabel('Phone number')).toHaveValue('+27821234567');

    // Saving must not be enough to sign in with — verification is separate.
    // The screen says so in both flag states; only the button is gated, because
    // requestPhoneVerification sends the code over WhatsApp and the API refuses
    // with a 503 while the channel is off. Asserting the sentence keeps this
    // able to fail: if a save ever marked the number verified, the screen would
    // show the "✅ Verified" branch instead and this would not match.
    await expect(page.getByText(/not verified/i)).toBeVisible();
    await expect(page.getByText(/✅ Verified/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /verify this number/i }))
      .toHaveCount(WHATSAPP_ENABLED ? 1 : 0);
  });
});
