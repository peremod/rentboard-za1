import { describe, it, expect } from 'vitest';
import { About } from './about';

/**
 * The /about page is the site's entity page — the one URL whose whole job is to
 * say, in machine-readable form, "this is Mastande, run by Umastande (Pty) Ltd,
 * and here is the thing it is." That matters more than usual here because of the
 * one-letter brand collision with uMaStandi: whoever carries the clearer entity
 * wins the disambiguation. The prose already states the facts; this covers the
 * AboutPage/WebPage JSON-LD that lets a parser join them to the Organization and
 * WebSite entities emitted site-wide (core/seo/site-identity.ts).
 *
 * The contract, and why each clause is a bug if it breaks:
 *   - it emits ONE block under a stable id so re-navigation replaces its own
 *     block and nothing else (the keying SeoService.setJsonLd depends on).
 *   - @type is AboutPage — the specific type for an about page, not a bare
 *     WebPage, so the page's role is explicit.
 *   - `about` references the SAME @id the Organization block uses, so the graph
 *     reads "this page is about that company" instead of describing a second,
 *     unlinked company. `isPartOf` ties it to the WebSite the same way.
 *   - it invents nothing: no address, telephone, founding date, rating or price.
 *     site-identity.ts omits those deliberately because they would be fabricated,
 *     and this page must hold the same line — a drifted copy here would reinstate
 *     exactly the unverifiable facts that policy forbids.
 *
 * Rendered-HTML coverage (that the block is actually in the served bytes of
 * /about) is the seo-drive's job against a running server; this exercises the
 * method, the way location.spec and room-detail.spec do.
 */
describe('About — the entity page emits truthful AboutPage structured data', () => {
  const build = () => {
    const c = Object.create(About.prototype) as Record<string, unknown> & { ngOnInit: () => void };
    const jsonLd: Record<string, unknown> = {};
    c['seo'] = {
      setJsonLd: (id: string, data: unknown) => { jsonLd[id] = data; },
    };
    return { c, jsonLd };
  };

  it('emits exactly one AboutPage block, keyed "about"', () => {
    const { c, jsonLd } = build();
    c.ngOnInit();
    expect(Object.keys(jsonLd)).toEqual(['about']);
    expect((jsonLd['about'] as Record<string, unknown>)['@type']).toBe('AboutPage');
  });

  it('is about the site Organization and part of the WebSite, by shared @id', () => {
    const { c, jsonLd } = build();
    c.ngOnInit();
    const block = jsonLd['about'] as any;
    // The references must end in the exact fragments site-identity.ts minted,
    // or a parser treats them as different entities and the link is lost.
    expect(block.about['@id']).toMatch(/#organization$/);
    expect(block.isPartOf['@id']).toMatch(/#website$/);
    expect(String(block.url)).toMatch(/\/about$/);
    expect(block['@id']).toMatch(/\/about\/#webpage$/);
    expect(block.inLanguage).toBe('en-ZA');
    expect(block.name).toContain('Mastande');
    expect(typeof block.description).toBe('string');
    expect((block.description as string).length).toBeGreaterThan(50);
  });

  it('invents no unverifiable facts — the same line site-identity.ts holds', () => {
    const { c, jsonLd } = build();
    c.ngOnInit();
    const block = jsonLd['about'] as Record<string, unknown>;
    for (const forbidden of [
      'address', 'telephone', 'email', 'foundingDate',
      'aggregateRating', 'review', 'priceRange', 'numberOfEmployees',
    ]) {
      expect(block[forbidden], `AboutPage must not assert ${forbidden}`).toBeUndefined();
    }
  });
});
