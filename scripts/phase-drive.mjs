#!/usr/bin/env node
/**
 * The three phases, driven in a browser.
 *
 * scripts/smoke-test.sh proves the API answers. This proves a person can
 * reach the thing and do it. The difference is not academic — v1.69.0 shipped
 * two screens with no navigation entry, v1.70.0 shipped nine nav items that
 * went nowhere, and v1.71.0 found the portal nav was `display: none` on a
 * phone with nothing replacing it. All three passed every API check and every
 * route-level audit, because the routes were fine.
 *
 * What it drives, per phase:
 *
 *   Phase 1 (trust)        landlord verification, tenant Renter's Passport,
 *                          what a badge claims on a room page
 *   Phase 2 (tooling)      a yard created through the form, rent marked
 *                          unpaid, the tenant answering it on /tenant/rent
 *   Phase 3 (money)        the fee and the refund promise where the person
 *                          pays, no listing or application fee anywhere, and
 *                          the admin refund queue
 *
 * Accounts and the tenancy are set up over the API, because registering four
 * users through forms tests the register form four times and nothing else.
 * Everything a phase actually claims is then read off the rendered page.
 *
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/phase-drive.mjs
 *
 * Needs the API on :3000 and the site on :4200 (`npm run backend`, then
 * `npm run frontend`). Skips with a clear message rather than failing when
 * either is absent. Creates timestamped rows in the dev database.
 */
const API = process.env.API_URL ?? 'http://localhost:3000';
const WEB = process.env.WEB_URL ?? 'http://localhost:4200';
const STAMP = Date.now();
const PASSWORD = 'DrivePass123';

let pass = 0;
const failures = [];
const ok = (name) => { pass++; console.log(`  \x1b[32mPASS\x1b[0m  ${name}`); };
const bad = (name, detail = '') => {
  failures.push(name + (detail ? ` — ${detail}` : ''));
  console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail));
const section = (t) => console.log(`\n\x1b[1m── ${t}\x1b[0m`);

async function api(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

// ── is anything running ────────────────────────────────────────────────────
for (const [what, url] of [['API', `${API}/health`], ['site', WEB]]) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.log(`⏭  the ${what} at ${url} is not answering (${err.message}).`);
    process.exit(0);
  }
}

let chromium;
try { ({ chromium } = await import('@playwright/test')); }
catch { console.log('⏭  @playwright/test not installed.'); process.exit(0); }

// ── setup ──────────────────────────────────────────────────────────────────
section('Setting up: a landlord, a tenant, a let room, a live tenancy');

const register = async (role, label) => {
  const email = `${label}+${STAMP}@mastande.test`;
  const res = await api('POST', '/api/auth/register', {
    email, password: PASSWORD, fullName: `Drive ${label}`, role,
  });
  if (res.status !== 201 && res.status !== 200) {
    bad(`register a ${label}`, `${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
    return null;
  }
  return { email, token: res.body.accessToken ?? res.body.access_token, id: res.body.user?.id };
};

const landlord = await register('LANDLORD', 'landlord');
const tenant = await register('TENANT', 'tenant');
if (!landlord || !tenant) { console.log('\nCannot continue without both accounts.'); process.exit(1); }
ok('a landlord and a tenant exist');

const avail = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
const room = await api('POST', '/api/rooms', {
  roomType: 'en_suite',
  title: `Drive room ${STAMP}`,
  description: 'A room created by the phase drive, to be applied for and then let. Large, sunny, near transport.',
  rentCents: 480000, depositCents: 480000, billsIncluded: true,
  province: 'Gauteng', city: 'Springs', locationDisplay: 'Springs, Gauteng',
  availableFrom: avail, housematesCount: 2,
  couplesAllowed: false, dssAccepted: true, petsAllowed: false,
}, landlord.token);
check('a room is created', room.status === 201, `${room.status} ${JSON.stringify(room.body).slice(0, 160)}`);
const roomId = room.body?.id;

if (roomId) {
  await api('PATCH', `/api/rooms/${roomId}`, { heroImagePath: '/drive-placeholder.jpg' }, landlord.token);
  const pub = await api('POST', `/api/rooms/${roomId}/publish`, null, landlord.token);
  check('and published', pub.status === 200, `${pub.status} ${JSON.stringify(pub.body).slice(0, 160)}`);
}

const application = await api('POST', '/api/applications', {
  roomId, coverNote: 'I would like this room. Quiet, employed, can move in on the 1st.',
}, tenant.token);
check('the tenant applies', application.status === 201, `${application.status} ${JSON.stringify(application.body).slice(0, 160)}`);
const appId = application.body?.id;

let tenancyId = null;
if (appId) {
  const accepted = await api('POST', `/api/applications/${appId}/accept`, null, landlord.token);
  check('the landlord accepts', accepted.status === 200 || accepted.status === 201,
    `${accepted.status} ${JSON.stringify(accepted.body).slice(0, 160)}`);
  // Polled, not read once: accepting writes the tenancy in the same request,
  // but the first version of this drive read the list immediately afterwards
  // and got [] on one run in three. A check that fails one run in three is
  // worse than no check — people stop believing the ones that are real.
  let mine = { body: [] };
  for (let attempt = 0; attempt < 8 && !tenancyId; attempt++) {
    mine = await api('GET', '/api/tenancies/mine', null, landlord.token);
    tenancyId = Array.isArray(mine.body) ? mine.body[0]?.id : undefined;
    if (!tenancyId) await new Promise((r) => setTimeout(r, 750));
  }
  check('which opens a tenancy', Boolean(tenancyId), JSON.stringify(mine.body).slice(0, 200));
}

if (tenancyId) {
  const started = await api('POST', `/api/tenancies/${tenancyId}/confirm-start`, {}, landlord.token);
  check('the move-in is confirmed', started.status === 200 || started.status === 201,
    `${started.status} ${JSON.stringify(started.body).slice(0, 200)}`);
  const thisMonth = new Date().toISOString().slice(0, 8) + '01';
  const marked = await api('PATCH', `/api/properties/rent/${tenancyId}/mark`,
    { periodStart: thisMonth, status: 'unpaid' }, landlord.token);
  check('and this month is marked unpaid', marked.status === 200,
    `${marked.status} ${JSON.stringify(marked.body).slice(0, 200)}`);
}

// ── the browser ────────────────────────────────────────────────────────────
const browser = await chromium.launch({ args: ['--no-sandbox'] });

/** A logged-in page, signed in through the form like a person would. */
async function signIn(email, password, width = 412) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${WEB}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  // `ng serve` puts a full-page overlay over the app when the last rebuild
  // failed, and it swallows every click underneath it. Without this the drive
  // times out on "click the login button" and says nothing about the compile
  // error that is the actual problem.
  if (await page.locator('vite-error-overlay').count()) {
    console.log('\n⏭  the dev server is showing a build error overlay — fix the build and re-run.');
    await browser.close();
    process.exit(2);
  }
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  return page;
}

const text = async (page) => (await page.locator('body').textContent()) ?? '';
const visit = async (page, path, wait = 1800) => {
  await page.goto(WEB + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(wait);
  return text(page);
};

// ══ PHASE 1 ════════════════════════════════════════════════════════════════
section('Phase 1 — trust: what a badge is allowed to claim');

const lPage = await signIn(landlord.email, PASSWORD);
const afterLogin = new URL(lPage.url()).pathname;
check('a landlord lands in their own portal after signing in',
  afterLogin.startsWith('/landlord'), `landed on ${afterLogin}`);

const verifyText = await visit(lPage, '/landlord/verification');
check('the landlord verification screen loads', /verif/i.test(verifyText), verifyText.slice(0, 160));
check('it names the R149 identity fee', /R\s?149/.test(verifyText),
  'no "R149" anywhere on the page a landlord pays on');
check('and says what happens if the check fails',
  /refund/i.test(verifyText), 'the refund promise is not on the screen that takes the money');
check('it says documents are deleted, not kept',
  /delete/i.test(verifyText), 'POPIA retention is not stated where the document is asked for');

// The submit control is the file input's own label — choosing a file starts
// the upload. So count inputs, not buttons; an earlier version of this drive
// looked for a <button> and reported a working screen as broken.
const idInputs = await lPage.locator('input[type="file"]').count();
check('there is a way to submit an identity document', idInputs > 0,
  'no file input on the verification screen');

const tPage = await signIn(tenant.email, PASSWORD);
const passportText = await visit(tPage, '/tenant/passport');
check("the tenant's Renter's Passport loads", /passport/i.test(passportText), passportText.slice(0, 160));
check('it offers the informal-economy checks',
  /sassa/i.test(passportText) && /employ/i.test(passportText), 'SASSA and employer confirmation are not both offered');
check('and it is free for a tenant',
  /free/i.test(passportText) && !/R\s?149/.test(passportText),
  'a tenant screen either fails to say it is free or quotes a fee');

if (roomId) {
  const roomText = await visit(tPage, `/rooms/${roomId}`);
  check('a room page loads for a signed-in tenant', roomText.length > 400);
  check('it says who is letting the room', /who is letting/i.test(roomText),
    'the room page never names the landlord');
  // Either a checked identity or an explicit "not verified" — silence reads
  // as "fine", and this page had exactly that: no badge, no name, no basis.
  check('and states their verification either way',
    /(✓ Verified|Identity not verified)/.test(roomText),
    'no verification state on the page a tenant decides on');
}

const refText = await visit(tPage, '/reference/not-a-real-token');
check('a dead reference link fails gracefully rather than blank',
  refText.trim().length > 200 && /(expired|invalid|not valid|not found|no longer)/i.test(refText),
  refText.slice(0, 200));

// ══ PHASE 2 ════════════════════════════════════════════════════════════════
section('Phase 2 — landlord tooling: a yard, and rent somebody can answer');

const yardText = await visit(lPage, '/landlord/yard');
check('the yard screen loads', /yard|propert/i.test(yardText), yardText.slice(0, 160));

// Create a property through the form, not the API.
// Scoped to the portal's own main region: the footer carries a "Create
// account" link that matched a looser locator and took the drive to the
// register form, which then failed on a disabled submit button.
const addYard = lPage.locator('.portal-main button, .portal-main a')
  .filter({ hasText: /yard|group rooms|add|new/i }).first();
if (await addYard.count()) {
  await addYard.click();
  await lPage.waitForTimeout(900);
  const nameField = lPage.locator('.portal-main input[name="name"]:visible').first();
  if (await nameField.count()) {
    // Name, city and province are all required — filling only the first text
    // input made the form refuse, and the first version of this drive read
    // that refusal as "the yard did not appear on the page".
    await nameField.fill(`Drive yard ${STAMP}`);
    await lPage.locator('.portal-main input[name="city"]:visible').first().fill('Springs');
    await lPage.locator('.portal-main input[name="province"]:visible').first().fill('Gauteng');
    const save = lPage.locator('.portal-main button:visible').filter({ hasText: /save|add|create|group/i }).first();
    await save.click();
    await lPage.waitForTimeout(2200);
    const after = await text(lPage);
    check('a yard created through the form appears on the page',
      after.includes(`Drive yard ${STAMP}`), 'saved, but the new yard is not on the screen');
  } else {
    bad('the yard form has a name field to fill');
  }
} else {
  bad('the yard screen offers a way to add one');
}

const yardAgain = await visit(lPage, '/landlord/yard');
check('the landlord can find the rent reminder setting', /rent reminders/i.test(yardAgain),
  'no reminder or grace-period control anywhere in the yard');
// Setting it to 0 is how a landlord turns reminders off — the one thing the
// grace period exists for that cannot be done any other way.
const graceInput = lPage.locator('#grace-days');
if (await graceInput.count()) {
  await graceInput.fill('0');
  await lPage.locator('.rent-reminders button').filter({ hasText: /save/i }).first().click();
  await lPage.waitForTimeout(1800);
  const saved = await text(lPage);
  check('and can turn reminders off by setting it to 0',
    /reminders are off/i.test(saved), 'saved, but the page does not confirm reminders are off');
} else {
  bad('the reminder control has a number field');
}

const tenantRent = await visit(tPage, '/tenant/rent');
check('the tenant rent screen loads', /rent/i.test(tenantRent), tenantRent.slice(0, 160));
check('it shows the month the landlord marked unpaid',
  /unpaid/i.test(tenantRent), 'a month was marked unpaid over the API and the tenant cannot see it');
check('and it says Mastande has not checked any of it',
  /(does not handle|has not checked|not verified)/i.test(tenantRent),
  'the screen presents the landlord\'s record without saying whose claim it is');

const disputeBtn = tPage.locator('.portal-main button')
  .filter({ hasText: /I've paid|I have paid|disput|disagree/i }).first();
if (await disputeBtn.count()) {
  await disputeBtn.click();
  await tPage.waitForTimeout(800);
  const note = tPage.locator('textarea:visible, input[type="text"]:visible').first();
  if (await note.count()) await note.fill('Paid on the 3rd by EFT, reference DRIVE.');
  const confirm = tPage.locator('.portal-main button:visible').filter({ hasText: /send this|send|submit|confirm/i }).first();
  await confirm.click();
  await tPage.waitForTimeout(2200);
  const afterDispute = await text(tPage);
  check('the tenant can answer it from the screen',
    /(disputed|you said|your answer|awaiting)/i.test(afterDispute),
    'the dispute button ran but the page does not show the answer was recorded');
  if (tenancyId) {
    const history = await api('GET', `/api/properties/rent/${tenancyId}`, null, landlord.token);
    const rows = Array.isArray(history.body) ? history.body : history.body?.periods ?? [];
    check('and the landlord sees the answer against that month, in the API',
      rows.some((p) => p.tenantDisputedAt), JSON.stringify(history.body).slice(0, 220));
  }
} else {
  bad('the tenant rent screen offers a way to disagree with a month');
}

const draftsText = await visit(lPage, '/landlord/dashboard');
check('the landlord dashboard mentions the WhatsApp route into a listing',
  /whatsapp/i.test(draftsText), 'nothing on the dashboard tells a landlord they can send a room by WhatsApp');

// ══ THE NAV, ON EVERY SCREEN ═══════════════════════════════════════════════
section('The portal nav — the same on every screen of a portal, or it is wrong');

/** The sidebar's own links, in order, as rendered. */
async function navLabels(page, path) {
  await visit(page, path, 1600);
  return page.locator('.portal-nav .portal-nav-link').evaluateAll((els) =>
    els
      .map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter((t) => t && !/^↪/.test(t)),
  );
}

for (const [role, page, paths] of [
  ['landlord', lPage, ['/landlord/dashboard', '/landlord/yard', '/landlord/verification', '/account/settings']],
  ['tenant', tPage, ['/tenant/dashboard', '/tenant/rent', '/tenant/passport', '/account/settings']],
]) {
  const seen = new Map();
  for (const path of paths) seen.set(path, await navLabels(page, path));
  const [firstPath, firstLabels] = [...seen.entries()][0];
  // Compare the set of destinations, not the badge numbers in them: the
  // dashboard's items carry counts the other screens do not know.
  const strip = (labels) => labels.map((l) => l.replace(/\s*\d+$/, '').replace(/\s*Soon$/, '').trim());
  const want = strip(firstLabels).join(' | ');
  console.log(`  ${role}: ${want || '(none)'}`);
  for (const [path, labels] of seen) {
    const got = strip(labels).join(' | ');
    check(`the ${role} nav is the same on ${path}`, got === want,
      got ? `has ${strip(labels).length} items, ${firstPath} has ${strip(firstLabels).length}: ${got}` : 'no nav rendered');
  }
}

// ══ PHASE 3 ════════════════════════════════════════════════════════════════
section('Phase 3 — money: one fee, one promise, and no fee anywhere else');

const anon = await browser.newPage({ viewport: { width: 412, height: 900 } });
const pricing = await visit(anon, '/pricing');
check('the pricing page loads', pricing.length > 500);
check('it says listing is free', /free to list|list(ing)? (is )?free|no listing fee/i.test(pricing),
  'the free-to-list position is not stated on the pricing page');
check('and that applying is free', /free to apply|appl(y|ication)[^.]{0,40}free|no application fee/i.test(pricing),
  'the free-to-apply position is not stated on the pricing page');
check('it quotes the one thing that is paid', /R\s?149/.test(pricing),
  'the R149 identity check is not on the pricing page');
check('and keeps the refund promise in writing', /refund/i.test(pricing));

const feeWords = /(listing fee|posting fee|application fee|admin fee)/gi;
const claims = [...pricing.matchAll(feeWords)].map((m) => m[0].toLowerCase());
const chargesForListing = claims.some((c) => (c === 'listing fee' || c === 'posting fee' || c === 'application fee')
  && !new RegExp(`no ${c}|${c}[^.]{0,20}free|free[^.]{0,20}${c}`, 'i').test(pricing));
check('no page charges for listing or applying', !chargesForListing, claims.join(', '));

const advertise = await visit(anon, '/advertise');
check('the advertising page loads', /advertis/i.test(advertise), advertise.slice(0, 160));

const adminPage = process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD
  ? await signIn(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, 1280)
  : null;
if (adminPage) {
  const dash = await visit(adminPage, '/admin/dashboard');
  check('the admin dashboard loads', /admin|dashboard/i.test(dash), dash.slice(0, 160));
  // The section is conditional on there being something owed, which is right.
  // So ask the API what is owed first and only then require it on the page:
  // asserting the word "refund" against an empty queue tests nothing, and
  // reporting an empty queue as a missing feature is worse than that.
  const adminLogin = await api('POST', '/api/auth/login',
    { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  const adminToken = adminLogin.body?.accessToken;
  const owed = await api('GET', '/api/payments/refunds-due', null, adminToken);
  const owedRows = Array.isArray(owed.body) ? owed.body.length : null;
  if (owedRows && owedRows > 0) {
    check('the refund queue is on the dashboard, not only in the API', /refund/i.test(dash),
      `${owedRows} refund(s) owed and the dashboard does not mention them`);
  } else {
    console.log('  \x1b[90mSKIP\x1b[0m  refund queue on the dashboard — nothing is owed right now');
  }
  const verifs = await visit(adminPage, '/admin/verifications');
  check('the verification queue loads', /verif/i.test(verifs), verifs.slice(0, 160));
  await adminPage.close();
} else {
  console.log('  \x1b[90mSKIP\x1b[0m  admin screens — set ADMIN_EMAIL and ADMIN_PASSWORD\x1b[0m');
}

await anon.close();
await lPage.close();
await tPage.close();
await browser.close();

console.log('');
if (failures.length) {
  console.log(`\x1b[31m${failures.length} failed\x1b[0m, ${pass} passed:`);
  failures.forEach((f) => console.log('   • ' + f));
  process.exit(1);
}
console.log(`\x1b[32mAll ${pass} checks passed — all three phases are reachable and do what they claim.\x1b[0m`);
