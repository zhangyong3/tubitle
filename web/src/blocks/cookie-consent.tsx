import { useEffect, useState } from 'react';

import { usePathname } from '@/core/i18n/navigation';
import {
  saveCookieConsent,
  subscribeCookieSettingsOpen,
  type CookieConsent as CookieConsentValue,
} from '@/lib/cookie-consent';
import { m } from '@/paraglide/messages.js';
import { useCookieConsent } from '@/hooks/use-cookie-consent';
import { CookieConsentBanner } from '@/components/cookie-consent-banner';

/**
 * Cookie consent banner. Shown until the visitor accepts or rejects, and again
 * whenever something calls openCookieSettings() (the footer link does).
 * Mounted in __root only when the admin enabled `cookie_consent_enabled`.
 */
export function CookieConsent({ initial }: { initial: CookieConsentValue }) {
  const consent = useCookieConsent(initial);
  const pathname = usePathname();
  const [reopened, setReopened] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(
    () =>
      subscribeCookieSettingsOpen(() => {
        setDismissed(false);
        setReopened(true);
      }),
    []
  );

  // Admins run the site; they don't need the visitor-facing banner.
  const isAdmin = pathname === '/admin' || pathname.startsWith('/admin/');
  if (isAdmin || dismissed || (consent && !reopened)) return null;

  const choose = (value: 'accepted' | 'rejected') => {
    saveCookieConsent(value);
    setReopened(false);
  };

  return (
    <CookieConsentBanner
      title={m['common.cookie_consent.title']()}
      description={m['common.cookie_consent.description']()}
      acceptLabel={m['common.cookie_consent.accept']()}
      rejectLabel={m['common.cookie_consent.reject']()}
      closeLabel={m['common.cookie_consent.close']()}
      policyPrefix={m['common.cookie_consent.policy_prefix']()}
      policyLabel={m['common.cookie_consent.policy']()}
      policyHref="/privacy-policy"
      onAccept={() => choose('accepted')}
      onReject={() => choose('rejected')}
      onClose={() => {
        setDismissed(true);
        setReopened(false);
      }}
    />
  );
}
