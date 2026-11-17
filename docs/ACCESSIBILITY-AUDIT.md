# Accessibility, responsive and cross-browser audit — 16 November 2026

A five-step brief: inspect the application, assess WCAG 2.2 Level AA, test
representative viewports, test the supported browsers, report.

Steps 1–3 are done. **Step 4 is blocked, on two independent counts**, and
§5e says so rather than substituting Chromium results for cross-browser
evidence.

Everything below was measured in this container against a development build
with a seeded database. Where something could not be measured, it is named.

---

## 1. What this application is, and what was already checked

| | |
| --- | --- |
| Frontend | Angular **21.2.14** with SSR (`@angular/ssr`), TypeScript 5.9 |
| Design system | tokens in `_spec.scss` + `styles.scss`, gated by `token-lint`, `scale-lint`, `state-lint`, `badge-lint`, `font-lint`, `feedback-lint` |
| Automated a11y | `axe-core` **4.13.0**, Lighthouse CI |
| Browsers declared | **none** — see §1c |

### 1a. The breakpoints are eleven, not three

`CLAUDE.md` says "the breakpoints this codebase actually uses are 900 / 768 /
480" and makes a standing rule of testing at **360 / 390 / 768 / 1280**. The
stylesheets declare:

| | widths |
| --- | --- |
| `max-width` | 360, 480, 600, 700, 768, 860, 900 |
| `min-width` | 640, 769, 901, 1600 |

So the transitions at **600, 640, 700 and 860** are never crossed by any
prescribed width, and the `min-width: 1600px` rules were never exercised at
all, because the widest width anyone tested was 1280. Both defects in §4
live in exactly those gaps.

### 1b. The accessibility tooling is good, with three specific holes

`scripts/a11y-drive.mjs`, run at four widths by `scripts/a11y-widths.sh`, over
**39 pages** (9 public, 14 landlord, 7 tenant, 9 admin, plus dynamic routes):
heading order, accessible names measured with `textContent` not `innerText`,
colour contrast via axe, and **target size done properly** — 24px as the 2.5.8
AA floor plus a ratcheted 44px house floor, with the spacing exception and the
inline-link exemption both implemented.

`a11y-widths.sh` exists because the drive ran at one width for its whole life,
and widening it immediately found four real defects, including every footer
link being 17px tall on all 33 pages. That history is the single best argument
in this repository for multi-width testing, and §4 extends it.

The holes:

1. 🔴 **axe ran one rule.** `runOnly: ['color-contrast']`, deliberately: "a
   gate that is red on the day it lands is a gate someone turns off. Widening
   it is a decision to take with the findings in hand." Nobody had taken those
   findings. §3 takes them.
2. **No `alt` check for content images** anywhere in the a11y tooling. The only
   `alt` assertions in the repo are for `og:image:alt` on social cards.
3. **Lighthouse asserts accessibility on 4 local URLs only.**
   `lighthouserc.production.json` has **no accessibility assertion at all**, so
   the live site's accessibility is unasserted.

And the pages it never visited were the ones with the traffic: **`/rooms/:id`**
(where every `wa.me` share lands and the apply flow lives), **`/auth/login`**,
**`/auth/register`**, the whole password-recovery set,
**`/landlord/rooms/new`**, `/landlords/:slug`, `/legal/disclaimer`,
`/legal/cookies`, `/admin/recoveries`. The drive already builds dynamic routes
for applicants, so the machinery existed and was not pointed at them.

### 1c. 🔴 No browser support is declared anywhere

No `.browserslistrc`, no `browserslist` key in `package.json`, and no browser
statement in `README.md`, `docs/`, `CLAUDE.md` or `PRE-LAUNCH-CHECKLIST.md`.
browserslist therefore falls through to its own `defaults`, which resolves to
**85.53% global coverage** and includes `op_mini all`, `kaios 2.5`,
`kaios 3.0-3.1`, `and_uc 15.5` and `and_qq 14.9`.

That matters twice. Opera Mini in extreme-saving mode cannot run an Angular
application at all, so the *implicit* support set contains browsers the product
provably does not work in. And for a product built for a cheap Android phone in
South Africa, the targets that actually matter — older Android Chrome, Android
WebView — are nowhere singled out.

**Step 4 of the brief has no documented answer to test against.** Declaring the
matrix is the prerequisite, and it is a product decision rather than a
refactor.

---

## 2. Tools added

| script | what it does | gate? |
| --- | --- | --- |
| `a11y-scan.mjs` | full WCAG 2.2 AA axe ruleset, 51 pages × 4 widths | report only, exits 0 by design |
| `a11y-keyboard-drive.mjs` | the criteria axe cannot reach — real Tab presses | exits non-zero |
| `responsive-drive.mjs` | every declared breakpoint at ±1px | exits non-zero |

`a11y-drive.mjs` was also widened from one axe rule to the whole AA tag set
(`35ed008`), which is only possible because §3 brought it to zero first.

---

## 3. WCAG 2.2 AA, automated — three rules, all fixed

`a11y-scan.mjs`: **204 page-scans** (51 pages × 360/390/768/1280), **zero scan
errors**, tags `wcag2a wcag2aa wcag21a wcag21aa wcag22a wcag22aa`.

Three distinct rules violated. For a full AA ruleset over 51 pages that is a
good result — the "dozens of findings" the repo feared are not there.

| rule | impact | before | after |
| --- | --- | --- | --- |
| `aria-roles` | critical | 8 nodes, 2 pages, 4 widths | **0** |
| `link-in-text-block` | serious | 79 nodes, 23 pages, 4 widths | **0** |
| `scrollable-region-focusable` | serious | 17 nodes, 9 pages, **360/390 only** | **0** |

### 3a. `aria-roles` — invalid ARIA roles on both dashboards

`/landlord/dashboard` and `/tenant/dashboard` rendered `role="landlord"` and
`role="tenant"`. WCAG 4.1.2. The cause:

```ts
readonly role = input.required<'landlord' | 'tenant'>();   // dispute-panel.ts
```
```html
<app-dispute-panel role="landlord"/>
```

An Angular input named `role` collides with the global ARIA attribute: Angular
consumes the static attribute as the input **and leaves it in the DOM**. A
screen reader was handed a role it does not recognise, on the two busiest
portal screens. Renamed to `party`.

**Any input on a component is a DOM attribute waiting to happen**, so an input
must not be named after a global ARIA or HTML attribute.

### 3b. `link-in-text-block` — prose links by colour alone

`_spec.scss` set `a { text-decoration: none }` with the underline only on
`:hover`. Measured ratios against the surrounding text, where 1.4.1 needs 3:1:

| | |
| --- | --- |
| `#ad4222` link on `#736755` body text | **1.06:1** |
| `#d4a853` link on `#bfbdbc` body text | **1.17:1** |

⚠️ **The hover underline is not a mitigation for this audience.** There is no
hover on a touch screen, so a visitor on a cheap Android phone — the premise of
the product — never saw it. Fixed by underlining links inside `p`, which is
exactly what the rule flags; nav, footer lists, cards and buttons are link-only
containers with no sentence to be confused with, and are untouched.

🔴 **Found on the way: `.cookie-banner` is dead CSS.** Five rules across two
files, including `text-decoration: underline`, and the class appears in **no
template** — the component renders `.cookie-notice__*`. Somebody had already
fixed this exact problem against a class name that no longer exists, and the
dead rule read as coverage.

### 3c. `scrollable-region-focusable` — and a second defect axe cannot see

Tables and the home page's trust strip became horizontal scrollers at small
widths with nothing focusable inside, so a keyboard user could not scroll them
and the columns past the right edge were unreachable. WCAG 2.1.1 / 2.1.3. **At
360 and 390px only** — above them the strip wraps instead of scrolling, which
is the whole argument for `a11y-widths.sh`.

The scroll moved from the `<table>` onto a `.table-scroll` wrapper with
`tabindex="0"`, `role="group"` and a label, across ten tables; the trust strip
got the same. Both gained `:focus-visible` rings, because trading 2.1.1 for
2.4.7 is not a fix.

That also removed something axe cannot see: **`display: block` on a `<table>`**
drops it out of the table layout box, and with it the row and column
relationships several screen readers derive from that box. The mobile
adaptation that made the PAIA inventory swipeable risked turning it into a run
of unrelated cells, at exactly the widths this market uses.

### 3d. Verification

| | |
| --- | --- |
| after the fixes | **204 scans, 0 errored, 0 sign-in failures, 0 rules** |
| falsified | reverting two fixes returned both rules immediately |

---

## 4. The criteria automation cannot reach, and responsive behaviour

### 4a. Keyboard and focus — `a11y-keyboard-drive.mjs`

axe cannot press Tab, so §3's zero says nothing about keyboard operability.

| criterion | before | after |
| --- | --- | --- |
| 2.4.1 Bypass Blocks | **no skip link on any page** | present, and first tab stop |
| 2.4.11 Focus Not Obscured | **21 controls entirely hidden** | **0** |
| 3.3.1 Error Identification | announced, but not tied to the field | `aria-invalid` + `aria-describedby` |
| 2.1.1 / 2.1.2 / 2.4.7 / 3.3.8 | passing | passing |

**2.4.1.** `<main id="main-content">` existed, and `styles.scss` carried
`#main-content:focus { outline: none; }` commented *"Skip link target used by
the app shell"*. The target and its CSS were built; **the link never was.**
`<main>` also needed `tabindex="-1"`, without which the jump moves the scroll
and not the focus, so the next Tab returns to the navigation and the link looks
like it works while changing nothing.

**2.4.11.** The cookie notice is `position: fixed` at `z-index: 9999`, pinned
bottom with `left: 1rem; right: 1rem` and a 420px cap — nearly the full width
of a 390px phone. 21 focused controls were entirely invisible, including the
board's move-in date inputs and whole legal footer columns, at both 390 and
1280px.

⚠️ The class of bug was known: the component's own comment records that "every
new account got the notice drawn over the tour's buttons". That was fixed for
the walkthrough by sharing a signal. Nothing was done for everything else at
the bottom of every page.

**3.3.8 passes, and was proven rather than inspected**: both auth fields
declare `autocomplete` (`email`, `current-password`), and a password can be
pasted — demonstrated by pasting one, not by the absence of an `onpaste`
handler.

### 4b. 🔴 `scrollIntoView` was inert across the whole application

Found while fixing 2.4.11. `_spec.scss` had `body { … overflow-x: hidden }`,
to stop horizontal page scroll — the first item on `CLAUDE.md`'s mobile list,
so the intent was right.

Per the CSS overflow spec, **if one axis is not `visible` the other computes to
`auto`**. So `body` silently became a scroll container while
`document.scrollingElement` stayed `html`, and `scrollIntoView()` had been
doing nothing: the ancestor walk finds `body`, scrolls a scrollport with nothing
in it, and never touches the document.

Measured: a direct `el.scrollIntoView({ block: 'center' })` on a footer link
moved the page **zero pixels with 1,612px of scroll available**. Anything that
depends on scroll-into-view — an anchor jump, scrolling to the first invalid
field — has been quietly inert. Moved to `html`; horizontal page scroll
re-verified at **zero** at 360, 390, 768 and 1280px.

### 4c. Responsive — `responsive-drive.mjs`, 174 layouts

29 widths (every declared boundary at −1, boundary, +1) × 6 pages. The ±1
matters because an off-by-one in a media query shows up nowhere else:
`max-width: 768` with `min-width: 769` leaves no gap, but `max-width: 768` with
`min-width: 768` applies **both** and `max-width: 767` with `min-width: 769`
applies **neither**.

| defect | band | worst | pages |
| --- | --- | --- | --- |
| desktop nav too wide | **769–904px** | 135px of page scroll | all six |
| board grid forced to 2 columns | **481–599px** | 119px of page scroll | the board |

**The nav.** It needs 904px — logo + 441px of links + 270px of actions — and
the mobile nav only takes over at ≤768px. Not fixed by moving the breakpoint,
for two reasons:

- the drawer's styling (sheet, scrim, close, scroll lock) lives in the ≤768px
  block, so hoisting only `.nav-links { display: none }` to the existing 900px
  breakpoint would open an **unstyled drawer** at 769–900px — a dark panel on a
  dark hero with no way out, which that block's comment records as already
  fixed once;
- **no fixed breakpoint can be right.** The nav needs 904px in English and
  906px at a 930px viewport, because the link text changes — and this product
  ships **eleven languages**.

So the links shrink: `min-width: 0` is the whole fix, because a flex item's
default `min-width: auto` is its min-content width (441px here), which is why
the links refused to yield a pixel and the page took the overflow. Same pattern
`.portal-nav` already uses.

**The board grid.** `1fr 1fr` asserted two columns down to 481px, and a card's
min-content width is 282px, so the grid demanded 564px plus gap inside a 449px
box. Now `repeat(auto-fit, minmax(280px, 1fr))` — the column count follows the
space available, with no breakpoint to keep in step with the card.

Both were invisible at every prescribed width: 360/390 sit below the 480
breakpoint where one column takes over, 768/1280 above where the nav and two
columns genuinely fit.

### 4d. 🔴 A third nav defect, found only because CI's fonts are not these

The two defects above were found here and fixed here. The third was found by
**CI failing a gate that passes on this machine**, which makes it the most
useful result in this document.

`responsive-drive.mjs` reported, on CI, 20px of horizontal page scroll at
**481px** on four of the six pages, with `button.nav-burger` reaching 501px in
a 481px viewport. Driven here against the same commit and the same SSR
development build, all 174 layouts were clean.

**The cause, and it is not a CI quirk.** The burger appears at
`max-width: 768px`. Every tightening the nav needs — most of all moving the
language switcher out of the header and into the drawer — sat in
`@media (max-width: 480px)`. So across the whole band **481–768px** the header
carried the logo, the language switcher, Log in, Get started *and* the burger,
with none of the tightening applied to any of them:

| | before | after |
| --- | --- | --- |
| free space between logo and actions, 481px | **16px** | **92px** |
| burger right edge, 481px viewport | 475px (501px on CI) | 457px |
| tightest point in the whole burger band | 16px @ 481px | 53px @ 359px |

Sixteen pixels of slack. Which side of the line that layout fell on depended
on the machine measuring the text — so the layout was never correct here
either, and a gate that only asks "does it overflow" was always going to say
yes on one runner and no on another. The fix moves the two rules into the
`max-width: 768px` block, beside the rule that reveals the burger. Nothing is
lost: `.nav-links-lang` puts the switcher in the drawer, which is where the
original comment always claimed it went.

**So the drive now measures the margin, not just the breach.** `.nav-actions`
has `margin-left: auto`, so the burger sits flush against the right padding at
every width that fits, and the right edge looks identical at 93px of headroom
and at 1px. The only number that tells them apart is the free space between
the logo and the actions, and the drive now requires at least **40px** of it
while the burger is shown — below the 53px the nav was hand-fitted to at
359px, far above the 16px that shipped.

That change is what makes the check deterministic: with the old stylesheet it
now fails **on this machine**, at 481px, reading 16px, exit 1 — rather than
only on a runner whose fonts differ.

🔴 **And the first version of that floor made the same mistake one layer up.**
It asked for 40px at every width the burger shows, calibrated against the
tightest value measured *here* — 53px at 359px. CI measures 35px at 359px,
so the check condemned four pages at 359/360/361px that CI's own overflow
assertion passes. A cross-machine check calibrated against one machine is
exactly the finding above, committed by the fix for it.

| width | this container | CI's runner |
| --- | --- | --- |
| 359px | 53px | **35px** |
| 360px | 54px | 36px |
| 361px | 55px | 37px |
| 481px | 92px | ~74px (16px and overflowing, before) |

Two changes, and the second matters more:

- **The floor is asked for only above 480px**, which is a reason and not a
  dodge. At and below 480px the nav is deliberately hand-fitted to the pixel —
  those rules tighten padding and font size, measured at 360/390/430px by
  `nav-ui-drive` — so demanding slack there contradicts a decision taken on
  purpose. Above 480px nothing was tightened, so slack is expected and its
  absence is the defect: 40px sits far below the ~74px CI measures after the
  fix and far above the 16px that shipped.
- **A structural assertion now carries the weight**: while the burger is
  shown, the language switcher must not be in the header. It needs no text
  metrics, so it cannot drift between runners, and it pins the actual
  regression rather than a symptom of it.

Falsified against the genuine pre-fix stylesheet, and the result argues for
the structural check on its own: at 481px both guards fire (16px, and the
switcher in the header); **at 600px only the structural one fires**, because
the headroom there is comfortable on this machine while the defect is still
fully present. The pixel floor is blind to exactly the band it was written
for.

⚠️ One more thing belongs here, because it nearly went into this document as
a verification that never happened. The first attempt to falsify the revised
check used `git stash` on the stylesheet — which did nothing, because by then
the fix was **committed**, so the file had no uncommitted changes to stash.
The drive therefore ran against the fixed code and reported a clean pass,
which read exactly like a check that cannot fail. The real falsification
needed `git show 739cfd3:…` to put the pre-fix file back. A reverting step
that silently reverts nothing is the same defect as a check that cannot
fail, and it is invisible in the output.

### 4e. The scroll-lock check was asking the wrong element

CI also failed `nav-sheet-drive` — three assertions, all
*"without dropping the overflow-x the body already had"* — and it reproduced
here immediately. Not a new defect: the check's **subject** had moved. §4b put
`overflow-x: hidden` on `html` instead of `body`, so reading
`getComputedStyle(document.body).overflowX` asked an element that no longer
carries the clamp, on a page that was correct.

It reads `html` now, and it gained the assertion that matters more: that the
lock has **not** written the `overflow` shorthand onto body — because doing
that would make body a scroll container again and silently reintroduce the
inert-`scrollIntoView` defect of §4b. The original check could not have seen
that. Falsified by writing the shorthand: the html assertion stays green and
the new one turns red, three times, exit 1.

⚠️ Worth naming: §4b's fix was verified against the drives that existed, and
this check still broke. A change to where a clamp lives invalidates every
assertion written against its old home, and nothing in this repository
connects the two.

### 4f. Verification

| | |
| --- | --- |
| responsive, after | **174 / 174 layouts clean**, including the new 40px nav-headroom floor |
| keyboard, after | **0 findings, stable across two consecutive runs** (see §5c for the one data-dependent false positive on a populated board) |
| nav drives, after | `nav-sheet-drive`, `nav-ui-drive`, `nav-audit`, `mobile-drive` all exit 0 |
| axe sweep, after | 10 public + 23 portal pages at 360 / 390 / 768 / 1280 — clean |
| falsified | reverting returned 119px, 135px and 44px at the exact original magnitudes; a forced control overlap is caught at 33×6px; the 481px nav reads 16px against a 40px floor; the `overflow` shorthand turns the new scroll-lock assertion red |

---

## 5. What is NOT established

### 5a. 🔴 Nine classes of false positive came out of these drives first

This is the most important section in the document. Before any finding reached
a human, the two new drives produced nine classes of confident false positive.
Two came close to real damage.

| | the drive said | it was |
| --- | --- | --- |
| 1 | 32 controls "entirely hidden" on the board | the API was down, so the app correctly showed its "No connection" dialog |
| 2 | a skip link exists but is not first | the hero's "Skip to rooms" board jump, matched by taking the first in-page anchor |
| 3 | footer links "hidden, covered by unknown" | off-screen below the fold, counted as obscured |
| 4 | 🔴 **27 controls with no focus indicator** | `:focus-visible` does not match programmatic focus, and this codebase styles focus almost entirely with it |
| 5 | the login submit "stayed disabled" | a malformed address, which the form correctly rejects |
| 6 | 🔴 **one footer link with no focus indicator** | the resting snapshot was taken *after* the Tab walk, so the still-focused control's focused styles were recorded as its resting styles |
| 7 | six spills per width on the board | `.trust-item` inside `.trust-strip`, a deliberate horizontal scroller |
| 8 | `select over button.cookie-notice__ok` | the cookie notice is an overlay; its button is `static` inside a `fixed` parent |
| 9 | two links overlapping 34×16px | `getBoundingClientRect()` on an inline link that **wraps**, whose box is the union of both line boxes |

**(4) and (6) are the ones that matter.** Both pointed at missing
`:focus-visible` rules. (6) sent me looking for a missing
`.footer-col ul li a:focus-visible` rule — and had I "fixed" the CSS, the false
finding would have disappeared and I would have reported a defect that never
existed. **2.4.7 passes everywhere and always did.**

The pattern behind four of them: **the fix and the measurement disagreed about
when "focused" is finished.** Once the 2.4.11 fix was corrected to act on
`scrollend`, the drive — still measuring at 90ms — reported **ten** failures
where there had been two. That was not a regression in the product.

So: a number from these drives is worth what its triage is worth, and anything
either drive reports should be reproduced before it is believed.

### 5b. Screen readers were not used

No assistive technology was run. Everything about screen-reader behaviour here
is inferred from the DOM and from ARIA semantics — `role`, `aria-live`,
`aria-describedby`, table semantics. That is necessary and not sufficient:
NVDA, JAWS and VoiceOver disagree with each other and with the specification,
and §3c's `display: block` finding is precisely the kind of thing only a real
screen reader settles.

### 5c. The Tab walk stops at 120 presses

On the board it finds 43 distinct controls and is still finding more. The drive
reports this as a note rather than a pass, but **the far end of that page is
unmeasured** for 2.4.11 and 2.4.7.

⚠️ **And on a populated database the cap misreports a trap.** On CI's seeded
database the board's tab ring closes inside 120 presses and 2.1.2 passes. On
this container's database — 49 active rooms, 24 cards on the first screen, 60
focusable controls at load — the walk runs the full 120, the last twenty stops
are all controls it had already seen, and the `allRevisited` heuristic
concludes `trapped`. So the drive reports **"2.1.2 no keyboard trap"** as a
failure on a page that has no trap.

Established, not inferred: the same failure appears with this branch's
stylesheet changes stashed and the frontend rebuilt, so it predates them, and
CI passes the same assertion on the same page at the same width. It is the
instrument, not the page.

Left as it is rather than fixed, because it is outside what this branch was
for and the fix needs its own falsification: the honest repair is to let the
walk's budget scale with the number of focusable controls found at load, so
"ran out of presses" and "cycling among a subset" stop being the same
observation. Recorded here so the next person to run this drive locally
against real data does not read it as a defect in the board.

### 5d. Three criteria were not assessed

- **3.2.6 Consistent Help** and **3.3.7 Redundant Entry** (both Level A, new in
  2.2) are in the axe tag set but have no automated rule; neither was checked
  by hand.
- **1.4.10 Reflow** at 320px was not driven — the narrowest width tested is
  359px, and 320px is the criterion's actual threshold.

### 5e. 🔴 Step 4 — cross-browser — was not performed

Two independent blockers.

**Only Chromium exists here**, measured rather than assumed:

```
chromium  OK          -> 153.0.8010.12
firefox   UNAVAILABLE -> Executable doesn't exist at /opt/pw-browsers/firefox-1543/
webkit    UNAVAILABLE -> Executable doesn't exist at /opt/pw-browsers/webkit-2359/
```

This environment also forbids `playwright install`, because another version
would not find the pre-installed browser. **So Safari/WebKit and Firefox are
untestable here — which includes iOS Safari, a large share of any real South
African audience.**

**And there is nothing to test against.** §1c: no browser support is declared
anywhere, so "the browsers the application officially supports" has no answer.

Every result in this document is therefore **Chromium 153 only**, and must not
be read as cross-browser evidence.

---

## 6. Recommendations, in the order I would do them

> **Status, 17 November 2026.** #2 was done with the audit. #3, #4, #5, #7, #8
> and #9 are done and are described in §7. #1 and #6 remain, and both are
> blocked on something this container cannot supply: a product decision and a
> real screen reader.


1. **Declare a browser support matrix.** It is the prerequisite for Step 4, and
   it is a product decision: name the Android Chrome and WebView versions this
   market actually runs, and say plainly that Opera Mini and KaiOS are not
   supported, rather than inheriting them from browserslist's defaults.
2. **Run the two new drives in CI.** `responsive-drive.mjs` is cheap.
   ⚠️ `a11y-keyboard-drive.mjs` is currently ~1.4s per Tab press, because it
   waits for scroll-rest plus the fix's 420ms settle — fine for an audit, too
   slow for CI. Take the expensive path only when a control overlaps the
   notice.
3. **Fix `CLAUDE.md`'s breakpoint list.** It names three of eleven and
   prescribes four widths that miss four boundaries. Both defects in §4c lived
   in those gaps for the life of the product.
4. **Add an `alt` check** for content images (§1b.2). Lighthouse covers four
   public URLs; nothing covers the other 47 pages.
5. **Assert accessibility in `lighthouserc.production.json`.** The live site's
   accessibility is the only one that matters to a visitor and is currently
   unasserted.
6. **Test one real screen reader** on the five screens that carry money or
   legal meaning: the board, a room page, the apply flow, the rent tracker and
   the lease documents screen. §5b is otherwise permanent.
7. **Drive 320px** for 1.4.10 Reflow (§5d).
8. **Delete the `.cookie-banner` rules** (§3b) — five dead rules that read as
   coverage.
9. **Scale the Tab walk's press budget** to the controls a page actually has
   (§5c), so a long board stops reading as a keyboard trap.


---

## 7. The five follow-ups, 17 November 2026

Done after the audit landed. Each one is here because the thing it fixed was
not what the recommendation said it was.

### 7a. #9 — the Tab walk: the budget was innocent

The recommendation was "scale the press budget to the controls a page has",
because the board reported **2.1.2 no keyboard trap** as a failure here while
CI passed it. Measuring first turned up a different cause.

The drive identified a tab stop by a string: `TAG.class#id:text(20)`. On the
board that collides wholesale — every room card's save button is a `BUTTON`
with class `save-btn` and no text, so all of them produce `BUTTON.save-btn#:`.
Measured on this container: a 120-press walk produced **120 stops and 20
distinct id strings**, with `BUTTON.save-btn#:` appearing **49 times**.

The walk was not cycling at all. The board lazy-loads cards as Tab scrolls it,
so it kept reaching genuinely new controls — but the `allRevisited` test
compared strings, found every one of the last twenty "already seen", and
declared a trap. Scaling the budget would have made the walk longer and the
verdict just as wrong.

So the stop now carries a real identity: `data-a11y-uid`, assigned the first
time an element is seen and kept after, which survives the DOM growing under
the walk. The budget is scaled as well, because that part was also true — it
is `controls-at-load × 3 + 60`, floored at 120 and ceilinged at 600, and the
ceiling is reported when reached rather than passed over.

| | before | after |
| --- | --- | --- |
| board @ 390px | 120 stops, **reported a trap** | 158 stops, ring closes, passes |
| board @ 1280px | 120 stops | 190 stops |
| full drive | 1m53s | 2m15s |

That also closes §5c: the far end of the board is no longer unmeasured for
2.4.11 and 2.4.7. Falsified with a **real** keyboard trap injected into
`app.ts` — a handler that cycles focus between two controls — which the drive
caught at exit 1 after the full 240 presses, and which was reverted.

### 7b. #3 — CLAUDE.md's breakpoints, and the list one level down

CLAUDE.md said "the breakpoints this codebase actually uses are 900 / 768 /
480". The stylesheets declare eleven. It now names all eleven, says the four
hand-checked widths are a smoke check rather than coverage, and records that
both §4c defects lived in the gaps those four leave.

The part worth more than the text: **`responsive-drive.mjs` was itself
carrying a hand-written array** of the same eleven numbers. A second list to
keep in step is the same defect one level in, and it would have gone stale the
same way while the drive still printed "every declared breakpoint". It now
reads every `(min|max)-width` out of `frontend/src`, and exits 1 if it finds
none, so an empty list cannot sail through. Proven by adding a `523px` query
and watching 522/523/524 appear in the next run unprompted.

### 7c. #7 — 320px Reflow: clean, and now driven

All six public pages pass at 320px, so 1.4.10 had no defect to find. 320 is
not a breakpoint and the derivation above would never have reached it, so it
is added by hand as a criterion and kept separate from the derived list to
keep that distinction visible. The drive is 180 layouts now. Falsified by
forcing a 430px min-width under 330px: 110px of page scroll, exit 1.

### 7d. #8 — the dead cookie rules were nine, not five

`.cookie-banner` and its `h3`/`p`/`a`, `@keyframes slideUp`, `.cookie-actions`,
`.btn-cookie-reject`/`accept`/`manage`, and a responsive override. None of them
appears in any template; the live component renders `.cookie-notice*`.

⚠️ **`css-coverage-audit.mjs` cannot see this class of defect, by design.** Its
own baseline says what it checks: "classes used in a template with no rule
anywhere". The reverse — a rule with no template — is unguarded, and that is
how a correct `text-decoration: underline` sat in this repository pointing at
nothing while the live cookie link failed 1.4.1.

Measured rather than guessed, and **not** turned into a gate: **32 of 417**
classes declared in the global stylesheets are mentioned nowhere else. But
about twelve of those are live — `status-*` and `passport-pill--*` are applied
through `[class]="'status-' + x"` bindings, and `ng-invalid`/`ng-touched` are
Angular's own. A bare reverse sweep would condemn live code, so it needs
judgement per class rather than a baseline nobody reads. Recorded as a
follow-up, with one specific lead: the six `btn--*` aliases in `_bridge.scss`
exist under a comment claiming "templates use both", and no template uses the
BEM form.

### 7e. #4 — an alt check that covers what the sweep cannot

`scripts/alt-text-lint.mjs`: 11 `<img>` tags across 8 files, all of which
already declare alt. It is preventive, and it is a **source** lint on purpose.
axe reports `image-alt` for images that are in the DOM when it looks, and an
image only gets there if something rendered it — the ad slot needs a live
campaign, the storefront logo an upload, the gallery photos, the admin preview
a chosen file. The sweep speaks for whatever the fixtures produced on the
routes it visited; Lighthouse speaks for four URLs. Reading the source covers
every branch no seeded database will reach.

`alt=""` passes deliberately — it is the specified way to mark an image
decorative and four images here use it correctly next to the text they would
otherwise repeat. Only a missing alt fails.

Two things it taught while being built, both recorded in the script:

- its first run reported an `<img>` inside a **doc comment** in
  `imagekit.utils.ts`, prose about images rather than an image;
- stripping those comments then moved every line number after them, so the
  falsification pointed at line 82 for a tag on line 93. Comments are blanked
  in place now, preserving newlines. **A finding that points at the wrong line
  teaches the reader not to trust the next one.**

⚠️ And it is wired in **two** places, which is the point: `npm run audit`, and
its own step in `ci.yml`. CI invokes these scripts individually and does not
run `npm run audit`, so the package script alone would have been a control
that only looked like one.


---

## 8. 🔴 #5 — asserting the live site, and what asserting it found

Recommendation 5 was a one-line job: `lighthouserc.production.json` collected
accessibility and never asserted it, so the only accessibility score anybody
guaranteed was the one from a localhost build nobody visits. Adding the
assertion turned up a live defect.

### 8a. The live site scores 0.96, and it is the cookie link again

This container cannot reach `www.umastande.co.za` (egress policy), so the
number is not mine — it is read from the weekly production audit's own run of
16 November, which **passed** because nothing asserted it:

```
── https://www.umastande.co.za/            performance 0.97  accessibility 0.96
── https://www.umastande.co.za/pricing     performance 1     accessibility 0.96
── https://www.umastande.co.za/how-it-works performance 0.99  accessibility 0.96

accessibility 0.96 — what it lost it on:
  · link-in-text-block  score 0  weight 7.00  Links rely on color to be distinguishable.
    selector: app-cookie-consent > div.cookie-notice > p.cookie-notice__body > a
```

One audit, on all three URLs, and it is **exactly the defect §3b fixed** — a
prose link told apart from its sentence by colour alone at 1.06:1, underlined
only on `:hover`, on a product whose audience has no hover.

### 8b. Why: production serves `master`, and the fix is on `develop`

Verified rather than assumed, with `git show origin/master`: `master` contains
no `.cookie-notice__body a` rule and no `p a:not(.btn)` rule. The fix went in
with the audit on `develop`. So the live site is serving a build that predates
it, the cookie notice is on **every** page, and **every page of the live site
currently fails WCAG 1.4.1**.

⚠️ **This is the finding, not the assertion.** The defect has been live since
the audit was written. Nothing caught it because the one job that looks at the
live site collected the score and asserted four other things.

### 8c. The threshold is 1.0, and it will be red until production is deployed

`categories:accessibility: ["error", { "minScore": 1.0 }]`.

1.0 is not aspirational — it is what the fixed code measures, and the PR gate
in `lighthouserc.json` has asserted it for the life of that file. Asserting
0.96 to make the weekly job green today would lock the defect in, which is the
opposite of what an assertion is for. **The red is correct and the remedy is a
production deploy from `develop`.**

### 8d. Falsified, by rebuilding production's own state

Removing `.cookie-notice__body a { text-decoration: underline }` was **not
enough** — accessibility stayed at 1.0. §3b had added two independent rules,
and the cookie link sits inside a `<p>`, so `p a:not(.btn):not(.btn-link)`
still underlined it. Worth recording as a property of the fix: the link is
underlined by two rules, so losing either one does not regress it.

With both disabled, the production state reproduced exactly:

| | fixed build | both rules disabled | live site |
| --- | --- | --- | --- |
| `categories:accessibility` | **1.0** | **0.96** | **0.96** |
| `link-in-text-block` | 1 | 0 | 0 |
| failing node | — | `…p.cookie-notice__body > a` | `…p.cookie-notice__body > a` |

`lhci assert` against the production config then failed as it should —
`expected: >=1, found: 0.96`, exit 1 — and passes at exit 0 with both rules
restored.
