export type LanguageCode = 'en' | 'af' | 'zu' | 'xh' | 'st' | 'tn' | 'nso' | 'ts' | 'ss' | 've' | 'nr';

export interface Language {
  code: LanguageCode;
  name: string;
  nativeName: string;
}

/** South Africa's 11 official languages (Constitution s.6(1)). English is always the fallback. */
export const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'en',  name: 'English',   nativeName: 'English' },
  { code: 'af',  name: 'Afrikaans', nativeName: 'Afrikaans' },
  { code: 'zu',  name: 'Zulu',      nativeName: 'isiZulu' },
  { code: 'xh',  name: 'Xhosa',     nativeName: 'isiXhosa' },
  { code: 'st',  name: 'Sotho',     nativeName: 'Sesotho' },
  { code: 'tn',  name: 'Tswana',    nativeName: 'Setswana' },
  { code: 'nso', name: 'N. Sotho',  nativeName: 'Sepedi' },
  { code: 'ts',  name: 'Tsonga',    nativeName: 'Xitsonga' },
  { code: 'ss',  name: 'Swati',     nativeName: 'siSwati' },
  { code: 've',  name: 'Venda',     nativeName: 'Tshivenda' },
  { code: 'nr',  name: 'Ndebele',   nativeName: 'isiNdebele' },
];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';
