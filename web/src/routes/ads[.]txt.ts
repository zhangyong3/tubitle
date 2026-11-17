import { createFileRoute } from '@tanstack/react-router';

import { getConfig } from '@/modules/config/service';
import { safeEmbedSetting } from '@/lib/embed-ids';

export const Route = createFileRoute('/ads.txt')({
  server: {
    handlers: {
      GET: async () => {
        // The publisher ID carries a "ca-" prefix in the AdSense UI, but
        // ads.txt wants the bare "pub-…" form.
        const code = safeEmbedSetting(
          'adsense_code',
          await getConfig('adsense_code')
        );
        const pubId = code.replace(/^ca-/, '');
        const body = pubId
          ? `google.com, ${pubId}, DIRECT, f08c47fec0942fa0\n`
          : '';
        return new Response(body, {
          headers: { 'Content-Type': 'text/plain' },
        });
      },
    },
  },
});
