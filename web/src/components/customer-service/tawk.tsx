import { safeEmbedSetting } from '@/lib/embed-ids';

/**
 * Tawk.to live chat widget.
 * @see https://developer.tawk.to/jsapi/
 */
export function Tawk(props: { propertyId: string; widgetId: string }) {
  // Interpolated into an inline script — only well-formed IDs get through.
  const propertyId = safeEmbedSetting('tawk_property_id', props.propertyId);
  const widgetId = safeEmbedSetting('tawk_widget_id', props.widgetId);
  if (!propertyId || !widgetId) return null;
  return (
    <script
      id="tawk-widget"
      async
      dangerouslySetInnerHTML={{
        __html: `var Tawk_API=Tawk_API||{},Tawk_LoadStart=new Date();(function(){var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];s1.async=true;s1.src="https://embed.tawk.to/${propertyId}/${widgetId}";s1.charset="UTF-8";s1.setAttribute("crossorigin","*");s0.parentNode.insertBefore(s1,s0);})();`,
      }}
    />
  );
}
