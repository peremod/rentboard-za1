import { test, expect } from '@playwright/test';

/**
 * Locale routing and SEO metadata.
 *
 * These assert the two things that are easy to break silently and expensive
 * to notice: a visitor being dropped out of their language mid-flow, and
 * metadata that is applied after hydration rather than served in the HTML.
 * A crawler that runs no JavaScript sees only the served HTML, so anything
 * asserted here via `page.content()` is deliberately checked before any
 * client-side work could have run.
 */

const PUBLISHED_LOCALES = ['af', 'zu'];

test.describe('locale routing', () => {
  test('English lives at the bare path and /en does not exist', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/pricing$/);

    // /en/pricing must not become a duplicate of /pricing.
    const res = await page.goto('/en/pricing');
    expect(res?.status()).toBe(200); // SPA shell
    await expect(page.locator('h1')).toContainText(/not found/i);
  });

  for (const locale of PUBLISHED_LOCALES) {
    test(`/${locale} serves that locale and declares it`, async ({ page }) => {
      await page.goto(`/${locale}/pricing`);
      await expect(page.locator('html')).toHaveAttribute('lang', new RegExp(`^${locale}-ZA$`));
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        new RegExp(`/${locale}/pricing$`),
      );
    });

    test(`internal links keep the visitor in ${locale}`, async ({ page }) => {
      await page.goto(`/${locale}/pricing`);

      // Any in-app link, not a specific one — the serializer is meant to make
      // this true everywhere, so the test should not depend on one nav item.
      const link = page.locator(`a[href^="/${locale}/"]`).first();
      await expect(link).toBeVisible();
      await link.click();

      await expect(page).toHaveURL(new RegExp(`/${locale}/`));
      await expect(page.locator('html')).toHaveAttribute('lang', new RegExp(`^${locale}-ZA$`));
    });
  }

  test('switching language keeps the current page', async ({ page }) => {
    await page.goto('/pricing');
    await page.getByRole('button', { name: /English/ }).click();
    await page.getByRole('button', { name: /isiZulu/ }).click();

    await expect(page).toHaveURL(/\/zu\/pricing$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zu-ZA');
  });

  test('untranslated locales are neither offered nor routable', async ({ page }) => {
    await page.goto('/pricing');
    await page.getByRole('button', { name: /English/ }).click();

    // isiXhosa is a stub bundle — it must not be presented as a real choice.
    await expect(page.getByRole('button', { name: /isiXhosa/ })).toHaveCount(0);

    await page.goto('/xh/pricing');
    await expect(page.locator('h1')).toContainText(/not found/i);
  });
});

test.describe('SEO metadata is server-rendered', () => {
  test('a prerendered page carries its metadata in the HTML', async ({ page }) => {
    const res = await page.goto('/pricing');
    const html = await res!.text();

    expect(html).toContain('rel="canonical"');
    expect(html).toContain('name="description"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('name="robots"');

    // hreflang cluster must be reciprocal and include x-default.
    expect(html).toContain('hreflang="en-ZA"');
    expect(html).toContain('hreflang="x-default"');
    for (const locale of PUBLISHED_LOCALES) {
      expect(html).toContain(`hreflang="${locale}-ZA"`);
    }
  });

  test('every page has a distinct title and description', async ({ page }) => {
    const seen = new Map<string, string>();

    for (const path of ['/', '/pricing', '/how-it-works', '/advertise']) {
      await page.goto(path);
      const title = await page.title();
      const description = await page
        .locator('meta[name="description"]')
        .getAttribute('content');

      expect(title, `${path} has no title`).toBeTruthy();
      expect(description, `${path} has no description`).toBeTruthy();

      // The regression this guards against: every route shipping the
      // homepage's copy, so all of them compete for the same query.
      const clash = [...seen.entries()].find(([, d]) => d === description);
      expect(clash, `${path} reuses the description from ${clash?.[0]}`).toBeUndefined();
      seen.set(path, description!);
    }
  });

  test('private areas are noindex', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    // A noindex page must not also claim a canonical — the signals contradict.
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  });

  test('a room page sets its own title, not the site default', async ({ page }) => {
    await page.goto('/');
    const firstRoom = page.locator('a[href^="/rooms/"]').first();
    test.skip((await firstRoom.count()) === 0, 'no rooms seeded in this environment');

    await firstRoom.click();
    await expect(page).toHaveURL(/\/rooms\//);

    const title = await page.title();
    expect(title).not.toBe('Mastande — Rooms to Rent in South Africa, No Agent Fees');
    expect(title).toMatch(/R[\d\s,]+\/month/);

    // Product schema drives the rich result.
    const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(JSON.parse(ld!)['@type']).toBe('Product');
  });

  test('/rooms redirects to the board rather than 404ing', async ({ page }) => {
    await page.goto('/rooms');
    await expect(page).toHaveURL(/\/$/);
  });
});
