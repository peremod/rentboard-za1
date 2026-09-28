# DNS fallback — moving umastande.co.za off the current nameservers

Prepared 28 September 2026, while the zone is stuck. Not yet executed.

Run this only if the support ticket with Okuhle Digital does not produce a
published zone change. It is a real change to a live domain with live email on
it, and it is not reversible within minutes — see **Rollback** at the end.

---

## Why this exists

Zone edits made in cPanel are not reaching the authoritative nameservers.
Measured, not inferred — `node scripts/dns-inventory.mjs` asks each
authoritative server directly:

```
ns.dns1.co.za      75.2.31.235      SOA 2026092501
ns.dns2.co.za      99.83.160.106    SOA 2026092501
ns.otherdns.com    75.2.31.235      SOA 2026092501
ns.otherdns.net    154.0.6.120      SOA 2026092501
```

All four agree, so this is **not** a split between the two DNS providers the
domain is delegated to; every authoritative server is serving the same zone,
and that zone's version has not moved since 25 September. The hostmaster field
is `cp.dedicated.co.za`.

The cost is not cosmetic. Resend cannot verify the domain, so **the application
sends no email at all** — no application alerts to landlords, no magic links,
no password resets. A landlord who signs up today silently never hears about an
applicant.

---

## What is actually in the zone today

Captured from `ns.dns1.co.za` on 28 September. **This is the migration input.**
Nothing below can be reconstructed from the repository — the MX record in
particular exists nowhere in this codebase.

| Name | Type | Value |
|---|---|---|
| `umastande.co.za` | A | `197.242.157.161` |
| `umastande.co.za` | TXT | `v=spf1 +a +mx +ip4:197.242.157.161 ~all` |
| `umastande.co.za` | MX | `0 umastande.co.za` |
| `www` | CNAME | `cname.vercel-dns.com` |
| `api` | CNAME | `rentboard-api.onrender.com` |
| `mail` | CNAME | `umastande.co.za` |
| `webmail` | A | `197.242.157.161` |
| `ftp` | A | `197.242.157.161` |
| `cpanel` | A | `197.242.157.161` |
| `autodiscover` | A | `197.242.157.161` |
| `_dmarc` | TXT | `v=DMARC1; p=none;` |

No CAA record. Apex TTL is 14400s (4 hours); `www` and `api` are 300s.
SOA negative-cache TTL is **86400s — a full day**, which matters: a name that
does not exist when a resolver first asks stays "does not exist" for 24 hours
in that resolver's cache. Create every record **before** switching nameservers,
never after.

### Two things worth noticing before you move anything

**The apex points at the old shared host, not at Vercel.** `197.242.157.161`
is the cPanel server. So `https://umastande.co.za/` is served by Okuhle's box,
which redirects to `www`. That works today, but it means the bare domain
depends on hosting you are trying to move away from. The migration is the
moment to point the apex at Vercel directly.

**There is live email on that same box.** `MX 0 umastande.co.za` resolves to
`197.242.157.161`, and `webmail`/`autodiscover`/`mail` are the cPanel mail
stack. If you recreate the zone without the MX record, **inbound email to
@umastande.co.za stops**, silently, and senders get bounces. If you later
cancel the hosting, it stops regardless — decide where that mailbox lives
before, not after.

---

## Choosing a provider

Any of these is fine and all are free at this scale. What matters is that you
control the zone directly rather than through a reseller panel:

- **Cloudflare** — free, fast, has an apex ALIAS (`CNAME flattening`) so the
  apex can point at Vercel by name rather than a hardcoded IP. Requires moving
  nameservers to Cloudflare's.
- **Vercel DNS** — simplest if the website is the only thing that matters, but
  you still have to hand-carry the mail records.
- **deSEC / Hetzner / Bunny** — fine, less common.

Cloudflare is the default recommendation here purely for the apex flattening
and because it will not lose the mail records if you paste them in first.

---

## The cutover, in order

Do not reorder these. Step 3 before step 2 is an outage.

### 1. Decide the apex target

In Vercel: **Project → Settings → Domains → `umastande.co.za`**. Vercel shows
the exact A record (or ALIAS target) it wants. **Use the value Vercel shows**
— do not copy an IP address out of a blog post or out of this document, which
deliberately does not name one. Vercel has changed it before.

### 2. Build the complete zone at the new provider — nameservers unchanged

Create every row from the table above, plus the Resend records, plus the apex
change. Nothing is live yet: the domain is still delegated to the old
nameservers, so this is free to get wrong and fix.

Resend's exact record names and values are shown in **Resend → Domains →
umastande.co.za**. They are per-account, so they are not reproduced here.
Expect a DKIM `TXT` under a `_domainkey` name and a return-path `MX` plus
`TXT` under a `send.` subdomain.

The SPF record needs to keep authorising the existing mail server *and* start
authorising Resend. Today it reads:

```
v=spf1 +a +mx +ip4:197.242.157.161 ~all
```

Resend's dashboard will tell you what it wants added. **Do not create a second
SPF record** — a domain with two `v=spf1` TXT records fails SPF entirely, which
is worse than having none. There must be exactly one, containing both.

### 3. Verify against the new provider before delegating

Ask the new nameservers directly, while they are still not authoritative:

```bash
DOMAIN=umastande.co.za node scripts/dns-inventory.mjs
```

That reads the *current* delegation, so at this stage it still reports the old
zone. To check the new provider before cutover, query one of its nameservers by
hand — replace the IP with the new provider's:

```bash
node -e "
const { Resolver } = require('node:dns').promises;
const r = new Resolver(); r.setServers(['NEW_NS_IP']);
for (const n of ['umastande.co.za','www.umastande.co.za','api.umastande.co.za'])
  r.resolve4(n).then(v => console.log(n, v)).catch(e => console.log(n, e.code));
r.resolveMx('umastande.co.za').then(v => console.log('MX', v));
"
```

Every name in the table must answer before you go further.

### 4. Change the nameservers at the registrar

This is the switch. It happens at whoever the domain is registered with, not in
cPanel — cPanel is the thing that is not working.

Delegation changes propagate on the parent zone's TTL (`.co.za`), typically
within a few hours, but resolvers that already cached the old NS set will keep
using it until it expires.

### 5. Verify after

```bash
node scripts/dns-inventory.mjs
```

It exits non-zero while anything the application needs is missing, including
the Resend records, so it is a usable gate. Expect the serial to be the new
provider's, and all nameservers to agree.

Then the two site checks:

```bash
curl -s https://www.umastande.co.za/ | grep -o 'ng-server-context="[a-z]*"'   # ssr
curl -sI https://umastande.co.za/ | head -3                                    # apex answers
```

And in Resend, press **Verify** — it should pass immediately once the DKIM
record is visible.

### 6. Only then, consider the old hosting

Do not cancel it until email has moved somewhere you control. The MX record
still points at it.

---

## Rollback

Set the nameservers at the registrar back to the four listed at the top of this
document. That is the whole rollback, and it is why step 2 builds the complete
zone before step 4 switches anything: the old zone is untouched throughout and
remains correct.

The limit is time, not correctness — resolvers that cached the new delegation
keep it for its TTL. Plan a cutover when you can watch it for an hour, not last
thing on a Friday.

---

## What this does not fix

Moving nameservers routes around a broken control panel. It does not recover
the two days of email that were never sent, and it does not tell you why the
panel is broken — if the domain stays with the same registrar and reseller,
the same panel may still be the thing that renews it. Worth resolving the
support ticket either way.
