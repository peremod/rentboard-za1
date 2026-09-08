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
    // .sort-select only. A comma selector with .first() matched the hero's
    // province dropdown, which sits far higher up the page — so the test was
    // measuring the distance to an unrelated element and reporting a layout
    // bug that did not exist.
    const sort = page.locator('.sort-select');
    await expect(filters).toBeVisible();

    const f = await filters.boundingBox();
    const s = await sort.boundingBox();
    expect(f && s, 'filters or sort not rendered').toBeTruthy();

    // Same row: their vertical centres should be within a line of each other.
    const fMid = f!.y + f!.height / 2;
    const sMid = s!.y + s!.height / 2;
    expect(Math.abs(fMid - sMid), 'Filters and Sort are stacked, not side by side').toBeLessThan(24);

    // The hero now occupies exactly one screen on a phone, so the first room
    // should sit roughly one viewport down — one swipe, not the two-plus
    // screens it used to be.
    const firstCard = page.locator('app-room-card').first();
    await expect(firstCard).toBeVisible();
    const card = await firstCard.boundingBox();

    const viewport = page.viewportSize()!.height;
    expect(card!.y, 'the first room should be about one swipe below the hero')
      .toBeLessThan(viewport * 1.9);
  });

  test('the hero fills one screen and offers a way down', async ({ page }) => {
    await page.goto('/');

    const hero = page.locator('.hero');
    const box = await hero.boundingBox();
    const viewport = page.viewportSize()!.height;

    // One screen, not two — and not so short that it stops being a hero.
    expect(box!.height, 'the hero should fill roughly one screen on a phone')
      .toBeGreaterThan(viewport * 0.7);
    expect(box!.height, 'the hero should not exceed one screen')
      .toBeLessThan(viewport * 1.15);

    // A full-screen hero with no cue reads as the entire page.
    await expect(page.locator('.hero-scroll-cue')).toBeVisible();
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
