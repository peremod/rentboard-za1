/**
 * The controls a landlord actually presses — Phase 7h, brief items 18-22 and 25.
 *
 * ── Why every check here is a measurement
 *
 * Each of these items reads like a styling nicety and none of them is. The
 * defects this drive was written against were all invisible to every other
 * gate in the repository, because every one of them is a question about the
 * RENDERED box:
 *
 *   · A button can carry the right class and be styled as something else.
 *     `btn btn-ghost-light` on the wizard's Cancel had never had any effect,
 *     because a component's own bare `button` rule outranks a global class —
 *     Angular's emulated encapsulation appends an attribute selector. Cancel,
 *     Back and Next all rendered as the same solid terra button, 6px apart at
 *     360px, and one of them abandons the form.
 *
 *   · A tap target can be under 44px (WCAG 2.5.8) while looking fine on a
 *     desktop. "Accept" and "Reject" on an applicant sat 8px apart at 28px
 *     tall: a mis-tap accepts the wrong person or rejects somebody.
 *
 *   · Sideways scroll can be caused by an element nowhere near the one that
 *     looks too wide. A fieldset will not shrink below its min-content, and a
 *     grid item's min-width: auto propagates that up until the TRACK is wider
 *     than the viewport — so the portal nav rendered 386px at a 360px phone and
 *     read as the culprit. It was the only thing wide enough to notice.
 *
 * So: heights, gaps, computed backgrounds and document overflow, read out of
 * the browser at 360, 390, 768 and 1280, which is the set CLAUDE.md requires.
 *
 * Needs the API on :3000, the app on :4200, and a DATABASE_URL. Rate limiting
 * is real (30 logins per 15 minutes, in memory): this drive signs in once per
 * width per screen, so restart the API if sign-in starts failing.
 */
import { chromium } from '@playwright/test';
import { registerUser, signIn, PASSWORD, apiCall, dbQuery as q } from './lib/drive-session.mjs';

const API = 'http://localhost:3000', WEB = 'http://localhost:4200';
const WIDTHS = [360, 390, 768, 1280];
const TAP = 44;   // WCAG 2.5.8
let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const S = Math.floor(Math.random() * 1e6);

/**
 * Measures a row of controls as a person would meet it.
 *
 * ⚠️ Reads DEFENSIVELY. A missing row returns null rather than throwing:
 * `boundingBox()` and `innerText()` on an absent element kill a Playwright
 * drive outright, which has cost this repository four runs where the headline
 * failure produced a stack trace instead of a finding.
 */
const measureRow = (page, selector, childSel = 'button, a.btn') => page.evaluate(
  ({ selector, childSel }) => {
    const row = document.querySelector(selector);
    const cw = document.documentElement.clientWidth;
    const pageOverflow = document.documentElement.scrollWidth - cw;
    if (!row) return { missing: true, pageOverflow };
    const items = [...row.querySelectorAll(childSel)].filter((e) => e.getBoundingClientRect().height > 0);
    const boxes = items.map((e) => e.getBoundingClientRect());
    // The smallest edge-to-edge distance between neighbours, whichever axis they
    // are laid out on — a stacked column and a squeezed row are both answered.
    const gaps = [];
    for (let i = 1; i < boxes.length; i++) {
      gaps.push(Math.round(Math.max(boxes[i].left - boxes[i - 1].right, boxes[i].top - boxes[i - 1].bottom)));
    }
    const bg = (e) => {
      const c = getComputedStyle(e).backgroundColor;
      return c === 'rgba(0, 0, 0, 0)' || c === 'transparent' ? 'transparent' : c;
    };
    return {
      missing: false,
      pageOverflow,
      labels: items.map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 18)),
      heights: boxes.map((b) => Math.round(b.height)),
      gaps,
      backgrounds: items.map(bg),
      distinct: new Set(items.map(bg)).size,
    };
  },
  { selector, childSel },
);

/** The three questions every row of controls has to answer. */
function assertRow(r, { width, where, minItems }) {
  if (r.missing) {
    bad(`${width}px ${where}: the row is not on the screen, so nothing below it was measured`);
    return false;
  }
  if (r.heights.length < minItems) {
    bad(`${width}px ${where}: ${r.heights.length} controls found, expected ${minItems} — the measurements would mean nothing`);
    return false;
  }
  const smallest = Math.min(...r.heights);
  // ⚠️ "every BUTTON", not "every control" — Phase 7p.
  //
  // `measureRow`'s default childSel is `button, a.btn`, so this has never
  // looked at a text input, and the sentence it printed said otherwise. v1.93.0
  // closed Outstanding 13 by making .btn 44px app-wide and this line then
  // reported every row clean — while 29 inputs across eight screens sat at
  // 37px and lower, down to 30px on the board's own filter row, for three
  // releases. A claim about controls measured over a subset of them is this
  // codebase's own recurring defect. Section 9 below sweeps the inputs.
  smallest >= TAP
    ? ok(`${width}px ${where}: every button clears ${TAP}px (smallest ${smallest}px)`)
    : bad(`${width}px ${where}: a button is ${smallest}px tall — under the ${TAP}px tap target (WCAG 2.5.8). ${JSON.stringify(r.labels)} ${JSON.stringify(r.heights)}`);

  const tightest = r.gaps.length ? Math.min(...r.gaps) : Infinity;
  tightest >= 8
    ? ok(`${width}px ${where}: …and they are ${tightest}px apart, not touching`)
    : bad(`${width}px ${where}: two controls are ${tightest}px apart — ${JSON.stringify(r.labels)}`);

  r.pageOverflow <= 1
    ? ok(`${width}px ${where}: …and the page does not scroll sideways`)
    : bad(`${width}px ${where}: the page scrolls sideways by ${r.pageOverflow}px`);
  return true;
}

const dismissNotice = async (p) => {
  if (await p.locator('.cookie-notice__ok').count()) {
    await p.locator('.cookie-notice__ok').click();
    await p.waitForTimeout(600);
  }
};
const quiet = (user) => apiCall(API, 'POST', '/api/users/me/walkthrough-seen', {}, user.token);

const landlord = await registerUser(API, 'LANDLORD');
await quiet(landlord);

/** A property, so the wizard's picker has something to pick. */
const property = await apiCall(API, 'POST', '/api/properties',
  { name: `Vilakazi back rooms ${S}`, suburb: 'Tembisa', city: 'Johannesburg', province: 'Gauteng' }, landlord.token);
property.status === 201
  ? ok('the landlord has a property, so the picker renders (precondition, asserted)')
  : bad(`could not create the property: ${property.status} — the picker checks below prove nothing`);

const browser = await chromium.launch();
/**
 * ⚠️ One sign-in per width, not one per section.
 *
 * The first version signed in inside each section's loop — three sections times
 * four widths is twelve logins, against a limiter that allows thirty per
 * fifteen minutes counted in memory. Two runs exhausted it and the failure read
 * as "still on /auth/login", which looks like an auth bug and is the trap
 * CLAUDE.md names. Four logins a run leaves room to re-run while fixing
 * something.
 */
const pages = new Map();
const pageFor = async (width) => {
  if (!pages.has(width)) {
    pages.set(width, await signIn(browser, WEB, landlord.email, PASSWORD, { width, height: 900 }));
  }
  return pages.get(width);
};


/** Fills step 1 and lands on step 2, where the picker and three buttons are. */
const toStep2 = async (p) => {
  await p.goto(`${WEB}/landlord/rooms/new`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  await p.waitForSelector('.wizard__actions', { timeout: 20000 });
  await p.selectOption('select[formcontrolname="roomType"]', 'shared_house').catch(() => {});
  await p.fill('input[formcontrolname="title"]', `Drive room ${S}`);
  await p.fill('textarea[formcontrolname="description"]',
    'A clean room in a shared house, close to transport and the shops. Available now, no deposit games.');
  await p.waitForTimeout(400);
  await p.locator('.wizard__actions button:has-text("Next")').click();
  await p.waitForSelector('.prop-picker__card', { timeout: 20000 });
  await p.waitForTimeout(1200);
};

console.log('\n── 18. Back, Cancel and Next are three different things ─────');

for (const width of WIDTHS) {
  const p = await pageFor(width);
  await p.goto(`${WEB}/landlord/rooms/new`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  await p.waitForSelector('.wizard__actions', { timeout: 20000 });

  /**
   * ⚠️ A disabled primary that looks live is a button somebody taps while
   * nothing happens. There was no :disabled rule on .btn anywhere in the app;
   * the wizard's own bare `button:disabled` was providing it, and that rule had
   * to go because it was overriding every global button class.
   */
  const dis = await p.evaluate(() => {
    const n = [...document.querySelectorAll('.wizard__actions button')].find((b) => b.disabled);
    if (!n) return null;
    const c = getComputedStyle(n);
    return { label: n.textContent.trim(), opacity: Number(c.opacity), cursor: c.cursor };
  });
  if (!dis) {
    bad(`${width}px step 1: nothing is disabled before the form is filled in, so the check below cannot run`);
  } else {
    dis.opacity < 0.95 && dis.cursor === 'not-allowed'
      ? ok(`${width}px step 1: the disabled "${dis.label}" looks disabled (opacity ${dis.opacity})`)
      : bad(`${width}px step 1: the disabled "${dis.label}" renders at opacity ${dis.opacity}, cursor ${dis.cursor} — it looks live`);
  }

  await toStep2(p);
  const r = await measureRow(p, '.wizard__actions');
  if (assertRow(r, { width, where: 'wizard actions', minItems: 3 })) {
    /**
     * ⚠️ The finding this section exists for. Cancel carried
     * `btn btn-ghost-light` and rendered identical to Next: three solid terra
     * buttons, one of which throws the form away.
     */
    r.distinct >= 2
      ? ok(`${width}px wizard actions: …and the primary is not the same button as Cancel (${r.distinct} treatments)`)
      : bad(`${width}px wizard actions: all ${r.heights.length} buttons render ${r.backgrounds[0]} — Cancel looks exactly like Next`);
  }
}

console.log('\n── The property picker is cards, not a stack of blocks ──────');

{
  const p = await pageFor(360);
  await toStep2(p);

  const cards = await p.evaluate(() => [...document.querySelectorAll('.prop-picker__card')].map((e) => {
    const c = getComputedStyle(e);
    return { bg: c.backgroundColor, borderWidth: parseFloat(c.borderTopWidth), borderStyle: c.borderTopStyle, h: Math.round(e.getBoundingClientRect().height) };
  }));

  cards.length >= 2
    ? ok(`the picker offers the landlord's property and "somewhere new" (${cards.length} cards)`)
    : bad(`the picker rendered ${cards.length} cards — the checks below prove nothing`);

  cards.every((c) => c.borderWidth >= 1)
    ? ok('…each with a border, so it reads as a card to choose between')
    : bad(`a picker card has border-width ${JSON.stringify(cards.map((c) => c.borderWidth))} — the component's own bare "button" rule is overriding the global class again`);

  cards.some((c) => c.borderStyle === 'dashed')
    ? ok('…and "somewhere new" is dashed, as it was designed to be')
    : bad(`no card is dashed: ${JSON.stringify(cards.map((c) => c.borderStyle))}`);

  cards.every((c) => c.h >= TAP)
    ? ok(`…and every card clears ${TAP}px (smallest ${Math.min(...cards.map((c) => c.h))}px)`)
    : bad(`a picker card is ${Math.min(...cards.map((c) => c.h))}px tall`);

  /**
   * ⚠️ Choosing one used to make it DARKER by a shade nobody would notice:
   * is-chosen sets a 6% terra tint, which composited over a solid terra button
   * gave rgb(142,53,25) against rgb(173,66,34). Selecting a property made it
   * look less selected, among blocks that all looked selected.
   */
  const before = await p.locator('.prop-picker__card').first().evaluate((e) => getComputedStyle(e).borderTopColor);
  await p.locator('.prop-picker__card').first().click();
  await p.waitForTimeout(500);
  const after = await p.locator('.prop-picker__card').first().evaluate((e) => ({
    border: getComputedStyle(e).borderTopColor,
    chosen: e.classList.contains('is-chosen'),
  }));
  after.chosen
    ? ok('choosing a property marks it chosen')
    : bad('clicking a picker card did not mark it chosen, so the next check proves nothing');
  after.border !== before
    ? ok(`…and it is visible: the border goes ${before} → ${after.border}`)
    : bad(`the chosen card looks identical to the others (border stayed ${before})`);

}

console.log('\n── 25. Accept and Reject are not 8px apart ──────────────────');

/**
 * The fixture: a room with an applicant on it, so the action row exists.
 * Asserted, because an empty applicants screen has no row to measure and a
 * drive that measures nothing reports no defect.
 */
const room = await apiCall(API, 'POST', '/api/rooms', {
  roomType: 'shared_house', title: `Applicant room ${S}`,
  description: 'A clean room in a shared house, close to transport and the shops. Available now.',
  rentCents: 310000, province: 'Gauteng', city: 'Johannesburg',
  locationDisplay: 'Tembisa, Johannesburg',
  availableFrom: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
}, landlord.token);
q(`UPDATE rooms SET status='active', "publishedAt"=now(), "heroImagePath"='rooms/stub.jpg' WHERE id = '${room.body?.id}'`);

const applicant = await registerUser(API, 'TENANT');
await quiet(applicant);
const application = await apiCall(API, 'POST', '/api/applications',
  { roomId: room.body?.id, coverNote: 'I can move in on the first of the month.' }, applicant.token);
application.status === 201
  ? ok('a tenant has applied, so there is an applicant card to measure (precondition, asserted)')
  : bad(`the application fixture failed (${application.status}) — the checks below prove nothing`);

/**
 * ⚠️ The card arrives COLLAPSED, and the first version of this drive did not
 * know that: it waited 20s for an action row that only exists once the card is
 * open, then threw a TimeoutError instead of reporting anything. Opening it is
 * part of the fixture, and the open itself is now a check — see below.
 */
const openCard = async (p) => {
  const header = p.locator('.applicant-card__header').first();
  if (!(await header.count())) return false;
  await header.click();
  await p.waitForTimeout(900);
  return (await p.locator('.applicant-card__actions').count()) > 0;
};

for (const width of WIDTHS) {
  const p = await pageFor(width);
  await p.goto(`${WEB}/landlord/rooms/${room.body?.id}/applicants`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  const hasCard = await p.locator('.applicant-card').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  if (!hasCard) {
    bad(`${width}px applicant actions: no applicant card rendered, so nothing below was measured`);
    continue;
  }
  await p.waitForTimeout(600);

  /**
   * ⚠️ The finding. This header was a div with a (click) handler and no role,
   * tabindex or key handler, so a landlord on a keyboard could not open ANY
   * applicant — not their details, not their references, not Accept or Reject.
   * Phase 7c fixed the same thing on the unified inbox; this older per-room
   * screen kept the div, and Phase 7e then put the screen in the nav.
   *
   * Asserted as a real button with the state exposed, not merely as focusable:
   * a div with tabindex is reachable and still silent to a screen reader.
   */
  const header = await p.locator('.applicant-card__header').first().evaluate((e) => ({
    tag: e.tagName.toLowerCase(),
    expanded: e.getAttribute('aria-expanded'),
    controls: e.getAttribute('aria-controls'),
  }));
  header.tag === 'button'
    ? ok(`${width}px applicant card: the header is a real button, so it can be opened from a keyboard`)
    : bad(`${width}px applicant card: the header is a <${header.tag}> with a click handler — pointer only`);
  header.expanded === 'false' || header.expanded === 'true'
    ? ok(`${width}px applicant card: …and says whether it is open (aria-expanded="${header.expanded}")`)
    : bad(`${width}px applicant card: the header has no aria-expanded, so its state is invisible to a screen reader`);

  /** Opened with the KEYBOARD, which is the claim the check above makes. */
  await p.locator('.applicant-card__header').first().focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(900);
  (await p.locator('.applicant-card__actions').count()) > 0
    ? ok(`${width}px applicant card: …and Enter on it really opens the card`)
    : bad(`${width}px applicant card: Enter on the focused header did not open it`);

  if ((await p.locator('.applicant-card__actions').count()) === 0 && !(await openCard(p))) {
    bad(`${width}px applicant actions: the card would not open at all, so nothing below was measured`);
    continue;
  }

  const r = await measureRow(p, '.applicant-card__actions');
  if (assertRow(r, { width, where: 'applicant actions', minItems: 3 })) {
    /** Accept and Reject are the two that must never be confused. */
    const i = r.labels.findIndex((l) => /Accept/i.test(l));
    const j = r.labels.findIndex((l) => /Reject/i.test(l));
    i >= 0 && j >= 0
      ? ok(`${width}px applicant actions: …Accept and Reject are both present and labelled`)
      : bad(`${width}px applicant actions: could not find Accept and Reject in ${JSON.stringify(r.labels)}`);
  }
}

console.log('\n── 19 & 20. Adding a property, and the cards it makes ───────');

for (const width of WIDTHS) {
  const p = await pageFor(width);
  await p.goto(`${WEB}/landlord/properties`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  const listed = await p.locator('.prop-card').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  if (!listed) {
    bad(`${width}px properties: no property card rendered, so nothing below was measured`);
    continue;
  }
  await p.waitForTimeout(700);

  /**
   * Item 20. The whole card is one link, which is the right decision — a thumb
   * anywhere on the row opens the property. So the checks are that the row is
   * tappable, that the three lines of text are not squeezed into a column one
   * word wide, and that nothing pushes the page sideways.
   */
  const card = await p.evaluate(() => {
    const link = document.querySelector('.prop-card__link');
    if (!link) return null;
    const r = link.getBoundingClientRect();
    const body = link.querySelector('.prop-card__body');
    const name = link.querySelector('.prop-card__name');
    const img = link.querySelector('.prop-card__img');
    return {
      h: Math.round(r.height),
      bodyW: body ? Math.round(body.getBoundingClientRect().width) : 0,
      nameH: name ? Math.round(name.getBoundingClientRect().height) : 0,
      imgW: img ? Math.round(img.getBoundingClientRect().width) : 0,
      // Does any of the card's own content stick out of the card?
      spill: Math.round(Math.max(0, ...[...link.querySelectorAll('*')]
        .map((e) => e.getBoundingClientRect().right - r.right))),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  if (!card) {
    bad(`${width}px property card: the card has no link, so it cannot be opened`);
  } else {
    card.h >= TAP
      ? ok(`${width}px property card: the whole row is tappable (${card.h}px)`)
      : bad(`${width}px property card: the row is ${card.h}px tall — under the ${TAP}px tap target`);
    /**
     * ⚠️ A 96px fixed thumbnail beside three lines of text is where a card
     * collapses on a phone: the body gets what is left, and "Vilakazi back
     * rooms" then wraps one word per line. 140px is about ten characters of
     * the name at this size, which is the point at which it stops reading as
     * a name and starts reading as a column.
     */
    card.bodyW >= 140
      ? ok(`${width}px property card: …and the name and address have room to read (${card.bodyW}px beside a ${card.imgW}px photo)`)
      : bad(`${width}px property card: the text column is ${card.bodyW}px beside a ${card.imgW}px photo — the name wraps a word at a time`);
    card.spill <= 1
      ? ok(`${width}px property card: …and nothing spills out of the card`)
      : bad(`${width}px property card: content sticks ${card.spill}px out of the card`);
    card.pageOverflow <= 1
      ? ok(`${width}px properties: …and the page does not scroll sideways`)
      : bad(`${width}px properties: the page scrolls sideways by ${card.pageOverflow}px`);
  }

  /** Item 19. The create form's own two buttons. */
  const start = p.locator('button:has-text("Add a new property"), button:has-text("Add your first property")').first();
  if (!(await start.count())) {
    bad(`${width}px properties: there is no way to start adding a property`);
  } else {
    await start.click();
    const opened = await p.locator('.prop-form__actions').first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    if (!opened) {
      bad(`${width}px properties: the add-a-property form did not open, so its buttons were not measured`);
    } else {
      await p.waitForTimeout(600);
      const r = await measureRow(p, '.prop-form__actions');
      if (assertRow(r, { width, where: 'add-property actions', minItems: 2 })) {
        r.distinct >= 2
          ? ok(`${width}px add-property actions: …and Cancel is not the same button as "Add this property"`)
          : bad(`${width}px add-property actions: both buttons render ${r.backgrounds[0]}`);
      }
    }
  }
}

console.log('\n── 21 & 22. Saving says so, and the receipts have a layout ──');

/** An expense, so the section has a row in it to measure. */
const expense = await apiCall(API, 'POST', '/api/properties/expenses', {
  propertyId: property.body?.id, category: 'municipal', amountCents: 45000,
  incurredOn: new Date().toISOString().slice(0, 10), note: 'Plumber for the geyser',
}, landlord.token);
expense.status === 201
  ? ok('the property has an expense recorded (precondition, asserted)')
  : bad(`the expense fixture failed (${expense.status}) — the list checks below prove nothing`);

for (const width of WIDTHS) {
  const p = await pageFor(width);
  await p.goto(`${WEB}/landlord/properties/${property.body?.id}`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  const loaded = await p.locator('button:has-text("Money spent")').first()
    .waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  if (!loaded) {
    bad(`${width}px property detail: the money-spent section is not on the screen`);
    continue;
  }
  await p.waitForTimeout(700);

  /** Item 22, the a11y half: a disclosure has to say whether it is open. */
  const toggle = await p.locator('button:has-text("Money spent")').first().evaluate((e) => ({
    expanded: e.getAttribute('aria-expanded'),
    controls: e.getAttribute('aria-controls'),
    h: Math.round(e.getBoundingClientRect().height),
  }));
  toggle.expanded === 'false'
    ? ok(`${width}px money spent: the disclosure says it is closed (aria-expanded="false")`)
    : bad(`${width}px money spent: aria-expanded is ${JSON.stringify(toggle.expanded)} — a screen reader cannot tell it opens anything`);
  /**
   * ⚠️ This was a 17px target. .link-btn sets padding:0 on a .82rem font, and
   * it is not .btn, so the base rule's 44px never reached it. The same class
   * carries "Remove", which DELETES an expense record.
   */
  toggle.h >= TAP
    ? ok(`${width}px money spent: …and it is ${toggle.h}px tall, not a line of text`)
    : bad(`${width}px money spent: the disclosure is ${toggle.h}px tall — under the ${TAP}px tap target`);

  await p.locator('button:has-text("Money spent")').first().click();
  const opened = await p.locator('.expense-list').first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  if (!opened) {
    bad(`${width}px money spent: the expenses did not open, so the layout below was not measured`);
    continue;
  }
  await p.waitForTimeout(900);

  /**
   * ⚠️ Item 22's substance. Every class in this section — .yard-expenses,
   * .expense-list, .expense, .expense__main, .expense-form and
   * .expense-form__actions — had NO styles anywhere in the product. The
   * receipts rendered as a list-item list with disc markers and the actions
   * row as display:block with a word space between the buttons. Measured, so
   * these assertions are about the rendered box rather than the markup.
   */
  const sect = await p.evaluate(() => {
    const g = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const c = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return { display: c.display, listStyle: c.listStyleType, gap: c.rowGap, border: parseFloat(c.borderTopWidth), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const removes = [...document.querySelectorAll('.expense .link-btn')].map((e) => Math.round(e.getBoundingClientRect().height));
    const actions = document.querySelector('.expense-form__actions');
    const kids = actions ? [...actions.children].map((e) => e.getBoundingClientRect()) : [];
    const actionGap = kids.length > 1 ? Math.round(Math.max(kids[1].left - kids[0].right, kids[1].top - kids[0].bottom)) : null;
    return {
      list: g('.expense-list'), item: g('.expense'), form: g('.expense-form'), actions: g('.expense-form__actions'),
      removes, actionGap,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  sect.list && sect.list.listStyle === 'none'
    ? ok(`${width}px expenses: the receipts are a styled list, not a bulleted one`)
    : bad(`${width}px expenses: .expense-list renders list-style-type ${JSON.stringify(sect.list?.listStyle)} — the section has no stylesheet`);
  sect.item && sect.item.display !== 'list-item' && sect.item.border >= 1
    ? ok('…each receipt a card with its own border, so one row is one payment')
    : bad(`a receipt renders display ${JSON.stringify(sect.item?.display)}, border ${JSON.stringify(sect.item?.border)}`);
  sect.actions && sect.actions.display === 'flex'
    ? ok('…and the Add button and the CSV link are laid out, not separated by a word space')
    : bad(`.expense-form__actions renders display ${JSON.stringify(sect.actions?.display)}`);
  sect.actionGap !== null && sect.actionGap >= 8
    ? ok(`…${sect.actionGap}px apart`)
    : bad(`the Add button and the CSV link are ${sect.actionGap}px apart`);
  sect.removes.length > 0 && Math.min(...sect.removes) >= TAP
    ? ok(`…and "Remove", which deletes a record, is ${Math.min(...sect.removes)}px tall`)
    : bad(`"Remove" is ${JSON.stringify(sect.removes)}px tall — a destructive control under the ${TAP}px tap target`);
  sect.pageOverflow <= 1
    ? ok(`${width}px expenses: …and the page does not scroll sideways`)
    : bad(`${width}px expenses: the page scrolls sideways by ${sect.pageOverflow}px`);
}

console.log('\n── 21. The save that used to say nothing ────────────────────');

{
  const p = await pageFor(390);
  await p.goto(`${WEB}/landlord/properties/${property.body?.id}`, { waitUntil: 'domcontentloaded' });
  await dismissNotice(p);
  /**
   * Named exactly, not guessed. The first version matched /rules|facilities|edit/
   * and found nothing, because the control reads "Shared details" on the
   * property detail and "Edit this property" on the scoped view — a loose
   * selector reported "there is no way to edit the shared facilities" about a
   * screen that has two.
   */
  const opener = p.locator('button:has-text("Shared details"), button:has-text("Edit this property")').first();
  /**
   * ⚠️ WAIT for it. The first version counted the locator immediately after
   * dismissing the cookie notice, before the property had loaded, got 0, and
   * reported "there is no way to edit the shared facilities" about a screen
   * with two such buttons. count() does not auto-wait — the same fault that
   * made the close-account drive measure an empty kept-list last phase.
   */
  const present = await opener.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  if (!present) {
    bad('there is no way to edit the shared facilities, so item 21 was not driven');
  } else {
    await opener.click();
    const formed = await p.locator('.yard-shared-form').first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    if (!formed) {
      bad('the shared-facilities form did not open, so item 21 was not driven');
    } else {
      await p.waitForTimeout(600);

      /** The form itself had no styles either. */
      const form = await p.locator('.yard-shared-form').first().evaluate((e) => ({
        display: getComputedStyle(e).display,
        gap: getComputedStyle(e).rowGap,
      }));
      form.display === 'grid'
        ? ok('the shared-facilities form is laid out, not a stack of unspaced labels')
        : bad(`.yard-shared-form renders display ${JSON.stringify(form.display)}`);

      const r = await measureRow(p, '.yard-shared-form__actions');
      assertRow(r, { width: 390, where: 'shared-facilities actions', minItems: 2 });

      await p.fill('.yard-shared-form textarea[name="houseRules"]', 'Gate locked at 21:00. Tell me before overnight visitors.');
      await p.locator('.yard-shared-form__actions button[type="submit"]').click();
      await p.waitForTimeout(3000);

      /**
       * ⚠️ The finding. Saving set editing to null and reloaded, so the form
       * vanished and NOTHING said it had worked. The failure path had an inline
       * error; the success path had no feedback at all.
       */
      const confirmed = await p.locator('.yard-saved').first().innerText().catch(() => '');
      /saved/i.test(confirmed)
        ? ok(`saving says so, where the form was ("${confirmed.replace(/\s+/g, ' ').trim().slice(0, 46)}")`)
        : bad('saving the shared facilities closed the form and said nothing');

      const role = await p.locator('.yard-saved').first().getAttribute('role').catch(() => null);
      role === 'status'
        ? ok('…as a status, so it is announced and not only seen')
        : bad(`the confirmation has role ${JSON.stringify(role)} — a screen reader never hears it`);

      /** Named, because this screen lists several properties. */
      confirmed.includes(`Vilakazi back rooms ${S}`)
        ? ok('…and names which property was saved, not a bare "Saved"')
        : bad(`the confirmation does not name the property: "${confirmed.replace(/\s+/g, ' ').trim().slice(0, 80)}"`);

      /** And it really saved, which a confirmation alone does not prove. */
      const rules = q(`SELECT "houseRules" FROM properties WHERE id = '${property.body?.id}'`);
      /Gate locked at 21:00/.test(rules ?? '')
        ? ok('…and the house rules are actually on the property, so the message is not a lie')
        : bad(`the confirmation appeared but the database holds ${JSON.stringify(rules)}`);
    }
  }
}

// ── 9. Every text control is a tap target too — Phase 7p ────────────────
//
// ⚠️ This is the check whose absence let 29 sub-target inputs ship.
//
// Not a row: a sweep of every visible text control on the page, because the
// defect was not in one row — it was the base rule, and a row-shaped check can
// only ever find it on the rows somebody thought to list. Found by a 37px field
// on a new admin form, three releases after the phase that was about exactly
// this.
//
// Checkboxes and radios are excluded: they size themselves and their tap target
// is the label they sit in.
console.log('\n── 9. Text controls are tap targets too ─────────────────────');

const CONTROL_PAGES = [
  ['/', 'the board', false],
  ['/auth/login', 'login', false],
  ['/auth/register', 'register', false],
  ['/auth/register-phone', 'phone sign-up', false],
  ['/account/settings', 'account settings', true],
  ['/landlord/rooms/new', 'the listing wizard', true],
];

/**
 * ⚠️ One sign-in, its session copied per width.
 *
 * Written as `signIn(...)` per width per guarded page, this section added eight
 * sign-ins to a drive that already had several — against a limiter of thirty
 * logins per fifteen minutes. The drive then died at section 18 with "still on
 * /auth/login", which reads as an auth bug and is the trap CLAUDE.md names. A
 * fresh CONTEXT costs nothing and still paints at the target width from the
 * start, which matters: a layout read at 360px after a 1280px paint has
 * reported a desktop measurement as a phone one in this repo before.
 */
let sweepSession = await (async () => {
  const p = await signIn(browser, WEB, landlord.email, PASSWORD, { width: 390, height: 900 });
  const state = await p.context().storageState();
  await p.context().close();
  return state;
})();

/**
 * ⚠️ The state is re-captured each time, because the refresh cookie ROTATES.
 *
 * Captured once and reused, this worked at the first width and failed at every
 * one after it: the session is a refresh cookie, the app spends it on load, and
 * the server issues a new one — so the second context presented a token that
 * had already been rotated away and was signed out. Six checks reported "the
 * copied session did not sign in", which is the guard below doing its job; the
 * version before that guard would have measured the login form's two fields and
 * called the page clean.
 */
for (const width of WIDTHS) {
  for (const [path, label, needsAuth] of CONTROL_PAGES) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      ...(needsAuth ? { storageState: sweepSession } : {}),
    });
    const p = await ctx.newPage();
    await p.goto(`${WEB}${path}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(900);

    // A guarded page that bounced to the login form would otherwise be measured
    // as "two text controls, both fine" — a clean pass on the wrong screen.
    if (needsAuth && /\/auth\/login/.test(new URL(p.url()).pathname)) {
      bad(`${width}px ${label}: the copied session did not sign in, so nothing was measured`);
      await ctx.close();
      continue;
    }

    const m = await p.evaluate(() => {
      const vis = (el) => !!el && getComputedStyle(el).display !== 'none'
        && el.getBoundingClientRect().height > 0;
      const controls = [...document.querySelectorAll(
        "input:not([type='checkbox']):not([type='radio']), select, textarea",
      )].filter(vis);
      return {
        count: controls.length,
        under: controls
          .filter((c) => c.getBoundingClientRect().height < 44)
          .map((c) => ({
            id: c.id || c.getAttribute('name') || c.type,
            h: Math.round(c.getBoundingClientRect().height),
          })),
        smallest: controls.length
          ? Math.round(Math.min(...controls.map((c) => c.getBoundingClientRect().height)))
          : 0,
      };
    });

    // The precondition, asserted. A sweep that found no controls would report
    // a clean page forever — which is how a check stops being one.
    if (m.count === 0) {
      bad(`${width}px ${label}: no text controls found, so nothing was measured`);
    } else if (m.under.length === 0) {
      ok(`${width}px ${label}: ${m.count} text controls, smallest ${m.smallest}px`);
    } else {
      bad(`${width}px ${label}: ${m.under.length} of ${m.count} text controls under ${TAP}px — ${JSON.stringify(m.under)}`);
    }
    // Follow the rotation, so the next context presents the current cookie.
    if (needsAuth) sweepSession = await ctx.storageState();
    await ctx.close();
  }
}

await browser.close();
console.log(`\n${fail === 0 ? '✅ all checks passed' : `❌ ${fail} check(s) failed`}`);
process.exit(fail === 0 ? 0 : 1);
