#!/usr/bin/env node
/**
 * No advert on the board carries the old brand name.
 *
 * ── Why this exists
 *
 * Reported from a live board, long after the rename was "complete": every
 * house advert read **"by RentBoard ZA"**. `ads.service.ts` returns
 * `advertiser: campaign.advertiser.companyName` and `ad-slot.ts` renders
 * `by {{ advert.advertiser }}` under every advert, so the old name was on a
 * public page under three adverts whose own copy had been correct for weeks.
 *
 * ⚠️ And the script written to fix the house ads could not fix it. Three
 * defects in a chain:
 *
 *   1. `prisma.advertiser.upsert` said `update: {}`, so `companyName:
 *      'Mastande'` applied only on CREATE. Any database where the row already
 *      existed kept its old name for ever.
 *   2. the change detection compared four fields of the CAMPAIGNS and nothing
 *      of the advertiser, so the dry run reported "Nothing to change — the
 *      house ads already match the code" while the name was wrong.
 *   3. and because of (2), `if (!changes) return` fired before the advertiser
 *      upsert was reached, so fixing (1) alone would have changed nothing.
 *
 * Reproduced before fixing: with the row set back to 'RentBoard ZA',
 * `seed-house-ads.ts --apply` printed its calm success and left it as it was.
 *
 * ── Why no existing check could see this
 *
 * Every rebrand check in this repository reads SOURCE. This value is a
 * database row: it is not in the code, it is not in a template, and the code
 * that was supposed to govern it was correct the whole time. So this drive
 * reads what the API actually SERVES, which is the only place the truth is.
 *
 * ⚠️ It also asserts the advert copy, not just the advertiser — the same
 * reasoning one level along. "New to Mastande?" is in `house-ads.ts` and was
 * fixed there; whether the row in THIS database says so is a different
 * question, and the answer on production was no for weeks.
 *
 * Needs the API on :3000 and a database with the house ads seeded.
 *
 *   node scripts/house-ads-drive.mjs
 */
import { apiCall } from './lib/drive-session.mjs';

const API = process.env.API ?? 'http://localhost:3000';

/** Every spelling of the old name that could be sitting in a row. */
const OLD_BRAND = /rentboard|rent\s*board/i;

let pass = 0;
const failures = [];
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { failures.push(m); console.log(`  ❌ ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log('\n── House ads, as the API serves them ───────────────────────');

/**
 * Every placement an advert can occupy, because an advert is only on screen if
 * something asks for its placement — and a sweep of one placement would have
 * missed the other two.
 */
const PLACEMENTS = ['board_sidebar', 'board_inline', 'room_detail'];

let served = 0;
for (const placement of PLACEMENTS) {
  const res = await apiCall(API, 'GET', `/api/ads?placement=${placement}&limit=5`);
  if (res.status !== 200) {
    bad(`${placement}: the API answered ${res.status} — nothing measured`);
    continue;
  }
  const ads = Array.isArray(res.body) ? res.body : (res.body?.ads ?? []);
  if (!ads.length) {
    console.log(`  ⚠️  ${placement}: no advert served, so nothing to check here`);
    continue;
  }
  for (const ad of ads) {
    served++;
    const where = `${placement} · "${(ad.headline ?? '').slice(0, 32)}"`;
    check(
      !OLD_BRAND.test(ad.advertiser ?? ''),
      `${where}: advertiser reads "${ad.advertiser}"`,
    );
    for (const field of ['headline', 'body', 'ctaLabel']) {
      if (!ad[field]) continue;
      check(
        !OLD_BRAND.test(ad[field]),
        `${where}: ${field} carries no old brand name`,
      );
    }
  }
}

/**
 * ⚠️ The vacuous-pass guard, and it is the whole point of this file.
 *
 * Every assertion above is a NEGATIVE over served text. With no adverts in the
 * database they all pass, which is five vacuous passes in a repository that
 * has already shipped five. So the number served is asserted first.
 */
check(served > 0, `${served} advert(s) were actually served and read`);

console.log('\n═══════════════════════════════════════════════════════');
if (failures.length) {
  console.log(`  ❌ ${failures.length} failed, ${pass} passed.`);
  console.log('     The advert copy lives in prisma/house-ads.ts and the rows are');
  console.log('     written by prisma/seed-house-ads.ts --apply. A row that is wrong');
  console.log('     is not fixed by a redeploy — the adverts are read from the');
  console.log('     database. docs/OUTSTANDING.md § 51.');
  console.log('═══════════════════════════════════════════════════════\n');
  process.exit(1);
}
console.log(`  ✅ ${pass} checks passed.`);
console.log('═══════════════════════════════════════════════════════\n');
