import { LanguageCode } from '../models/language.model';

/**
 * Translation bundles, as lazily-imported modules rather than HTTP fetches.
 *
 * Why not keep the previous `http.get('/assets/i18n/zu.json')`:
 *
 *  1. It could not work during server-side rendering. A relative URL has no
 *     origin on the server, so the request failed, `catchError` swallowed it,
 *     and every SSR'd page rendered in English regardless of locale. With
 *     locale-scoped URLs that is fatal — /zu/pricing would be served to
 *     Google as English, which is worse than having no translation at all.
 *  2. On the browser it added a blocking round-trip before first meaningful
 *     paint, on a connection we are already trying to protect.
 *
 * A static map of dynamic imports gives esbuild a known set of entry points,
 * so each language becomes its own lazy chunk — fetched only when selected,
 * inlined into the server bundle for SSR. Total cost is ~1.5KB per language.
 *
 * The map must be written out literally. A computed path
 * (`import('../../assets/i18n/' + code + '.json')`) leaves the bundler unable
 * to know which files to emit, and it silently ships none of them.
 */
export const TRANSLATION_BUNDLES: Record<LanguageCode, () => Promise<Record<string, string>>> = {
  en: () => import('../../../assets/i18n/en.json').then(unwrap),
  af: () => import('../../../assets/i18n/af.json').then(unwrap),
  zu: () => import('../../../assets/i18n/zu.json').then(unwrap),
  xh: () => import('../../../assets/i18n/xh.json').then(unwrap),
  st: () => import('../../../assets/i18n/st.json').then(unwrap),
  tn: () => import('../../../assets/i18n/tn.json').then(unwrap),
  nso: () => import('../../../assets/i18n/nso.json').then(unwrap),
  ts: () => import('../../../assets/i18n/ts.json').then(unwrap),
  ss: () => import('../../../assets/i18n/ss.json').then(unwrap),
  ve: () => import('../../../assets/i18n/ve.json').then(unwrap),
  nr: () => import('../../../assets/i18n/nr.json').then(unwrap),
};

/** JSON modules arrive under `default` in ESM, but not under every bundler config. */
function unwrap(mod: unknown): Record<string, string> {
  const m = mod as { default?: Record<string, string> };
  return (m.default ?? m) as Record<string, string>;
}
