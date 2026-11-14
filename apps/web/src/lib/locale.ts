import type { SupportedLocale } from '@psych/types';

/**
 * The cookie i18n/request.ts reads. Not HttpOnly on purpose: it holds only a
 * UI language, and the browser must be able to write it immediately on
 * switch. One year, so a signed-out visitor's choice also sticks.
 */
export function setLocaleCookie(locale: SupportedLocale) {
  document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000; samesite=lax`;
}
