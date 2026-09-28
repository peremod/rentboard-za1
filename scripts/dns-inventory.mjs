#!/usr/bin/env node
/**
 * Read umastande.co.za's zone from its authoritative nameservers, and say
 * whether it is serving what the application needs.
 *
 * Written for the outage it diagnoses. Zone edits made in cPanel since
 * 25 September have not reached any authoritative nameserver: all four agree
 * on SOA serial 2026092501, so it is not a split between the two DNS providers
 * the domain is delegated to — the published zone simply has not changed.
 * Resend cannot verify the domain, so the application sends no email at all.
 *
 * Two jobs, and the second is why it is worth committing:
 *
 *  1. Inventory. Before moving a zone anywhere you need to know every record
 *     it currently answers, and the repository does not know them. MX in
 *     particular exists nowhere in this codebase and points at the old shared
 *     host — recreate the zone without it and the company's email stops.
 *  2. Verification. Run it again after a migration and it answers the only
 *     question that matters: is every name still resolving, from the servers
 *     that are now authoritative.
 *
 * It queries each authoritative nameserver directly rather than a recursive
 * resolver. A recursive answer can come from cache and would have agreed with
 * itself for days after the zone stopped updating — which is exactly how this
 * fault stayed invisible.
 *
 *   node scripts/dns-inventory.mjs                 # inventory + checks
 *   node scripts/dns-inventory.mjs --json          # machine-readable
 *   DOMAIN=example.co.za node scripts/dns-inventory.mjs
 *
 * Exits non-zero if a required record is missing or disagrees between
 * nameservers, so it can gate a cutover.
 */
import { promises as dnsPromises } from 'node:dns';

const DOMAIN = process.env.DOMAIN ?? 'umastande.co.za';
const JSON_OUT = process.argv.includes('--json');

/** Names worth asking about: what the app uses, plus what shared hosting creates. */
const NAMES = [
  '', 'www', 'api', 'staging',
  'mail', 'webmail', 'ftp', 'cpanel', 'autodiscover',
  // Resend puts DKIM and the return path under these. Their absence is the
  // finding, not an error — it is why no email sends.
  'send', 'resend._domainkey', 'send._domainkey',
  '_dmarc',
];

const problems = [];
const note = (m) => problems.push(m);

async function authoritativeServers() {
  const ns = await dnsPromises.resolveNs(DOMAIN);
  const out = [];
  for (const name of ns.sort()) {
    try {
      const [ip] = await dnsPromises.resolve4(name);
      out.push({ name, ip });
    } catch {
      note(`nameserver ${name} does not resolve — delegation points at a host that does not exist`);
    }
  }
  return out;
}

/** The promises Resolver takes an explicit server list, which is the whole point. */
async function queryOne(ip, fqdn) {
  const { Resolver: PromiseResolver } = dnsPromises;
  const r = new PromiseResolver({ timeout: 6000, tries: 2 });
  r.setServers([ip]);
  const found = {};
  for (const [type, fn] of [
    ['A', 'resolve4'], ['CNAME', 'resolveCname'],
    ['TXT', 'resolveTxt'], ['MX', 'resolveMx'],
  ]) {
    try {
      const value = await r[fn](fqdn);
      if (value?.length) found[type] = value;
    } catch {
      /* absent is normal for most name/type pairs */
    }
  }
  return found;
}

const servers = await authoritativeServers();
if (!servers.length) {
  console.error(`No authoritative nameservers resolved for ${DOMAIN}. Nothing can be checked.`);
  process.exit(1);
}

// ── Every nameserver must serve the same zone version ──────────────────────
const { Resolver: PR } = dnsPromises;
const serials = [];
for (const { name, ip } of servers) {
  const r = new PR({ timeout: 6000, tries: 2 });
  r.setServers([ip]);
  try {
    const soa = await r.resolveSoa(DOMAIN);
    serials.push({ name, ip, serial: soa.serial, minttl: soa.minttl, hostmaster: soa.hostmaster });
  } catch (err) {
    serials.push({ name, ip, serial: null, error: err.code });
    note(`${name} did not answer SOA (${err.code})`);
  }
}
const distinct = [...new Set(serials.map((s) => s.serial).filter(Boolean))];
if (distinct.length > 1) {
  note(`nameservers disagree on the zone version: ${distinct.join(' vs ')} — some are serving a stale copy`);
}

// ── Inventory, read from the first nameserver that answers ─────────────────
const primary = servers[0];
const records = {};
for (const name of NAMES) {
  const fqdn = name ? `${name}.${DOMAIN}` : DOMAIN;
  const found = await queryOne(primary.ip, fqdn);
  if (Object.keys(found).length) records[fqdn] = found;
}

// ── What the application actually needs ────────────────────────────────────
const www = records[`www.${DOMAIN}`];
if (!www?.CNAME?.some((c) => /vercel-dns\.com$/.test(c)) && !www?.A?.length) {
  note(`www.${DOMAIN} does not point at Vercel — the website will not load`);
}
const api = records[`api.${DOMAIN}`];
if (!api?.CNAME?.some((c) => /onrender\.com$/.test(c)) && !api?.A?.length) {
  note(`api.${DOMAIN} does not point at Render — every page that needs data will fail`);
}
if (!records[DOMAIN]?.A?.length && !records[DOMAIN]?.CNAME?.length) {
  note(`the apex ${DOMAIN} resolves to nothing — anyone typing the bare domain gets an error`);
}
if (!records[DOMAIN]?.MX?.length) {
  note(`no MX on ${DOMAIN} — inbound email to the domain will bounce`);
}
const spf = records[DOMAIN]?.TXT?.flat().find((t) => t.startsWith('v=spf1'));
if (!spf) note(`no SPF record on ${DOMAIN} — outbound mail is more likely to be spam-filtered`);

/**
 * Resend's records, and their absence is the outage.
 *
 * Counted as a problem, not a footnote. The first version of this script
 * printed "✅ Every record the application needs is being served" directly
 * above "the application can send no email", which cannot both be true: a
 * landlord who signs up is never told about an applicant, and nobody can reset
 * a password. A summary that contradicts its own findings is the failure this
 * repository has spent a week removing from other checks.
 */
const hasResend = Object.keys(records).some((n) => /(^|\.)send\.|_domainkey/.test(n))
  || (spf?.includes('resend') ?? false);
if (!hasResend) {
  note(
    'no Resend DKIM or return-path records — the application sends no email at all: '
      + 'no application alerts, no magic links, no password resets',
  );
}

if (JSON_OUT) {
  console.log(JSON.stringify({ domain: DOMAIN, servers, serials, records, hasResend, problems }, null, 2));
} else {
  console.log(`\n── ${DOMAIN} ─────────────────────────────────────────────\n`);
  console.log('Authoritative nameservers:');
  for (const s of serials) {
    console.log(`  ${s.name.padEnd(18)} ${String(s.ip).padEnd(16)} SOA ${s.serial ?? s.error}`);
  }
  if (distinct.length === 1) {
    const [{ minttl, hostmaster }] = serials.filter((s) => s.serial);
    console.log(`\n  All agree on serial ${distinct[0]}. Negative-cache TTL ${minttl}s, hostmaster ${hostmaster}.`);
    console.log('  The serial is the zone\'s version: if an edit was made after it, the edit is not published.');
  }

  console.log('\nRecords:');
  for (const [fqdn, found] of Object.entries(records)) {
    const parts = Object.entries(found).map(([t, v]) => {
      if (t === 'MX') return `MX ${v.map((m) => `${m.priority} ${m.exchange}`).join(', ')}`;
      if (t === 'TXT') return `TXT ${v.flat().join(' | ')}`;
      return `${t} ${v.join(', ')}`;
    });
    console.log(`  ${fqdn.padEnd(32)} ${parts.join('\n' + ' '.repeat(35))}`);
  }

  console.log(`\nResend (email) records present: ${hasResend ? 'yes' : 'NO — the application can send no email'}`);

  if (problems.length) {
    console.log('\nProblems:');
    for (const p of problems) console.log(`  ❌ ${p}`);
  } else {
    console.log('\n✅ Every record the application needs is being served.');
  }
  console.log();
}

process.exit(problems.length ? 1 : 0);
