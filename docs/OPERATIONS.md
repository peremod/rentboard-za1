# RentBoard ZA — Operations Runbook

**Version 2.0 · September 2026**
Replaces `OPERATIONS.md` v1.0. Adds mission/vision, North Star metric, milestone ladder, and a calendar-aligned cadence.

---

## 1. Mission

> **RentBoard ZA gives South African landlords and tenants a direct line to each other.** Landlords post rooms in minutes; tenants apply for free, always. No estate agent in the middle, no application fees, all prices in Rand, and every step built to South African law.

**Why this wording:**

| Change from the original | Reason |
|---|---|
| "online notice board where…" → "gives landlords and tenants a direct line to each other" | A mission states the change you create, not the product category. The category belongs in positioning. |
| Added "in minutes" | Makes the landlord-side promise measurable (time-to-first-listing). |
| "apply for free, always" | Matches the Brand doc's core hook verbatim — one phrase, everywhere. |
| Added "built to South African law" | POPIA / Rental Housing Act / PIE compliance is a differentiator, not a footnote. |
| Dropped trailing comma / open list | A mission must be a closed, quotable sentence. |

**Short form (for the footer, deck slide 1, GitHub repo description):**
> Rooms to rent, direct from landlords. Free to apply, always.

---

## 2. Vision

> **To be the first place anyone in South Africa looks for a room — and the standard the rest of the world copies for direct, agent-free room letting.**

**Why this wording:**

| Change from the original | Reason |
|---|---|
| "best in the world at providing…software" → "the standard the rest of the world copies" | "Best at software" is inward-looking. A vision describes the world once you've won. |
| Anchored in South Africa first, world second | Matches the GTM doc: supply-first, two metros, then provinces, then beyond. Vision should be reachable in the same direction as the plan. |
| "first place anyone looks" | Gives the vision a testable proxy: unprompted brand recall and direct/organic traffic share. |
| Dropped "search/discover…software for landlords and tenant" | Grammar, and the software is the means, not the end. |

**Vision proof points (what "true" looks like):**
- Top-3 organic result for *"rooms to rent \<SA city\>"* in all 9 provinces.
- >50% of sessions arrive direct or organic, not paid.
- A landlord's default sentence becomes "put it on RentBoard."

---

## 3. North Star & guardrails

**North Star metric: rooms successfully let per month** (`tenant.moved_in` events).
It is the only metric that requires both sides of the marketplace to have worked.

| Guardrail | Target | Owner | Reviewed |
|---|---|---|---|
| Landlord median first-response time | < 24h | Product | Weekly |
| Tenant application → landlord response rate | > 70% | Product | Weekly |
| Fraud reports acknowledged | < 4 business hours | Support | Daily |
| PAIA / privacy requests acknowledged | < 5 business days (legal) | Support + Legal | Daily |
| Lighthouse mobile Performance (prod) | ≥ 90 | Engineering | Monthly |
| Lighthouse A11y / Best Practices / SEO | 100 / 100 / 100 | Engineering | Monthly |
| Infra cost | ≤ R540/mo at Tier 1 | Engineering | Monthly |
| P1 errors unresolved > 24h | 0 | Engineering | Daily |

---

## 4. Milestone ladder

Each milestone maps to a git tag, so progress is auditable from the repo alone.

| # | Milestone | Definition of done | Tag |
|---|---|---|---|
| M0 | Code-complete MVP | All audit findings closed | `v1.0.0` ✅ |
| M1 | Legally live | Information Officer registered, PAIA manual filed, prod smoke test green | `v1.1.0` |
| M2 | Supply seeded | 50 real rooms live, 20 landlords white-glove onboarded (GP + WC) | `v1.2.0` |
| M3 | Loop proven | 100 applications, >70% landlord response rate, first 5 rooms let | `v1.3.0` |
| M4 | Public beta | Paid acquisition on, ≥90 Lighthouse mobile, all 11 languages shipped | `v2.0.0` |
| M5 | Break-even | Recurring revenue ≥ infra cost (2 Pro landlords) | `v2.1.0` |
| M6 | Province scale | Listings live in all 9 provinces, top-3 organic in GP + WC | `v3.0.0` |

Review at the quarterly OKR session; never move a milestone without moving its tag.

---

## 5. Cadence (mirrors the calendar)

### Daily — weekdays

| Time (SAST) | Block | What |
|---|---|---|
| 08:00–08:15 | Health check | Sentry error groups (auth/payments/publish first). Render service memory and p95 <500ms. No red CI on `master`/`develop`. |
| 08:20–08:40 | Trust & Safety | `safety@` inbox, flagged listings, PAIA/privacy inbox. |
| 16:30–16:45 | Growth pulse | Landlord signups vs rooms posted. Social mentions/DMs answered. |

> A signup–listing gap is a funnel bug, not a marketing-spend problem. Fix the form before buying more traffic.

### Weekly

| Day | Block | What |
|---|---|---|
| Mon 09:00 | Funnel review | visit → room view → signup → application → shortlisted → moved in. Flag the biggest week-over-week drop and open one ticket for it. |
| Tue 09:00 | Dependency & security | `npm outdated` + `npm audit` both apps. Supabase usage trend vs upgrade triggers. |
| Wed 10:00 | Marketing + SEO | 2–3 rooms cross-posted. Search Console: index errors, top queries, CTR. One content piece. |
| Thu 15:00 | Release candidate | `develop` → staging, smoke test, then tag and merge to `main` per `CONTRIBUTING.md`. |

```bash
cd frontend && npm outdated; npm audit --production
cd ../backend && npm outdated; npm audit --production
```

### Monthly

| When | Block | What |
|---|---|---|
| 1st, 09:00 | Lighthouse + technical SEO | Full run of `SEO-LIGHTHOUSE-CHECKLIST.md` against production. |
| 15th, 11:00 | Repo & secrets hygiene | Prune merged branches, rotate due secrets, confirm env parity dev/staging/prod. |
| 1st Friday, 14:00 | Finance | Stripe payouts vs `subscription.payment_received` / `boost.payment_received`. Cost vs R540 baseline. |
| 25th, 10:00 | Compliance | Information Officer registration, PAIA manual accuracy, consent + retention jobs. |

```bash
git fetch --prune
git branch -r --merged origin/develop \
  | grep -v 'main\|develop' | sed 's/origin\///' \
  | xargs -r -n1 git push origin --delete
```

### Quarterly — 5th of Jan / Apr / Jul / Oct, 10:00

1. Restore a Supabase backup to a scratch project and verify it opens. A backup you have never restored is a rumour.
2. Review OKRs against §1–2; score last quarter honestly.
3. Set the next milestone from §4 and cut the minor version tag.
4. Re-read the mission aloud. If a shipped feature does not serve it, schedule its removal.

---

## 6. Incident escalation

1. Hit `/health`; read the Render service logs.
2. DB-related? Supabase status page + connection count.
3. Traffic spike? Move the Render service off the free tier to a paid instance (the free tier sleeps and does not scale).
4. Post a one-line internal status. If customer-facing and >15 min, post on socials.
5. Postmortem within 48h for any outage >10 min: root cause, fix, follow-up ticket.

---

## 7. Release day checklist

- [ ] `CONTRIBUTING.md` release flow followed (tag, merge to `main`).
- [ ] CI green on `main` post-merge.
- [ ] Render + Vercel deploy logs both report healthy.
- [ ] Production smoke: register → browse → apply → mark-as-let → relist → Stripe checkout.
- [ ] Internal-link + slug spot check on changed routes (no 404, no redirect chains).
- [ ] Changelog entry published.

---

## 8. Ownership matrix

| Area | Primary | Cadence | Ties to |
|---|---|---|---|
| CI/CD health | Engineering | Daily | M1 |
| Fraud / listing reports | Support | Daily | Mission — safety |
| Funnel & conversion | Product | Weekly | North Star |
| Landlord & tenant growth | Marketing | Weekly | M2, M3 |
| Infra cost & scaling | Engineering | Weekly | M5 |
| SEO / Lighthouse | Engineering | Monthly | Vision — "first place anyone looks" |
| Compliance (POPIA / PAIA) | Legal | Monthly | Mission — SA law |
| OKRs & milestones | Founder | Quarterly | §4 |

---

## 9. Where this doc sits

| Doc | Role |
|---|---|
| `README.md` | What the system is, how to run it |
| `CONTRIBUTING.md` | Git workflow, commit rules, release process |
| `OPERATIONS.md` *(this)* | Who does what, how often, and why it matters |
| `SEO-LIGHTHOUSE-CHECKLIST.md` | The monthly technical SEO run |
| `PRE-LAUNCH-CHECKLIST.md` | One-time M1 gate |
| `docs/ENVIRONMENTS.md` | Environment matrix, parity rules, CI pipeline |

Marketing and planning documents are **not in this repository**. Brand, GTM, landing-page copy and the advertising playbook live in Notion → Company OS, because they need owners, statuses and dates rather than diffs. See the "Where Things Live" page there for the full split.

Mission and vision in §1–2 are the canonical wording. Any other document that states them must quote these, not paraphrase. The Notion Company OS page holds the same text; if the two ever differ, that is a bug — fix both in one change.

---

## Linting

**The backend is linted; the frontend is not yet.**

Both `package.json` files used to carry a `lint` script — `ng lint` and
`eslint --fix` — while neither project had ESLint as a dependency, so the
script failed on a missing binary rather than on code quality, and CI ran
nothing. The backend script also passed `--fix`, which would have rewritten
files inside CI and then built whatever came out.

### Backend

`backend/eslint.config.mjs` is a flat config built on
`eslint.configs.recommended` and `tseslint.configs.recommended`, with two rules
turned down where the default fights the framework rather than finding bugs —
each with the reason next to it in the file. `npm run lint` runs it, CI runs it
as a gate, and `npm run lint:fix` is available locally. `--fix` is deliberately
not what CI runs.

Turning it on was worth it immediately: it found three dead imports and, more
usefully, a `crypto` import in `notifications.controller.ts` that nothing used
— which was the Resend webhook's signature verification never having been
written. The handler checked that a `svix-signature` header was *present* and
then trusted it, so anyone could have posted a forged `email.bounced` for any
address and suppressed that person's mail, including their magic links. That is
now verified (HMAC-SHA256 over `${id}.${timestamp}.${body}`, constant-time
compare, five-minute replay window), and it fails closed: with no
`RESEND_WEBHOOK_SECRET` set the endpoint returns 503 rather than acting on an
unverified event, and production refuses to boot without one.

21 `no-explicit-any` warnings remain. They are warnings on purpose — Prisma's
generated types surface `any` at the boundary, and making it an error would
have meant either silencing it everywhere or not adopting the linter at all.

### Frontend — still outstanding

```bash
npm --prefix frontend install --save-dev angular-eslint eslint typescript-eslint
npx --prefix frontend ng add angular-eslint
```

Expect a large number of findings on first run — around 60 components have
never been linted, and angular-eslint also brings template rules. Triage them
before turning the CI step on, or the first green build becomes a red one
nobody can fix quickly, and the habit of ignoring CI starts there. The backend
config is the model to follow: start from the recommended sets, and write down
the reason beside anything turned off.

---

## Testing

**The backend has no test framework installed.** `package.json` carried
`"test": "jest"` and `"test:e2e": "jest --config ./test/jest-e2e.json"` from
the original Nest CLI scaffold, but `jest` was never added as a dependency and
no `*.spec.ts` files exist — CI only discovered this once it started actually
running (see the note at the top of `.github/workflows/ci.yml`), and `npm
test` failed with `jest: not found` rather than a test failure.

Both scripts now say so rather than failing. `npm run typecheck` is the real
gate on the backend, same as linting.

The frontend is unaffected — Angular CLI's `ng test` (Vitest) is installed
and runs in CI.

### Adding backend tests properly

Also worth doing as its own task:

```bash
npm --prefix backend install --save-dev jest @types/jest ts-jest @nestjs/testing
npx --prefix backend ts-jest config:init
```

Then restore the `test` / `test:e2e` scripts and write specs before wiring
the CI step back to a real `jest` invocation — an empty gate that always
passes is worse than an honest stub, for the same reason as linting above.
