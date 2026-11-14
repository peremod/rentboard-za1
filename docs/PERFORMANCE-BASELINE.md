# Performance baseline — 14 November 2026

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

---

## 3. Proposed load-test plan — needs a decision before anything runs

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

1. 🔴 **Fix keep-warm, or stop relying on it.** It delivers 3% of its schedule.
   An external pinger (cron-job.org or similar, free) at 10-minute intervals
   would actually fire; `docs/OUTSTANDING.md` §102 already lists one as
   "available and unchosen". **Measured, not theoretical: production is cold
   for nearly every first visitor today.**
2. **Make the job able to notice.** It should compare the gap since its own
   previous run against the sleep window and fail — otherwise the next
   regression is just as invisible.
3. **Add a request-timing interceptor** logging method, path, status and
   duration, with a slow threshold. One file, and it turns every production
   problem from a guess into a number. Prisma can log `query` with duration in
   staging for the same reason.
4. **Widen the Lighthouse URL list.** It covers `/`, `/pricing`,
   `/how-it-works`, `/zu/pricing` — **not a room detail page, not a board with
   a search, not an authenticated portal screen.** The room page is where every
   shared WhatsApp link lands.
5. **Decide about the search cliff on evidence** once (1) above is measured.
   `pg_trgm` with a GIN index is the smallest change that keeps the current
   query shape; Postgres full-text is the larger one.
6. **Set `UV_THREADPOOL_SIZE` deliberately** rather than inheriting 4, once the
   instance size is known — it is the ceiling on concurrent logins.
7. **Collect INP from the field.** Nothing measures it; TBT is a lab proxy.
