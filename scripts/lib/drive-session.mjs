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
    const shown = ((await page.locator('body').textContent()) ?? '').replace(/\s+/g, ' ').slice(0, 200);
    const err = new Error(`still on ${new URL(page.url()).pathname} — ${shown}`);
    err.signInFailed = true;
    throw err;
  }
  await page.waitForTimeout(800);
  return page;
}
