/**
 * Arranging a viewing, on both screens — Phase 7l, brief item 26.
 *
 * ── What only a browser shows
 *
 *   1. **The landlord is told, on the form, that what they type is sent.**
 *      They typed their property address into a field promising "Only you see
 *      this. It is never on a listing and never sent to an applicant", so the
 *      invitation form has to say plainly that this field is different — and
 *      it must arrive EMPTY. A pre-filled address would break that promise on
 *      their behalf without their knowing.
 *   2. **The tenant can answer**, from a panel that has a place and a time on
 *      it, carrying the safety line where somebody looks the night before.
 *   3. **The panel renders nothing when there is nothing**, like the task
 *      inbox beside it — a tenant with no viewings is not shown an empty queue.
 *   4. **Both sides see the same arrangement** after it is agreed.
 *   5. **Four widths.**
 *
 * Needs the API on :3000, the app on :4200 and a DATABASE_URL.
 */
import { chromium } from '@playwright/test';
import { registerUser, signIn, apiCall, PASSWORD, dbQuery as q } from './lib/drive-session.mjs';

const API = 'http://localhost:3000', WEB = 'http://localhost:4200';
const WIDTHS = [360, 390, 768, 1280];
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const S = Math.floor(Math.random() * 1e6);
const SECRET_ADDRESS = `14 Vilakazi Street SECRET${S}`;
const quiet = (u) => apiCall(API, 'POST', '/api/users/me/walkthrough-seen', {}, u.token);

const landlord = await registerUser(API, 'LANDLORD');
const tenant = await registerUser(API, 'TENANT');
const quietTenant = await registerUser(API, 'TENANT');
await quiet(landlord); await quiet(tenant); await quiet(quietTenant);

const property = await apiCall(API, 'POST', '/api/properties',
  { name: `Viewing yard ${S}`, addressLine: SECRET_ADDRESS, suburb: 'Tembisa', city: 'Johannesburg', province: 'Gauteng' },
  landlord.token);
const room = await apiCall(API, 'POST', '/api/rooms', {
  roomType: 'shared_house', title: `Viewing UI room ${S}`,
  description: 'A clean room in a shared house, close to transport and the shops. Available now.',
  rentCents: 310000, province: 'Gauteng', city: 'Johannesburg',
  locationDisplay: 'Tembisa, Johannesburg',
  availableFrom: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
  propertyId: property.body?.id,
}, landlord.token);
q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${room.body?.id}'`);
const application = await apiCall(API, 'POST', '/api/applications',
  { roomId: room.body?.id, coverNote: 'I can move in on the first of the month.' }, tenant.token);

q(`SELECT "addressLine" FROM properties WHERE id = '${property.body?.id}'`) === SECRET_ADDRESS
  && application.status === 201
  ? ok('a room at a property with a PRIVATE address, and an applicant (precondition, asserted)')
  : bad('the fixture failed — the address checks below would prove nothing');

const browser = await chromium.launch();
const dismissNotice = async (p) => {
  if (await p.locator('.cookie-notice__ok').count()) {
    await p.locator('.cookie-notice__ok').click();
    await p.waitForTimeout(600);
  }
};
const pages = new Map();
const pageFor = async (width, who) => {
  const key = `${who.email}:${width}`;
  if (!pages.has(key)) {
    pages.set(key, await signIn(browser, WEB, who.email, PASSWORD, { width, height: 1000 }));
  }
  return pages.get(key);
};

/** The applicant card for our tenant, opened. */
const openCard = async (p) => {
  await p.goto(`${WEB}/landlord/rooms/${room.body?.id}/applicants`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  const header = p.locator('.applicant-card__header').first();
  if (!(await header.waitFor({ timeout: 20000 }).then(() => true).catch(() => false))) return false;
  if (!(await p.locator('.applicant-card__actions').count())) {
    await header.click();
    await p.waitForTimeout(900);
  }
  return (await p.locator('.applicant-card__actions').count()) > 0;
};

console.log('\n── 1. The landlord’s form says what it sends, and starts empty ──');

{
  const p = await pageFor(1280, landlord);
  if (!(await openCard(p))) {
    bad('the applicant card would not open, so nothing below was measured');
  } else {
    const invite = p.locator('button:has-text("Invite to view")').first();
    (await invite.count()) === 1
      ? ok('the applicants screen offers "Invite to view"')
      : bad('there is no way to invite an applicant to a viewing');

    await invite.click();
    const formed = await p.locator('.viewing-form').waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    if (!formed) {
      bad('the invitation form did not open');
    } else {
      /**
       * ⚠️ THE check this phase exists to protect.
       *
       * Property.addressLine is "14 Vilakazi Street SECRET<n>" and the form
       * that collected it promised, in those words, that it is never sent to
       * an applicant. If any convenience ever pre-fills it here, this fails.
       */
      const place = await p.locator('.viewing-form input[name="place"]').inputValue();
      place === ''
        ? ok('the meeting-place field arrives EMPTY — nothing pre-fills the private address')
        : bad(`the meeting place is pre-filled with ${JSON.stringify(place)}`);

      const formText = (await p.locator('.viewing-form').innerText()).replace(/\s+/g, ' ');
      !formText.includes('SECRET')
        ? ok('…and the private address is nowhere on the form')
        : bad('the private property address is on the invitation form');

      /** The landlord has to know this field is different from the other one. */
      /this is sent to/i.test(formText)
        ? ok('…and the form says plainly that what is typed is sent to the applicant')
        : bad(`the form does not say the place is sent: "${formText.slice(0, 180)}"`);
      /we never use the address you saved on your property/i.test(formText)
        ? ok('…and that the address they saved on their property stays private')
        : bad('the form does not distinguish itself from the private property address');

      const when = new Date(Date.now() + 5 * 86400_000);
      when.setUTCHours(14, 0, 0, 0);
      await p.fill('.viewing-form input[name="when"]', when.toISOString().slice(0, 16));
      await p.fill('.viewing-form input[name="place"]', 'The blue gate on the corner');
      await p.fill('.viewing-form input[name="viewingNote"]', 'Ask for Sipho at the gate.');
      await p.locator('.viewing-form button[type="submit"]').click();
      await p.waitForTimeout(3000);

      const row = (await p.locator('.viewing').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      /invited, waiting for an answer/i.test(row)
        ? ok('the invitation is sent, and the card says it is waiting for an answer')
        : bad(`after sending, the card reads: "${row.slice(0, 160)}"`);
      /the blue gate on the corner/i.test(row)
        ? ok('…showing where they said to meet')
        : bad('the card does not show the meeting place');
    }
  }
}

console.log('\n── 2. The tenant sees it, with the safety line ─────────────');

{
  const p = await pageFor(1280, tenant);
  await p.goto(`${WEB}/tenant/dashboard`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  const panel = await p.locator('.vi-section').waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  if (!panel) {
    bad('the tenant’s dashboard shows no viewings panel');
  } else {
    const text = (await p.locator('.vi-section').innerText()).replace(/\s+/g, ' ');
    text.includes(`Viewing UI room ${S}`)
      ? ok('the tenant’s dashboard names the room they are invited to see')
      : bad('the panel does not name the room');
    /the blue gate on the corner/i.test(text)
      ? ok('…and where to meet')
      : bad('the panel does not say where to meet');
    /ask for sipho/i.test(text)
      ? ok('…and the landlord’s note')
      : bad('the landlord’s note is not shown to the tenant');
    !text.includes('SECRET')
      ? ok('…and NOT the landlord’s private property address')
      : bad('the private property address reached the tenant’s screen');

    /**
     * ⚠️ The safety line, where somebody looks the night before. The notice
     * carries it at the moment of invitation; this carries it when it matters.
     */
    /never pay anything/i.test(text)
      ? ok('…and the warning never to pay before seeing the room')
      : bad('the panel carries no payment warning');
    /tell somebody where you are going/i.test(text)
      ? ok('…and to tell somebody where they are going')
      : bad('the panel does not say to tell somebody where you are going');

/**
     * ⚠️ The link goes to the ROOM, not to a /report route.
     *
     * Reporting is a dialog on the room page — there is no /report route, which
     * the first version of this component linked and `nav-audit.mjs` caught.
     * So the check is that the link resolves to the room this viewing is about,
     * which is where the report dialog actually is.
     */
    const report = await p.locator('.vi__safety a').getAttribute('href').catch(() => null);
    (report ?? '').startsWith('/rooms/')
      ? ok(`…with a way to report somebody who asks for money (${report})`)
      : bad(`the safety line links to ${JSON.stringify(report)}`);
  }
}

console.log('\n── 3. The tenant answers, and both sides agree ─────────────');

{
  const p = await pageFor(1280, tenant);
  await p.locator('button:has-text("I can come")').first().click();
  await p.waitForTimeout(3000);

  const after = (await p.locator('.vi-section').innerText().catch(() => '')).replace(/\s+/g, ' ');
  /you said you are coming/i.test(after)
    ? ok('saying yes is reflected on the tenant’s own screen')
    : bad(`after answering, the panel reads: "${after.slice(0, 160)}"`);

  q(`SELECT status FROM room_viewings WHERE "applicationId" = '${application.body?.id}' ORDER BY "createdAt" DESC LIMIT 1`) === 'accepted'
    ? ok('…and stored as accepted, so it is not only a label')
    : bad('the viewing was not stored as accepted');

  /** The landlord's screen has to show the same arrangement. */
  const lp = await pageFor(1280, landlord);
  if (!(await openCard(lp))) {
    bad('the landlord’s card would not reopen');
  } else {
    const row = (await lp.locator('.viewing').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
    /they are coming/i.test(row)
      ? ok('…and the landlord’s card says they are coming')
      : bad(`the landlord’s card reads: "${row.slice(0, 160)}"`);
    (await lp.locator('.viewing button:has-text("Call it off")').count()) === 1
      ? ok('…with a way to call it off from either side')
      : bad('the landlord cannot call off an agreed viewing');
  }
}

console.log('\n── 4. A tenant with nothing booked sees no empty queue ─────');

{
  const p = await pageFor(1280, quietTenant);
  await p.goto(`${WEB}/tenant/dashboard`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  await p.waitForSelector('.dash-week, .dash-section', { timeout: 20000 });
  await p.waitForTimeout(1200);
  (await p.locator('.vi-section').count()) === 0
    ? ok('a tenant with no viewings is shown no viewings panel at all')
    : bad('an empty viewings panel is rendered for a tenant with nothing booked');
}

console.log('\n── 5. At four widths ───────────────────────────────────────');

for (const width of WIDTHS) {
  const p = await pageFor(width, tenant);
  await p.goto(`${WEB}/tenant/dashboard`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  const panel = await p.locator('.vi-section').waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  if (!panel) {
    bad(`${width}px: the viewings panel is not on the screen`);
    continue;
  }
  await p.waitForTimeout(600);

  const shape = await p.evaluate(() => {
    const controls = [...document.querySelectorAll('.vi__answer .btn, .vi__answer .link-btn, .vi__reason input')];
    const boxes = controls.map((c) => c.getBoundingClientRect());
    const gaps = [];
    for (let i = 1; i < boxes.length; i++) {
      gaps.push(Math.round(Math.max(boxes[i].left - boxes[i - 1].right, boxes[i].top - boxes[i - 1].bottom)));
    }
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      smallest: boxes.length ? Math.min(...boxes.map((b) => Math.round(b.height))) : 0,
      count: controls.length,
      tightest: gaps.length ? Math.min(...gaps) : Infinity,
      safetyWidth: Math.round(document.querySelector('.vi__safety')?.getBoundingClientRect().width ?? 0),
    };
  });

  shape.count >= 1
    ? ok(`${width}px: the answer controls are there to measure (${shape.count})`)
    : bad(`${width}px: no answer controls found — the measurements mean nothing`);
  shape.overflow <= 1
    ? ok(`${width}px: no sideways scroll`)
    : bad(`${width}px: the dashboard scrolls sideways by ${shape.overflow}px`);
  shape.smallest >= 44
    ? ok(`${width}px: every control clears 44px (smallest ${shape.smallest}px)`)
    : bad(`${width}px: a control is ${shape.smallest}px tall`);
  shape.tightest >= 8
    ? ok(`${width}px: …and they are not touching`)
    : bad(`${width}px: two controls are ${shape.tightest}px apart`);
  shape.safetyWidth <= 720
    ? ok(`${width}px: …and the safety line stays readable (${shape.safetyWidth}px)`)
    : bad(`${width}px: the safety line runs ${shape.safetyWidth}px wide`);
}

await browser.close();
console.log(`\n${fail === 0 ? '✅ all checks passed' : `❌ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
