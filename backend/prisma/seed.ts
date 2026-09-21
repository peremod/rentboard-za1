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

  // House ads. Always seeded, not opt-in: they fill unsold inventory and give
  // the rate card a national baseline to measure against.
  await seedHouseAds();

  // Place taxonomy. Always seeded — search and ad targeting depend on it, and
  // it is reference data rather than demo data.
  await seedPlaces();

  // Launch invite codes, per city. Opt-in like the demo ads.
  if (process.env.SEED_LAUNCH_CODES === 'true') {
    await seedLaunchCodes();
  }

  // Demo rooms. Opt-in, for the same reason as the demo ads.
  if (process.env.SEED_DEMO_ROOMS === 'true') {
    await seedDemoRooms();
  }

  const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
  console.log(`Total admin accounts: ${adminCount}`);
  console.log('Sign in normally, then open /admin.');
}

/**
 * RentBoard's own adverts.
 *
 * Two jobs. An empty slot is wasted space, so unsold inventory promotes the
 * site instead of showing nothing. And a permanently running nationwide
 * campaign gives the reach analysis a baseline — without one there is nothing
 * to compare a suburb campaign against, and the rate card cannot be checked.
 *
 * They never displace a paid placement: house ads are ranked after every paid
 * campaign regardless of targeting.
 */
// Fixed, valid UUIDs so the seed is idempotent. 'ad' and 'b0' are hex; a
// readable-but-invalid id like '...house1' fails at insert.
const HOUSE_ADVERTISER_ID = '00000000-0000-0000-0000-0000000000b0';

async function seedHouseAds() {
  const advertiser = await prisma.advertiser.upsert({
    where: { id: HOUSE_ADVERTISER_ID },
    update: {},
    create: {
      id: HOUSE_ADVERTISER_ID,
      companyName: 'RentBoard',
      contactName: 'RentBoard',
      contactEmail: 'hello@rentboard.co.za',
      notes: 'House ads. Not a paying advertiser — do not invoice.',
    },
  });

  const now = new Date();
  const farFuture = new Date('2099-01-01');

  const ads = [
    {
      id: '00000000-0000-0000-0000-0000000000b1',
      name: '[HOUSE] How it works — sidebar',
      placement: 'board_sidebar' as const,
      headline: 'New to RentBoard?',
      body: 'No agents, no application fees. See how renting direct from landlords works.',
      ctaLabel: 'How it works',
      targetUrl: '/how-it-works',
    },
    {
      id: '00000000-0000-0000-0000-0000000000b2',
      name: '[HOUSE] List a room — in-grid',
      placement: 'board_inline' as const,
      headline: 'Have a room to let?',
      body: 'Listing is free, and always will be. No commission, no agent in the middle.',
      ctaLabel: 'List a room free',
      targetUrl: '/auth/register',
    },
    {
      id: '00000000-0000-0000-0000-0000000000b3',
      name: '[HOUSE] Safety — room detail',
      placement: 'room_detail' as const,
      headline: 'Before you pay a deposit',
      body: 'View the room in person, insist on a written lease, and never pay before you see it.',
      ctaLabel: 'Read the guidance',
      targetUrl: '/how-it-works',
    },
  ];

  for (const ad of ads) {
    const data = {
      ...ad,
      advertiserId: advertiser.id,
      // Nationwide on purpose: this is the baseline every targeted campaign is
      // measured against.
      province: null,
      city: null,
      suburbSlug: null,
      startsAt: now,
      endsAt: farFuture,
      monthlyRateCents: 0,
      status: 'active' as const,
      approvedAt: now,
      isHouseAd: true,
    };
    await prisma.adCampaign.upsert({
      where: { id: data.id },
      update: data,
      create: data,
    });
  }

  console.log(`Seeded ${ads.length} house ads (nationwide, fill-only).`);
}

/**
 * Suburb → city → province for the metros worth launching in.
 *
 * Deliberately partial. A complete South African gazetteer is thousands of
 * entries and most would never be searched; this covers the areas where
 * shared-room demand is concentrated, and the model takes more without a
 * migration. Anything not listed still works — it just falls back to matching
 * on the city string as before.
 */
async function seedPlaces() {
  const slug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const provinces = [
    'Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape',
    'Free State', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape',
  ];

  const cities: Record<string, { name: string; aliases?: string[]; suburbs: string[] }[]> = {
    Gauteng: [
      {
        name: 'Johannesburg',
        aliases: ['joburg', 'jhb', 'jozi', 'egoli'],
        suburbs: [
          'Sandton', 'Rosebank', 'Randburg', 'Braamfontein', 'Melville',
          'Yeoville', 'Hillbrow', 'Soweto', 'Roodepoort', 'Midrand',
          'Fourways', 'Auckland Park', 'Parktown', 'Bez Valley', 'Kensington',
        ],
      },
      {
        name: 'Pretoria',
        aliases: ['tshwane', 'pta'],
        suburbs: [
          'Hatfield', 'Sunnyside', 'Arcadia', 'Brooklyn', 'Centurion',
          'Menlyn', 'Soshanguve', 'Mamelodi', 'Pretoria North', 'Silverton',
        ],
      },
      { name: 'Ekurhuleni', aliases: ['east rand'], suburbs: ['Benoni', 'Boksburg', 'Kempton Park', 'Germiston', 'Springs', 'Tembisa'] },
      { name: 'Vereeniging', suburbs: ['Vanderbijlpark', 'Sebokeng'] },
    ],
    'Western Cape': [
      {
        name: 'Cape Town',
        aliases: ['ct', 'kaapstad', 'mother city'],
        suburbs: [
          'Observatory', 'Woodstock', 'Rondebosch', 'Claremont', 'Mowbray',
          'Salt River', 'Bellville', 'Parow', 'Khayelitsha', 'Gugulethu',
          'Muizenberg', 'Sea Point', 'Athlone', 'Mitchells Plain', 'Goodwood',
        ],
      },
      { name: 'Stellenbosch', suburbs: ['Die Boord', 'Idas Valley', 'Cloetesville'] },
      { name: 'George', suburbs: ['Blanco', 'Pacaltsdorp'] },
    ],
    'KwaZulu-Natal': [
      {
        name: 'Durban',
        aliases: ['ethekwini', 'dbn'],
        suburbs: [
          'Umbilo', 'Glenwood', 'Musgrave', 'Berea', 'Westville',
          'Umlazi', 'Chatsworth', 'Pinetown', 'Morningside', 'Overport',
        ],
      },
      { name: 'Pietermaritzburg', aliases: ['pmb', 'maritzburg'], suburbs: ['Scottsville', 'Hayfields', 'Northdale'] },
    ],
    'Eastern Cape': [
      { name: 'Gqeberha', aliases: ['port elizabeth', 'pe'], suburbs: ['Summerstrand', 'Central', 'Newton Park', 'Motherwell'] },
      { name: 'East London', suburbs: ['Southernwood', 'Vincent', 'Mdantsane'] },
      { name: 'Makhanda', aliases: ['grahamstown'], suburbs: ['Rhodes Campus Area'] },
    ],
    'Free State': [
      { name: 'Bloemfontein', aliases: ['bloem', 'mangaung'], suburbs: ['Universitas', 'Brandwag', 'Willows', 'Bothaville'] },
    ],
    Limpopo: [{ name: 'Polokwane', aliases: ['pietersburg'], suburbs: ['Bendor', 'Seshego'] }],
    Mpumalanga: [{ name: 'Nelspruit', aliases: ['mbombela'], suburbs: ['Sonheuwel', 'West Acres'] }],
    'North West': [{ name: 'Potchefstroom', aliases: ['potch'], suburbs: ['Baillie Park', 'Ikageng'] }],
    'Northern Cape': [{ name: 'Kimberley', suburbs: ['Galeshewe', 'Herlear'] }],
  };

  let created = 0;

  for (const province of provinces) {
    const p = await prisma.place.upsert({
      where: { slug: slug(province) },
      update: {},
      create: { slug: slug(province), name: province, type: 'province', province },
    });
    created++;

    for (const city of cities[province] ?? []) {
      const c = await prisma.place.upsert({
        where: { slug: slug(city.name) },
        update: { aliases: city.aliases ?? [] },
        create: {
          slug: slug(city.name),
          name: city.name,
          type: 'city',
          parentId: p.id,
          province,
          city: city.name,
          aliases: city.aliases ?? [],
        },
      });
      created++;

      for (const suburb of city.suburbs) {
        // Suburb slugs are prefixed with the city: Central exists in more
        // than one metro, and a bare slug would collide.
        const suburbSlug = `${slug(city.name)}-${slug(suburb)}`;
        await prisma.place.upsert({
          where: { slug: suburbSlug },
          update: {},
          create: {
            slug: suburbSlug,
            name: suburb,
            type: 'suburb',
            parentId: c.id,
            province,
            city: city.name,
          },
        });
        created++;
      }
    }
  }

  console.log(`Seeded ${created} places (provinces, cities and suburbs).`);
}

/**
 * Launch invite codes: a fixed batch per city, handed out to early landlords.
 *
 * Capped at one use each on purpose. A shared unlimited code gets posted in a
 * Facebook group and farmed; fifty single-use codes can be given to fifty
 * specific people and their redemption tells you which city is actually
 * converting.
 *
 * Cities are the ones worth pushing first — where shared-room demand is
 * concentrated. Extend the list as you open new areas.
 */
async function seedLaunchCodes() {
  const cities: { city: string; province: string }[] = [
    { city: 'Johannesburg', province: 'Gauteng' },
    { city: 'Pretoria', province: 'Gauteng' },
    { city: 'Cape Town', province: 'Western Cape' },
    { city: 'Durban', province: 'KwaZulu-Natal' },
    { city: 'Port Elizabeth', province: 'Eastern Cape' },
    { city: 'Bloemfontein', province: 'Free State' },
  ];

  const PER_CITY = 50;
  // No vowels and no 0/1/O/I: these get read out over the phone, and an
  // ambiguous character is a support call.
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  let created = 0;

  for (const { city, province } of cities) {
    const prefix = city.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();

    const existing = await prisma.referralCode.count({ where: { type: 'launch', city } });
    if (existing >= PER_CITY) continue;   // idempotent: do not stack batches

    for (let i = existing; i < PER_CITY; i++) {
      const suffix = Array.from(
        { length: 5 },
        () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
      ).join('');

      try {
        await prisma.referralCode.create({
          data: {
            code: `${prefix}-${suffix}`,
            type: 'launch',
            city,
            province,
            maxUses: 1,
            // Expire after the launch window so unredeemed codes do not
            // linger and skew later numbers.
            expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
          },
        });
        created++;
      } catch {
        i--;   // collision, try another suffix
      }
    }
  }

  console.log(`Seeded ${created} launch invite codes across ${cities.length} cities.`);
  console.log('List them with: GET /api/referrals/admin/launch-codes?city=Johannesburg');
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
      // Nationwide: a province-targeted demo only appears once you filter to
      // that province, which makes the placement look broken on a fresh board.
      province: null,
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
    // Several per placement, so rotation is visible and the board does not
    // show the same advertiser on every page.
    {
      id: '00000000-0000-0000-0000-00000000ad04',
      name: '[DEMO] Boxes — sidebar',
      placement: 'board_sidebar' as const,
      headline: 'Boxes delivered, R240 a bundle',
      body: 'Twenty boxes, tape and bubble wrap. Next-day in metro areas.',
      ctaLabel: 'Order boxes',
      province: null,
    },
    {
      id: '00000000-0000-0000-0000-00000000ad05',
      name: '[DEMO] Furniture rental — in-grid',
      placement: 'board_inline' as const,
      headline: 'Furnish a room from R450/month',
      body: 'Bed, desk and wardrobe on rental. No credit check.',
      ctaLabel: 'See packages',
      province: null,
    },
    {
      id: '00000000-0000-0000-0000-00000000ad06',
      name: '[DEMO] Prepaid electricity — sidebar',
      placement: 'board_sidebar' as const,
      headline: 'Prepaid electricity, no deposit',
      body: 'Top up from your phone. Works with most municipal meters.',
      ctaLabel: 'How it works',
      province: null,
    },
  ];

  for (const c of campaigns) {
    const data = {
      ...c,
      advertiserId: advertiser.id,
      targetUrl: 'https://example.co.za',
      startsAt: now,
      endsAt: nextYear,
      monthlyRateCents: 250000,
      // Pre-approved: the point is to see the slot render.
      status: 'active' as const,
      approvedAt: now,
    };

    // update: data, NOT update: {} — an empty update means re-running the seed
    // cannot fix a demo campaign whose targeting is wrong, which is exactly
    // what happened with the Gauteng-only in-grid ad.
    await prisma.adCampaign.upsert({
      where: { id: c.id },
      update: data,
      create: data,
    });
  }

  console.log(`Seeded ${campaigns.length} demo ad campaigns (all prefixed [DEMO]).`);
}


/**
 * A handful of published rooms, so the board is not empty.
 *
 * Opt-in via SEED_DEMO_ROOMS=true, and never on production data — these are
 * obviously fake listings and they belong nowhere near real traffic.
 *
 * Written because e2e/application-lifecycle.spec.ts says "the seed guarantees
 * at least one room" and that was not true: the seed created an admin, the
 * place taxonomy and house ads, and no rooms at all. The first time the e2e
 * job ran in CI it failed on `app-room-card a` not existing, because the
 * board it was applying from had nothing on it.
 *
 * Rooms are written directly rather than through the API on purpose. Publishing
 * requires a cover photo, which requires an ImageKit upload, which CI has no
 * credentials for — so the API path cannot produce a listed room in CI at all.
 * A fixture that says so is better than a test that quietly needs a service
 * nobody configured.
 */
async function seedDemoRooms() {
  const landlordEmail = 'demo-landlord@rentboard.test';

  const landlord = await prisma.user.upsert({
    where: { email: landlordEmail },
    update: {},
    create: {
      email: landlordEmail,
      // No usable password: this account exists to own listings, not to be
      // signed into. bcrypt will never match an empty-ish placeholder.
      passwordHash: await bcrypt.hash(`seed-only-${Date.now()}-${Math.random()}`, SALT_ROUNDS),
      fullName: 'Demo Landlord',
      role: 'LANDLORD',
      isActive: true,
      isVerified: true,
    },
  });

  const rooms = [
    {
      title: 'Sunny room in a shared house, Observatory',
      roomType: 'shared_house' as const,
      rentCents: 450000,
      province: 'Western Cape',
      city: 'Cape Town',
      locationDisplay: 'Observatory, Cape Town',
      amenities: ['wifi', 'furnished', 'washing_machine'],
      housematesCount: 3,
    },
    {
      title: 'En-suite room close to Wits, Braamfontein',
      roomType: 'en_suite' as const,
      rentCents: 520000,
      province: 'Gauteng',
      city: 'Johannesburg',
      locationDisplay: 'Braamfontein, Johannesburg',
      amenities: ['wifi', 'furnished', 'security'],
      housematesCount: 2,
    },
    {
      title: 'Studio with its own entrance, Morningside',
      roomType: 'studio' as const,
      rentCents: 680000,
      province: 'KwaZulu-Natal',
      city: 'Durban',
      locationDisplay: 'Morningside, Durban',
      amenities: ['wifi', 'parking', 'private_entrance'],
      housematesCount: 0,
    },
  ];

  for (const room of rooms) {
    const existing = await prisma.room.findFirst({
      where: { landlordId: landlord.id, title: room.title },
    });
    if (existing) continue;

    await prisma.room.create({
      data: {
        ...room,
        landlordId: landlord.id,
        description:
          'Seeded demo listing. Quiet house, close to transport, bills shared between housemates.',
        status: 'active',
        publishedAt: new Date(),
        availableFrom: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        depositCents: room.rentCents,
        billsIncluded: true,
        // A path, not an upload: the frontend builds an ImageKit URL from it,
        // and a broken image is fine in a fixture. What matters is that the
        // room has a cover at all, since the board hides listings without one.
        heroImagePath: 'demo/room-placeholder.jpg',
        imagePaths: ['demo/room-placeholder.jpg'],
      },
    });
  }

  console.log(`Demo rooms seeded: ${rooms.length} listings under ${landlordEmail}`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
