/**
 * Remove test accounts and everything they own from a database.
 *
 * Why this exists: scripts/smoke-test.sh was run against the production API,
 * and a public room board served real visitors a listing called "Wizard test
 * studio in Rosebank (updated)" by a landlord named "Renamed Landlord", with a
 * hero image pointing at /smoke-test-placeholder.jpg. The demo seed's three
 * fake rooms were on there too.
 *
 * Both of those tools now refuse to touch production. This is the other half:
 * clearing what they already left behind.
 *
 * **Identified by the reserved `.test` TLD, not by a brand name.** RFC 2606
 * reserves `.test` precisely so it can never resolve or belong to anyone, so
 * the rule is exact and cannot match a real landlord however they named their
 * room. Deleting the user cascades to their rooms, applications, messages,
 * tenancies and payments.
 *
 * It matched `@mastande.test` at first, and that was wrong. The project was
 * renamed from RentBoard mid-development, and the smoke test's accounts before
 * that rename end in `@rentboard.test` — so the first version of this script
 * reported "nothing to do" against a production database whose board was
 * serving smoke-test rooms from 21 September. A check that reports clean on
 * dirty data is worse than no check, and hard-coding today's brand into the
 * rule is how it happened. The TLD cannot be renamed.
 *
 *   npx ts-node prisma/purge-test-data.ts            # dry run — prints, deletes nothing
 *   npx ts-node prisma/purge-test-data.ts --yes      # actually deletes
 *
 * Dry run is the default deliberately. A script whose whole job is deleting
 * rows from a live database should make you type something.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * RFC 2606 reserves the whole `.test` TLD — no real address can ever end in
 * it. Deliberately the TLD and not `@mastande.test`: the brand has changed
 * once already and the accounts from before it end in `@rentboard.test`.
 */
const TEST_DOMAIN = '.test';

/**
 * Say which database this is talking to, before it touches anything.
 *
 * Prisma reads DATABASE_URL, and in a checkout that means backend/.env — which
 * points at a local development database. So the obvious invocation gives a
 * calm, accurate dry run about entirely the wrong rows, and the production
 * board stays exactly as it was. Printing the target is the difference between
 * a destructive script you can trust and one you have to reason about.
 *
 * Host and database name only. The password is never printed.
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
  const commit = process.argv.includes('--yes');

  console.log(`Database: ${describeTarget()}`);
  console.log(`Mode:     ${commit ? 'DELETE' : 'dry run'}\n`);

  // Admins are excluded unless asked for. The seed creates the admin from
  // ADMIN_EMAIL, and on this project that has been an @mastande.test address —
  // so the obvious rule would quietly delete the only account that can reach
  // the admin portal. Being locked out of moderation is a worse outcome than
  // one leftover test row.
  const includeAdmins = process.argv.includes('--include-admins');
  const where = includeAdmins
    ? { email: { endsWith: TEST_DOMAIN } }
    : { email: { endsWith: TEST_DOMAIN }, role: { not: 'ADMIN' as const } };

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      createdAt: true,
      _count: { select: { rooms: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (users.length === 0) {
    console.log(`No accounts on the reserved ${TEST_DOMAIN} TLD. Nothing to do.`);
    return;
  }

  const rooms = users.reduce((n, u) => n + u._count.rooms, 0);
  console.log(`${users.length} test account(s) owning ${rooms} room(s):\n`);
  for (const u of users) {
    const when = u.createdAt.toISOString().split('T')[0];
    console.log(`  ${u.email.padEnd(46)} ${u.role.padEnd(9)} ${String(u._count.rooms).padStart(2)} room(s)  ${when}`);
  }

  if (!includeAdmins) {
    const skipped = await prisma.user.count({
      where: { email: { endsWith: TEST_DOMAIN }, role: 'ADMIN' },
    });
    if (skipped) {
      console.log(`\n${skipped} ADMIN account(s) on ${TEST_DOMAIN} are being KEPT.`);
      console.log('   Pass --include-admins to delete those too, and read that twice —');
      console.log('   it may be the only account that can reach the admin portal.');
    }
  }

  if (!commit) {
    console.log('\nDry run — nothing was deleted. Re-run with --yes to delete.');
    return;
  }

  const { count } = await prisma.user.deleteMany({ where });
  console.log(`\nDeleted ${count} account(s) and everything they owned.`);

  const left = await prisma.room.count({ where: { status: 'active' } });
  console.log(`${left} active room(s) remain on the board.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
