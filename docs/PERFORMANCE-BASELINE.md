# Performance baseline — 14 November 2026

> **Updated 15 November 2026.** Steps 1 and 2 were accepted and three of the
> four follow-ups were carried out: the keep-warm schedule, the API
> instrumentation, and the search cliff measured offline. Those are written
> into the sections below, each marked `[15 Nov]`. **The load test in §3 has
> still not been run and still needs authorisation.**
>
> ⚠️ One recommendation in §4 was WRONG and is corrected there: an external
> pinger firing reliably would have exhausted Render's shared free
> instance-hour allowance and suspended production. The arithmetic was not
> done when that recommendation was written.

Step 1 and 2 of the performance brief: a read-only assessment and the
measurements that can be taken without load. **No load test has been run.** The
plan for that is at the end and needs a decision before anything is executed.

---

## 1. Architecture, and what it means for performance

| Layer | Where | Plan | The performance consequence |
| --- | --- | --- | --- |
| Frontend | Vercel, Angular 21 SSR | free | prerendered + server-rendered; CDN-cached |
| API | Render, NestJS 11 | **free** | **sleeps after ~15 min idle; 30–60 s to wake** |
| Database | Neon Postgres | free | sleeps too; separate network hop from Render |
| Images | ImageKit | free | transformed at the edge |

`render.yaml` records the cold start as a decision rather than a defect, in its
own words: *"the first person to open umastande.co.za after a quiet
quarter-hour waits up to a minute for a room board to appear, on a cheap
Android, on mobile data… that person closes the tab."*

### What is already measured, and what is not

**Frontend — well covered.** `lighthouse.yml` runs Lighthouse CI on every
frontend PR against a local production build, and weekly against production.
Mobile, simulated slow 4G, `aggregationMethod: median` (the comment records
why: optimistic aggregation let a median CLS of 0.953 pass a 0.1 budget).
Budgets asserted directly rather than via the rolled-up score:

| | PR budget | production budget |
| --- | --- | --- |
| LCP | 2500 ms | 4000 ms |
| CLS | 0.1 | 0.1 |
| TBT | 200 ms | 600 ms |

Plus `bundle-budget.mjs` in CI (currently **47.9 KB under budget**),
`font-paint-drive.mjs` for `font-display` behaviour, and `double-fetch-drive`
asserting the board is not re-fetched after SSR.

🔴 **API and database — nothing.** No request-timing interceptor, no metrics,
no latency budget, no slow-query log (Prisma logs `warn`/`error` only, never
`query`), no load test, and no concurrency test beyond the correctness races in
`double-let-drive` and `inbox-race-drive`. The asymmetry is the main gap in
this assessment: the half of the stack that will fall over first is the half
with no instrumentation.

⚠️ **INP is not measured anywhere.** Lighthouse reports TBT, which is a lab
proxy; INP is a field metric and needs real users (RUM) or a scripted
interaction. The brief asks for it and nothing in the repository collects it.

---

## 2. Measurements

### 2a. 🔴 The keep-warm job fires at 3% of its schedule

`keep-warm.yml` exists to stop the free-tier API sleeping. It is scheduled
`*/10 * * * *` — every ten minutes, against a ~15-minute sleep window.

Measured from the workflow's own run history:

| | |
| --- | --- |
| Total runs ever | 117 |
| Most recent 100 runs span | 23 Oct → 14 Nov, **22 days** |
| Runs a 10-minute schedule would produce in 22 days | **3,168** |
| Runs actually fired | **~100** |
| Gaps between consecutive runs | 269–479 min (**4.5–8 hours**), median 402 |
| Gaps inside the 15-minute sleep window | **0 of 11** |

Every run is `event: schedule` and every one succeeded. **The job works; GitHub
is not firing it.** Scheduled workflows on free runners are best-effort and
high-frequency crons are commonly dropped.

So the mechanism that is supposed to keep production warm is delivering about
one wake every six and a half hours, and **production is cold for nearly every
real first visitor** — the exact cost `render.yaml` describes.

⚠️ It is also invisible: the job is green on every run, and nothing compares
its own cadence to the sleep window. A control that only looks like a control.

#### [15 Nov] Re-measured on fresh data, and the cause identified

Re-run against the latest 60 runs (31 Oct – 15 Nov), which also confirms the
finding is not an artefact of the window first sampled:

| | |
| --- | --- |
| Total runs ever | 122 |
| Last 60 runs span | 31 Oct → 15 Nov, **15 days** |
| Runs a 10-minute schedule would produce | **2,160** |
| Runs actually fired | **60** |
| Gaps between consecutive runs | 170–616 min, median **389** |
| Gaps inside the 15-minute sleep window | **0 of 59** |
| Runs cancelled or skipped | **0** |

Two things are now settled that were inference before.

**It is not `concurrency: cancel-in-progress` eating deliveries.** Not one run
in 122 has any conclusion other than `success` — a cancelled run would say so.

**It is GitHub's scheduler running hours behind for this repository, not
dropped jobs.** The weekly Lighthouse cron (`0 5 * * 1`) in the same repository
fires **every single Monday without a miss** — eight consecutive Mondays
sampled, 21 Sep through 9 Nov — but between **5h20m and 8h31m late** every
time. That is the same magnitude as the keep-warm gaps. The scheduler is
delivering this repository's schedules roughly once every six and a half hours
whatever the expression says. **So no cron expression fixes this**, and
tightening the number would have changed what the file claims and not what
happens.

#### [15 Nov] 🔴 And the real finding: the workaround is arithmetically impossible

`keep-warm.yml`'s own cost note 2 warned that a service kept awake around the
clock runs ~730 instance hours a month against an allowance of 750, and asked
for the number to be verified. It is now verified against Render's own
documentation: **750 free instance hours per workspace per calendar month,
shared across every free service in it** — and this blueprint has two, staging
and production, both `plan: free`. Exceeding the allowance **suspends the
services for the rest of the month**. There is no overage bill; there is an
outage.

Which inverts the whole finding:

- A ping every ten minutes covers the sleep window completely and costs **731
  hours a month** — the entire allowance, with nothing left for staging.
- **The broken schedule is the only reason production has not been suspended.**
- Covering the window *means* being awake continuously, and being awake
  continuously *costs the whole allowance*. **There is no cadence that does
  both.** The workaround is not merely broken; on this plan it cannot exist.

This also retires the external-pinger recommendation (§4.1 as first written):
an external pinger would fire reliably and therefore cause exactly the
suspension the broken GitHub schedule has been preventing. The cost is in the
instance hours, not in who sends the request.

#### [15 Nov] What was changed

The schedule is now **hourly**, with the arithmetic written into the workflow:
~183 hours a month, and at most 25% of the day covered if GitHub ever fires on
time. That is a worse promise, honestly stated — chosen because it is strictly
safer than what was there. Today it behaves identically (GitHub fires neither),
and if GitHub's backlog ever clears, hourly keeps running while `*/10` would
have taken production down mid-month.

`scripts/keep-warm-budget.mjs` is the gate, in CI and in `.husky/pre-commit`
(where workflow files are checked, because a workflow GitHub cannot parse never
runs). It models the declared cron, computes coverage and projected instance
hours, and **fails** when the cadence does not fit the budget. Falsified four
ways, exit codes checked rather than eyeballed:

| state | result |
| --- | --- |
| declared hourly | exit 0 |
| `*/20` (548 h/month) | **exit 1** |
| `*/10` (731 h/month) | **exit 1** |
| cron line deleted | **exit 1** — "a gate with no input is not a gate" |
| `0 5 * * 1` (unmodellable shape) | **exit 1** — it refuses rather than guessing |

The model carries six self-check cases with hand-computable answers and five
malformed expressions it must reject, so the arithmetic that produces the
verdict is itself checked.

### 2b. Local API latency — healthy at this scale

Local dev API, 139 active rooms / 256 rooms / 510 users, 12 samples each,
median and worst. **A local database with no network hop — production adds a
Render→Neon round trip to every query.**

| Endpoint | median | worst |
| --- | --- | --- |
| `/health` | 3 ms | 3 ms |
| board, no filter | 7 ms | 13 ms |
| board, city filter | 7 ms | 9 ms |
| board, two-token search | 6 ms | 13 ms |
| board, search matching nothing | 6 ms | 8 ms |
| board, page 5 | 7 ms | 9 ms |
| `/rooms/suggest` | 4 ms | 5 ms |
| `/rooms/categories` | 1 ms | 15 ms |
| room detail | 5 ms | 14 ms |
| `/sitemap.xml` | 9 ms | 14 ms |
| landlord inbox (heaviest aggregate) | 13 ms | 30 ms |
| 9 other portal reads | 4–6 ms | ≤ 126 ms |

### 2c. 🔴 Authentication is 50× everything else, and it is CPU-bound

| | median | worst |
| --- | --- | --- |
| `POST /auth/login` | **286 ms** | 410 ms |
| every other endpoint | 1–13 ms | ≤ 30 ms |

`SALT_ROUNDS = 12` in `auth.service.ts`. That is a deliberate security
parameter and this is **not** a recommendation to lower it — it is a capacity
statement, because bcrypt is CPU work and the free tier has very little CPU.

A small concurrency probe, 8 requests, local, one API process:

| | sequential median | concurrent median | 8 requests wall clock | implied rate |
| --- | --- | --- | --- | --- |
| `/auth/login` | 301 ms | **668 ms** | 671 ms | **~12 logins/s** |
| `/api/rooms` | 8 ms | 32 ms | 33 ms | ~246 req/s |

8 × ~300 ms of bcrypt completing in 671 ms means about four ran at once:
`UV_THREADPOOL_SIZE` is unset, so it defaults to **4**, and bcrypt runs on that
threadpool. Login throughput is bounded by that constant, not by the database.

⚠️ **The 12 logins/s number is not capacity and must not be quoted as such.**
It was measured on a 4-CPU, 16 GB container with a local database. Render's
free plan is a fraction of that, so the real figure will be materially lower —
how much lower is unknown and is one of the things the load test is for.

### 2d. The board's text search cannot use an index

`parseSearchPhrase` extracts city, province and room type; remaining words
become `contains` with `mode: 'insensitive'`, which Prisma compiles to
`ILIKE '%term%'`. There is no `pg_trgm`, no `tsvector`, and no Prisma
`fullTextSearch` preview feature anywhere in the schema or migrations — checked
rather than assumed.

Measured plan at the current size:

```
Seq Scan on rooms  (actual time=0.368..0.368 rows=0 loops=1)
  Filter: (status = 'active' AND (title ~~* '%student%' OR description ~~* …)
           AND (title ~~* '%affordable%' OR …))
  Rows Removed by Filter: 256
Execution Time: 0.493 ms
```

A sequential scan evaluating up to **8 ILIKE comparisons per row per token**.
The six `Room` indexes (`status`, `[province, city]`, `rentCents`,
`landlordId`, `propertyId`, `[status, listerType]`) cannot serve it, and the
plan ignores `status` entirely because the ILIKE forces the scan anyway.

At 256 rows this is 0.5 ms and a non-issue. **It is the clearest scaling cliff
in the system**, and how steep it is at 10k or 100k listings is a measurement
nobody has taken — extrapolating from 256 rows would be a guess.

Mitigations already in place and worth crediting: the board carries
`Cache-Control: public, s-maxage=30, stale-while-revalidate=30`, suggestions
60 s, categories 120 s, and `knownPlaces` / `categoriesCache` are held in
memory for 5 and 2 minutes.

### 2e. Resource consumption and error rates

Not measured, and I want to be plain about why rather than imply otherwise:

- **Resource consumption** on production needs the Render dashboard, which this
  environment cannot reach.
- **Error rates** need either production logs or a load test; there is no
  aggregation anywhere, so the only present answer is CI's own green runs.
- **Production latency** is unreachable from here: `api.umastande.co.za` is
  refused by this container's egress policy. Every number above is local.

### 2f. [15 Nov] 🔴 Every Prisma warning and error went nowhere

Found while reading `prisma.service.ts` to add the slow-query log. The client
was constructed with:

```ts
log: process.env.NODE_ENV === 'production'
  ? [{ emit: 'event', level: 'error' }]
  : [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
```

`emit: 'event'` means *do not print this, hand it to a listener*. **No `$on`
call existed anywhere in `backend/src/`** — checked across the whole tree. So
every database warning and every database error this client produced, from the
day it was written, went to a listener that was never registered.

It reads like a deliberate decision about log verbosity in production, and it
was a channel nobody could hear: the same shape as the `Message.readAt` nobody
wrote and the nineteen `@Throttle` decorators with no guard. It also means the
"existing monitoring" column of this assessment was emptier than §1 said — the
API did not merely lack *new* instrumentation, the instrumentation it appeared
to have was inert.

**Proven rather than argued.** With the subscriber removed and the log levels
left exactly as configured — `warn`, `error` *and* `query` all named — a board
request produced **zero** log lines. Restoring the subscriber produced them
immediately. Same mechanism, same silence, so the warn and error channels were
dead by construction.

### 2g. [15 Nov] The board at scale — measured, and it is not the ILIKE

`scripts/search-scale-probe.mjs` seeds 1k / 10k / 100k synthetic rooms into a
local database (four rooms per landlord, half the landlords id-verified,
adjectives and places cycling on different moduli so searches actually match),
measures the real HTTP endpoint, `EXPLAIN ANALYZE`s the statements, and deletes
everything it inserted. It refuses any host that is not local.

**`GET /api/rooms` as a visitor experiences it**, median of 5, local 4-CPU box
with a local Postgres:

| active rooms | unfiltered board | full phrase | one broad word | its matches |
| --- | --- | --- | --- | --- |
| 1,000 | 8–19 ms | 10 ms | 11 ms | 250 |
| 10,000 | 21–24 ms | 17 ms | 29 ms | 2,500 |
| 100,000 | **135–175 ms** | 89 ms | **190–216 ms** | 25,000 |

A **single broad word** is both the worst case and the likeliest thing somebody
types. A full phrase is *faster* at 100k than the unfiltered board, because
ANDing a place with a describing word narrows the unbounded query below.

**Which statement is responsible** — this is the new slow-query log doing the
job it was added for, at 100k rooms:

| statement | unfiltered | one broad word |
| --- | --- | --- |
| verified-landlord scan (no `LIMIT`) | **110 ms** | **189 ms** |
| the page of 12 rooms | 83 ms | 114 ms |
| `count` | 32 ms | 182 ms |
| `knownPlaces()` — cold cache only; see the correction below | — | 17 ms |
| **request total** | **199 ms** | **216 ms** |

They run under `Promise.all`, so the request costs the slowest rather than the
sum. Three findings fall out, and the one everybody expected is third.

**1. The page of 12 rooms cannot use any index on `rooms`, and that is
structural.** The board's first `orderBy` key is
`{ landlord: { openFlagCount: 'asc' } }` — a column in a **different table**.
Postgres therefore joins `rooms` to `users` and sorts **every matching row** to
return twelve:

```
Limit -> Gather Merge -> Sort (Sort Key: u."openFlagCount", r."isFeatured" DESC, r."publishedAt" DESC)
           -> Parallel Hash Left Join -> Parallel Seq Scan on rooms (33,333 rows × 3 workers)
```

A composite index on `rooms (status, isFeatured DESC, publishedAt DESC)` was
created and measured: **the planner ignored it**, exactly as predicted, because
the leading sort key is not in the table. That ordering is a deliberate product
decision with a good reason written beside it — a bought boost must not
outrank an open deposit complaint — so the fix is not to change the ordering.

Denormalising that one counter onto `rooms` and indexing
`(status, flagCount ASC, isFeatured DESC, publishedAt DESC)` was then measured
on the same 100k rows:

| | plan | execution |
| --- | --- | --- |
| today | Parallel Seq Scan + Sort of 100k rows | 83–114 ms |
| denormalised + indexed | **Index Scan, no Sort node** | **0.045 ms** |

O(active rooms) per page view becomes O(page size). Both the column and the
index were dropped again afterwards; nothing is committed.

**2. The verified-landlord figure is the single largest cost, and it is
unbounded.** It runs `findMany` over every row matching the search, selecting
`landlordId` with no `LIMIT`, and de-duplicates in JavaScript. A page of twelve
is paginated; this is not. It runs on the unfiltered board too, because the
default `where` is just `status: 'active'`.

That the de-duplication happens in the client is **observed, not inferred**:
the SQL the slow-query log captured carries **no `DISTINCT`** and selects
`rooms.id` alongside `rooms."landlordId"` — Prisma fetching every matching row
and reducing them in JavaScript. Every matching row crosses into the heap,
which is what §5c turns into a memory problem rather than only a slow one.

> ❌ **CORRECTION, 16 November.** The sentence that stood here said
> "`knownPlaces()` has the same shape on every search". **That was wrong on
> two counts, and it would have sent somebody to fix something already fixed.**
>
> `knownPlaces()` is **already cached in-process with a five-minute TTL**, so
> it does not run per search — and it is a **`groupBy`**, which compiles to a
> SQL `GROUP BY` returning roughly fifteen city/province pairs rather than
> 100,000 rows. The 17 ms above is the **cold-cache path**: the first search
> after a restart. It still scans to do the grouping, so it is not free, but it
> is bounded in memory, amortised over five minutes of traffic, and **not** an
> instance of the unbounded pattern.
>
> I had read the emitted SQL and not the method — and §1 of this very document
> already recorded that `knownPlaces` is held in memory for five minutes, so
> this contradicted a page I had written myself. **The one genuinely unbounded
> query on this path is the verified-landlord count, and it is the only one.**

**3. The ILIKE is real but it is not the first thing to break.** One broad
token across the five text columns: 1.9 ms at 1k, 19.6 ms at 10k, **169 ms at
100k** — linear, `Seq Scan`, as expected with no `pg_trgm` and no `tsvector`.
Worth fixing, but after the two above.

⚠️ Every number here is a local 4-CPU box with a local Postgres. Render's free
instance and a pooled Neon connection are a fraction of that, so treat these as
the **optimistic** end.

---

## 3. Proposed load-test plan — NOT RUN, and now withdrawn as written

> **[16 Nov] Decision: no load test, against staging or anywhere.** The owner
> was asked and chose not to run one. The plan below is kept as the record of
> what was proposed, but §3a explains why the staging version of it should not
> be revived in its current form even if somebody later says yes.

### 3a. [16 Nov] 🔴 Why a staging load test is not the safe option it looks like

The plan assumed staging was the harmless target. It is not, because staging
shares two resource pools with production and the failure mode of exhausting
either is **production going down**.

| | pool | scope | when it runs out |
| --- | --- | --- | --- |
| Render instance hours | **750 / month** | **per workspace** — staging *and* production | every free service suspended until next month |
| Neon compute | **100 CU-hours / month** | **per project**, shared by all branches | compute suspended until the next billing period |

Both verified against the providers' own documentation on 15–16 November 2026,
not recalled.

**The data is safely separated** — `scripts/migrate-targets.json` records two
distinct endpoints, `ep-flat-flower-…` for staging and `ep-royal-hill-…` for
production — so load against staging cannot write to production rows. The
`render.yaml` production block calls one of them "the production Neon
**branch**", which is what puts them in one project and therefore one compute
pool.

To be accurate about the magnitude rather than alarmist: **one bounded hour of
load is about 1 of 750 instance hours, which is negligible.** The tight pool is
Neon's 100 CU-hours, because load makes compute scale up and the multiplier is
not 1. So the gating question was never permission — it was *how much of this
month's 100 CU-hours production has already spent*, which is visible only in
the Neon dashboard and cannot be read from this container. Running the test
without that number is the thing the brief rules out: a test that could exhaust
production resources.

**And staging is a faithful proxy, which is the argument the other way.** Both
services are `plan: free`, so both are 0.1 CPU / 512 MB — testing staging would
genuinely measure production's capacity, not a toy's. That is why this is
written as "withdrawn as proposed" rather than "a bad idea": with the Neon
figure in hand and hard stop conditions, a bounded run would be defensible.
Without it, it is not.

### 3b. The plan as proposed on 14 November

### Where

**Staging only** (`mastande-api`, its own Neon branch), or a local stack.
**Not production.** Production shares a free-tier Render instance and a Neon
free database with real landlords; a load test there would both distort the
measurement and deny service to the people the product is for.

⚠️ Staging is also free-tier and will itself sleep, so run 1 has to be treated
as a cold-start measurement and discarded from the steady-state numbers.

### Workload, and the assumptions behind it

There is **no analytics baseline to derive a workload from** — `ux_counters`
stores a per-day count with no viewer identity (POPIA minimality), and
`room_view_days` the same. So the shape below is an assumption, stated so it
can be argued with rather than presented as fact:

| Assumption | Value | Why |
| --- | --- | --- |
| Peak concurrent visitors | 20 | a Gauteng room-letting board at early traction; no measurement supports a larger number |
| Read:write ratio | 20:1 | browsing dominates; applying is rare per visit |
| Journey mix | 70% browse/search, 20% room detail, 7% apply, 3% sign in | a WhatsApp link lands on a room page; search is the second entry |
| Session length | 6 requests | board → search → 2 rooms → apply |
| Think time | 3–8 s | a person reading on a phone |

🔴 **20 concurrent is a starting hypothesis, not a capacity target.** The point
of the ramp is to find where it breaks, not to prove it survives a number
somebody picked.

### Ramp and stop conditions

| Stage | Virtual users | Duration | Purpose |
| --- | --- | --- | --- |
| 0 | 1 | 2 min | cold start, measured and then discarded |
| 1 | 5 | 5 min | steady-state baseline |
| 2 | 10 | 5 min | first doubling |
| 3 | 20 | 5 min | the hypothesis |
| 4 | 40 | 5 min | past it, to find the knee |

**Abort immediately if any of:** p95 > 5 s, error rate > 2%, any 5xx that is
not a deliberate refusal, Neon connection errors, or staging failing
`/health`. The runner caps total requests and stops on the first abort
condition rather than finishing the stage.

### What gets watched

Response time (median/p95/p99) per journey, error rate by status, Neon active
connections and slow queries, Render CPU and memory, and `/health`'s `uptime`
field — which is how a cold start is detectable from outside.

### Two measurements worth taking before any of that

1. **The search cliff**, offline: load a scratch database with 1k / 10k / 100k
   synthetic rooms and `EXPLAIN ANALYZE` the token search at each. No load, no
   staging, and it answers the scaling question directly.
2. **Login throughput against the real instance size**, at a deliberately low
   rate — this is the bottleneck the local probe already points at.

---

## 4. Recommendations, in the order I would do them

> **[15 Nov] Three of these are done. One was wrong.** Items marked ✅ were
> carried out on 15 November; the detail is in §2a, §2f and §2g.
>
> **[16 Nov] The order changed.** Item 4 is now first: §5c works out that the
> unbounded board query is an out-of-memory risk on a 512 MB instance and not
> merely a slow one. Item 8 is answered and needed no change. The load test
> was declined, so §5 carries predicted ceilings labelled as arithmetic.

1. ❌ **CORRECTION — "fix keep-warm, or stop relying on it", and specifically
   "an external pinger would actually fire".** That recommendation was wrong,
   and wrong in the dangerous direction. The arithmetic had not been done: a
   pinger that fires reliably every ten minutes holds production awake around
   the clock, which is **731 of the 750 free instance hours a workspace gets
   per month, shared with staging** — and Render answers an exhausted
   allowance by suspending every free service until the next month. An
   external pinger would have caused the outage that GitHub's broken scheduler
   has been preventing. **There is no cadence that both covers the sleep
   window and fits the free plan.** See §2a.

   ✅ What was done instead: the schedule is hourly and honest about covering
   at most a quarter of the day, and `scripts/keep-warm-budget.mjs` fails any
   cadence that does not fit the allowance — so the next person to "fix" the
   cron cannot take production down with it. **The real fix remains the
   cheapest paid instance**, which also restores `preDeployCommand` and makes
   migrations automatic rather than the manual step that cost production an
   hour on 5 October (`docs/OUTSTANDING.md` §5a). That is a cost decision and
   it is the owner's.

2. ✅ **Make the job able to notice.** Done as an affordability gate rather
   than a cadence gate, which is the better version: a cadence gate would go
   red every run over a condition nobody has chosen to fix, and this
   repository already has gates nobody reads for exactly that reason. The
   budget gate is green today and fails on the change that would cause an
   outage.

3. ✅ **Add request timing and a slow-query log.** Both added, both off by
   default (`SLOW_REQUEST_MS`, `SLOW_QUERY_MS` — unset means silent, because a
   threshold of 0 read as "log everything" is the one default that could turn
   instrumentation into an outage on a 512 MB instance). Documented in
   `backend/.env.example` and `docs/DEPLOYMENT.md`; `env-parity.mjs` passes at
   36 keys. **It paid for itself immediately** — §2g's attribution table is
   this log, and it is what showed that the board's largest cost is the
   unbounded verified-landlord query rather than the ILIKE everyone expected.

   POPIA, deliberately: the request log records the route **template** and
   never the resolved path (`/api/rooms/:id`, proven on a 404), no query
   string, no body, no IP, no user id. The query log records the statement and
   **never Prisma's `params`**, which hold email addresses, phone numbers,
   password hashes and one-time codes — the obvious one-liner would have
   turned the application log into a copy of the user table.

   Also fixed while in there: the Prisma `warn` and `error` channels that had
   never had a subscriber (§2f).

4. ✅ **DONE, 16 November — the unbounded board query is bounded.** (It read
   "the two" earlier today; `knownPlaces()` turned out to be already cached
   and already a `groupBy` — correction in §2g.) Measured result in §6. §5c works out what that query
   costs in MEMORY rather than time: ~10 MB of heap per in-flight request at
   100k active rooms, so a few dozen simultaneous visitors to an unfiltered
   board is an out-of-memory kill on a 512 MB instance with one replica and no
   scaling — a restart and a cold start for everybody, not a slow page. That
   is arithmetic and not measurement, and it is still the most likely way this
   site falls over first. A cached or periodically-recomputed figure would
   remove the largest single cost at 100k rooms. ⚠️ The count is a **trust** figure with a documented history of
   being wrong — it was computed in the browser from the current page and grew
   as a visitor scrolled — so any change here must keep it honest or stop
   showing it. Not a silent optimisation.

5. **Decide about the board's ordering.** Denormalising `openFlagCount` onto
   `rooms` plus a composite index takes the page query from 83–114 ms to
   **0.045 ms** at 100k rooms (§2g), because no index on `rooms` can serve an
   `orderBy` whose leading key lives in `users`. It is a migration plus
   keeping a denormalised counter in sync, so it is a real decision rather
   than a tidy-up — but it is the largest measured win available and it
   preserves the ordering's intent exactly.

6. **Widen the Lighthouse URL list.** It covers `/`, `/pricing`,
   `/how-it-works`, `/zu/pricing` — **not a room detail page, not a board with
   a search, not an authenticated portal screen.** The room page is where every
   shared WhatsApp link lands. Unchanged from the original list and still
   worth doing.

7. **Then the search cliff itself.** `pg_trgm` with a GIN index is the
   smallest change that keeps the current query shape; Postgres full-text is
   the larger one. Measured at 169 ms per broad token at 100k rooms — real,
   but third in line behind items 4 and 5.

8. ✅ **`UV_THREADPOOL_SIZE` — answered, and the answer is to leave it alone.**
   The instance size is known now: 0.1 CPU. The threadpool was the binding
   constraint in the local probe because there were four spare cores for it to
   use; on a tenth of a core a bigger pool cannot create CPU and costs memory
   on a 512 MB box. **The constraint moved from the pool to the CPU** — about
   0.35 logins a second, §5a. Revisit only if the instance grows.

9. **Collect INP from the field.** Nothing measures it; TBT is a lab proxy.

---

## 5. [16 Nov] Predicted free-tier ceilings — ARITHMETIC, NOT MEASUREMENT

⚠️ **Read the label.** Every number in this section is derived from the local
measurements in §2 scaled to the published free-instance spec. **None of it was
measured on a 0.1-CPU instance.** It is here because the owner declined the
load test and arithmetic beats silence — but a derived number is a hypothesis,
and the whole point of §2f and §2g is that this repository has shipped
confident numbers nobody checked. Treat these as predictions to be falsified,
and if one turns out wrong, the assumption below is where to look first.

**The spec**: Render's free web service is **0.1 CPU, 512 MB**, one instance,
no scaling, spin-down after 15 idle minutes with a cold start of about a
minute. Confirmed against Render's compute-plans table, 15 November 2026.
Production and staging are both on it.

**The load-bearing assumption**, stated so it can be attacked: *0.1 CPU means a
CFS quota of 10% of one core, so CPU-bound work takes ~10× the wall time it
takes on a full core here, and the instance can perform 0.1 core-seconds of
work per wall second.* If Render's 0.1 CPU is implemented as something other
than a hard 10% quota — a burstable share, say — every figure below is wrong in
the optimistic direction.

### 5a. Authentication is the capacity ceiling

| | measured here (full core) | predicted on 0.1 CPU |
| --- | --- | --- |
| one login, no contention | **286 ms** | **~2.9 s** |
| sustained login throughput | ~12/s (threadpool-bound) | **~0.35/s, about 21 a minute** |

`bcrypt` at `SALT_ROUNDS = 12` costs ~0.286 core-seconds per hash and that cost
is irreducible — it is the point of the setting. At 0.1 core-seconds of budget
per second, **about one login every three seconds is the arithmetic ceiling**,
and a queue forms above that. A sign-in that takes three seconds on a cheap
Android on mobile data is the experience this product is built around.

This also **answers recommendation 8** without needing the instance: raising
`UV_THREADPOOL_SIZE` above its default of 4 would do nothing here. The
threadpool was the binding constraint locally because there were four spare
cores for it to use; on a tenth of a core it cannot create CPU, and a larger
pool costs memory on a 512 MB box. **Leave it at the default — the constraint
moved from the pool to the CPU.** Set it deliberately only if the instance ever
grows.

### 5b. Reads, and why the network dominates them anyway

Reads measured 1–13 ms locally, most of which is waiting on the database rather
than burning CPU. Scaled pessimistically at ~2 core-ms each, 0.1 CPU allows on
the order of **50 reads a second** — comfortable, and not the thing to worry
about. What a visitor actually feels is dominated by two costs this arithmetic
cannot touch: the Frankfurt region's round trip to a South African phone, and
Neon's pooled connection. Both are unmeasured (§2e).

### 5c. 🔴 The unbounded query is a MEMORY risk on 512 MB, not just a slow one

This is the prediction worth acting on, and it is new — §2g measured the
unbounded verified-landlord query as a latency problem on a machine with 16 GB.
On 512 MB it is a different and worse problem.

That query selects `landlordId` for **every row matching the search** and
de-duplicates in JavaScript. Each matching row therefore becomes a Prisma row
object in the heap. At 100,000 active rooms, a single unfiltered board view
materialises 100,000 of them — on the order of **10 MB of heap per in-flight
request**, before Prisma's own engine overhead.

| concurrent board views | predicted heap for this one query |
| --- | --- |
| 1 | ~10 MB |
| 10 | ~100 MB |
| 25 | ~250 MB |

Against 512 MB shared with Node's own baseline, the Prisma query engine and
everything else the process is doing, **a few dozen simultaneous visitors to an
unfiltered board at that size is an out-of-memory kill, not a slow page.** And
a free instance has one replica and no scaling, so an OOM is a restart and a
cold start for everybody.

It does not need 100,000 rooms to matter either — it needs *active rooms ×
concurrent board views* to get large, and the board is the most-visited page on
the site.

**This moves recommendation 4 from "an optimisation" to "the thing most likely
to take the site down first", and it is still a prediction.** Falsifying it
needs either the container test that was declined or a bounded staging run.

### 5d. What this section is NOT

- Not a capacity statement anybody should quote. It is scaled arithmetic with
  one named assumption carrying all of it.
- Not a substitute for the load test. The cheapest way to check every figure
  above is to run the repo's own production image locally under
  `--cpus=0.1 --memory=512m`, which touches no shared pool and needs no
  authorisation. That was offered and declined for now; the offer stands.

---

## 6. [16 Nov] The verified-landlord count, bounded — measured

Recommendation 4, done. The honesty constraints came first, because this is a
trust figure and it has been false once already.

### 6a. What it was, and why it was the most expensive thing on the board

```ts
findMany({ where, select: { landlordId: true }, distinct: ['landlordId'] })
  .then((rows) => rows.length)
```

The comment beside it said "`distinct` on landlordId rather than a groupBy: the
question is how many people, not how many rooms". The intent was right; the
mechanism was not. **Prisma applies `distinct` in the client, not in SQL.** The
captured statement carried no `DISTINCT` and selected `rooms.id` as well, so
every row matching the search crossed the wire and landed in the heap to be
reduced by JavaScript afterwards.

### 6b. What it is now

A `groupBy` on `landlordId` with `take: 201`, spread from the **same `where`
object** the listing and the count use.

That last point is why this is not hand-written SQL with `COUNT(DISTINCT …)`,
which would be O(1) rather than O(cap): the filter has fifteen optional
clauses including nested relations and date logic, and restating it in SQL
would make two sources of truth for one question. The day they drift, the
figure starts counting landlords whose rooms are not on the board — the exact
dishonesty the original comment exists to prevent. O(201) is small enough.

### 6c. Measured, at 100,000 active rooms

The statement, by `EXPLAIN ANALYZE`:

| | plan | rows examined | **rows returned to Node** |
| --- | --- | --- | --- |
| old `distinct` | Hash Join over a Seq Scan | **100,020** | **50,000** |
| new `groupBy` + `LIMIT` | `Limit` → `Group` → Nested Loop | **801** | **201** |

It is not only de-duplication moving into Postgres — it is **early
termination**. `ORDER BY landlordId` lets the planner walk
`rooms_landlordId_idx`, produce groups in order and stop once it has 201, so on
an unfiltered board it touches 801 rows instead of 100,020.

End to end, via the request-timing log:

| | before | after |
| --- | --- | --- |
| unfiltered board | 199 ms | **121 ms** |
| one broad search word | 216 ms | **164 ms** |
| the count statement itself, unfiltered | 110 ms | **under 15 ms** (fell off the log) |
| the count statement itself, one word | 189 ms | 98 ms |

The search case improves less because an `ILIKE` cannot be served from that
index, so there is no early termination — but the **memory** win holds in both
cases, and that was the point. 201 rows instead of 50,000 removes the
out-of-memory path §5c predicted.

### 6d. How it stays honest

The cap introduces a **new** way to lie: reporting a clamped 200 as though it
were exact. So the response carries `verifiedLandlordsCapped`, and the hero
renders `200+` — true, stable for the same search, and needing no new
translation in any of the eleven languages because the number is rendered
separately from its label.

`scripts/verified-count-drive.mjs` (13 assertions, in CI) asserts all three
ways it could lie, and **each was reintroduced and each turned the drive red**:

| mutation | caught |
| --- | --- |
| drop the verified-only filter | ✅ "is 16, expected 7" |
| ignore the search filter | ✅ "city=Tembisa → 7, SQL says 4" |
| clamp silently | ✅ "the response SAYS it is a floor" |

It also asserts the boundary that a naive implementation gets wrong: **exactly
200 is still exact** and must not report itself as capped.

Two frontend tests cover the browser half, both falsified (dropping the `+`
suffix, and ignoring the flag on the response). `landlordCountLabel` is a
**method rather than a `computed`** for a specific reason: `home.spec.ts` builds
the component with `Object.create(Home.prototype)`, field initialisers do not
run there, so a `computed` would not exist and the only way to assert it would
be to rebuild the same expression in the test — which passes just as happily
with the logic deleted.

`scripts/smoke-test.sh` asserts the response shape on every run, falsified by
removing the flag.

### 6e. What this does not do

- It does not make the count O(1). It makes it O(cap), and the reason is in
  §6b.
- Above 200 the figure is a floor. That is a product change, small and stated
  on screen, not a silent one.
- Every number here is local, on 4 CPUs. The §5c out-of-memory prediction it
  defuses was itself arithmetic; it has not been observed on a 512 MB
  instance, and now should not be.

---

## 7. [15 Nov] What is still not measured

Unchanged from §2e and worth repeating so the gaps are not read as covered:

- **Production latency, resource consumption and error rates.** This container
  cannot reach `api.umastande.co.za` (egress policy) or the Render dashboard,
  and no error aggregation exists anywhere.
- **The load test in §3 has not been run.** It needs authorisation and a
  confirmed-safe staging target. Nothing in this document was produced by
  sending load anywhere.
- **Login throughput at the real instance size.** The local probe gives ~12
  logins/s on 4 CPUs with `UV_THREADPOOL_SIZE` at its default of 4. That is
  not capacity and must not be quoted as one.
- **The 100k-room measurements are local.** Render free plus pooled Neon will
  be worse; by how much is unmeasured.
