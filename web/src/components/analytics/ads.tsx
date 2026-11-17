import { safeEmbedSetting } from '@/lib/embed-ids';

// Google AdSense — the account <meta> tag plus the adsbygoogle loader,
// rendered as native head elements (not next/script). React 19 hoists the
// <meta> and async <script> into <head> so they land in the SSR HTML directly
// and are visible to the AdSense crawler in View Source. `code` is the
// publisher ID (e.g. "ca-pub-XXXXXXXXXXXXXXXX").
//
// loadScript=false (cookie banner on, visitor hasn't accepted) keeps only the
// account <meta>, which sets no cookies and lets AdSense still verify the site.
export function Ads({
  code: raw,
  loadScript = true,
}: {
  code: string;
  loadScript?: boolean;
}) {
  const code = safeEmbedSetting('adsense_code', raw);
  if (!code) return null;
  return (
    <>
      <meta name="google-adsense-account" content={code} />
      {/* async={true} flags this to React 19 as a hoistable resource —
          see google-analytics.tsx for the full rationale. */}
      {loadScript ? (
        <script
          id="adsbygoogle-loader"
          async
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${code}`}
          crossOrigin="anonymous"
        />
      ) : null}
    </>
  );
}
