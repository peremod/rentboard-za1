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

  // Optional demo advertising, so the ad slots are visible without having to
  // sell a placement first. Never runs unless asked for — nobody wants fake
  // adverts appearing on a production board.
  if (process.env.SEED_DEMO_ADS === 'true') {
    await seedDemoAds();
  }

  const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
  console.log(`Total admin accounts: ${adminCount}`);
  console.log('Sign in normally, then open /admin.');
}

/**
 * Three campaigns covering the three placements, already approved so they
 * render immediately. Clearly labelled as demo data so they are obvious in the
 * admin list and easy to remove.
 */
async function seedDemoAds() {
  const advertiser = await prisma.advertiser.upsert({
    where: { id: '00000000-0000-0000-0000-0000000000ad' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-0000000000ad',
      companyName: '[DEMO] Sample Advertiser',
      contactName: 'Demo Contact',
      contactEmail: 'demo@example.test',
      notes: 'Seeded demo data. Safe to delete.',
    },
  });

  const now = new Date();
  const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  const campaigns = [
    {
      id: '00000000-0000-0000-0000-00000000ad01',
      name: '[DEMO] Fibre — sidebar',
      placement: 'board_sidebar' as const,
      headline: 'Fibre at your new place',
      body: 'Check coverage before you sign the lease. Installation in 3–5 days.',
      ctaLabel: 'Check coverage',
      province: null,
    },
    {
      id: '00000000-0000-0000-0000-00000000ad02',
      name: '[DEMO] Movers — inline',
      placement: 'board_inline' as const,
      headline: 'Moving a room, not a house?',
      body: 'Small-load moves from R650. Same-day quotes.',
      ctaLabel: 'Get a quote',
      province: 'Gauteng',
    },
    {
      id: '00000000-0000-0000-0000-00000000ad03',
      name: '[DEMO] Contents cover — room detail',
      placement: 'room_detail' as const,
      headline: 'Cover your things from R89/month',
      body: 'Contents insurance for renters. No lease required.',
      ctaLabel: 'See cover',
      province: null,
    },
  ];

  for (const c of campaigns) {
    await prisma.adCampaign.upsert({
      where: { id: c.id },
      update: {},
      create: {
        ...c,
        advertiserId: advertiser.id,
        targetUrl: 'https://example.co.za',
        startsAt: now,
        endsAt: nextYear,
        monthlyRateCents: 250000,
        // Pre-approved: the point is to see the slot render.
        status: 'active',
        approvedAt: now,
      },
    });
  }

  console.log(`Seeded ${campaigns.length} demo ad campaigns (all prefixed [DEMO]).`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
