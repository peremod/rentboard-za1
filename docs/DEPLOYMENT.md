# Deploying to Staging

Everything so far is proven on localhost. This gets it onto real infrastructure,
where a different class of problem lives: environment variables, CORS, SSL,
prerendering against a live API, and migrations on a database you cannot reset.

The GitHub Actions workflows already exist and target **Railway** (backend +
Postgres) and **Vercel** (frontend). This is the setup they expect.

Budget roughly two hours for the first run. Most of it is waiting for DNS and
clicking through dashboards.

---

## 1. What you need before starting

| | Why | Cost |
|---|---|---|
| GitHub repo with the code pushed | The workflows deploy from it | Free |
| Railway account | Backend and Postgres | ~$5/mo, free trial credit |
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
cd ~/Downloads/rentboard-za1
git remote -v                      # check whether a remote already exists
git remote add origin git@github.com:YOURNAME/rentboard-za.git
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

## 3. Railway — backend and database

1. **New Project** → Deploy from GitHub repo → select the repo
2. **Add Postgres**: New → Database → PostgreSQL. Railway sets `DATABASE_URL`
   automatically
3. **Settings → Root Directory**: `backend`
4. **Create a staging environment**: Settings → Environments → New → `staging`

### Environment variables

Set these on the staging environment. `DATABASE_URL` is already there.

```
NODE_ENV=production
PORT=3000

JWT_SECRET=            # openssl rand -base64 48
JWT_REFRESH_SECRET=    # openssl rand -base64 48  — must differ from the above
JWT_EXPIRES_IN=15m

FRONTEND_URL=https://staging-rentboard.vercel.app
API_URL=https://rentboard-api-staging.up.railway.app

IMAGEKIT_PUBLIC_KEY=
IMAGEKIT_PRIVATE_KEY=
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/l4on8rrpx

RESEND_API_KEY=
RESEND_FROM=noreply@yourdomain.co.za
RESEND_WEBHOOK_SECRET=
ADMIN_ALERT_EMAIL=you@yourdomain.co.za

PAYFAST_MERCHANT_ID=
PAYFAST_MERCHANT_KEY=
PAYFAST_PASSPHRASE=
PAYFAST_SANDBOX=true
```

**Generate real secrets.** Reusing the development `JWT_SECRET` means anyone
who has seen your local `.env` can mint tokens for staging.

`FRONTEND_URL` and `API_URL` are circular — you will not know the Vercel URL
until step 4. Deploy the backend first, note its URL, then come back and set
`FRONTEND_URL` once Vercel is up.

---

## 4. Vercel — frontend

1. **Add New → Project** → import the repo
2. **Root Directory**: `frontend`
3. **Framework Preset**: Angular
4. **Build Command**: `npm run build`
5. **Output Directory**: `dist/rentboard-frontend/browser`

### Environment variable

```
API_URL=https://rentboard-api-staging.up.railway.app
```

Angular bakes environment values at build time, so `environment.staging.ts`
must point at the Railway URL.

**It currently assumes a custom domain you probably do not have yet** —
`https://api-staging.rentboard.co.za/api`. Either point that subdomain at
Railway, or change the file to the Railway URL for now. If it is wrong, every
API call from staging fails and the site looks completely broken rather than
partly broken, which at least makes it easy to spot.

```ts
// frontend/src/environments/environment.staging.ts
apiUrl: 'https://rentboard-api-staging.up.railway.app/api',
imagekitUrl: 'https://ik.imagekit.io/l4on8rrpx',
```

---

## 5. GitHub secrets

Settings → Secrets and variables → Actions:

```
RAILWAY_TOKEN     # Railway → Account Settings → Tokens
VERCEL_TOKEN      # Vercel → Settings → Tokens
VERCEL_ORG_ID     # .vercel/project.json after one local `vercel` run
VERCEL_PROJECT_ID # same file
```

---

## 6. Migrate and seed

The backend workflow runs `prisma migrate deploy` automatically. **Not
`migrate dev`** — that is the right call, since `dev` can prompt for a reset and
would destroy data.

Once the first deploy succeeds, seed the reference data:

```bash
railway run --environment staging npx ts-node prisma/seed.ts
```

That creates places and house ads. Add the admin:

```bash
railway run --environment staging \
  ADMIN_EMAIL=you@yourdomain.co.za ADMIN_PASSWORD='<strong>' \
  npx ts-node prisma/seed.ts
```

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
API=https://rentboard-api-staging.up.railway.app \
FRONTEND_URL=https://staging-rentboard.vercel.app \
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
5. **Cold starts.** Railway's free tier sleeps. The first request after idle
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
