import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { createTestApp, resetDatabase, resetRateLimits, signUp, signUpAdmin, type TestContext } from './support/test-app';

/**
 * API contract sweeps, driven off the real inventory.
 *
 * ── Why a sweep and not a list
 *
 * There are 236 routes. A file with one hand-written test per route is the
 * defect CLAUDE.md names in so many words — "a row-shaped check only ever
 * finds what somebody thought to list" — and it is wrong the first time
 * somebody adds a route, silently. So the inventory is read out of the
 * controllers at test time by `scripts/api-inventory.mjs`, and every
 * assertion below runs over whatever that returns. A route added tomorrow is
 * swept tomorrow, with no edit here.
 *
 * ⚠️ Guards run BEFORE pipes in Nest's pipeline, which is what makes these
 * sweeps safe to run against every route including the destructive ones: a
 * request that fails authorization is refused before any handler, any DTO
 * validation and any database write. The sweeps below send no valid
 * credentials to a route they do not own, so nothing they touch can commit.
 */

interface Route {
  method: string;
  path: string;
  file: string;
  guards: string[];
  authGuards: string[];
  public: boolean;
  optionalAuth: boolean;
  admin: boolean;
  oauth: boolean;
  throttle: string | null;
  bodyDto: string | null;
  pathParams: string[];
  summary: string;
}

/** Read the inventory from source, never from a committed copy of it. */
function inventory(): Route[] {
  const script = resolve(__dirname, '../../scripts/api-inventory.mjs');
  const out = execFileSync('node', [script, '--json'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(out).routes as Route[];
}

const SAMPLE_UUID = '00000000-0000-4000-8000-000000000000';

/** `/api/rooms/:id` → `/api/rooms/00000000-…`. Everything else is left alone. */
function concrete(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, SAMPLE_UUID);
}

/**
 * ⚠️ Strings that must never reach a client.
 *
 * Not a vague "looks like a stack trace" — each of these is a specific thing
 * this stack can leak. `at Object.` and `node_modules` are V8 frames;
 * `PrismaClient` and `prisma.` name the ORM and, with it, the schema; a
 * `postgresql://` string is a credential; `JWT_SECRET` and the configured
 * secret's own value would be game over. A 500 that says "Internal server
 * error" is fine; a 500 that says which table is not.
 */
const LEAKS: [string, RegExp][] = [
  ['a V8 stack frame', /\n\s*at [A-Za-z0-9_$.<>]+ \(/],
  ['a node_modules path', /node_modules[/\\]/],
  ['the Prisma client', /PrismaClient|prisma\.[a-z]+\.(find|create|update|delete)/i],
  ['a database connection string', /postgres(ql)?:\/\//i],
  ['raw SQL', /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b.*\b(FROM|SET|VALUES)\b/i],
  ['a JWT secret', /JWT_SECRET|test-secret-minimum/i],
  ['an internal file path', /\/home\/|\/app\/src\/|\.ts:\d+:\d+/],
];

function assertNoLeak(label: string, status: number, body: unknown, text: string) {
  const blob = `${typeof body === 'string' ? body : JSON.stringify(body ?? {})}\n${text ?? ''}`;
  for (const [what, re] of LEAKS) {
    expect(re.test(blob), `${label} (${status}) leaked ${what}: ${blob.slice(0, 400)}`).toBe(false);
  }
}

describe('API contract sweeps', () => {
  let ctx: TestContext;
  let routes: Route[];

  beforeAll(async () => {
    routes = inventory();
    ctx = await createTestApp();
  }, 120_000);
  afterAll(async () => { await ctx?.close(); });

  const send = (method: string, path: string) => {
    const agent = ctx.http();
    const verb = method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete' | 'put';
    return agent[verb](path);
  };

  it('reads a real inventory, or the sweeps below mean nothing', () => {
    // ⚠️ The guard on the guards. Every sweep in this file iterates a list; a
    // list that came back empty, or short, would make all of them pass while
    // testing nothing — the vacuous green this codebase keeps finding.
    expect(routes.length).toBeGreaterThan(200);
    expect(routes.filter((r) => !r.public && !r.optionalAuth).length).toBeGreaterThan(150);
    expect(routes.filter((r) => r.admin).length).toBeGreaterThan(50);
    expect(routes.every((r) => r.path.startsWith('/api/'))).toBe(true);
  });

  // ── Step 5: unauthenticated requests ──────────────────────────────────────

  it('refuses every guarded route to a caller with no credentials', async () => {
    await resetDatabase(ctx.prisma);
    await resetRateLimits(ctx);

    /**
     * ⚠️ The OAuth callback is excluded, with a reason rather than silently.
     * `GET /api/auth/google/callback` carries passport's `AuthGuard('google')`,
     * whose whole job is to answer an unauthenticated caller — that is the
     * return leg of the sign-in, and it redirects (302). Asserting 401 there
     * would fail a correct route, and quietly dropping it would leave a hole
     * in the sweep that nothing records. It is asserted separately below.
     */
    const guarded = routes.filter((r) => !r.public && !r.optionalAuth && !r.oauth);
    const wrong: string[] = [];

    for (const r of guarded) {
      const res = await send(r.method, concrete(r.path));
      // 401 is the honest answer. 403 is accepted because a few routes layer a
      // role guard that answers first. Anything else — a 200, a 404 that
      // reveals the route ran, a 500 — is a hole.
      if (res.status !== 401 && res.status !== 403) {
        wrong.push(`${r.method} ${r.path} -> ${res.status} (${r.authGuards.join('+')}) [${r.file}]`);
      }
      assertNoLeak(`${r.method} ${r.path}`, res.status, res.body, res.text);
    }

    expect(wrong, `${wrong.length} of ${guarded.length} guarded routes answered a signed-out caller:\n${wrong.join('\n')}`)
      .toEqual([]);
    expect(guarded.length).toBeGreaterThan(150);
  }, 300_000);

  it('redirects rather than crashes on the OAuth callback, and starts no session', async () => {
    const oauth = routes.filter((r) => r.oauth);
    expect(oauth.length).toBe(1);
    const res = await send(oauth[0].method, oauth[0].path);
    // A redirect back to the provider or to an error page. Never a 500, and
    // never a token: a callback that mints a session for a caller with no
    // authorization code would be the whole sign-in bypassed.
    expect([302, 401, 403]).toContain(res.status);
    expect(JSON.stringify(res.body ?? {})).not.toMatch(/accessToken|access_token/i);
    expect(res.headers['set-cookie'] ?? []).toEqual([]);
    assertNoLeak('oauth callback', res.status, res.body, res.text);
  }, 60_000);

  // ── Step 5: privilege escalation ──────────────────────────────────────────

  it('refuses every admin route to an ordinary signed-in account', async () => {
    await resetDatabase(ctx.prisma);
    await resetRateLimits(ctx);
    const tenant = await signUp(ctx, 'TENANT');

    const adminRoutes = routes.filter((r) => r.admin);
    const wrong: string[] = [];

    for (const r of adminRoutes) {
      const res = await send(r.method, concrete(r.path))
        .set({ Authorization: `Bearer ${tenant.token}` });
      // 403 from AdminGuard. 401 would mean the token was rejected outright,
      // which is also a refusal. A 2xx is an escalation.
      if (res.status !== 403 && res.status !== 401) {
        wrong.push(`${r.method} ${r.path} -> ${res.status} [${r.file}]`);
      }
      assertNoLeak(`${r.method} ${r.path}`, res.status, res.body, res.text);
    }

    expect(wrong, `${wrong.length} of ${adminRoutes.length} admin routes answered an ordinary account:\n${wrong.join('\n')}`)
      .toEqual([]);
    expect(adminRoutes.length).toBeGreaterThan(50);
  }, 300_000);

  it('refuses every admin route to a LANDLORD too', async () => {
    // A landlord is the most privileged ordinary role in this product and the
    // one most likely to be mistaken for staff by a careless guard.
    await resetDatabase(ctx.prisma);
    await resetRateLimits(ctx);
    const landlord = await signUp(ctx, 'LANDLORD');

    const wrong: string[] = [];
    for (const r of routes.filter((x) => x.admin)) {
      const res = await send(r.method, concrete(r.path))
        .set({ Authorization: `Bearer ${landlord.token}` });
      if (res.status !== 403 && res.status !== 401) wrong.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    expect(wrong).toEqual([]);
  }, 300_000);

  it('accepts the admin routes for an actual admin, so the sweep above is not vacuous', async () => {
    /**
     * ⚠️ THE CONTROL FOR THE TWO SWEEPS ABOVE.
     *
     * "Everything returns 403" would also be true if the token were simply
     * never accepted, if the routes did not exist, or if the paths were
     * misspelt — and both sweeps would pass. So a real admin must get past
     * the guard on a sample of the same routes, with the same path
     * substitution, proving the 403s above were decisions and not accidents.
     */
    await resetDatabase(ctx.prisma);
    await resetRateLimits(ctx);
    const admin = await signUpAdmin(ctx);

    const readable = routes.filter((r) => r.admin && r.method === 'GET' && r.pathParams.length === 0);
    expect(readable.length).toBeGreaterThan(5);

    let reached = 0;
    for (const r of readable) {
      const res = await send(r.method, r.path).set({ Authorization: `Bearer ${admin.token}` });
      // Past the guard is what matters: a 200, or a 400 about parameters.
      // A 403 would mean the admin was refused, which is the vacuity.
      expect([200, 201, 400, 404], `${r.method} ${r.path} -> ${res.status}`).toContain(res.status);
      if (res.status < 400) reached++;
      assertNoLeak(`${r.method} ${r.path}`, res.status, res.body, res.text);
    }
    expect(reached, 'no admin route answered an admin — the 403 sweeps prove nothing').toBeGreaterThan(3);
  }, 300_000);

  // ── Step 3: malformed identifiers ─────────────────────────────────────────

  it('answers a malformed id with 400, never 500', async () => {
    await resetDatabase(ctx.prisma);
    await resetRateLimits(ctx);
    const tenant = await signUp(ctx, 'TENANT');

    // Routes a signed-in ordinary account reaches, that take an id in the path.
    const withId = routes.filter(
      (r) => !r.admin && !r.public && r.pathParams.some((p) => /id$/i.test(p)),
    );
    expect(withId.length).toBeGreaterThan(10);

    const wrong: string[] = [];
    for (const r of withId) {
      const path = r.path.replace(/:([A-Za-z0-9_]+)/g, 'not-a-uuid');
      const res = await send(r.method, path).set({ Authorization: `Bearer ${tenant.token}` });
      // 400 from ParseUUIDPipe is the expected answer. 403/404 are acceptable
      // when ownership is decided first. A 500 is a crash on hostile input.
      if (res.status >= 500) wrong.push(`${r.method} ${r.path} -> ${res.status} [${r.file}]`);
      assertNoLeak(`${r.method} ${path}`, res.status, res.body, res.text);
    }
    expect(wrong, `routes that crashed on a malformed id:\n${wrong.join('\n')}`).toEqual([]);
  }, 300_000);

  // ── Step 3: unsupported methods ───────────────────────────────────────────

  it('answers an unsupported method with 404, not a crash', async () => {
    await resetRateLimits(ctx);
    for (const [method, path] of [
      ['DELETE', '/api/rooms'],
      ['PATCH', '/api/health'],
      ['POST', '/api/rooms/categories'],
      ['PUT', '/api/auth/login'],
      ['DELETE', '/api/places/suggest'],
    ] as [string, string][]) {
      const res = await send(method, path);
      expect([401, 403, 404, 405], `${method} ${path} -> ${res.status}`).toContain(res.status);
      assertNoLeak(`${method} ${path}`, res.status, res.body, res.text);
    }
  });

  // ── Step 4: error bodies are safe ─────────────────────────────────────────

  it('keeps internals out of error bodies on deliberately hostile input', async () => {
    await resetDatabase(ctx.prisma);
    await resetRateLimits(ctx);
    const tenant = await signUp(ctx, 'TENANT');
    const auth = { Authorization: `Bearer ${tenant.token}` };

    /**
     * ⚠️ Thunks, not promises, and the first run is why. Building ten
     * supertest requests up front starts ten `listen(0)` calls on the same
     * server at once; one of them loses the race and the test dies with
     * "Cannot read properties of null (reading 'address')" — which reads as
     * the API crashing on hostile input when it is the test harness racing
     * itself. Each probe is now created and awaited in turn.
     */
    const probes: [string, () => Promise<any>][] = [
      ['malformed JSON', () => ctx.http().post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":')],
      ['wrong content type', () => ctx.http().post('/api/auth/login').set('Content-Type', 'text/plain').send('email=x')],
      ['SQL in a field', () => ctx.http().post('/api/auth/login').send({ email: "' OR 1=1 --", password: "'; DROP TABLE users; --" })],
      ['a string where an object belongs', () => ctx.http().post('/api/properties').set(auth).send('"not-an-object"')],
      ['an array where an object belongs', () => ctx.http().post('/api/properties').set(auth).send([1, 2, 3])],
      ['a null body', () => ctx.http().post('/api/properties').set(auth).send(null as any)],
      ['a numeric query where a string belongs', () => ctx.http().get('/api/rooms?city[]=1&city[]=2')],
      ['a negative page', () => ctx.http().get('/api/rooms?page=-5&limit=-1')],
      ['an enormous page', () => ctx.http().get('/api/rooms?page=999999999999&limit=999999999')],
      ['a unicode bomb in search', () => ctx.http().get(`/api/rooms?search=${encodeURIComponent('𝕏'.repeat(500))}`)],
    ];

    for (const [label, make] of probes) {
      const res = await make();
      expect(res.status, `${label} -> ${res.status}`).toBeLessThan(500);
      assertNoLeak(label, res.status, res.body, res.text);
    }

    // The users table must still be there after the injection probe.
    expect(await ctx.prisma.user.count()).toBeGreaterThan(0);
  }, 120_000);

  // ── Step 3: pagination is bounded ─────────────────────────────────────────

  it('bounds page and limit on the public board, and answers 400 rather than 500', async () => {
    /**
     * 🔴 A DEFECT THIS SUITE FOUND. `GET /api/rooms?page=999999999999&limit=999999999`
     * returned 500 to an anonymous caller on the busiest route in the product:
     * `skip = (page - 1) * limit` is about 1e21, far past what Postgres will
     * take for an OFFSET, so Prisma threw. Either parameter alone was fine,
     * which is why nothing had ever hit it.
     *
     * And `limit` had no maximum at all, so one request could ask for every
     * active row on the board.
     */
    await resetRateLimits(ctx);

    const overflow = await ctx.http().get('/api/rooms?page=999999999999&limit=999999999');
    expect(overflow.status, 'the overflow pair must be refused, not crash').toBe(400);
    assertNoLeak('pagination overflow', overflow.status, overflow.body, overflow.text);

    expect((await ctx.http().get('/api/rooms?limit=999999999')).status).toBe(400);
    expect((await ctx.http().get('/api/rooms?limit=101')).status).toBe(400);
    expect((await ctx.http().get('/api/rooms?page=100001')).status).toBe(400);

    // ⚠️ And the other side of the boundary, or the assertions above would
    // pass just as well if the board refused everything.
    expect((await ctx.http().get('/api/rooms?limit=100')).status).toBe(200);
    expect((await ctx.http().get('/api/rooms?page=100000&limit=100')).status).toBe(200);
    const normal = await ctx.http().get('/api/rooms?page=1&limit=12');
    expect(normal.status).toBe(200);
    expect(normal.body.limit).toBe(12);
  }, 120_000);

  // ── Step 3: excessively large input ───────────────────────────────────────

  it('refuses an excessively large body without crashing', async () => {
    await resetRateLimits(ctx);
    const huge = 'x'.repeat(2 * 1024 * 1024); // 2MB against Express's 100kb default
    const res = await ctx.http().post('/api/reports')
      .send({ roomId: SAMPLE_UUID, reason: 'other', details: huge, contactEmail: 'big@test.invalid' });

    // 413 from the body parser, or 400. Never a 500, and never a success.
    expect([400, 413], `2MB body -> ${res.status}`).toContain(res.status);
    assertNoLeak('2MB body', res.status, res.body, res.text);
    expect(await ctx.prisma.report.count()).toBe(0);
  }, 120_000);

  // ── Step 3: unexpected fields, everywhere the pipe applies ────────────────

  it('rejects an unexpected field on the routes a signed-out caller can reach', async () => {
    await resetDatabase(ctx.prisma);
    await resetRateLimits(ctx);

    // forbidNonWhitelisted is global, so this is a contract and not a
    // per-route courtesy. Checked on public POSTs because they need no
    // ownership set-up; the domain specs check it inside each workflow.
    const cases: [string, Record<string, unknown>][] = [
      ['/api/auth/login', { email: 'nobody@test.invalid', password: 'TestPass123', isAdmin: true }],
      ['/api/auth/register', { email: 'x@test.invalid', password: 'TestPass123', fullName: 'X', role: 'TENANT', role2: 'ADMIN' }],
      ['/api/auth/forgot-password', { email: 'x@test.invalid', resetToken: 'given-to-me-please' }],
    ];

    for (const [path, body] of cases) {
      const res = await ctx.http().post(path).send(body);
      expect(res.status, `${path} accepted an unknown field (${res.status})`).toBe(400);
      assertNoLeak(path, res.status, res.body, res.text);
    }

    // ⚠️ And the control: the same requests WITHOUT the extra field must not
    // be 400, or the assertion above would pass on a body that was invalid
    // for some entirely different reason.
    const ok = await ctx.http().post('/api/auth/register')
      .send({ email: `sweep-${Date.now()}@test.invalid`, password: 'TestPass123', fullName: 'Sweep', role: 'TENANT' });
    expect([200, 201]).toContain(ok.status);
  }, 120_000);
});
