/**
 * Re-seed Mastande's own house adverts, and nothing else.
 *
 * Why this exists separately from prisma/seed.ts: the full seed does the job,
 * but it will not run without ADMIN_EMAIL and ADMIN_PASSWORD, and supplying
 * them **resets that admin account's password** — it says so itself, "Its
 * password was reset to the value supplied." Changing three lines of advert
 * copy should not cost you your admin password, and a production runbook step
 * whose side effects exceed its purpose is one people either get wrong or stop
 * running. It also seeds the whole place taxonomy on the way past.
 *
 * This touches the three `[HOUSE]` campaigns and the house advertiser row.
 * Nothing else in the database is read or written.
 *
 * The copy itself lives in prisma/house-ads.ts, imported by both this and the
 * full seed, so the two cannot drift. If they had been two copies, the
 * pre-rebrand text this script exists to fix would simply have been fixed in
 * one of them. It is a module of its own rather than an export from seed.ts
 * because seed.ts calls main() at the top level — importing it would run the
 * whole seed.
 *
 *   npx ts-node prisma/seed-house-ads.ts           # dry run — shows the diff
 *   npx ts-node prisma/seed-house-ads.ts --apply   # writes
 *
 * Dry run is the default, and it prints the current value beside the new one,
 * because "New to RentBoard?" versus "New to Mastande?" is exactly the kind of
 * difference you want to see before and after rather than take on trust.
 */
import { PrismaClient } from '@prisma/client';
import { HOUSE_ADS, HOUSE_ADVERTISER, HOUSE_ADVERTISER_ID, houseAdRow } from './house-ads';

const prisma = new PrismaClient();

/**
 * Say which database this is about to change, before changing anything.
 *
 * Same reasoning as purge-test-data.ts, and the same bug it was written for:
 * Prisma reads DATABASE_URL, which in a checkout means backend/.env and a
 * local database. Without this line the obvious invocation reports a calm,
 * accurate success about entirely the wrong rows while production stays as it
 * was. Host and database name only — the password is never printed.
 */
function describeTarget(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return 'DATABASE_URL is not set';
  try {
    const url = new URL(raw);
    return `${url.hostname}${url.port ? ':' + url.port : ''}${url.pathname}`;
  } catch {
    return 'DATABASE_URL is set but could not be parsed';
  }
}

async function main() {
  const apply = process.argv.includes('--apply');

  console.log(`Database: ${describeTarget()}`);
  console.log(`Mode:     ${apply ? 'WRITE' : 'dry run'}\n`);

  const existing = await prisma.adCampaign.findMany({
    where: { id: { in: HOUSE_ADS.map((ad) => ad.id) } },
    select: { id: true, headline: true, body: true, ctaLabel: true, targetUrl: true },
  });
  const before = new Map(existing.map((row) => [row.id, row]));

  let changes = 0;

  /**
   * ⚠️ THE ADVERTISER ROW, which this script could not see or fix.
   *
   * Reported from a live board: every house ad still reads "by RentBoard ZA".
   * `ads.service.ts` returns `advertiser: campaign.advertiser.companyName` and
   * `ad-slot.ts` renders `by {{ advert.advertiser }}` under every advert, so
   * the old brand name was on a public page under three adverts whose own copy
   * had been correct since the rename.
   *
   * Three defects in a chain, all in this file and in seed.ts:
   *
   *   1. the upsert said `update: {}`, so `companyName: 'Mastande'` applied
   *      only on CREATE. Any database where the row already existed kept its
   *      old name for ever.
   *   2. the comparison below read four fields of the CAMPAIGNS and nothing of
   *      the advertiser, so the dry run reported "Nothing to change" while the
   *      name was wrong — a report structurally unable to see its subject.
   *   3. and because of (2) the `if (!changes) return` below fired first, so
   *      the advertiser upsert was never reached at all. Fixing (1) alone would
   *      have changed nothing.
   *
   * Reproduced before fixing: with the row set back to 'RentBoard ZA', this
   * script with --apply printed "Nothing to change — the house ads already
   * match the code" and left it exactly as it was.
   */
  const advertiser = await prisma.advertiser.findUnique({
    where: { id: HOUSE_ADVERTISER_ID },
    select: { companyName: true, contactName: true, contactEmail: true },
  });
  console.log('House advertiser');
  if (!advertiser) {
    console.log('  + not in this database — will be created');
    console.log(`    companyName: ${HOUSE_ADVERTISER.companyName}`);
    changes++;
  } else {
    let differs = false;
    for (const field of ['companyName', 'contactName', 'contactEmail'] as const) {
      if (advertiser[field] !== HOUSE_ADVERTISER[field]) {
        console.log(`  - ${field}: ${advertiser[field]}`);
        console.log(`  + ${field}: ${HOUSE_ADVERTISER[field]}`);
        differs = true;
      }
    }
    if (differs) changes++;
    else console.log('  unchanged');
  }
  console.log('');
  for (const ad of HOUSE_ADS) {
    const current = before.get(ad.id);
    console.log(`${ad.name}`);
    if (!current) {
      console.log(`  + not in this database — will be created`);
      console.log(`    headline: ${ad.headline}`);
      changes++;
      continue;
    }
    const fields: Array<keyof typeof ad & keyof typeof current> = [
      'headline', 'body', 'ctaLabel', 'targetUrl',
    ];
    let differs = false;
    for (const field of fields) {
      if (current[field] !== ad[field]) {
        console.log(`  - ${field}: ${current[field]}`);
        console.log(`  + ${field}: ${ad[field]}`);
        differs = true;
      }
    }
    if (differs) changes++;
    else console.log('  unchanged');
  }

  /**
   * ⚠️ LEGACY HOUSE ADS UNDER OTHER IDS — the second way this script could
   * report success and change nothing a visitor sees.
   *
   * Everything above is keyed on the fixed ids in house-ads.ts. A database
   * seeded BEFORE those ids existed has its house ads under random uuids, so
   * every lookup above misses, all four rows are reported as "not in this
   * database — will be created", and the apply creates a correct SECOND set
   * beside the wrong one. Both are status=active, ads.service.ts ranks the
   * house ads and serves the top one, and a legacy row can win — so the board
   * still reads "by RentBoard ZA" after a run that said it wrote 3 house ads.
   *
   * Reproduced on a copy before fixing: 3 legacy campaigns under random ids,
   * --apply, and the table went to SIX active house ads, three of them still
   * carrying the old brand.
   *
   * House ads are identified by `isHouseAd`, which this script sets itself, so
   * that flag is the identity and the fixed ids are only the canonical row.
   * They are ENDED rather than deleted: a campaign carries impressions and
   * clicks, and retiring one is a lifecycle change, not a reason to destroy
   * the record.
   */
  const canonicalIds = HOUSE_ADS.map((ad) => ad.id);
  const legacy = await prisma.adCampaign.findMany({
    where: {
      isHouseAd: true,
      id: { notIn: canonicalIds },
      status: { not: 'ended' },
    },
    select: {
      id: true, name: true, headline: true, status: true,
      advertiser: { select: { id: true, companyName: true } },
    },
  });
  console.log('');
  if (legacy.length) {
    console.log(`Legacy house ads under other ids: ${legacy.length}`);
    for (const row of legacy) {
      console.log(`  - ${row.id}  ${row.status}  by ${row.advertiser.companyName}`);
      console.log(`      ${row.headline}`);
      console.log(`    → will be ended (kept, with its impressions and clicks)`);
    }
    // ⚠️ Counted, so the `if (!changes) return` below cannot hide this the way
    // it hid the advertiser name. That was defect 3 above; this is the same
    // shape and must not be repeated.
    changes += legacy.length;
  } else {
    console.log('Legacy house ads under other ids: none');
  }

  if (!changes) {
    console.log('\nNothing to change — the house ads already match the code.');
    return;
  }

  if (!apply) {
    console.log(`\n${changes} advert(s) would change. Re-run with --apply to write.`);
    return;
  }

  /**
   * `update` carries the fields, not `{}`. The id is deliberately left out of
   * the update: it is the key.
   */
  const { id: _houseId, ...advertiserFields } = HOUSE_ADVERTISER;
  await prisma.advertiser.upsert({
    where: { id: HOUSE_ADVERTISER_ID },
    update: advertiserFields,
    create: HOUSE_ADVERTISER,
  });

  for (const ad of HOUSE_ADS) {
    const data = houseAdRow(ad);
    await prisma.adCampaign.upsert({ where: { id: data.id }, update: data, create: data });
  }

  if (legacy.length) {
    await prisma.adCampaign.updateMany({
      where: { id: { in: legacy.map((row) => row.id) } },
      data: { status: 'ended' },
    });
  }

  console.log(`\n✅ ${HOUSE_ADS.length} house ads written${legacy.length ? `, ${legacy.length} legacy house ad(s) ended` : ''}. Redeploy is not needed — they are read from the database.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
