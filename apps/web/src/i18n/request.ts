import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

// ADR-0007: English default, Spanish secondary, resolved without a URL
// locale prefix (no /en/..., /es/...). Resolution order:
//   profiles.locale -> NEXT_LOCALE cookie -> Accept-Language -> 'en'.
// The profile step is applied client-side: once signed in, the dashboard
// copies profiles.locale into the cookie (see syncLocaleFromProfile), so the
// server only ever needs to read the cookie here -- no API round-trip on
// every render.
export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
const DEFAULT_LOCALE: Locale = 'en';

function isSupportedLocale(value: string | undefined | null): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

/**
 * First supported language in an Accept-Language header, honouring q-values
 * ("es-ES,es;q=0.9,en;q=0.8" -> 'es'). Region subtags are ignored: there is
 * one Spanish catalog, not one per country.
 */
export function localeFromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { language: tag.split('-')[0]?.toLowerCase(), q: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter((entry) => entry.q > 0)
    .sort((a, b) => b.q - a.q);
  return ranked.map((entry) => entry.language).find(isSupportedLocale) ?? null;
}

export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get('NEXT_LOCALE')?.value;
  const locale = isSupportedLocale(cookieLocale)
    ? cookieLocale
    : (localeFromAcceptLanguage((await headers()).get('accept-language')) ?? DEFAULT_LOCALE);

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
