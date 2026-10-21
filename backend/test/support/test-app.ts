import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { StorageService } from '../../src/modules/storage/storage.service';
import { WhatsappService } from '../../src/modules/whatsapp/whatsapp.service';
import { PayfastService } from '../../src/modules/payments/payfast.service';

/**
 * Integration harness: the real app, the real guards, a real database, and
 * test doubles at exactly the four places this system talks to the outside.
 *
 * ── Why the real pipeline
 *
 * Authentication and authorization in this app are GUARDS — jwt-auth,
 * roles, landlord, lister, admin — which only run inside Nest's request
 * pipeline. A test that calls a service method directly proves nothing about
 * who may call it, and the thing most worth asserting here is precisely that
 * a tenant cannot edit a landlord's property. So every request goes over HTTP
 * through supertest, and the guards decide.
 */

/**
 * 🔴 THE GUARD THAT MATTERS MOST.
 *
 * These tests TRUNCATE EVERY TABLE between cases. Pointed at the development
 * database that is one environment variable away, they would delete a day's
 * work; pointed at staging or production they would be a catastrophe, and
 * this repository already has an incident where a smoke script ran against a
 * real board and put "Wizard test studio in Rosebank (updated)" in front of
 * real visitors.
 *
 * So the database must NAME itself a test database, and the check is on the
 * resolved connection string rather than on a flag somebody can forget. It
 * refuses rather than guesses, the same way scripts/migrate-remote.sh does.
 */
export function assertTestDatabase(url = process.env.DATABASE_URL ?? ''): string {
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. The integration harness will not guess a database:\n' +
        '  createdb mastande_integration_test && npm run test:int',
    );
  }
  const name = url.split('/').pop()?.split('?')[0] ?? '';
  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to run integration tests against "${name}".\n` +
        'These tests truncate every table. The database name must contain "test".\n' +
        'Use mastande_integration_test, never a development, staging or production database.',
    );
  }
  for (const marker of ['neon.tech', 'render.com', 'umastande']) {
    if (url.includes(marker)) {
      throw new Error(`Refusing to run integration tests against a remote host (${marker}).`);
    }
  }
  return name;
}

/** What the doubles recorded, so a test can assert an effect without one. */
export interface Outbox {
  emails: { to: string; template: string }[];
  uploads: { path: string }[];
  whatsapps: { to: string }[];
  payments: { reference: string }[];
}

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  outbox: Outbox;
  http: () => request.Agent;
  close: () => Promise<void>;
}

/**
 * Doubles for the four network edges.
 *
 * ⚠️ Replaced wholesale rather than configured off. A service left real but
 * "disabled by an env var" is one misread variable away from sending a live
 * email to a real address from a test run, and nothing in the test output
 * would say so. These cannot reach the network because the code that could
 * is not loaded.
 */
function makeDoubles(outbox: Outbox) {
  return [
    {
      token: NotificationsService,
      value: new Proxy(
        {},
        {
          get: (_t, prop) => {
            // See the note on the WhatsApp double: a thenable double hangs
            // every await that touches it, and a symbol answered with a
            // function makes it lie to the inspector too.
            if (typeof prop === 'symbol' || prop === 'then') return undefined;
            return async (...args: any[]) => {
              outbox.emails.push({ to: String(args[0] ?? ''), template: String(prop) });
              return undefined;
            };
          },
        },
      ),
    },
    {
      token: StorageService,
      value: {
        upload: async (path: string) => {
          outbox.uploads.push({ path: String(path) });
          return { url: `https://test.invalid/${path}`, fileId: 'test-file' };
        },
        delete: async () => undefined,
        authParams: () => ({ token: 't', expire: 0, signature: 's' }),
      },
    },
    {
      token: WhatsappService,
      /**
       * ⚠️ A Proxy, not a hand-listed object, and the first run is why.
       * WhatsappModule.onModuleInit calls `setListingBot`, which a double
       * written from the send methods alone does not have — the whole app
       * failed to boot with "this.whatsapp.setListingBot is not a function".
       * A double that must be kept in step with a class by hand falls behind
       * it the first time somebody adds a method. Anything not named below
       * is an inert no-op.
       */
      value: new Proxy(
        {
          // Matches production, where WHATSAPP_ENABLED defaults to false.
          isEnabled: () => false,
          sendOtp: async (to: string) => { outbox.whatsapps.push({ to }); return true; },
          sendText: async (to: string) => { outbox.whatsapps.push({ to }); return true; },
          sendTemplate: async (to: string) => { outbox.whatsapps.push({ to }); return true; },
        } as Record<string, unknown>,
        {
          /**
           * 🔴 `then` MUST NOT be a function here.
           *
           * A Proxy that answers every property with a function makes the
           * object a THENABLE: `await double` then calls `then(resolve,
           * reject)`, which never resolves, and the await hangs forever. It
           * cost a 60-second timeout in `beforeAll` that read as the app
           * failing to boot — the same app booted in 373ms outside vitest.
           *
           * Symbol keys are excluded for the same reason: inspection and
           * serialisation probe them, and answering with a function makes
           * the double lie about what it is.
           */
          get: (target, prop) => {
            if (typeof prop === 'symbol' || prop === 'then') return undefined;
            return prop in target ? target[prop as string] : () => undefined;
          },
        },
      ),
    },
    {
      token: PayfastService,
      value: {
        buildRedirect: (reference: string) => {
          outbox.payments.push({ reference: String(reference) });
          return { url: 'https://sandbox.test.invalid/pay', fields: {} };
        },
        verifySignature: () => true,
      },
    },
  ];
}

export async function createTestApp(): Promise<TestContext> {
  assertTestDatabase();

  const outbox: Outbox = { emails: [], uploads: [], whatsapps: [], payments: [] };

  let builder = Test.createTestingModule({ imports: [AppModule] });
  for (const { token, value } of makeDoubles(outbox)) {
    builder = builder.overrideProvider(token).useValue(value);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();

  // The same pipe main.ts installs. Without it the DTOs do not run, and every
  // "invalid input is rejected" assertion would pass for the wrong reason.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.setGlobalPrefix('api', {
    exclude: ['health', 'health/live', 'robots.txt', 'sitemap.xml'],
  });

  await app.init();
  const prisma = app.get(PrismaService);

  return {
    app,
    prisma,
    outbox,
    http: () => request(app.getHttpServer()),
    close: async () => { await app.close(); },
  };
}

/**
 * Empty every table between tests.
 *
 * TRUNCATE … CASCADE rather than deleteMany per model: the schema has 48
 * tables with foreign keys in both directions, and a delete order that is
 * right today is wrong the first time somebody adds a relation. `_prisma_
 * migrations` is excluded, or the next run would re-migrate from nothing.
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  assertTestDatabase();
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (!rows.length) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** Registers a user through the real auth endpoint and returns its token. */
export async function signUp(
  ctx: TestContext,
  role: 'LANDLORD' | 'TENANT',
  email = `${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.invalid`,
) {
  const res = await ctx.http().post('/api/auth/register').send({
    email,
    password: 'TestPass123',
    fullName: role === 'LANDLORD' ? 'Thandi Landlord' : 'Sipho Tenant',
    role,
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`register failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  const token = res.body.accessToken ?? res.body.access_token ?? res.body.token;
  if (!token) throw new Error(`no token in register response: ${JSON.stringify(res.body)}`);
  return { email, token, userId: res.body.user?.id ?? res.body.id };
}
