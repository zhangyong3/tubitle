import { safeEmbedSetting } from '@/lib/embed-ids';

/**
 * Crisp live chat widget.
 * @see https://docs.crisp.chat/
 */
export function Crisp({ websiteId: raw }: { websiteId: string }) {
  // Interpolated into an inline script — only a well-formed ID gets through.
  const websiteId = safeEmbedSetting('crisp_website_id', raw);
  if (!websiteId) return null;
  return (
    <script
      id="crisp-widget"
      async
      dangerouslySetInnerHTML={{
        __html: `window.$crisp=[];window.CRISP_WEBSITE_ID="${websiteId}";(function(){var d=document;var s=d.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();`,
      }}
    />
  );
}
