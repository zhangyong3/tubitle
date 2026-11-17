import { safeEmbedSetting } from '@/lib/embed-ids';

// GA4 (gtag.js) as native <script> tags — see analytics/plausible.tsx for
// why we avoid next/script (RSC-only emission breaks View Source + crawlers
// + delays script load until hydration). `async` keeps it off the critical
// path; GA's enhanced measurement picks up History API navigations on its
// own in App Router.
//
// consentMode: Google Consent Mode v2. Storage defaults to "denied" unless the
// visitor already accepted (read from the cookie inline, so cached HTML is
// still right); the cookie banner calls gtag('consent','update') on a choice.
export function GoogleAnalytics({
  measurementId: raw,
  consentMode = false,
}: {
  measurementId: string;
  consentMode?: boolean;
}) {
  // Interpolated into an inline script — only a well-formed ID gets through.
  const measurementId = safeEmbedSetting('google_analytics_id', raw);
  if (!measurementId) return null;
  const consentDefault = consentMode
    ? `var s=/(?:^|; )cookie_consent=accepted(?:;|$)/.test(document.cookie)?'granted':'denied';gtag('consent','default',{ad_storage:s,ad_user_data:s,ad_personalization:s,analytics_storage:s,wait_for_update:500});`
    : '';
  return (
    <>
      <script
        id="ga-loader"
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        async
      />
      {/* async={true} flags this to React 19 as a hoistable resource —
          without it, React logs the "Encountered a script tag while
          rendering React component" warning and won't re-execute it on
          client navigations. */}
      <script
        id="ga-init"
        async
        dangerouslySetInnerHTML={{
          __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}${consentDefault}gtag('js',new Date());gtag('config','${measurementId}');`,
        }}
      />
    </>
  );
}
