import { ShieldCheck, X } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { Button } from '@/components/ui/button';

export interface CookieConsentBannerProps {
  title: string;
  description: string;
  acceptLabel: string;
  rejectLabel: string;
  closeLabel: string;
  /** Text before the policy link, e.g. "Learn more in our". */
  policyPrefix?: string;
  policyLabel?: string;
  policyHref?: string;
  onAccept: () => void;
  onReject: () => void;
  /** Dismiss without choosing — the banner comes back on the next visit. */
  onClose: () => void;
}

/**
 * Bottom-left cookie consent card (bottom-right is the support widget).
 * Accept and Reject are equally prominent, as GDPR/ePrivacy guidance asks.
 */
export function CookieConsentBanner({
  title,
  description,
  acceptLabel,
  rejectLabel,
  closeLabel,
  policyPrefix,
  policyLabel,
  policyHref,
  onAccept,
  onReject,
  onClose,
}: CookieConsentBannerProps) {
  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-labelledby="cookie-consent-title"
      aria-describedby="cookie-consent-description"
      className="bg-popover text-popover-foreground animate-in fade-in slide-in-from-bottom-4 fixed inset-x-4 bottom-4 z-50 rounded-xl border p-5 shadow-lg sm:right-auto sm:bottom-6 sm:left-6 sm:w-[26rem]"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="text-muted-foreground hover:text-foreground absolute top-4 right-4 rounded-sm transition-colors"
      >
        <X className="size-4" />
      </button>

      <div className="flex items-center gap-3 pr-6">
        <ShieldCheck className="text-primary size-5 shrink-0" />
        <h2 id="cookie-consent-title" className="text-base font-semibold">
          {title}
        </h2>
      </div>

      <p
        id="cookie-consent-description"
        className="text-muted-foreground mt-3 text-sm leading-relaxed"
      >
        {description}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Button onClick={onAccept}>{acceptLabel}</Button>
        <Button variant="secondary" onClick={onReject}>
          {rejectLabel}
        </Button>
      </div>

      {policyHref && policyLabel ? (
        <p className="text-muted-foreground mt-4 text-xs">
          {policyPrefix}{' '}
          <Link
            href={policyHref}
            className="text-foreground underline underline-offset-4"
          >
            {policyLabel}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
