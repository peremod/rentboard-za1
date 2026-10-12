/**
 * Read-only: who owns what on this database's board.
 *
 * Written because a purge that matches on `@mastande.test` found nothing on
 * production while the live API was serving "Bright en-suite room in Sandton
 * house" — a title that exists in exactly one place in this repo,
 * scripts/smoke-test.sh. Two true facts that cannot both be explained by the
 * assumption underneath them, so the assumption goes and a measurement takes
 * its place.
 *
 * Prints nothing it could get wrong: every listed room with the account that
 * owns it, and a count of accounts by email domain. Deletes nothing, changes
 * nothing, and names the database first.
 *
 *   DATABASE_URL="<connection string>" npx ts-node prisma/inspect-board.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function target(): string {
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
  console.log(`Database: ${target()}\n`);

  const rooms = await prisma.room.findMany({
    where: { status: { in: ['active', 'reserved'] } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      landlord: { select: { email: true, fullName: true, createdAt: true } },
    },
  });

  console.log(`${rooms.length} room(s) visible on the board:\n`);
  for (const r of rooms) {
    console.log(`  ${r.createdAt.toISOString().split('T')[0]}  ${r.status.padEnd(8)} ${r.title}`);
    console.log(`              owner: ${r.landlord.email}  (${r.landlord.fullName})`);
  }

  // The domain breakdown is the fastest way to see what a database is made of.
  const users = await prisma.user.findMany({ select: { email: true, role: true } });
  const domains = new Map<string, number>();
  for (const u of users) {
    // `User.email` is nullable on purpose — it is null for the WhatsApp-first
    // landlord who signed up by phone (see CLAUDE.md). So this is not only a
    // type complaint: `null.slice()` would have thrown the moment one such
    // account existed, and a diagnostic that crashes on the account type it is
    // most useful for is worse than no diagnostic. They get their own bucket
    // rather than being dropped, because "how many accounts have no email" is
    // exactly the number this breakdown is read for.
    const d = u.email ? u.email.slice(u.email.lastIndexOf('@')) : '(no email — phone-only)';
    domains.set(d, (domains.get(d) ?? 0) + 1);
  }
  console.log(`\n${users.length} account(s) by email domain:\n`);
  for (const [d, n] of [...domains].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${d}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
