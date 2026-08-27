/**
 * Seed / admin bootstrap.
 *
 * The chicken-and-egg problem this solves: every admin route is behind
 * AdminGuard, and nothing in the application can create an ADMIN user — so
 * without this, the verification queue is unreachable and no landlord can ever
 * be verified.
 *
 *   ADMIN_EMAIL=you@example.co.za ADMIN_PASSWORD='...' npm run db:seed
 *
 * Safe to run repeatedly: it promotes or updates the named account rather than
 * creating duplicates. It never touches any other user.
 *
 * Deliberately NOT an API endpoint. A "create the first admin" route is a
 * standing privilege-escalation risk if the guard around it is ever wrong;
 * requiring database credentials to mint an admin is the safer trade.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

/** Same policy the RegisterDto enforces, so seeded admins are not weaker. */
function assertStrongPassword(password: string) {
  if (password.length < 12) {
    throw new Error('Admin password must be at least 12 characters — stricter than the 8 required of normal accounts.');
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    throw new Error('Admin password needs an uppercase letter, a lowercase letter and a number.');
  }
}

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_NAME?.trim() || 'RentBoard Admin';

  if (!email || !password) {
    console.error(`
Missing credentials. Usage:

  ADMIN_EMAIL=you@example.co.za ADMIN_PASSWORD='a-long-password' npm run db:seed

Optional: ADMIN_NAME="Your Name"
`);
    process.exit(1);
  }

  assertStrongPassword(password);

  const existing = await prisma.user.findUnique({ where: { email } });
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  if (existing) {
    const user = await prisma.user.update({
      where: { email },
      data: { role: 'ADMIN', passwordHash, isActive: true, isVerified: true },
    });
    console.log(`Existing account promoted to ADMIN: ${user.email}`);
    console.log('Its password was reset to the value supplied.');
  } else {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName,
        role: 'ADMIN',
        isVerified: true,
        isActive: true,
      },
    });
    console.log(`Admin created: ${user.email}`);
  }

  const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
  console.log(`Total admin accounts: ${adminCount}`);
  console.log('Sign in normally, then open /admin.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
