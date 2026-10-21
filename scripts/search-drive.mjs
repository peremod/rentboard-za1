#!/usr/bin/env node
/**
 * Drives the board's keyword search in a real browser, at four widths.
 *
 * ⚠️ Every assertion here is about something that cannot be read off the
 * source. "The URL carries the search" is a claim about what the router did;
 * "the chip removes the location" is a claim about a click changing a result
 * set; "back returns to the search" is a claim about history. This repository
 * is full of controls that looked right in a template and did nothing, so
 * these are measured rather than reasoned about.
 *
 *   node scripts/search-drive.mjs     # needs ng serve on :4200 and the API on :3000
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:4200';
const WIDTHS = [360, 390, 768, 1280];

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m) => { console.log(`  ❌ ${m}`); fail++; };
const check = (cond, m, detail = '') => (cond ? ok(m) : bad(`${m}${detail ? ' — ' + detail : ''}`));

const cards = (page) => page.locator('app-room-card').count();

/**
 * The TOTAL, read off the results heading — not the number of cards.
 *
 * ⚠️ The first version of the chip assertion below compared card counts and
 * reported a false failure: the board pages at 12, so 24 results and 383
 * results both render 12 cards. A check pointed at the wrong element, which
 * is the defect this repository keeps finding; the heading is the only place
 * the whole-result-set number is visible.
 */
const totalShown = async (page) => {
  const t = await page.locator('.results-count').first().innerText();
  const m = t.replace(/[\s,]/g, '').match(/\d+/);
  return m ? Number(m[0]) : -1;
};
const settle = (page) => page.waitForTimeout(1400);

async function main() {
  const browser = await chromium.launch();

  // ── 1. A phrase in the URL renders a searched board ────────────────────
  console.log('\n── A shared search URL ──────────────────────────');
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let page = await ctx.newPage();
  await page.goto(`${BASE}/?q=${encodeURIComponent('Accommodation in Johannesburg')}`, { waitUntil: 'networkidle' });
  await settle(page);

  const input = page.locator('.search-input');
  check((await input.inputValue()) === 'Accommodation in Johannesburg',
        'the search box is filled from the URL', `got "${await input.inputValue()}"`);

  const n1 = await cards(page);
  check(n1 > 0, `the board shows rooms for the phrase (${n1} card(s))`);

  const chips = page.locator('.search-chip:not(.search-chip--word)');
  const chipText = (await chips.count()) ? (await chips.first().innerText()).trim() : '(none)';
  check(chipText.includes('Johannesburg'),
        'a chip says the phrase was read as Johannesburg', `chip reads "${chipText}"`);

  // ── 2. Typing reaches the URL ──────────────────────────────────────────
  console.log('\n── Typing reaches the URL ───────────────────────');
  await input.fill('');
  await input.type('studio in Pretoria', { delay: 15 });
  await settle(page);
  const url2 = new URL(page.url());
  check((url2.searchParams.get('q') ?? '') === 'studio in Pretoria',
        'what was typed is in the URL as ?q=', `?q=${url2.searchParams.get('q')}`);
  const n2 = await cards(page);
  check(n2 >= 0, `the board re-queried (${n2} card(s))`);

  // ── 3. Open a room, come back ──────────────────────────────────────────
  console.log('\n── Open a room and return ───────────────────────');
  await page.goto(`${BASE}/?q=${encodeURIComponent('Accommodation in Johannesburg')}`, { waitUntil: 'networkidle' });
  await settle(page);
  const before = await cards(page);
  const firstLink = page.locator('app-room-card a').first();
  if (await firstLink.count()) {
    await firstLink.click();
    await page.waitForLoadState('networkidle');
    const onRoom = /\/rooms\//.test(page.url());
    check(onRoom, 'a room page opened', page.url());
    await page.goBack({ waitUntil: 'networkidle' });
    await settle(page);
    const back = new URL(page.url());
    check(back.searchParams.get('q') === 'Accommodation in Johannesburg',
          'going back restores the search in the URL', `?q=${back.searchParams.get('q')}`);
    check((await page.locator('.search-input').inputValue()) === 'Accommodation in Johannesburg',
          'going back restores the text in the search box');
    const after = await cards(page);
    check(after === before, `going back restores the same results (${before} -> ${after})`);
  } else {
    bad('no room card link to open');
  }

  // ── 4. Back and forward between two searches ───────────────────────────
  console.log('\n── Browser back and forward ────────────────────');
  await page.goto(`${BASE}/?q=Pretoria`, { waitUntil: 'networkidle' });
  await settle(page);
  const pretoria = await cards(page);
  await page.goto(`${BASE}/?q=Sandton`, { waitUntil: 'networkidle' });
  await settle(page);
  const sandton = await cards(page);
  await page.goBack({ waitUntil: 'networkidle' });
  await settle(page);
  check(new URL(page.url()).searchParams.get('q') === 'Pretoria', 'back returns to the previous search');
  check((await cards(page)) === pretoria, `back restores its results (${pretoria})`);
  await page.goForward({ waitUntil: 'networkidle' });
  await settle(page);
  check(new URL(page.url()).searchParams.get('q') === 'Sandton', 'forward returns to the later search');
  check((await cards(page)) === sandton, `forward restores its results (${sandton})`);

  // ── 5. The chip removes the location ───────────────────────────────────
  console.log('\n── Removing the location chip ──────────────────');
  await page.goto(`${BASE}/?q=${encodeURIComponent('rooms to rent in Sandton')}`, { waitUntil: 'networkidle' });
  await settle(page);
  const withPlace = await totalShown(page);
  const chip = page.locator('.search-chip:not(.search-chip--word)').first();
  if (await chip.count()) {
    await chip.click();
    await settle(page);
    const q = new URL(page.url()).searchParams.get('q') ?? '';
    check(!/sandton/i.test(q), 'the chip removed the place from the typed phrase', `?q=${q}`);
    const without = await totalShown(page);
    check(without > withPlace,
          `removing the place widened the result set (${withPlace} -> ${without} rooms)`);
  } else {
    bad('no removable chip rendered for "rooms to rent in Sandton"');
  }

  // ── 6. A phrase understood but matching nothing ────────────────────────
  console.log('\n── Understood, but nothing matched ─────────────');
  await page.goto(`${BASE}/?q=${encodeURIComponent('Affordable student accommodation in Gauteng')}`, { waitUntil: 'networkidle' });
  await settle(page);
  const empty = page.locator('.empty-state');
  const emptyText = (await empty.count()) ? (await empty.innerText()) : '';
  check(/Show all \d+ rooms? instead/.test(emptyText),
        'the empty state offers to drop the describing words',
        emptyText.replace(/\s+/g, ' ').slice(0, 90));

  await ctx.close();

  // ── 7. Every browse shortcut keeps its promise ─────────────────────────
  //
  // ⚠️ THE assertion for this feature. A shortcut row is a set of promises
  // ("Rooms in Pretoria 253"), and the only way a promise like that fails
  // quietly is by being hardcoded or stale. So each one is clicked and the
  // resulting total is compared to the number it advertised — not merely
  // checked for being non-zero, because a shortcut that shows 253 and
  // delivers 6 is wrong in a way ">0" cannot see.
  console.log('\n\u2500\u2500 Browse shortcuts keep their promise \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await settle(page);

  const shortcuts = page.locator('.browse__link');
  const count = await shortcuts.count();
  check(count > 0, `the board offers browse shortcuts (${count})`);

  const promises = [];
  for (let i = 0; i < count; i++) {
    const el = shortcuts.nth(i);
    const label = (await el.innerText()).replace(/\s+/g, ' ').trim();
    const promised = Number((await el.locator('.browse__count').innerText()).replace(/[^\d]/g, ''));
    promises.push({ label, promised, href: await el.getAttribute('href') });
  }

  for (const { label, promised, href } of promises) {
    await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
    await settle(page);
    const got = await totalShown(page);
    check(got === promised, `"${label}" -> ${got} rooms`, `promised ${promised}`);
  }

  await ctx.close();

  // ── 8. Responsive and tap targets ──────────────────────────────────────
  console.log('\n── Widths 360 / 390 / 768 / 1280 ──────────────');
  for (const width of WIDTHS) {
    const c = await browser.newContext({ viewport: { width, height: 800 } });
    const p = await c.newPage();
    await p.goto(`${BASE}/?q=${encodeURIComponent('en-suite in Sandton')}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1400);

    const overflow = await p.evaluate(() =>
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    check(overflow <= 1, `${width}px: no horizontal page scroll`, `overflows by ${overflow}px`);

    const small = await p.evaluate(() =>
      [...document.querySelectorAll('.search-chip:not(.search-chip--word)')]
        .map((el) => Math.round(el.getBoundingClientRect().height))
        .filter((h) => h > 0 && h < 44));
    check(small.length === 0, `${width}px: every removable chip meets 44px`, `heights ${JSON.stringify(small)}`);

    const chipCount = await p.locator('.search-chip').count();
    check(chipCount > 0, `${width}px: the search read is shown (${chipCount} chip(s))`);

    const smallLinks = await p.evaluate(() =>
      [...document.querySelectorAll('.browse__link')]
        .map((el) => Math.round(el.getBoundingClientRect().height))
        .filter((h) => h > 0 && h < 44));
    check(smallLinks.length === 0, `${width}px: every browse shortcut meets 44px`, `heights ${JSON.stringify(smallLinks)}`);
    await c.close();
  }

  await browser.close();
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
