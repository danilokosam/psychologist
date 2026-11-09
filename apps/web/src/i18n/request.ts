import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

// ADR-0007: English default, Spanish secondary, resolved without a URL
// locale prefix (no /en/..., /es/...). The full resolution order --
// profiles.locale -> cookie -> Accept-Language -> 'en' -- lands once
// authentication exists; for now this reads the same cookie the eventual
// language switcher (F-013) will write, falling back to English.
export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
const DEFAULT_LOCALE: Locale = 'en';

function isSupportedLocale(value: string | undefined): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get('NEXT_LOCALE')?.value;
  const locale = isSupportedLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
