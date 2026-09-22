# Deploying to Staging

Everything so far runs on a laptop. This puts it on real infrastructure, where a
different class of problem lives: environment variables, CORS, SSL, cold starts,
prerendering against a live API, and migrations on a database you cannot reset.

Three services, all free to start:

| Piece | Where | Why |
|---|---|---|
| Postgres | **Neon** | Free tier does not expire, only sleeps |
| Backend (NestJS) | **Render** | Deploys from `render.yaml`, no CI token needed |
| Frontend (Angular) | **Vercel** | Free, and handles Angular SSR |

Budget about two hours for the first run, most of it waiting for DNS and
clicking through dashboards.

> Its two deploy workflows were deleted in v1.55.0 rather than left to fail on
> every push: Render and Vercel both deploy on push by themselves, so a CI
> deploy step is redundant here, not just broken.

## 1. What you need before starting

| | Why | Cost |
|---|---|---|
| GitHub repo with the code pushed | The workflows deploy from it | Free |
| Vercel account | Frontend | Free tier is enough |
| Resend account + a domain | Magic links and every notification | Free to 3,000/mo |
| ImageKit account | Already have one | Free tier |
| A domain | Email deliverability needs one | ~R100/yr |

**The domain is not optional.** Resend will not send from an unverified domain,
and magic-link sign-in is now the main path for returning users. Without working
email, staging cannot be tested properly.

---

## 2. Push the code to GitHub

If the repo is still only local:

```bash
cd ~/Downloads/mastande-za1
git remote -v                      # check whether a remote already exists
git remote add origin git@github.com:YOURNAME/mastande-za.git
git push -u origin master
git push --tags
```

The workflows deploy `develop` to staging and `main` to production. Create the
staging branch:

```bash
git checkout -b develop
git push -u origin develop
```

---

## 2b. Hosting

real trade-offs.

**Free-tier terms change often. Verify current limits before committing** —
what follows was accurate when written and these providers revise it regularly.

### Neon — the database

Create the project first: the backend cannot start without its connection
strings, and it is the only piece with no free alternative worth having.

1. neon.tech → new project, region **eu-central-1 (Frankfurt)** — the closest
   to South Africa, roughly 150ms rather than 250ms from Cape Town
2. Create a branch for staging if you want production isolated later; the free
   tier allows it and a shared database between environments is how test data
   ends up in front of real users
3. Copy **both** connection strings from the dashboard

Neon gives two, and they are not interchangeable:

| Variable | Which string | Used by |
|---|---|---|
| `DATABASE_URL` | **Pooled** — host contains `-pooler` | The running app |
| `DIRECT_URL` | **Unpooled** | `prisma migrate` only |

`schema.prisma` already declares `directUrl`, so this works once both are set.
Running migrations against the pooled string fails with an advisory-lock error
that reads like a permissions problem and is not one.

Append `?sslmode=require` to both. Neon rejects unencrypted connections, and
the failure is a timeout rather than a clear message.

**The free tier sleeps after five minutes of inactivity.** It wakes in about a
second, so the first request after a quiet period is slow but not broken —
worth knowing before you conclude the API has a performance problem.

### Render — the application host

| | Free tier | Catch |
|---|---|---|
| **Render** web service | 750 hours/month | **Sleeps after ~15 min idle.** Next request takes 30–60s |
| **Neon** Postgres | ~0.5 GB | Pauses on inactivity, resumes automatically in a second or two |

Neon rather than Render's own free Postgres, because Render's free database
has historically expired after a fixed period and taken the data with it. Neon's
free tier does not expire — it just sleeps.

`render.yaml` in the repo root is a ready blueprint: Render dashboard → New →
Blueprint → point at the repo. It needs no GitHub token and no CI secrets,
which makes it the easier of the two to start with.

Then set `DATABASE_URL` from Neon in the Render dashboard, along with the
ImageKit, Resend and PayFast values.

### Alternative: Fly.io

More generous on uptime and closer to a real production setup — it does not
sleep the same way. It requires a card on file even for the free allowance, and
Postgres is unmanaged, meaning backups are yours to arrange. Worth it if you
are comfortable with a bit more operations work.

### What the sleeping actually costs you

Cold starts matter more here than on a typical side project:

- **PayFast ITN**: PayFast retries, so a payment eventually confirms even if
  the first call hits a sleeping service. Slow, not broken
- **Resend webhooks**: also retried
- **The daily digest and monthly advertiser reports** are cron jobs inside the
  app. **A sleeping service does not run them.** On a free tier, expect these
  to fire unreliably. Not a problem for staging; it is a reason to pay for
  production
- **Anyone you show the site to** will hit a 30-second first load and assume it
  is broken. Warm it up before a demo by loading it yourself first

### When to pay

Move off free when you have real users. Roughly $5–7/month on Render's starter
plan removes the sleeping, which fixes cold starts and makes the scheduled jobs
reliable. That is the point where free stops being a saving and starts being a
liability.

## 3. Render — the backend

1. **New Project** → Deploy from GitHub repo → select the repo
   automatically
3. **Settings → Root Directory**: `backend`
4. **Create a staging environment**: Settings → Environments → New → `staging`

### Environment variables

Set these on the staging environment. `DATABASE_URL` is already there.

```
NODE_ENV=production
PORT=3000

# The environment's own identity. APP_ENV decides which origins are accepted
# and whether the site is indexable; NODE_ENV alone cannot, because staging
# runs with NODE_ENV=production. Unset means `development`, which is the safe
# direction.
APP_ENV=staging

JWT_SECRET=            # openssl rand -base64 48
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_TTL_DAYS=30

# SITE_URL is REQUIRED — the API refuses to start without it, on purpose. It
# is the public origin of the FRONTEND for this environment, and it is what
# sitemap.xml and robots.txt are built from. It must differ per environment:
# the old fallback was the production origin, so a misconfigured staging box
# published production URLs in its own sitemap and looked fine in every log.
SITE_URL=https://staging.umastande.co.za
FRONTEND_URL=https://staging.umastande.co.za
API_URL=https://<your-render-url>

# Google sign-in. The callback must match the URI registered in the Google
# Cloud console for THIS environment — see docs/AUTHENTICATION.md.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=https://<your-render-url>/api/auth/google/callback

IMAGEKIT_PUBLIC_KEY=
IMAGEKIT_PRIVATE_KEY=
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/l4on8rrpx

RESEND_API_KEY=
RESEND_FROM=noreply@yourdomain.co.za
RESEND_FROM_NAME=Mastande
RESEND_WEBHOOK_SECRET=
ADMIN_ALERT_EMAIL=you@yourdomain.co.za

PAYFAST_MERCHANT_ID=
PAYFAST_MERCHANT_KEY=
PAYFAST_PASSPHRASE=
PAYFAST_SANDBOX=true

# WhatsApp Business API. Optional — email notifications never depend on it —
# but three features are dark without it: rent reminders, previous-landlord
# reference requests, and listing a room over WhatsApp.
#
# WHATSAPP_APP_SECRET is the Meta App Secret (App Dashboard -> Settings ->
# Basic), and it is what signs every inbound delivery. It is NOT the verify
# token, which Meta echoes once during the GET handshake and which says
# nothing about any later POST. With no app secret the webhook refuses every
# delivery rather than trusting unsigned ones, so the feature is off rather
# than open — and it fails silently from the outside, which is why it is
# listed here rather than discovered later.
WHATSAPP_API_VERSION=v19.0
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
```

Nine variables above were missing from this list until v1.61.0, `SITE_URL`
among them — and the API refuses to start without that one, so anyone
following this guide deployed a backend that would not boot. The list is now
checked against what `backend/src` actually reads.

**Generate real secrets.** Reusing the development `JWT_SECRET` means anyone
who has seen your local `.env` can mint tokens for staging.

`FRONTEND_URL` and `API_URL` are circular — you will not know the Vercel URL
until step 4. Deploy the backend first, note its URL, then come back and set
`FRONTEND_URL` once Vercel is up.

---

### Migrations are manual on the free tier

Render's free tier rejects `preDeployCommand`, so nothing migrates the database
for you. **Run this before every deploy that changes the schema:**

```bash
export NEON_POOLED="..."   # pooled, host has -pooler
export NEON_DIRECT="..."   # unpooled
npm run migrate:staging
```

This is worse than automatic and worth naming as such: it can be forgotten, and
a forgotten migration means the API starts against a schema it does not expect
— usually surfacing as a 500 on one endpoint rather than a clear failure.

Add `preDeployCommand: npx prisma migrate deploy` back to `render.yaml` the day
this moves to a paid instance.

## 4. Vercel — frontend

1. **Add New → Project** → import the repo
2. **Root Directory**: `frontend`
3. **Framework Preset**: Angular
4. **Build Command**: `npm run build:prod` (set in `vercel.json`)
5. **Output Directory**: `dist/mastande-frontend/browser` (set in `vercel.json`)

### This is a static deployment, and that is a known limitation

Angular builds two things: `browser/`, the client bundle and the prerendered
pages, and `server/server.mjs`, the SSR server. Naming the browser folder
publishes those files and nothing else, so the server is built on every deploy
and thrown away. Room pages are therefore client-rendered in production and
unknown URLs cannot carry a status — see row 24 of `PRE-LAUNCH-CHECKLIST.md`.

**Do not "fix" this by deleting the setting.** v1.74.0 did exactly that, on
the assumption that Vercel would then default to the browser folder. It does
not: the Angular preset reads `outputPath` from `angular.json`, which is
`dist/mastande-frontend`, and publishes that — so `index.html` ends up at
`/browser/index.html` and **every URL on the site 404s, `/` included**. That
was live until it was reverted. The replacement is a `.vercel/output` build
(Vercel Build Output API) that routes explicitly instead of relying on what a
framework preset infers.

### What a static deployment still has to get right

Both of these were wrong on the live site. `scripts/verify-build.sh` asserts
them now, because nothing in this repo had ever read `vercel.json`.

**1. The SPA fallback must point at `/`, not `/index.html`.** `cleanUrls`
strips `.html`, so `/index.html` is itself a 308 and a rewrite to it resolves
to nothing. That is what this cost, measured on the live deployment:

| URL | Before | After |
|---|---|---|
| `/`, `/pricing`, `/legal/terms`, `/advertise` | 200 | 200 |
| `/auth/login` | **404** | 200 |
| `/tenant/dashboard` | **404** | 200 |
| `/rooms/<any id>` | **404** | 200, client-rendered |

Every room link ever shared on WhatsApp was dead, and so was the login page,
for as long as that rewrite has existed.

**2. robots.txt, sitemap.xml and X-Robots-Tag.** A static deployment has no
server to answer the first two, so they are edge rewrites to the API that
generates them — without one they 404, and a 404 robots.txt means *crawl
everything*. And because the production build sets `index, follow` in its meta
robots, any host serving that build which is not the real domain must carry an
`X-Robots-Tag: noindex` header, or the preview competes with production for
every keyword the day it launches. Both `staging.umastande.co.za` and
`rentboard-za1.vercel.app` carry it.

### Preview deployments

A **production** build allows only `umastande.co.za` and `www.` as Host
headers (see `allowedHosts` in `frontend/src/server.ts`), so a preview
deployment on a generated `*.vercel.app` hostname is rejected and falls back
to client rendering. If you want previews to server-render, set
`NG_ALLOWED_HOSTS=*.vercel.app` in Vercel's **Preview** environment only.

### Environment variable

```
API_URL=https://<your-render-url>
```

Angular bakes environment values at build time, so `environment.staging.ts`

**It currently assumes a custom domain you probably do not have yet** —
`https://api-staging.umastande.co.za/api`. Either point that subdomain at
API call from staging fails and the site looks completely broken rather than
partly broken, which at least makes it easy to spot.

```ts
// frontend/src/environments/environment.staging.ts
apiUrl: 'https://<your-render-url>/api',
imagekitUrl: 'https://ik.imagekit.io/l4on8rrpx',
```

---

## 5. No GitHub secrets needed

Render deploys from `render.yaml` on push and Vercel deploys from its own
project settings. Neither needs a token in GitHub, which is one fewer secret to
rotate and one fewer thing to get wrong.

CI still runs on every push — audits, type check, tests and build — but it does
not deploy.

### One repository variable, though

`Verify deployment` checks that staging is healthy, is serving the commit that
was just pushed, has a reachable database and refuses crawlers. It needs to be
told where staging is:

**Settings → Secrets and variables → Actions → Variables → New variable**

| Name | Value |
|---|---|
| `STAGING_API_HOST` | the staging host, e.g. `rentboard-api.onrender.com` — hostname only, no scheme, no trailing slash |

A variable, not a secret: it is a public hostname and it is more useful in the
logs than masked out.

**Leaving it unset means the check skips rather than fails**, and says so in
its output. That is deliberate — a red check nobody can act on trains people
to ignore the only signal this repository has that a deploy happened. It used
to try to infer this from DNS and could not: every `*.onrender.com` name
resolves whether or not a service exists behind it, so the inference was dead
code and the check ran against a host that served nothing.

Point it at the custom domain once that is attached to the service.

## 6. Migrate and seed

The backend workflow runs `prisma migrate deploy` automatically. **Not
`migrate dev`** — that is the right call, since `dev` can prompt for a reset and
would destroy data.

Once the first deploy succeeds, seed the reference data:

```bash
cd backend
DATABASE_URL="$NEON_POOLED" DIRECT_URL="$NEON_DIRECT" npx ts-node prisma/seed.ts
```

That creates places and house ads. Add the admin:

```bash
cd backend
DATABASE_URL="$NEON_POOLED" DIRECT_URL="$NEON_DIRECT" \
  ADMIN_EMAIL=you@yourdomain.co.za ADMIN_PASSWORD='<strong>' \
  npx ts-node prisma/seed.ts
```

Seeding runs from your laptop against Neon. Render is not involved and does not
need to exist yet — proving the schema against cloud Postgres before any
hosting is set up is worth doing on its own.

**Do not seed demo ads or launch codes on staging** unless you want them there —
both are opt-in flags and staging is where you show people the product.

---

## 7. Resend

1. Add your domain, set the SPF, DKIM and DMARC records at your registrar
2. Wait for verification
3. Add the webhook: `https://<api-url>/api/notifications/webhook/resend`,
   subscribed to `email.delivered`, `email.bounced`, `email.complained`
4. Copy the signing secret into `RESEND_WEBHOOK_SECRET`

Start DMARC at `p=none` and watch the reports before tightening, or you risk
silently dropping your own mail.

---

## 8. Prove it works

```bash
API=https://<your-render-url> \
FRONTEND_URL=https://staging-mastande.vercel.app \
./scripts/smoke-test.sh
```

The script creates real accounts using timestamped emails, so it is safe to run
repeatedly against staging. **Never run it against production.**

Then check by hand the things a smoke test cannot see:

- Request a magic link and confirm the email arrives and signs you in. This is
  the one most likely to fail first, and it fails silently
- Upload a room photo — ImageKit from a different origin is a new code path
- Open the board on a phone on mobile data, not just a narrow desktop window
- Sign in as admin and confirm `/admin` loads

---

## 8b. A note on fonts

Angular's `optimization.fonts` inlines Google Fonts at **build** time by
downloading the stylesheet. That makes the build require internet and fail
outright when the request is slow, proxied or blocked:

```
An unhandled exception occurred: Inlining of fonts failed.
```

It is disabled in the production configuration. Fonts load normally at runtime
via the `<link>` in index.html, which is where they were coming from anyway.

**Worth doing properly before launch:** self-host the two families. Every
visitor currently makes a request to `fonts.googleapis.com`, which is a
third-party request on a site whose cookie notice says there are no
third-party trackers. Google Fonts does not set cookies, so the claim still
holds, but it does expose visitor IPs to Google and removing it would make the
promise unambiguous. It also removes a render-blocking round trip, which is
worth real Lighthouse points.

### Render: leave Root Directory empty

`render.yaml` already sets `dockerContext: ./backend`. Setting **Root
Directory** to `backend` in the dashboard as well makes Render look for
`backend/backend` and fail at checkout, before any build output:

```
error: invalid local: resolve : lstat /opt/render/project/src/backend/backend
```

If the service was created by hand before the Blueprint, that field is likely
still set. Clear it.

## 9. What will probably break first

In roughly this order:

1. **CORS.** `FRONTEND_URL` must match the Vercel URL exactly, including
   `https://` and no trailing slash
2. **Emails not arriving.** Almost always DNS not yet propagated, or
   `RESEND_FROM` on an unverified domain
3. **Images 404.** `IMAGEKIT_URL_ENDPOINT` on the backend must match
   `imagekitUrl` in the frontend environment — this bit us on day one locally
4. **Prerendered pages showing stale or empty data.** The board is prerendered;
   anything fetched in `ngOnInit` at build time bakes in whatever the API
   returned then. Ad slots already use `afterNextRender` for exactly this reason
   takes several seconds, which reads as broken

---

## 10. Before production

Staging and production are separate environments with separate databases and
separate secrets. When you promote:

- `PAYFAST_SANDBOX=false` and live PayFast credentials
- A real domain, not the Vercel subdomain
- `SEED_DEMO_ADS` and `SEED_LAUNCH_CODES` deliberately off unless wanted
- The legal placeholders filled in and the pages reviewed
- The Information Regulator registration done

That last one is not a technical blocker but it is a legal one, and it takes
longer than any of the above.
