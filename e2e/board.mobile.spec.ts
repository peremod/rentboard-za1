import { test, expect } from '@playwright/test';

/**
 * Layout checks at phone width.
 *
 * Most tenants here are on a phone, and several bugs this project hit only
 * appeared at narrow widths — filters stacking so the first room card fell
 * below the fold, checkboxes rendering above their labels.
 */
test.describe('board on a phone', () => {
  test('filters and sort sit on one row, and a room card is above the fold', async ({ page }) => {
    await page.goto('/');

    const filters = page.getByRole('button', { name: /filters/i });
    const sort = page.locator('.sort-select, select').first();
    await expect(filters).toBeVisible();

    const f = await filters.boundingBox();
    const s = await sort.boundingBox();
    expect(f && s, 'filters or sort not rendered').toBeTruthy();

    // Same row: their vertical centres should be within a line of each other.
    const fMid = f!.y + f!.height / 2;
    const sMid = s!.y + s!.height / 2;
    expect(Math.abs(fMid - sMid), 'Filters and Sort are stacked, not side by side').toBeLessThan(24);

    // The first room must be reachable without a long scroll.
    const firstCard = page.locator('app-room-card').first();
    await expect(firstCard).toBeVisible();
    const card = await firstCard.boundingBox();
    expect(card!.y, 'the first room card starts too far down the page').toBeLessThan(900);
  });

  test('an amenity checkbox sits beside its label, not above it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /filters/i }).click();

    const check = page.locator('.filter-check').first();
    await expect(check).toBeVisible();

    const box = check.locator('input[type=checkbox]');
    const boxRect = await box.boundingBox();
    const rowRect = await check.boundingBox();

    // If the input is centred above the text, its centre matches the row's.
    const boxCentre = boxRect!.x + boxRect!.width / 2;
    const rowCentre = rowRect!.x + rowRect!.width / 2;
    expect(Math.abs(boxCentre - rowCentre), 'the checkbox is centred above its label').toBeGreaterThan(20);
  });
});
