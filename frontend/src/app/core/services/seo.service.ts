import { DOCUMENT, Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { environment } from '@env/environment';
import {
  DEFAULT_LANGUAGE,
  LanguageCode,
  SUPPORTED_LANGUAGES,
  localizePath,
  stripLocalePrefix,
} from '../models/language.model';

/**
 * Per-page metadata: canonical URL, description, Open Graph, Twitter card,
 * robots directive and JSON-LD structured data.
 *
 * Why a service and not tags in index.html: index.html is a single static
 * <head> shared by every route, so before this existed all 41 routes shipped
 * the homepage description and no canonical at all. Search engines saw one
 * page's metadata on every URL — including every room detail page, which is
 * the only content we actually want indexed at volume.
 *
 * SSR-safe: uses Meta/Title/DOCUMENT, all of which Angular provides on the
 * server, so the tags are present in the served HTML rather than painted in
 * after hydration. A crawler that does not execute JavaScript still sees them.
 *
 * Usage in a component:
 *   inject(SeoService).apply({
 *     title: 'En-suite room in Sandton — R5 500/mo',
 *     description: '…',
 *     path: `/rooms/${room.id}`,
 *     image: heroUrl,
 *   });
 */

export interface SeoInput {
  /** Full <title>. Omit to keep whatever the route's `title` already set. */
  title?: string;
  description?: string;
  /** Site-root-relative path, e.g. '/pricing'. Becomes the canonical URL. */
  path?: string;
  /** Absolute image URL for social cards. Falls back to the site OG image. */
  image?: string;
  /** 'website' for pages, 'article' for content. Room listings use 'website'. */
  type?: 'website' | 'article';
  /**
   * Set true on pages that must never be indexed — auth screens, portals,
   * anything behind a guard. Non-production environments force this on
   * regardless, so staging can never outrank production for its own copy.
   */
  noIndex?: boolean;
  /**
   * Locale of the page being rendered. Determines which alternate is marked
   * as the current one and what <html lang> says. Derived from the URL by
   * route-seo.ts — a component rarely needs to pass it.
   */
  locale?: LanguageCode;
  /**
   * Set false on pages that exist in only one language. Room descriptions are
   * written by landlords in whatever language they chose and are not
   * translated, so a room page must not claim ten alternates that would each
   * serve the same untranslated text.
   */
  alternates?: boolean;
}

const DEFAULT_IMAGE = '/assets/images/og-default.png';
const FALLBACK_DESCRIPTION =
  'Find a room to rent direct from landlords across South Africa. Free to apply, always. No estate agent, no application fees.';

@Injectable({ providedIn: 'root' })
export class SeoService {
  private meta = inject(Meta);
  private titleService = inject(Title);
  private doc = inject(DOCUMENT);

  /** Set once per navigation. Later calls in the same page simply overwrite. */
  apply(input: SeoInput): void {
    const description = input.description ?? FALLBACK_DESCRIPTION;
    const canonical = this.absolute(input.path ?? this.currentPath());
    const image = input.image ?? this.absolute(DEFAULT_IMAGE);

    if (input.title) this.titleService.setTitle(input.title);
    const title = input.title ?? this.titleService.getTitle();

    this.meta.updateTag({ name: 'description', content: description });

    // Staging and development are never indexable, whatever the page says.
    const noIndex = input.noIndex || !environment.indexable;
    this.meta.updateTag({
      name: 'robots',
      content: noIndex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large',
    });

    this.setCanonical(noIndex ? null : canonical);

    // hreflang alternates. Emitted only for indexable pages that genuinely
    // exist in every language — a hreflang set pointing at ten copies of the
    // same English text is worse than none, and Google reports it as an error.
    this.setAlternates(
      !noIndex && input.alternates !== false ? input.path ?? this.currentPath() : null,
    );

    // Open Graph — used by WhatsApp link previews, which matter more than
    // Facebook here: landlords share room links over WhatsApp constantly.
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:url', content: canonical });
    this.meta.updateTag({ property: 'og:image', content: image });
    this.meta.updateTag({ property: 'og:type', content: input.type ?? 'website' });
    this.meta.updateTag({ property: 'og:site_name', content: 'Mastande' });
    // og:locale mirrors the page's actual language, and og:locale:alternate
    // tells WhatsApp and Facebook the other versions exist.
    const locale = input.locale ?? stripLocalePrefix(input.path ?? this.currentPath()).locale;
    this.meta.updateTag({
      property: 'og:locale',
      content: (SUPPORTED_LANGUAGES.find((l) => l.code === locale)?.hreflang ?? 'en-ZA').replace('-', '_'),
    });

    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({ name: 'twitter:description', content: description });
    this.meta.updateTag({ name: 'twitter:image', content: image });
  }

  /**
   * Structured data. Keyed by id so a component can replace its own block on
   * re-navigation without wiping another component's — a room page and the
   * site-wide Organization block coexist.
   */
  setJsonLd(id: string, data: Record<string, unknown> | null): void {
    const elementId = `ld-${id}`;
    const existing = this.doc.getElementById(elementId);
    if (existing) existing.remove();
    if (!data) return;

    const script = this.doc.createElement('script');
    script.id = elementId;
    script.type = 'application/ld+json';
    // JSON.stringify escapes nothing dangerous here, but '<' inside a string
    // would close the script tag early, so it is neutralised explicitly.
    script.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
    this.doc.head.appendChild(script);
  }

  /**
   * Keeps <html lang> in step with the runtime language toggle. Without this
   * an Afrikaans or isiZulu page still declares lang="en", which screen
   * readers pronounce wrong and Lighthouse flags under Accessibility.
   */
  setHtmlLang(code: string): void {
    this.doc.documentElement.setAttribute('lang', code);
  }

  /**
   * Writes one <link rel="alternate" hreflang> per language plus x-default.
   *
   * Rules Google enforces and this satisfies:
   *   - The set must be reciprocal and self-referential: every page lists
   *     every alternate including itself, or the cluster is ignored entirely.
   *   - x-default points at the English URL, which is what an unmatched
   *     visitor should get.
   *   - URLs are absolute. Relative hreflang is silently dropped.
   */
  private setAlternates(path: string | null): void {
    this.doc.head
      .querySelectorAll('link[rel="alternate"][hreflang]')
      .forEach((el) => el.remove());

    if (!path) return;

    const { path: neutral } = stripLocalePrefix(path);

    // Only translated locales. An hreflang entry for a stub bundle points at
    // a URL that serves English, which Google reports as a duplicate cluster.
    for (const lang of SUPPORTED_LANGUAGES.filter((l) => l.translated)) {
      this.appendAlternate(lang.hreflang, this.absolute(localizePath(neutral, lang.code)));
    }
    this.appendAlternate('x-default', this.absolute(localizePath(neutral, DEFAULT_LANGUAGE)));
  }

  private appendAlternate(hreflang: string, href: string): void {
    const link = this.doc.createElement('link');
    link.setAttribute('rel', 'alternate');
    link.setAttribute('hreflang', hreflang);
    link.setAttribute('href', href);
    this.doc.head.appendChild(link);
  }

  private setCanonical(href: string | null): void {
    let link = this.doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!href) {
      link?.remove();
      return;
    }
    if (!link) {
      link = this.doc.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.doc.head.appendChild(link);
    }
    link.setAttribute('href', href);
  }

  /** Query strings are stripped: ?page=2 and ?utm_source must not fork the canonical. */
  private currentPath(): string {
    return this.doc.location?.pathname ?? '/';
  }

  private absolute(pathOrUrl: string): string {
    if (pathOrUrl.startsWith('http')) return pathOrUrl;
    return `${environment.siteUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
  }
}
