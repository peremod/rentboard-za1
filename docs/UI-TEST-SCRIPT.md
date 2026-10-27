# Testing the UI by hand

A script you can work through on a phone. Every step says what you should
see, so a step that does not match is a finding rather than a doubt.

Written after a report that a landlord could see an application while the
tenant's dashboard showed nothing. That one did not reproduce — §4 below is
the sequence that settles it in under a minute, and §0 is the setup mistake
that most often produces it.

---

## 0. Set up, and the trap that wastes an afternoon

You need **two accounts, signed in at the same time, in two places that do not
share a session**:

| Role | Where to sign in |
| --- | --- |
| Landlord | your normal browser |
| Tenant | a **private/incognito window**, or a second browser |

⚠️ **The trap.** Two tabs in the same browser share one session. Signing in as
the tenant in a second tab silently signs the landlord out of the first, and
the next page you load as "the landlord" is really the tenant — or an
anonymous visitor who gets an empty list. **Every "one side sees it and the
other does not" report should start by checking which account is actually
signed in.**

**How to check, in two seconds:** open the menu (☰). The account name at the
top is who you are. Do this on BOTH sides before believing any mismatch.

Write the two email addresses down. You will be switching often.

---

## 1. Signed out — what a stranger sees

| # | Do | Expect |
| --- | --- | --- |
| 1.1 | Open the site signed out | The board loads, rooms are listed |
| 1.2 | Open a room | Photos, rent, area, "Apply" |
| 1.3 | Tap Apply | Sent to sign in or register, **not** an error |
| 1.4 | Open `/pricing` | Says listing is free and applying is free |
| 1.5 | Open `/tenant/dashboard` directly in the address bar | Sent to sign in — **never** a blank screen or someone else's data |
| 1.6 | Open `/landlord/dashboard` directly | Same |

---

## 2. The landlord: listing a room

| # | Do | Expect |
| --- | --- | --- |
| 2.1 | **+ List a room** | The wizard opens |
| 2.2 | Fill it in, save without publishing | Saved as a **draft** |
| 2.3 | Find it on the public board | **Not there.** A draft is not public |
| 2.4 | Try to publish with no photo | Refused, and says a cover photo is needed |
| 2.5 | Add a photo and publish | Status goes **Active** |
| 2.6 | Find it on the public board | It is there |
| 2.7 | Dashboard room card | "Viewed N times this week. N people have applied." |
| 2.8 | **Pause** | Disappears from the public board, card says paused |
| 2.9 | Resume | Back on the board |

---

## 3. The tenant: applying

Switch to the tenant window.

| # | Do | Expect |
| --- | --- | --- |
| 3.1 | Find the room, apply with a note | Confirmation; you are not asked to pay anything |
| 3.2 | Tenant dashboard → **Your applications** | The room is listed, status **Pending** |
| 3.3 | Apply to the same room again | Refused — one application per room |
| 3.4 | Open the room again | It shows you have applied |

---

## 4. Both sides agree — run this whenever the two disagree

This is the sequence that settles a "landlord sees it, tenant does not"
report. Do each landlord step, then **refresh the tenant dashboard** and read
the status. They should always match.

| # | Landlord does | Tenant's dashboard should say |
| --- | --- | --- |
| 4.1 | Opens the applicant | **Viewed** |
| 4.2 | Shortlist | **Shortlisted** — still under *Your applications*, with Withdraw |
| 4.3 | Invite to a viewing | The invitation appears, with accept/decline |
| 4.4 | — (tenant accepts) | The agreed time shows on both sides |
| 4.5 | After the time passes, **"They did not turn up"** | ⚠️ The application **stays open** — still under *Your applications*, still Shortlisted. A notice says the viewing did not happen. It must **not** vanish |
| 4.6 | **"They have taken another room"** | Now closed — moves to **Closed applications** |
| 4.7 | Accept the applicant | **Accepted**, and the room shows as let |
| 4.8 | Reject instead | **Rejected**, under Closed |

⚠️ **4.5 is the one that was reported.** Marking a no-show must leave the
application open on both sides. If the tenant's list is empty here, check §0
first, then scroll to **Closed applications** — if it is filed there, that is
a real bug worth reporting.

⚠️ **Refresh, do not trust a page you left open.** These screens load their
data once. A dashboard opened before the landlord acted will still show the
old status until you pull to refresh.

---

## 5. Messages, notices, viewings

| # | Do | Expect |
| --- | --- | --- |
| 5.1 | Tenant sends a message on the application | Landlord sees it in Messages |
| 5.2 | Landlord replies | Tenant sees it |
| 5.3 | **Notices** (both sides) | Every event above has an entry. Tapping one opens it as one card — the text and the button inside the card, not spilling out |
| 5.4 | Mark one read | The bell count drops by one, the notice stays in the list |
| 5.5 | Mark all read | Count goes to zero |
| 5.6 | "Say what happened" on a past viewing | Scrolls to the viewing — **does not sit still** |

---

## 6. Rent, lease and money wording

| # | Do | Expect |
| --- | --- | --- |
| 6.1 | After accepting, open the rent tracker | Says plainly it is the landlord's own record |
| 6.2 | Lease documents screen | Says nothing was signed here |
| 6.3 | Mark a month unpaid, tenant disputes it | Both sides see the dispute |
| 6.4 | Anywhere in listing or applying | **No fee is ever asked for.** If any screen asks a landlord to pay to list, or a tenant to pay to apply, stop and report it |
| 6.5 | Referrals panel | ⚠️ It may say "You have N free verifications earned. It covers the R149 identity check." **That is not yet redeemable** — the identity check still asks for payment. Known, recorded, awaiting a decision |

---

## 7. Every screen, at four widths

Do this for any screen you changed, and for the whole list once before a
release. Phone first — that is who uses this.

**Widths: 360, 390, 768, 1280.** On a phone, 360 and 390 are the real ones;
for the others use a desktop browser window resized, or Chrome's device
toolbar.

On each screen check:

- [ ] **No sideways scrolling.** Swipe left and right — the page must not move
- [ ] **Nothing cut off** at the right edge
- [ ] **Buttons are tappable** — roughly a fingertip, about 44px, not touching each other
- [ ] **Text wraps** instead of running off in one long line
- [ ] **The menu opens and closes**, and every item in it goes somewhere
- [ ] **Hover does not stick.** After tapping a button, it must not stay lifted or recoloured

Screens worth doing every time: the board, a room page, both dashboards, the
applicants screen, messages, notices, settings, pricing.

---

## 8. Language

Switch language in the menu.

| # | Do | Expect |
| --- | --- | --- |
| 8.1 | Pick isiZulu or Afrikaans | The page translates; the URL gains `/zu/` or `/af/` |
| 8.2 | Move around a few screens | The language sticks |
| 8.3 | Switch back to English | URL loses the prefix |

---

## 9. When something is wrong

Write down, in this order:

1. **Which account** you were signed in as (menu → name), on both sides
2. **The screen** — paste the address from the address bar
3. **What you expected** and **what you saw**
4. **A screenshot** with the time visible
5. Whether a **refresh** changed it

Points 1 and 5 settle most "one side disagrees with the other" reports before
anybody reads any code.
