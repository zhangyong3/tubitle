import { baseLocale, isLocale, localizeHref } from '@/paraglide/runtime.js';

/**
 * A locale-free path prefixed for `locale` (e.g. /zh/…), for URLs built on
 * the server that the browser lands on later, such as payment returns. API
 * requests carry no locale prefix, so the client names it; anything unknown
 * falls back to the base locale.
 */
export function localizedPath(path: string, locale: unknown): string {
  return localizeHref(path, {
    locale:
      typeof locale === 'string' && isLocale(locale) ? locale : baseLocale,
  });
}
