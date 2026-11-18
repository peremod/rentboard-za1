import { describe, it, expect } from 'vitest';
import { buildRobotsTxt, AI_TRAINING_CRAWLERS, AI_SEARCH_CRAWLERS } from './seo.controller';

/**
 * The AI-crawler policy, tested against THIS build's own robots.txt rather than
 * the served file.
 *
 * ⚠️ Why here and not only in seo-drive: in CI the production build's bundle
 * fetches the production origin, so the robots.txt seo-drive reads on the prod
 * pass is PROXIED from live production — the deployed code's policy, not this
 * branch's. seo-drive therefore can only assert the structural invariant that
 * holds for any valid robots.txt (its "*" group protects the private areas; no
 * named group carries an Allow). The presence of the training blocks — this
 * branch's actual change — is verified here, where the input is this build's
 * own `buildRobotsTxt`.
 */

/** Parse robots.txt into groups: user-agents sharing the directives below them. */
function parseGroups(body: string) {
  const groups: { agents: string[]; rules: string[] }[] = [];
  let cur: { agents: string[]; rules: string[] } | null = null;
  for (const raw of body.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const ua = line.match(/^User-agent:\s*(.+)$/i);
    if (ua) {
      if (cur && cur.rules.length === 0) cur.agents.push(ua[1].trim());
      else { cur = { agents: [ua[1].trim()], rules: [] }; groups.push(cur); }
    } else if (/^(Allow|Disallow):/i.test(line)) {
      cur?.rules.push(line);
    }
  }
  return groups;
}

describe('robots.txt — the AI-crawler policy', () => {
  describe('a non-indexable deployment (staging, development)', () => {
    const body = buildRobotsTxt('https://staging.example', false);
    it('refuses everything and advertises no sitemap', () => {
      expect(body).toBe('User-agent: *\nDisallow: /');
      expect(body).not.toMatch(/^Sitemap:/m);
    });
  });

  describe('an indexable deployment (production)', () => {
    const site = 'https://www.umastande.co.za';
    const body = buildRobotsTxt(site, true);
    const groups = parseGroups(body);
    const star = groups.find((g) => g.agents.includes('*'));
    const named = groups.filter((g) => !g.agents.includes('*'));
    const namedAgents = named.flatMap((g) => g.agents);

    it('lets everything else crawl via a single "*" Allow', () => {
      expect(star).toBeDefined();
      expect(star!.rules).toContain('Allow: /');
      // "*" is the ONLY group that may say Allow.
      for (const g of named) {
        expect(g.rules.some((r) => /^Allow:/i.test(r))).toBe(false);
      }
    });

    it('keeps the private and authenticated areas out, in English and every locale', () => {
      for (const p of ['/auth/', '/tenant/', '/landlord/', '/account/', '/admin/', '/api/']) {
        expect(body).toContain(`Disallow: ${p}`);
      }
      // A couple of locale-prefixed forms, to prove the loop ran.
      expect(body).toContain('Disallow: /zu/account/');
      expect(body).toContain('Disallow: /af/admin/');
    });

    it('names its own sitemap at the deployment origin', () => {
      expect(body).toContain(`Sitemap: ${site}/sitemap.xml`);
    });

    it('blocks every TRAINING crawler, each as a full "Disallow: /" with no Allow', () => {
      for (const t of AI_TRAINING_CRAWLERS) {
        const g = named.find((grp) => grp.agents.includes(t));
        expect(g, `${t} must have a group`).toBeDefined();
        expect(g!.rules.some((r) => /^Disallow:\s*\/\s*$/i.test(r)), `${t} must be a full block`).toBe(true);
        expect(g!.rules.some((r) => /^Allow:/i.test(r)), `${t} must not Allow`).toBe(false);
      }
    });

    it('leaves every SEARCH crawler unnamed, so it falls through to "*"', () => {
      // This is the check that must be able to fail: if a search crawler were
      // ever added to AI_TRAINING_CRAWLERS, it would appear as a named full
      // block here and this fails — which is the "citable, not trainable"
      // policy breaking silently.
      for (const s of AI_SEARCH_CRAWLERS) {
        expect(namedAgents, `${s} must stay allowed via "*"`).not.toContain(s);
      }
      // Classic search engines, likewise never named.
      expect(namedAgents).not.toContain('Googlebot');
      expect(namedAgents).not.toContain('Bingbot');
    });

    it('every named group is a training crawler — nothing unexpected is blocked', () => {
      expect([...namedAgents].sort()).toEqual([...AI_TRAINING_CRAWLERS].sort());
    });
  });
});
