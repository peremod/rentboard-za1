export type LanguageCode = 'en' | 'af' | 'zu' | 'xh' | 'st' | 'tn' | 'nso' | 'ts' | 'ss' | 've' | 'nr';

export interface Language {
  code: LanguageCode;
  name: string;
  nativeName: string;
  /**
   * BCP 47 tag for <html lang> and hreflang. All are region-qualified to ZA:
   * these are South African varieties, and the region signal helps Google
   * serve the right page to the right country.
   *
   * 'nso' has no ISO 639-1 two-letter form; ISO 639-2/3 'nso' is what Google
   * accepts for Sepedi. Every other code here is valid ISO 639-1.
   */
  hreflang: string;
  /**
   * Whether this file is a real translation or an English-fallback stub.
   *
   * Eight of the eleven bundles currently carry a `_meta_needs_translation`
   * marker: they are English text under another language's filename. That is
   * a reasonable placeholder for a runtime toggle, and actively harmful as a
   * public URL — /xh/pricing serving English gives Google eleven addresses
   * with identical content, which is duplication, not localisation, and is
   * the pattern that gets sites classed as doorway pages.
   *
   * So a locale is only given a URL prefix, an hreflang entry, a sitemap
   * entry and a slot in the switcher once this is true. Flip it in the same
   * commit that lands the real translation; scripts/i18n-audit.mjs fails CI
   * if this flag and the marker key disagree.
   */
  translated: boolean;
}

/** South Africa's 11 official languages (Constitution s.6(1)). English is always the fallback. */
export const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'en',  name: 'English',   nativeName: 'English',    hreflang: 'en-ZA',  translated: true  },
  { code: 'af',  name: 'Afrikaans', nativeName: 'Afrikaans',  hreflang: 'af-ZA',  translated: true  },
  { code: 'zu',  name: 'Zulu',      nativeName: 'isiZulu',    hreflang: 'zu-ZA',  translated: true  },
  { code: 'xh',  name: 'Xhosa',     nativeName: 'isiXhosa',   hreflang: 'xh-ZA',  translated: false },
  { code: 'st',  name: 'Sotho',     nativeName: 'Sesotho',    hreflang: 'st-ZA',  translated: false },
  { code: 'tn',  name: 'Tswana',    nativeName: 'Setswana',   hreflang: 'tn-ZA',  translated: false },
  { code: 'nso', name: 'N. Sotho',  nativeName: 'Sepedi',     hreflang: 'nso-ZA', translated: false },
  { code: 'ts',  name: 'Tsonga',    nativeName: 'Xitsonga',   hreflang: 'ts-ZA',  translated: false },
  { code: 'ss',  name: 'Swati',     nativeName: 'siSwati',    hreflang: 'ss-ZA',  translated: false },
  { code: 've',  name: 'Venda',     nativeName: 'Tshivenda',  hreflang: 've-ZA',  translated: false },
  { code: 'nr',  name: 'Ndebele',   nativeName: 'isiNdebele', hreflang: 'nr-ZA',  translated: false },
];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

/**
 * Locales that carry a URL prefix. English is deliberately absent.
 *
 * English lives at the bare path ('/pricing') rather than '/en/pricing'.
 * Serving both would create two URLs with identical content — the exact
 * duplication hreflang exists to prevent — and would break every inbound
 * link and every URL already sitting in Google's index. Every other language
 * is prefixed: '/af/pricing', '/zu/rooms/abc123'.
 */
export const PREFIXED_LOCALES: LanguageCode[] = SUPPORTED_LANGUAGES
  .filter((l) => l.translated && l.code !== DEFAULT_LANGUAGE)
  .map((l) => l.code);

/**
 * What the language switcher offers. Untranslated locales are hidden rather
 * than shown and quietly serving English — offering isiXhosa and delivering
 * English is a worse experience than not offering it, and it is the kind of
 * thing people notice immediately and trust less afterwards.
 */
export const SELECTABLE_LANGUAGES: Language[] = SUPPORTED_LANGUAGES.filter((l) => l.translated);

export function isLanguageCode(value: string): value is LanguageCode {
  return SUPPORTED_LANGUAGES.some((l) => l.code === value);
}

/** True only for codes that actually appear as a URL prefix — 'en' is false. */
export function isPrefixedLocale(value: string): value is LanguageCode {
  return PREFIXED_LOCALES.includes(value as LanguageCode);
}

export function hreflangFor(code: LanguageCode): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.hreflang ?? 'en-ZA';
}

/**
 * Removes a leading locale segment. '/zu/rooms/abc' → '/rooms/abc'.
 * Used to derive the canonical path, which must be locale-neutral before
 * being re-localised for each hreflang alternate.
 */
export function stripLocalePrefix(path: string): { locale: LanguageCode; path: string } {
  const [, first, ...rest] = path.split('/');
  if (isPrefixedLocale(first)) {
    return { locale: first, path: '/' + rest.join('/') };
  }
  return { locale: DEFAULT_LANGUAGE, path };
}

/**
 * Adds the locale prefix back. English returns the path untouched.
 * Always feed this a path that has already been stripped, or you get '/zu/af/…'.
 */
export function localizePath(path: string, locale: LanguageCode): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (locale === DEFAULT_LANGUAGE) return clean;
  return clean === '/' ? `/${locale}` : `/${locale}${clean}`;
}
