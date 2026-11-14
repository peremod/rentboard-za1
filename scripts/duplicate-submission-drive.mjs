#!/usr/bin/env node
/**
 * The second tap — what happens when somebody presses a button twice.
 *
 *   node scripts/duplicate-submission-drive.mjs
 *
 * Needs the API on :3000 and a development build served on :4200.
 *
 * ── Why this exists
 *
 * `double-let-drive.mjs` races two acceptances of the same ROOM — two
 * different applicants — and that is the expensive one, so it was written
 * first. What nothing covered was one person pressing one button twice, which
 * is the common one: a cheap Android with a laggy screen, a tap that does not
 * seem to have registered, so you tap again.
 *
 * 🔴 It found a real defect, and the measurement is worth keeping because the
 * data was never wrong:
 *
 *     two applications arriving together  ->  201 and **500**
 *
 * `applications.service.ts create()` read "has this tenant applied?" with
 * `findUnique` and then wrote with `create`. Two requests both read "no", both
 * inserted, one won, and the other violated `roomId_tenantId_cycle`. Nothing
 * caught the Prisma error, so it surfaced as a 500 — and the tenant was told
 * the server had broken when what had happened was that they had already
 * applied, a situation the service has a sentence for one branch above. A 500
 * in the log is also indistinguishable from a real fault, which is the
 * reasoning `rooms.controller.ts` already records for turning a bad
 * `?placement=` into a 400.
 *
 * It answers 409 now, the same as the sequential path, because to the person
 * they are the same thing.
 *
 * ── ⚠️ What the UI guard does and does not do, measured
 *
 * The Apply button is already `[disabled]="applying()"`, and for a human that
 * is enough. Measured at three speeds:
 *
 *     two clicks in ONE JS task   ->  2 POSTs   (the signal has not been
 *                                                rendered to the attribute yet)
 *     80ms apart (a real thumb)   ->  1 POST
 *     250ms apart                 ->  1 POST
 *
 * So the UI guard is not broken and this drive does not claim it is. The
 * server guard is the one that was, and it has to hold anyway: a retry on a
 * dropped connection, two tabs, or a shared phone can all produce the pair
 * without anybody tapping twice.
 *
 * ── ⚠️ And what the first section does NOT isolate
 *
 * It asserts the OUTCOME — one application from two taps — not which
 * mechanism produces it. Removing `[disabled]="applying()"` from the apply
 * button and rebuilding changes nothing at thumb speed: still one POST,
 * measured three ways (a held element reference, a re-queried element, and two
 * ordinary Playwright clicks 80ms apart). Something else in room-detail.ts is
 * doing the work — the label changing to "Sending…" means a re-queried button
 * no longer matches, and the component renders more than one apply control —
 * and this drive does not say which.
 *
 * Recorded rather than dressed up: the end-to-end claim is the one a person
 * cares about and it is true, but anybody reading this for "the disabled
 * binding is under test" would be wrong. Isolating it needs a unit test on the
 * component, not a browser drive.
 */
import { chromium } from 'playwright';
import { registerUser, signIn, apiCall, PASSWORD } from './lib/drive-session.mjs';

const API = process.env.API_URL ?? 'http://localhost:3000';
const WEB = process.env.WEB ?? 'http://localhost:4200';

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const check = (c, m) => (c ? ok(m) : bad(m));

async function section(name, body) {
  console.log(`\n── ${name} ──`);
  try { await body(); } catch (err) {
    bad(`${name} could not run: ${String(err?.message ?? err).replace(/\s+/g, ' ').slice(0, 180)}`);
  }
}

const landlord = await registerUser(API, 'LANDLORD');

/** A published room, through the real endpoints. */
async function publishedRoom(title) {
  const r = await apiCall(API, 'POST', '/api/rooms', {
    roomType: 'shared_house', title, rentCents: 250000,
    province: 'Gauteng', city: 'Johannesburg', locationDisplay: 'Soweto',
    availableFrom: new Date(Date.now() + 864e5).toISOString(),
    housematesCount: 2, billsIncluded: true,
    description: 'A clean single room in a quiet Soweto yard with a shared kitchen, an outside tap and a gate locked at night.',
  }, landlord.token);
  if (!r.body?.id) throw new Error(`no room: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  await apiCall(API, 'PATCH', `/api/rooms/${r.body.id}/photos`, { paths: ['rooms/demo/cover.jpg'] }, landlord.token);
  await apiCall(API, 'POST', `/api/rooms/${r.body.id}/publish`, {}, landlord.token);
  return r.body.id;
}

const browser = await chromium.launch();

// ── 1. A thumb, twice, on a real screen ───────────────────────────────────
await section('A tenant taps Apply twice', async () => {
  const roomId = await publishedRoom('Double-tap room, Soweto');
  const tenant = await registerUser(API, 'TENANT');
  await apiCall(API, 'POST', '/api/users/me/walkthrough-seen', {}, tenant.token);

  const page = await signIn(browser, WEB, tenant.email, PASSWORD, { width: 390, height: 844 });
  const posts = [];
  const codes = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/applications') && r.method() === 'POST') posts.push(1);
  });
  page.on('response', (r) => {
    if (r.url().endsWith('/api/applications') && r.request().method() === 'POST') codes.push(r.status());
  });

  await page.goto(`${WEB}/rooms/${roomId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  // The walkthrough overlay sits on top of everything until it is dismissed,
  // and a click that lands on the overlay proves nothing about the button.
  const gotIt = page.getByRole('button', { name: /^Got it$/i }).first();
  if (await gotIt.count()) { await gotIt.click(); await page.waitForTimeout(600); }

  const apply = page.getByRole('button', { name: /apply/i }).first();
  check(await apply.count() > 0, 'the room page offers applying');
  check(!(await apply.isDisabled()), '…and the control starts enabled');

  /**
   * ⚠️ 80ms apart, not two clicks in one task.
   *
   * A synchronous pair sends two requests, because Angular has not rendered
   * the `applying()` signal to the `disabled` attribute within the same task
   * — measured, and recorded in the header. That is a real path to the pair
   * but it is not a thumb, and asserting "one POST" against it would fail for
   * a reason that is not a defect. 80ms is a fast human double tap.
   */
  /**
   * ⚠️ The button is RE-QUERIED for the second tap, not held in a variable.
   *
   * Holding the reference made this assertion worthless: Angular re-renders
   * the control after the first click — the label becomes "Sending…" — so the
   * captured node is detached and clicking it does nothing at all. The check
   * passed with `[disabled]="applying()"` REMOVED from the template, which is
   * the bug it exists to catch. Found by falsifying it.
   *
   * A thumb finds whatever is on the screen at the time, so the drive does
   * too: it looks the button up again, which is what makes the disabled
   * binding the thing under test.
   */
  /**
   * Two taps 80ms apart, each one Playwright's ordinary click — so the second
   * waits for the control to be actionable and simply does nothing if it is
   * not, which is what a thumb on a disabled button does. The catch is there
   * because "the second tap had nothing to press" is the PASSING case, not an
   * error.
   */
  await apply.click();
  await page.waitForTimeout(80);
  await apply.click({ timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(4500);

  check(posts.length === 1,
    `a double tap at thumb speed sends ONE application (${posts.length} POST(s), status ${codes.join(',') || 'none'})`);
  check(codes.length === 1 && codes[0] === 201,
    `…and it is accepted once (${codes.join(',') || 'nothing answered'})`);

  const body = ((await page.locator('body').textContent()) ?? '').replace(/\s+/g, ' ');
  check(!/went wrong on our end|internal server error/i.test(body),
    '…and nothing on screen says the server broke');

  const mine = await apiCall(API, 'GET', '/api/applications/mine', undefined, tenant.token);
  const forRoom = (Array.isArray(mine.body) ? mine.body : []).filter((a) => a.room?.id === roomId || a.roomId === roomId);
  check(forRoom.length === 1, `exactly one application exists for that room (${forRoom.length})`);

  await page.context().close();
});

// ── 2. The pair the UI cannot prevent ─────────────────────────────────────
await section('Two applications arriving together', async () => {
  /**
   * 🔴 This is the regression guard for the defect above, and it is driven
   * over the API rather than the screen on purpose: the UI guard stops a thumb,
   * so a browser-level check could never produce the pair reliably. A retry on
   * a dropped connection, two tabs, or a shared phone all can.
   */
  const roomId = await publishedRoom('Concurrent apply room, Soweto');
  const tenant = await registerUser(API, 'TENANT');
  const payload = { roomId, coverNote: 'I would like this room please, I can move in at the start of the month.' };

  const [a, b] = await Promise.all([
    apiCall(API, 'POST', '/api/applications', { ...payload }, tenant.token),
    apiCall(API, 'POST', '/api/applications', { ...payload }, tenant.token),
  ]);
  const codes = [a.status, b.status].sort();

  check(!codes.includes(500),
    `neither request is answered 500 (${codes.join(', ')}) — a duplicate is the caller's situation, not a broken server`);
  check(codes[0] === 201 && codes[1] === 409,
    `one is accepted and one is refused as a conflict (${codes.join(', ')})`);

  const refusal = [a, b].find((r) => r.status === 409);
  check(/already applied/i.test(JSON.stringify(refusal?.body ?? '')),
    `…and the refusal says what happened (${JSON.stringify(refusal?.body?.message ?? refusal?.body ?? null).slice(0, 80)})`);

  const mine = await apiCall(API, 'GET', '/api/applications/mine', undefined, tenant.token);
  const forRoom = (Array.isArray(mine.body) ? mine.body : []).filter((x) => x.room?.id === roomId || x.roomId === roomId);
  check(forRoom.length === 1, `one application in the database, not two (${forRoom.length})`);

  /**
   * ⚠️ And the loser must not have counted. `applicationCount` is incremented
   * after the create, so a refusal that threw AFTER the increment would leave
   * the room advertising an applicant it does not have.
   */
  const room = await apiCall(API, 'GET', `/api/rooms/${roomId}`, undefined, landlord.token);
  check(room.body?.applicationCount === 1,
    `and the room counts one applicant, not two (${room.body?.applicationCount})`);
});

// ── 3. The same question on the landlord's side ───────────────────────────
await section('Two accepts of one application arriving together', async () => {
  /**
   * The expensive one. `double-let-drive` races two DIFFERENT applicants for a
   * room; this is one application accepted twice, which is what a double tap
   * on "Accept" produces.
   *
   * Asserted because it is already right and must stay right: `accept` uses a
   * conditional write, so the loser is refused rather than opening a second
   * tenancy. Two people told they have the same room is a person arriving with
   * their things.
   */
  const roomId = await publishedRoom('Concurrent accept room, Soweto');
  const tenant = await registerUser(API, 'TENANT');
  const app = await apiCall(API, 'POST', '/api/applications', {
    roomId, coverNote: 'I would like this room please, I can move in at the start of the month.',
  }, tenant.token);
  if (!app.body?.id) { bad(`no application to accept: ${app.status}`); return; }

  const [a, b] = await Promise.all([
    apiCall(API, 'POST', `/api/applications/${app.body.id}/accept`, {}, landlord.token),
    apiCall(API, 'POST', `/api/applications/${app.body.id}/accept`, {}, landlord.token),
  ]);
  const codes = [a.status, b.status].sort();
  check(!codes.includes(500), `neither accept is answered 500 (${codes.join(', ')})`);
  check(codes.includes(200), `one accept goes through (${codes.join(', ')})`);
  check(codes.some((c) => c >= 400 && c < 500), `and the second is refused as the caller's mistake (${codes.join(', ')})`);

  /**
   * ⚠️ Polled, not read once. The tenancy is opened WITHOUT blocking the
   * accept's response — smoke-test.sh carries a `sleep 1` for the same reason
   * and lease-ui-drive polls for five seconds. Read immediately this returned
   * zero and the assertion failed, which would have reported "no tenancy was
   * opened" about a tenancy that was about to exist: the check would have been
   * measuring the timing rather than the behaviour.
   *
   * It waits for ONE and then keeps looking, so a second tenancy appearing
   * late still fails the count rather than being missed by an early exit.
   */
  let forRoom = [];
  for (let i = 0; i < 24; i++) {
    const tenancies = await apiCall(API, 'GET', '/api/tenancies/mine', undefined, landlord.token);
    forRoom = (Array.isArray(tenancies.body) ? tenancies.body : []).filter((t) => t.roomId === roomId);
    if (forRoom.length >= 1) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1500));
  const settled = await apiCall(API, 'GET', '/api/tenancies/mine', undefined, landlord.token);
  forRoom = (Array.isArray(settled.body) ? settled.body : []).filter((t) => t.roomId === roomId);
  check(forRoom.length === 1, `one tenancy opened, not two (${forRoom.length})`);
});

await browser.close();
console.log(fail
  ? `\n❌ ${fail} failure(s)`
  : '\n✅ a second tap costs nothing: one application, one tenancy, and a refusal that reads as the caller\'s situation rather than a broken server');
process.exit(fail ? 1 : 0);
