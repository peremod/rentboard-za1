# Data integrity — what is tested, and what is not

The deliverable for the database/data-integrity brief. One place that answers
"is this covered?" with a file and a case count rather than a feeling, because
this repository's recurring defect is a guarantee nobody checked.

**Every claim below names the file it rests on. Where something could not be
proven in this container, it says so by name.**

---

## Step 1 — The data model

| Question | Answer |
|---|---|
| Technology | PostgreSQL 16 locally, PostgreSQL 15 on CI runners, Neon in staging and production. Prisma 6.19.3 |
| Models | 48+ in `backend/prisma/schema.prisma` |
| Migrations | 39, `backend/prisma/migrations/` |
| Keys and relations | Declared in the schema; the system view is `docs/TENANCY-LIFECYCLE-AUDIT.md` §A–B, the problems §C–D |
| Transaction boundaries | `$transaction` at every multi-row transition; the pattern is policed by `scripts/check-then-write-lint.mjs` |
| Deletion and archival | `User` becomes a tombstone rather than a row deletion — a real delete cascades into other people's rooms, applications, messages, tenancies, rent history and reviews. `Tenancy.archivedAt`, `Room.status = deleted` |
| Retention | Documents deleted per the `VerificationRequest` pattern; only outcomes persist. `file_deletions` is the durable queue, so a document survives a storage outage and is still deleted |

⚠️ **Not re-derived here.** The architecture assessment is
`docs/TENANCY-LIFECYCLE-AUDIT.md`, which was written as a read-only pass and
whose claims each name a file and line. This table points at it rather than
restating it, because two descriptions of one schema is the defect that
produced §D of that document.

## Step 2 — Relationships

| Relationship | Where it is tested |
|---|---|
| Users and roles | `admin-api.int-spec.ts` (12), and every spec's guard assertions |
| Landlords and properties | `properties.int-spec.ts` (18) |
| Properties, yards and rooms | `properties.int-spec.ts`, `rooms-api.int-spec.ts` (16) |
| Tenants and applications | `applications-api.int-spec.ts` (18) |
| Tenants, landlords and tenancies | `tenancy-lifecycle.int-spec.ts` (10) |
| Tenancies and rent records | `rent-records.int-spec.ts` (16) |
| Tenancies and documents / history | `documents.int-spec.ts` (16), `account-lifecycle.int-spec.ts` (15) |

## Step 3 — Integrity

| Property | Where |
|---|---|
| Required fields and constraints | `api-contract.int-spec.ts` (12) — the DTOs run with `forbidNonWhitelisted`, so an invented field is a 400 |
| Valid references | `failure-modes.int-spec.ts` — a tenancy for an acceptance that was undone cannot be confirmed |
| Duplicate prevention | `failure-modes.int-spec.ts` — a second application to one room, a duplicate rent mark, a duplicate acceptance |
| Related records updated together | `failure-modes.int-spec.ts` — "cancelling a letting moves the tenancy, the application and the room as one" |
| Transaction rollback | `failure-modes.int-spec.ts` — rollback on failure **and** commit when nothing fails, which is the half that stops the first from passing vacuously |
| Concurrent updates | `scripts/check-then-write-lint.mjs` (23 sites judged), `double-let-drive.mjs`, `refresh-race-drive.mjs`, `inbox-race-drive.mjs` — all in CI |
| Deletion and archival | `account-lifecycle.int-spec.ts` — erases the person, keeps the shared record |
| Orphan protection | `account-lifecycle.int-spec.ts` — the tombstone, asserted with its reason |

## Step 4 — Tenancy lifecycle history

**Ending does not destroy history.** `rent-records.int-spec.ts` writes rent
against a FINISHED tenancy deliberately — "which is the point of the rule" —
and `account-lifecycle.int-spec.ts` keeps the other party's conversation,
review and rent history when an account is closed.

**Separate tenancies stay separate.** `tenancy-separation.int-spec.ts` (7).
This was the gap: nothing checked it, and the one test that looked like it is
about two acceptances of ONE application.

`RentPeriod` is keyed `@@unique([tenancyId, periodStart])`, so the schema is
right — which is exactly what makes the application worth testing. Every leak
of this kind comes from a QUERY keyed on the room, the tenant or the landlord
instead, and a constraint that is never violated proves nothing about what a
handler returns.

The hard case, which the suite had no fixture for: **the same tenant and the
same room, twice** — let, ended, relisted, re-accepted — where every id but
the tenancy's is identical. In a market of single back rooms that is a normal
Tuesday. It is also the shape of checklist row 133, where a screen read the
TENANCY's status to decide whether an APPLICATION was open.

## Step 5 — Migrations

Two checks, both using a **disposable** database, both refusing a remote host
and any admin URL that is not localhost — the same refusal as
`backend/test/support/test-app.ts` and `scripts/migrate-remote.sh`.

**`scripts/migration-drift-check.mjs`** — do the migrations and
`schema.prisma` describe the same database? Replays every migration into a
shadow database, compares, drops it. In CI, and in the pre-commit hook with a
named skip when Postgres is not running (it stops on its own in this
container); CI runs it without the skip, so a runner with no database fails
rather than passing.

🔴 **It found real drift on its first run.** `survey_responses.updatedAt`
carried a database default the datamodel does not declare, because
`20261016090000` backfilled a NOT NULL on a populated table and that requires
one. Effect: nil — Prisma is the only writer. Cleared by
`20261111101138_survey_response_updatedat_drop_default`, metadata-only, so the
gate now demands **zero** differences rather than carrying a baseline.

**`scripts/migration-data-survival-check.mjs`** — 14 assertions. Applies
history in two stages with rows seeded in between, against the only migration
here that moves data rather than reshaping columns. Its header makes two
claims about real people's answers, and neither had ever been checked:

- *"a database with answers in it keeps them"* — the answer survives, with its
  free text, re-keyed onto the user the profile belonged to, carrying the role
  and a `completedAt` dated from when it was answered rather than when it
  migrated; the dismissal moves too; the old column is gone.
- *"a migration that deletes answers it cannot place is worse than one that
  stops and says so"* — an unmappable answer **stops the migration**, with a
  not-null violation, and is still in the database afterwards.

The second claim is the one that matters: everything else would pass against a
migration that quietly deleted what it could not place. Proven by mutating the
migration to delete those rows — the check reports `rows with id r-1 after it: 0`.

## Step 6 — Results

- **20 files, 272 integration tests**, green. (An earlier commit message said 21 — a miscount, not a missing file.)
- Drift: **zero** differences between the migrations and the datamodel.
- Data survival: **14/14**.
- One inconsistency discovered and resolved (the `updatedAt` default above).

## Remaining risks

1. ⚠️ **Nothing tests a migration against a database with production-scale
   data.** The survival check uses a handful of rows, which is enough to prove
   the backfill logic and nothing about how long it takes. A migration that is
   correct and takes forty minutes still causes an outage.
2. ⚠️ **38 of the 39 migrations have no data-survival test.** The one that does
   is the only one that moves data, which is the right place to start and not
   the same as coverage. The next hand-written data migration should get one,
   and `migration-data-survival-check.mjs` is the template.
3. ⚠️ **The two new checks need a Postgres admin connection**, so only CI runs
   them unskippably. A developer committing with Postgres stopped gets a named
   skip, not a pass.
4. ⚠️ **PostgreSQL version differs by environment** — 16 locally, 15 on the
   runners, Neon elsewhere. No check asserts behaviour is identical across
   them, and nothing here can: this container has one version.
5. ⚠️ **`migration-preflight.mjs` answers a different question**, read-only
   against a real database: what a pending migration would do to one with
   people in it. It is not a substitute for either check above, and both are
   not a substitute for it.
6. Step 1's architecture claims were **inventoried, not re-verified**, in this
   pass. Steps 2 and 3 were re-run as part of the 272.
