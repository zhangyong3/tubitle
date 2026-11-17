// Cookie consent state, shared by the consent banner, the footer "Cookie
// settings" link and the consent-gated scripts (GA Consent Mode, AdSense).
// The choice lives in a first-party cookie so the server can read it on SSR
// and render already-consented scripts straight into the HTML.

import { getCookie, setCookie } from '@/lib/cookie';

export const COOKIE_CONSENT_NAME = 'cookie_consent';
export const COOKIE_CONSENT_DAYS = 365;

export type CookieConsent = 'accepted' | 'rejected' | null;

const CHANGE_EVENT = 'cookie-consent-change';
const OPEN_EVENT = 'cookie-consent-open';

export function parseCookieConsent(value: string | undefined): CookieConsent {
  return value === 'accepted' || value === 'rejected' ? value : null;
}

export function readCookieConsent(): CookieConsent {
  if (typeof document === 'undefined') return null;
  return parseCookieConsent(getCookie(COOKIE_CONSENT_NAME));
}

type Gtag = (...args: unknown[]) => void;

export function saveCookieConsent(value: 'accepted' | 'rejected') {
  setCookie(COOKIE_CONSENT_NAME, value, COOKIE_CONSENT_DAYS);

  // GA Consent Mode v2: flip the defaults set by the ga-init script.
  const gtag = (window as unknown as { gtag?: Gtag }).gtag;
  if (typeof gtag === 'function') {
    const state = value === 'accepted' ? 'granted' : 'denied';
    gtag('consent', 'update', {
      ad_storage: state,
      ad_user_data: state,
      ad_personalization: state,
      analytics_storage: state,
    });
  }

  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function subscribeCookieConsent(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

/** Re-open the banner so visitors can change (or withdraw) their choice. */
export function openCookieSettings() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

export function subscribeCookieSettingsOpen(callback: () => void) {
  window.addEventListener(OPEN_EVENT, callback);
  return () => window.removeEventListener(OPEN_EVENT, callback);
}
