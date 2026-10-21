import { EnvironmentProviders, inject, provideAppInitializer } from '@angular/core';
import { SeoService } from '../services/seo.service';
import { environment } from '../../../environments/environment';

/**
 * The site's own identity, as structured data — Organization and WebSite.
 *
 * ── Why this exists
 *
 * Every other JSON-LD block in this app describes one page's subject: a room,
 * a landlord's storefront. Nothing described the SITE, so Google had no
 * machine-readable answer to "what is Mastande and who runs it". That is the
 * input behind a branded search result, and it was simply absent.
 *
 * ⚠️ **It does not buy sitelinks, a knowledge panel or a search box.** None of
 * those can be requested, and no markup guarantees one. Google chooses them
 * from site structure, navigation and demand for the brand. This supplies the
 * facts correctly so the site is ELIGIBLE to be understood; the rest is
 * outside anyone's control and is not promised here.
 *
 * ── What is deliberately NOT in it
 *
 * No address, no telephone, no founding date, no `sameAs` social profiles, no
 * aggregateRating, no numberOfEmployees. Umastande (Pty) Ltd has no public
 * address or phone on this site and no social accounts linked from it, so
 * every one of those would be invented — and structured data that states
 * facts a visitor cannot verify on the page is exactly what Google's
 * guidelines forbid. The block carries what is true and nothing else.
 *
 * `legalName` is the registered company, which the legal pages already state
 * on screen, so it is verifiable rather than asserted.
 */

/** Emitted once, from the root, so it appears on every server-rendered page. */
export function provideSiteIdentity(): EnvironmentProviders {
  return provideAppInitializer(() => {
    const seo = inject(SeoService);
    const site = environment.siteUrl;

    /**
     * ⚠️ One @graph, not two scripts, and the ids are what make it work.
     * Organization and WebSite are separate entities that reference each
     * other — the site is PUBLISHED BY the company — and expressing that with
     * `@id` is what lets a parser treat them as one description instead of
     * two unrelated blobs.
     */
    seo.setJsonLd('site', {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': `${site}/#organization`,
          name: 'Mastande',
          legalName: 'Umastande (Pty) Ltd',
          url: site,
          logo: {
            '@type': 'ImageObject',
            '@id': `${site}/#logo`,
            url: `${site}/icon-512.png`,
            width: 512,
            height: 512,
            caption: 'Mastande',
          },
          image: { '@id': `${site}/#logo` },
          description:
            'Mastande is a South African room-letting board. Tenants browse and apply '
            + 'free; landlords and sub-lessors list rooms without an estate agent or commission.',
          areaServed: { '@type': 'Country', name: 'South Africa' },
          knowsLanguage: ['en-ZA', 'af-ZA', 'zu-ZA', 'xh-ZA', 'st-ZA', 'tn-ZA'],
        },
        {
          '@type': 'WebSite',
          '@id': `${site}/#website`,
          url: site,
          name: 'Mastande',
          publisher: { '@id': `${site}/#organization` },
          inLanguage: 'en-ZA',
          /**
           * ⚠️ The target is a URL that genuinely works: `/?q=` is the board's
           * own search parameter, the one a person gets by typing into the
           * search box (home.ts maps 'q' to searchTerm). A SearchAction
           * pointing at a template the site does not honour is a lie that
           * happens to validate.
           *
           * It does NOT guarantee a sitelinks search box. Google withdrew any
           * notion that this markup produces one on demand; it describes the
           * site's search honestly and that is the whole claim.
           */
          potentialAction: {
            '@type': 'SearchAction',
            target: {
              '@type': 'EntryPoint',
              urlTemplate: `${site}/?q={search_term_string}`,
            },
            'query-input': 'required name=search_term_string',
          },
        },
      ],
    });
  });
}
