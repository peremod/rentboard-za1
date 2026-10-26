# API testing

What exists, how to run it, what it found, and what it does not cover.

Written 21 October 2026. The numbers below were produced by the commands in
§3 on that date; re-run them rather than trusting this file.

---

## 1. The inventory

`scripts/api-inventory.mjs` reads the inventory **out of the 35 controllers**
rather than restating it. A hand-written endpoint list is wrong the first time
somebody adds a route and nothing tells you — the same defect this repository
has shipped as a nav audit that could not see a dead link, and as row-shaped
checks that only found what somebody thought to list.

```bash
node scripts/api-inventory.mjs            # the table
node scripts/api-inventory.mjs --json     # machine-readable, used by the sweeps
node scripts/api-inventory.mjs --check    # fails when the surface moves
node scripts/api-inventory.mjs --write-baseline
```

Per route it reads: HTTP method, full path, the guards that actually apply
(class-level plus method-level), the rate limit, the success status, the body
DTO, path and query parameters, and the swagger summary.

**236 routes** — 101 GET, 96 POST, 28 PATCH, 11 DELETE.

| | |
|---|---|
| Unauthenticated (no guard that establishes identity) | **41** |
| Optional auth | 2 — `POST /api/reports`, `GET /api/rooms/:id` |
| Admin-only | **61** |
| Rate-limited (`@Throttle` + `ThrottlerGuard`) | 25 |
| Carrying a body DTO | 81 |

Busiest modules: `auth` 35, `tenancies` 22, `rooms` 20, `properties` 19,
`applications` 17, `ads` 15, `verification` 11.

`--check` is a gate, not a snapshot: it fails when the counts move, so a new
route has to be looked at. Falsified — a smuggled `@Get('smuggled')` on the
health controller produces `total: baseline 236 → now 237` and exit 1.

### Two corrections the tool needed before it could be trusted

**A `ThrottlerGuard` is not an authentication guard.** The first run counted
it as one, which made `/auth/register` and `/auth/login` — the two most
exposed endpoints in the product — read as protected. Public now means *no
guard that establishes identity*; the limiter is reported beside it. 23 → 39.

**One file can hold several controllers.** `lost-number.controller.ts`
declares `@Controller('admin/recoveries')` and then
`@Controller('auth/lost-number')`; `storefront.controller.ts` does the same.
Reading only the first prefix and the first class-level `@UseGuards` put
`POST /auth/lost-number/confirm` in the inventory as
`POST /admin/recoveries/confirm` behind `JwtAuthGuard + AdminGuard`, and
`GET /storefronts/:slug` as `GET /landlord/storefront/:slug`. **Both are
public.** The real routes were never swept at all, and two open routes sat in
the list as protected — the one direction of error that nothing downstream can
catch. 39 → 41 public, 62 → 61 admin.

---

## 2. What the enforcement architecture forces

- **Authorization is guards**, which only run inside Nest's request pipeline.
  A test that calls a service directly proves nothing about who may call it,
  so every test here goes over HTTP through supertest.
- **Guards run before pipes.** That is what makes it safe to sweep every
  route including the destructive ones: a request that fails authorization is
  refused before any handler, any DTO validation and any write.
- **The global `ValidationPipe`** runs `whitelist`, `transform` and
  `forbidNonWhitelisted`, so "an unexpected field is a 400" is a uniform
  contract across all 81 body routes rather than a per-route courtesy.
- **No global exception filter and no explicit body-size limit** — error shape
  and oversized-payload behaviour are Nest and Express defaults, so they are
  probed rather than assumed.

---

## 3. Running it

```bash
# once: create the isolated database
npm run test:int:setup

# the whole integration suite, API tests included
npm run test:int

# one file
npm run test:int -- test/api-contract.int-spec.ts

# the unit suite (pure logic, no database)
npm run test:backend
```

The integration suite points at `mastande_integration_test` and
`assertTestDatabase()` **refuses to run** against a database whose name does
not contain "test", because every case truncates every table. A second
concurrent run is refused too, by a Postgres advisory lock — two runs sharing
one database delete each other's fixtures mid-test, and the 40 failures that
produces all read as product bugs.

Nothing reaches the network: `NotificationsService`, `StorageService`,
`WhatsappService` and `PayfastService` are replaced wholesale, not disabled by
a flag. No real email, no WhatsApp message, no PayFast call, no file upload.

### Results on 21 October 2026

| Suite | Result |
|---|---|
| `npm run test:backend` | **91 passed** |
| `npm run test:int` | **207 passed**, 12 files |

API-specific files within that: `api-contract` 12, `rooms-api` 24,
`applications-api` 19, `admin-api` 15 — **70 tests**, plus the domain suites
(properties, tenancy lifecycle, rent records, viewings, reviews and reports,
documents, account lifecycle, failure modes).

---

## 4. What the sweeps assert

`backend/test/api-contract.int-spec.ts` runs over the inventory, so a route
added tomorrow is swept tomorrow with no edit.

| Sweep | Scope |
|---|---|
| unauthenticated | every identity-guarded route must answer 401/403 |
| privilege escalation | all 61 admin routes refuse a TENANT **and** a LANDLORD |
| **the control** | a real admin gets *past* the guard on the same routes |
| malformed id | no `:id` route may answer 5xx to `not-a-uuid` |
| unsupported method | 404/405, never a crash |
| hostile input | malformed JSON, wrong content type, SQL strings, arrays and nulls where objects belong, absurd query values — all under 500 |
| leakage | no V8 frame, `node_modules` path, PrismaClient reference, connection string, raw SQL, JWT secret or internal file path in **any** response collected above |
| oversized body | 2MB → 400/413, and nothing written |
| unexpected field | `forbidNonWhitelisted` enforced, with a control proving the same body minus the field succeeds |
| pagination | bounded, and 400 rather than 500 |

**The control row is the one that makes the rest mean anything.** "Everything
returns 403" is also true when the token is broken, the routes do not exist,
or the paths are misspelt — and both escalation sweeps would pass. So a real
admin must get past the guard on a sample of the same routes, with the same
path substitution.

---

## 5. Defects found

### 🔴 `GET /api/rooms?page=999999999999&limit=999999999` returned 500

On the busiest unauthenticated route in the product. `skip = (page - 1) *
limit` is about **1e21**, far past what Postgres takes for an OFFSET, so
Prisma threw and the board answered Internal Server Error to an anonymous
caller.

**Either parameter alone was fine**, which is why nothing had ever hit it. The
unbounded `limit` was the second half of the hole: no maximum at all, so one
anonymous request could ask for every active row.

Fixed with `@Max(100)` on `limit` and `@Max(100_000)` on `page`; the pair also
bounds the product, so `skip` cannot exceed 1e7. Measured: 500 → 400, with the
boundaries exact. Falsified by removing both decorators.

### Everything else held

No leakage was found in any response the sweeps collected. No admin route
answered an ordinary account. No guarded route answered a signed-out caller.
No `:id` route crashed on a malformed id. `forbidNonWhitelisted` refused every
unexpected field tried, including `role: 'ADMIN'` on a profile update and
`status`/`landlordId` on a room create.

---

## 6. Gaps — what this does NOT cover

Stated rather than implied, because a suite's silence reads as a pass.

1. **True database-failure injection.** Nothing here kills the connection
   mid-transaction; that needs a proxy such as toxiproxy. `failure-modes`
   covers the failures the app can be made to produce from outside.
2. **Rate limiting is cleared between tests.** The limits are real and one
   case asserts the deletion endpoint still bites (ten 403s then a 429), but
   the suite does not exercise every limiter's threshold.
3. **PayFast, Resend, ImageKit and the WhatsApp Cloud API are doubles.** Their
   contracts are assumed, not verified. A provider changing its response shape
   would not be caught here.
4. **OAuth** is asserted only to the extent that the callback redirects and
   mints no token without a code. The Google round trip is not driven.
5. ~~**Concurrency.** No test races two acceptances of the same room, or two
   simultaneous rent marks for one month. The idempotency that exists is
   asserted sequentially.~~

   **Partly closed — `scripts/double-let-drive.mjs`, and it found a double-let.**
   Both races this gap names are now driven against the real API on every push.

   🔴 **Two applications for one room, accepted together, both returned 200**
   and left two accepted applications and **two live tenancies on one room**.
   First attempt. `accept()` read the application, checked its status, then
   wrote, with no transaction and no condition on the write; what kept a room
   from being let twice was `autoRejectOthers`, which runs *after* the write.
   Both claims are compare-and-swap now, in one transaction. See §93 of
   `docs/OUTSTANDING.md`.

   ✅ **Two rent marks for one month held**, across 5 attempts with the row
   deleted between each so every pair raced the INSERT rather than taking the
   UPDATE path: 200/200 each time, one period each time.

   ⚠️ ~~Still a gap: … the pattern that produced the double-let is not searched
   for across the codebase; it was found by suspecting one method.~~

   **The pattern IS searched for now — `scripts/check-then-write-lint.mjs`,
   §95 — and the search found a second real one:** `withdraw()` refuses an
   accepted application, and that refusal was a read-then-write, so an accept
   landing in between left the application `withdrawn` with a live tenancy and
   a let room. Fixed with the same compare-and-swap.

   **The queue is now empty — all 23 are judged (§96).** Fifteen are fixed with
   a compare-and-swap, five carry a written verdict in the lint's own baseline,
   and three left the list when the detector was corrected: it had been keying
   on a list of state columns it knew about, so it could not see
   `auth.refresh`, which keys on `revokedAt`. A conditional write is now
   anything whose `where` carries more than the id.

   The three this section used to name are among the fixed: `lease.giveNotice`,
   `tenancies.confirmStart` and the `lost-number.approve` / `refuse` pair. Two
   the sweep found that nobody had suspected were worse than any of them —
   `auth.refresh` minted one credential per in-flight request, and
   `rooms.discardDraft` ran a cascading DELETE off a read.

   ⚠️ What the five surviving entries are NOT is a clean bill by silence: each
   prints its reasoning on every run, so a later change that makes one of them
   matter has to argue with a sentence rather than slip past a count. The
   verdicts are `reactivate`, `reviewCampaign`, `login`, `messages.send` and
   `rooms.findOne` — read them in the lint output, not here, so there is one
   copy.
6. **The 236-route sweeps call every route with a sample UUID**, so for most of
   them the assertion is about *refusal*, not about the handler's work. The
   handler's work is covered for the domains with their own spec files; the
   rest (ads, referrals, surveys, storefront, analytics, places, SEO) have
   refusal coverage only.

   **Notices came off that list — `backend/test/notices.int-spec.ts`, §97.**
   Nine cases over HTTP: the notice is readable by its owner, by nobody else,
   the badge count agrees with the full list, mark-read is scoped in the WHERE
   so another person's id answers exactly as an invented one does, read is not
   deleted, and the list is newest-first.

   **View counting also came off, partly — `backend/test/view-counting.int-spec.ts`,
   §98.** Four cases, two of them structural: `room_view_days` holds exactly
   `roomId`, `day` and `count`, and two different people viewing one room on
   one day leave ONE row. That is CLAUDE.md's POPIA minimality decision
   ("a count per day and no viewer identity … s.10") asserted rather than
   assumed — it had rested entirely on the shape of the schema, and the smoke
   assertions that cover the counting cannot see it, because a weekly total is
   identical whether the table holds one row per day or one per viewer per day.
   ⚠️ This does **not** close `analytics`: that module is separate from view
   counting and nothing here touched it.

   ⚠️ **Read before trusting a domain's name on this list.** Notices already
   had `scripts/notices-drive.mjs`, nine checks, written for this exact
   channel — and it **passes 9/9 with the write deliberately broken**, because
   it stages its notice with a direct SQL `INSERT` and so never calls
   `NoticeRouter.deliver`. It is also not in CI. The new spec's notices come
   from a real application, acceptance and message, and it fails 8 of 9 on the
   same build. The lesson is the file's, not the domain's: coverage that builds
   its own fixture tests the reader and nothing else.
7. **Production is never touched.** Every number here comes from a local
   isolated database. Nothing in this suite runs against staging or
   production, and nothing should.
