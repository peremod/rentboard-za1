import { test, expect } from '@playwright/test';

/**
 * Locale routing and SEO metadata.
 *
 * These assert the two things that are easy to break silently and expensive
 * to notice: a visitor being dropped out of their language mid-flow, and
 * metadata that is applied after hydration rather than served in the HTML.
 * A crawler that runs no JavaScript sees only the served HTML — and
 * `page.content()` is NOT that. It serialises the live DOM, so hydration has
 * already run and has already repaired anything the server got wrong. This
 * docblock used to claim the opposite, and the claim was load-bearing: the
 * locale-content check below passed with the bug it was written for put back,
 * because the browser translated the page a moment after the server served it
 * in English.
 *
 * So anything that must be true of the SERVED bytes uses `request.get()`,
 * which is a plain HTTP fetch with no browser attached. Assertions made
 * through `page` are about the hydrated result, which is a different and also
 * useful thing — just not what a crawler reads.
 */

const PUBLISHED_LOCALES = ['af', 'zu'];

/**
 * One string that must be present and one that must be absent, per locale.
 *
 * Both directions on purpose: "contains some Afrikaans" passes on a page that
 * is half translated, and the failure being fixed here was exactly that shape.
 * The absent string is the English footer heading, which appears on every page
 * in the site — so if it is there, the page was rendered in English.
 */
const LOCALE_MARKERS: Record<string, { present: string; absent: string }> = {
  af: { present: 'Privaatheid (POPIA)', absent: 'Privacy Policy (POPIA)' },
  zu: { present: 'Ubumfihlo (POPIA)', absent: 'Privacy Policy (POPIA)' },
};

test.describe('locale routing', () => {
  test('English lives at the bare path and /en does not exist', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/pricing$/);

    // /en/pricing must not become a duplicate of /pricing.
    //
    // 404, not the 200 this asserted until now. When it was written every
    // unknown URL answered 200 with the not-found page — a soft 404, which
    // keeps the URL in Google's index competing with the real /pricing, and
    // which is the defect v1.73.0's '**' route status fixed. The assertion
    // outlived the bug it described because this spec runs in the CI pass that
    // an earlier failing step had been skipping.
    const res = await page.goto('/en/pricing');
    expect(res?.status()).toBe(404);
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

    /**
     * The check none of these had: that the page is actually IN that language.
     *
     * Everything structural was asserted and correct — the lang attribute, the
     * canonical, the hreflang set, the bundle's completeness — and /af and
     * /af/pricing were served to crawlers as English with lang="af-ZA" on
     * them, because the app initializer fired the bundle load without awaiting
     * it. /zu was translated or not depending on which promise won. A locale
     * page that declares a language it is not written in is worse than no
     * translation at all: it is a promise to Google that the content breaks.
     *
     * Read from page.content() before any client work, so this is the served
     * HTML and not the result of hydration repairing it.
     */
    test(`/${locale} is served IN ${locale}, not just labelled as it`, async ({ request, baseURL }) => {
      const marker = LOCALE_MARKERS[locale];
      for (const path of ['', '/pricing', '/how-it-works']) {
        const res = await request.get(`${baseURL}/${locale}${path}`);
        expect(res.status(), `/${locale}${path}`).toBe(200);
        const html = await res.text();

        expect(html, `/${locale}${path} was served with no ${locale} copy in it`)
          .toContain(marker.present);
        expect(html, `/${locale}${path} was served containing the English "${marker.absent}"`)
          .not.toContain(marker.absent);
        // The label has to match the content. Either alone is a lie to a
        // crawler; together they are a translated page.
        expect(html, `/${locale}${path} does not declare lang="${locale}-ZA"`)
          .toContain(`lang="${locale}-ZA"`);
      }
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

/** The route title for '/', and so the one a room page must not keep. */
const SITE_DEFAULT_TITLE = 'Mastande — Rooms to Rent in South Africa, No Agent Fees';

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

  /**
   * ⚠️ This test was wrong on two counts and almost never ran, so nobody saw.
   *
   * It skips when the board shows no room links — and until §103 the board
   * rendered its rooms and then THREW THEM AWAY, back to skeletons, while the
   * browser re-fetched a page the server had already sent. So the links were
   * usually gone at the moment the locator counted them, and the test skipped.
   * Fixing §103 made the board reliably populated, which un-skipped a test
   * that had been failing all along. Measured on the commit BEFORE that fix:
   * 2 of 3 runs failed, 1 skipped.
   *
   * What it got wrong:
   *
   *   1. It clicked through from the board and read page.title() straight
   *      after toHaveURL. That is a CLIENT-SIDE navigation, so the title is
   *      set once the room has loaded, and the read landed on the route's
   *      default: "Room to rent — Mastande". A race, in a describe block
   *      named "server-rendered", which never rendered on a server at all.
   *   2. It asserted the first ld+json is a Product. The room is a
   *      RealEstateListing and deliberately NOT a Product — scripts/seo-drive.mjs
   *      asserts that in as many words, "a room let monthly is not retail
   *      stock" — and the first block on the page is the site Organization
   *      anyway. Two checks in this repository disagreed, and the one that
   *      ran was right.
   *
   * So it now checks both halves properly: what a crawler is served with no
   * JavaScript at all, and what the app puts there after a click.
   */
  /**
   * ⚠️ @local-api, and the tag is load-bearing. CI runs this FILE against the
   * production build, whose bundle calls api.umastande.co.za — so on that
   * server the board is filled from LIVE PRODUCTION, and this test's outcome
   * depended on whether a free instance that sleeps (§102) happened to be
   * awake. Worse than flaky: when one of those calls fails, errorInterceptor
   * raises an alert dialog over the board, and run 363 failed with
   * "<app-dialog> subtree intercepts pointer events" on the click.
   *
   * A check of this commit must not depend on a third party's uptime, so the
   * workflow runs this one against the DEVELOPMENT build, where the board is
   * the local seeded database, and excludes it from the production pass.
   */
  test('a room page sets its own title, not the site default @local-api', async ({ page, request }) => {
    await page.goto('/');
    const firstRoom = page.locator('a[href^="/rooms/"]').first();
    test.skip((await firstRoom.count()) === 0, 'no rooms seeded in this environment');
    const href = (await firstRoom.getAttribute('href'))!;

    // ── What a crawler gets: the server's own HTML, unexecuted.
    const html = await (await request.get(href)).text();
    // The rand figure carries a non-breaking space, which is &nbsp; in source
    // and \u00a0 once parsed. Decoded first so one regex covers both.
    const ssrTitle = (/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '').replace(/&nbsp;/g, '\u00a0');
    expect(ssrTitle).not.toBe(SITE_DEFAULT_TITLE);
    expect(ssrTitle).toMatch(/R[\d\s,]+\/month/);

    // ── And the listing markup a rich result is built from.
    const types = [...html.matchAll(/"@type":\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(types).toContain('RealEstateListing');
    expect(types).not.toContain('Product');

    // ── And the app sets it too, after a click. toHaveTitle retries, so this
    // asserts the end state rather than racing the fetch that produces it.
    await firstRoom.click();
    await expect(page).toHaveURL(/\/rooms\//);
    await expect(page).not.toHaveTitle(SITE_DEFAULT_TITLE);
    await expect(page).toHaveTitle(/R[\d\s,]+\/month/);
  });

  test('/rooms redirects to the board rather than 404ing', async ({ page }) => {
    await page.goto('/rooms');
    await expect(page).toHaveURL(/\/$/);
  });
});
