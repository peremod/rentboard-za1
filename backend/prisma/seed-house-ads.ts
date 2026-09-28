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

  if (!changes) {
    console.log('\nNothing to change — the house ads already match the code.');
    return;
  }

  if (!apply) {
    console.log(`\n${changes} advert(s) would change. Re-run with --apply to write.`);
    return;
  }

  await prisma.advertiser.upsert({
    where: { id: HOUSE_ADVERTISER_ID },
    update: {},
    create: HOUSE_ADVERTISER,
  });

  for (const ad of HOUSE_ADS) {
    const data = houseAdRow(ad);
    await prisma.adCampaign.upsert({ where: { id: data.id }, update: data, create: data });
  }

  console.log(`\n✅ ${HOUSE_ADS.length} house ads written. Redeploy is not needed — they are read from the database.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
