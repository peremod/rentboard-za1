import { execSync } from 'node:child_process';
/**
 * Shared plumbing for the browser drives — scripts/phase-drive.mjs and
 * scripts/a11y-drive.mjs.
 *
 * Extracted rather than copied. This repo has already paid for the other
 * choice once: the portal nav was defined six times, the copies disagreed, and
 * the sidebar shrank as a person moved through their own portal (checklist row
 * 21). A sign-in helper duplicated across two drives is the same shape of
 * mistake, and the second copy is always the one that does not get the fix.
 */
const PASSWORD = 'DrivePass123';

export { PASSWORD };

/** A JSON call to the API, returning status and parsed body rather than throwing. */
export async function apiCall(base, method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

/**
 * Register a throwaway account over the API.
 *
 * Over the API and not through the form on purpose: registering four users
 * through the register form tests the register form four times and nothing
 * else. What a drive is for is the screen after that.
 */
export async function registerUser(base, role, stamp = Date.now()) {
  const email = `drive-${role.toLowerCase()}+${stamp}-${Math.floor(Math.random() * 1e4)}@mastande.test`;
  const res = await apiCall(base, 'POST', '/api/auth/register', {
    email,
    password: PASSWORD,
    fullName: `Drive ${role[0]}${role.slice(1).toLowerCase()}`,
    role,
  });
  if (res.status >= 300) {
    throw new Error(`register ${role} failed: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return {
    email,
    password: PASSWORD,
    token: res.body.accessToken ?? res.body.access_token,
    id: res.body.user?.id,
  };
}

/**
 * A signed-in page, through the form like a person would.
 *
 * Waits for the navigation rather than guessing at how long it takes: a fixed
 * 2.5s passes on a laptop and is a coin toss on a CI runner, and a check that
 * fails one run in five gets ignored like any other alarm that cries wolf.
 */
export async function signIn(browser, web, email, password, { width = 412, height = 900 } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });

  /** Requests the browser could not complete — the diagnosis when sign-in fails. */
  const failedRequests = [];
  page.on('requestfailed', (req) => failedRequests.push(req.url()));

  await page.goto(`${web}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  // `ng serve` covers the app with a full-page overlay when the last rebuild
  // failed, and it swallows every click underneath. Without this the drive
  // times out on "click the login button" and says nothing about the compile
  // error that is the actual problem.
  if (await page.locator('vite-error-overlay').count()) {
    const err = new Error('the dev server is showing a build error overlay');
    err.buildOverlay = true;
    throw err;
  }

  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');

  try {
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/login'), { timeout: 20000 });
  } catch {
    // Name the request that failed, not just the screen.
    //
    // "could not sign in (still on /auth/login)" reads as an auth bug, and
    // twice it was not one: the served bundle had been built for production,
    // so the browser was calling https://api.umastande.co.za, which is not
    // reachable from a development machine. Both times that cost a debugging
    // cycle chasing credentials. The origin the page actually tried is the
    // whole answer, so it belongs in the message.
    const origins = [...new Set(failedRequests.map((u) => {
      try { return new URL(u).origin; } catch { return u; }
    }))];
    const shown = ((await page.locator('body').textContent()) ?? '').replace(/\s+/g, ' ').slice(0, 160);
    const blocked = origins.length
      ? ` — the page could not reach ${origins.join(', ')}; if that is not the API you are running, the served bundle was built for a different environment`
      : '';
    const err = new Error(`still on ${new URL(page.url()).pathname}${blocked} — ${shown}`);
    err.signInFailed = true;
    throw err;
  }
  await page.waitForTimeout(800);
  return page;
}

/**
 * One row, one column, straight out of Postgres.
 *
 * Four drives had their own copy of this, which is how the next paragraph
 * stayed a bug in one of them for a release.
 *
 * ⚠️ `psql -tAc` prints the result AND the command tag: an
 * `INSERT … RETURNING id` comes back as `"<uuid>\nINSERT 0 1\n"`. A plain
 * `.trim()` therefore yields an id with a newline and `INSERT 0 1` stuck to the
 * end of it — and because every `id` column here is TEXT rather than `uuid`
 * (Prisma's `String @id`), Postgres does not reject the malformed value. It
 * simply matches nothing. So `otp-drive.mjs` had been leaving its throwaway
 * account behind on every run, silently, and the cleanup it reported doing had
 * never happened. It only surfaced when a route with a `ParseUUIDPipe` was
 * handed the same string and said so.
 *
 * Hence the first line, explicitly.
 */
export function dbQuery(sql) {
  const url = process.env.DATABASE_URL
    ?? 'postgresql://rentboard:rentboard@localhost:5432/rentboard_dev';
  const out = execSync(`psql "${url}" -tAc ${JSON.stringify(sql)}`, { encoding: 'utf8' });
  return out.trim().split('\n')[0].trim();
}
