# Mastande — working rules

Mastande (Umastande (Pty) Ltd) is a South African room-letting marketplace:
Angular 21 SSR frontend, NestJS 11 + Prisma 6 backend. It competes with
RoomKing and AmaRoom on verification depth, landlord tooling and trust-tied
monetisation, and the person it is built for has four back rooms and a cheap
Android phone, not a portfolio and a spreadsheet.

## Standing constraints

These are not preferences. Each one was decided deliberately and breaking any
of them is a product decision, not a refactor.

### Mobile-first verification

**Whenever you change navigation, buttons, cards, forms or footer elements,
verify the responsive behaviour at mobile, tablet AND desktop widths.** A task
is not complete if the desktop layout works and the mobile experience is
broken. In practice: 360px, 390px, 768px and 1280px, and the breakpoints this
codebase actually uses are 900 / 768 / 480 (`frontend/src/styles/_responsive.scss`).

Check for horizontal page scroll, controls under the 44px touch target
(WCAG 2.5.8), buttons that collapse into each other, and text that becomes a
single line hundreds of characters wide. `scripts/mobile-drive.mjs` exists
because every assertion in it is a bug that reached production and was found by
a person using the site on their phone — not by any check in this repository.

### Free to list, free to apply

**No landlord listing fee and no tenant application fee, ever.** That is the
position against RoomKing, AmaRoom, Facebook and Gumtree, and it is the reason
anybody switches. Flag it loudly if a change risks it. A sub-lessor listing a
room is a landlord listing a room: also free (Phase 6).

Fees charged to a THIRD party — an advertiser, a contractor receiving leads —
are not covered by this rule, but see the next one.

### Money, deposits and legal execution

**Stop and flag rather than proceeding** at any point that would touch money
custody, rent or deposit holding, or the execution of a legal document. This
platform does not hold rent, does not hold deposits, and does not give a
digital signature legal effect. The rent tracker is a landlord's own record and
says so on screen; the lease documents screen says nothing was signed here.

### POPIA

Documents stay private, are deleted per the existing retention pattern (see how
`VerificationRequest` handles it), and **only outcomes persist**. Prefer not
collecting a field to collecting it and hiding it: `room_view_days` stores a
count per day and no viewer identity for exactly this reason (s.10, minimality).

### Secrets

Any new secret goes in `backend/.env.example` with a comment explaining what it
is and where to get it. Never hardcoded, never defaulted to a working value in
code. `scripts/env-parity.mjs` is the gate.

### WhatsApp is deferred, not abandoned

**WhatsApp-first is still the goal.** It is switched off because of cost, not
because it was the wrong idea, and it goes back on when the business can carry
it. Treat it as paused work, not dead code.

`WHATSAPP_ENABLED` defaults to false (and a missing line means false). Meta
bills **per message** — roughly USD $0.0095 + VAT per sign-in code to a South
African number, from the first one, with no free allowance — and this product
is free to list and free to apply, so every message is a per-head cost with no
revenue behind it.

So:

- **Do not delete the WhatsApp code.** The listing bot, the parser, the
  webhook, the signature verification and the landlord opt-in all stay. One
  variable brings the channel back; rebuilding it later is waste.
- **Do not add a new paid send without the flag.** Anything that calls the
  Cloud API goes through `WhatsappService` and respects `isEnabled()`.
- **`wa.me` links are NOT affected and never were.** Sharing a room, or tapping
  "WhatsApp" on a contractor, opens the person's own WhatsApp and Meta bills
  nobody. Those are free distribution in this market. Leave them alone.
- **Nothing on screen may promise a WhatsApp message while it is off.** The
  landing page advertised "WhatsApp Notifications" to every visitor and had to
  be fixed; phone sign-in refuses with a 503 naming email rather than accepting
  and sending nothing.

⚠️ **The open consequence:** a person with no email address currently has no
way in at all. `User.email` is nullable precisely for the WhatsApp-first
landlord, and `sendOtp` is the only delivery there has ever been for a phone
code — there is no SMS provider, and even assisted sign-up sends over WhatsApp.
That gap is known and accepted for now. See `docs/OUTSTANDING.md` §29 and
`docs/WHATSAPP-SETUP.md`.

### Three environments

Development, staging and production. A new feature must work identically across
all three; `docs/ENVIRONMENTS.md` and `docs/RUNBOOK.md` are authoritative.

## How work is done here

- `ng generate` for new Angular components, not hand-rolled files.
- `ng build --configuration=production` before any phase is called done.
- Update `scripts/smoke-test.sh` for anything that touches an API flow.
- Keep `PRE-LAUNCH-CHECKLIST.md` and `docs/FLOW-AUDIT.md` current — the
  checklist row is the record of what was decided and why.
- Conventional commits (`commitlint.config.js` has the allowed scopes), a tag
  per phase in `scripts/push-release-tags.sh`.
- Run the smoke suite and the drives before merging a branch.

### The habit that matters most

This codebase has repeatedly shipped **controls that only look like controls**:
a `MAX_ATTEMPTS` nothing read, a `documentDeletedAt` that deleted nothing,
nineteen `@Throttle` decorators with no guard registered, a `Message.readAt`
nobody wrote, a notice channel nobody could read, a nav audit structurally
incapable of seeing a dead link, and a rent-reminder control on a screen with
no route.

So: **change it, drive it, then reintroduce the bug and confirm the check
fails.** A check that cannot fail is not a check. If something cannot be proven
in this environment, say so by name rather than implying it was verified.

## The traps in this container

- `ng serve` and `tsc -w` both stop watching **silently**. If a fix appears not
  to work, restart them rather than trusting the watcher.
- An **emoji inside a CSS comment** in a component's `styles` block fails
  esbuild's CSS parser; `ng serve` then keeps serving the previous bundle. The
  production build does fail, which is the net.
- Backticks inside a component's inline template literal **terminate the
  template**. Two compile failures so far.
- `psql -tAc` prints the command tag as well as the result, so
  `INSERT … RETURNING id` comes back as `"<uuid>\nINSERT 0 1"`. Use
  `dbQuery` from `scripts/lib/drive-session.mjs`, and one line of SQL per call.
- Rate limiting is real (v1.86.0): 60 registers an hour, 30 logins per 15
  minutes, counted in memory. The drives are heavy enough to exhaust it, and
  the failure reads as an auth bug. Restart the API to clear the counters.
- Postgres may need `pg_ctlcluster 16 main start` before anything works.
- `prisma migrate` connects through **`directUrl`**, not `url`. `schema.prisma`
  declares `directUrl = env("DIRECT_URL")`, so exporting only `DATABASE_URL`
  leaves `DIRECT_URL` coming from `backend/.env` — and the migration lands on
  localhost while reporting "All migrations have been successfully applied."
  That is how production stayed down for an extra hour on 5 October
  (`docs/OUTSTANDING.md` § 5a). Migrate a remote database with
  `scripts/migrate-remote.sh`, which refuses in that state, never with
  `npx prisma migrate deploy` directly.
- An inline `VAR=value cmd` prefix applies to **that one command**. In
  `VAR=x node a.mjs && cmd-b`, `cmd-b` does not see `VAR`.
- `psql` rejects the whole URI over `?schema=public` — a Prisma-only parameter —
  with `invalid URI query parameter: "schema"`. Any script that hands a Prisma
  connection string to `psql` has to strip it first.
