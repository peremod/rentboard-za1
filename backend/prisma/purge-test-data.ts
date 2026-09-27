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
 * **Identified by email domain, not by guessing at titles.** Every account the
 * smoke test, the drives and the demo seed create ends in `@mastande.test`,
 * which is a reserved TLD that can never belong to a real person (RFC 2606).
 * So the rule is exact, and it cannot match a real landlord no matter what
 * they called their room. Deleting the user cascades to their rooms,
 * applications, messages, tenancies and payments.
 *
 *   npx ts-node prisma/purge-test-data.ts            # dry run — prints, deletes nothing
 *   npx ts-node prisma/purge-test-data.ts --yes      # actually deletes
 *
 * Dry run is the default deliberately. A script whose whole job is deleting
 * rows from a live database should make you type something.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** RFC 2606 reserves .test — no real address can ever end in it. */
const TEST_DOMAIN = '@mastande.test';

async function main() {
  const commit = process.argv.includes('--yes');

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
    console.log(`No accounts ending in ${TEST_DOMAIN}. Nothing to do.`);
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
